package main

import "testing"

func TestValidateStation(t *testing.T) {
	ok := map[[2]string][2]string{
		{"k1abc", "fn31pr"}: {"K1ABC", "FN31pr"},
		{"VE3XYZ", "FN03"}:  {"VE3XYZ", "FN03"},
		{"2E0ABC", "IO91"}:  {"2E0ABC", "IO91"},
		{"W1AW/7", "DM42"}:  {"W1AW/7", "DM42"},
	}
	for in, want := range ok {
		c, g, err := validateStation(in[0], in[1])
		if err != nil || c != want[0] || g != want[1] {
			t.Errorf("%v -> %q %q %v", in, c, g, err)
		}
	}
	for _, bad := range [][2]string{{"", "FN31"}, {"HELLO", "FN31"}, {"K1ABC", "ZZ99"}, {"K1ABC", "FN3"}} {
		if _, _, err := validateStation(bad[0], bad[1]); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}
