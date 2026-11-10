package sources

import (
	"context"
	"math/rand"
	"time"

	"qthclock/internal/geo"
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
}

var demoStations = []struct{ call, grid string }{
	{"K1TTT", "FN32"}, {"W3LPL", "FM19"}, {"N6TV", "CM97"}, {"VE7CC", "CN89"}, {"KH6LC", "BL10"},
	{"JA1YRL", "PM95"}, {"VK2GOM", "QF56"}, {"ZL2IFB", "RE78"}, {"DL8LAS", "JO53"}, {"G4ZFE", "IO91"},
	{"EA8RM", "IL18"}, {"PY2PLL", "GG66"}, {"LU4FPZ", "FF97"}, {"ZS6RO", "KG44"}, {"5Z4B", "KI88"},
	{"A65BP", "LL75"}, {"VU2PTT", "MK82"}, {"BG4WDT", "PM01"}, {"HS0ZGQ", "OK03"}, {"9V1RM", "OJ11"},
	{"UA9OA", "NO14"}, {"RA0FF", "QN16"}, {"OH6BG", "KP02"}, {"TF3ML", "HP94"}, {"KL7SB", "BP51"},
	{"XE1H", "EK09"}, {"CO8LY", "FL20"}, {"VP8NO", "GD18"}, {"FK8HA", "RG37"}, {"3B8CW", "LG89"},
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
		case k < 4: // someone hears me
			s.Source, s.DX, s.DXGrid, s.DE, s.DEGrid = "pskr", d.Call, d.Grid, other.call, other.grid
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
