package sip

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// cmdSession implements session handling for spawned commands (CLI mode).
// Unlike webSession which runs Bubble Tea in-process, cmdSession spawns
// an external command in a PTY and bridges its I/O to the browser.
type cmdSession struct {
	id            string
	platform      *cmdPlatformPty
	cols          int
	rows          int
	widthPx       int
	heightPx      int
	cancelFunc    context.CancelFunc
	ctx           context.Context
	mu            sync.Mutex
	closed        bool
	startTime     time.Time
	windowChanges chan WindowSize
}

func (s *cmdSession) Pty() Pty {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Pty{Width: s.cols, Height: s.rows, WidthPx: s.widthPx, HeightPx: s.heightPx}
}

func (s *cmdSession) Context() context.Context {
	return s.ctx
}

func (s *cmdSession) Read(p []byte) (n int, err error) {
	return s.platform.OutputReader().Read(p)
}

func (s *cmdSession) Write(p []byte) (n int, err error) {
	return s.platform.InputWriter().Write(p)
}

func (s *cmdSession) WindowChanges() <-chan WindowSize {
	return s.windowChanges
}

func (s *cmdSession) Fd() uintptr {
	return 0
}

func (s *cmdSession) PtySlave() *os.File {
	return nil
}

func (s *cmdSession) Done() <-chan struct{} {
	return s.ctx.Done()
}

func (s *cmdSession) Resize(cols, rows int) {
	s.applyResize(WindowSize{Width: cols, Height: rows})
}

// ResizeWindow implements WindowResizer with pixel-aware sizing.
func (s *cmdSession) ResizeWindow(size WindowSize) {
	s.applyResize(size)
}

func (s *cmdSession) applyResize(size WindowSize) {
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
}

// OutputReader returns the reader for terminal output (for handlers).
func (s *cmdSession) OutputReader() io.Reader {
	return s.platform.OutputReader()
}

// InputWriter returns the writer for terminal input (for handlers).
func (s *cmdSession) InputWriter() io.Writer {
	return s.platform.InputWriter()
}

// Close implements SessionIO. Idempotent.
func (s *cmdSession) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	s.cancelFunc()
	if s.platform != nil {
		_ = s.platform.Close()
	}
	return nil
}

// CommandHandler creates command sessions for each browser connection.
type CommandHandler struct {
	name string
	args []string
	dir  string
}

// ServeCommand starts the server and runs the specified command for each connection.
// This is used by the CLI to wrap arbitrary commands and expose them via the browser.
func (s *Server) ServeCommand(ctx context.Context, name string, args []string, dir string) error {
	cmdHandler := &CommandHandler{
		name: name,
		args: args,
		dir:  dir,
	}
	s.server = newCmdHTTPServer(s.config, cmdHandler)
	return s.server.start(ctx)
}

// newCmdHTTPServer creates an HTTP server for command sessions.
func newCmdHTTPServer(config Config, handler *CommandHandler) *httpServer {
	srv := &httpServer{
		config:     config,
		cmdHandler: handler,
	}
	return srv
}

func (srv *httpServer) createCmdSession(ctx context.Context, initialCols, initialRows, widthPx, heightPx int) (*cmdSession, error) {
	if srv.cmdHandler == nil {
		return nil, fmt.Errorf("no command handler configured")
	}

	cols, rows := initialCols, initialRows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	logger.Debug("creating command session", "cols", cols, "rows", rows, "px", []int{widthPx, heightPx}, "cmd", srv.cmdHandler.name)

	platform, err := newCmdPlatformPty(srv.cmdHandler.name, srv.cmdHandler.args, srv.cmdHandler.dir, cols, rows)
	if err != nil {
		return nil, fmt.Errorf("failed to create command PTY: %w", err)
	}
	if widthPx > 0 || heightPx > 0 {
		_ = platform.ResizeWithPixels(cols, rows, widthPx, heightPx)
	}

	sessionCtx, cancel := context.WithCancel(ctx)
	windowChanges := make(chan WindowSize, 1)

	session := &cmdSession{
		id:            fmt.Sprintf("%d", time.Now().UnixNano()),
		platform:      platform,
		cols:          cols,
		rows:          rows,
		widthPx:       widthPx,
		heightPx:      heightPx,
		cancelFunc:    cancel,
		ctx:           sessionCtx,
		startTime:     time.Now(),
		windowChanges: windowChanges,
	}

	go func() {
		_ = platform.Wait()
		cancel()
	}()

	srv.sessions.Store(session.id, session)
	logger.Debug("command session created", "session", session.id)

	return session, nil
}

func (srv *httpServer) closeCmdSession(session *cmdSession) {
	startedClose := false
	session.mu.Lock()
	if !session.closed {
		startedClose = true
	}
	session.mu.Unlock()
	_ = session.Close()
	if startedClose {
		srv.sessions.Delete(session.id)
		logger.Debug("command session closed",
			"session", session.id,
			"duration", time.Since(session.startTime).Round(time.Millisecond),
		)
	}
}
