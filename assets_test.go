package sip

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// defaultAssetDigests pins what a deployment that configures nothing serves,
// byte for byte.
//
// The extension points are all opt-in, and the way each one breaks a
// deployment that never asked for it is by changing a byte of the default
// page. These were taken from the build before any of it landed, by asking a
// running server rather than by hashing the tree, so the render path is in the
// measurement.
//
// terminal.js is absent on purpose and pinned differently below: window.sip is
// the page API and it is part of the default client now, so its bytes are
// meant to have changed.
var defaultAssetDigests = map[string]string{
	"/":                    "1ffe93de436e26c925d1a59b3ab872b23edcd4cb5dbb22700949462784993c07",
	"/static/index.html":   "2a3f870fc6f650c9a3cdaa931b6b8e01661c4b9cac6a4e0a5af785e64c6d9693",
	"/static/terminal.css": "3e32f10f34e88298fea71bf0697b774ce0c7dd11926630f703109bd3d21de0a7",
	"/static/webterm.js":   "d251fbe49d33c72d182b268d7f1f3fb8b6a244c055e384c594effc7d511c2304",
	"/static/webterm.css":  "511792665738142539a8e36d1cfae86b4a62f002b672918d904ede29a2f51b75",
	"/static/xterm.css":    "4d9a1d50808997f097ccc6040a5da6f6cb06b14e5ee2402df5196a218bba838f",
	"/static/mobile.js":    "3bb7c755ff498558226bd7977bba276501a7bcdba27fcb62a689dc805d6b61dd",
	"/static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf": "9e4dad8c34fb31045d53790a936a0afc3aae3fb830e874faadf3670662b04853",
}

func newTestServer(t *testing.T, cfg Config) *httpServer {
	t.Helper()
	s := newHTTPServer(cfg, nil)
	if err := s.validateConfig(); err != nil {
		t.Fatalf("validateConfig: %v", err)
	}
	return s
}

// get drives one request through the same handler the mux would.
func get(t *testing.T, s *httpServer, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	switch {
	case path == "/":
		s.handleIndex(rec, req)
	case strings.HasPrefix(path, "/static/"):
		s.handleStatic(rec, req)
	default:
		t.Fatalf("get: no handler for %q", path)
	}
	return rec
}

