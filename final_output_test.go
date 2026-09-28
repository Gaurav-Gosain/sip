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
	"strings"
	"sync"
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
	hs := httptest.NewServer(http.HandlerFunc(srv.handleWebSocket))
	defer hs.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(hs.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	resize, _ := json.Marshal(ResizeMessage{Cols: 80, Rows: 24})
	if err := conn.Write(ctx, websocket.MessageBinary, append([]byte{MsgResize}, resize...)); err != nil {
		t.Fatalf("resize: %v", err)
	}

	var out strings.Builder
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("connection ended without MsgClose (output so far %q): %v", out.String(), err)
		}
		if len(data) == 0 {
			continue
		}
		switch data[0] {
		case MsgOutput:
			out.Write(data[1:])
		case MsgClose:
			return out.String()
		}
	}
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
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{
		name: "sh", args: []string{"-c", "trap '' HUP; sleep 5 & printf " + finalMarker},
	})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}

	start := time.Now()
	out := runUntilClose(t, srv)
	if !strings.Contains(out, finalMarker) {
		t.Fatalf("client got MsgClose without the final output; got %q", out)
	}
	if took := time.Since(start); took > finalOutputDrain+3*time.Second {
		t.Fatalf("session took %v to end, want about %v", took, finalOutputDrain)
	}
}
