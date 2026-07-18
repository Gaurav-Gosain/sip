// Package sip serves Bubble Tea applications through a web browser.
//
// Sip provides a way to make any Bubble Tea TUI application accessible
// through a web browser with full terminal emulation, mouse support, and
// hardware-accelerated rendering via libghostty (ghostty-web wasm) — a
// real terminal emulator running in the browser.
//
// Basic usage:
//
//	server := sip.NewServer(sip.DefaultConfig())
//	server.Serve(context.Background(), func(sess sip.Session) (tea.Model, []tea.ProgramOption) {
//	    pty := sess.Pty()
//	    return myModel{width: pty.Width, height: pty.Height}, nil
//	})
//
// Or with a ProgramHandler for more control:
//
//	server.ServeWithProgram(ctx, func(sess sip.Session) *tea.Program {
//	    return tea.NewProgram(myModel{}, sip.MakeOptions(sess)...)
//	})
package sip

import (
	"context"
	"io"
	"os"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/log"
)

// Session represents a web terminal session, similar to ssh.Session in Wish.
// It provides access to terminal dimensions and other session metadata.
type Session interface {
	// Pty returns the pseudo-terminal information for this session.
	Pty() Pty

	// Context returns the session's context, which is cancelled when the
	// session ends.
	Context() context.Context

	// Read reads input from the web terminal.
	Read(p []byte) (n int, err error)

	// Write writes output to the web terminal.
	Write(p []byte) (n int, err error)

	// Fd returns the file descriptor for TTY detection.
	// Required for Bubble Tea to properly detect terminal mode.
	Fd() uintptr

	// PtySlave returns the underlying PTY slave file for direct I/O.
	// Bubble Tea requires the actual *os.File to set raw mode properly.
	PtySlave() *os.File

	// WindowChanges returns a channel that receives window size changes.
	WindowChanges() <-chan WindowSize
}

// Pty represents pseudo-terminal information.
//
// WidthPx and HeightPx are the canvas dimensions in pixels reported by the
// browser. They are populated when the client sends widthPx/heightPx in its
// resize message. Zero means the client did not report pixel dimensions.
type Pty struct {
	Width    int
	Height   int
	WidthPx  int
	HeightPx int
}

// WindowSize represents a terminal window size change.
//
// WidthPx and HeightPx are optional canvas dimensions in pixels. When non-zero
// they are forwarded to the PTY's TIOCSWINSZ ws_xpixel/ws_ypixel fields, which
// kitty graphics tools (e.g. kitten icat) read to size images.
type WindowSize struct {
	Width    int
	Height   int
	WidthPx  int
	HeightPx int
}

// WindowResizer is an optional capability for sessions that can apply pixel
// dimensions in addition to character dimensions. Sessions implementing this
// interface receive ResizeWindow calls; others fall back to Resize(cols, rows).
type WindowResizer interface {
	ResizeWindow(size WindowSize)
}

// Handler is the function Bubble Tea apps implement to hook into sip.
// This will create a new tea.Program for every browser connection and
// start it with the tea.ProgramOptions returned.
type Handler func(sess Session) (tea.Model, []tea.ProgramOption)

// ProgramHandler allows creating custom tea.Program instances.
// Use this for more control over program initialization.
// Make sure to use MakeOptions to properly configure I/O.
type ProgramHandler func(sess Session) *tea.Program

// Config holds the web server configuration.
type Config struct {
	// Host to bind to (default: "localhost")
	Host string

	// Port to listen on (default: "7681")
	Port string

	// ReadOnly disables input from clients when true
	ReadOnly bool

	// MaxConnections limits concurrent connections (0 = unlimited)
	MaxConnections int

	// IdleTimeout closes sessions with no inbound bytes for the given
	// duration (0 = disabled). Inbound = client → PTY only.
	IdleTimeout time.Duration

	// AllowOrigins is the legacy alias for OriginPatterns. Both are
	// merged. Empty means same-origin only.
	AllowOrigins []string

	// OriginPatterns is an allowlist of additional browser origins
	// permitted to connect. Each entry is a path.Match shell glob, NOT
	// a regex (e.g. "https://app.example.com", "*.example.com").
	OriginPatterns []string

	// TLSCert path to TLS certificate (enables HTTPS)
	TLSCert string

	// TLSKey path to TLS private key
	TLSKey string

	// Debug enables verbose logging
	Debug bool

	// BasicUsername / BasicPassword enable HTTP Basic Auth on every
	// HTTP request (handshake + static assets). Empty disables auth.
	BasicUsername string
	BasicPassword string

	// AllowInsecureNoTLS lets BasicAuth or non-loopback hosts run
	// without TLS. Default false (refuses to start). Use only for
	// development behind a trusted reverse proxy that terminates TLS.
	AllowInsecureNoTLS bool

	// MaxPasteBytes caps the size of a single inbound message
	// (typically a bracketed-paste payload). 0 = default 1 MiB.
	MaxPasteBytes int

	// ResizeThrottle coalesces rapid inbound resize messages into the
	// most recent value. 0 = default 16ms.
	ResizeThrottle time.Duration

	// MaxWindowDims rejects resize messages exceeding these
	// dimensions. 0 in either dim = default 4096.
	MaxWindowDims WindowSize

	// InitialResizeTimeout is the maximum time to wait for the
	// client's initial Resize message after WS upgrade or WT CONNECT.
	// 0 = default 10s.
	InitialResizeTimeout time.Duration

	// WriteTimeout bounds how long a single output write to the client
	// may block before the session is torn down. A stalled-but-alive
	// client (stopped reading, socket buffers full) otherwise pins the
	// output goroutine and its connection slot indefinitely. 0 = default
	// 30s. Negative disables the deadline.
	WriteTimeout time.Duration

	// FontPath is an optional filesystem path to a custom font (.ttf,
	// .otf, .woff, .woff2). When set, the file is served at
	// /static/fonts/custom and registered as a @font-face named
	// FontFamily. Empty uses the embedded JetBrains Mono Nerd Font.
	FontPath string

	// FontFamily is the CSS font-family used by the terminal. Used in
	// conjunction with FontPath when present, otherwise overrides the
	// default for the embedded font stack. Empty defaults to
	// "JetBrainsMono Nerd Font Mono".
	FontFamily string

	// ConnectMiddleware extends the layer-1 chain. Built-in basic auth
	// + connection-limit middleware are appended after the user chain
	// so they run innermost (last).
	ConnectMiddleware []ConnectMiddleware

	// SessionMiddleware extends the layer-2 chain. The first
	// middleware is the outermost wrapper.
	SessionMiddleware []SessionMiddleware

	// HandlerMiddleware extends the layer-3 chain that wraps the
	// user's Handler. The first middleware is outermost (sees calls
	// first).
	HandlerMiddleware []Middleware

	// EnableKittyTranscoder runs every PTY → client byte stream through the
	// server-side kitty graphics PNG → RGBA transcoder.
	//
	// The ghostty-web client now decodes PNG kitty graphics itself via the
	// wasm DECODE_PNG callback, so this is off by default and the raw APC
	// stream is forwarded untouched (keeping PNG payloads compressed end to
	// end). Enable it only to force server-side transcoding as a fallback.
	EnableKittyTranscoder bool
}

