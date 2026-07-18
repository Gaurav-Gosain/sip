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
