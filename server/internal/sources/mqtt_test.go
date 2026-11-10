package sources

import (
	"bufio"
	"context"
	"io"
	"net"
	"testing"
	"time"

	"qthclock/internal/geo"
	"qthclock/internal/spots"
)

// fakeBroker accepts one client, acks CONNECT and SUBSCRIBE, then publishes payload.
func fakeBroker(t *testing.T, payload string) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		read := func() byte {
			h, _ := r.ReadByte()
			n, mult := 0, 1
			for {
				b, _ := r.ReadByte()
				n += int(b&0x7f) * mult
				if b&0x80 == 0 {
					break
				}
				mult *= 128
			}
			io.CopyN(io.Discard, r, int64(n))
			return h
		}
		if read() != 0x10 {
			return
		}
		conn.Write([]byte{0x20, 2, 0, 0})
		if read() != 0x82 {
			return
		}
		conn.Write([]byte{0x90, 3, 0, 1, 0})
		var body []byte
		body = appendStr(body, "pskr/filter/v2/20m/FT8/K1ABC/JA1XYZ")
		body = append(body, payload...)
		pkt := append([]byte{0x30}, appendVarint(nil, len(body))...)
		conn.Write(append(pkt, body...))
		time.Sleep(time.Second)
	}()
	return ln.Addr().String()
}

func TestPSKReporterOverMQTT(t *testing.T) {
	addr := fakeBroker(t, `{"sq":1,"f":14075123,"md":"FT8","rp":-12,"t":1700000000,"sc":"k1abc","sl":"FN31pr","rc":"JA1XYZ","rl":"PM95","sa":291,"ra":339,"b":"20m"}`)
	got := make(chan spots.Spot, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	p := &PSKReporter{Addr: addr, Topics: []string{"pskr/filter/v2/+/+/{CALL}/#"}, Call: "k1abc",
		Pub: func(s spots.Spot) { got <- s }, Locator: Locator{CTY: geo.NewCTY()}}
	go p.Run(ctx)
	select {
	case s := <-got:
		if s.DX != "K1ABC" || s.DE != "JA1XYZ" || s.Band != "20m" || s.FreqKHz != 14075.123 || *s.SNR != -12 || s.DXLat == nil || s.DELat == nil {
			t.Fatalf("bad spot %+v", s)
		}
	case <-ctx.Done():
		t.Fatal("no spot received")
	}
}
