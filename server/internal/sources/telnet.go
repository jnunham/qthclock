package sources

import (
	"bytes"
	"context"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"qthclock/internal/spots"
)

// Telnet reads "DX de ..." lines from a DX cluster or the Reverse Beacon
// Network (telnet.reversebeacon.net:7000 for CW/RTTY, :7001 for FT8/FT4).
type Telnet struct {
	Name    string // "rbn" or "cluster" (also used as the spot source tag)
	Addr    string
	Call    string
	Pub     func(spots.Spot)
	Locator Locator
}

var (
	dxLine     = regexp.MustCompile(`(?i)^DX de\s+([A-Z0-9/#\-]+):?\s+([0-9.]+)\s+([A-Z0-9/]+)\s+(.*?)\s*(\d{4})Z`)
	snrRe      = regexp.MustCompile(`(-?\d+)\s*dB`)
	wpmRe      = regexp.MustCompile(`(\d+)\s*WPM`)
	knownModes = map[string]bool{"CW": true, "RTTY": true, "FT8": true, "FT4": true, "PSK31": true, "PSK63": true,
		"SSB": true, "USB": true, "LSB": true, "AM": true, "FM": true, "JS8": true, "MSK144": true, "Q65": true}
)

func (t *Telnet) Run(ctx context.Context) {
	retry(ctx, t.Name, func(ctx context.Context) error {
		conn, err := net.DialTimeout("tcp", t.Addr, 15*time.Second)
		if err != nil {
			return err
		}
		defer conn.Close()
		go func() { <-ctx.Done(); conn.Close() }()

		var buf []byte
		loggedIn := false
		chunk := make([]byte, 8192)
		for {
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
			n, err := conn.Read(chunk)
			if err != nil {
				return err
			}
			buf = append(buf, stripTelnet(chunk[:n])...)
			if !loggedIn {
				low := bytes.ToLower(buf)
				if bytes.Contains(low, []byte("call")) || bytes.Contains(low, []byte("login")) {
					conn.Write([]byte(strings.ToUpper(t.Call) + "\r\n"))
					loggedIn = true
				}
			}
			for {
				i := bytes.IndexByte(buf, '\n')
				if i < 0 {
					break
				}
				line := strings.TrimRight(string(buf[:i]), "\r\x07 ")
				buf = buf[i+1:]
				if s, ok := t.parse(line); ok {
					t.Locator.Fill(&s)
					t.Pub(s)
				}
			}
			if len(buf) > 64<<10 { // no newline in 64 KB: garbage, drop it
				buf = buf[:0]
			}
		}
	})
}

func (t *Telnet) parse(line string) (spots.Spot, bool) {
	m := dxLine.FindStringSubmatch(line)
	if m == nil {
		return spots.Spot{}, false
	}
	f, err := strconv.ParseFloat(m[2], 64)
	if err != nil {
		return spots.Spot{}, false
	}
	spotter := strings.ToUpper(m[1])
	if i := strings.Index(spotter, "-"); i > 0 {
		spotter = spotter[:i] // "W3LPL-#" -> "W3LPL"
	}
	comment := strings.Join(strings.Fields(m[4]), " ")
	s := spots.Spot{
		Source:  t.Name,
		Time:    hhmmToday(m[5]),
		FreqKHz: f,
		DX:      strings.ToUpper(m[3]),
		DE:      spotter,
		Comment: comment,
	}
	if fields := strings.Fields(comment); len(fields) > 0 && knownModes[strings.ToUpper(fields[0])] {
		s.Mode = strings.ToUpper(fields[0])
	}
	if sm := snrRe.FindStringSubmatch(comment); sm != nil {
		v, _ := strconv.Atoi(sm[1])
		s.SNR = spots.I(v)
	}
	if wm := wpmRe.FindStringSubmatch(comment); wm != nil {
		v, _ := strconv.Atoi(wm[1])
		s.WPM = spots.I(v)
	}
	if s.Mode == "" {
		s.Mode = guessMode(f)
	}
	return s, true
}

// hhmmToday converts the spot's HHMM UTC to a timestamp. Live spots are
// essentially "now", so we use the current time unless the clock looks off.
func hhmmToday(hhmm string) int64 {
	now := time.Now().UTC()
	h, _ := strconv.Atoi(hhmm[:2])
	mi, _ := strconv.Atoi(hhmm[2:])
	t := time.Date(now.Year(), now.Month(), now.Day(), h, mi, 0, 0, time.UTC)
	if t.After(now.Add(time.Minute)) {
		t = t.Add(-24 * time.Hour)
	}
	if now.Sub(t) < 2*time.Minute {
		return now.UnixMilli()
	}
	return t.UnixMilli()
}

// guessMode infers a mode from frequency for cluster spots that don't say.
func guessMode(kHz float64) string {
	ft8 := []float64{1840, 3573, 5357, 7074, 10136, 14074, 18100, 21074, 24915, 28074, 50313}
	for _, c := range ft8 {
		if kHz >= c && kHz <= c+3 {
			return "FT8"
		}
	}
	cwTop := map[string]float64{"160m": 1840, "80m": 3600, "40m": 7040, "30m": 10150, "20m": 14070,
		"17m": 18095, "15m": 21070, "12m": 24915, "10m": 28070, "6m": 50100}
	if top, ok := cwTop[spots.BandForKHz(kHz)]; ok && kHz < top {
		return "CW"
	}
	if spots.BandForKHz(kHz) != "" {
		return "SSB"
	}
	return ""
}

// stripTelnet removes IAC negotiation sequences.
func stripTelnet(b []byte) []byte {
	out := b[:0:0]
	for i := 0; i < len(b); i++ {
		if b[i] == 0xFF && i+1 < len(b) {
			switch b[i+1] {
			case 0xFB, 0xFC, 0xFD, 0xFE: // WILL WONT DO DONT + option
				i += 2
			default:
				i++
			}
			continue
		}
		out = append(out, b[i])
	}
	return out
}
