package sip

import (
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
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
	programDone   chan struct{} // closes when the program's goroutine returns
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

	sendLatestSize(s.windowChanges, size)

	if s.program != nil {
		s.program.Send(tea.WindowSizeMsg{Width: size.Width, Height: size.Height})
	}
}

// sendLatestSize puts size in ch, a channel with a buffer of one, and
// replaces a size nobody has read yet. A reader of WindowChanges wants the
// size the window has now, so the older one is the one to lose.
func sendLatestSize(ch chan WindowSize, size WindowSize) {
	for {
		select {
		case ch <- size:
			return
		default:
		}
		select {
		case <-ch:
		default:
		}
	}
}

// sessionSeq numbers the sessions of this process.
var sessionSeq atomic.Uint64

// newSessionID returns an id no other session of this process has. The
// server keys its session map on it, so two sessions with one id would share
// an entry, and shutdown would close only one of them. The clock cannot
// promise that: two sessions can start in one tick.
func newSessionID() string {
	return strconv.FormatUint(sessionSeq.Add(1), 10)
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
		// Close the PTY only after the program has stopped. bubbletea's
		// input reader calls Fd on the slave while it waits for input, and
		// a quitting program stops that reader before Run returns. Closing
		// the PTY first races with the reader.
		if s.programDone != nil {
			t := time.NewTimer(programStopWait)
			select {
			case <-s.programDone:
			case <-t.C:
				logger.Debug("program did not stop before the session closed", "session", s.id)
			}
			t.Stop()
		}
	}
	s.cancelFunc()
	if s.platform != nil {
		_ = s.platform.Close()
	}
	return nil
}

// programStopWait bounds how long Close waits for the program to stop before
// it closes the PTY anyway. bubbletea itself waits up to 500ms for its input
// reader. The wait also ends a Close that the program's own goroutine calls.
const programStopWait = 2 * time.Second

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
		id:            newSessionID(),
		platform:      platform,
		cols:          cols,
		rows:          rows,
		widthPx:       widthPx,
		heightPx:      heightPx,
		cancelFunc:    cancel,
		ctx:           sessionCtx,
		startTime:     time.Now(),
		started:       started,
		programDone:   make(chan struct{}),
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
			// Close only the program's end of the terminal. What the program
			// wrote last is still in the PTY, and the output loop reads it
			// before it sends MsgClose. The session teardown (closeFunc in
			// the handler) closes the rest.
			_ = platform.CloseSlave()
			cancel()
			close(session.programDone)
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
	// Delete even when something else closed the session first (the idle
	// timeout, the output drain), so the map never keeps a dead session.
	srv.sessions.Delete(session.id)
	if startedClose {
		logger.Debug("session closed",
			"session", session.id,
			"duration", time.Since(session.startTime).Round(time.Millisecond),
		)
	}
}
