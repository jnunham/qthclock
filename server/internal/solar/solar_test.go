package solar

import "testing"

func TestKp3hBothFormats(t *testing.T) {
	old := []byte(`[["time_tag","Kp","a_running","station_count"],
		["2099-01-01 00:00:00.000","2.33","9","8"],["2099-01-01 03:00:00.000","4.00","27","8"]]`)
	updated := []byte(`[{"time_tag":"2099-01-01T00:00:00","Kp":2.33,"a_running":9,"station_count":8},
		{"time_tag":"2099-01-01T03:00:00","Kp":4.0,"a_running":27,"station_count":8}]`)
	for name, b := range map[string][]byte{"old": old, "new": updated} {
		var r Report
		if err := applyKp3h(&r, b); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(r.Kp24) != 2 || r.Kp24[1].Kp != 4 || r.KpMax24 == nil || *r.KpMax24 != 4 {
			t.Errorf("%s: %+v", name, r)
		}
	}
}

func TestHPI(t *testing.T) {
	b := []byte(`# Product: Ovation Aurora Short Term Forecast
# Observation  Forecast  North-Hemispheric-Power-Index  South-Hemispheric-Power-Index-GigaWatts
#------------------------------------------------
2026-11-11_16:40   2026-11-11_17:20    16    13
2026-11-11_16:45   2026-11-11_17:25    15    14
`)
	var r Report
	if err := applyHPI(&r, b); err != nil || *r.HPINorth != 15 || *r.HPISouth != 14 {
		t.Fatalf("%v %+v", err, r)
	}
}

func TestKpNowAndXray(t *testing.T) {
	var r Report
	if err := applyKpNow(&r, []byte(`[{"time_tag":"2026-11-11T16:00:00","kp_index":1,"estimated_kp":1.33,"kp":"1P"},{"time_tag":"2026-11-11T16:01:00","kp_index":1,"estimated_kp":1.67,"kp":"2M"}]`)); err != nil || *r.Kp != 1.67 {
		t.Fatalf("kp: %v %+v", err, r.Kp)
	}
	if err := applyXray(&r, []byte(`[{"time_tag":"2026-11-11T16:00:00Z","flux":7e-7,"energy":"0.1-0.8nm"},{"time_tag":"2026-11-11T16:00:00Z","flux":1e-9,"energy":"0.05-0.4nm"}]`)); err != nil || r.XRay != "B7.0" {
		t.Fatalf("xray: %v %q", err, r.XRay)
	}
}
