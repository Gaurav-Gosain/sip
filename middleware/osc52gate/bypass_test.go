package osc52gate

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

// The model below is the reference the scanner is checked against: a port of
// the parts of the xterm.js parser that decide whether OSC 52 runs. It is
// written apart from the scanner, as a batch over the whole input, so the two
// do not share a mistake by construction. The source is the vendored
// static/webterm.js: Utf8ToUtf32.decode and the transition table of
// EscapeSequenceParser (VT500 states, OSC_STRING is state 8).

// xtermDecode is Utf8ToUtf32.decode over a complete input.
func xtermDecode(b []byte) []rune {
	var out []rune
	n := len(b)
	for l := 0; l < n; {
		c := b[l]
		l++
		switch {
		case c < 0x80:
			out = append(out, rune(c))
		case c&0xe0 == 0xc0:
			if l >= n {
				return out
			}
			r := b[l]
			l++
			if r&0xc0 != 0x80 {
				l--
				continue
			}
			h := rune(c&0x1f)<<6 | rune(r&0x3f)
			if h < 0x80 {
				l--
				continue
			}
			out = append(out, h)
		case c&0xf0 == 0xe0:
			if l >= n {
				return out
			}
			r := b[l]
			l++
			if r&0xc0 != 0x80 {
				l--
				continue
			}
			if l >= n {
				return out
			}
			e := b[l]
			l++
			if e&0xc0 != 0x80 {
				l--
				continue
			}
			h := rune(c&0x0f)<<12 | rune(r&0x3f)<<6 | rune(e&0x3f)
			if h < 0x800 || (h >= 0xd800 && h <= 0xdfff) || h == 0xfeff {
				continue
			}
			out = append(out, h)
		case c&0xf8 == 0xf0:
			if l >= n {
				return out
			}
			r := b[l]
			l++
			if r&0xc0 != 0x80 {
				l--
				continue
			}
			if l >= n {
				return out
			}
			e := b[l]
			l++
			if e&0xc0 != 0x80 {
				l--
				continue
			}
			if l >= n {
				return out
			}
			f := b[l]
			l++
			if f&0xc0 != 0x80 {
				l--
				continue
			}
			h := rune(c&0x07)<<18 | rune(r&0x3f)<<12 | rune(e&0x3f)<<6 | rune(f&0x3f)
			if h < 0x10000 || h > 0x10ffff {
				continue
			}
			out = append(out, h)
		}
	}
	return out
}

// xtermOSC52Runs counts the OSC 52 sequences xterm.js would run on b.
//
// Ground stands for every state that is not ESC or OSC: from all of them,
// only ESC and U+009D lead into an OSC. An OSC 52 that ends before its ';'
// is counted too. xterm.js may or may not hand it to the handler, and the
// filter must not depend on which.
func xtermOSC52Runs(b []byte) int {
	const (
		ground = iota
		escape
		osc
	)
	const (
		phaseID = iota
		phasePayload
		phaseAbort
	)
	state, phase := ground, phaseID
	var digits strings.Builder
	runs := 0
	isID52 := func() bool { return strings.TrimLeft(digits.String(), "0") == "52" }
	for _, r := range xtermDecode(b) {
		if state == osc {
			switch r {
			case 0x07, 0x9c, 0x1b:
				if phase != phaseAbort && isID52() {
					runs++
				}
				state = ground
				if r == 0x1b {
					state = escape
				}
				continue
			case 0x18, 0x1a:
				state = ground
				continue
			}
		}
		switch {
		case r == 0x18 || r == 0x1a:
			state = ground
			continue
		case r == 0x1b:
			state = escape
			continue
		case r == 0x9d:
			state, phase = osc, phaseID
			digits.Reset()
			continue
		case r >= 0x80 && r <= 0x9f:
			state = ground
			continue
		}
		switch state {
		case escape:
			if r < 0x20 || r == 0x7f {
				continue
			}
			if r == ']' {
				state, phase = osc, phaseID
				digits.Reset()
				continue
			}
			state = ground
		case osc:
			if r < 0x20 {
				continue
			}
			if phase != phaseID {
				continue
			}
			switch {
			case r >= '0' && r <= '9':
				digits.WriteRune(r)
			case r == ';':
				phase = phasePayload
			default:
				phase = phaseAbort
			}
		}
	}
	return runs
}

