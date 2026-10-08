package sip

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// getWith drives one request with headers through the handler the mux would use.
func getWith(t *testing.T, s *httpServer, path string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	if path == "/" {
		s.handleIndex(rec, req)
	} else {
		s.handleStatic(rec, req)
	}
	return rec
}

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return out
}

func TestStaticTextIsGzipped(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	for _, name := range []string{"webterm.js", "webterm-vtgl.js", "terminal.js", "terminal.css", "xterm.css", "webterm.css"} {
		want, err := staticFiles.ReadFile("static/" + name)
		if err != nil {
			t.Fatal(err)
		}
		rec := getWith(t, s, "/static/"+name, map[string]string{"Accept-Encoding": "br, gzip, deflate"})
		if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
			t.Errorf("%s: Content-Encoding %q, want gzip", name, got)
			continue
		}
		if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
			t.Errorf("%s: no Vary: Accept-Encoding", name)
		}
		body := rec.Body.Bytes()
		if !bytes.Equal(gunzip(t, body), want) {
			t.Errorf("%s: the gzip body does not inflate to the file", name)
		}
		if len(body) >= len(want) {
			t.Errorf("%s: gzip is %d bytes, the file is %d", name, len(body), len(want))
		}

		plain := getWith(t, s, "/static/"+name, nil)
		if plain.Header().Get("Content-Encoding") != "" || !bytes.Equal(plain.Body.Bytes(), want) {
			t.Errorf("%s: a request without Accept-Encoding did not get the plain file", name)
		}
		if plain.Header().Get("ETag") == rec.Header().Get("ETag") {
			t.Errorf("%s: the gzip and plain bodies share an ETag", name)
		}

		again := getWith(t, s, "/static/"+name, map[string]string{
			"Accept-Encoding": "gzip",
			"If-None-Match":   rec.Header().Get("ETag"),
		})
		if again.Code != http.StatusNotModified {
			t.Errorf("%s: revalidating the gzip body answered %d, want 304", name, again.Code)
		}
	}
}

func TestGzipRefusedOrNotWorthIt(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	if got := getWith(t, s, "/static/webterm.js", map[string]string{"Accept-Encoding": "gzip;q=0, br"}).Header().Get("Content-Encoding"); got != "" {
		t.Errorf("gzip;q=0 got Content-Encoding %q", got)
	}
	for _, name := range []string{"fonts/JetBrainsMonoNerdFontMono-Regular.woff2", "fonts/JetBrainsMonoNerdFontMono-Regular.ttf"} {
		if got := getWith(t, s, "/static/"+name, map[string]string{"Accept-Encoding": "gzip"}).Header().Get("Content-Encoding"); got != "" {
			t.Errorf("%s got Content-Encoding %q; a font is not compressed again", name, got)
		}
	}

	cfg := DefaultConfig()
	cfg.StaticFS = fstest.MapFS{"terminal.css": {Data: []byte("/* mine */")}}
	o := newTestServer(t, cfg)
	rec := getWith(t, o, "/static/terminal.css", map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != "/* mine */" {
		t.Error("an override was compressed or replaced")
	}
}

// TestEveryFontHasWOFF2 checks that each shipped TTF has a WOFF2 next to it.
// The page asks for WOFF2 first, and a face with no WOFF2 falls back to its
// 2.4 MB TTF without a word.
func TestEveryFontHasWOFF2(t *testing.T) {
	for _, name := range AssetNames() {
		if !strings.HasSuffix(name, ".ttf") {
			continue
		}
		woff2 := strings.TrimSuffix(name, ".ttf") + ".woff2"
		data, err := staticFiles.ReadFile("static/" + woff2)
		if err != nil {
			t.Errorf("%s has no %s", name, woff2)
			continue
		}
		if !bytes.HasPrefix(data, []byte("wOF2")) {
			t.Errorf("%s is not a WOFF2 file", woff2)
		}
	}
}

// coldLoadBudget bounds what a first visit to a default page transfers, with
// gzip. It was 11.7 MB with the four TTFs, vtgl inline and no compression.
const coldLoadBudget = 4_700_000

// TestColdLoadBudget sums what a browser downloads on a first visit to a
// default deployment: the page, the stylesheets, the scripts and the four
// faces the terminal waits for. It fails when that grows past the budget.
func TestColdLoadBudget(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	page := []string{
		"/",
		"/static/xterm.css", "/static/webterm.css", "/static/terminal.css",
		"/static/webterm.js", "/static/terminal.js",
		"/static/fonts/JetBrainsMonoNerdFontMono-Regular.woff2",
		"/static/fonts/JetBrainsMonoNerdFontMono-Bold.woff2",
		"/static/fonts/JetBrainsMonoNerdFontMono-Italic.woff2",
		"/static/fonts/JetBrainsMonoNerdFontMono-BoldItalic.woff2",
	}
	total := 0
	for _, path := range page {
		rec := getWith(t, s, path, map[string]string{"Accept-Encoding": "gzip"})
		if rec.Code != http.StatusOK {
			t.Fatalf("%s answered %d", path, rec.Code)
		}
		t.Logf("%-60s %9d B", path, rec.Body.Len())
		total += rec.Body.Len()
	}
	t.Logf("total %d B, budget %d B", total, coldLoadBudget)
	if total > coldLoadBudget {
		t.Errorf("a first visit transfers %d B, over the budget of %d B", total, coldLoadBudget)
	}
}

// TestPageAsksForWOFF2 checks that the page names WOFF2 for every face, before
// the TTF. TestColdLoadBudget counts the WOFF2 files, so a page that went back
// to TTF would pass it while sending 5.8 MB more.
func TestPageAsksForWOFF2(t *testing.T) {
	css, _ := staticFiles.ReadFile("static/terminal.css")
	js, _ := staticFiles.ReadFile("static/terminal.js")
	html, _ := staticFiles.ReadFile("static/index.html")
	for _, face := range []string{"Regular", "Bold", "Italic", "BoldItalic"} {
		woff2 := "JetBrainsMonoNerdFontMono-" + face + ".woff2"
		ttf := "JetBrainsMonoNerdFontMono-" + face + ".ttf"
		for name, src := range map[string]string{"terminal.css": string(css)} {
			w, f := strings.Index(src, woff2), strings.Index(src, ttf)
			if w < 0 || (f >= 0 && f < w) {
				t.Errorf("%s does not name %s before %s", name, woff2, ttf)
			}
		}
	}
	if !strings.Contains(string(js), "${face}.woff2) format('woff2')") {
		t.Error("terminal.js does not hand webterm the WOFF2 faces first")
	}
	if strings.Contains(string(html), ".ttf") {
		t.Error("index.html preloads a TTF")
	}
}
