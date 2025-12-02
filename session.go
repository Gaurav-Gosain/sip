package sip

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
	xpty "github.com/charmbracelet/x/xpty"
)

// webSession implements the Session interface for web terminal connections.
type webSession struct {
	id            string
	program       *tea.Program
	pty           xpty.Pty
	ptyMaster     *os.File
	ptySlave      *os.File
	cols          int
	rows          int
	cancelFunc    context.CancelFunc
	ctx           context.Context
	mu            sync.Mutex
	closed        bool
	startTime     time.Time
	started       chan struct{}
	windowChanges chan WindowSize
}

func (s *webSession) Pty() Pty {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Pty{Width: s.cols, Height: s.rows}
}

func (s *webSession) Context() context.Context {
	return s.ctx
}

func (s *webSession) Read(p []byte) (n int, err error) {
	if s.ptySlave != nil {
		return s.ptySlave.Read(p)
	}
	return 0, fmt.Errorf("session not initialized")
}

func (s *webSession) Write(p []byte) (n int, err error) {
	if s.ptySlave != nil {
		return s.ptySlave.Write(p)
	}
	return 0, fmt.Errorf("session not initialized")
}

func (s *webSession) WindowChanges() <-chan WindowSize {
	return s.windowChanges
}

func (s *webSession) Done() <-chan struct{} {
	return s.ctx.Done()
}

func (s *webSession) Resize(cols, rows int) {
	s.mu.Lock()
	s.cols = cols
	s.rows = rows
	s.mu.Unlock()

	if s.pty != nil {
		_ = s.pty.Resize(cols, rows)
	}

	select {
	case s.windowChanges <- WindowSize{Width: cols, Height: rows}:
	default:
	}

	if s.program != nil {
		s.program.Send(tea.WindowSizeMsg{Width: cols, Height: rows})
	}
}

func (s *webSession) WaitForStart() {
	<-s.started
}

func (srv *httpServer) createSession(ctx context.Context, handler ProgramHandler, initialCols, initialRows int) (*webSession, error) {
	cols, rows := initialCols, initialRows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	logger.Debug("creating session", "cols", cols, "rows", rows)

	ptyInstance, err := xpty.NewPty(cols, rows)
	if err != nil {
		return nil, fmt.Errorf("failed to open PTY: %w", err)
	}

	var ptyMaster, ptySlave *os.File
	if runtime.GOOS != "windows" {
		unixPty, ok := ptyInstance.(*xpty.UnixPty)
		if !ok {
			_ = ptyInstance.Close()
			return nil, fmt.Errorf("expected UnixPty on %s", runtime.GOOS)
		}
		ptyMaster = unixPty.Master()
		ptySlave = unixPty.Slave()
	}

	sessionCtx, cancel := context.WithCancel(ctx)
	started := make(chan struct{})
	windowChanges := make(chan WindowSize, 1)

	session := &webSession{
		id:            fmt.Sprintf("%d", time.Now().UnixNano()),
		pty:           ptyInstance,
		ptyMaster:     ptyMaster,
		ptySlave:      ptySlave,
		cols:          cols,
		rows:          rows,
		cancelFunc:    cancel,
		ctx:           sessionCtx,
		startTime:     time.Now(),
		started:       started,
		windowChanges: windowChanges,
	}

	// Call the handler with the session to create the program
	// The handler should use MakeOptions(session) to configure I/O
	program := handler(session)
	if program == nil {
		_ = ptyInstance.Close()
		cancel()
		return nil, fmt.Errorf("handler returned nil program")
	}
	session.program = program

	go func() {
		defer func() {
			_ = ptyInstance.Close()
			cancel()
		}()

		logger.Debug("starting program", "session", session.id, "cols", cols, "rows", rows)
		close(started)

		if _, err := session.program.Run(); err != nil {
			logger.Error("program error", "session", session.id, "error", err)
		}
		logger.Debug("program exited", "session", session.id)
	}()

	srv.sessions.Store(session.id, session)
	logger.Debug("session created", "session", session.id)

	return session, nil
}

func (srv *httpServer) closeSession(session *webSession) {
	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		return
	}
	session.closed = true
	session.mu.Unlock()

	duration := time.Since(session.startTime)

	if session.program != nil {
		session.program.Quit()
	}

	session.cancelFunc()

	if session.pty != nil {
		_ = session.pty.Close()
	}

	srv.sessions.Delete(session.id)

	logger.Debug("session closed",
		"session", session.id,
		"duration", duration.Round(time.Millisecond),
	)
}
