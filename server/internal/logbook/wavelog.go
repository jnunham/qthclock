package logbook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Wavelog polls a Wavelog logbook for the newest QSOs.
//
// With a v2 token (starts with "wl2_", Wavelog 3.1+) it asks for the newest
// few directly. With a classic API key it uses api/get_contacts_adif, which
// returns everything once and then only new QSOs on each poll.
type Wavelog struct {
	URL       string // e.g. https://log.example.com (with or without /index.php)
	Key       string
	StationID string // needed for classic keys
	Interval  time.Duration
	Add       func(...QSO)

	client *http.Client
	lastID string
	primed bool
}

func (w *Wavelog) base() string {
	u := strings.TrimRight(strings.TrimSpace(w.URL), "/")
	if !strings.HasSuffix(u, "/index.php") {
		u += "/index.php"
	}
	return u
}

func (w *Wavelog) Run(ctx context.Context) {
	w.client = &http.Client{Timeout: 30 * time.Second}
	if w.Interval <= 0 {
		w.Interval = time.Minute
	}
	for {
		var err error
		if strings.HasPrefix(w.Key, "wl2_") {
			err = w.pollV2(ctx)
		} else {
			err = w.pollV1(ctx)
		}
		if err != nil && ctx.Err() == nil {
			log.Printf("wavelog: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(w.Interval):
		}
	}
}

func (w *Wavelog) pollV2(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", w.base()+"/api/v2/qso?limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+w.Key)
	req.Header.Set("Accept", "application/json")
	body, err := w.do(req)
	if err != nil {
		return err
	}
	var resp struct {
		Data []struct {
			Call    string `json:"call"`
			Band    string `json:"band"`
			Mode    string `json:"mode"`
			Submode string `json:"submode"`
			QSODate string `json:"qso_date"`
			RSTSent string `json:"rst_sent"`
			RSTRcvd string `json:"rst_rcvd"`
			Grid    string `json:"gridsquare"`
			Name    string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("unexpected response: %v", err)
	}
	var out []QSO
	for _, d := range resp.Data {
		t, _ := time.Parse("2006-01-02 15:04:05", d.QSODate)
		mode := d.Mode
		if d.Submode != "" {
			mode = d.Submode
		}
		out = append(out, QSO{Call: d.Call, Time: t.UnixMilli(), Band: d.Band, Mode: mode,
			RSTSent: d.RSTSent, RSTRcvd: d.RSTRcvd, Grid: d.Grid, Name: d.Name, Source: "wavelog"})
	}
	if !w.primed {
		log.Printf("wavelog: connected (API v2), %d recent QSOs", len(out))
		w.primed = true
	}
	if len(out) > 0 {
		w.Add(out...)
	}
	return nil
}

func (w *Wavelog) pollV1(ctx context.Context) error {
	from := w.lastID
	if from == "" {
		from = "0"
	}
	payload, _ := json.Marshal(map[string]any{"key": w.Key, "station_id": w.StationID, "fetchfromid": from})
	req, _ := http.NewRequestWithContext(ctx, "POST", w.base()+"/api/get_contacts_adif", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	body, err := w.do(req)
	if err != nil {
		return err
	}
	var resp struct {
		Exported json.Number `json:"exported_qsos"`
		LastID   json.Number `json:"lastfetchedid"`
		Message  string      `json:"message"`
		ADIF     string      `json:"adif"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&resp); err != nil {
		return fmt.Errorf("unexpected response: %v", err)
	}
	if resp.LastID != "" && resp.LastID != "0" {
		w.lastID = resp.LastID.String()
	}
	qsos := ParseADIF(resp.ADIF)
	for i := range qsos {
		qsos[i].Source = "wavelog"
	}
	sort.Slice(qsos, func(i, j int) bool { return qsos[i].Time > qsos[j].Time })
	if len(qsos) > 10 {
		qsos = qsos[:10]
	}
	if !w.primed {
		log.Printf("wavelog: connected (API v1), %s QSOs in log", resp.Exported)
		w.primed = true
	}
	if len(qsos) > 0 {
		w.Add(qsos...)
	}
	return nil
}

func (w *Wavelog) do(req *http.Request) ([]byte, error) {
	resp, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, fmt.Errorf("%s: HTTP %d %s", req.URL.Path, resp.StatusCode, snippet)
	}
	return body, nil
}

// ParseADIF reads QSO records from an ADIF string.
func ParseADIF(s string) []QSO {
	var out []QSO
	rec := map[string]string{}
	low := strings.ToLower(s)
	i := 0
	if h := strings.Index(low, "<eoh>"); h >= 0 {
		i = h + 5
	}
	for {
		lt := strings.IndexByte(s[i:], '<')
		if lt < 0 {
			break
		}
		i += lt
		gt := strings.IndexByte(s[i:], '>')
		if gt < 0 {
			break
		}
		tag := strings.ToLower(s[i+1 : i+gt])
		i += gt + 1
		if tag == "eor" {
			if q, ok := adifQSO(rec); ok {
				out = append(out, q)
			}
			rec = map[string]string{}
			continue
		}
		parts := strings.Split(tag, ":")
		if len(parts) < 2 {
			continue
		}
		n, err := strconv.Atoi(parts[1])
		if err != nil || n < 0 || i+n > len(s) {
			continue
		}
		rec[parts[0]] = s[i : i+n]
		i += n
	}
	return out
}

func adifQSO(r map[string]string) (QSO, bool) {
	if r["call"] == "" {
		return QSO{}, false
	}
	tm := r["time_on"]
	for len(tm) < 6 {
		tm += "0"
	}
	t, _ := time.Parse("20060102150405", r["qso_date"]+tm)
	mode := r["mode"]
	if r["submode"] != "" {
		mode = r["submode"]
	}
	return QSO{Call: r["call"], Time: t.UnixMilli(), Band: r["band"], Mode: mode,
		RSTSent: r["rst_sent"], RSTRcvd: r["rst_rcvd"], Grid: r["gridsquare"], Name: r["name"], Country: r["country"]}, true
}
