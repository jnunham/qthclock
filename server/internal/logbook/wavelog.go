package logbook

import (
	"bytes"
	"context"
	"crypto/tls"
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
	// Status reports whether the last poll worked, so the screen can say why
	// QSOs aren't showing instead of waiting forever.
	Status func(ok bool, msg string)
	// SkipTLSVerify allows a self-signed certificate on a home server.
	SkipTLSVerify bool

	client *http.Client
	lastID int64
	primed bool
}

func (w *Wavelog) base() string {
	u := strings.TrimRight(strings.TrimSpace(w.URL), "/")
	if !strings.HasSuffix(u, "/index.php") {
		u += "/index.php"
	}
	return u
}

func (w *Wavelog) init() {
	if w.client != nil {
		return
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if w.SkipTLSVerify {
		tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	w.client = &http.Client{Timeout: 60 * time.Second, Transport: tr}
}

// Poll runs one fetch. Used by Run and by `qthclock -check-wavelog`.
func (w *Wavelog) Poll(ctx context.Context) error {
	w.init()
	var err error
	if strings.HasPrefix(w.Key, "wl2_") {
		err = w.pollV2(ctx)
	} else {
		err = w.pollV1(ctx)
	}
	if w.Status != nil {
		if err != nil {
			w.Status(false, err.Error())
		} else {
			w.Status(true, "")
		}
	}
	return err
}

func (w *Wavelog) Run(ctx context.Context) {
	if w.Interval <= 0 {
		w.Interval = time.Minute
	}
	wait := w.Interval
	for {
		if err := w.Poll(ctx); err != nil && ctx.Err() == nil {
			// Back off while it's failing (1, 2, 4 ... up to 10 minutes) so a
			// down or misconfigured server isn't hammered every minute.
			wait *= 2
			if wait > 10*time.Minute {
				wait = 10 * time.Minute
			}
			log.Printf("wavelog: %v (next try in %s)", err, wait)
		} else {
			wait = w.Interval
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (w *Wavelog) pollV2(ctx context.Context) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", w.base()+"/api/v2/qso?limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+w.Key)
	req.Header.Set("User-Agent", "QTHClock/1.0")
	req.Header.Set("Accept", "application/json")
	body, err := w.do(req)
	if err != nil {
		return err
	}
	var resp struct {
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
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
		return notJSON(body)
	}
	if resp.Error != nil {
		return fmt.Errorf("Wavelog says: %s (%s)", resp.Error.Message, resp.Error.Code)
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
	if strings.TrimSpace(w.StationID) == "" {
		return fmt.Errorf(`"stationId" is empty: with a classic API key Wavelog needs your station location ID (the number badge on Wavelog's Station Locations page)`)
	}
	var station any = strings.TrimSpace(w.StationID)
	if n, err := strconv.Atoi(w.StationID); err == nil {
		station = n
	}
	payload, _ := json.Marshal(map[string]any{"key": w.Key, "station_id": station, "fetchfromid": w.lastID})
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
		Status   string      `json:"status"`
		Reason   string      `json:"reason"`
		ADIF     string      `json:"adif"`
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&resp); err != nil {
		return notJSON(body)
	}
	// "No new QSOs available" just means nothing was logged since the last
	// check: that's normal, not an error.
	if strings.Contains(strings.ToLower(resp.Message+" "+resp.Reason), "no new qso") {
		if !w.primed {
			log.Printf("wavelog: connected (API v1), no QSOs to fetch yet")
			w.primed = true
		}
		return nil
	}
	if resp.Status == "failed" || resp.Reason != "" {
		return fmt.Errorf("Wavelog says: %s", firstNonEmpty(resp.Reason, resp.Message, resp.Status))
	}
	if resp.ADIF == "" && resp.Message != "" && !strings.Contains(strings.ToLower(resp.Message), "success") {
		return fmt.Errorf("Wavelog says: %s", resp.Message)
	}
	if id, err := resp.LastID.Int64(); err == nil && id > 0 {
		w.lastID = id
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
		if strings.Contains(err.Error(), "certificate") {
			return nil, fmt.Errorf(`%v (self-signed certificate? set "skipTLSVerify": true in the wavelog config)`, err)
		}
		return nil, fmt.Errorf("can't reach Wavelog at %s: %v", w.base(), err)
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
		hint := ""
		switch {
		case resp.StatusCode == 401 && strings.HasPrefix(w.Key, "wl2_"):
			hint = " (token invalid or expired)"
		case resp.StatusCode == 401 || resp.StatusCode == 403:
			hint = " (check the API key and that it has read access)"
		case resp.StatusCode == 404 && strings.HasPrefix(w.Key, "wl2_"):
			hint = " (API v2 needs Wavelog 3.1 or newer: update Wavelog, or use a classic read-only API key + stationId)"
		case resp.StatusCode == 404:
			hint = ` (check "url": it should be the address you open Wavelog at)`
		}
		return nil, fmt.Errorf("%s returned HTTP %d%s: %s", req.URL.Path, resp.StatusCode, hint, snippet)
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

func notJSON(body []byte) error {
	t := strings.TrimSpace(string(body))
	if strings.HasPrefix(t, "<") {
		return fmt.Errorf(`Wavelog returned a web page instead of data: check "url" points at your Wavelog (e.g. https://log.example.com) and the API key is right`)
	}
	if len(t) > 160 {
		t = t[:160]
	}
	return fmt.Errorf("unexpected reply from Wavelog: %q", t)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return "unknown error"
}
