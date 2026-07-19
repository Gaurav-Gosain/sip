//go:build js && wasm

package sip

import (
	tea "charm.land/bubbletea/v2"

	"github.com/Gaurav-Gosain/sip/wasm"
)

// BrowserProgram is the wasm-bridged BubbleTea program. Same surface as
// the native variant in run_native.go so a single main.go covers both.
type BrowserProgram = wasm.Program

// NewBrowserProgram registers the JavaScript bridge and returns a program
// that the sip web frontend can drive via the boobaWasm-style polling.
var NewBrowserProgram = wasm.NewProgram

// RunBrowser executes the model with the wasm runtime. Native builds
// pick up the run_native.go variant instead.
func RunBrowser(model tea.Model, opts ...tea.ProgramOption) error {
	return wasm.Run(model, opts...)
}
