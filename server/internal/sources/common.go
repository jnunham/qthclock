// Package sources connects to live spot feeds and publishes normalised spots.
package sources

import (
	"context"
	"log"
	"time"

	"qthclock/internal/geo"
	"qthclock/internal/spots"
)

// Locator fills in positions: grid square if the spot has one, otherwise the
// DXCC entity centre from cty.dat.
type Locator struct{ CTY *geo.CTY }

func (l Locator) Fill(s *spots.Spot) {
	if s.DXLat == nil {
		if la, lo, ok := geo.GridToLatLon(s.DXGrid); ok {
			s.DXLat, s.DXLon = spots.F(la), spots.F(lo)
		} else if _, la, lo, ok := l.CTY.Lookup(s.DX); ok {
			s.DXLat, s.DXLon = spots.F(la), spots.F(lo)
		}
	}
	if s.DELat == nil {
		if la, lo, ok := geo.GridToLatLon(s.DEGrid); ok {
			s.DELat, s.DELon = spots.F(la), spots.F(lo)
		} else if _, la, lo, ok := l.CTY.Lookup(s.DE); ok {
			s.DELat, s.DELon = spots.F(la), spots.F(lo)
		}
	}
}

// retry runs fn until ctx is cancelled, backing off between failures.
func retry(ctx context.Context, name string, fn func(ctx context.Context) error) {
	backoff := 2 * time.Second
	for {
		start := time.Now()
		err := fn(ctx)
		if ctx.Err() != nil {
			return
		}
		if time.Since(start) > time.Minute {
			backoff = 2 * time.Second // it was healthy for a while; reconnect quickly
		}
		log.Printf("%s: disconnected (%v); retrying in %s", name, err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 2*time.Minute {
			backoff *= 2
		}
	}
}
