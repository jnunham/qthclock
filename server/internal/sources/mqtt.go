package sources

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// A deliberately tiny MQTT 3.1.1 subscriber (QoS 0 only). It covers what a
// read-only spot feed needs and keeps the build free of dependencies. Swap in
// eclipse/paho.mqtt.golang if you ever need TLS, QoS 1/2 or publishing.

type mqttClient struct {
	conn net.Conn
	r    *bufio.Reader
	wmu  sync.Mutex
}

func mqttDial(addr, clientID string, keepalive time.Duration) (*mqttClient, error) {
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return nil, err
	}
	c := &mqttClient{conn: conn, r: bufio.NewReaderSize(conn, 64<<10)}

	var vh []byte
	vh = appendStr(vh, "MQTT")
	vh = append(vh, 4)    // protocol level 3.1.1
	vh = append(vh, 0x02) // clean session
	vh = binary.BigEndian.AppendUint16(vh, uint16(keepalive/time.Second))
	vh = appendStr(vh, clientID)
	if err := c.send(0x10, vh); err != nil {
		conn.Close()
		return nil, err
	}
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	typ, body, err := c.readPacket()
	if err != nil {
		conn.Close()
		return nil, err
	}
	if typ>>4 != 2 || len(body) < 2 || body[1] != 0 {
		conn.Close()
		return nil, fmt.Errorf("mqtt: connect refused (type %d, body %v)", typ>>4, body)
	}
	conn.SetReadDeadline(time.Time{})
	return c, nil
}

func (c *mqttClient) Subscribe(topics []string) error {
	var b []byte
	b = binary.BigEndian.AppendUint16(b, 1) // packet id
	for _, t := range topics {
		b = appendStr(b, t)
		b = append(b, 0) // QoS 0
	}
	return c.send(0x82, b)
}

func (c *mqttClient) Ping() error { return c.send(0xC0, nil) }

func (c *mqttClient) Close() error {
	c.send(0xE0, nil) // DISCONNECT, best effort
	return c.conn.Close()
}

// Run reads packets until error, calling onMsg for each PUBLISH.
func (c *mqttClient) Run(idle time.Duration, onMsg func(topic string, payload []byte)) error {
	for {
		c.conn.SetReadDeadline(time.Now().Add(idle))
		typ, body, err := c.readPacket()
		if err != nil {
			return err
		}
		switch typ >> 4 {
		case 3: // PUBLISH
			if len(body) < 2 {
				continue
			}
			tl := int(binary.BigEndian.Uint16(body))
			if len(body) < 2+tl {
				continue
			}
			topic := string(body[2 : 2+tl])
			p := body[2+tl:]
			if qos := (typ >> 1) & 3; qos > 0 && len(p) >= 2 {
				p = p[2:] // skip packet id
			}
			onMsg(topic, p)
		case 9, 13: // SUBACK, PINGRESP
		default:
		}
	}
}

func (c *mqttClient) send(header byte, body []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	pkt := []byte{header}
	pkt = appendVarint(pkt, len(body))
	pkt = append(pkt, body...)
	c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	_, err := c.conn.Write(pkt)
	return err
}

func (c *mqttClient) readPacket() (byte, []byte, error) {
	h, err := c.r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	n, mult := 0, 1
	for i := 0; ; i++ {
		if i == 4 {
			return 0, nil, errors.New("mqtt: bad remaining length")
		}
		b, err := c.r.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		n += int(b&0x7f) * mult
		if b&0x80 == 0 {
			break
		}
		mult *= 128
	}
	body := make([]byte, n)
	_, err = io.ReadFull(c.r, body)
	return h, body, err
}

func appendStr(b []byte, s string) []byte {
	b = binary.BigEndian.AppendUint16(b, uint16(len(s)))
	return append(b, s...)
}

func appendVarint(b []byte, n int) []byte {
	for {
		d := byte(n % 128)
		n /= 128
		if n > 0 {
			d |= 0x80
		}
		b = append(b, d)
		if n == 0 {
			return b
		}
	}
}
