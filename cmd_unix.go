//go:build !windows
// +build !windows

package sip

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"

	xpty "github.com/charmbracelet/x/xpty"
)

// cmdPlatformPty holds platform-specific PTY resources for command execution.
type cmdPlatformPty struct {
	pty xpty.Pty
	cmd *exec.Cmd
}

// newCmdPlatformPty creates a new PTY and spawns the command on Unix systems.
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

	// Set up the command to use the PTY as controlling terminal
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setsid:  true, // Create new session
		Setctty: true, // Set controlling terminal
		Ctty:    0,    // Use stdin (which will be the PTY slave)
	}

	// Start the command with PTY
	if err := ptyInstance.Start(cmd); err != nil {
		_ = ptyInstance.Close()
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	return &cmdPlatformPty{
		pty: ptyInstance,
		cmd: cmd,
	}, nil
}

// Close closes the PTY and waits for the command to exit.
func (p *cmdPlatformPty) Close() error {
	if p.pty != nil {
		_ = p.pty.Close()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_ = p.cmd.Wait()
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

// ResizeWithPixels forwards pixel dimensions to TIOCSWINSZ when the
// underlying PTY supports it (UnixPty does). Otherwise plain Resize.
func (p *cmdPlatformPty) ResizeWithPixels(cols, rows, widthPx, heightPx int) error {
	if p.pty == nil {
		return nil
	}
	type pixelResizer interface {
		SetWinsize(width, height, x, y int) error
	}
	if pr, ok := p.pty.(pixelResizer); ok && (widthPx > 0 || heightPx > 0) {
		return pr.SetWinsize(cols, rows, widthPx, heightPx)
	}
	return p.pty.Resize(cols, rows)
}

// OutputReader returns an io.Reader for reading command output.
func (p *cmdPlatformPty) OutputReader() io.Reader {
	return p.pty
}

// InputWriter returns an io.Writer for writing command input.
func (p *cmdPlatformPty) InputWriter() io.Writer {
	return p.pty
}

// Wait waits for the command to exit.
func (p *cmdPlatformPty) Wait() error {
	if p.cmd != nil {
		return p.cmd.Wait()
	}
	return nil
}

// Process returns the underlying process.
func (p *cmdPlatformPty) Process() *os.Process {
	if p.cmd != nil {
		return p.cmd.Process
	}
	return nil
}
