// Package recover provides a layer-3 Middleware that catches panics
// raised during Handler construction. The panic is logged via slog
// and the wrapped Handler returns a tea.Model that displays the error
// and quits immediately.
//
// Panics inside the running tea.Program are NOT caught here — that is
// BubbleTea's own concern.
package recover

import (
	"fmt"
	"log/slog"
	"runtime/debug"

	tea "charm.land/bubbletea/v2"

	"github.com/Gaurav-Gosain/sip"
)

type config struct {
	logger *slog.Logger
}

type Option func(*config)

// WithLogger sets the slog.Logger used to record panics. Default slog.Default().
func WithLogger(l *slog.Logger) Option {
	return func(c *config) { c.logger = l }
}

// New returns a Middleware that recovers from panics in the wrapped Handler.
func New(opts ...Option) sip.Middleware {
	cfg := &config{}
	for _, o := range opts {
		o(cfg)
	}
	if cfg.logger == nil {
		cfg.logger = slog.Default()
	}
	return func(next sip.Handler) sip.Handler {
		return func(sess sip.Session) (m tea.Model, popts []tea.ProgramOption) {
			defer func() {
				if r := recover(); r != nil {
					cfg.logger.Error("handler panicked",
						slog.Any("panic", r),
						slog.String("stack", string(debug.Stack())),
					)
					m = panicModel{msg: fmt.Sprintf("%v", r)}
					popts = nil
				}
			}()
			return next(sess)
		}
	}
}

type panicModel struct{ msg string }

func (panicModel) Init() tea.Cmd                         { return tea.Quit }
func (m panicModel) Update(tea.Msg) (tea.Model, tea.Cmd) { return m, tea.Quit }
func (m panicModel) View() tea.View {
	return tea.NewView("session error: " + m.msg + "\n")
}
