package sources

import (
	"encoding/binary"
	"math"
	"testing"

	"qthclock/internal/geo"
	"qthclock/internal/spots"
)

func TestParseDecode(t *testing.T) {
	cases := map[string][2]string{
		"CQ K1ABC FN31":          {"K1ABC", "FN31"},
		"CQ DX K1ABC FN31":       {"K1ABC", "FN31"},
		"CQ POTA W9XYZ EN52":     {"W9XYZ", "EN52"},
		"W9XYZ K1ABC -12":        {"K1ABC", ""},
		"W9XYZ K1ABC RR73":       {"K1ABC", ""},
		"W9XYZ <PJ4/K1ABC> R-05": {"PJ4/K1ABC", ""},
		"TNX 73 GL":              {"", ""},
	}
	for msg, want := range cases {
		c, g := parseDecode(msg)
		if c != want[0] || g != want[1] {
			t.Errorf("%q -> %q %q, want %q %q", msg, c, g, want[0], want[1])
		}
	}
}

func qstr(b []byte, s string) []byte {
	b = binary.BigEndian.AppendUint32(b, uint32(len(s)))
	return append(b, s...)
}

func header(typ uint32) []byte {
	b := binary.BigEndian.AppendUint32(nil, wsjtxMagic)
	b = binary.BigEndian.AppendUint32(b, 2)
	b = binary.BigEndian.AppendUint32(b, typ)
	return qstr(b, "WSJT-X")
}

func TestWSJTXPackets(t *testing.T) {
	var got []spots.Spot
	w := &WSJTX{Call: "N0CALL", Grid: "FN31", Pub: func(s spots.Spot) { got = append(got, s) },
		Locator: Locator{CTY: geo.NewCTY()}, dial: map[string]uint64{}, mode: map[string]string{}}

	st := header(1)
	st = binary.BigEndian.AppendUint64(st, 14074000)
	st = qstr(st, "FT8")
	w.handle(st)

	d := header(2)
	d = append(d, 1)                                         // new
	d = binary.BigEndian.AppendUint32(d, 3600000)            // time
	d = binary.BigEndian.AppendUint32(d, uint32(0xFFFFFFF6)) // snr -10
	d = binary.BigEndian.AppendUint64(d, math.Float64bits(0.2))
	d = binary.BigEndian.AppendUint32(d, 1234) // df
	d = qstr(d, "~")
	d = qstr(d, "CQ JA1YRL PM95")
	w.handle(d)

	if len(got) != 1 {
		t.Fatalf("got %d spots", len(got))
	}
	s := got[0]
	if s.DX != "JA1YRL" || s.DE != "N0CALL" || s.FreqKHz != 14075.234 || *s.SNR != -10 || s.Mode != "FT8" || s.DXLat == nil {
		t.Fatalf("bad spot %+v", s)
	}
}

func TestRelevance(t *testing.T) {
	la, lo, _ := geo.GridToLatLon("FN31")
	r := Relevance{Call: "N0CALL", Lat: la, Lon: lo, HasQTH: true, NearKm: 1500}
	nearLa, nearLo, _ := geo.GridToLatLon("FM19")
	farLa, farLo, _ := geo.GridToLatLon("JO53")

	if s, ok := r.Tag(spots.Spot{DX: "N0CALL/P", DE: "DL1X", DELat: &farLa, DELon: &farLo}); !ok || s.Rel != "me" || s.Dist == nil {
		t.Errorf("heard-me: %+v %v", s, ok)
	}
	if s, ok := r.Tag(spots.Spot{Source: "rbn", DX: "VP8X", DE: "W3LPL", DELat: &nearLa, DELon: &nearLo}); !ok || s.Rel != "near" {
		t.Errorf("near: %+v %v", s, ok)
	}
	if _, ok := r.Tag(spots.Spot{Source: "rbn", DX: "VP8X", DE: "DL1X", DELat: &farLa, DELon: &farLo}); ok {
		t.Error("far spotter should be dropped")
	}
}
