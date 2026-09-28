//go:build !windows

package sip

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/coder/websocket"
)

const finalMarker = "final-message-before-close"

// holdOutputUntilDone delays the first output read until the session has
// ended. It puts the output loop in the worst position the scheduler can
// produce: the program has written its last bytes and exited, and nothing
// has been read yet.
func holdOutputUntilDone(next SessionIO) SessionIO {
	return &heldOutputSession{SessionIO: next}
}

type heldOutputSession struct {
	SessionIO
	once sync.Once
}

func (s *heldOutputSession) OutputReader() io.Reader {
	return readerFunc(func(p []byte) (int, error) {
		s.once.Do(func() { <-s.Done() })
		return s.SessionIO.OutputReader().Read(p)
	})
}

type readerFunc func([]byte) (int, error)

func (f readerFunc) Read(p []byte) (int, error) { return f(p) }

type finalModel struct{ write func() }

func (m finalModel) Init() tea.Cmd {
	return tea.Sequence(func() tea.Msg { m.write(); return nil }, tea.Quit)
}
func (m finalModel) Update(tea.Msg) (tea.Model, tea.Cmd) { return m, nil }
func (m finalModel) View() tea.View                      { return tea.NewView("") }

// runUntilClose dials the WebSocket endpoint, sends the initial resize,
// and collects output frames until the server sends MsgClose.
func runUntilClose(t *testing.T, srv *httpServer) string {
	t.Helper()
	out, err := readUntilClose(t, srv, -1)
	if err != nil {
		t.Fatalf("connection ended without MsgClose (output so far %q): %v", out, err)
	}
	return out
}

// readUntilClose is runUntilClose without the failure. It keeps at most
// keep bytes of output (all of it when keep < 0) and returns an error when
// the connection ends without MsgClose.
func readUntilClose(t *testing.T, srv *httpServer, keep int) (string, error) {
	t.Helper()
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

	resize, _ := json.Marshal(ResizeMessage{Cols: 80, Rows: 24})
	if err := conn.Write(ctx, websocket.MessageBinary, append([]byte{MsgResize}, resize...)); err != nil {
		t.Fatalf("resize: %v", err)
	}

	var out strings.Builder
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return out.String(), err
		}
		if len(data) == 0 {
			continue
		}
		switch data[0] {
		case MsgOutput:
			p := data[1:]
			if keep >= 0 && out.Len()+len(p) > keep {
				p = p[:max(0, keep-out.Len())]
			}
			out.Write(p)
		case MsgClose:
			return out.String(), nil
		}
	}
}

// killGroupFromOutput kills the process group whose id the command
// printed as "pgid=N;". Commands in these tests run in their own session,
// so the group holds the command and the children it left behind.
func killGroupFromOutput(t *testing.T, out string) {
	t.Helper()
	m := regexp.MustCompile(`pgid=(\d+);`).FindStringSubmatch(out)
	if m == nil {
		t.Errorf("no pgid in output %q", out)
		return
	}
	pgid, _ := strconv.Atoi(m[1])
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
}

// TestFinalOutputReachesClientBeforeClose covers a program that writes a
// last message and exits at once. The client must get that message before
// MsgClose, and the PTY master must be closed afterwards.
func TestFinalOutputReachesClientBeforeClose(t *testing.T) {
	var (
		mu     sync.Mutex
		master *os.File
	)
	handler := func(sess Session) *tea.Program {
		ws := sess.(*webSession)
		mu.Lock()
		master = ws.platform.ptyMaster
		mu.Unlock()
		m := finalModel{write: func() { _, _ = sess.Write([]byte(finalMarker)) }}
		// No input reader: bubbletea's reader can outlive Run and call Fd
		// on the slave while the session closes it, which -race reports.
		// That race is in bubbletea and does not bear on this test.
		return tea.NewProgram(m, append(MakeOptions(sess), tea.WithInput(nil))...)
	}

	cfg := DefaultConfig()
	cfg.SessionMiddleware = []SessionMiddleware{holdOutputUntilDone}
	srv := newHTTPServer(cfg, handler)
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}

	out := runUntilClose(t, srv)
	if !strings.Contains(out, finalMarker) {
		t.Fatalf("client got MsgClose without the final output; got %q", out)
	}

	mu.Lock()
	m := master
	mu.Unlock()
	waitClosed(t, m)
}

// TestFinalCommandOutputReachesClientBeforeClose is the same check for a
// spawned command. The session must also end on its own when the command
// exits, without the client going away first.
func TestFinalCommandOutputReachesClientBeforeClose(t *testing.T) {
	for _, held := range []bool{false, true} {
		name := "read as it arrives"
		if held {
			name = "read after exit"
		}
		t.Run(name, func(t *testing.T) {
			cfg := DefaultConfig()
			if held {
				cfg.SessionMiddleware = []SessionMiddleware{holdOutputUntilDone}
			}
			srv := newCmdHTTPServer(cfg, &CommandHandler{name: "sh", args: []string{"-c", "printf " + finalMarker}})
			srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}

			out := runUntilClose(t, srv)
			if !strings.Contains(out, finalMarker) {
				t.Fatalf("client got MsgClose without the final output; got %q", out)
			}
		})
	}
}

