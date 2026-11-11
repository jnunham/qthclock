package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateStation(t *testing.T) {
	ok := map[[2]string][2]string{
		{"k1abc", "fn31pr"}: {"K1ABC", "FN31pr"},
		{"VE3XYZ", "FN03"}:  {"VE3XYZ", "FN03"},
		{"2E0ABC", "IO91"}:  {"2E0ABC", "IO91"},
		{"W1AW/7", "DM42"}:  {"W1AW/7", "DM42"},
	}
	for in, want := range ok {
		c, g, err := validateStation(in[0], in[1])
		if err != nil || c != want[0] || g != want[1] {
			t.Errorf("%v -> %q %q %v", in, c, g, err)
		}
	}
	for _, bad := range [][2]string{{"", "FN31"}, {"HELLO", "FN31"}, {"K1ABC", "ZZ99"}, {"K1ABC", "FN3"}} {
		if _, _, err := validateStation(bad[0], bad[1]); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestStaticVersioning(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "dist"), 0o755)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte(`<link rel="stylesheet" href="styles.css"><script type="module" src="dist/main.js"></script>`), 0o644)
	os.WriteFile(filepath.Join(dir, "dist", "main.js"), []byte("console.log(1)"), 0o644)
	s := newStatic(dir, 42)

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	body := rec.Body.String()
	if !strings.Contains(body, `src="v/42/dist/main.js"`) || !strings.Contains(body, `href="v/42/styles.css"`) || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("index: %s %v", body, rec.Header())
	}
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/v/42/dist/main.js", nil))
	if rec.Code != 200 || rec.Body.String() != "console.log(1)" || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("versioned: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}
}