// filter runs input through a scanner in the given mode, cut into reads of
// the given sizes (cycled), and returns the output and the audit count.
func filter(mode Mode, input []byte, sizes []int) ([]byte, int) {
	audits := 0
	audit := func(string, int) { audits++ }
	var chunks [][]byte
	for i, k := 0, 0; i < len(input); k++ {
		size := len(input)
		if len(sizes) > 0 {
			size = max(1, sizes[k%len(sizes)])
		}
		end := min(i+size, len(input))
		chunks = append(chunks, input[i:end])
		i = end
	}
	out, err := io.ReadAll(newScanner(&splitReader{chunks: chunks}, mode, audit))
	if err != nil {
		panic(err)
	}
	return out, audits
}

// TestDenyBypasses holds the inputs that walked past ModeDeny. Each one runs
// OSC 52 in xterm.js, which the first check proves, so the test cannot pass
// on an input that was never a bypass.
func TestDenyBypasses(t *testing.T) {
	const payload = "52;c;cHduZWQ=\x07"
	cases := []struct {
		name  string
		input string
	}{
		{"doubled ESC", "a\x1b\x1b]" + payload + "b"},
		{"ESC restarts inside the number", "a\x1b]5\x1b]" + payload + "b"},
		{"leading zero in the number", "a\x1b]0" + payload + "b"},
		{"C1 OSC", "a\xc2\x9d" + payload + "b"},
		{"malformed UTF-8 in the number", "a\x1b]5\xff2;c;cHduZWQ=\x07b"},
		{"byte order mark in the number", "a\x1b]5\xef\xbb\xbf2;c;cHduZWQ=\x07b"},
		{"C0 control in the ESC state", "a\x1b\x05]" + payload + "b"},
		{"C0 control in the number", "a\x1b]5\x012;c;cHduZWQ=\x07b"},
		{"ended by a bare ESC", "a\x1b]52;c;cHduZWQ=\x1b[mb"},
		{"ended by C1 ST", "a\x1b]52;c;cHduZWQ=\xc2\x9cb"},
		{"ESC left before a removed sequence", "\x1b\x1b]" + payload + "]" + payload},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if xtermOSC52Runs([]byte(tc.input)) == 0 {
				t.Fatalf("xterm.js would not run OSC 52 on %q, so it is no bypass", tc.input)
			}
			for _, sizes := range [][]int{nil, {1}, {2, 3}} {
				out, _ := filter(ModeDeny, []byte(tc.input), sizes)
				if n := xtermOSC52Runs(out); n != 0 {
					t.Fatalf("reads of %v: ModeDeny output %q still runs OSC 52 %d times", sizes, out, n)
				}
			}
		})
	}
}

// TestDenyDropsAnUnfinishedSequenceAtTheEnd covers the stream that ends
// inside an OSC 52. The terminal outlives the session, so the next session's
// first bytes would finish it.
func TestDenyDropsAnUnfinishedSequenceAtTheEnd(t *testing.T) {
	for _, tail := range []string{"\x1b]52;c;cHduZWQ=", "\x1b]5", "\x1b", "\xc2"} {
		out, _ := filter(ModeDeny, []byte("ok"+tail), nil)
		next := append(out, []byte("2;c;cHduZWQ=\x07")...)
		if bytes.HasPrefix([]byte(tail), []byte("\x1b]52")) {
			next = append(out, '\x07')
		} else if tail == "\x1b" {
			next = append(out, []byte("]52;c;cHduZWQ=\x07")...)
		} else if tail == "\xc2" {
			next = append(out, []byte("\x9d52;c;cHduZWQ=\x07")...)
		}
		if xtermOSC52Runs(next) != 0 {
			t.Errorf("tail %q: output %q lets the next session finish an OSC 52", tail, out)
		}
	}
}

