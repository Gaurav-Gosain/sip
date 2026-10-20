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
		{host: "[::%lo]:0", err: "has a port"},
		{host: "0.0.0.0:1", err: "has a port"},
		{host: "127.0.0.1:7681", err: "has a port"},
		{host: "localhost:7681", err: "has a port"},
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
		password     bool // a user name and a password
		userOnly     bool // a user name and an empty password
		tls          bool // a certificate on the main listener
		want         bool
	}
	var cases []tc
	for _, bind := range []string{
		"127.0.0.1", "127.1", "0177.0.0.1", "LOCALHOST", "localhost.", "ip6-localhost", "arch-btw", "::1%lo", "",
		"0.0.0.0", "0", "0x0", "::", "[::]", "::%lo", "::ffff:0:0", "wildname",
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
		cases = append(cases,
			tc{bind: bind, header: "evil.example", password: true, want: false},
			tc{bind: bind, header: "evil.example", tls: true, want: false},
			tc{bind: bind, header: "evil.example", tls: true, password: true, want: false},
		)
	}
	// A user name with an empty password is no password: a rebinding page
	// can send it. With TLS, a rebound name is not in the certificate, so
	// the browser stops the page before the handshake.
	for _, bind := range []string{"0.0.0.0", "::", "::%lo"} {
		cases = append(cases,
			tc{bind: bind, header: "evil.example", userOnly: true, want: false},
			tc{bind: bind, header: "192.168.1.20", userOnly: true, want: true},
			tc{bind: bind, header: "myhost.local:7681", tls: true, want: true},
			tc{bind: bind, header: "hostname.local", tls: true, userOnly: true, want: true},
		)
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
		if c.userOnly {
			s.config.BasicUsername = "admin"
		}
		if c.tls {
			s.config.TLSCert, s.config.TLSKey = "server.crt", "server.key"
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
			t.Errorf("bind %q, allowed %q, password %v, user only %v, tls %v, Host %q: passed %v, want %v",
				c.bind, c.allowed, c.password, c.userOnly, c.tls, c.header, got, c.want)
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

// TestHostGuardBeforeResolve: a server whose bind is not resolved yet runs
// the check. A path that reads the bind too early must fail closed.
func TestHostGuardBeforeResolve(t *testing.T) {
	for _, host := range []string{"0.0.0.0", "192.0.2.10", "lanname"} {
		s := &httpServer{config: Config{Host: host, Port: "7681"}}
		mw := s.hostGuard()
		if mw == nil {
			t.Errorf("bind %q not resolved: no Host check", host)
			continue
		}
		r, _ := http.NewRequest(http.MethodGet, "/ws", nil)
		r.Host = "evil.example"
		if mw(func(*http.Request) error { return nil })(r) == nil {
			t.Errorf("bind %q not resolved: Host evil.example passed", host)
		}
	}
}
