// Package sip serves Bubble Tea applications through a web browser.
//
// Sip provides a simple way to make any Bubble Tea TUI application accessible
// through a web browser with full terminal emulation, mouse support, and
// hardware-accelerated rendering via xterm.js.
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
	"os"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
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
	// This is required for Bubble Tea to properly detect terminal mode.
	Fd() uintptr

	// WindowChanges returns a channel that receives window size changes.
	WindowChanges() <-chan WindowSize
}

// Pty represents pseudo-terminal information.
type Pty struct {
	Width  int
	Height int
}

// WindowSize represents a terminal window size change.
type WindowSize struct {
	Width  int
	Height int
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

	// IdleTimeout for connections (0 = no timeout)
	IdleTimeout time.Duration

	// AllowOrigins for CORS (empty = all origins allowed)
	AllowOrigins []string

	// TLSCert path to TLS certificate (enables HTTPS)
	TLSCert string

	// TLSKey path to TLS private key
	TLSKey string

	// Debug enables verbose logging
	Debug bool
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
	return s.ServeWithProgram(ctx, newDefaultProgramHandler(handler))
}

// ServeWithProgram starts the server with a custom ProgramHandler.
// Use this for more control over tea.Program creation.
func (s *Server) ServeWithProgram(ctx context.Context, handler ProgramHandler) error {
	s.handler = handler
	s.server = newHTTPServer(s.config, handler)
	return s.server.start(ctx)
}

// MakeOptions returns tea.ProgramOptions configured for the web session.
// This sets up proper I/O and filters suspend messages.
func MakeOptions(sess Session) []tea.ProgramOption {
	pty := sess.Pty()
	envs := []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	}

	// Get real environment and merge
	for _, e := range os.Environ() {
		envs = append(envs, e)
	}

	return []tea.ProgramOption{
		tea.WithInput(sess),
		tea.WithOutput(sess),
		tea.WithWindowSize(pty.Width, pty.Height),
		tea.WithEnvironment(envs),
		tea.WithFilter(func(_ tea.Model, msg tea.Msg) tea.Msg {
			if _, ok := msg.(tea.SuspendMsg); ok {
				return tea.ResumeMsg{}
			}
			return msg
		}),
	}
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
