// Package osc52gate provides a SessionMiddleware that filters OSC 52
// clipboard-write escape sequences in the outbound byte stream
// (server → client). Three modes:
//
//   - ModeAllow: pass-through (explicit no-op, documents the policy).
//   - ModeDeny:  strip the escape from the stream before the client sees it.
//   - ModeAudit: pass-through + log attempts via slog.
package osc52gate

import (
	"io"
	"log/slog"

	"github.com/Gaurav-Gosain/sip"
)

// Mode selects how the middleware treats an observed OSC 52 escape.
type Mode int

const (
	ModeAllow Mode = iota
	ModeDeny
	ModeAudit
)

type config struct {
	logger *slog.Logger
}

type Option func(*config)

// WithLogger sets the slog.Logger used by ModeAudit. Default slog.Default().
func WithLogger(l *slog.Logger) Option {
	return func(c *config) { c.logger = l }
}

// New returns a SessionMiddleware that filters the session's outbound
// byte stream for OSC 52 clipboard-write escapes.
func New(mode Mode, opts ...Option) sip.SessionMiddleware {
	cfg := &config{}
	for _, o := range opts {
		o(cfg)
	}
	if cfg.logger == nil {
		cfg.logger = slog.Default()
	}
	var audit auditFn
	if mode == ModeAudit {
		audit = func(sel string, dataLen int) {
			cfg.logger.Info("osc52 clipboard write observed",
				slog.String("selection", sel),
				slog.Int("bytes", dataLen),
			)
		}
	}
	return func(base sip.SessionIO) sip.SessionIO {
		return &gatedSession{SessionIO: base, mode: mode, audit: audit}
	}
}

type gatedSession struct {
	sip.SessionIO
	mode  Mode
	audit auditFn
}

func (g *gatedSession) OutputReader() io.Reader {
	return newScanner(g.SessionIO.OutputReader(), g.mode, g.audit)
}

type auditFn func(selection string, dataLen int)

func newScanner(inner io.Reader, mode Mode, audit auditFn) io.Reader {
	return &scanner{
		inner: inner,
		mode:  mode,
		audit: audit,
	}
}

type scanState int

const (
	stNormal  scanState = iota
	stEsc               // saw ESC
	stBracket           // saw ESC ]
	stPrefix            // consuming "52"
	stSemi1             // saw ESC ] 52 ;
	stSel               // consuming selection char(s) until ;
	stData              // consuming data until terminator
	stMaybeST           // saw ESC inside data, awaiting backslash
)

type scanner struct {
	inner io.Reader
	mode  Mode
	audit auditFn

	state    scanState
	buffered []byte
	selBuf   []byte
	dataLen  int
	prefixN  int

	outBuf []byte
}

func (s *scanner) Read(p []byte) (int, error) {
	for {
		if len(s.outBuf) > 0 {
			n := copy(p, s.outBuf)
			s.outBuf = s.outBuf[n:]
			return n, nil
		}
		buf := make([]byte, len(p))
		n, err := s.inner.Read(buf)
		if n > 0 {
			s.feed(buf[:n])
		}
		if len(s.outBuf) == 0 && err != nil {
			if len(s.buffered) > 0 {
				s.outBuf = append(s.outBuf, s.buffered...)
				s.buffered = s.buffered[:0]
				s.state = stNormal
			}
		}
		if len(s.outBuf) > 0 {
			m := copy(p, s.outBuf)
			s.outBuf = s.outBuf[m:]
			if err == io.EOF && len(s.outBuf) == 0 {
				return m, io.EOF
			}
			return m, nil
		}
		if err != nil {
			return 0, err
		}
	}
}

func (s *scanner) feed(b []byte) {
	for _, c := range b {
		s.step(c)
	}
}

func (s *scanner) step(c byte) {
	switch s.state {
	case stNormal:
		if c == 0x1b {
			s.buffered = append(s.buffered[:0], c)
			s.state = stEsc
			return
		}
		s.emit(c)
	case stEsc:
		if c == ']' {
			s.buffered = append(s.buffered, c)
			s.state = stBracket
			return
		}
		s.flushBuffered()
		s.emit(c)
		s.state = stNormal
	case stBracket:
		if c == '5' {
			s.buffered = append(s.buffered, c)
			s.prefixN = 1
			s.state = stPrefix
			return
		}
		s.flushBuffered()
		s.emit(c)
		s.state = stNormal
	case stPrefix:
		if s.prefixN == 1 && c == '2' {
			s.buffered = append(s.buffered, c)
			s.state = stSemi1
			return
		}
		s.flushBuffered()
		s.emit(c)
		s.state = stNormal
	case stSemi1:
		if c == ';' {
			s.buffered = append(s.buffered, c)
			s.selBuf = s.selBuf[:0]
			s.state = stSel
			return
		}
		s.flushBuffered()
		s.emit(c)
		s.state = stNormal
	case stSel:
		s.buffered = append(s.buffered, c)
		if c == ';' {
			s.dataLen = 0
			s.state = stData
			return
		}
		s.selBuf = append(s.selBuf, c)
	case stData:
		if c == 0x07 {
			s.finishEscape(false)
			return
		}
		if c == 0x1b {
			s.buffered = append(s.buffered, c)
			s.state = stMaybeST
			return
		}
		s.buffered = append(s.buffered, c)
		s.dataLen++
	case stMaybeST:
		if c == '\\' {
			s.buffered = append(s.buffered, c)
			s.finishEscape(true)
			return
		}
		s.buffered = append(s.buffered, c)
		s.dataLen++
		s.state = stData
	}
}

func (s *scanner) emit(c byte) {
	s.outBuf = append(s.outBuf, c)
}

func (s *scanner) flushBuffered() {
	s.outBuf = append(s.outBuf, s.buffered...)
	s.buffered = s.buffered[:0]
}

func (s *scanner) finishEscape(stTerminated bool) {
	switch s.mode {
	case ModeAllow, ModeAudit:
		if s.mode == ModeAudit && s.audit != nil {
			s.audit(string(s.selBuf), s.dataLen)
		}
		s.outBuf = append(s.outBuf, s.buffered...)
		if !stTerminated {
			s.outBuf = append(s.outBuf, 0x07)
		}
	case ModeDeny:
		// drop everything buffered
	}
	s.buffered = s.buffered[:0]
	s.selBuf = s.selBuf[:0]
	s.dataLen = 0
	s.state = stNormal
}