// DefaultConfig returns sensible default configuration.
func DefaultConfig() Config {
	return Config{
		Host:           "localhost",
		Port:           "7681",
		ReadOnly:       false,
		MaxConnections: 0,
		IdleTimeout:    0,
		AllowOrigins:   nil,
		Debug:          false,
	}
}

// Server represents the web terminal server.
type Server struct {
	config  Config
	handler ProgramHandler
	server  *httpServer
}

// NewServer creates a new web terminal server with the given configuration.
func NewServer(config Config) *Server {
	if config.Host == "" {
		config.Host = "localhost"
	}
	if config.Port == "" {
		config.Port = "7681"
	}

	if config.Debug {
		logger.SetLevel(log.DebugLevel)
	}

	return &Server{
		config: config,
	}
}

// Serve starts the server and serves the Bubble Tea application.
// The handler is called for each new browser session to create a model.
// This method blocks until the context is cancelled.
func (s *Server) Serve(ctx context.Context, handler Handler) error {
	wrapped := applyHandlerMiddleware(handler, s.config.HandlerMiddleware)
	return s.ServeWithProgram(ctx, newDefaultProgramHandler(wrapped))
}

// ServeWithProgram starts the server with a custom ProgramHandler.
// Use this for more control over tea.Program creation.
func (s *Server) ServeWithProgram(ctx context.Context, handler ProgramHandler) error {
	s.handler = handler
	s.server = newHTTPServer(s.config, handler)
	return s.server.start(ctx)
}

// MakeOptions returns tea.ProgramOptions configured for the web session.
// On Unix, this uses the PTY slave file for proper raw mode support.
// On Windows, this uses the Session's Reader/Writer interface with pipes.
func MakeOptions(sess Session) []tea.ProgramOption {
	pty := sess.Pty()
	ptySlave := sess.PtySlave()

	var envs []string
	for _, e := range os.Environ() {
		if len(e) >= 5 && e[:5] == "TERM=" {
			continue
		}
		if len(e) >= 10 && e[:10] == "COLORTERM=" {
			continue
		}
		envs = append(envs, e)
	}

	envs = append(envs,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	var input io.Reader
	var output io.Writer
	if ptySlave != nil {
		input = ptySlave
		output = ptySlave
	} else {
		input = sess.(io.Reader)
		output = sess.(io.Writer)
	}

	opts := []tea.ProgramOption{
		tea.WithInput(input),
		tea.WithOutput(output),
		tea.WithColorProfile(colorprofile.TrueColor),
		tea.WithWindowSize(pty.Width, pty.Height),
		tea.WithEnvironment(envs),
		tea.WithFilter(func(_ tea.Model, msg tea.Msg) tea.Msg {
			if _, ok := msg.(tea.SuspendMsg); ok {
				return tea.ResumeMsg{}
			}
			return msg
		}),
	}

	return opts
}

// newDefaultProgramHandler wraps a Handler into a ProgramHandler.
func newDefaultProgramHandler(handler Handler) ProgramHandler {
	return func(sess Session) *tea.Program {
		m, opts := handler(sess)
		if m == nil {
			return nil
		}
		return tea.NewProgram(m, append(opts, MakeOptions(sess)...)...)
	}
}

// SetLogLevel sets the logging verbosity for the sip package.
func SetLogLevel(level log.Level) {
	logger.SetLevel(level)
}
