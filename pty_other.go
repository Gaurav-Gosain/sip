//go:build !windows && !linux

package sip

import "os"

// pollableMaster returns the master itself outside Linux. Reads stay
// blocking, as creack/pty leaves them. A blocking read ignores Close, so
// a read ends only with output or EIO. EIO comes when every process has
// closed the slave. A process that keeps the terminal open then holds the
// output loop until it exits. The Linux version (pty_linux.go) does not
// have this limit.
//
// Close may run twice on the same file (the session and the PTY both
// close it). The second Close returns an error that callers ignore.
func pollableMaster(master *os.File) (*os.File, error) {
	return master, nil
}
