// Package sip serves Bubble Tea applications through a web browser.
//
// Sip provides a way to make any Bubble Tea TUI application accessible
// through a web browser with full terminal emulation, mouse support, and
// hardware-accelerated rendering via xterm.js and its WebGL renderer.
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

	// AutoTLS serves HTTPS from a self-signed keypair sip manages for the
	// user, generating one on first use and reusing it after that. It is
	// ignored when TLSCert and TLSKey are set.
	//
	// It exists because the alternative people actually reached for was
	// AllowInsecureNoTLS, permanently. Binding a LAN address is what you do
	// to reach a terminal from a phone, that bind is refused without TLS,
	// and until now nothing in sip helped with the certificate, so the
	// documented path ended at "obtain a certificate somehow".
	//
	// The certificate signs for itself, so the first visit from any browser
	// shows a warning. See SelfSignedWarning for what to tell the user, and
	// say it: a warning nobody was warned about reads as a broken tool.
	AutoTLS bool

	// CertDir overrides where AutoTLS keeps its keypair. Empty uses
	// DefaultCertDir.
	CertDir string

	// CertHosts are extra DNS names and IP addresses AutoTLS puts in the
	// certificate's SAN. The bind address, the loopback names, the
	// machine's hostname and its interface addresses are covered already;
	// this is for a name only some other resolver knows about.
	CertHosts []string

	// CertValidity is how long an AutoTLS certificate lasts.
	// 0 means DefaultCertValidity.
	CertValidity time.Duration

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

	// Renderer selects the client-side terminal renderer: "webgl",
	// "canvas" or "dom". Empty means "auto", which prefers WebGL and
	// falls back to canvas and then the DOM. A user's saved setting and
	// a ?renderer= query param both override this.
	Renderer string

	// MobileKeys replaces the client's default touch key bar with a key
	// set of the deployment's own. Empty keeps the default, which is the
	// keys a phone keyboard lacks and every terminal program understands
	// (Escape, Tab, sticky Ctrl and Alt, the arrows, some punctuation).
	//
	// Set it when the program being served has chords worth a button:
	// sip has no way to know what those are. The bar is only built on a
	// touch device, so this has no effect on a desktop.
	//
	// It is the one-row shorthand for MobileRows, which wins when both are
	// set.
	MobileKeys []MobileKey

	// MobileRows lays the touch key bar out in more than one strip, for a
	// key set that has outgrown a single one. Rows are drawn top to bottom
	// and the typing row conventionally goes last, nearest the thumb that
	// is already on the software keyboard.
	MobileRows []MobileRow

	// MobilePrefix declares the leader chord this deployment is driven by:
	// tmux's Ctrl+B, screen's Ctrl+A, emacs's Ctrl+X. A phone cannot hold a
	// modifier while pressing a letter, so without this every binding in a
	// leader-driven program is unreachable from a touch device, which is
	// most of what such a program can do.
	//
	// It powers two kinds of button, and neither exists without it:
	// MobileKey.Prefix arms the chord so the second half can be typed on
	// the software keyboard, and MobileKey.Prefixed sends the leader and a
	// key together in one tap.
	MobilePrefix MobilePrefix

	// DisableMobileKeyBar suppresses the touch key bar entirely, for a
	// program that draws touch controls of its own. The software
	// keyboard's share of the window is still measured and reserved.
	DisableMobileKeyBar bool

	// MobileMouse tunes what a finger on the terminal does. The zero
	// value is the working default; see MobileMouse for what it means and
	// for the two switches that turn parts of it off.
	MobileMouse MobileMouse

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
	// The client's kitty overlay decodes PNG itself through
	// createImageBitmap, so this is off by default and the raw APC stream
	// is forwarded untouched (keeping PNG payloads compressed end to end).
	// Enable it only to force server-side transcoding as a fallback.
	EnableKittyTranscoder bool
}

