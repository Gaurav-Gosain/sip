package sip

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

// fakeResolver answers name lookups from a table, so a test sees what a cgo
// build, a private /etc/hosts or a LAN DNS server would answer.
type fakeResolver map[string][]string

func (f fakeResolver) LookupNetIP(_ context.Context, _, host string) ([]netip.Addr, error) {
	answers, ok := f[host]
	if !ok {
		return nil, errors.New("no such host")
	}
	addrs := make([]netip.Addr, len(answers))
	for i, a := range answers {
		addrs[i] = netip.MustParseAddr(a)
	}
	return addrs, nil
}

// testResolver holds what the reviews of tuios-web found. "0", "0x0",
// "127.1" and "0177.0.0.1" are how glibc's getaddrinfo reads inet_aton
// forms. "arch-btw" is the hostname line of /etc/hosts.
var testResolver = fakeResolver{
	"0":             {"0.0.0.0"},
	"0x0":           {"0.0.0.0"},
	"127.1":         {"127.0.0.1"},
	"0177.0.0.1":    {"127.0.0.1"},
	"localhost":     {"::1", "127.0.0.1"},
	"LOCALHOST":     {"127.0.0.1", "::1"},
	"localhost.":    {"127.0.0.1"},
	"ip6-localhost": {"::1"},
	"arch-btw":      {"127.0.1.1"},
	"wildname":      {"::ffff:0.0.0.0"},
	"lanname":       {"fd00::20", "192.168.1.20"},
	"v6name":        {"fd00::20"},
	"mixed":         {"127.0.0.1", "192.168.1.20"},
	"mixed-wild":    {"0.0.0.0", "127.0.0.1"},
	"llname":        {"fe80::1"},
	"empty":         {},
}

// TestResolveBindHost is every spelling of a bind host the tuios-web
// reviews tried. The address is what the listener binds, and the kind is
// what the checks read.
func TestResolveBindHost(t *testing.T) {
	for _, tc := range []struct {
		host, addr string
		kind       bindKind
		err        string
	}{
		{host: "", addr: "127.0.0.1", kind: bindLoopback},
		{host: "localhost", addr: "127.0.0.1", kind: bindLoopback},
		{host: "0.0.0.0", addr: "0.0.0.0", kind: bindUnspecified},
		{host: "0", addr: "0.0.0.0", kind: bindUnspecified},
		{host: "0x0", addr: "0.0.0.0", kind: bindUnspecified},
		{host: "::", addr: "::", kind: bindUnspecified},
		{host: "[::]", addr: "::", kind: bindUnspecified},
		{host: "::%lo", addr: "::", kind: bindUnspecified},
		{host: "[::%lo]:0", addr: "::", kind: bindUnspecified},
		{host: "::ffff:0:0", addr: "0.0.0.0", kind: bindUnspecified},
		{host: "wildname", addr: "0.0.0.0", kind: bindUnspecified},
		{host: "127.0.0.1", addr: "127.0.0.1", kind: bindLoopback},
		{host: "127.1", addr: "127.0.0.1", kind: bindLoopback},
		{host: "0177.0.0.1", addr: "127.0.0.1", kind: bindLoopback},
		{host: "::1%lo", addr: "::1", kind: bindLoopback},
		{host: "::ffff:127.0.0.1", addr: "127.0.0.1", kind: bindLoopback},
		{host: "LOCALHOST", addr: "127.0.0.1", kind: bindLoopback},
		{host: "localhost.", addr: "127.0.0.1", kind: bindLoopback},
		{host: "ip6-localhost", addr: "::1", kind: bindLoopback},
		{host: "arch-btw", addr: "127.0.1.1", kind: bindLoopback},
		{host: "192.0.2.10", addr: "192.0.2.10", kind: bindNetwork},
		{host: "fe80::1%eth0", addr: "fe80::1%eth0", kind: bindNetwork},
		{host: "lanname", addr: "192.168.1.20", kind: bindNetwork},
		{host: "v6name", addr: "fd00::20", kind: bindNetwork},
		{host: "mixed", err: "more than one kind"},
		{host: "mixed-wild", err: "more than one kind"},
		{host: "llname", err: "link-local"},
		{host: "empty", err: "no address"},
		{host: "nosuch", err: "cannot find the address"},
	} {
		addr, kind, err := resolveBindHost(context.Background(), testResolver, tc.host)
		if tc.err != "" {
			if err == nil || !strings.Contains(err.Error(), tc.err) {
				t.Errorf("%q: got %q (%v), err %v; want an error with %q", tc.host, addr, kind, err, tc.err)
			}
			continue
		}
		if err != nil || addr != tc.addr || kind != tc.kind {
			t.Errorf("%q: got %q (%v), err %v; want %q (%v)", tc.host, addr, kind, err, tc.addr, tc.kind)
		}
	}
}

