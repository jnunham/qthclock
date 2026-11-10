package sources

import "testing"

func TestParseRBN(t *testing.T) {
	tn := &Telnet{Name: "rbn"}
	s, ok := tn.parse("DX de W3LPL-#:    14025.0  K1ABC          CW    23 dB  25 WPM  CQ      1234Z")
	if !ok {
		t.Fatal("no match")
	}
	if s.DE != "W3LPL" || s.DX != "K1ABC" || s.FreqKHz != 14025.0 || s.Mode != "CW" {
		t.Fatalf("bad parse: %+v", s)
	}
	if s.SNR == nil || *s.SNR != 23 || s.WPM == nil || *s.WPM != 25 {
		t.Fatalf("bad snr/wpm: %+v", s)
	}
}

func TestParseCluster(t *testing.T) {
	tn := &Telnet{Name: "cluster"}
	s, ok := tn.parse("DX de G4ABC:     21295.0  VP8LP        up 5 big signal                 1830Z")
	if !ok {
		t.Fatal("no match")
	}
	if s.DE != "G4ABC" || s.DX != "VP8LP" || s.Mode != "SSB" || s.Comment != "up 5 big signal" {
		t.Fatalf("bad parse: %+v", s)
	}
	if _, ok := tn.parse("To ALL de W1XX: hello"); ok {
		t.Fatal("matched an announcement")
	}
}