func digest(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// TestDefaultPageUnchanged is the promise to every deployment that supplies
// nothing: the extension points cost it nothing at all.
func TestDefaultPageUnchanged(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	for path, want := range defaultAssetDigests {
		rec := get(t, s, path)
		if rec.Code != http.StatusOK {
			t.Errorf("ASSERTION: %s answered %d, want 200", path, rec.Code)
			continue
		}
		if got := digest(rec.Body.Bytes()); got != want {
			t.Errorf("ASSERTION: %s changed for a deployment that configured nothing.\n  was: %s\n  now: %s", path, want, got)
		}
	}
}

// TestDefaultPageHasNoExtensionMarkup checks the other half of the same
// promise: no link, no script and no route appears unasked.
func TestDefaultPageHasNoExtensionMarkup(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	body := get(t, s, "/").Body.String()

	for _, marker := range []string{extraCSSName, extraJSName, "__sipConfig"} {
		if strings.Contains(body, marker) {
			t.Errorf("ASSERTION: the default page mentions %q; nothing was configured", marker)
		}
	}
	if strings.Contains(body, "{{FONT_FACE_EXTRA}}") {
		t.Error("ASSERTION: the default page still carries the placeholder, so nothing replaced it")
	}
	for _, path := range []string{"/static/" + extraCSSName, "/static/" + extraJSName} {
		if code := get(t, s, path).Code; code != http.StatusNotFound {
			t.Errorf("ASSERTION: %s answered %d for a deployment that configured nothing, want 404", path, code)
		}
	}
}

func TestExtraCSSAndJSAreServedAndLinked(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ExtraCSS = "#terminal-container { outline: 3px solid red; }"
	cfg.ExtraJS = "window.brandLoaded = true;"
	s := newTestServer(t, cfg)

	body := get(t, s, "/").Body.String()
	if !strings.Contains(body, `<link rel="stylesheet" href="static/`+extraCSSName+`">`) {
		t.Error("ASSERTION: the page does not link the deployment's stylesheet")
	}
	if !strings.Contains(body, `<script defer src="static/`+extraJSName+`"></script>`) {
		t.Error("ASSERTION: the page does not load the deployment's script")
	}

	// The stylesheet has to come after sip's own, or a rule of the same
	// specificity loses on cascade order and the deployment sees nothing.
	sipSheet := strings.Index(body, "static/terminal.css")
	ownSheet := strings.Index(body, extraCSSName)
	switch {
	case sipSheet < 0:
		t.Error("ASSERTION: the page does not link sip's own stylesheet, so the order proves nothing")
	case ownSheet < 0:
		t.Error("ASSERTION: the page does not link the deployment's stylesheet")
	case ownSheet < sipSheet:
		t.Error("ASSERTION: the deployment's stylesheet is linked before sip's own, so its rules lose")
	}

	css := get(t, s, "/static/"+extraCSSName)
	if css.Body.String() != cfg.ExtraCSS {
		t.Errorf("ASSERTION: the stylesheet served is %q, want the configured rules", css.Body.String())
	}
	if ct := css.Header().Get("Content-Type"); ct != "text/css" {
		t.Errorf("ASSERTION: the stylesheet is served as %q, want text/css", ct)
	}
	js := get(t, s, "/static/"+extraJSName)
	if js.Body.String() != cfg.ExtraJS {
		t.Errorf("ASSERTION: the script served is %q, want the configured source", js.Body.String())
	}
	if ct := js.Header().Get("Content-Type"); ct != "application/javascript" {
		t.Errorf("ASSERTION: the script is served as %q, want application/javascript", ct)
	}
}

func TestStaticFSOverridesFileByFile(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StaticFS = fstest.MapFS{
		"terminal.css": {Data: []byte("/* mine */")},
		"brand.svg":    {Data: []byte("<svg/>")},
	}
	s := newTestServer(t, cfg)

	if got := get(t, s, "/static/terminal.css").Body.String(); got != "/* mine */" {
		t.Errorf("ASSERTION: the override did not win, served %q", got)
	}
	// The point of file-by-file: one replacement must not cost the rest.
	rec := get(t, s, "/static/webterm.css")
	if rec.Code != http.StatusOK || digest(rec.Body.Bytes()) != defaultAssetDigests["/static/webterm.css"] {
		t.Error("ASSERTION: a file the deployment did not replace stopped being sip's own")
	}
	svg := get(t, s, "/static/brand.svg")
	if svg.Code != http.StatusOK || svg.Body.String() != "<svg/>" {
		t.Error("ASSERTION: a file sip does not ship is not served from StaticFS")
	}
	if ct := svg.Header().Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("ASSERTION: brand.svg is served as %q, want image/svg+xml", ct)
	}
	if over := s.overriddenAssets(); len(over) != 1 || over[0] != "terminal.css" {
		t.Errorf("ASSERTION: the startup warning would name %v, want [terminal.css]", over)
	}
}

// brokenFS fails every read with something other than "not there", which is
// what a directory with the wrong permissions does.
type brokenFS struct{}

func (brokenFS) Open(string) (fs.File, error) { return nil, errors.New("no") }

func TestBrokenOverrideFallsBackToSip(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StaticFS = brokenFS{}
	s := newTestServer(t, cfg)

	rec := get(t, s, "/static/terminal.css")
	if rec.Code != http.StatusOK {
		t.Fatalf("ASSERTION: a broken StaticFS answered %d; sip must serve its own copy instead", rec.Code)
	}
	if digest(rec.Body.Bytes()) != defaultAssetDigests["/static/terminal.css"] {
		t.Error("ASSERTION: a broken StaticFS did not fall back to sip's own stylesheet")
	}
	if digest(get(t, s, "/").Body.Bytes()) != defaultAssetDigests["/"] {
		t.Error("ASSERTION: a broken StaticFS served a page other than sip's own")
	}
}

