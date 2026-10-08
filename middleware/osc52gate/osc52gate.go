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
	"sync"

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

	once   sync.Once
	reader io.Reader
}

// OutputReader returns a single persistent scanner for the session's
// lifetime. Handlers call OutputReader().Read in a loop, so a fresh
// scanner per call would discard the byte-level parse state buffered
// mid-escape, corrupting sequences split across reads (and letting
// ModeDeny fail open on an OSC 52 spanning two reads).
func (g *gatedSession) OutputReader() io.Reader {
	g.once.Do(func() {
		g.reader = newScanner(g.SessionIO.OutputReader(), g.mode, g.audit)
	})
	return g.reader
}

type auditFn func(selection string, dataLen int)

func newScanner(inner io.Reader, mode Mode, audit auditFn) io.Reader {
	return &scanner{
		inner: inner,
		mode:  mode,
		audit: audit,
		id:    -1,
	}
}

// The scanner reads the stream the way the browser terminal (xterm.js) reads
// it. A filter that parses differently from the terminal can be walked
// around: any input the terminal runs as OSC 52 and the filter does not see
// is a bypass. These are the rules of that parser the scanner follows:
//
//   - Bytes are decoded as UTF-8 before anything else, and a malformed
//     sequence or a byte order mark is dropped without a trace. So
//     "ESC ] 5 \xff 2" is OSC 52 to the terminal.
//   - ESC and U+009D (C1 OSC, the bytes C2 9D) start a sequence from any
//     state. A second ESC restarts the escape.
//   - An OSC number is a number, so "052" is 52.
//   - In the ESC state most C0 controls run without leaving the state, and
//     inside an OSC they are ignored. Neither ends the sequence.
//   - An OSC ends at BEL, at ST (ESC \ or U+009C), and at a bare ESC. CAN,
//     SUB and the other C1 controls abandon it without running it.
//
// ModeDeny removes every OSC 52 and writes CAN (0x18) in its place. CAN
// returns the terminal's parser to its ground state, which is where the
// removed sequence would have left it. Without it, an escape that came before
// the removed sequence would join the bytes after it.

type scanState int

const (
	stNormal  scanState = iota
	stEsc               // saw ESC
	stID                // saw ESC ] or U+009D, reading the OSC number
	stPayload           // inside an OSC 52, past its number
)

const (
	bel   = 0x07
	can   = 0x18
	sub   = 0x1a
	esc   = 0x1b
	del   = 0x7f
	c1ST  = 0x9c
	c1OSC = 0x9d

	// idCap bounds the OSC number. Any number past it is not 52, and a
	// number only grows, so the exact value no longer matters.
	idCap = 1000
)

type scanner struct {
	inner io.Reader
	mode  Mode
	audit auditFn

	// pend holds the bytes of a UTF-8 sequence that is not complete yet.
	pend  [4]byte
	npend int
	need  int

	state    scanState
	buffered []byte // the raw bytes of the sequence being examined
	id       int    // the OSC number so far, -1 before its first digit
	inData   bool   // past the selection field of an OSC 52
	selBuf   []byte
	dataLen  int
	// closing is set after an OSC 52 ended at a bare ESC, so a backslash
	// that completes the ST goes with the sequence it closed.
	closing bool

	readBuf []byte
	outBuf  []byte
	outPos  int
	err     error
}

func (s *scanner) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if s.outPos < len(s.outBuf) {
			n := copy(p, s.outBuf[s.outPos:])
			s.outPos += n
			if s.outPos == len(s.outBuf) {
				s.outBuf = s.outBuf[:0]
				s.outPos = 0
			}
			return n, nil
		}
		if s.err != nil {
			return 0, s.err
		}
		if cap(s.readBuf) < len(p) {
			s.readBuf = make([]byte, len(p))
		}
		buf := s.readBuf[:len(p)]
		n, err := s.inner.Read(buf)
		for _, c := range buf[:n] {
			s.stepByte(c)
		}
		if err != nil {
			s.finish()
			s.err = err
		}
	}
}

// stepByte decodes UTF-8 the way xterm.js does and hands each code point,
// with the raw bytes that carried it, to step.
func (s *scanner) stepByte(c byte) {
	if s.npend == 0 {
		switch {
		case c < 0x80:
			s.pend[0] = c
			s.step(rune(c), s.pend[:1])
		case c&0xe0 == 0xc0:
			s.pend[0], s.npend, s.need = c, 1, 2
		case c&0xf0 == 0xe0:
			s.pend[0], s.npend, s.need = c, 1, 3
		case c&0xf8 == 0xf0:
			s.pend[0], s.npend, s.need = c, 1, 4
		default:
			// A stray continuation byte, or a byte no UTF-8 sequence starts
			// with. The terminal drops it.
			s.pend[0] = c
			s.dropped(s.pend[:1])
		}
		return
	}
	if c&0xc0 != 0x80 {
		// The sequence ended early. The terminal drops what it has and
		// reads this byte afresh.
		s.dropped(s.pend[:s.npend])
		s.npend = 0
		s.stepByte(c)
		return
	}
	s.pend[s.npend] = c
	s.npend++
	if s.npend < s.need {
		return
	}
	raw := s.pend[:s.npend]
	s.npend = 0
	var r rune
	switch len(raw) {
	case 2:
		r = rune(raw[0]&0x1f)<<6 | rune(raw[1]&0x3f)
		if r < 0x80 {
			s.dropped(raw)
			return
		}
	case 3:
		r = rune(raw[0]&0x0f)<<12 | rune(raw[1]&0x3f)<<6 | rune(raw[2]&0x3f)
		if r < 0x800 || (r >= 0xd800 && r <= 0xdfff) || r == 0xfeff {
			s.dropped(raw)
			return
		}
	default:
		r = rune(raw[0]&0x07)<<18 | rune(raw[1]&0x3f)<<12 | rune(raw[2]&0x3f)<<6 | rune(raw[3]&0x3f)
		if r < 0x10000 || r > 0x10ffff {
			s.dropped(raw)
			return
		}
	}
	s.step(r, raw)
}