// MobileKey is one button on the client's touch key bar. It is handed to
// the browser as-is, so the field names match what static/mobile.js reads.
//
// A key sends input:
//
//	sip.MobileKey{Label: "esc", Title: "Escape", Key: "Escape"}
//	sip.MobileKey{Label: "|", Title: "Pipe", Key: "|", Narrow: true}
//
// A modifier is sticky instead: one tap arms it for the next keystroke, a
// second locks it until tapped off, because a touch screen cannot hold a
// key down while pressing another.
//
//	sip.MobileKey{Label: "ctrl", Title: "Ctrl", Mod: "ctrl"}
//
// A chord is two buttons or one, and both need MobilePrefix set:
//
//	sip.MobileKey{Label: "pfx", Title: "Prefix, then a key", Prefix: true}
//	sip.MobileKey{Label: "split", Title: "Split the pane", Key: "%", Prefixed: true}
//
// A button is a keystroke and nothing more. If the program has no binding for
// the key, tapping it does what typing that key does, which for an unbound
// chord is nothing at all. sip cannot know a deployment's keymap, so it never
// pretends to: a button reports no success it did not have.
type MobileKey struct {
	// Label is the text on the button. Keep it short: a row is a single
	// strip on a phone screen.
	Label string `json:"label"`

	// Title is the tooltip and the accessible name.
	Title string `json:"title,omitempty"`

	// Key is a KeyboardEvent key name ("Escape", "Tab", "ArrowLeft",
	// "Home", "PageUp") or a literal character ("/", "|"). Ignored when
	// Mod is set.
	Key string `json:"key,omitempty"`

	// Code is the KeyboardEvent code ("KeyC", "Backslash"). The default
	// client-side encoder works from Key alone and ignores this; it is
	// carried for a page that supplies an encoder of its own, since a
	// keymap encoder derives the character from the code and the shift
	// state rather than from the key name.
	Code string `json:"code,omitempty"`

	// Mod makes this a sticky modifier instead of a key: "ctrl" or
	// "alt".
	Mod string `json:"mod,omitempty"`

	// Ctrl, Alt and Shift are modifiers the button carries itself, on
	// top of whatever the bar has armed. A "^C" button is
	// {Label: "^C", Key: "c", Ctrl: true}.
	Ctrl  bool `json:"ctrl,omitempty"`
	Alt   bool `json:"alt,omitempty"`
	Shift bool `json:"shift,omitempty"`

	// Prefix makes this the leader button: it sends Config.MobilePrefix
	// and stays lit until the next key goes out, so a chord with no button
	// of its own can be finished on the software keyboard. The button is
	// left out of the bar when no prefix is configured, rather than
	// arming a chord that would never be sent.
	Prefix bool `json:"prefix,omitempty"`

	// Prefixed sends Config.MobilePrefix and then this key in one tap,
	// with the Ctrl, Alt and Shift this button declares, so a chord whose
	// second half is itself modified is still one button:
	//
	//	{Label: "prev", Key: "o", Ctrl: true, Prefixed: true}  tmux Ctrl+B Ctrl+O
	//
	// The bar's own sticky modifiers are cleared rather than folded in: a
	// chord is a fixed sequence and the user pressed one button, so a
	// latched Ctrl must not turn this into a different chord. With no
	// prefix configured it sends the key on its own.
	Prefixed bool `json:"prefixed,omitempty"`

	// Narrow gives the button less horizontal padding, for a
	// single-character label.
	Narrow bool `json:"narrow,omitempty"`

	// ID names the button so a page script can mark its state through the
	// controller's setState.
	ID string `json:"id,omitempty"`
}

// MobileRow is one strip of the touch key bar.
type MobileRow struct {
	// Label is the row's accessible name.
	Label string `json:"label,omitempty"`

	// Keys are the buttons, left to right.
	Keys []MobileKey `json:"keys"`

	// Collapsible lets the user fold this row away with a control pinned
	// to the right of the bar, and remembers the answer. Two rows over a
	// software keyboard cost about three rows of terminal on a phone, and
	// a user who only types never touches the chord row. Leave the typing
	// row un-collapsible: it is why the bar exists.
	Collapsible bool `json:"collapsible,omitempty"`
}

// MobilePrefix is a leader chord: the key held with its modifiers that a
// program waits on before reading the next key as a command.
//
//	tmux, screen:  sip.MobilePrefix{Key: "b", Code: "KeyB", Ctrl: true}
//	rebound tmux:  sip.MobilePrefix{Key: "a", Code: "KeyA", Ctrl: true}
//	emacs:         sip.MobilePrefix{Key: "x", Code: "KeyX", Ctrl: true}
//
// Zero value means no prefix, which is what a program without a leader wants
// and what every deployment that predates this field already has.
type MobilePrefix struct {
	Key   string `json:"key,omitempty"`
	Code  string `json:"code,omitempty"`
	Ctrl  bool   `json:"ctrl,omitempty"`
	Alt   bool   `json:"alt,omitempty"`
	Shift bool   `json:"shift,omitempty"`
}

