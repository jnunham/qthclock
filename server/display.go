package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"qthclock/internal/spots"
)

// displaySettings holds the display layout/filters chosen in the Settings
// drawer. They live on the server, not in one browser, so you can change the
// wall monitor from your phone and every open screen updates at once.
// The server treats the JSON as opaque; the web page owns its shape.
type displaySettings struct {
	mu   sync.Mutex
	path string
	data json.RawMessage
	hub  *spots.Hub
}

func newDisplaySettings(dataDir string, hub *spots.Hub) *displaySettings {
	d := &displaySettings{path: filepath.Join(dataDir, "display.json"), hub: hub}
	if b, err := os.ReadFile(d.path); err == nil && json.Valid(b) {
		d.data = b
		hub.SetState("settings", d.data)
	}
	return d
}

func (d *displaySettings) get(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	b := d.data
	d.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if b == nil {
		b = []byte("null")
	}
	w.Write(b)
}

func (d *displaySettings) put(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil || !json.Valid(b) {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	d.mu.Lock()
	d.data = b
	os.MkdirAll(filepath.Dir(d.path), 0o755)
	err = os.WriteFile(d.path, b, 0o644)
	d.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	d.hub.SetState("settings", json.RawMessage(b))
	w.WriteHeader(http.StatusNoContent)
}
