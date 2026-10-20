//go:build unix

package sip

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

// freePortPair finds a loopback port p where p and p+1 are both free. sip
// binds HTTP on p and WebTransport on p+1.
func freePortPair(t *testing.T) string {
	t.Helper()
	for range 50 {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		p := l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
		l2, err := net.ListenPacket("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(p+1)))
		if err != nil {
			continue
		}
		_ = l2.Close()
		return strconv.Itoa(p)
	}
	t.Fatal("no free port pair")
	return ""
}

// startShell runs `sip -- sh` on a loopback port through the public API,
// the same path the CLI takes, and returns the port once /health answers.
func startShell(t *testing.T, cfg Config) string {
	t.Helper()
	cfg.Host = "127.0.0.1"
	_, port := startShellOn(t, cfg, nil)
	return port
}

// startShellOn is startShell on cfg.Host, with the bind host looked up by
// resolver (nil for the system's). sip listens on 127.0.0.1 for every bind
// these tests use, so the probes dial there.
func startShellOn(t *testing.T, cfg Config, resolver hostResolver) (*Server, string) {
	t.Helper()
	port := freePortPair(t)
	cfg.Port = port
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	srv := NewServer(cfg)
	srv.resolver = resolver
	go func() { done <- srv.ServeCommand(ctx, "sh", nil, "") }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("server did not stop")
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get("http://127.0.0.1:" + port + "/health")
		if err == nil {
			_ = resp.Body.Close()
			return srv, port
		}
		select {
		case err := <-done:
			t.Fatalf("server stopped: %v", err)
		case <-time.After(20 * time.Millisecond):
		}
	}
	t.Fatal("server did not start")
	return nil, ""
}

// rebind is the audit's `wsharness -mode rebind` repro. It dials the
// loopback server with the Host and Origin a DNS rebinding page sends, types
// a command, and reports whether the shell ran it.
func rebind(t *testing.T, port, host, origin string) (ran bool, dialErr error) {
	t.Helper()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	return rebindWith(t, port, host, h)
}

// rebindWith is rebind with any request headers, such as Authorization.
func rebindWith(t *testing.T, port, host string, h http.Header) (ran bool, dialErr error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://127.0.0.1:"+port+"/ws", &websocket.DialOptions{HTTPHeader: h, Host: host})
	if err != nil {
		return false, err
	}
	defer func() { _ = c.CloseNow() }()
	c.SetReadLimit(4 << 20)
	if err := c.Write(ctx, websocket.MessageBinary, []byte(`2{"cols":120,"rows":40}`)); err != nil {
		return false, err
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte("0echo PWNED-$((6*7))\r")); err != nil {
		return false, err
	}
	var all []byte
	for {
		_, d, err := c.Read(ctx)
		if err != nil {
			return false, nil
		}
		if len(d) > 0 && d[0] == MsgOutput {
			all = append(all, d[1:]...)
		}
		if bytes.Contains(all, []byte("PWNED-42")) {
			return true, nil
		}
	}
}

// TestDNSRebindingIsRefused: a page on attacker.example that rebinds its
// name to 127.0.0.1 sends Host and Origin both set to its own name. The
// origin check passes that, so before the Host check the shell ran the
// page's command.
func TestDNSRebindingIsRefused(t *testing.T) {
	port := startShell(t, DefaultConfig())

	ran, err := rebind(t, port, "attacker.example:"+port, "http://attacker.example:"+port)
	if ran {
		t.Fatal("rebinding page got a shell: PWNED-42 in the output")
	}
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("rebinding handshake: want a 403 refusal, got %v", err)
	}

	// The same harness reaches the shell under a name this machine owns, so
	// a refusal above is the Host check and not a broken harness.
	for _, host := range []string{"127.0.0.1:" + port, "localhost:" + port, "[::1]:" + port, "app.localhost:" + port} {
		if ran, err := rebind(t, port, host, ""); !ran {
			t.Errorf("Host %s: the shell did not run the command (err %v)", host, err)
		}
	}
}

// TestAllowedHostsAdmitsAProxyName covers a reverse proxy on the same
// machine that forwards the public Host header, and the "*" opt-out.
func TestAllowedHostsAdmitsAProxyName(t *testing.T) {
	cfg := DefaultConfig()
	cfg.AllowedHosts = []string{"Term.Example."}
	port := startShell(t, cfg)
	if ran, err := rebind(t, port, "term.example", ""); !ran {
		t.Errorf("allowed host refused: %v", err)
	}
	if ran, _ := rebind(t, port, "other.example", ""); ran {
		t.Error("a name not on AllowedHosts reached the shell")
	}

	cfg.AllowedHosts = []string{"*"}
	port = startShell(t, cfg)
	if ran, err := rebind(t, port, "any.example", ""); !ran {
		t.Errorf(`AllowedHosts "*" still checks the host: %v`, err)
	}
}

