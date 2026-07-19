package sip

import (
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
