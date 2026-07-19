//go:build !js

package sip

import (
	tea "charm.land/bubbletea/v2"
)

// BrowserProgram wraps a BubbleTea program for either native or
// browser (wasm) execution. On native builds it delegates to a
// standard tea.Program.
type BrowserProgram struct {
	prog *tea.Program
}

// NewBrowserProgram returns a BrowserProgram that runs the model with
// a native tea.Program. On `GOOS=js GOARCH=wasm` this same call (built
// from run_js.go) returns a wasm-bridged program instead.
func NewBrowserProgram(model tea.Model, opts ...tea.ProgramOption) *BrowserProgram {
	return &BrowserProgram{prog: tea.NewProgram(model, opts...)}
}

func (p *BrowserProgram) Run() (tea.Model, error)      { return p.prog.Run() }
func (p *BrowserProgram) Send(msg tea.Msg)             { p.prog.Send(msg) }
func (p *BrowserProgram) Quit()                        { p.prog.Quit() }
func (p *BrowserProgram) Kill()                        { p.prog.Kill() }
func (p *BrowserProgram) Wait()                        { p.prog.Wait() }
func (p *BrowserProgram) ReleaseTerminal() error       { return p.prog.ReleaseTerminal() }
func (p *BrowserProgram) RestoreTerminal() error       { return p.prog.RestoreTerminal() }
func (p *BrowserProgram) Println(args ...any)          { p.prog.Println(args...) }
func (p *BrowserProgram) Printf(t string, args ...any) { p.prog.Printf(t, args...) }

// RunBrowser executes the model with the appropriate runtime for the
// build target. On native this is a regular tea.Program; on wasm this
// installs the JavaScript bridge that the sip web frontend speaks to.
//
// The same main.go works on both targets when wrapped in this helper.
func RunBrowser(model tea.Model, opts ...tea.ProgramOption) error {
	_, err := NewBrowserProgram(model, opts...).Run()
	return err
}
