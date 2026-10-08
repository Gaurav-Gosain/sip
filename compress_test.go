package sip

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
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
	for header, want := range map[string]string{
		"gzip":              "gzip",
		"GZIP;Q=1":          "gzip",
		"br, gzip;q=0.5":    "gzip",
		"*":                 "gzip",
		"gzip;q=0, *":       "",
		"gzip;q=0, br":      "",
		"gzip;Q=0":          "",
		"gzip; q=0.000":     "",
		"br, *;q=0":         "",
		"gzip;q=nonsense":   "",
		"deflate, identity": "",
		"":                  "",
	} {
		got := getWith(t, s, "/static/webterm.js", map[string]string{"Accept-Encoding": header}).Header().Get("Content-Encoding")
		if got != want {
			t.Errorf("Accept-Encoding %q got Content-Encoding %q, want %q", header, got, want)
		}
	}
	if got := getWith(t, s, "/static/fonts/JetBrainsMonoNerdFontMono-Regular.woff2", map[string]string{"Accept-Encoding": "gzip"}).Header().Get("Content-Encoding"); got != "" {
		t.Errorf("a WOFF2 font got Content-Encoding %q; it is compressed already", got)
	}

	cfg := DefaultConfig()
	cfg.StaticFS = fstest.MapFS{"terminal.css": {Data: []byte("/* mine */")}}
	o := newTestServer(t, cfg)
	rec := getWith(t, o, "/static/terminal.css", map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != "/* mine */" {
		t.Error("an override was compressed or replaced")
	}
}

// TestGzipKeepsTheContentType checks every compressible embedded file. A
// gzipped body with no Content-Type is sniffed by the browser, and a script
// or a stylesheet with the wrong type is refused.
func TestGzipKeepsTheContentType(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	for _, name := range AssetNames() {
		if !compressible(name) || name == "index.html" {
			continue
		}
		plain := getWith(t, s, "/static/"+name, nil)
		gz := getWith(t, s, "/static/"+name, map[string]string{"Accept-Encoding": "gzip"})
		want := plain.Header().Get("Content-Type")
		if want == "" {
			t.Errorf("%s has no Content-Type", name)
		}
		if got := gz.Header().Get("Content-Type"); got != want {
			t.Errorf("%s: gzipped Content-Type %q, plain %q", name, got, want)
		}
	}
	rec := httptest.NewRecorder()
	setStaticContentType(rec, "page.html")
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("an .html file gets Content-Type %q", got)
	}
}

// TestIndexTemplateIsNotServed checks that the page template is only served
// as "/", with the deployment's settings and headers.
func TestIndexTemplateIsNotServed(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	for _, enc := range []string{"", "gzip"} {
		if code := getWith(t, s, "/static/index.html", map[string]string{"Accept-Encoding": enc}).Code; code != http.StatusNotFound {
			t.Errorf("/static/index.html answered %d with Accept-Encoding %q, want 404", code, enc)
		}
	}
	if code := getWith(t, s, "/", nil).Code; code != http.StatusOK {
		t.Errorf("/ answered %d", code)
	}
}

// TestEveryFontHasWOFF2 checks that each source TTF in fonts/ has its WOFF2
// in static/fonts, and that no TTF is embedded. The page names only WOFF2.
func TestEveryFontHasWOFF2(t *testing.T) {
	ttfs, err := filepath.Glob(filepath.Join("fonts", "*.ttf"))
	if err != nil || len(ttfs) == 0 {
		t.Fatalf("no source fonts in fonts/: %v", err)
	}
	for _, ttf := range ttfs {
		woff2 := "fonts/" + strings.TrimSuffix(filepath.Base(ttf), ".ttf") + ".woff2"
		data, err := staticFiles.ReadFile("static/" + woff2)
		if err != nil {
			t.Errorf("%s has no static/%s. Run scripts/fonts-woff2.sh.", ttf, woff2)
			continue
		}
		if !bytes.HasPrefix(data, []byte("wOF2")) {
			t.Errorf("static/%s is not a WOFF2 file", woff2)
		}
	}
	for _, name := range AssetNames() {
		if strings.HasSuffix(name, ".ttf") {
			t.Errorf("static/%s is embedded. Source fonts belong in fonts/.", name)
		}
	}
}

// coldLoadBudget bounds what a first visit to a default page transfers, with
// gzip. It was 11.7 MB with the four TTFs, vtgl inline and no compression.
const coldLoadBudget = 4_700_000

var (
	pageRef = regexp.MustCompile(`(?:src|href)="(static/[^"]+)"`)
	cssFont = regexp.MustCompile(`url\('(fonts/[^']+)'\)`)
)

// TestColdLoadBudget sums what a browser downloads on a first visit to a
// default deployment: the page, every file the page names, and the fonts the
// stylesheet names. It fails when that grows past the budget. The list is
// read from the page, so a new script or stylesheet is counted.
func TestColdLoadBudget(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	index := getWith(t, s, "/", map[string]string{"Accept-Encoding": "gzip"})
	paths := []string{}
	seen := map[string]bool{}
	add := func(p string) {
		if !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	for _, m := range pageRef.FindAllStringSubmatch(index.Body.String(), -1) {
		add("/" + m[1])
	}
	css, err := staticFiles.ReadFile("static/terminal.css")
	if err != nil {
		t.Fatal(err)
	}
	fonts := 0
	for _, m := range cssFont.FindAllStringSubmatch(string(css), -1) {
		add("/static/" + m[1])
		fonts++
	}
	if fonts < 4 || !seen["/static/webterm.js"] || !seen["/static/terminal.js"] {
		t.Fatalf("the page names too little to measure: %v", paths)
	}

	total := index.Body.Len()
	for _, path := range paths {
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

// TestPageAsksForWOFF2 checks that the page names no TTF. TestColdLoadBudget
// counts what the stylesheet names, and webterm loads the faces terminal.js
// names, so both have to agree on WOFF2.
func TestPageAsksForWOFF2(t *testing.T) {
	for _, name := range []string{"terminal.css", "terminal.js", "index.html"} {
		data, err := staticFiles.ReadFile("static/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), ".ttf") {
			t.Errorf("static/%s names a TTF", name)
		}
	}
	js, _ := staticFiles.ReadFile("static/terminal.js")
	if !strings.Contains(string(js), "${face}.woff2) format('woff2')") {
		t.Error("terminal.js does not hand webterm the WOFF2 faces")
	}
}