// IsZero reports whether no prefix chord is configured.
func (p MobilePrefix) IsZero() bool { return p.Key == "" }

// MobileMouse is what a finger on the terminal does.
//
// A touch device has no mouse, and xterm.js's own touch handling stops at
// turning a pan into wheel reports: a tap, a long press and a press-hold-drag
// all reach the program as nothing at all. The client fills that in by
// synthesizing the mouse events the browser would have synthesized, so
// whatever mouse mode and encoding the program asked for is what it gets:
//
//	tap                 press and release button 1, which is how a program
//	                    is clicked and how the cursor is placed
//	long press          press and release button 3, the right click
//	press, hold, drag   press at the origin, motion, release, which is how a
//	                    split is pulled or a region selected
//	pan                 wheel reports, as before
//
// With the program in no mouse mode at all the same gestures drive xterm's
// selection instead, so a finger selects text.
//
// The zero value is all of it, on, with the defaults below. It costs a desktop
// nothing: none of it installs without a touch screen.
type MobileMouse struct {
	// Disable turns the whole thing off: a finger sends no mouse reports
	// and the terminal behaves as it did before this existed. For a
	// program that reads a click as something destructive, or that means
	// to handle touch itself from a page script.
	Disable bool

	// DisableTap keeps the drag but stops a tap becoming a click and a
	// long press becoming a right click.
	DisableTap bool

	// DisableDrag keeps the tap but stops a press-hold-then-move becoming
	// a drag, leaving that gesture as a pan.
	DisableDrag bool

	// LongPressMs is how long a finger must sit still before moving it
	// off becomes a drag rather than a pan. 0 means the default, 450.
	LongPressMs int

	// SlopPx is how far a finger may wander in CSS pixels and still count
	// as sitting still. 0 means the default, 10.
	SlopPx int
}

// clientOptions is the browser-side option object, carrying only what differs
// from the default so that a deployment that configures nothing ships nothing.
func (m MobileMouse) clientOptions() map[string]any {
	o := map[string]any{}
	if m.Disable || m.DisableTap {
		o["tap"] = false
	}
	if m.Disable || m.DisableDrag {
		o["drag"] = false
	}
	if m.LongPressMs > 0 {
		o["longPressMs"] = m.LongPressMs
	}
	if m.SlopPx > 0 {
		o["slopPx"] = m.SlopPx
	}
	return o
}

// DefaultMobileKeys returns the key bar's built-in typing row: the keys a phone
// keyboard does not have, or hides two layers deep, in priority order because
// whatever comes first is what a narrow phone shows without scrolling.
//
// It exists for a deployment that declares MobileRows and wants its own chords
// above this row rather than instead of it. Leaving both MobileKeys and
// MobileRows unset gets the same set without naming it.
func DefaultMobileKeys() []MobileKey {
	return []MobileKey{
		{Label: "esc", Title: "Escape", Key: "Escape", Code: "Escape"},
		{Label: "tab", Title: "Tab", Key: "Tab", Code: "Tab"},
		{Label: "ctrl", Title: "Ctrl (tap to arm, tap again to lock)", Mod: "ctrl"},
		{Label: "alt", Title: "Alt (tap to arm, tap again to lock)", Mod: "alt"},
		{Label: "←", Title: "Left", Key: "ArrowLeft", Code: "ArrowLeft", Narrow: true},
		{Label: "↓", Title: "Down", Key: "ArrowDown", Code: "ArrowDown", Narrow: true},
		{Label: "↑", Title: "Up", Key: "ArrowUp", Code: "ArrowUp", Narrow: true},
		{Label: "→", Title: "Right", Key: "ArrowRight", Code: "ArrowRight", Narrow: true},
		{Label: "/", Title: "Slash", Key: "/", Code: "Slash", Narrow: true},
		{Label: "-", Title: "Minus", Key: "-", Code: "Minus", Narrow: true},
		{Label: "|", Title: "Pipe", Key: "|", Code: "Backslash", Shift: true, Narrow: true},
		{Label: ":", Title: "Colon", Key: ":", Code: "Semicolon", Shift: true, Narrow: true},
	}
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
