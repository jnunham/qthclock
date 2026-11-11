package sources

import (
	"qthclock/internal/geo"
	"qthclock/internal/spots"
)

// Relevance decides whether a spot matters to *this* operator, tags it, and
// drops everything else. This is what keeps QTHClock about your station
// instead of a world-wide spot firehose.
type Relevance struct {
	Call     string  // my callsign
	Lat, Lon float64 // my QTH
	HasQTH   bool
	NearKm   float64 // spotters within this distance count as "near me"
}

// Tag returns the spot with Rel/Dist filled in, and false if it should be dropped.
func (r Relevance) Tag(s spots.Spot) (spots.Spot, bool) {
	me := geo.CallOf(r.Call)
	switch {
	case me != "" && geo.CallOf(s.DX) == me:
		s.Rel = "me"
		if r.HasQTH && s.DELat != nil {
			d := geo.DistanceKm(r.Lat, r.Lon, *s.DELat, *s.DELon)
			s.Dist = &d
		}
		return s, true
	case me != "" && geo.CallOf(s.DE) == me:
		s.Rel = "here"
		if r.HasQTH && s.DXLat != nil {
			d := geo.DistanceKm(r.Lat, r.Lon, *s.DXLat, *s.DXLon)
			s.Dist = &d
		}
		return s, true
	case r.HasQTH && s.DELat != nil:
		if geo.DistanceKm(r.Lat, r.Lon, *s.DELat, *s.DELon) > r.NearKm {
			return s, false
		}
		s.Rel = "near"
		if s.DXLat != nil {
			d := geo.DistanceKm(r.Lat, r.Lon, *s.DXLat, *s.DXLon)
			s.Dist = &d
		}
		return s, true
	}
	return s, false
}
