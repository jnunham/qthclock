package geo

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// The map is drawn from Natural Earth (public domain) 1:50m layers. They're
// downloaded once on first start, packed into a compact file (coordinates in
// hundredths of a degree, about 1 km) and served to the screens.
const basemapVersion = 2

var basemapLayers = []struct{ key, file string }{
	{"land", "ne_50m_land.geojson"},
	{"lakes", "ne_50m_lakes.geojson"},
	{"borders", "ne_50m_admin_0_boundary_lines_land.geojson"},
	{"states", "ne_50m_admin_1_states_provinces_lines.geojson"},
}

var basemapMirrors = []string{
	"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/",
	"https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/",
}

// Basemap is what the screens receive: each line or ring is a flat list of
// lon,lat pairs ×100 as integers.
type Basemap struct {
	V       int       `json:"v"`
	Land    [][][]int `json:"land"`  // polygons: rings
	Lakes   [][][]int `json:"lakes"` // polygons: rings
	Borders [][]int   `json:"borders"`
	States  [][]int   `json:"states"`
}

// EnsureBasemap builds path if it's missing or from an older version.
func EnsureBasemap(path string) error {
	if b, err := os.ReadFile(path); err == nil {
		var v struct{ V int }
		if json.Unmarshal(b, &v) == nil && v.V == basemapVersion {
			return nil
		}
	}
	log.Printf("map: downloading Natural Earth map outlines (about 4 MB, one time)...")
	bm := Basemap{V: basemapVersion}
	for _, l := range basemapLayers {
		raw, err := fetchLayer(l.file)
		if err != nil {
			return fmt.Errorf("%s: %w", l.file, err)
		}
		polys, lines, err := ParseGeoJSON(raw)
		if err != nil {
			return fmt.Errorf("%s: %w", l.file, err)
		}
		switch l.key {
		case "land":
			bm.Land = polys
		case "lakes":
			bm.Lakes = polys
		case "borders":
			bm.Borders = lines
		case "states":
			bm.States = lines
		}
	}
	out, err := json.Marshal(bm)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func fetchLayer(file string) ([]byte, error) {
	// Offline install: put the Natural Earth .geojson files in a folder and
	// set QTHCLOCK_NATURAL_EARTH to it.
	if dir := os.Getenv("QTHCLOCK_NATURAL_EARTH"); dir != "" {
		return os.ReadFile(filepath.Join(dir, file))
	}
	client := &http.Client{Timeout: 2 * time.Minute}
	var lastErr error
	for _, m := range basemapMirrors {
		req, _ := http.NewRequest("GET", m+file, nil)
		req.Header.Set("User-Agent", "QTHClock/1.0 (+https://github.com/jnunham/qthclock)")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 {
			lastErr = fmt.Errorf("%s: HTTP %d %v", m, resp.StatusCode, err)
			continue
		}
		return b, nil
	}
	return nil, lastErr
}

// ParseGeoJSON returns the polygons (as rings) and lines in a
// FeatureCollection, packed as integer hundredths of a degree with repeated
// points dropped.
func ParseGeoJSON(b []byte) (polys [][][]int, lines [][]int, err error) {
	var fc struct {
		Features []struct {
			Geometry *struct {
				Type        string          `json:"type"`
				Coordinates json.RawMessage `json:"coordinates"`
			} `json:"geometry"`
		} `json:"features"`
	}
	if err := json.Unmarshal(b, &fc); err != nil {
		return nil, nil, err
	}
	for _, f := range fc.Features {
		g := f.Geometry
		if g == nil {
			continue
		}
		switch g.Type {
		case "Polygon":
			var c [][][2]float64
			if json.Unmarshal(g.Coordinates, &c) == nil {
				polys = append(polys, packRings(c))
			}
		case "MultiPolygon":
			var c [][][][2]float64
			if json.Unmarshal(g.Coordinates, &c) == nil {
				for _, p := range c {
					polys = append(polys, packRings(p))
				}
			}
		case "LineString":
			var c [][2]float64
			if json.Unmarshal(g.Coordinates, &c) == nil {
				lines = append(lines, pack(c))
			}
		case "MultiLineString":
			var c [][][2]float64
			if json.Unmarshal(g.Coordinates, &c) == nil {
				for _, l := range c {
					lines = append(lines, pack(l))
				}
			}
		}
	}
	return polys, lines, nil
}

func packRings(rings [][][2]float64) [][]int {
	out := make([][]int, 0, len(rings))
	for _, r := range rings {
		if p := pack(r); len(p) >= 6 {
			out = append(out, p)
		}
	}
	return out
}

func pack(pts [][2]float64) []int {
	out := make([]int, 0, len(pts)*2)
	px, py := math.MaxInt32, math.MaxInt32
	for _, p := range pts {
		x, y := int(math.Round(p[0]*100)), int(math.Round(p[1]*100))
		if x == px && y == py {
			continue
		}
		out = append(out, x, y)
		px, py = x, y
	}
	return out
}
