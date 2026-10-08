package sip

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// pageAssets are the files one page load asks for, the four fonts included.
var pageAssets = []string{
	"index.html", "terminal.css", "webterm.css", "xterm.css",
	"webterm.js", "terminal.js",
	"fonts/JetBrainsMonoNerdFontMono-Regular.woff2",
	"fonts/JetBrainsMonoNerdFontMono-Bold.woff2",
	"fonts/JetBrainsMonoNerdFontMono-Italic.woff2",
	"fonts/JetBrainsMonoNerdFontMono-BoldItalic.woff2",
}

// discardResponse is a ResponseWriter that keeps the status and drops the
// body, so a measurement counts the server and not a recorder's buffer.
type discardResponse struct {
	h      http.Header
	status int
	n      int
}

func (d *discardResponse) Header() http.Header { return d.h }
func (d *discardResponse) Write(p []byte) (int, error) {
	if d.status == 0 {
		d.status = http.StatusOK
	}
	d.n += len(p)
	return len(p), nil
}
func (d *discardResponse) WriteHeader(code int) { d.status = code }

func loadPage(s *httpServer, etags map[string]string) map[string]string {
	got := map[string]string{}
	for _, name := range pageAssets {
		r := httptest.NewRequest(http.MethodGet, "/static/"+name, nil)
		if tag := etags[name]; tag != "" {
			r.Header.Set("If-None-Match", tag)
		}
		w := &discardResponse{h: http.Header{}}
		s.handleStatic(w, r)
		got[name] = w.h.Get("ETag")
	}
	return got
}

// TestStaticAssetsCostNoCopy is a perf budget. A page load used to allocate
// the size of every file it served, 11.7 MB, because each request copied the
// file out of the binary and hashed it. A 304 paid the same.
func TestStaticAssetsCostNoCopy(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	etags := loadPage(s, nil) // fills the ETag cache

	const loads = 10
	const budget = 1 << 20 // bytes per page load
	for _, tc := range []struct {
		name  string
		etags map[string]string
	}{
		{"200", nil},
		{"304", etags},
	} {
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		for range loads {
			loadPage(s, tc.etags)
		}
		runtime.ReadMemStats(&after)
		perLoad := (after.TotalAlloc - before.TotalAlloc) / loads
		t.Logf("%s: %d bytes allocated per page load", tc.name, perLoad)
		if perLoad > budget {
			t.Errorf("%s: a page load allocates %d bytes, budget %d", tc.name, perLoad, budget)
		}
	}
}

// TestStaticAssetRevalidates checks the cached path answers like the old
// one: the ETag is the content hash it always was, so a browser's cached copy
// stays valid across the upgrade, and a matching If-None-Match gets a 304
// with no body.
func TestStaticAssetRevalidates(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	for _, name := range []string{"webterm.js", "fonts/JetBrainsMonoNerdFontMono-Regular.ttf"} {
		want, err := staticFiles.ReadFile("static/" + name)
		if err != nil {
			t.Fatal(err)
		}
		first := get(t, s, "/static/"+name)
		if first.Code != http.StatusOK || first.Body.String() != string(want) {
			t.Fatalf("%s: status %d, %d bytes, want 200 and %d bytes", name, first.Code, first.Body.Len(), len(want))
		}
		tag := first.Header().Get("ETag")
		if tag != contentETag(want) {
			t.Fatalf("%s: ETag %s, want the content hash %s", name, tag, contentETag(want))
		}

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/static/"+name, nil)
		req.Header.Set("If-None-Match", tag)
		s.handleStatic(rec, req)
		if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
			t.Fatalf("%s: revalidation got %d with %d bytes, want 304 and none", name, rec.Code, rec.Body.Len())
		}
	}
	if rec := get(t, s, "/static/fonts"); rec.Code != http.StatusNotFound {
		t.Fatalf("a directory got %d, want 404", rec.Code)
	}
	if rec := get(t, s, "/static/no-such-file.js"); rec.Code != http.StatusNotFound {
		t.Fatalf("a missing file got %d, want 404", rec.Code)
	}
}

// TestCustomFontTagFollowsTheFile replaces the custom font on disk. The old
// tag must stop matching, or a browser keeps the old font.
func TestCustomFontTagFollowsTheFile(t *testing.T) {
	font := filepath.Join(t.TempDir(), "font.ttf")
	if err := os.WriteFile(font, []byte("first font"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := DefaultConfig()
	cfg.FontPath = font
	s := newTestServer(t, cfg)

	first := get(t, s, "/static/fonts/custom.ttf")
	tag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || tag == "" {
		t.Fatalf("got %d with ETag %q", first.Code, tag)
	}
	revalidate := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/static/fonts/custom.ttf", nil)
		req.Header.Set("If-None-Match", tag)
		s.handleStatic(rec, req)
		return rec
	}
	if rec := revalidate(); rec.Code != http.StatusNotModified {
		t.Fatalf("an unchanged font got %d, want 304", rec.Code)
	}

	if err := os.WriteFile(font, []byte("second font, longer"), 0o600); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(font, later, later); err != nil {
		t.Fatal(err)
	}
	rec := revalidate()
	if rec.Code != http.StatusOK || rec.Body.String() != "second font, longer" {
		t.Fatalf("a replaced font got %d %q, want 200 and the new file", rec.Code, rec.Body.String())
	}
}

// BenchmarkStaticPageLoadAssets serves the files of one page load with no
// browser cache.
func BenchmarkStaticPageLoadAssets(b *testing.B) {
	s := newHTTPServer(DefaultConfig(), nil)
	b.ReportAllocs()
	for b.Loop() {
		loadPage(s, nil)
	}
}
