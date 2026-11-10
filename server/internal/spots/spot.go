// Package spots defines the common spot model and the hub that fans spots
// out to connected displays.
package spots

import "strings"

// Spot is one reception report, normalised across all sources.
//
// "DX" is always the station that was heard (transmitting); "DE" is the
// station that heard it (the spotter / receiver / skimmer).
type Spot struct {
	ID      uint64   `json:"id"`
	Source  string   `json:"src"` // pskr | rbn | cluster | demo
	Time    int64    `json:"t"`   // unix milliseconds
	FreqKHz float64  `json:"f"`   // kHz
	Band    string   `json:"b"`   // "20m" etc, "" if out of band
	Mode    string   `json:"m"`   // FT8, CW, SSB ...
	DX      string   `json:"dx"`  // heard station
	DXGrid  string   `json:"dxg,omitempty"`
	DXLat   *float64 `json:"dxla,omitempty"`
	DXLon   *float64 `json:"dxlo,omitempty"`
	DE      string   `json:"de"` // spotter
	DEGrid  string   `json:"deg,omitempty"`
	DELat   *float64 `json:"dela,omitempty"`
	DELon   *float64 `json:"delo,omitempty"`
	SNR     *int     `json:"snr,omitempty"`
	WPM     *int     `json:"wpm,omitempty"`
	Comment string   `json:"c,omitempty"`

	// Rel says how the spot relates to the operator:
	//   "me"   - someone heard me (DX is my call)
	//   "here" - I heard someone (DE is me, or a decode from my own WSJT-X)
	//   "near" - someone near my QTH heard this DX, so I can probably work it
	Rel  string   `json:"rel"`
	Dist *float64 `json:"km,omitempty"` // for "me"/"near": km from my QTH to the far end
}

type bandEdge struct {
	name   string
	lo, hi float64 // kHz
}

// Edges are generous (ITU region union) so spots from any region land in a band.
var bands = []bandEdge{
	{"2200m", 135.7, 137.8},
	{"630m", 472, 479},
	{"160m", 1800, 2000},
	{"80m", 3500, 4000},
	{"60m", 5250, 5450},
	{"40m", 7000, 7300},
	{"30m", 10100, 10150},
	{"20m", 14000, 14350},
	{"17m", 18068, 18168},
	{"15m", 21000, 21450},
	{"12m", 24890, 24990},
	{"10m", 28000, 29700},
	{"6m", 50000, 54000},
	{"4m", 70000, 71000},
	{"2m", 144000, 148000},
	{"70cm", 420000, 450000},
}

// BandForKHz returns the amateur band name for a frequency, or "".
func BandForKHz(f float64) string {
	for _, b := range bands {
		if f >= b.lo && f <= b.hi {
			return b.name
		}
	}
	return ""
}

// NormalizeBand turns "20M" / "20m" into "20m".
func NormalizeBand(b string) string { return strings.ToLower(strings.TrimSpace(b)) }

// Ptr helpers keep source code tidy.
func F(v float64) *float64 { return &v }
func I(v int) *int         { return &v }
