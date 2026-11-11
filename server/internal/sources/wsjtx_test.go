package sources

import (
	"encoding/binary"
	"math"
	"testing"

	"qthclock/internal/geo"
	"qthclock/internal/logbook"
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

func TestWSJTXStatusAndLogged(t *testing.T) {
	var working []logbook.Working
	var logged []logbook.QSO
	w := &WSJTX{Call: "N0CALL", Grid: "FN31", Pub: func(spots.Spot) {}, Locator: Locator{CTY: geo.NewCTY()},
		dial: map[string]uint64{}, mode: map[string]string{},
		OnStatus: func(s logbook.Working) { working = append(working, s) },
		OnLogged: func(q logbook.QSO) { logged = append(logged, q) }}

	st := header(1)
	st = binary.BigEndian.AppendUint64(st, 14074000)
	st = qstr(st, "FT8")
	st = qstr(st, "JA1YRL")  // dx call
	st = qstr(st, "-12")     // report
	st = qstr(st, "FT8")     // tx mode
	st = append(st, 1, 1, 0) // tx enabled, transmitting, decoding
	st = binary.BigEndian.AppendUint32(st, 1500)
	st = binary.BigEndian.AppendUint32(st, 1500)
	st = qstr(st, "N0CALL")
	st = qstr(st, "FN31")
	st = qstr(st, "PM95")
	w.handle(st)
	if len(working) != 1 || working[0].Call != "JA1YRL" || !working[0].Transmitting || working[0].Lat == nil || working[0].FreqKHz != 14074 {
		t.Fatalf("status: %+v", working)
	}
	w.handle(st) // unchanged within 15 s: no duplicate
	if len(working) != 1 {
		t.Fatalf("duplicate status published")
	}

	dt := func(b []byte, unixMs int64) []byte {
		jd := unixMs/86400000 + 2440588
		b = binary.BigEndian.AppendUint64(b, uint64(jd))
		b = binary.BigEndian.AppendUint32(b, uint32(unixMs%86400000))
		return append(b, 1) // UTC
	}
	const on = int64(1794353700000)
	lg := header(5)
	lg = dt(lg, on+60000)
	lg = qstr(lg, "JA1YRL")
	lg = qstr(lg, "PM95")
	lg = binary.BigEndian.AppendUint64(lg, 14075500)
	lg = qstr(lg, "FT8")
	lg = qstr(lg, "-12")
	lg = qstr(lg, "-08")
	lg = qstr(lg, "100")
	lg = qstr(lg, "")
	lg = qstr(lg, "Taro")
	lg = dt(lg, on)
	w.handle(lg)
	if len(logged) != 1 || logged[0].Call != "JA1YRL" || logged[0].Band != "20m" || logged[0].RSTRcvd != "-08" || logged[0].Time != on || logged[0].Name != "Taro" {
		t.Fatalf("logged: %+v", logged)
	}
}
