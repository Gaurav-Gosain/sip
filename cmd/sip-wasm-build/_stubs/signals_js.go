//go:build js && wasm

package tea

// listenForResize is a no-op on js/wasm — the browser handles resize
// events via the FitAddon and sends them through the adapter protocol.
func (p *Program) listenForResize(done chan struct{}) {
	close(done)
}
