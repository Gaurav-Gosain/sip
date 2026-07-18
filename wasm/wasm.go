//go:build js && wasm

// Package wasm provides a bridge for running BubbleTea programs in the
// browser. It registers JavaScript functions on window
// (bubbletea_read, bubbletea_write, bubbletea_resize) that the sip web
// frontend's SipWasmAdapter polls to shuttle data between the
// libghostty terminal emulator and the Go program.
//
// Usage:
//
//	//go:build js && wasm
//	package main
//
//	import "github.com/Gaurav-Gosain/sip/wasm"
//
//	func main() {
//	    wasm.Run(initialModel())
//	}
package wasm

import (
	"bytes"
	"os"
	"sync"
	"syscall/js"

	tea "charm.land/bubbletea/v2"
)

// Program wraps a BubbleTea program for the browser.
type Program struct {
	prog       *tea.Program
	fromJS     *syncBuffer
	toJS       *syncBuffer
	writeFunc  js.Func
	readFunc   js.Func
	resizeFunc js.Func
}

// NewProgram creates a new BubbleTea program for the browser. It
// registers the JavaScript bridge functions but does not start the
// program.
func NewProgram(model tea.Model, opts ...tea.ProgramOption) *Program {
	fromJS := newSyncBuffer()
	toJS := newSyncBuffer()

	os.Setenv("TERM", "xterm-256color")
	os.Setenv("COLORTERM", "truecolor")
	os.Setenv("CLICOLOR_FORCE", "1")

	baseOpts := []tea.ProgramOption{
		tea.WithInput(fromJS),
		tea.WithOutput(toJS),
	}

	prog := tea.NewProgram(model, append(baseOpts, opts...)...)

	p := &Program{
		prog:   prog,
		fromJS: fromJS,
		toJS:   toJS,
	}

	p.writeFunc = js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) > 0 {
			p.fromJS.Write([]byte(args[0].String()))
		}
		return nil
	})
	js.Global().Set("bubbletea_write", p.writeFunc)

	p.readFunc = js.FuncOf(func(_ js.Value, _ []js.Value) any {
		data := p.toJS.ReadAndReset()
		if len(data) == 0 {
			return ""
		}
		return string(data)
	})
	js.Global().Set("bubbletea_read", p.readFunc)

	p.resizeFunc = js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) >= 2 {
			p.prog.Send(tea.WindowSizeMsg{
				Width:  args[0].Int(),
				Height: args[1].Int(),
			})
		}
		return nil
	})
	js.Global().Set("bubbletea_resize", p.resizeFunc)

	return p
}

// Run starts the program and blocks until it exits.
func (p *Program) Run() (tea.Model, error) {
	defer p.writeFunc.Release()
	defer p.readFunc.Release()
	defer p.resizeFunc.Release()
	return p.prog.Run()
}

func (p *Program) Send(msg tea.Msg)              { p.prog.Send(msg) }
func (p *Program) Quit()                         { p.prog.Quit() }
func (p *Program) Kill()                         { p.prog.Kill() }
func (p *Program) Wait()                         { p.prog.Wait() }
func (p *Program) ReleaseTerminal() error        { return nil }
func (p *Program) RestoreTerminal() error        { return nil }
func (p *Program) Println(args ...any)           { p.prog.Println(args...) }
func (p *Program) Printf(t string, args ...any)  { p.prog.Printf(t, args...) }

// Run creates a BubbleTea program from the given model, registers the
// JavaScript bridge functions, and blocks until the program exits.
func Run(model tea.Model, opts ...tea.ProgramOption) error {
	_, err := NewProgram(model, opts...).Run()
	return err
}

// syncBuffer is a goroutine-safe buffer for bridging Go I/O with
// JavaScript's single-threaded polling.
type syncBuffer struct {
	mu   sync.Mutex
	cond *sync.Cond
	buf  bytes.Buffer
}

func newSyncBuffer() *syncBuffer {
	b := &syncBuffer{}
	b.cond = sync.NewCond(&b.mu)
	return b
}

func (b *syncBuffer) Read(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for b.buf.Len() == 0 {
		b.cond.Wait()
	}
	return b.buf.Read(p)
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n, err := b.buf.Write(p)
	b.cond.Signal()
	return n, err
}

// ReadAndReset returns all buffered data and resets the buffer.
func (b *syncBuffer) ReadAndReset() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buf.Len() == 0 {
		return nil
	}
	data := make([]byte, b.buf.Len())
	copy(data, b.buf.Bytes())
	b.buf.Reset()
	return data
}
