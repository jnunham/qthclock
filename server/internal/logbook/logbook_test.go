package logbook

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const adif = `Exported by Wavelog <EOH>
<call:5>K1ABC<band:3>20m<mode:3>FT8<qso_date:8>20261110<time_on:6>231500<rst_sent:3>-10<rst_rcvd:3>-07<gridsquare:4>FN31<country:13>United States<eor>
<CALL:6>JA1YRL<BAND:3>40m<MODE:4>MFSK<SUBMODE:3>FT4<QSO_DATE:8>20261110<TIME_ON:4>2330<eor>`

func TestParseADIF(t *testing.T) {
	q := ParseADIF(adif)
	if len(q) != 2 {
		t.Fatalf("got %d", len(q))
	}
	if q[0].Call != "K1ABC" || q[0].RSTRcvd != "-07" || q[0].Country != "United States" ||
		time.UnixMilli(q[0].Time).UTC().Format("1504") != "2315" {
		t.Errorf("first: %+v", q[0])
	}
	if q[1].Mode != "FT4" || time.UnixMilli(q[1].Time).UTC().Format("1504") != "2330" {
		t.Errorf("second: %+v", q[1])
	}
}

func TestRecentMerges(t *testing.T) {
	var last []QSO
	r := NewRecent(3, func(q []QSO) { last = q })
	now := time.Now().UnixMilli()
	r.Add(QSO{Call: "k1abc", Band: "20M", Time: now, RSTSent: "-10", Source: "wsjtx"})
	r.Add(QSO{Call: "K1ABC", Band: "20m", Time: now - 60000, Name: "Bob", Source: "wavelog"})
	r.Add(QSO{Call: "W1AW", Band: "40m", Time: now - 5000, Source: "wsjtx"})
	if len(last) != 2 || last[0].Call != "K1ABC" || last[0].Name != "Bob" || last[0].RSTSent != "-10" || last[0].Source != "wavelog" {
		t.Fatalf("merge failed: %+v", last)
	}
}

func TestWavelogV2AndV1(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.php/api/v2/qso":
			if r.Header.Get("Authorization") != "Bearer wl2_test" || r.URL.Query().Get("limit") != "10" {
				w.WriteHeader(401)
				return
			}
			w.Write([]byte(`{"data":[{"id":7,"call":"VP8NO","band":"15m","mode":"SSB","submode":null,"qso_date":"2026-11-10 22:01:00","rst_sent":"59","rst_rcvd":"57","gridsquare":"GD18","name":"Ann"}],"meta":{"page":1}}`))
		case "/index.php/api/get_contacts_adif":
			var req map[string]any
			json.NewDecoder(r.Body).Decode(&req)
			if req["key"] != "classic" || req["station_id"] != float64(2) || req["fetchfromid"] != float64(0) {
				w.WriteHeader(401)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"exported_qsos": 2, "lastfetchedid": 4886, "message": "Export successful", "adif": adif})
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	var got []QSO
	w := &Wavelog{URL: srv.URL + "/", Key: "wl2_test", Add: func(q ...QSO) { got = q }, client: srv.Client()}
	if err := w.pollV2(context.Background()); err != nil || len(got) != 1 || got[0].Call != "VP8NO" || got[0].Name != "Ann" {
		t.Fatalf("v2: %v %+v", err, got)
	}
	w = &Wavelog{URL: srv.URL + "/index.php", Key: "classic", StationID: "2", Add: func(q ...QSO) { got = q }, client: srv.Client()}
	if err := w.pollV1(context.Background()); err != nil || len(got) != 2 || got[0].Call != "JA1YRL" || w.lastID != 4886 {
		t.Fatalf("v1: %v %+v last=%d", err, got, w.lastID)
	}
}

func TestWavelogErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.php/api/get_contacts_adif":
			w.Write([]byte(`{"status":"failed","reason":"missing api key"}`))
		case "/index.php/api/v2/qso":
			w.WriteHeader(404)
			w.Write([]byte("<html>not found</html>"))
		}
	}))
	defer srv.Close()
	var msg string
	w := &Wavelog{URL: srv.URL, Key: "bad", StationID: "1", Add: func(...QSO) {}, Status: func(ok bool, m string) { msg = m }}
	if err := w.Poll(context.Background()); err == nil || !strings.Contains(msg, "missing api key") {
		t.Errorf("v1 failure not surfaced: %v", msg)
	}
	w = &Wavelog{URL: srv.URL, Key: "wl2_x", Add: func(...QSO) {}, Status: func(ok bool, m string) { msg = m }}
	if err := w.Poll(context.Background()); err == nil || !strings.Contains(msg, "3.1") {
		t.Errorf("v2 404 hint missing: %v", msg)
	}
	w = &Wavelog{URL: srv.URL, Key: "k", Add: func(...QSO) {}}
	if err := w.Poll(context.Background()); err == nil || !strings.Contains(err.Error(), "stationId") {
		t.Errorf("missing station id not reported: %v", err)
	}
}

func TestWavelogNoNewQSOsIsNotAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"exported_qsos":0,"lastfetchedid":0,"message":"No new QSOs available","adif":""}`))
	}))
	defer srv.Close()
	ok := false
	w := &Wavelog{URL: srv.URL, Key: "k", StationID: "1", Add: func(...QSO) {}, Status: func(o bool, m string) { ok = o }, lastID: 4886}
	if err := w.Poll(context.Background()); err != nil || !ok || w.lastID != 4886 {
		t.Fatalf("no-new-QSOs treated as error: %v ok=%v last=%d", err, ok, w.lastID)
	}
}
