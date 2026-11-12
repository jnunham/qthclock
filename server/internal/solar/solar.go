// Package solar polls NOAA SWPC for space weather: solar flux, X-ray class,
// planetary K and A indices, hemispheric power, and the aurora oval image.
//
// Being a good API citizen:
//   - one server fetches for every screen; browsers never call NOAA
//   - each item is polled no faster than NOAA updates it (see intervals)
//   - conditional requests (ETag / If-Modified-Since): unchanged files cost
//     NOAA a 304 with no body
//   - an identifying User-Agent, and failures back off instead of retrying
package solar

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	base      = "https://services.swpc.noaa.gov/"
	userAgent = "QTHClock/1.0 (amateur radio shack display; +https://github.com/jnunham/qthclock)"
)

// KpPoint is one 3-hour planetary Kp value.
type KpPoint struct {
	T  int64   `json:"t"` // start of the 3-hour period, unix ms
	Kp float64 `json:"kp"`
}

type Report struct {
	SFI      *float64  `json:"sfi,omitempty"`
	Kp       *float64  `json:"kp,omitempty"`      // latest estimated Kp (1-minute)
	KpMax24  *float64  `json:"kpMax24,omitempty"` // highest 3-hour Kp in the last 24 h
	A        *float64  `json:"a,omitempty"`       // estimated planetary A for today (UTC)
	HPINorth *float64  `json:"hpiN,omitempty"`    // hemispheric power, GW
	HPISouth *float64  `json:"hpiS,omitempty"`
	XRay     string    `json:"xray,omitempty"` // e.g. "C2.4"
	XRayRaw  *float64  `json:"xrayRaw,omitempty"`
	Kp24     []KpPoint `json:"kp24,omitempty"`   // last 24 h of 3-hour Kp
	Aurora   int64     `json:"aurora,omitempty"` // when the aurora image last changed (cache-buster)
	Updated  int64     `json:"updated"`
}

// item is one NOAA file with its own polling interval.
type item struct {
	name     string
	path     string
	every    time.Duration
	next     time.Time
	failures int
	etag     string
	modified string
	body     []byte
	apply    func(r *Report, body []byte) error
}

// Aurora holds the latest aurora oval image for the hemisphere you're in.
type Aurora struct {
	mu   sync.RWMutex
	img  []byte
	at   time.Time
	path string
}

func (a *Aurora) Get() ([]byte, time.Time) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.img, a.at
}

type Poller struct {
	client *http.Client
	items  []*item
	Aurora *Aurora
}

// NewPoller sets up the feeds. south picks the southern-hemisphere aurora image.
func NewPoller(south bool) *Poller {
	p := &Poller{client: &http.Client{Timeout: 30 * time.Second}, Aurora: &Aurora{}}
	hemi := "north"
	if south {
		hemi = "south"
	}
	p.Aurora.path = "images/animations/ovation/" + hemi + "/latest.jpg"
	p.items = []*item{
		// Daily value: hourly is plenty.
		{name: "sfi", path: "json/f107_cm_flux.json", every: time.Hour, apply: applySFI},
		// 1-minute data; we show it every 10 minutes.
		{name: "kp", path: "json/planetary_k_index_1m.json", every: 10 * time.Minute, apply: applyKpNow},
		// 3-hour values (and running A): changes at most every 3 h, check every 30 min.
		{name: "kp3h", path: "products/noaa-planetary-k-index.json", every: 30 * time.Minute, apply: applyKp3h},
		// 5-minute cadence; every 10 minutes is enough for a display.
		{name: "hpi", path: "text/aurora-nowcast-hemi-power.txt", every: 10 * time.Minute, apply: applyHPI},
		{name: "xray", path: "json/goes/primary/xrays-6-hour.json", every: 10 * time.Minute, apply: applyXray},
		{name: "aurora", path: p.Aurora.path, every: 15 * time.Minute, apply: func(r *Report, b []byte) error {
			// NOAA overwrites this file every few minutes; a download caught
			// mid-write is cut off. Keep the previous image unless this one
			// is a complete JPEG.
			if !completeJPEG(b) {
				return fmt.Errorf("incomplete aurora image (%d bytes); keeping the previous one", len(b))
			}
			p.Aurora.mu.Lock()
			p.Aurora.img, p.Aurora.at = b, time.Now()
			p.Aurora.mu.Unlock()
			r.Aurora = time.Now().UnixMilli()
			return nil
		}},
	}
	return p
}

