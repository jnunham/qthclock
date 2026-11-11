// Package logbook keeps the operator's recent QSOs from Wavelog.
package logbook

import (
	"sort"
	"strings"
	"sync"
	"time"
)

type QSO struct {
	Call    string   `json:"call"`
	Time    int64    `json:"t"` // unix ms (QSO start)
	Band    string   `json:"b,omitempty"`
	Mode    string   `json:"m,omitempty"`
	RSTSent string   `json:"sent,omitempty"`
	RSTRcvd string   `json:"rcvd,omitempty"`
	Grid    string   `json:"grid,omitempty"`
	Name    string   `json:"name,omitempty"`
	Country string   `json:"country,omitempty"`
	Source  string   `json:"src"`
	Lat     *float64 `json:"lat,omitempty"` // from the grid, or the callsign's country
	Lon     *float64 `json:"lon,omitempty"`
}

// Recent holds the last few QSOs, newest first, merging duplicates between
// sources (WSJT-X reports a QSO the moment it's logged; Wavelog a bit later).
type Recent struct {
	mu      sync.Mutex
	list    []QSO
	max     int
	Publish func([]QSO)
	Locate  func(*QSO) // optional: fill Lat/Lon
}

func NewRecent(max int, publish func([]QSO)) *Recent {
	return &Recent{max: max, Publish: publish}
}

func (r *Recent) Add(qs ...QSO) {
	r.mu.Lock()
	for _, q := range qs {
		q.Call = strings.ToUpper(q.Call)
		if r.Locate != nil && q.Lat == nil {
			r.Locate(&q)
		}
		q.Band = strings.ToLower(q.Band)
		merged := false
		for i, e := range r.list {
			if e.Call == q.Call && e.Band == q.Band && abs(e.Time-q.Time) < int64(30*time.Minute/time.Millisecond) {
				if q.Source == "wavelog" { // the log is authoritative; keep WSJT-X's exact time if Wavelog lacks seconds
					q.Time = e.Time
					r.list[i] = fill(q, e)
				} else {
					r.list[i] = fill(e, q)
				}
				merged = true
				break
			}
		}
		if !merged {
			r.list = append(r.list, q)
		}
	}
	sort.Slice(r.list, func(i, j int) bool { return r.list[i].Time > r.list[j].Time })
	if len(r.list) > r.max {
		r.list = r.list[:r.max]
	}
	out := append([]QSO(nil), r.list...)
	r.mu.Unlock()
	if r.Publish != nil {
		r.Publish(out)
	}
}

// fill copies empty fields of a from b.
func fill(a, b QSO) QSO {
	if a.Grid == "" {
		a.Grid = b.Grid
	}
	if a.Name == "" {
		a.Name = b.Name
	}
	if a.Country == "" {
		a.Country = b.Country
	}
	if a.RSTSent == "" {
		a.RSTSent = b.RSTSent
	}
	if a.RSTRcvd == "" {
		a.RSTRcvd = b.RSTRcvd
	}
	return a
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
