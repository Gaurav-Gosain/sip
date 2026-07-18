//go:build windows
// +build windows

package sip

import (
	"io"
	"os"
)

// platformPty holds platform-specific PTY resources.
// On Windows, we use io.Pipe() since ConPty is designed for spawning
// child processes, not for in-process terminal emulation.
type platformPty struct {
	// Pipes for terminal I/O
	inputReader  *io.PipeReader // Bubble Tea reads input from here
	inputWriter  *io.PipeWriter // Handler writes input here
	outputReader *io.PipeReader // Handler reads output from here
	outputWriter *io.PipeWriter // Bubble Tea writes output here

	// Fake slave file for Bubble Tea compatibility
	// On Windows, we create a pipe-based solution
	slaveReadFile  *os.File
	slaveWriteFile *os.File
}

// newPlatformPty creates pipe-based I/O for Windows.
// We use io.Pipe() which provides proper synchronization.
// Note: cols/rows are unused on Windows since we don't have a real PTY;
// resize is handled via tea.WindowSizeMsg instead.
func newPlatformPty(_, _ int) (*platformPty, error) {
	// Create pipes for input (handler -> Bubble Tea)
	inputReader, inputWriter := io.Pipe()

	// Create pipes for output (Bubble Tea -> handler)
	outputReader, outputWriter := io.Pipe()

	return &platformPty{
		inputReader:  inputReader,
		inputWriter:  inputWriter,
		outputReader: outputReader,
		outputWriter: outputWriter,
	}, nil
}

// Close closes all pipe resources.
func (p *platformPty) Close() error {
	if p.inputReader != nil {
		_ = p.inputReader.Close()
	}
	if p.inputWriter != nil {
		_ = p.inputWriter.Close()
	}
	if p.outputReader != nil {
		_ = p.outputReader.Close()
	}
	if p.outputWriter != nil {
		_ = p.outputWriter.Close()
	}
	return nil
}

// Resize is a no-op on Windows since we use pipes.
// Resize is handled via tea.WindowSizeMsg instead.
func (p *platformPty) Resize(cols, rows int) error {
	// No-op: resize is handled by sending tea.WindowSizeMsg directly
	return nil
}

// ResizeWithPixels is a no-op on Windows (pipe-backed). Pixel dimensions
// are not propagated since there is no PTY ioctl path.
func (p *platformPty) ResizeWithPixels(_, _, _, _ int) error {
	return nil
}

// OutputReader returns an io.Reader for reading terminal output.
// On Windows, this reads from the output pipe.
func (p *platformPty) OutputReader() io.Reader {
	return p.outputReader
}

// InputWriter returns an io.Writer for writing terminal input.
// On Windows, this writes to the input pipe.
func (p *platformPty) InputWriter() io.Writer {
	return p.inputWriter
}

// SlaveFile returns nil on Windows since we don't have a real PTY.
// Bubble Tea will use the pipe reader/writer directly via SlaveReader/SlaveWriter.
func (p *platformPty) SlaveFile() *os.File {
	return nil
}

// SlaveFd returns 0 on Windows since we don't have a real PTY slave.
func (p *platformPty) SlaveFd() uintptr {
	return 0
}

// SlaveReader returns the reader for Bubble Tea input on Windows.
func (p *platformPty) SlaveReader() io.Reader {
	return p.inputReader
}

// SlaveWriter returns the writer for Bubble Tea output on Windows.
func (p *platformPty) SlaveWriter() io.Writer {
	return p.outputWriter
}
