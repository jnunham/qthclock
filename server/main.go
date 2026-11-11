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
	"qthclock/internal/logbook"
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
	fileDemo := cfg.Demo.Enabled
	if *demo {
		cfg.Demo.Enabled = true
	}
	if !cfg.configured() && !cfg.Demo.Enabled && stdinIsTerminal() {
		if err := promptStation(&cfg); err != nil {
			log.Printf("setup: %v", err)
		} else if err := saveConfig(*cfgPath, cfg, fileDemo); err != nil {
			log.Fatalf("saving %s: %v", *cfgPath, err)
		} else {
			log.Printf("saved %s", *cfgPath)
		}
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

	recent := logbook.NewRecent(10, func(q []logbook.QSO) { hub.SetState("qsos", q) })
	st := &station{cfg: cfg, path: *cfgPath, fileDemo: fileDemo, hub: hub, recent: recent, loc: sources.Locator{CTY: cty}, parent: ctx}
	st.start()

	if cfg.Solar.Enabled {
		go solar.Poll(ctx, time.Duration(cfg.Solar.IntervalMinutes)*time.Minute, func(r solar.Report) {
			hub.SetState("solar", r)
		})
	}

	display := newDisplaySettings(cfg.DataDir, hub)
	boot := time.Now().UnixMilli() // lets open screens notice a restart and reload new code

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/settings", display.get)
	mux.HandleFunc("PUT /api/settings", display.put)
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		c := st.config()
		out := map[string]any{"callsign": c.Callsign, "grid": c.Grid, "mapStyle": c.MapStyle,
			"demo": c.Demo.Enabled, "nearKm": c.NearKm, "configured": c.configured(), "boot": boot}
		if la, lo, ok := geo.GridToLatLon(c.Grid); ok {
			out["lat"], out["lon"] = la, lo
		}
		if e, _, _, ok := cty.Lookup(c.Callsign); ok {
			out["country"], out["cont"] = e.Name, e.Continent
		} else if c.Demo.Enabled {
			out["country"], out["cont"] = "United States", "NA"
		}
		out["wavelog"] = c.Wavelog.Enabled && c.Wavelog.URL != "" && c.Wavelog.APIKey != ""
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Callsign, Grid string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := st.setStation(req.Callsign, req.Grid); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		h := hub.Stats()
		h["cty"] = cty.Loaded()
		writeJSON(w, h)
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
	printURLs(cfg.Listen, st.config().configured())
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
