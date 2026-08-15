package sip

import (
	"strings"
	"testing"
	"time"
)

// TestWriteTimeoutOrDefault checks zero picks the default, negative disables
// the deadline (0), and a positive value passes through.
func TestWriteTimeoutOrDefault(t *testing.T) {
	if got := writeTimeoutOrDefault(0); got != defaultWriteTimeout {
		t.Fatalf("zero = %v, want default %v", got, defaultWriteTimeout)
	}
	if got := writeTimeoutOrDefault(-1); got != 0 {
		t.Fatalf("negative = %v, want 0 (disabled)", got)
	}
	if got := writeTimeoutOrDefault(5 * time.Second); got != 5*time.Second {
		t.Fatalf("positive = %v, want 5s", got)
	}
}

// TestWTURLFromHost checks the advertised WebTransport endpoint reuses the
// hostname the browser reached the HTTP server on and swaps in the QUIC port.
func TestWTURLFromHost(t *testing.T) {
	tests := []struct {
		name    string
		reqHost string
		wtPort  string
		want    string
	}{
		{name: "loopback with port", reqHost: "127.0.0.1:7681", wtPort: "7682", want: "https://127.0.0.1:7682/webtransport"},
		{name: "hostname with port", reqHost: "term.example.com:8080", wtPort: "8081", want: "https://term.example.com:8081/webtransport"},
		{name: "host without port", reqHost: "localhost", wtPort: "7682", want: "https://localhost:7682/webtransport"},
		{name: "ipv6 with port", reqHost: "[::1]:7681", wtPort: "7682", want: "https://[::1]:7682/webtransport"},
		{name: "empty host falls back to loopback", reqHost: "", wtPort: "7682", want: "https://127.0.0.1:7682/webtransport"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := wtURLFromHost(tt.reqHost, tt.wtPort); got != tt.want {
				t.Fatalf("wtURLFromHost(%q, %q) = %q, want %q", tt.reqHost, tt.wtPort, got, tt.want)
			}
		})
	}
}

// TestRenderIndexMobileKeys checks the touch key bar's key set survives the
// trip into the page: the JS reads window.__sipConfig.mobileKeys, so the JSON
// field names are part of the contract, not an implementation detail. The
// default is no blob at all, which is what makes the bar fall back to its own
// key set.
func TestRenderIndexMobileKeys(t *testing.T) {
	const page = "<head>{{FONT_FACE_EXTRA}}</head>"

	plain := &httpServer{config: Config{}}
	if got := string(plain.renderIndex([]byte(page))); strings.Contains(got, "__sipConfig") {
		t.Fatalf("default config injected a blob: %s", got)
	}

	s := &httpServer{config: Config{
		MobileKeys: []MobileKey{
			{Label: "esc", Title: "Escape", Key: "Escape"},
			{Label: "^C", Key: "c", Ctrl: true},
			{Label: "ctrl", Mod: "ctrl"},
		},
	}}
	got := string(s.renderIndex([]byte(page)))
	for _, want := range []string{
		`"mobileKeys"`,
		`{"label":"esc","title":"Escape","key":"Escape"}`,
		`{"label":"^C","key":"c","ctrl":true}`,
		`{"label":"ctrl","mod":"ctrl"}`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("rendered index missing %s:\n%s", want, got)
		}
	}

	off := &httpServer{config: Config{DisableMobileKeyBar: true}}
	if got := string(off.renderIndex([]byte(page))); !strings.Contains(got, `"mobileKeyBar":false`) {
		t.Fatalf("DisableMobileKeyBar did not reach the page: %s", got)
	}
}

// TestRenderIndexMobileRowsAndPrefix pins the other half of the same contract.
// The client reads these field names off window.__sipConfig, so a rename here
// is a silently dead key bar: the page keeps loading and every chord button
// stops meaning anything.
func TestRenderIndexMobileRowsAndPrefix(t *testing.T) {
	const page = "<head>{{FONT_FACE_EXTRA}}</head>"

	// A deployment driven by a leader, tmux-style, which is the case the
	// whole feature exists for.
	s := &httpServer{config: Config{
		MobilePrefix: MobilePrefix{Key: "b", Code: "KeyB", Ctrl: true},
		MobileRows: []MobileRow{
			{
				Label:       "Windows",
				Collapsible: true,
				Keys: []MobileKey{
					{Label: "pfx", Title: "Prefix", Prefix: true},
					{Label: "new", Key: "c", Code: "KeyC", Prefixed: true},
				},
			},
			{Keys: []MobileKey{{Label: "esc", Key: "Escape"}}},
		},
	}}
	got := string(s.renderIndex([]byte(page)))
	for _, want := range []string{
		`"mobilePrefix":{"key":"b","code":"KeyB","ctrl":true}`,
		`"mobileRows"`,
		`"label":"Windows"`,
		`"collapsible":true`,
		`{"label":"pfx","title":"Prefix","prefix":true}`,
		`{"label":"new","key":"c","code":"KeyC","prefixed":true}`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("rendered index missing %s:\n%s", want, got)
		}
	}

	// No prefix is the zero value and the state every existing deployment
	// is in. It must not reach the page at all, or the client would build a
	// prefix button that arms a chord it can never send.
	none := &httpServer{config: Config{MobileKeys: []MobileKey{{Label: "esc", Key: "Escape"}}}}
	if got := string(none.renderIndex([]byte(page))); strings.Contains(got, "mobilePrefix") {
		t.Fatalf("an unset prefix reached the page: %s", got)
	}
}

// TestDefaultMobileKeysMatchTheClient guards the one duplicated table in the
// project. The client has its own DEFAULT_KEYS because mobile.js is standalone
// and installable on a page sip never rendered; the Go copy exists so a
// deployment declaring MobileRows can put its own chords above the default
// typing row rather than instead of it. Two copies drift, and the drift is
// invisible: both halves keep working and quietly disagree about what the bar
// says.
func TestDefaultMobileKeysMatchTheClient(t *testing.T) {
	src, err := staticFiles.ReadFile("static/mobile.js")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	start := strings.Index(body, "const DEFAULT_KEYS = [")
	if start < 0 {
		t.Fatal("DEFAULT_KEYS is gone from static/mobile.js")
	}
	end := strings.Index(body[start:], "];")
	if end < 0 {
		t.Fatal("DEFAULT_KEYS is not terminated")
	}
	table := body[start : start+end]

	keys := DefaultMobileKeys()
	if got, want := strings.Count(table, "{ label:"), len(keys); got != want {
		t.Fatalf("the client table has %d keys, DefaultMobileKeys has %d", got, want)
	}
	for _, k := range keys {
		for _, want := range []string{
			"label: '" + k.Label + "'",
			"title: '" + k.Title + "'",
		} {
			if !strings.Contains(table, want) {
				t.Errorf("client DEFAULT_KEYS is missing %s", want)
			}
		}
		if k.Code != "" && !strings.Contains(table, "code: '"+k.Code+"'") {
			t.Errorf("client DEFAULT_KEYS is missing code: '%s'", k.Code)
		}
	}
}
