package geo

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Entity is one DXCC entity from cty.dat.
type Entity struct {
	Name      string
	Continent string
	CQ, ITU   int
	Lat, Lon  float64 // lon is east-positive (cty.dat is west-positive; we flip it)
	Prefix    string
}

type match struct {
	ent      *Entity
	lat, lon float64
}

// CTY resolves callsigns to a DXCC entity and approximate position. RBN and
// DX cluster spots carry no grid squares, so this is how they get on the map.
type CTY struct {
	mu     sync.RWMutex
	prefix map[string]match
	exact  map[string]match
	maxLen int
}

func NewCTY() *CTY { return &CTY{prefix: map[string]match{}, exact: map[string]match{}} }

// Loaded reports whether any data has been loaded.
func (c *CTY) Loaded() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.prefix) > 0
}

// LoadOrFetch loads cty.dat from path, downloading it first if it's missing
// or older than a week. Failure to download is not fatal.
func (c *CTY) LoadOrFetch(path, url string) error {
	if st, err := os.Stat(path); (err != nil || time.Since(st.ModTime()) > 7*24*time.Hour) && url != "" {
		if err := download(path, url); err != nil {
			log.Printf("cty: download failed (%v); using existing file if present", err)
		} else {
			log.Printf("cty: downloaded %s", url)
		}
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return c.Parse(f)
}

func download(path, url string) error {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		return err
	}
	out.Close()
	return os.Rename(tmp, path)
}

// Parse reads the classic cty.dat format (https://www.country-files.com/).
func (c *CTY) Parse(r io.Reader) error {
	prefix := map[string]match{}
	exact := map[string]match{}
	maxLen := 0
	var cur *Entity
	var body strings.Builder

	flush := func() {
		if cur == nil {
			return
		}
		for _, tok := range strings.Split(body.String(), ",") {
			tok = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(tok), ";"))
			if tok == "" {
				continue
			}
			m := match{ent: cur, lat: cur.Lat, lon: cur.Lon}
			// Optional <lat/lon> override (lon west-positive).
			if i := strings.Index(tok, "<"); i >= 0 {
				if j := strings.Index(tok[i:], ">"); j > 0 {
					parts := strings.Split(tok[i+1:i+j], "/")
					if len(parts) == 2 {
						la, e1 := strconv.ParseFloat(parts[0], 64)
						lo, e2 := strconv.ParseFloat(parts[1], 64)
						if e1 == nil && e2 == nil {
							m.lat, m.lon = la, -lo
						}
					}
				}
			}
			if i := strings.IndexAny(tok, "([<{~"); i >= 0 {
				tok = tok[:i]
			}
			tok = strings.ToUpper(tok)
			if strings.HasPrefix(tok, "=") {
				exact[tok[1:]] = m
			} else if tok != "" {
				prefix[tok] = m
				if len(tok) > maxLen {
					maxLen = len(tok)
				}
			}
		}
		body.Reset()
		cur = nil
	}

	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		if line[0] != ' ' && line[0] != '\t' { // entity header
			flush()
			f := strings.Split(line, ":")
			if len(f) < 8 {
				continue
			}
			lat, _ := strconv.ParseFloat(strings.TrimSpace(f[4]), 64)
			lon, _ := strconv.ParseFloat(strings.TrimSpace(f[5]), 64)
			cq, _ := strconv.Atoi(strings.TrimSpace(f[1]))
			itu, _ := strconv.Atoi(strings.TrimSpace(f[2]))
			cur = &Entity{
				Name: strings.TrimSpace(f[0]), CQ: cq, ITU: itu,
				Continent: strings.TrimSpace(f[3]),
				Lat:       lat, Lon: -lon,
				Prefix: strings.TrimPrefix(strings.TrimSpace(f[7]), "*"),
			}
			continue
		}
		body.WriteString(line)
		if strings.Contains(line, ";") {
			flush()
		}
	}
	flush()
	if err := sc.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	c.prefix, c.exact, c.maxLen = prefix, exact, maxLen
	c.mu.Unlock()
	log.Printf("cty: loaded %d prefixes, %d exact calls", len(prefix), len(exact))
	return nil
}

var dropSuffix = map[string]bool{"P": true, "M": true, "MM": true, "AM": true, "QRP": true, "A": true, "B": true, "R": true, "LH": true}

// baseCall picks the part of a call that decides its entity:
// "W1AW/P" -> "W1AW", "VP2E/W1AW" -> "VP2E", "W1AW/VE3" -> "VE3".
func baseCall(call string) string {
	call = strings.ToUpper(strings.TrimSpace(call))
	if i := strings.Index(call, "-"); i > 0 { // skimmer SSIDs: "W3LPL-#", "DK8NE-2"
		call = call[:i]
	}
	parts := strings.Split(call, "/")
	keep := parts[:0]
	for _, p := range parts {
		if p != "" && !dropSuffix[p] && !(len(p) == 1 && p[0] >= '0' && p[0] <= '9') {
			keep = append(keep, p)
		}
	}
	switch len(keep) {
	case 0:
		return call
	case 1:
		return keep[0]
	default: // shortest piece is usually the prefix override
		best := keep[0]
		for _, p := range keep[1:] {
			if len(p) < len(best) {
				best = p
			}
		}
		return best
	}
}

// Lookup returns the entity and its position for a callsign.
func (c *CTY) Lookup(call string) (ent *Entity, lat, lon float64, ok bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	full := strings.ToUpper(strings.TrimSpace(call))
	if m, ok := c.exact[full]; ok {
		return m.ent, m.lat, m.lon, true
	}
	b := baseCall(full)
	if m, ok := c.exact[b]; ok {
		return m.ent, m.lat, m.lon, true
	}
	n := len(b)
	if n > c.maxLen {
		n = c.maxLen
	}
	for ; n > 0; n-- {
		if m, ok := c.prefix[b[:n]]; ok {
			return m.ent, m.lat, m.lon, true
		}
	}
	return nil, 0, 0, false
}
