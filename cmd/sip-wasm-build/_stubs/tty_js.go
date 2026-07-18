//go:build js && wasm

package tea

// suspendSupported is false on js/wasm — there is no process suspension
// in a browser environment.
const suspendSupported = false

// suspendProcess is a no-op on js/wasm.
func suspendProcess() {}

// initInput is a no-op on js/wasm — input comes from the browser terminal
// via JavaScript interop, not from a TTY.
func (p *Program) initInput() error {
	return nil
}