func waitClosed(t *testing.T, f *os.File) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := f.Stat(); errors.Is(err, os.ErrClosed) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("PTY master is still open after the session ended")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestFinalOutputDrainIsBounded covers a command that leaves a child
// holding the terminal. The master never reads EIO, so only the drain
// bound ends the session.
func TestFinalOutputDrainIsBounded(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("only Linux can end a pending PTY read (see pty_other.go)")
	}
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{
		name: "sh", args: []string{"-c", "printf 'pgid=%s;' $$; trap '' HUP; sleep 30 & printf " + finalMarker},
	})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}

	start := time.Now()
	out := runUntilClose(t, srv)
	took := time.Since(start)
	killGroupFromOutput(t, out)
	if !strings.Contains(out, finalMarker) {
		t.Fatalf("client got MsgClose without the final output; got %q", out)
	}
	if took > finalOutputDrain+3*time.Second {
		t.Fatalf("session took %v to end, want about %v", took, finalOutputDrain)
	}
}

// TestFinalOutputFloodAfterExit covers a background child that keeps
// writing after the command exits. The drain runs out while output still
// flows. MsgClose must still arrive: a write cut short by the drain bound
// closes the WebSocket, and the page then starts the command again.
func TestFinalOutputFloodAfterExit(t *testing.T) {
	for i := range 10 {
		srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{
			name: "sh", args: []string{"-c", "printf 'pgid=%s;' $$; trap '' HUP; yes & sleep 0.2"},
		})
		srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
		out, err := readUntilClose(t, srv, 64)
		killGroupFromOutput(t, out)
		if err != nil {
			t.Fatalf("run %d: connection ended without MsgClose: %v", i, err)
		}
	}
}

// fakeSession is a session whose output never ends. It has already ended.
type fakeSession struct {
	ctx    context.Context
	closed chan struct{}
	once   sync.Once
}

func newFakeSession() *fakeSession {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return &fakeSession{ctx: ctx, closed: make(chan struct{})}
}

func (f *fakeSession) OutputReader() io.Reader {
	return readerFunc(func(p []byte) (int, error) {
		select {
		case <-f.closed:
			return 0, os.ErrClosed
		default:
		}
		for i := range p {
			p[i] = 'y'
		}
		return len(p), nil
	})
}
func (f *fakeSession) InputWriter() io.Writer   { return io.Discard }
func (f *fakeSession) Resize(int, int)          {}
func (f *fakeSession) Done() <-chan struct{}    { return f.ctx.Done() }
func (f *fakeSession) Context() context.Context { return f.ctx }
func (f *fakeSession) Close() error             { f.once.Do(func() { close(f.closed) }); return nil }

// TestStreamOutputStopsAfterAFailedSend checks the rule both transports
// rely on. After a failed send the output loop sends nothing more. On
// WebTransport a failed write can leave a partial frame, and a MsgClose
// frame after it would break the client's length framing.
func TestStreamOutputStopsAfterAFailedSend(t *testing.T) {
	srv := &httpServer{config: DefaultConfig()}
	var sends, failedAt int
	send := func(_ context.Context, msg []byte) error {
		sends++
		if sends == 3 {
			failedAt = sends
			return errors.New("write deadline exceeded")
		}
		if failedAt != 0 {
			t.Errorf("send %d (type %q) after the failed send %d", sends, msg[0], failedAt)
		}
		return nil
	}
	srv.streamOutput(context.Background(), newFakeSession(), sessionInfo{id: "t"}, "test", send)
	if failedAt == 0 {
		t.Fatal("the failing send was never reached")
	}
}

// TestStreamOutputEndsAFloodWithMsgClose checks that a drain which runs
// out of time while output still flows ends with MsgClose.
func TestStreamOutputEndsAFloodWithMsgClose(t *testing.T) {
	srv := &httpServer{config: DefaultConfig()}
	var last byte
	send := func(_ context.Context, msg []byte) error {
		last = msg[0]
		return nil
	}
	start := time.Now()
	srv.streamOutput(context.Background(), newFakeSession(), sessionInfo{id: "t"}, "test", send)
	if last != MsgClose {
		t.Fatalf("last message type %q, want MsgClose", last)
	}
	if took := time.Since(start); took > finalOutputDrain+2*time.Second {
		t.Fatalf("drain took %v, want about %v", took, finalOutputDrain)
	}
}
