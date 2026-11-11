package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// static serves the web page so a browser can never mix code from two
// versions. index.html is always re-checked, and it points at the code
// under a per-version path (/v/<boot>/...), so after an update every file
// is fetched fresh. Versioned files can then be cached forever.
type static struct {
	dir     string
	version string
	files   http.Handler
}

func newStatic(dir string, boot int64) *static {
	return &static{dir: dir, version: fmt.Sprint(boot), files: http.FileServer(http.Dir(dir))}
}

func (s *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case p == "/" || p == "/index.html":
		b, err := os.ReadFile(filepath.Join(s.dir, "index.html"))
		if err != nil {
			http.Error(w, "web files not found: check \"webDir\" in config.json", http.StatusInternalServerError)
			return
		}
		prefix := "v/" + s.version + "/"
		html := strings.NewReplacer(
			`src="dist/`, `src="`+prefix+`dist/`,
			`href="styles.css"`, `href="`+prefix+`styles.css"`,
		).Replace(string(b))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write([]byte(html))
	case strings.HasPrefix(p, "/v/"):
		// /v/<version>/dist/main.js -> /dist/main.js
		rest := strings.TrimPrefix(p, "/v/")
		i := strings.IndexByte(rest, '/')
		if i < 0 {
			http.NotFound(w, r)
			return
		}
		if rest[:i] == s.version {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache") // an old page asking for old code: serve current files, don't cache
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = rest[i:]
		s.files.ServeHTTP(w, r2)
	default:
		w.Header().Set("Cache-Control", "no-cache")
		s.files.ServeHTTP(w, r)
	}
}