// TestWildcardBindChecksHost: 0.0.0.0 listens on loopback too, so a page
// that rebinds its name to 127.0.0.1 reached the shell of a server bound
// there. The Host check now runs on it. An IP address in Host still passes,
// so a phone that opens the LAN address keeps working.
func TestWildcardBindChecksHost(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Host = "0.0.0.0"
	cfg.AllowInsecureNoTLS = true
	_, port := startShellOn(t, cfg, nil)

	ran, err := rebind(t, port, "evil.example:"+port, "http://evil.example:"+port)
	if ran {
		t.Fatal("rebinding page got a shell on a 0.0.0.0 bind: PWNED-42 in the output")
	}
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("rebinding handshake on 0.0.0.0: want a 403 refusal, got %v", err)
	}
	for _, host := range []string{"192.0.2.1:" + port, "127.0.0.1:" + port, "[fd00::20]:" + port, "localhost:" + port} {
		if ran, err := rebind(t, port, host, ""); !ran {
			t.Errorf("Host %s on 0.0.0.0: the shell did not run the command (err %v)", host, err)
		}
	}
}

// TestWildcardBindWithPasswordAnswersMachineNames: with Basic Auth, a
// 0.0.0.0 bind is not Host-checked. People open it by machine name
// (myhost.local, a Tailscale name), and a rebinding page does not know the
// password. The password still guards the shell.
func TestWildcardBindWithPasswordAnswersMachineNames(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Host = "0.0.0.0"
	cfg.AllowInsecureNoTLS = true
	cfg.BasicUsername, cfg.BasicPassword = "user", "secret"
	_, port := startShellOn(t, cfg, nil)

	auth := http.Header{}
	auth.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("user:secret")))
	for _, host := range []string{"myhost.local:" + port, "box.tailnet.ts.net:" + port} {
		if ran, err := rebindWith(t, port, host, auth); !ran {
			t.Errorf("Host %s with the password: the shell did not run the command (err %v)", host, err)
		}
	}
	ran, err := rebindWith(t, port, "myhost.local:"+port, http.Header{})
	if ran || err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("Host myhost.local without the password: ran %v, err %v; want a 401", ran, err)
	}
}

// TestNamedBindListensOnResolvedAddress: a bind host that is a name is
// looked up once. Both listeners bind the address, and the Host check reads
// it. "termbox.test" exists only in the fake resolver, so a listener that
// looked the name up again could not start.
func TestNamedBindListensOnResolvedAddress(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Host = "termbox.test"
	srv, port := startShellOn(t, cfg, fakeResolver{"termbox.test": {"127.0.0.1"}})

	if ran, err := rebind(t, port, "evil.example:"+port, ""); ran || err == nil || !strings.Contains(err.Error(), "403") {
		t.Errorf("rebinding handshake on a loopback name: ran %v, err %v; want a 403 refusal", ran, err)
	}
	if ran, err := rebind(t, port, "termbox.test:"+port, ""); !ran {
		t.Errorf("Host termbox.test: the shell did not run the command (err %v)", err)
	}

	// WebTransport listens on the same address and runs the same check.
	p, _ := strconv.Atoi(port)
	wtPort := strconv.Itoa(p + 1)
	if got, want := srv.server.wtServer.H3.Addr, net.JoinHostPort("127.0.0.1", wtPort); got != want {
		t.Errorf("WebTransport listens on %s, want %s", got, want)
	}
	tr := &webtransport.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true, NextProtos: []string{http3.NextProtoH3}},
		// Every name dials the loopback listener, so the URL sets Host.
		DialAddr: func(ctx context.Context, _ string, tlsCfg *tls.Config, qcfg *quic.Config) (*quic.Conn, error) {
			return quic.DialAddrEarly(ctx, net.JoinHostPort("127.0.0.1", wtPort), tlsCfg, qcfg)
		},
	}
	defer func() { _ = tr.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for host, want := range map[string]bool{"evil.example": false, "127.0.0.1": true, "termbox.test": true} {
		resp, sess, err := tr.Dial(ctx, "https://"+net.JoinHostPort(host, wtPort)+"/webtransport", nil)
		if sess != nil {
			_ = sess.CloseWithError(0, "")
		}
		if got := err == nil; got != want {
			status := 0
			if resp != nil {
				status = resp.StatusCode
			}
			t.Errorf("WebTransport Host %s: opened %v (status %d, err %v), want %v", host, got, status, err, want)
		}
	}
}

