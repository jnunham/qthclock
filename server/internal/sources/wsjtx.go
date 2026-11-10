package sources

import (
	"context"
	"encoding/binary"
	"errors"
	"log"
	"math"
	"net"
	"regexp"
	"strings"
	"sync"

	"qthclock/internal/spots"
)

// WSJTX listens for the UDP messages WSJT-X / JTDX / MSHV send (Settings >
// Reporting > UDP Server, default 127.0.0.1:2237) and turns every decode into
// a spot heard *by you*. Your own receiver becomes a spot source.
//
// Protocol: NetworkMessage.hpp in the WSJT-X source (Qt QDataStream, big-endian).
type WSJTX struct {
	Listen  string // e.g. "127.0.0.1:2237" or ":2237"
	Call    string // my call (the DE of every decode)
	Grid    string
	Pub     func(spots.Spot)
	Locator Locator

	mu   sync.Mutex
	dial map[string]uint64 // client id -> dial frequency Hz, from Status messages
	mode map[string]string
}

const wsjtxMagic = 0xadbccbda

var gridRe = regexp.MustCompile(`^[A-R]{2}[0-9]{2}$`)

func (w *WSJTX) Run(ctx context.Context) {
	w.dial = map[string]uint64{}
	w.mode = map[string]string{}
	retry(ctx, "wsjtx", func(ctx context.Context) error {
		addr, err := net.ResolveUDPAddr("udp", w.Listen)
		if err != nil {
			return err
		}
		conn, err := net.ListenUDP("udp", addr)
		if err != nil {
			return err
		}
		defer conn.Close()
		go func() { <-ctx.Done(); conn.Close() }()
		log.Printf("wsjtx: listening on %s", w.Listen)
		buf := make([]byte, 65536)
		for {
			n, _, err := conn.ReadFromUDP(buf)
			if err != nil {
				return err
			}
			w.handle(buf[:n])
		}
	})
}

func (w *WSJTX) handle(b []byte) {
	r := &qreader{b: b}
	if r.u32() != wsjtxMagic {
		return
	}
	r.u32() // schema
	typ := r.u32()
	id := r.str()
	if r.err != nil {
		return
	}
	switch typ {
	case 1: // Status
		dial := r.u64()
		mode := r.str()
		if r.err == nil {
			w.mu.Lock()
			w.dial[id], w.mode[id] = dial, mode
			w.mu.Unlock()
		}
	case 2: // Decode
		r.boolean() // new
		r.u32()     // time, ms since midnight UTC
		snr := int(int32(r.u32()))
		r.f64() // delta time
		df := r.u32()
		mode := r.str() // single-character mode code, e.g. "~" for FT8
		msg := r.str()
		if r.err != nil {
			return
		}
		w.mu.Lock()
		dial, statusMode := w.dial[id], w.mode[id]
		w.mu.Unlock()
		if statusMode != "" {
			mode = statusMode
		}
		call, grid := parseDecode(msg)
		if call == "" || dial == 0 {
			return
		}
		f := float64(dial+uint64(df)) / 1000
		s := spots.Spot{
			Source: "wsjtx", FreqKHz: f, Mode: strings.ToUpper(mode),
			DX: call, DXGrid: grid, DE: strings.ToUpper(w.Call), DEGrid: w.Grid,
			SNR: spots.I(snr), Comment: msg,
		}
		w.Locator.Fill(&s)
		w.Pub(s)
	}
}

// parseDecode pulls the transmitting station (and its grid, if sent) out of a
// standard message: "CQ K1ABC FN31", "CQ DX K1ABC FN31", "W9XYZ K1ABC -12",
// "W9XYZ K1ABC RR73". The sender is the second callsign in a QSO message.
func parseDecode(msg string) (call, grid string) {
	f := strings.Fields(strings.ToUpper(msg))
	if len(f) < 2 {
		return "", ""
	}
	var rest []string
	if f[0] == "CQ" || f[0] == "QRZ" || f[0] == "DE" {
		rest = f[1:]
		// "CQ DX K1ABC FN31" / "CQ POTA K1ABC FN31": skip a modifier with no digit
		if len(rest) > 1 && !strings.ContainsAny(rest[0], "0123456789") {
			rest = rest[1:]
		}
	} else {
		rest = f[1:]
	}
	if len(rest) == 0 {
		return "", ""
	}
	call = strings.Trim(rest[0], "<>")
	if !looksLikeCall(call) {
		return "", ""
	}
	if len(rest) > 1 && gridRe.MatchString(rest[1]) && rest[1] != "RR73" {
		grid = rest[1]
	}
	return call, grid
}

func looksLikeCall(c string) bool {
	if len(c) < 3 || len(c) > 12 || c == "..." {
		return false
	}
	hasDigit, hasLetter := false, false
	for _, r := range c {
		switch {
		case r >= '0' && r <= '9':
			hasDigit = true
		case r >= 'A' && r <= 'Z':
			hasLetter = true
		case r == '/':
		default:
			return false
		}
	}
	return hasDigit && hasLetter
}

// qreader reads Qt QDataStream values; the first error sticks.
type qreader struct {
	b   []byte
	err error
}

func (r *qreader) take(n int) []byte {
	if r.err != nil || len(r.b) < n {
		r.err = errors.New("short message")
		return make([]byte, n)
	}
	v := r.b[:n]
	r.b = r.b[n:]
	return v
}
func (r *qreader) u32() uint32   { return binary.BigEndian.Uint32(r.take(4)) }
func (r *qreader) u64() uint64   { return binary.BigEndian.Uint64(r.take(8)) }
func (r *qreader) f64() float64  { return math.Float64frombits(r.u64()) }
func (r *qreader) boolean() bool { return r.take(1)[0] != 0 }
func (r *qreader) str() string {
	n := r.u32()
	if n == 0xffffffff || r.err != nil {
		return ""
	}
	return string(r.take(int(n)))
}
