//go:build linux

package sip

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

// pollableMaster returns a non-blocking duplicate of a PTY master for
// reads and writes.
//
// creack/pty calls Fd on the master for its ioctls, which puts the
// *os.File in blocking mode. A read on it then cannot be interrupted:
// Close waits for the read to return, and the read returns only when
// every process has closed the slave. A process that keeps the terminal
// (a background child) would hold the output loop and the whole
// connection. The duplicate goes through the runtime poller, so Close
// ends a pending read at once.
//
// O_NONBLOCK belongs to the open file description, which the duplicate
// shares with the original. The original must only be used for ioctls
// (through SyscallConn) and Close from now on. Never call Fd on the
// original (UnixPty.Fd, Master().Fd): os.File.Fd on it clears O_NONBLOCK
// on the shared description, and every read is blocking again.
// TestPTYMasterStaysNonBlocking checks this.
//
// This is Linux only, where epoll takes a PTY master. On other systems
// Go leaves a non-blocking file that kqueue refuses outside the poller,
// and reads then fail with EAGAIN. See pty_other.go.
func pollableMaster(master *os.File) (*os.File, error) {
	rc, err := master.SyscallConn()
	if err != nil {
		return nil, err
	}
	nfd := -1
	var dupErr error
	if err := rc.Control(func(fd uintptr) {
		nfd, dupErr = unix.FcntlInt(fd, unix.F_DUPFD_CLOEXEC, 0)
	}); err != nil {
		return nil, err
	}
	if dupErr != nil {
		return nil, fmt.Errorf("dup PTY master: %w", dupErr)
	}
	if err := unix.SetNonblock(nfd, true); err != nil {
		_ = unix.Close(nfd)
		return nil, fmt.Errorf("set PTY master non-blocking: %w", err)
	}
	return os.NewFile(uintptr(nfd), master.Name()), nil
}