// TestIndexRefusesFraming: a page of another origin that frames the
// terminal gets the keys typed into the frame, and the frame's own origin
// passes the WebSocket origin check. The headers stop the browser from
// drawing the frame.
func TestIndexRefusesFraming(t *testing.T) {
	t.Run("FrameAncestors", func(t *testing.T) {
		cfg := DefaultConfig()
		cfg.FrameAncestors = []string{"https://app.example.com", "https://b.example; script-src *"}
		h := http.Header{}
		newHTTPServer(cfg, nil).setFrameHeaders(h)
		if got := h.Get("Content-Security-Policy"); got != "frame-ancestors 'self' https://app.example.com" {
			t.Errorf("Content-Security-Policy = %q", got)
		}
		if got := h.Get("X-Frame-Options"); got != "" {
			t.Errorf("X-Frame-Options = %q, want none: it would refuse the listed origin", got)
		}
		if err := newHTTPServer(cfg, nil).validateConfig(); err == nil {
			t.Error("a FrameAncestors entry that adds a directive was accepted")
		}
	})
	for _, allow := range []bool{false, true} {
		t.Run(fmt.Sprintf("AllowFraming=%v", allow), func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.AllowFraming = allow
			hs := httptest.NewServer(http.HandlerFunc(newHTTPServer(cfg, nil).handleIndex))
			defer hs.Close()
			resp, err := http.Get(hs.URL + "/")
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("index status %d", resp.StatusCode)
			}
			csp, xfo := resp.Header.Get("Content-Security-Policy"), resp.Header.Get("X-Frame-Options")
			if allow {
				if csp != "" || xfo != "" {
					t.Errorf("AllowFraming still sends CSP %q, X-Frame-Options %q", csp, xfo)
				}
				return
			}
			if csp != "frame-ancestors 'self'" {
				t.Errorf("Content-Security-Policy = %q, want frame-ancestors 'self'", csp)
			}
			if xfo != "SAMEORIGIN" {
				t.Errorf("X-Frame-Options = %q, want SAMEORIGIN", xfo)
			}
		})
	}
}

// TestOversizedResizeIsClamped: one 2048x2048 resize took a server from
// 17 MB to 970 MB. The PTY must never be sized past the cell cap, on the
// first resize or a later one, and the session must stay up.
func TestOversizedResizeIsClamped(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{
		name: "sh",
		args: []string{"-c", `stty size; read a; stty size; read b`},
	})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	hs := httptest.NewServer(http.HandlerFunc(srv.handleWebSocket))
	defer hs.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(hs.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(-1)

	send := func(b []byte) {
		if err := conn.Write(ctx, websocket.MessageBinary, b); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	resize := func(cols, rows int) {
		b, _ := json.Marshal(ResizeMessage{Cols: cols, Rows: rows, WidthPx: cols * 8, HeightPx: rows * 16})
		send(append([]byte{MsgResize}, b...))
	}

	sizeRe := regexp.MustCompile(`(\d+) (\d+)\r?\n`)
	var out []byte
	nextSize := func() (cols, rows int) {
		t.Helper()
		for {
			if m := sizeRe.FindSubmatchIndex(out); m != nil {
				rows, _ = strconv.Atoi(string(out[m[2]:m[3]]))
				cols, _ = strconv.Atoi(string(out[m[4]:m[5]]))
				out = out[m[1]:]
				return cols, rows
			}
			_, d, err := conn.Read(ctx)
			if err != nil {
				var ce websocket.CloseError
				if errors.As(err, &ce) {
					t.Fatalf("server closed the session: %v", ce)
				}
				t.Fatalf("read: %v (output %q)", err, out)
			}
			if len(d) > 0 && d[0] == MsgOutput {
				out = append(out, d[1:]...)
			}
		}
	}
	check := func(when string, cols, rows int) {
		t.Helper()
		if cols*rows > defaultMaxWindowCells || cols > defaultMaxWindowCols || rows > defaultMaxWindowRows {
			t.Errorf("%s: PTY is %dx%d (%d cells), want at most %dx%d and %d cells",
				when, cols, rows, cols*rows, defaultMaxWindowCols, defaultMaxWindowRows, defaultMaxWindowCells)
		}
		if cols != defaultMaxWindowCols {
			t.Errorf("%s: PTY has %d columns, want the column cap %d kept", when, cols, defaultMaxWindowCols)
		}
	}

	resize(2048, 2048)
	cols, rows := nextSize()
	check("first resize 2048x2048", cols, rows)

	resize(4096, 4096)
	time.Sleep(200 * time.Millisecond) // past the resize throttle
	send([]byte("0\r"))
	cols, rows = nextSize()
	check("later resize 4096x4096", cols, rows)
}

// TestHostAllowed is the table for the Host check's parsing.
func TestHostAllowed(t *testing.T) {
	allowed := []string{"term.example", "[fd00::1]"}
	for host, want := range map[string]bool{
		"127.0.0.1:7681":         true,
		"127.1.2.3":              true,
		"[::1]:7681":             true,
		"localhost:7681":         true,
		"LOCALHOST.":             true,
		"x.localhost:7681":       true,
		"term.example:443":       true,
		"TERM.example.":          true,
		"[fd00::1]:7681":         true,
		"":                       false,
		"attacker.example:7681":  false,
		"localhost.attacker.com": false,
		"127.0.0.1.nip.io":       false,
		"term.example.evil":      false,
		"0.0.0.0:7681":           false,
	} {
		if got := hostAllowed(host, allowed); got != want {
			t.Errorf("hostAllowed(%q) = %v, want %v", host, got, want)
		}
	}
}
