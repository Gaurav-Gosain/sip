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
