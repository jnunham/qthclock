package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"qthclock/internal/geo"
	"qthclock/internal/logbook"
	"qthclock/internal/sources"
	"qthclock/internal/spots"
)

// station owns the operator's identity and the feed connections that depend
// on it. Changing call or grid (first-run setup) restarts the feeds in place.
type station struct {
	mu       sync.Mutex
	cfg      Config
	path     string
	fileDemo bool
	hub      *spots.Hub
	recent   *logbook.Recent
	loc      sources.Locator
	parent   context.Context
	cancel   context.CancelFunc
}

func (s *station) config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

var (
	callRe = regexp.MustCompile(`^[A-Z0-9]{1,4}[0-9][A-Z0-9]{0,4}[A-Z](/[A-Z0-9]{1,4})?$`)
	gridRe = regexp.MustCompile(`^[A-R]{2}[0-9]{2}([A-X]{2})?$`)
)

// validateStation normalises and checks a callsign and grid square.
func validateStation(call, grid string) (string, string, error) {
	call = strings.ToUpper(strings.TrimSpace(call))
	grid = strings.TrimSpace(grid)
	if !callRe.MatchString(call) {
		return "", "", fmt.Errorf("%q doesn't look like a callsign", call)
	}
	g := strings.ToUpper(grid)
	if !gridRe.MatchString(g) {
		return "", "", fmt.Errorf("%q isn't a 4- or 6-character grid square (e.g. FN31 or FN31pr)", grid)
	}
	if len(g) == 6 {
		g = g[:4] + strings.ToLower(g[4:])
	}
	return call, g, nil
}

func (s *station) setStation(call, grid string) error {
	call, grid, err := validateStation(call, grid)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.cfg.Callsign, s.cfg.Grid = call, grid
	cfg := s.cfg
	s.mu.Unlock()
	if err := saveConfig(s.path, cfg, s.fileDemo); err != nil {
		return fmt.Errorf("saving %s: %w", s.path, err)
	}
	log.Printf("station set to %s in %s; restarting feeds", call, grid)
	s.hub.Reset()
	s.start()
	return nil
}

// start (re)connects every feed using the current call and grid.
func (s *station) start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	ctx, cancel := context.WithCancel(s.parent)
	s.cancel = cancel
	cfg := s.cfg
	hub, loc, recent := s.hub, s.loc, s.recent
	working := func(w logbook.Working) { hub.SetState("working", w) }

	// Everything goes through the relevance filter: only spots about me, heard
	// by me, or spotted near me reach the display.
	rel := sources.Relevance{Call: cfg.Callsign, NearKm: cfg.NearKm}
	if la, lo, ok := geo.GridToLatLon(cfg.Grid); ok {
		rel.Lat, rel.Lon, rel.HasQTH = la, lo, true
	}
	if cfg.Demo.Enabled {
		if rel.Call == "" {
			rel.Call = "N0CALL"
		}
		if !rel.HasQTH {
			rel.Lat, rel.Lon, rel.HasQTH = 41.7, -72.7, true
		}
	}
	pub := func(sp spots.Spot) {
		if sp, ok := rel.Tag(sp); ok {
			hub.Publish(sp)
		}
	}

	if cfg.Demo.Enabled {
		log.Printf("demo mode: generating %d fake spots/s around %s", cfg.Demo.Rate, rel.Call)
		go (&sources.Demo{Call: rel.Call, Grid: cfg.Grid, Pub: pub, Rate: cfg.Demo.Rate,
			OnStatus: working, OnLogged: func(q logbook.QSO) { recent.Add(q) }}).Run(ctx)
		return
	}
	if !cfg.configured() {
		log.Printf("waiting for setup: open the web page to enter your callsign and grid square")
		return
	}
	if cfg.PSKReporter.Enabled {
		go (&sources.PSKReporter{Addr: cfg.PSKReporter.Addr, Topics: cfg.PSKReporter.Topics,
			Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
	}
	if cfg.WSJTX.Enabled {
		go (&sources.WSJTX{Listen: cfg.WSJTX.Listen, Call: cfg.Callsign, Grid: cfg.Grid, Pub: pub, Locator: loc,
			OnStatus: working, OnLogged: func(q logbook.QSO) { recent.Add(q) },
			OnListen: func(i sources.WSJTXInfo) { hub.SetState("wsjtx", i) }}).Run(ctx)
	}
	if cfg.RBN.Enabled {
		for _, a := range cfg.RBN.Addrs {
			go (&sources.Telnet{Name: "rbn", Addr: a, Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
		}
	}
	if cfg.Cluster.Enabled {
		go (&sources.Telnet{Name: "cluster", Addr: cfg.Cluster.Addr, Call: cfg.Callsign, Pub: pub, Locator: loc}).Run(ctx)
	}
	wlStatus := func(ok bool, msg string) {
		hub.SetState("wavelog", map[string]any{"ok": ok, "error": msg, "at": time.Now().UnixMilli()})
	}
	switch {
	case !cfg.Wavelog.Enabled:
		wlStatus(false, "")
	case cfg.Wavelog.URL == "" || cfg.Wavelog.APIKey == "":
		log.Printf("wavelog: set \"url\" and \"apiKey\" in config to show your recent QSOs")
		wlStatus(false, `Wavelog is enabled but "url" or "apiKey" is empty in config.json`)
	default:
		go newWavelog(cfg, recent.Add, wlStatus).Run(ctx)
	}
}

// stdinIsTerminal is true when someone is typing at a terminal (not when run
// from systemd, cron or with stdin redirected from /dev/null).
func stdinIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0 && os.Getenv("TERM") != "" && fi.Name() != "null"
}

// promptStation asks for call and grid on the terminal (first run only).
func promptStation(cfg *Config) error {
	in := bufio.NewReader(os.Stdin)
	ask := func(q, def string) (string, error) {
		if def != "" {
			fmt.Printf("%s [%s]: ", q, def)
		} else {
			fmt.Printf("%s: ", q)
		}
		line, err := in.ReadString('\n')
		if err != nil {
			return "", errors.New("no input (you can also finish setup in the web page)")
		}
		if line = strings.TrimSpace(line); line == "" {
			return def, nil
		}
		return line, nil
	}
	fmt.Println()
	fmt.Println("Welcome to QTHClock. Let's set up your station (you can change this later in config.json).")
	call, grid := cfg.Callsign, cfg.Grid
	for {
		var err error
		if call, err = ask("Your callsign", call); err != nil {
			return err
		}
		if grid, err = ask("Your grid square, 4 or 6 characters (e.g. FN31pr)", grid); err != nil {
			return err
		}
		c, g, err := validateStation(call, grid)
		if err != nil {
			fmt.Println("  ", err)
			continue
		}
		cfg.Callsign, cfg.Grid = c, g
		fmt.Println()
		return nil
	}
}

// lanIPs lists this machine's IPv4 addresses (for "point WSJT-X here" hints).
func lanIPs() []string {
	var out []string
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ip, ok := a.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() {
				out = append(out, ip.IP.String())
			}
		}
	}
	return out
}

