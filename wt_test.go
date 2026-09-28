//go:build linux

package sip

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

// wtHarness serves handleWebTransport on a loopback QUIC listener and
// counts the handlers that are still running.
type wtHarness struct {
	url      string
	handlers atomic.Int32
	ends     chan time.Duration
	tr       *webtransport.Transport
}

func startWT(t *testing.T, srv *httpServer) *wtHarness {
	t.Helper()
	cert, err := GenerateSelfSignedCert("")
	if err != nil {
		t.Fatal(err)
	}
	h := &wtHarness{ends: make(chan time.Duration, 1000)}
	mux := http.NewServeMux()
	mux.HandleFunc("/webtransport", func(w http.ResponseWriter, r *http.Request) {
		h.handlers.Add(1)
		start := time.Now()
		srv.handleWebTransport(w, r)
		h.handlers.Add(-1)
		h.ends <- time.Since(start)
	})
	srv.wtServer = &webtransport.Server{
		H3: &http3.Server{
			TLSConfig:       http3.ConfigureTLSConfig(cert.TLSConfig),
			Handler:         mux,
			EnableDatagrams: true,
		},
		CheckOrigin: func(*http.Request) bool { return true },
	}
	udp, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.wtServer.Serve(udp) }()
	h.url = fmt.Sprintf("https://127.0.0.1:%d/webtransport", udp.LocalAddr().(*net.UDPAddr).Port)
	h.tr = &webtransport.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true, NextProtos: []string{http3.NextProtoH3}}}
	t.Cleanup(func() {
		_ = h.tr.Close()
		if n := h.handlers.Load(); n != 0 {
			// Closing the server would hang on the stuck handlers.
			t.Logf("server left open: %d handlers stuck", n)
			return
		}
		_ = srv.wtServer.Close()
		_ = udp.Close()
	})
	return h
}

type wtClient struct {
	sess   *webtransport.Session
	stream *webtransport.Stream
}

func (h *wtHarness) dial(t *testing.T, ctx context.Context) *wtClient {
	t.Helper()
	_, sess, err := h.tr.Dial(ctx, h.url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	st, err := sess.OpenStreamSync(ctx)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	rs, _ := json.Marshal(ResizeMessage{Cols: 80, Rows: 24})
	if err := writeFramed(st, append([]byte{MsgResize}, rs...)); err != nil {
		t.Fatalf("resize: %v", err)
	}
	return &wtClient{sess: sess, stream: st}
}

// readAll reads frames until the stream ends. It keeps at most keep bytes
// of output (all when keep < 0). It reports whether MsgClose came, and
// whether the stream then ended cleanly with EOF.
func (c *wtClient) readAll(keep int) (out string, sawClose, eof bool, err error) {
	var b strings.Builder
	lenBuf := make([]byte, 4)
	for {
		if _, err := io.ReadFull(c.stream, lenBuf); err != nil {
			return b.String(), sawClose, sawClose && err == io.EOF, err
		}
		n := binary.BigEndian.Uint32(lenBuf)
		if n > 1<<24 {
			return b.String(), sawClose, false, fmt.Errorf("bad frame length %d", n)
		}
		msg := make([]byte, n)
		if _, err := io.ReadFull(c.stream, msg); err != nil {
			return b.String(), sawClose, false, fmt.Errorf("partial frame: %w", err)
		}
		if sawClose {
			return b.String(), true, false, fmt.Errorf("frame after MsgClose: %q", msg[0])
		}
		if len(msg) == 0 {
			continue
		}
		switch msg[0] {
		case MsgOutput:
			if keep < 0 || b.Len() < keep {
				b.Write(msg[1:])
			}
		case MsgClose:
			sawClose = true
		}
	}
}

func sessionCount(srv *httpServer) int {
	n := 0
	srv.sessions.Range(func(_, _ any) bool { n++; return true })
	return n
}

// TestWTClientClosesAtEnd runs 80 sessions whose client closes the
// WebTransport session as soon as the stream ends, as the page does. Once
// the server had closed its send side, the input Read parked for the
// session close and was never woken. The handler then stayed forever,
// with its QUIC session and its connection slot.
func TestWTClientClosesAtEnd(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sh", args: []string{"-c", "printf " + finalMarker}})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	h := startWT(t, srv)

	const n = 80
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for range n {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			c := h.dial(t, ctx)
			out, saw, eof, err := c.readAll(-1)
			if !saw || !eof || !strings.Contains(out, finalMarker) {
				t.Errorf("bad end: MsgClose=%v EOF=%v marker=%v err=%v", saw, eof, strings.Contains(out, finalMarker), err)
			}
			_ = c.sess.CloseWithError(0, "")
		}()
	}
	wg.Wait()

	deadline := time.After(10 * time.Second)
	for ended := 0; ended < n; ended++ {
		select {
		case <-h.ends:
		case <-deadline:
			t.Fatalf("%d of %d handlers stuck after their client closed", h.handlers.Load(), n)
		}
	}
	if sessionCount(srv) != 0 || atomic.LoadInt32(&srv.connCount) != 0 {
		t.Fatalf("after all handlers ended: %d sessions, %d connections", sessionCount(srv), atomic.LoadInt32(&srv.connCount))
	}
}

