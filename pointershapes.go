package sip

// The kitty mouse pointer shapes protocol, OSC 22.
//
// A program running in the terminal names the shape the mouse pointer takes:
// `wait` while it is busy, `ew-resize` over a pane divider, `pointer` over a
// button. The specification is at
// https://sw.kovidgoyal.net/kitty/pointer-shapes/.
//
// The sequence is parsed in the browser, in static/terminal.js, because that
// is where the pointer is and where the terminal state the specification ties
// this to already lives. This file is here for the one thing the Go side owns:
// the canonical list of shape names, and the guard that keeps the browser's
// copy of it identical.
//
// Why the list is here at all, rather than only in the client: it is also the
// allowlist behind Appearance.MouseCursor. The two are different questions
// asked of the same vocabulary, so one list of names answers both and cannot
// drift apart the way two hand-written lists do.

// pointerShapes is the thirty shape names the specification requires every
// conforming terminal to support, in the specification's own order.
//
// They are CSS cursor keywords, which is why sip is a good host for this
// protocol: a native terminal has to map each one onto a platform cursor and
// the browser already has every one of them. The list is closed. A name a
// program sends that is not in it is not supported, and sip says so when
// asked rather than guessing at an alias.
var pointerShapes = []string{
	"alias", "cell", "copy", "crosshair", "default",
	"e-resize", "ew-resize", "grab", "grabbing", "help",
	"move", "n-resize", "ne-resize", "nesw-resize", "no-drop",
	"not-allowed", "ns-resize", "nw-resize", "nwse-resize", "pointer",
	"progress", "s-resize", "se-resize", "sw-resize", "text",
	"vertical-text", "w-resize", "wait", "zoom-in", "zoom-out",
}

// extraMouseCursors are CSS cursor keywords a deployment may choose for
// Appearance.MouseCursor that the protocol deliberately does not offer a
// program.
//
// The two allowlists stay separate for one reason: they answer different
// questions. Appearance.MouseCursor is the deployment's own choice of resting
// cursor, made once, in Go, by the person running the server. The protocol's
// thirty are what an arbitrary program on the far side of a PTY may ask for.
// "none" is the clear case. A kiosk that hides the pointer is a reasonable
// deployment; a program that hides the user's pointer is a program the user
// then cannot click away from.
var extraMouseCursors = []string{"none", "auto", "context-menu", "all-scroll"}

// mouseCursors are the CSS cursor keywords Appearance.MouseCursor accepts: the
// protocol's thirty plus the four above.
//
// An allowlist rather than a free string, for the reason Color is hex-only: a
// browser ignores a cursor value it does not know and keeps the one it had, so
// a typo would read as the option doing nothing.
var mouseCursors = func() map[string]bool {
	m := make(map[string]bool, len(pointerShapes)+len(extraMouseCursors))
	for _, s := range pointerShapes {
		m[s] = true
	}
	for _, s := range extraMouseCursors {
		m[s] = true
	}
	return m
}()