// printURLs shows where to open the display, including LAN addresses for a
// Pi you're setting up from another computer.
func printURLs(listen string, configured bool) {
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		port = "8073"
	}
	urls := []string{"http://localhost:" + port}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ip, ok := a.(*net.IPNet); ok && ip.IP.To4() != nil && !ip.IP.IsLoopback() {
				urls = append(urls, "http://"+ip.IP.String()+":"+port)
			}
		}
	}
	log.Printf("QTHClock is running. Open: %s", strings.Join(urls, "  or  "))
	if !configured {
		log.Printf("First run: the page will ask for your callsign and grid square.")
	}
}

// saveConfig writes the full config so every option is visible and editable.
func saveConfig(path string, cfg Config, fileDemo bool) error {
	cfg.Demo.Enabled = fileDemo // don't persist a -demo command-line flag
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func newWavelog(cfg Config, add func(...logbook.QSO), status func(bool, string)) *logbook.Wavelog {
	return &logbook.Wavelog{URL: cfg.Wavelog.URL, Key: cfg.Wavelog.APIKey, StationID: cfg.Wavelog.StationID,
		Interval: time.Duration(cfg.Wavelog.IntervalSeconds) * time.Second, SkipTLSVerify: cfg.Wavelog.SkipTLSVerify,
		Add: add, Status: status}
}

// checkWavelog runs one Wavelog fetch and prints the result (qthclock -check-wavelog).
func checkWavelog(cfg Config) int {
	if cfg.Wavelog.URL == "" || cfg.Wavelog.APIKey == "" {
		fmt.Println(`Set "url" and "apiKey" in the "wavelog" section of config.json first.`)
		return 1
	}
	kind := "classic API key (api/get_contacts_adif)"
	if strings.HasPrefix(cfg.Wavelog.APIKey, "wl2_") {
		kind = "API v2 token (api/v2/qso)"
	}
	fmt.Printf("Checking Wavelog at %s using a %s...\n", cfg.Wavelog.URL, kind)
	var got []logbook.QSO
	w := newWavelog(cfg, func(q ...logbook.QSO) { got = append(got, q...) }, nil)
	if err := w.Poll(context.Background()); err != nil {
		fmt.Println("FAILED:", err)
		return 1
	}
	fmt.Printf("OK: %d recent QSOs\n", len(got))
	for _, q := range got {
		fmt.Printf("  %s  %-10s %-5s %-5s sent %-4s rcvd %s\n", time.UnixMilli(q.Time).UTC().Format("2006-01-02 15:04Z"), q.Call, q.Band, q.Mode, q.RSTSent, q.RSTRcvd)
	}
	if !cfg.Wavelog.Enabled {
		fmt.Println(`Note: "enabled" is false in the wavelog section, so the display won't use it yet.`)
	}
	return 0
}