// TestHostGuard is the Host check for each kind of bind. A loopback bind
// keeps its rules. An unspecified bind checks too, and lets every IP
// address through, because a rebinding page always sends a name. A bind to
// one network address is not checked.
func TestHostGuard(t *testing.T) {
	type tc struct {
		bind, header string
		allowed      []string
		password     bool
		want         bool
	}
	var cases []tc
	for _, bind := range []string{
		"127.0.0.1", "127.1", "0177.0.0.1", "LOCALHOST", "localhost.", "ip6-localhost", "arch-btw", "::1%lo", "",
		"0.0.0.0", "0", "0x0", "::", "[::]", "::%lo", "[::%lo]:0", "::ffff:0:0", "wildname",
	} {
		cases = append(cases,
			tc{bind: bind, header: "evil.example:7681", want: false},
			tc{bind: bind, header: "127.0.0.1.nip.io", want: false},
			tc{bind: bind, header: "127.0.0.1:7681", want: true},
			tc{bind: bind, header: "[::1]:7681", want: true},
			tc{bind: bind, header: "localhost:7681", want: true},
			tc{bind: bind, header: "app.localhost", want: true},
			tc{bind: bind, header: "term.example", allowed: []string{"term.example"}, want: true},
			tc{bind: bind, header: "evil.example", allowed: []string{"*"}, want: true},
		)
	}
	for _, bind := range []string{"127.0.0.1", "LOCALHOST", "arch-btw", ""} {
		cases = append(cases,
			tc{bind: bind, header: "192.168.1.20:7681", want: false},
			tc{bind: bind, header: "[fd00::20]:7681", want: false},
		)
	}
	for _, bind := range []string{"0.0.0.0", "0", "::", "::%lo", "::ffff:0:0"} {
		cases = append(cases,
			tc{bind: bind, header: "192.168.1.20:7681", want: true},
			tc{bind: bind, header: "[fd00::20]:7681", want: true},
			tc{bind: bind, header: "192.168.1.20", want: true},
			tc{bind: bind, header: "myhost.local:7681", want: false},
		)
	}
	// With Basic Auth, an unspecified bind is not checked: a rebinding page
	// does not know the password, and a machine name must work. A loopback
	// bind is checked whatever the auth.
	for _, bind := range []string{"0.0.0.0", "0", "::", "::%lo", "::ffff:0:0"} {
		cases = append(cases,
			tc{bind: bind, header: "myhost.local:7681", password: true, want: true},
			tc{bind: bind, header: "box.tailnet.ts.net", password: true, want: true},
		)
	}
	for _, bind := range []string{"127.0.0.1", "LOCALHOST", "::1%lo"} {
		cases = append(cases, tc{bind: bind, header: "evil.example", password: true, want: false})
	}
	// The name as typed passes, so a server bound by name opens by name.
	cases = append(cases,
		tc{bind: "LOCALHOST", header: "LOCALHOST:7681", want: true},
		tc{bind: "arch-btw", header: "arch-btw:7681", want: true},
		tc{bind: "192.0.2.10", header: "evil.example", want: true},
		tc{bind: "fe80::1%eth0", header: "evil.example", want: true},
		tc{bind: "lanname", header: "evil.example", want: true},
	)

	for _, c := range cases {
		s := &httpServer{
			config:   Config{Host: c.bind, Port: "7681", AllowInsecureNoTLS: true, AllowedHosts: c.allowed},
			resolver: testResolver,
		}
		if c.password {
			s.config.BasicUsername, s.config.BasicPassword = "u", "p"
		}
		if err := s.validateConfig(); err != nil {
			t.Fatalf("bind %q: %v", c.bind, err)
		}
		got := true
		if mw := s.hostGuard(); mw != nil {
			r, _ := http.NewRequest(http.MethodGet, "/ws", nil)
			r.Host = c.header
			got = mw(func(*http.Request) error { return nil })(r) == nil
		}
		if got != c.want {
			t.Errorf("bind %q, allowed %q, password %v, Host %q: passed %v, want %v", c.bind, c.allowed, c.password, c.header, got, c.want)
		}
	}
}

// TestLoopbackNameNeedsNoTLS: a name that resolves only to loopback is a
// loopback bind, so it gets no TLS refusal. A name for a network address
// still needs TLS.
func TestLoopbackNameNeedsNoTLS(t *testing.T) {
	for host, ok := range map[string]bool{"arch-btw": true, "LOCALHOST": true, "127.1": true, "lanname": false, "0": false} {
		s := &httpServer{config: Config{Host: host, Port: "7681"}, resolver: testResolver}
		if err := s.validateConfig(); (err == nil) != ok {
			t.Errorf("%q without TLS: err %v, want accepted %v", host, err, ok)
		}
	}
}