// TestWTClientIgnoresClose covers a client that neither closes nor
// sends. The handler ends after the grace time.
func TestWTClientIgnoresClose(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sh", args: []string{"-c", "printf " + finalMarker}})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	h := startWT(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c := h.dial(t, ctx)
	out, saw, eof, err := c.readAll(-1)
	if !saw || !eof || !strings.Contains(out, finalMarker) {
		t.Fatalf("bad end: MsgClose=%v EOF=%v err=%v", saw, eof, err)
	}
	select {
	case d := <-h.ends:
		if d > wtCloseGrace+3*time.Second {
			t.Fatalf("handler held %v, want about %v", d, wtCloseGrace)
		}
	case <-time.After(wtCloseGrace + 10*time.Second):
		t.Fatal("handler did not end")
	}
}

// TestWTClientClosesFirst covers a client that leaves while the command
// still runs.
func TestWTClientClosesFirst(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sleep", args: []string{"30"}})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	h := startWT(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c := h.dial(t, ctx)
	time.Sleep(300 * time.Millisecond)
	_ = c.sess.CloseWithError(0, "")
	select {
	case <-h.ends:
	case <-time.After(10 * time.Second):
		t.Fatal("handler did not end")
	}
	if sessionCount(srv) != 0 {
		t.Fatal("session left in the map")
	}
}

// TestWTClientNeverReads covers a client that stops reading while the
// command writes a lot. The write timeout ends the handler.
func TestWTClientNeverReads(t *testing.T) {
	cfg := DefaultConfig()
	cfg.WriteTimeout = time.Second
	srv := newCmdHTTPServer(cfg, &CommandHandler{name: "sh", args: []string{"-c", "head -c 50000000 /dev/zero"}})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	h := startWT(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	_ = h.dial(t, ctx)
	select {
	case <-h.ends:
	case <-time.After(30 * time.Second):
		t.Fatal("handler did not end")
	}
	if sessionCount(srv) != 0 || atomic.LoadInt32(&srv.connCount) != 0 {
		t.Fatalf("%d sessions, %d connections left", sessionCount(srv), atomic.LoadInt32(&srv.connCount))
	}
}

// TestWTFloodAfterExit is TestFinalOutputFloodAfterExit over
// WebTransport. The frames must stay whole, MsgClose must come last, and
// the stream must end with EOF.
func TestWTFloodAfterExit(t *testing.T) {
	for i := range 3 {
		srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sh", args: []string{"-c", "printf 'pgid=%s;' $$; trap '' HUP; yes & sleep 0.2"}})
		srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
		h := startWT(t, srv)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		c := h.dial(t, ctx)
		out, saw, eof, err := c.readAll(64)
		killGroupFromOutput(t, out)
		_ = c.sess.CloseWithError(0, "")
		cancel()
		if !saw || !eof {
			t.Errorf("run %d: MsgClose=%v EOF=%v err=%v", i, saw, eof, err)
		}
		select {
		case <-h.ends:
		case <-time.After(15 * time.Second):
			buf := make([]byte, 1<<22)
			st := string(buf[:runtime.Stack(buf, true)])
			t.Errorf("run %d: handler stuck after the client closed (input parked for the session close: %v)",
				i, strings.Contains(st, "handleSessionGoneError"))
		}
	}
}