// TestScannerReusesItsReadBuffer pins the allocation the old scanner made on
// every Read.
func TestScannerReusesItsReadBuffer(t *testing.T) {
	src := &repeatReader{b: []byte("plain output with \x1b[31mcolour\x1b[m\r\n")}
	sc := newScanner(src, ModeDeny, nil)
	buf := make([]byte, 4096)
	_, _ = sc.Read(buf)
	allocs := testing.AllocsPerRun(100, func() {
		if _, err := sc.Read(buf); err != nil {
			t.Fatal(err)
		}
	})
	if allocs != 0 {
		t.Fatalf("Read allocates %.1f times per call, want 0", allocs)
	}
}

// splitReader returns at most one chunk per Read and keeps what does not fit
// in p for the next call.
type splitReader struct{ chunks [][]byte }

func (r *splitReader) Read(p []byte) (int, error) {
	for len(r.chunks) > 0 && len(r.chunks[0]) == 0 {
		r.chunks = r.chunks[1:]
	}
	if len(r.chunks) == 0 {
		return 0, io.EOF
	}
	n := copy(p, r.chunks[0])
	r.chunks[0] = r.chunks[0][n:]
	return n, nil
}

type repeatReader struct{ b []byte }

func (r *repeatReader) Read(p []byte) (int, error) { return copy(p, r.b), nil }

// FuzzScanner checks the scanner against the xterm.js model.
//
//   - ModeDeny output never runs OSC 52.
//   - ModeAllow and ModeAudit pass every byte through unchanged.
//   - ModeAudit reports each OSC 52 xterm.js runs, once.
//   - Read boundaries change nothing.
//   - Input with no ESC and no C2 byte cannot start a sequence, so ModeDeny
//     passes it unchanged.
func FuzzScanner(f *testing.F) {
	for _, s := range []string{
		"plain",
		"\x1b]52;c;SGVsbG8=\x07",
		"\x1b]52;c;SGVsbG8=\x1b\\",
		"a\x1b\x1b]52;c;cHduZWQ=\x07b",
		"a\x1b]5\x1b]52;c;cHduZWQ=\x07b",
		"a\x1b]052;c;cHduZWQ=\x07b",
		"a\xc2\x9d52;c;cHduZWQ=\x07b",
		"a\x1b]5\xff2;c;x\x07b",
		"\x1b]0;title\x07\x1b[1;31mred\x1b[m",
		"\x1bP1;2|data\x1b\\",
		"\xe2\x9c\x9d \xc2\xa0 \xf0\x9f\x98\x80",
	} {
		f.Add([]byte(s), []byte{3, 1, 7})
	}
	f.Fuzz(func(t *testing.T, input, sizeBytes []byte) {
		sizes := make([]int, 0, len(sizeBytes))
		for _, b := range sizeBytes {
			sizes = append(sizes, int(b%16)+1)
		}

		deny, _ := filter(ModeDeny, input, sizes)
		if n := xtermOSC52Runs(deny); n != 0 {
			t.Fatalf("ModeDeny output %q runs OSC 52 %d times", deny, n)
		}
		if whole, _ := filter(ModeDeny, input, nil); !bytes.Equal(whole, deny) {
			t.Fatalf("ModeDeny output depends on read sizes: %q in one read, %q in reads of %v", whole, deny, sizes)
		}
		if bytes.IndexByte(input, 0x1b) < 0 && bytes.IndexByte(input, 0xc2) < 0 && !bytes.Equal(deny, input) {
			t.Fatalf("ModeDeny changed %q, which has no escape, to %q", input, deny)
		}

		allow, _ := filter(ModeAllow, input, sizes)
		if !bytes.Equal(allow, input) {
			t.Fatalf("ModeAllow changed %q to %q", input, allow)
		}
		audit, audits := filter(ModeAudit, input, sizes)
		if !bytes.Equal(audit, input) {
			t.Fatalf("ModeAudit changed %q to %q", input, audit)
		}
		if want := xtermOSC52Runs(input); audits != want {
			t.Fatalf("ModeAudit reported %d OSC 52 writes in %q, xterm.js runs %d", audits, input, want)
		}
	})
}
