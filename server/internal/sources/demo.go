package sources

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"qthclock/internal/geo"
	"qthclock/internal/logbook"
	"qthclock/internal/spots"
)

// Demo generates plausible fake traffic around *your* station so you can work
// on the UI offline: stations hearing you, stations you hear, and DX spotted
// by skimmers near you.
type Demo struct {
	Call string
	Grid string
	Pub  func(spots.Spot)
	Rate int // spots per second

	OnStatus func(logbook.Working)
	OnLogged func(logbook.QSO)

	mu   sync.Mutex
	band string // band the demo radio is on; "who hears me" favours it
}

var demoStations = []struct{ call, grid, country, cont string }{
	{"K1TTT", "FN32", "United States", "NA"}, {"W3LPL", "FM19", "United States", "NA"}, {"N6TV", "CM97", "United States", "NA"}, {"VE7CC", "CN89", "Canada", "NA"}, {"KH6LC", "BL10", "Hawaii", "OC"},
	{"JA1YRL", "PM95", "Japan", "AS"}, {"VK2GOM", "QF56", "Australia", "OC"}, {"ZL2IFB", "RE78", "New Zealand", "OC"}, {"DL8LAS", "JO53", "Fed. Rep. of Germany", "EU"}, {"G4ZFE", "IO91", "England", "EU"},
	{"EA8RM", "IL18", "Canary Islands", "AF"}, {"PY2PLL", "GG66", "Brazil", "SA"}, {"LU4FPZ", "FF97", "Argentina", "SA"}, {"ZS6RO", "KG44", "South Africa", "AF"}, {"5Z4B", "KI88", "Kenya", "AF"},
	{"A65BP", "LL75", "United Arab Emirates", "AS"}, {"VU2PTT", "MK82", "India", "AS"}, {"BG4WDT", "PM01", "China", "AS"}, {"HS0ZGQ", "OK03", "Thailand", "AS"}, {"9V1RM", "OJ11", "Singapore", "AS"},
	{"UA9OA", "NO14", "Asiatic Russia", "AS"}, {"RA0FF", "QN16", "Asiatic Russia", "AS"}, {"OH6BG", "KP02", "Finland", "EU"}, {"TF3ML", "HP94", "Iceland", "EU"}, {"KL7SB", "BP51", "Alaska", "NA"},
	{"XE1H", "EK09", "Mexico", "NA"}, {"CO8LY", "FL20", "Cuba", "NA"}, {"VP8NO", "GD18", "Falkland Islands", "SA"}, {"FK8HA", "RG37", "New Caledonia", "OC"}, {"3B8CW", "LG89", "Mauritius", "AF"},
}

// Skimmers in eastern North America, so "near me" works for a US default grid.
var demoSkimmers = []struct{ call, grid string }{
	{"W3LPL", "FM19"}, {"K1TTT", "FN32"}, {"N2QT", "FN13"}, {"KM3T", "FN42"}, {"VE3EID", "FN03"}, {"K4PP", "EM73"},
}

var demoBands = []struct {
	band, mode string
	f          float64
	weight     int
}{
	{"20m", "FT8", 14074, 8}, {"40m", "FT8", 7074, 5}, {"15m", "FT8", 21074, 5}, {"10m", "FT8", 28074, 3},
	{"20m", "CW", 14025, 3}, {"40m", "CW", 7020, 2}, {"17m", "FT8", 18100, 3}, {"30m", "FT8", 10136, 3},
	{"80m", "FT8", 3573, 2}, {"12m", "FT8", 24915, 1},
}

