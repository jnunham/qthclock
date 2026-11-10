// Package solar polls NOAA SWPC for the numbers hams glance at most:
// solar flux (SFI), planetary K index and the GOES X-ray class.
package solar

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"
)

type Report struct {
	SFI     *float64 `json:"sfi,omitempty"`
	Kp      *float64 `json:"kp,omitempty"`
	XRay    string   `json:"xray,omitempty"`    // e.g. "C2.4"
	XRayRaw *float64 `json:"xrayRaw,omitempty"` // W/m^2
	Updated int64    `json:"updated"`           // unix ms
}

const base = "https://services.swpc.noaa.gov/json/"

var client = &http.Client{Timeout: 20 * time.Second}

// Poll fetches every interval and calls publish with the merged report.
// Each value is fetched independently so one broken feed doesn't blank the rest.
func Poll(ctx context.Context, interval time.Duration, publish func(Report)) {
	var last Report
	for {
		r := last
		if v, err := latestFloat(ctx, base+"f107_cm_flux.json", "flux"); err == nil {
			r.SFI = &v
		} else {
			log.Printf("solar: sfi: %v", err)
		}
		if v, err := latestFloat(ctx, base+"planetary_k_index_1m.json", "estimated_kp", "kp_index"); err == nil {
			v = math.Round(v*100) / 100
			r.Kp = &v
		} else {
			log.Printf("solar: kp: %v", err)
		}
		if v, err := latestXray(ctx); err == nil {
			r.XRayRaw = &v
			r.XRay = xrayClass(v)
		} else {
			log.Printf("solar: xray: %v", err)
		}
		r.Updated = time.Now().UnixMilli()
		last = r
		publish(r)
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func getJSON(ctx context.Context, url string) ([]map[string]any, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "qthclock (amateur radio display)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var rows []map[string]any
	return rows, json.NewDecoder(resp.Body).Decode(&rows)
}

// latestFloat returns the newest non-null value of the first matching key.
// SWPC files differ in whether they're sorted ascending, so we pick by time_tag.
func latestFloat(ctx context.Context, url string, keys ...string) (float64, error) {
	rows, err := getJSON(ctx, url)
	if err != nil {
		return 0, err
	}
	bestT, found := "", false
	var best float64
	for _, row := range rows {
		tt, _ := row["time_tag"].(string)
		for _, k := range keys {
			if v, ok := row[k].(float64); ok {
				if !found || tt >= bestT {
					best, bestT, found = v, tt, true
				}
				break
			}
		}
	}
	if !found {
		return 0, fmt.Errorf("no %v in %s", keys, url)
	}
	return best, nil
}

func latestXray(ctx context.Context) (float64, error) {
	rows, err := getJSON(ctx, base+"goes/primary/xrays-6-hour.json")
	if err != nil {
		return 0, err
	}
	bestT, found := "", false
	var best float64
	for _, row := range rows {
		if e, _ := row["energy"].(string); e != "0.1-0.8nm" {
			continue
		}
		tt, _ := row["time_tag"].(string)
		if v, ok := row["flux"].(float64); ok && v > 0 && tt >= bestT {
			best, bestT, found = v, tt, true
		}
	}
	if !found {
		return 0, fmt.Errorf("no 0.1-0.8nm flux")
	}
	return best, nil
}

func xrayClass(flux float64) string {
	classes := []struct {
		c   string
		min float64
	}{{"X", 1e-4}, {"M", 1e-5}, {"C", 1e-6}, {"B", 1e-7}, {"A", 1e-8}}
	for _, k := range classes {
		if flux >= k.min {
			return fmt.Sprintf("%s%.1f", k.c, flux/k.min)
		}
	}
	return "A0.0"
}
