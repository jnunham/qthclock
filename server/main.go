// qthclock: a live-spotting ham radio display.
//
// The server holds connections to the spot feeds, merges them, and streams
// batches to any number of browsers using Server-Sent Events (/api/stream).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"qthclock/internal/geo"
	"qthclock/internal/solar"
	"qthclock/internal/sources"
	"qthclock/internal/spots"
)

func main() {
	cfgPath := flag.String("config", "config.json", "path to config file")
	demo := flag.Bool("demo", false, "generate fake spots instead of connecting to live feeds")
	flag.Parse()

	cfg, err := loadConfig(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if *demo {
		cfg.Demo.Enabled = true
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := spots.NewHub(cfg.HistoryMax, time.Duration(cfg.HistoryMinutes)*time.Minute)

	cty := geo.NewCTY()
	go func() {
		if err := cty.LoadOrFetch(filepath.Join(cfg.DataDir, "cty.dat"), cfg.CTY.URL); err != nil {
			log.Printf("cty: %v (RBN/cluster spots won't have map positions until cty.dat is available)", err)
		}
	}()
	loc := sources.Locator{CTY: cty}

	// Everything goes through the relevance filter: only spots about me, heard
	// by me, or spotted near me reach the display.
	rel := sources.Relevance{Call: cfg.Callsign, NearKm: cfg.NearKm}
	if la, lo, ok := geo.GridToLatLon(cfg.Grid); ok {
		rel.Lat, rel.Lon, rel.HasQTH = la, lo, true
	} else {
		log.Printf("no valid \"grid\" in config: \"near me\" DX spots are disabled")
	}
	if cfg.Callsign == "" {
		log.Printf("no \"callsign\" in config: \"who hears me\" is disabled")
	}
	pub := func(s spots.Spot) {
		if s, ok := rel.Tag(s); ok {
			hub.Publish(s)
		}
	}

	if cfg.Demo.Enabled {
		log.Printf("demo mode: generating %d fake spots/s", cfg.Demo.Rate)
		if rel.Call == "" {
			rel.Call = "N0CALL"
		}
		if !rel.HasQTH {
			rel.Lat, rel.Lon, rel.HasQTH = 41.7, -72.7, true
		}
		go (&sources.Demo{Call: rel.Call, Grid: cfg.Grid, Pub: pub, Rate: cfg.Demo.Rate}).Run(ctx)
	} else {
		if cfg.PSKReporter.Enabled {
			go (&sources.PSKReporter{Addr: cfg.PSKReporter.Addr, Topics: cfg.PSKReporter.Topics,
				Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
		}
		if cfg.WSJTX.Enabled {
			go (&sources.WSJTX{Listen: cfg.WSJTX.Listen, Call: cfg.Callsign, Grid: cfg.Grid, Pub: pub, Locator: loc}).Run(ctx)
		}
		needCall := func(name string) bool {
			if cfg.Callsign == "" {
				log.Printf("%s: skipped, set \"callsign\" in config to log in", name)
				return false
			}
			return true
		}
		if cfg.RBN.Enabled && needCall("rbn") {
			for _, a := range cfg.RBN.Addrs {
				go (&sources.Telnet{Name: "rbn", Addr: a, Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
			}
		}
		if cfg.Cluster.Enabled && needCall("cluster") {
			go (&sources.Telnet{Name: "cluster", Addr: cfg.Cluster.Addr, Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
		}
	}
	if cfg.Solar.Enabled {
		go solar.Poll(ctx, time.Duration(cfg.Solar.IntervalMinutes)*time.Minute, func(r solar.Report) {
			hub.SetState("solar", r)
		})
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		out := map[string]any{"callsign": cfg.Callsign, "grid": cfg.Grid, "mapStyle": cfg.MapStyle, "demo": cfg.Demo.Enabled, "nearKm": cfg.NearKm}
		if la, lo, ok := geo.GridToLatLon(cfg.Grid); ok {
			out["lat"], out["lon"] = la, lo
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		st := hub.Stats()
		st["cty"] = cty.Loaded()
		writeJSON(w, st)
	})
	mux.HandleFunc("GET /api/stream", func(w http.ResponseWriter, r *http.Request) { serveSSE(w, r, hub) })
	mux.Handle("/", http.FileServer(http.Dir(cfg.WebDir)))

	srv := &http.Server{Addr: cfg.Listen, Handler: mux}
	go func() {
		<-ctx.Done()
		sh, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(sh)
	}()
	log.Printf("qthclock listening on http://localhost%s", cfg.Listen)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func serveSSE(w http.ResponseWriter, r *http.Request, hub *spots.Hub) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")

	events, unsub := hub.Subscribe()
	defer unsub()
	fmt.Fprint(w, "retry: 3000\n\n")
	fl.Flush()

	keep := time.NewTicker(20 * time.Second)
	defer keep.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keep.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		case e, ok := <-events:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Name, e.Data)
			fl.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
