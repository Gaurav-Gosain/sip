package sip

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
)

// webSession implements the Session interface for web terminal connections.
type webSession struct {
	id            string
	program       *tea.Program
	platform      *platformPty
	cols          int
	rows          int
	widthPx       int
	heightPx      int
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
	return Pty{Width: s.cols, Height: s.rows, WidthPx: s.widthPx, HeightPx: s.heightPx}
}

func (s *webSession) Context() context.Context {
	return s.ctx
}

func (s *webSession) Read(p []byte) (n int, err error) {
	return s.platform.SlaveReader().Read(p)
}

func (s *webSession) Write(p []byte) (n int, err error) {
	return s.platform.SlaveWriter().Write(p)
}

func (s *webSession) WindowChanges() <-chan WindowSize {
	return s.windowChanges
}

func (s *webSession) Fd() uintptr {
	return s.platform.SlaveFd()
}

func (s *webSession) PtySlave() *os.File {
	return s.platform.SlaveFile()
}

func (s *webSession) Done() <-chan struct{} {
	return s.ctx.Done()
}

func (s *webSession) Resize(cols, rows int) {
	s.applyResize(WindowSize{Width: cols, Height: rows})
}

// ResizeWindow applies a full WindowSize including pixel dimensions to the
// underlying PTY, so TIOCGWINSZ on the slave side reports ws_xpixel/ws_ypixel
// matching the client's canvas. Implements WindowResizer.
func (s *webSession) ResizeWindow(size WindowSize) {
	s.applyResize(size)
}

func (s *webSession) applyResize(size WindowSize) {
	s.mu.Lock()
	s.cols = size.Width
	s.rows = size.Height
	if size.WidthPx > 0 {
		s.widthPx = size.WidthPx
	}
	if size.HeightPx > 0 {
		s.heightPx = size.HeightPx
	}
	s.mu.Unlock()

	if s.platform != nil {
		_ = s.platform.ResizeWithPixels(size.Width, size.Height, size.WidthPx, size.HeightPx)
	}

	select {
	case s.windowChanges <- size:
	default:
	}

	if s.program != nil {
		s.program.Send(tea.WindowSizeMsg{Width: size.Width, Height: size.Height})
	}
}

func (s *webSession) WaitForStart() {
	<-s.started
}

// OutputReader returns the reader for terminal output (for handlers).
func (s *webSession) OutputReader() io.Reader {
	return s.platform.OutputReader()
}

// InputWriter returns the writer for terminal input (for handlers).
func (s *webSession) InputWriter() io.Writer {
	return s.platform.InputWriter()
}

// Close implements SessionIO. Idempotent.
func (s *webSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	if s.program != nil {
		s.program.Quit()
	}
	s.cancelFunc()
	if s.platform != nil {
		_ = s.platform.Close()
	}
	return nil
}

func (srv *httpServer) createSession(ctx context.Context, handler ProgramHandler, initialCols, initialRows, widthPx, heightPx int) (*webSession, error) {
	cols, rows := initialCols, initialRows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	logger.Debug("creating session", "cols", cols, "rows", rows, "px", []int{widthPx, heightPx})

	platform, err := newPlatformPty(cols, rows)
	if err != nil {
		return nil, fmt.Errorf("failed to create PTY: %w", err)
	}
	if widthPx > 0 || heightPx > 0 {
		_ = platform.ResizeWithPixels(cols, rows, widthPx, heightPx)
	}

	sessionCtx, cancel := context.WithCancel(ctx)
	started := make(chan struct{})
	windowChanges := make(chan WindowSize, 1)

	session := &webSession{
		id:            fmt.Sprintf("%d", time.Now().UnixNano()),
		platform:      platform,
		cols:          cols,
		rows:          rows,
		widthPx:       widthPx,
		heightPx:      heightPx,
		cancelFunc:    cancel,
		ctx:           sessionCtx,
		startTime:     time.Now(),
		started:       started,
		windowChanges: windowChanges,
	}

	program := handler(session)
	if program == nil {
		_ = platform.Close()
		cancel()
		return nil, fmt.Errorf("handler returned nil program")
	}
	session.program = program

	go func() {
		defer func() {
			_ = platform.Close()
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
	startedClose := false
	session.mu.Lock()
	if !session.closed {
		startedClose = true
	}
	session.mu.Unlock()
	_ = session.Close()
	if startedClose {
		srv.sessions.Delete(session.id)
		logger.Debug("session closed",
			"session", session.id,
			"duration", time.Since(session.startTime).Round(time.Millisecond),
		)
	}
}