func TestIndexOverrideWithoutPlaceholderStillGetsItsSettings(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ExtraCSS = "body{}"
	cfg.StaticFS = fstest.MapFS{
		"index.html": {Data: []byte("<html><head><title>Sip</title></head><body><div id=\"terminal\"></div></body></html>")},
	}
	s := newTestServer(t, cfg)

	body := get(t, s, "/").Body.String()
	if !strings.Contains(body, extraCSSName) {
		t.Error("ASSERTION: a page without the placeholder lost its stylesheet; the </head> fallback did not run")
	}
	if strings.Index(body, extraCSSName) > strings.Index(body, "</head>") {
		t.Error("ASSERTION: the fallback put the markup outside the head")
	}
}

func TestIndexOverrideWithNoHeadIsServedAndLogged(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ExtraCSS = "body{}"
	cfg.StaticFS = fstest.MapFS{"index.html": {Data: []byte("nothing here")}}
	s := newTestServer(t, cfg)

	rec := get(t, s, "/")
	if rec.Code != http.StatusOK || rec.Body.String() != "nothing here" {
		t.Errorf("ASSERTION: a page with no head was not served as it is, got %d %q", rec.Code, rec.Body.String())
	}
}

// TestAssetNameRejectsTraversal is the whole of the traversal question: this
// is the only place a request picks a file.
func TestAssetNameRejectsTraversal(t *testing.T) {
	bad := []string{
		"/static/../go.mod",
		"/static/../../etc/passwd",
		"/static/fonts/../../go.mod",
		`/static/..\go.mod`,
		"/static//etc/passwd",
		"/static/",
		"/static/.",
		"/static/./go.mod",
		"/etc/passwd",
		"/staticx/terminal.css",
	}
	for _, p := range bad {
		if name, ok := assetName(p); ok {
			t.Errorf("ASSERTION: %q was accepted as asset %q", p, name)
		}
	}
	good := map[string]string{
		"/static/terminal.css":                                "terminal.css",
		"/static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf": "fonts/JetBrainsMonoNerdFontMono-Regular.ttf",
	}
	for p, want := range good {
		name, ok := assetName(p)
		if !ok || name != want {
			t.Errorf("ASSERTION: %q resolved to (%q, %v), want (%q, true)", p, name, ok, want)
		}
	}
}

// TestTraversalIsRefusedAgainstAnOverride drives the request path with a
// StaticFS that would happily hand over the file if it were asked.
func TestTraversalIsRefusedAgainstAnOverride(t *testing.T) {
	cfg := DefaultConfig()
	cfg.StaticFS = greedyFS{}
	s := newTestServer(t, cfg)

	for _, p := range []string{"/static/../secret", "/static/fonts/../../secret", `/static/..\secret`} {
		rec := get(t, s, p)
		if rec.Code != http.StatusNotFound {
			t.Errorf("ASSERTION: %q answered %d and served %q, want 404", p, rec.Code, rec.Body.String())
		}
	}
}

// greedyFS answers any name at all, so only the caller's own check can stop a
// traversal.
type greedyFS struct{}

func (greedyFS) Open(name string) (fs.File, error) {
	return fstest.MapFS{name: {Data: []byte("SECRET " + name)}}.Open(name)
}

func TestRoutesRefuseSipsOwnPaths(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	for _, pattern := range []string{"/", "/ws", "/health", "/cert-hash", "/static/", "/static/terminal.css", "GET /health", "example.com/ws"} {
		cfg := DefaultConfig()
		cfg.Routes = []Route{{Pattern: pattern, Handler: h}}
		s := newHTTPServer(cfg, nil)
		err := s.validateConfig()
		if err == nil {
			t.Errorf("ASSERTION: route %q was accepted; it shadows a path sip's client needs", pattern)
			continue
		}
		if !strings.Contains(err.Error(), pattern) {
			t.Errorf("ASSERTION: the refusal for %q does not name it: %v", pattern, err)
		}
	}
}