// Run polls each item when it's due and publishes the merged report when
// anything changed.
func (p *Poller) Run(ctx context.Context, publish func(Report)) {
	var r Report
	for {
		changed := false
		now := time.Now()
		for _, it := range p.items {
			if now.Before(it.next) {
				continue
			}
			fresh, err := p.fetch(ctx, it)
			if err != nil {
				it.failures++
				// Back off on errors: 2, 4, 8 ... up to 60 minutes.
				wait := time.Duration(math.Min(60, math.Pow(2, float64(it.failures)))) * time.Minute
				it.next = now.Add(wait)
				if it.failures <= 3 || it.failures%10 == 0 {
					log.Printf("solar: %s: %v (retrying in %s)", it.name, err, wait)
				}
				continue
			}
			it.failures = 0
			it.next = now.Add(it.every)
			if !fresh {
				continue // 304 Not Modified
			}
			if err := it.apply(&r, it.body); err != nil {
				log.Printf("solar: %s: %v", it.name, err)
				// Bad content (e.g. a half-written file): forget the cache
				// validators and try again in a couple of minutes.
				it.etag, it.modified = "", ""
				it.next = now.Add(2 * time.Minute)
				continue
			}
			changed = true
		}
		if changed {
			r.Updated = time.Now().UnixMilli()
			publish(r)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

// fetch does a conditional GET. fresh is false when NOAA says nothing changed.
func (p *Poller) fetch(ctx context.Context, it *item) (fresh bool, err error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", base+it.path, nil)
	req.Header.Set("User-Agent", userAgent)
	if it.etag != "" {
		req.Header.Set("If-None-Match", it.etag)
	}
	if it.modified != "" {
		req.Header.Set("If-Modified-Since", it.modified)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return false, nil
	}
	if resp.StatusCode != 200 {
		return false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return false, err
	}
	it.etag, it.modified, it.body = resp.Header.Get("ETag"), resp.Header.Get("Last-Modified"), b
	return true, nil
}

// ---- parsers -------------------------------------------------------------

// rows reads either a JSON array of objects or the older "first row is the
// header" array-of-arrays format into maps. NOAA moved several products
// from the second to the first in 2026; we accept both.
func rows(b []byte) ([]map[string]any, error) {
	var objs []map[string]any
	if err := json.Unmarshal(b, &objs); err == nil {
		return objs, nil
	}
	var arr [][]any
	if err := json.Unmarshal(b, &arr); err != nil {
		return nil, err
	}
	if len(arr) < 2 {
		return nil, nil
	}
	var out []map[string]any
	for _, row := range arr[1:] {
		m := map[string]any{}
		for i, k := range arr[0] {
			if ks, ok := k.(string); ok && i < len(row) {
				m[ks] = row[i]
			}
		}
		out = append(out, m)
	}
	return out, nil
}

// num reads a number that may be a JSON number or a quoted string, trying
// several key spellings.
func num(m map[string]any, keys ...string) (float64, bool) {
	for _, k := range keys {
		for mk, v := range m {
			if !strings.EqualFold(mk, k) {
				continue
			}
			switch x := v.(type) {
			case float64:
				return x, true
			case string:
				if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
					return f, true
				}
			}
		}
	}
	return 0, false
}

func timeTag(m map[string]any) (time.Time, bool) {
	s, _ := m["time_tag"].(string)
	for _, layout := range []string{"2006-01-02T15:04:05Z", "2006-01-02T15:04:05", "2006-01-02 15:04:05.000", "2006-01-02 15:04:05", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// latest returns the value of keys from the row with the newest time_tag.
func latest(b []byte, keys ...string) (float64, error) {
	rs, err := rows(b)
	if err != nil {
		return 0, err
	}
	var best time.Time
	var val float64
	found := false
	for _, r := range rs {
		t, ok := timeTag(r)
		v, okv := num(r, keys...)
		if ok && okv && (!found || !t.Before(best)) {
			best, val, found = t, v, true
		}
	}
	if !found {
		return 0, fmt.Errorf("no %v values", keys)
	}
	return val, nil
}

func applySFI(r *Report, b []byte) error {
	v, err := latest(b, "flux")
	if err == nil {
		r.SFI = &v
	}
	return err
}

func applyKpNow(r *Report, b []byte) error {
	v, err := latest(b, "estimated_kp", "kp_index")
	if err == nil {
		v = math.Round(v*100) / 100
		r.Kp = &v
	}
	return err
}

func applyKp3h(r *Report, b []byte) error {
	rs, err := rows(b)
	if err != nil {
		return err
	}
	type pt struct {
		t  time.Time
		kp float64
		a  float64
		ha bool
	}
	var pts []pt
	for _, row := range rs {
		t, ok := timeTag(row)
		kp, okk := num(row, "Kp", "kp_index")
		if !ok || !okk {
			continue
		}
		a, oka := num(row, "a_running", "ap")
		pts = append(pts, pt{t, kp, a, oka})
	}
	if len(pts) == 0 {
		return fmt.Errorf("no Kp values")
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].t.Before(pts[j].t) })
	cut := time.Now().Add(-24 * time.Hour)
	r.Kp24 = nil
	maxKp := -1.0
	for _, p := range pts {
		if p.t.Before(cut.Add(-3 * time.Hour)) {
			continue
		}
		r.Kp24 = append(r.Kp24, KpPoint{T: p.t.UnixMilli(), Kp: p.kp})
		if p.kp > maxKp {
			maxKp = p.kp
		}
	}
	if maxKp >= 0 {
		r.KpMax24 = &maxKp
	}
	// Estimated A for today: the mean of today's 3-hourly ap values.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	sum, n := 0.0, 0
	for _, p := range pts {
		if p.ha && !p.t.Before(today) {
			sum += p.a
			n++
		}
	}
	if n > 0 {
		a := math.Round(sum / float64(n))
		r.A = &a
	}
	return nil
}

// applyHPI reads the last data line of aurora-nowcast-hemi-power.txt:
// "observation_time forecast_time north_GW south_GW".
func applyHPI(r *Report, b []byte) error {
	var last []string
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if f := strings.Fields(line); len(f) >= 4 {
			last = f
		}
	}
	if last == nil {
		return fmt.Errorf("no hemispheric power data")
	}
	n, err1 := strconv.ParseFloat(last[2], 64)
	s, err2 := strconv.ParseFloat(last[3], 64)
	if err1 != nil || err2 != nil {
		return fmt.Errorf("unexpected HPI line %q", strings.Join(last, " "))
	}
	r.HPINorth, r.HPISouth = &n, &s
	return nil
}

func applyXray(r *Report, b []byte) error {
	rs, err := rows(b)
	if err != nil {
		return err
	}
	var best time.Time
	var flux float64
	found := false
	for _, row := range rs {
		if e, _ := row["energy"].(string); e != "0.1-0.8nm" {
			continue
		}
		t, ok := timeTag(row)
		v, okv := num(row, "flux")
		if ok && okv && v > 0 && (!found || !t.Before(best)) {
			best, flux, found = t, v, true
		}
	}
	if !found {
		return fmt.Errorf("no 0.1-0.8nm flux")
	}
	r.XRayRaw = &flux
	r.XRay = xrayClass(flux)
	return nil
}

func xrayClass(flux float64) string {
	classes := []struct {
		c   string
		min float64
	}{{"X", 1e-4}, {"M", 1e-5}, {"C", 1e-6}, {"B", 1e-7}, {"A", 1e-8}}
	for _, k := range classes {
		if flux >= k.min {
			return fmt.Sprintf("%s%.1f", k.c, flux/k.min)
		}
	}
	return "A0.0"
}

// DemoReport is plausible quiet-day data so the panel isn't empty offline.
func DemoReport() Report {
	f := func(v float64) *float64 { return &v }
	now := time.Now().UTC().Truncate(3 * time.Hour)
	var kp []KpPoint
	for i, v := range []float64{1.33, 3, 2.33, 2, 1.67, 0.67, 1.67, 2.33, 1} {
		kp = append(kp, KpPoint{T: now.Add(time.Duration(i-8) * 3 * time.Hour).UnixMilli(), Kp: v})
	}
	return Report{SFI: f(127), Kp: f(1.33), KpMax24: f(3), A: f(11), HPINorth: f(15), HPISouth: f(14),
		XRay: "B7.0", XRayRaw: f(7e-7), Kp24: kp, Updated: time.Now().UnixMilli()}
}

// completeJPEG checks the start-of-image and end-of-image markers.
func completeJPEG(b []byte) bool {
	if len(b) < 2048 || b[0] != 0xFF || b[1] != 0xD8 {
		return false
	}
	// Allow a little trailing padding after the end marker.
	tail := b[len(b)-min(len(b), 64):]
	return bytes.Contains(tail, []byte{0xFF, 0xD9})
}
