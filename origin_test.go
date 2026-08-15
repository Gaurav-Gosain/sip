package sip

import (
	"net/http/httptest"
	"testing"
)

// TestOriginPatternsDefaultSameOrigin asserts the default (no configured
// origins) no longer opts into any-origin via a "*" wildcard.
func TestOriginPatternsDefaultSameOrigin(t *testing.T) {
	s := &httpServer{config: DefaultConfig()}
	if got := s.originPatterns(); len(got) != 0 {
		t.Fatalf("default originPatterns = %v, want empty (same-origin only)", got)
	}
}

// TestCheckOriginAcceptsOwnHTTPOrigin covers the split-port layout: the
// page is served from the HTTP listener (port 7681) but dials the
// WebTransport endpoint on 7682, so the Origin never equals the request
// Host. The HTTP origin must be accepted while foreign origins on either
// port stay rejected.
func TestCheckOriginAcceptsOwnHTTPOrigin(t *testing.T) {
	tests := []struct {
		name       string
		httpPort   string
		host       string
		origin     string
		want       bool
		wantReason string
	}{
		{
			name: "page served from the HTTP listener is accepted",
			host: "localhost:7682", origin: "http://localhost:7681", want: true,
			wantReason: "same host, HTTP port",
		},
		{
			name: "loopback IP form is accepted",
			host: "127.0.0.1:7682", origin: "http://127.0.0.1:7681", want: true,
			wantReason: "same host, HTTP port",
		},
		{
			name: "the WebTransport origin itself is accepted",
			host: "localhost:7682", origin: "https://localhost:7682", want: true,
			wantReason: "exact host match",
		},
		{
			name: "foreign host on the HTTP port is rejected",
			host: "localhost:7682", origin: "http://evil.example:7681", want: false,
			wantReason: "hostname differs",
		},
		{
			name: "same host on an unrelated port is rejected",
			host: "localhost:7682", origin: "http://localhost:9999", want: false,
			wantReason: "neither the HTTP nor the WT port",
		},
		{
			name: "portless foreign origin is rejected",
			host: "localhost:7682", origin: "https://evil.example", want: false,
			wantReason: "hostname differs",
		},
		{
			name:     "non-default HTTP port is honoured",
			httpPort: "9000",
			host:     "localhost:9001", origin: "http://localhost:9000", want: true,
			wantReason: "same host, configured HTTP port",
		},
		{
			name:     "old HTTP port is rejected once the port is reconfigured",
			httpPort: "9000",
			host:     "localhost:9001", origin: "http://localhost:7681", want: false,
			wantReason: "not the configured HTTP port",
		},
		{
			name:     "proxied https origin on the default port is accepted",
			httpPort: "443",
			host:     "app.example.com:7682", origin: "https://app.example.com", want: true,
			wantReason: "implicit 443 matches the configured HTTP port",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig()
			if tc.httpPort != "" {
				cfg.Port = tc.httpPort
			}
			s := &httpServer{config: cfg}

			r := httptest.NewRequest("GET", "https://"+tc.host+"/webtransport", nil)
			r.Host = tc.host
			r.Header.Set("Origin", tc.origin)

			if got := s.checkOrigin(r); got != tc.want {
				t.Errorf("checkOrigin(host=%q, origin=%q) = %v, want %v (%s)",
					tc.host, tc.origin, got, tc.want, tc.wantReason)
			}
		})
	}
}

// TestCheckOriginAllowlistStillApplies asserts the own-origin allowance did
// not weaken the explicit allowlist or the wildcard opt-in.
func TestCheckOriginAllowlistStillApplies(t *testing.T) {
	tests := []struct {
		name    string
		origins []string
		want    bool
	}{
		{name: "foreign origin rejected by default", origins: nil, want: false},
		{name: "allowlisted foreign origin accepted", origins: []string{"other.example:7681"}, want: true},
		{name: "wildcard opts into any origin", origins: []string{"*"}, want: true},
		{name: "unrelated allowlist still rejects", origins: []string{"good.example"}, want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.OriginPatterns = tc.origins
			s := &httpServer{config: cfg}

			r := httptest.NewRequest("GET", "https://localhost:7682/webtransport", nil)
			r.Host = "localhost:7682"
			r.Header.Set("Origin", "http://other.example:7681")

			if got := s.checkOrigin(r); got != tc.want {
				t.Errorf("checkOrigin(origins=%v) = %v, want %v", tc.origins, got, tc.want)
			}
		})
	}
}

func TestCheckOrigin(t *testing.T) {
	tests := []struct {
		name    string
		origins []string
		host    string
		origin  string
		want    bool
	}{
		{name: "no origin header passes", host: "app.example.com", origin: "", want: true},
		{name: "same origin allowed", host: "app.example.com", origin: "https://app.example.com", want: true},
		{name: "cross origin rejected by default", host: "app.example.com", origin: "https://evil.example", want: false},
		{name: "allowlisted origin allowed", origins: []string{"good.example"}, host: "app.example.com", origin: "https://good.example", want: true},
		{name: "glob allowlist allowed", origins: []string{"*.example.com"}, host: "app.example.com", origin: "https://api.example.com", want: true},
		{name: "explicit wildcard opts into any origin", origins: []string{"*"}, host: "app.example.com", origin: "https://evil.example", want: true},
		{name: "unrelated allowlist still rejects", origins: []string{"good.example"}, host: "app.example.com", origin: "https://evil.example", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.OriginPatterns = tc.origins
			s := &httpServer{config: cfg}

			r := httptest.NewRequest("GET", "https://"+tc.host+"/webtransport", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if got := s.checkOrigin(r); got != tc.want {
				t.Errorf("checkOrigin(host=%q, origin=%q) = %v, want %v", tc.host, tc.origin, got, tc.want)
			}
		})
	}
}
