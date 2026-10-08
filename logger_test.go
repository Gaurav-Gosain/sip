package sip

import (
	"bytes"
	"testing"
)

// TestLogCarriesNoColour pins the log as plain text. A log is read from files
// and journals, where an escape sequence is noise.
func TestLogCarriesNoColour(t *testing.T) {
	var buf bytes.Buffer
	l := newLogger(&buf)
	l.Info("server ready", "url", "http://localhost:7681")
	l.Warn("message too large", "session", "1", "size", 99)
	l.Error("program error", "error", "boom")
	if buf.Len() == 0 {
		t.Fatal("the logger wrote nothing")
	}
	if i := bytes.IndexByte(buf.Bytes(), 0x1b); i >= 0 {
		t.Fatalf("the log carries an escape sequence at byte %d: %q", i, buf.String())
	}
}
