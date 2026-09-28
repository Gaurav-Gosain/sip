//go:build linux

package sip

import (
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

// masterIsNonBlocking reads O_NONBLOCK without calling Fd, which would
// clear it.
func masterIsNonBlocking(t *testing.T, f *os.File) bool {
	t.Helper()
	rc, err := f.SyscallConn()
	if err != nil {
		t.Fatalf("SyscallConn: %v", err)
	}
	var flags int
	var ferr error
	if err := rc.Control(func(fd uintptr) { flags, ferr = unix.FcntlInt(fd, unix.F_GETFL, 0) }); err != nil {
		t.Fatalf("Control: %v", err)
	}
	if ferr != nil {
		t.Fatalf("F_GETFL: %v", ferr)
	}
	return flags&unix.O_NONBLOCK != 0
}

// TestPTYMasterStaysNonBlocking fails when something puts the PTY master
// back in blocking mode, for example a new Fd call on it. A blocking read
// ignores Close, and session teardown then hangs.
func TestPTYMasterStaysNonBlocking(t *testing.T) {
	t.Run("web", func(t *testing.T) {
		p, err := newPlatformPty(80, 24)
		if err != nil {
			t.Fatal(err)
		}
		defer p.Close()
		_ = p.Resize(100, 30)
		_ = p.ResizeWithPixels(100, 30, 800, 600)
		_, _ = p.InputWriter().Write([]byte("x"))
		_ = p.SlaveFd()
		if !masterIsNonBlocking(t, p.ptyMaster) {
			t.Fatal("PTY master is in blocking mode")
		}
	})
	t.Run("command", func(t *testing.T) {
		p, err := newCmdPlatformPty("sleep", []string{"5"}, "", 80, 24)
		if err != nil {
			t.Fatal(err)
		}
		defer p.Close()
		_ = p.Resize(100, 30)
		_ = p.ResizeWithPixels(100, 30, 800, 600)
		_, _ = p.InputWriter().Write([]byte("x"))
		if !masterIsNonBlocking(t, p.master) {
			t.Fatal("PTY master is in blocking mode")
		}
	})
}