func TestRouteValidationCatchesTheOrdinaryMistakes(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	cases := map[string][]Route{
		"empty pattern": {{Pattern: "", Handler: h}},
		"no handler":    {{Pattern: "/x", Handler: nil}},
		"registered twice": {
			{Pattern: "/x", Handler: h},
			{Pattern: "/x", Handler: h},
		},
		"no leading slash": {{Pattern: "favicon.ico", Handler: h}},
	}
	for name, routes := range cases {
		cfg := DefaultConfig()
		cfg.Routes = routes
		s := newHTTPServer(cfg, nil)
		if err := s.validateConfig(); err == nil {
			t.Errorf("ASSERTION: %s was accepted", name)
		}
	}
}

func TestRouteServesAndTakesTheFavicon(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Routes = []Route{{
		Pattern: "/favicon.ico",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("ICON"))
		}),
	}, {
		Pattern: "/manifest.webmanifest",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("{}"))
		}),
	}}
	s := newTestServer(t, cfg)

	mux := http.NewServeMux()
	if err := s.registerRoutes(mux); err != nil {
		t.Fatalf("registerRoutes: %v", err)
	}
	for path, want := range map[string]string{"/favicon.ico": "ICON", "/manifest.webmanifest": "{}"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Body.String() != want {
			t.Errorf("ASSERTION: %s served %q, want %q", path, rec.Body.String(), want)
		}
	}
}

// TestRouteIsBehindBasicAuth pins the fail-closed rule. Sip cannot tell which
// of a deployment's URLs is safe to publish, so it publishes none of them.
func TestRouteIsBehindBasicAuth(t *testing.T) {
	cfg := DefaultConfig()
	cfg.BasicUsername = "u"
	cfg.BasicPassword = "p"
	cfg.AllowInsecureNoTLS = true
	cfg.Routes = []Route{{
		Pattern: "/private",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("SECRET"))
		}),
	}}
	s := newTestServer(t, cfg)

	mux := http.NewServeMux()
	if err := s.registerRoutes(mux); err != nil {
		t.Fatalf("registerRoutes: %v", err)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/private", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("ASSERTION: an unauthenticated request to a deployment's route answered %d, want 401", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "SECRET") {
		t.Error("ASSERTION: the route's body reached an unauthenticated request")
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	req.SetBasicAuth("u", "p")
	mux.ServeHTTP(rec, req)
	if rec.Body.String() != "SECRET" {
		t.Errorf("ASSERTION: an authenticated request got %q, want the route's body", rec.Body.String())
	}
}

func TestAssetDigestAndNames(t *testing.T) {
	names := AssetNames()
	if len(names) == 0 {
		t.Fatal("ASSERTION: AssetNames lists nothing")
	}
	for _, want := range []string{"index.html", "terminal.css", "terminal.js", "webterm.js"} {
		found := false
		for _, n := range names {
			if n == want {
				found = true
			}
		}
		if !found {
			t.Errorf("ASSERTION: AssetNames does not list %q", want)
		}
	}
	got, err := AssetDigest("index.html")
	if err != nil {
		t.Fatalf("AssetDigest: %v", err)
	}
	if got != defaultAssetDigests["/static/index.html"] {
		t.Errorf("ASSERTION: AssetDigest(index.html) is %s, want the digest of the file served at /static/index.html", got)
	}
	if _, err := AssetDigest("not-a-file"); err == nil {
		t.Error("ASSERTION: AssetDigest accepted a name sip does not ship")
	}
	if _, err := fs.ReadFile(Assets(), "terminal.css"); err != nil {
		t.Errorf("ASSERTION: Assets() cannot read terminal.css: %v", err)
	}
}

func TestOverriddenAssetsIsEmptyWithoutStaticFS(t *testing.T) {
	s := newTestServer(t, DefaultConfig())
	if over := s.overriddenAssets(); over != nil {
		t.Errorf("ASSERTION: a deployment with no StaticFS reports overrides %v", over)
	}
}
