package geo

import (
	"math"
	"strings"
	"testing"
)

func TestGrid(t *testing.T) {
	lat, lon, ok := GridToLatLon("FN31pr")
	if !ok || math.Abs(lat-41.729) > 0.05 || math.Abs(lon-(-72.708)) > 0.05 {
		t.Fatalf("FN31pr -> %v %v %v", lat, lon, ok)
	}
	if _, _, ok := GridToLatLon("ZZ99"); ok {
		t.Fatal("accepted invalid grid")
	}
}

const sample = `United States:            05:  08:  NA:   37.53:    91.67:     5.0:  K:
    AA,AB,K,N,W,=K1ABC(4)[7];
Canada:                   05:  09:  NA:   44.35:    78.75:     5.0:  VE:
    CF,VE,VA,VE7<49.3/123.1>;
Japan:                    25:  45:  AS:   36.40:  -138.38:    -9.0:  JA:
    JA,JE,JR;
`

func TestCTY(t *testing.T) {
	c := NewCTY()
	if err := c.Parse(strings.NewReader(sample)); err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{"W1AW": "United States", "JA1YRL": "Japan", "VE3XYZ": "Canada",
		"W1AW/VE3": "Canada", "JA1ABC/P": "Japan", "W3LPL-#": "United States"}
	for call, want := range cases {
		e, _, _, ok := c.Lookup(call)
		if !ok || e.Name != want {
			t.Errorf("%s -> %v, want %s", call, e, want)
		}
	}
	_, la, lo, _ := c.Lookup("VE7CC")
	if la != 49.3 || lo != -123.1 {
		t.Errorf("VE7 override -> %v %v", la, lo)
	}
	_, _, lo, _ = c.Lookup("JA1YRL")
	if lo < 0 {
		t.Errorf("Japan lon should be east-positive, got %v", lo)
	}
}
