//go:build windows
// +build windows

package sip

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	xpty "github.com/charmbracelet/x/xpty"
)

// cmdPlatformPty holds platform-specific PTY resources for command execution.
type cmdPlatformPty struct {
	pty      xpty.Pty
	cmd      *exec.Cmd
	waitOnce sync.Once
	waitErr  error
	waitDone chan struct{}
}

// newCmdPlatformPty creates a new PTY and spawns the command on Windows.
func newCmdPlatformPty(name string, args []string, dir string, cols, rows int) (*cmdPlatformPty, error) {
	ptyInstance, err := xpty.NewPty(cols, rows)
	if err != nil {
		return nil, fmt.Errorf("failed to open PTY: %w", err)
	}

	// Set up command
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	// Start the command with PTY (xpty handles Windows ConPTY setup)
	if err := ptyInstance.Start(cmd); err != nil {
		_ = ptyInstance.Close()
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	return &cmdPlatformPty{
		pty:      ptyInstance,
		cmd:      cmd,
		waitDone: make(chan struct{}),
	}, nil
}

// Close closes the PTY and reaps the command. It is safe to call
// concurrently with the reaper's Wait: both funnel through the single
// waitOnce owner. Close returns only once the child has been reaped.
func (p *cmdPlatformPty) Close() error {
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	if p.pty != nil {
		_ = p.pty.Close()
	}
	if p.cmd != nil {
		_ = p.Wait()
	}
	return nil
}

// Resize resizes the PTY.
func (p *cmdPlatformPty) Resize(cols, rows int) error {
	if p.pty != nil {
		return p.pty.Resize(cols, rows)
	}
	return nil
}

// ResizeWithPixels ignores pixel dimensions on Windows ConPTY and
// falls back to character-only Resize.
func (p *cmdPlatformPty) ResizeWithPixels(cols, rows, _, _ int) error {
	return p.Resize(cols, rows)
}

// OutputReader returns an io.Reader for reading command output.
func (p *cmdPlatformPty) OutputReader() io.Reader {
	return p.pty
}

// InputWriter returns an io.Writer for writing command input.
func (p *cmdPlatformPty) InputWriter() io.Writer {
	return p.pty
}

// Wait waits for the command to exit. It is the single owner of the
// process reap: repeated or concurrent calls block on the first one's
// result instead of waiting again.
func (p *cmdPlatformPty) Wait() error {
	p.waitOnce.Do(func() {
		if p.cmd != nil {
			p.waitErr = xpty.WaitProcess(context.Background(), p.cmd)
		}
		close(p.waitDone)
	})
	<-p.waitDone
	return p.waitErr
}

// Process returns the underlying process.
func (p *cmdPlatformPty) Process() *os.Process {
	if p.cmd != nil {
		return p.cmd.Process
	}
	return nil
}
