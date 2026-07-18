package osc52gate

import (
	"context"
	"io"
	"testing"

	"github.com/Gaurav-Gosain/sip"
)

// chunkedReader hands back one predefined chunk per Read call, then EOF.
// It models a PTY delivering output in arbitrary boundaries so escapes
// can be split across reads.
type chunkedReader struct {
	chunks [][]byte
	i      int
}

func (c *chunkedReader) Read(p []byte) (int, error) {
	if c.i >= len(c.chunks) {
		return 0, io.EOF
	}
	n := copy(p, c.chunks[c.i])
	c.i++
	return n, nil
}

// fakeSession is a minimal sip.SessionIO exposing a fixed output reader.
type fakeSession struct {
	out io.Reader
}

func (f *fakeSession) OutputReader() io.Reader  { return f.out }
func (f *fakeSession) InputWriter() io.Writer   { return io.Discard }
func (f *fakeSession) Resize(_, _ int)          {}
func (f *fakeSession) Done() <-chan struct{}    { return nil }
func (f *fakeSession) Context() context.Context { return context.Background() }
func (f *fakeSession) Close() error             { return nil }

func newGated(mode Mode, chunks ...[]byte) sip.SessionIO {
	mw := New(mode)
	return mw(&fakeSession{out: &chunkedReader{chunks: chunks}})
}

// TestOutputReaderPersistent asserts the gate returns the same reader on
// every call, so the byte-level scan state survives across the handler's
// per-iteration OutputReader().Read loop.
func TestOutputReaderPersistent(t *testing.T) {
	g := newGated(ModeAllow, []byte("x"))
	if a, b := g.OutputReader(), g.OutputReader(); a != b {
		t.Fatalf("OutputReader returned different readers: %p vs %p", a, b)
	}
}

// TestModeDenyStripsSplitEscape verifies an OSC 52 write split across two
// reads is fully removed. With a fresh scanner per call the second half
// leaks through; the persistent scanner strips the whole sequence.
func TestModeDenyStripsSplitEscape(t *testing.T) {
	g := newGated(ModeDeny,
		[]byte("AB\x1b]52;c;SGVs"),
		[]byte("bG8=\x07CD"),
	)
	got, err := io.ReadAll(g.OutputReader())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != "ABCD" {
		t.Fatalf("ModeDeny output = %q, want %q", got, "ABCD")
	}
}

// TestModeAllowPassesSplitSequence verifies a sequence split mid-escape
// across reads is passed through byte-for-byte, not corrupted.
func TestModeAllowPassesSplitSequence(t *testing.T) {
	// SGR split with the ESC at a chunk boundary.
	g := newGated(ModeAllow,
		[]byte("AB\x1b"),
		[]byte("[31mCD"),
	)
	got, err := io.ReadAll(g.OutputReader())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if want := "AB\x1b[31mCD"; string(got) != want {
		t.Fatalf("ModeAllow output = %q, want %q", got, want)
	}

	// A full OSC 52 split across reads must survive intact.
	g2 := newGated(ModeAllow,
		[]byte("\x1b]52;c;SGVs"),
		[]byte("bG8=\x07"),
	)
	got2, err := io.ReadAll(g2.OutputReader())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if want := "\x1b]52;c;SGVsbG8=\x07"; string(got2) != want {
		t.Fatalf("ModeAllow OSC52 output = %q, want %q", got2, want)
	}
}
