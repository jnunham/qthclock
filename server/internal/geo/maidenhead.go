// Package geo turns grid squares and callsigns into map positions.
package geo

import (
	"math"
	"strings"
)

// GridToLatLon returns the centre of a Maidenhead locator (2, 4, 6 or 8
// characters). ok is false for anything that isn't a valid locator.
func GridToLatLon(grid string) (lat, lon float64, ok bool) {
	g := strings.ToUpper(strings.TrimSpace(grid))
	if len(g) < 2 || len(g)%2 != 0 || len(g) > 8 {
		return 0, 0, false
	}
	if g[0] < 'A' || g[0] > 'R' || g[1] < 'A' || g[1] > 'R' {
		return 0, 0, false
	}
	lon = float64(g[0]-'A')*20 - 180
	lat = float64(g[1]-'A')*10 - 90
	lonW, latH := 20.0, 10.0
	if len(g) >= 4 {
		if g[2] < '0' || g[2] > '9' || g[3] < '0' || g[3] > '9' {
			return 0, 0, false
		}
		lon += float64(g[2]-'0') * 2
		lat += float64(g[3]-'0') * 1
		lonW, latH = 2, 1
	}
	if len(g) >= 6 {
		if g[4] < 'A' || g[4] > 'X' || g[5] < 'A' || g[5] > 'X' {
			return 0, 0, false
		}
		lon += float64(g[4]-'A') * (2.0 / 24)
		lat += float64(g[5]-'A') * (1.0 / 24)
		lonW, latH = 2.0/24, 1.0/24
	}
	if len(g) == 8 {
		if g[6] < '0' || g[6] > '9' || g[7] < '0' || g[7] > '9' {
			return 0, 0, false
		}
		lon += float64(g[6]-'0') * (2.0 / 240)
		lat += float64(g[7]-'0') * (1.0 / 240)
		lonW, latH = 2.0/240, 1.0/240
	}
	return lat + latH/2, lon + lonW/2, true
}

// DistanceKm is the great-circle distance between two points.
func DistanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = math.Pi / 180
	a := math.Pow(math.Sin((lat2-lat1)*r/2), 2) +
		math.Cos(lat1*r)*math.Cos(lat2*r)*math.Pow(math.Sin((lon2-lon1)*r/2), 2)
	return 2 * 6371 * math.Asin(math.Sqrt(a))
}

// CallOf returns the station's own callsign from a decorated call:
// "W1AW/P" -> "W1AW", "VP2E/W1AW" -> "W1AW", "W3LPL-#" -> "W3LPL".
func CallOf(call string) string {
	call = strings.ToUpper(strings.TrimSpace(call))
	if i := strings.Index(call, "-"); i > 0 {
		call = call[:i]
	}
	best := ""
	for _, p := range strings.Split(call, "/") {
		if len(p) > len(best) {
			best = p
		}
	}
	return best
}
