// Package logging provides a layer-3 Middleware that records session
// start and end events via slog.
package logging

import (
	"log/slog"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/Gaurav-Gosain/sip"
)

type config struct {
	logger *slog.Logger
}

type Option func(*config)

// WithLogger sets the slog.Logger used. Default slog.Default().
func WithLogger(l *slog.Logger) Option {
	return func(c *config) { c.logger = l }
}

// New returns a Middleware that logs session start/end around the handler.
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
			addr := sip.RemoteAddrFromContext(sess.Context())
			start := time.Now()
			cfg.logger.Info("session start", slog.String("remote_addr", addr))
			defer func() {
				cfg.logger.Info("session end",
					slog.String("remote_addr", addr),
					slog.Int64("duration_ms", time.Since(start).Milliseconds()),
				)
			}()
			m, popts = next(sess)
			return
		}
	}
}