func (d *Demo) Run(ctx context.Context) {
	if d.Rate <= 0 {
		d.Rate = 4
	}
	if d.Call == "" {
		d.Call = "N0CALL"
	}
	if d.Grid == "" {
		d.Grid = "FN31"
	}
	total := 0
	for _, b := range demoBands {
		total += b.weight
	}
	go d.qsoLoop(ctx)
	tick := time.NewTicker(time.Second / time.Duration(d.Rate))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		r := rand.Intn(total)
		b := demoBands[0]
		for _, x := range demoBands {
			if r < x.weight {
				b = x
				break
			}
			r -= x.weight
		}
		other := demoStations[rand.Intn(len(demoStations))]
		s := spots.Spot{FreqKHz: b.f + rand.Float64()*2.5, Band: b.band, Mode: b.mode, SNR: spots.I(rand.Intn(40) - 22)}
		switch k := rand.Intn(10); {
		case k < 4: // someone hears me, mostly on the band the radio is on
			s.Source, s.DX, s.DXGrid, s.DE, s.DEGrid = "pskr", d.Call, d.Grid, other.call, other.grid
			d.mu.Lock()
			cur := d.band
			d.mu.Unlock()
			for _, x := range demoBands {
				if x.band == cur && x.mode == "FT8" && rand.Intn(3) > 0 {
					s.Band, s.Mode, s.FreqKHz = x.band, x.mode, x.f+rand.Float64()*2.5
				}
			}
			if b.mode == "CW" {
				s.Source = "rbn"
			}
		case k < 7: // I hear someone (my WSJT-X)
			s.Source, s.DX, s.DXGrid, s.DE, s.DEGrid = "wsjtx", other.call, other.grid, d.Call, d.Grid
			s.Mode = "FT8"
		default: // DX spotted near me
			sk := demoSkimmers[rand.Intn(len(demoSkimmers))]
			s.Source, s.DX, s.DXGrid, s.DE, s.DEGrid = "rbn", other.call, "", sk.call, sk.grid
			if rand.Intn(3) == 0 {
				s.Source, s.Mode, s.FreqKHz, s.SNR = "cluster", "SSB", b.f+180+rand.Float64()*60, nil
			}
			s.DXCountry, s.DXCont = other.country, other.cont
			if la, lo, ok := geo.GridToLatLon(other.grid); ok {
				s.DXLat, s.DXLon = spots.F(la), spots.F(lo)
			}
		}
		for _, p := range []struct {
			call, grid string
			lat, lon   **float64
		}{{s.DX, s.DXGrid, &s.DXLat, &s.DXLon}, {s.DE, s.DEGrid, &s.DELat, &s.DELon}} {
			if *p.lat == nil {
				if la, lo, ok := geo.GridToLatLon(p.grid); ok {
					if p.call != d.Call { // spread other stations out a little; keep my QTH exact
						la, lo = la+rand.Float64()-0.5, lo+rand.Float64()*2-1
					}
					*p.lat, *p.lon = spots.F(la), spots.F(lo)
				}
			}
		}
		d.Pub(s)
	}
}

// qsoLoop pretends to work a station every ~40 s: call, alternate TX/RX in
// 15 s FT8 periods, log it, repeat. Seeds a few past QSOs first.
func (d *Demo) qsoLoop(ctx context.Context) {
	if d.OnStatus == nil || d.OnLogged == nil {
		return
	}
	now := time.Now()
	for i := 5; i >= 1; i-- {
		o := demoStations[rand.Intn(len(demoStations))]
		d.OnLogged(logbook.QSO{Call: o.call, Grid: o.grid, Country: o.country, Time: now.Add(-time.Duration(i*4) * time.Minute).UnixMilli(),
			Band: "20m", Mode: "FT8", RSTSent: snrStr(), RSTRcvd: snrStr(), Source: "wsjtx"})
	}
	// The demo radio changes band every few QSOs, so the display's
	// follow-the-radio behaviour can be seen.
	dials := []struct {
		band string
		f    float64
	}{{"20m", 14074}, {"40m", 7074}, {"15m", 21074}, {"17m", 18100}}
	for n := 0; ; n++ {
		dial := dials[(n/3)%len(dials)]
		d.mu.Lock()
		d.band = dial.band
		d.mu.Unlock()
		o := demoStations[rand.Intn(len(demoStations))]
		start := time.Now()
		for p := 0; p < 4; p++ {
			w := logbook.Working{Call: o.call, Grid: o.grid, FreqKHz: dial.f, Band: dial.band, Mode: "FT8", Report: snrStr(), TxEnabled: true,
				Transmitting: p%2 == 0, Updated: time.Now().UnixMilli()}
			if la, lo, ok := geo.GridToLatLon(o.grid); ok {
				w.Lat, w.Lon = spots.F(la), spots.F(lo)
			}
			d.OnStatus(w)
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
			}
		}
		d.OnLogged(logbook.QSO{Call: o.call, Grid: o.grid, Country: o.country, Time: start.UnixMilli(), Band: dial.band, Mode: "FT8",
			RSTSent: snrStr(), RSTRcvd: snrStr(), Source: "wsjtx"})
		d.OnStatus(logbook.Working{FreqKHz: dial.f, Band: dial.band, Mode: "FT8", Updated: time.Now().UnixMilli()})
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func snrStr() string { return fmt.Sprintf("%+03d", rand.Intn(30)-22) }
