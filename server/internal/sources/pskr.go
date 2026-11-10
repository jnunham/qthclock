package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"qthclock/internal/spots"
)

// PSKReporter streams spots from the public MQTT feed at mqtt.pskreporter.info.
//
// Topic layout: pskr/filter/v2/{band}/{mode}/{tx_call}/{rx_call}/{tx_grid}/{rx_grid}/{tx_dxcc}/{rx_dxcc}
// '+' matches one segment, '#' the rest. See https://www.mqtt.pskreporter.info/
type PSKReporter struct {
	Addr    string   // host:port, plain MQTT (1883)
	Topics  []string // may contain {CALL}
	Call    string
	Pub     func(spots.Spot)
	Locator Locator
}

type pskrMsg struct {
	Seq  int64   `json:"sq"`
	Freq float64 `json:"f"` // Hz
	Mode string  `json:"md"`
	SNR  *int    `json:"rp"`
	T    int64   `json:"t"` // unix seconds
	SC   string  `json:"sc"`
	SL   string  `json:"sl"`
	RC   string  `json:"rc"`
	RL   string  `json:"rl"`
	Band string  `json:"b"`
}

func (p *PSKReporter) Run(ctx context.Context) {
	topics := make([]string, 0, len(p.Topics))
	for _, t := range p.Topics {
		if strings.Contains(t, "{CALL}") {
			if p.Call == "" {
				continue
			}
			t = strings.ReplaceAll(t, "{CALL}", strings.ToUpper(p.Call))
		}
		topics = append(topics, t)
	}
	if len(topics) == 0 {
		log.Printf("pskr: no topics to subscribe (set your callsign or add topics)")
		return
	}
	retry(ctx, "pskr", func(ctx context.Context) error {
		id := fmt.Sprintf("qthclock-%06d", rand.Intn(1_000_000))
		c, err := mqttDial(p.Addr, id, 60*time.Second)
		if err != nil {
			return err
		}
		defer c.Close()
		if err := c.Subscribe(topics); err != nil {
			return err
		}
		log.Printf("pskr: connected to %s, subscribed %v", p.Addr, topics)

		go func() {
			t := time.NewTicker(30 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					c.Close()
					return
				case <-t.C:
					if c.Ping() != nil {
						return
					}
				}
			}
		}()

		return c.Run(90*time.Second, func(_ string, payload []byte) {
			var m pskrMsg
			if json.Unmarshal(payload, &m) != nil || m.SC == "" {
				return
			}
			s := spots.Spot{
				Source:  "pskr",
				Time:    m.T * 1000,
				FreqKHz: m.Freq / 1000,
				Band:    spots.NormalizeBand(m.Band),
				Mode:    strings.ToUpper(m.Mode),
				DX:      strings.ToUpper(m.SC),
				DXGrid:  m.SL,
				DE:      strings.ToUpper(m.RC),
				DEGrid:  m.RL,
				SNR:     m.SNR,
			}
			if s.Time <= 0 || s.Time > time.Now().Add(time.Minute).UnixMilli() {
				s.Time = time.Now().UnixMilli()
			}
			p.Locator.Fill(&s)
			p.Pub(s)
		})
	})
}
