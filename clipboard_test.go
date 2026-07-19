//go:build !windows

package sip

import (
	"bytes"
	"encoding/base64"
	"io"
	"os/exec"
	"testing"
	"time"
)

// readPTYUntil reads from r in a background goroutine, accumulating output
// until it contains marker or the deadline elapses. A master PTY does not
// return a clean EOF after the child exits (Linux surfaces EIO), so this
// stops on either the marker, an error, or the timeout rather than blocking
// on io.ReadAll.
func readPTYUntil(t *testing.T, r io.Reader, marker []byte, timeout time.Duration) []byte {
	t.Helper()
	found := make(chan []byte, 1)
	go func() {
		var acc []byte
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				acc = append(acc, buf[:n]...)
				if bytes.Contains(acc, marker) {
					found <- acc
					return
				}
			}
			if err != nil {
				found <- acc
				return
			}
		}
	}()
	select {
	case acc := <-found:
		return acc
	case <-time.After(timeout):
		t.Fatalf("timed out waiting for %q in PTY output", marker)
		return nil
	}
}

// TestChildEnvAdvertisesTermWithMsCap verifies the spawned child sees
// TERM=xterm-256color. That terminfo entry carries the Ms capability
// (\E]52;%p1%s;%p2%s\007), which is what makes tmux willing to emit OSC 52
// to the outer PTY. This is Hop 1 of the copy chain: a TERM without Ms would
// silence clipboard forwarding regardless of any client-side handling.
func TestChildEnvAdvertisesTermWithMsCap(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	p, err := newCmdPlatformPty("sh", []string{"-c", `printf "TERMIS=%s:" "$TERM"`}, "", 80, 24)
	if err != nil {
		t.Fatalf("newCmdPlatformPty: %v", err)
	}
	defer func() { _ = p.Close() }()

	out := readPTYUntil(t, p.OutputReader(), []byte("TERMIS="), 3*time.Second)
	if !bytes.Contains(out, []byte("TERMIS=xterm-256color:")) {
		t.Fatalf("child TERM not xterm-256color; output=%q", out)
	}
}

// TestChildOSC52ReachesOutput verifies that an OSC 52 clipboard-write emitted
// by the child program is forwarded unchanged through the server's output
// reader. The default server wires no OSC 52 gate, so the sequence a program
// (or tmux) writes must reach the client byte-for-byte. This is the
// server-side analogue of the websocket-level emission check from the trace:
// prove the pipe carries OSC 52 rather than swallowing it.
func TestChildOSC52ReachesOutput(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("sh not available")
	}
	want := base64.StdEncoding.EncodeToString([]byte("arch-btw"))
	// printf the OSC 52 with a BEL terminator, bracketed by markers so we can
	// find it in the stream regardless of shell prompt noise.
	script := `printf "S<\033]52;c;` + want + `\007>E"`
	p, err := newCmdPlatformPty("sh", []string{"-c", script}, "", 80, 24)
	if err != nil {
		t.Fatalf("newCmdPlatformPty: %v", err)
	}
	defer func() { _ = p.Close() }()

	out := readPTYUntil(t, p.OutputReader(), []byte(">E"), 3*time.Second)
	seq := "\x1b]52;c;" + want + "\x07"
	if !bytes.Contains(out, []byte(seq)) {
		t.Fatalf("OSC 52 not forwarded intact; output=%q want to contain %q", out, seq)
	}
}