// dropped takes bytes the terminal discards. They change no state, so they
// stay where they are in the stream.
func (s *scanner) dropped(raw []byte) {
	if s.state == stNormal {
		s.emit(raw)
		return
	}
	s.buffered = append(s.buffered, raw...)
}

func (s *scanner) step(r rune, raw []byte) {
	switch s.state {
	case stNormal:
		switch r {
		case esc:
			s.buffered = append(s.buffered[:0], raw...)
			s.state = stEsc
		case c1OSC:
			s.startOSC(raw)
		default:
			s.emit(raw)
		}
	case stEsc:
		switch {
		case r == '\\' && s.closing:
			// The backslash of an ST whose ESC already closed an OSC 52.
			if s.mode != ModeDeny {
				s.emit(s.buffered)
				s.emit(raw)
			}
			s.reset()
		case r == ']':
			s.buffered = append(s.buffered, raw...)
			s.state = stID
			s.id = -1
			s.closing = false
		case (r < 0x20 && r != can && r != sub && r != esc) || r == del:
			// Run or ignored by the terminal, which stays in the ESC state.
			s.buffered = append(s.buffered, raw...)
		default:
			s.release()
			s.step(r, raw)
		}
	case stID:
		switch {
		case r >= '0' && r <= '9':
			if s.id < 0 {
				s.id = 0
			}
			s.id = min(s.id*10+int(r-'0'), idCap)
			s.buffered = append(s.buffered, raw...)
		case r == ';' && s.id == 52:
			s.buffered = append(s.buffered, raw...)
			s.state = stPayload
		case s.id == 52 && (r == bel || r == c1ST || r == esc):
			// An OSC 52 with no data. Treat it as one.
			s.end(r, raw)
		case r < 0x20 && r != bel && r != can && r != sub && r != esc:
			s.buffered = append(s.buffered, raw...)
		default:
			// Not OSC 52, or abandoned before it ran.
			s.release()
			s.step(r, raw)
		}
	case stPayload:
		switch {
		case r == bel || r == c1ST || r == esc:
			s.end(r, raw)
		case r == can || r == sub:
			s.buffered = append(s.buffered, raw...)
			s.close(false)
		case r >= 0x80 && r <= 0x9f:
			// A C1 control leaves the OSC without running it. U+009D also
			// starts a new one.
			s.close(false)
			s.step(r, raw)
		case r < 0x20:
			s.buffered = append(s.buffered, raw...)
		default:
			s.buffered = append(s.buffered, raw...)
			switch {
			case s.inData:
				s.dataLen += len(raw)
			case r == ';':
				s.inData = true
			default:
				s.selBuf = append(s.selBuf, raw...)
			}
		}
	}
}

func (s *scanner) startOSC(raw []byte) {
	s.buffered = append(s.buffered[:0], raw...)
	s.state = stID
	s.id = -1
}

// end closes an OSC 52 at its terminator. A bare ESC closes it and also
// starts the next escape, so it is read again in the ground state.
func (s *scanner) end(r rune, raw []byte) {
	if r == esc {
		s.close(true)
		s.step(r, raw)
		s.closing = true
		return
	}
	s.buffered = append(s.buffered, raw...)
	s.close(true)
}

// close finishes an OSC 52. ran says whether the terminal would run it.
func (s *scanner) close(ran bool) {
	switch s.mode {
	case ModeDeny:
		s.outBuf = append(s.outBuf, can)
	default:
		if ran && s.mode == ModeAudit && s.audit != nil {
			s.audit(string(s.selBuf), s.dataLen)
		}
		s.emit(s.buffered)
	}
	s.reset()
}

// release passes the bytes of a sequence that turned out not to be OSC 52.
func (s *scanner) release() {
	s.emit(s.buffered)
	s.reset()
}

func (s *scanner) reset() {
	s.buffered = s.buffered[:0]
	s.selBuf = s.selBuf[:0]
	s.dataLen = 0
	s.inData = false
	s.id = -1
	s.closing = false
	s.state = stNormal
}

// finish runs at the end of the stream. ModeDeny drops an unfinished
// sequence, because the terminal outlives the session: a reconnect writes the
// next session's output into the same terminal, and that output could
// complete it.
func (s *scanner) finish() {
	if s.state == stNormal && s.npend == 0 {
		return
	}
	// Of the incomplete UTF-8 sequences, only C2 can become a control
	// (U+009D) when the next bytes arrive.
	risky := s.state != stNormal || s.pend[0] == 0xc2
	if s.mode == ModeDeny && risky {
		s.npend = 0
		s.reset()
		s.outBuf = append(s.outBuf, can)
		return
	}
	s.emit(s.buffered)
	s.emit(s.pend[:s.npend])
	s.npend = 0
	s.reset()
}

func (s *scanner) emit(b []byte) {
	s.outBuf = append(s.outBuf, b...)
}
