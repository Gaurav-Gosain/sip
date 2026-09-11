package sip

import (
	"fmt"
	"strings"
)

// Capability names one thing a page script is allowed to do through
// window.sip.
//
// The list is short on purpose. Each name is a different kind of harm, so a
// deployment can answer "what may this page do" without reading sip's client:
// watching the terminal is not typing into it, repainting it is not reading
// what a program printed, and none of those is ending the session.
type Capability string

const (
	// CapObserve lets the page watch the terminal: sip.on, sip.off,
	// sip.size and sip.status.
	//
	// It reads the grid's shape and the transport, never its contents,
	// with one exception worth knowing: the title event carries a string
	// the program chose. See docs/extending.md.
	CapObserve Capability = "observe"

	// CapInput lets the page type: sip.send and sip.input.paste.
	//
	// This is the strongest one. Anything that can call it can run a
	// command in the user's shell, so grant it only to a page whose every
	// script you ship yourself.
	CapInput Capability = "input"

	// CapAppearance lets the page repaint: sip.appearance.get, set and
	// reset. It reaches the palette, the font, both cursors, the
	// scrollback, the tab title and the tab icon.
	//
	// It changes nothing about the session, so it is the capability to
	// reach for when a page wants a theme switcher and nothing else.
	CapAppearance Capability = "appearance"

	// CapView lets the page move the viewport and clear the scrollback:
	// sip.view.
	//
	// Clearing throws away what the user has scrolled back to, so it is
	// destructive in a small way. It cannot read anything.
	CapView Capability = "view"

	// CapRead lets the page read what the program printed: sip.selection
	// and sip.search.
	//
	// Search is a read as much as the selection is. A page that can ask
	// "is this string on the screen" can learn the screen one answer at a
	// time, so the two travel together.
	CapRead Capability = "read"

	// CapClipboard lets the page copy the selection to the system
	// clipboard: sip.clipboard.copySelection.
	//
	// The text does not pass through the script, so this is not CapRead.
	// It is its own capability because it writes to something outside the
	// page that the user owns.
	CapClipboard Capability = "clipboard"

	// CapConnection lets the page restart the session:
	// sip.connection.reconnect.
	//
	// A reconnect ends the running session and starts a new one. The
	// program the user was running dies with it.
	CapConnection Capability = "connection"
)

// allCapabilities is every capability, in the order they are emitted to the
// page and printed in an error. A fixed order keeps the page's list, and the
// tests that pin it, stable.
var allCapabilities = []Capability{
	CapObserve, CapInput, CapAppearance, CapView, CapRead, CapClipboard, CapConnection,
}

// defaultCapabilities is what a deployment that configures nothing grants.
//
// It is exactly what window.sip answered before this file existed: on, off,
// send and size. Silence has to be safe, and "safe" here means "no deployment
// gains a single call by upgrading sip".
var defaultCapabilities = []Capability{CapObserve, CapInput}

// AllCapabilities returns every capability sip defines.
//
// Pass it to PageAPI.Grant for a page whose scripts you write and ship
// yourself. Do not pass it to reach one call: a grant is a promise about every
// script in the document, not about the line you are writing.
func AllCapabilities() []Capability {
	return append([]Capability(nil), allCapabilities...)
}

// DefaultCapabilities returns what a deployment that sets no PageAPI grants.
func DefaultCapabilities() []Capability {
	return append([]Capability(nil), defaultCapabilities...)
}

// PageAPI bounds what a deployment's own page script may do through
// window.sip.
//
// The zero value is the default set, so a deployment that says nothing gets
// what sip granted before this option existed. Grant adds to that set and
// Revoke takes away from it, which is why neither field needs a "none" value:
// Revoke everything and the page gets nothing.
//
//	cfg.PageAPI.Grant = []sip.Capability{sip.CapAppearance, sip.CapRead}
//	cfg.PageAPI.Revoke = []sip.Capability{sip.CapInput}
//
// Read docs/extending.md before granting anything. The short version: the
// capability list bounds sip's own API and nothing else. Every script in the
// document shares one JavaScript context, so a grant is made to the page, not
// to the script you had in mind. A deployment that needs a real boundary puts
// the terminal in an iframe.
type PageAPI struct {
	// Grant adds capabilities to the default set.
	Grant []Capability

	// Revoke removes capabilities. It is applied after Grant, so a
	// capability named in both is revoked.
	//
	// Revoke CapInput for a page that restyles the terminal and must not
	// type into it. That is the split worth making: a theme switcher has
	// no business holding a keystroke primitive.
	Revoke []Capability
}

// known reports whether c is a capability sip defines.
func known(c Capability) bool {
	for _, k := range allCapabilities {
		if k == c {
			return true
		}
	}
	return false
}

// capabilityNames lists every capability for an error message.
func capabilityNames() string {
	names := make([]string, 0, len(allCapabilities))
	for _, c := range allCapabilities {
		names = append(names, string(c))
	}
	return strings.Join(names, ", ")
}

// Validate reports the first capability name sip does not define.
//
// The server refuses to start on one. A misspelled capability is silent
// otherwise: Grant drops it and the page goes on being denied, which reads
// exactly like sip ignoring the option. Appearance.Validate refuses a bad
// colour for the same reason.
func (p PageAPI) Validate() error {
	for _, c := range p.Grant {
		if !known(c) {
			return fmt.Errorf("pageAPI: Grant has %q, which is not a capability. Use one of %s", string(c), capabilityNames())
		}
	}
	for _, c := range p.Revoke {
		if !known(c) {
			return fmt.Errorf("pageAPI: Revoke has %q, which is not a capability. Use one of %s", string(c), capabilityNames())
		}
	}
	return nil
}

// resolve returns the granted capabilities, in allCapabilities order.
func (p PageAPI) resolve() []Capability {
	set := map[Capability]bool{}
	for _, c := range defaultCapabilities {
		set[c] = true
	}
	for _, c := range p.Grant {
		if known(c) {
			set[c] = true
		}
	}
	// After Grant, so a capability in both lists is revoked. One rule, and
	// it is the safe one.
	for _, c := range p.Revoke {
		delete(set, c)
	}
	out := make([]Capability, 0, len(set))
	for _, c := range allCapabilities {
		if set[c] {
			out = append(out, c)
		}
	}
	return out
}

// isDefault reports whether the resolved set is the default one.
func (p PageAPI) isDefault() bool {
	got := p.resolve()
	if len(got) != len(defaultCapabilities) {
		return false
	}
	for i, c := range got {
		if c != defaultCapabilities[i] {
			return false
		}
	}
	return true
}

// clientOptions returns the capability names for the page, or nil when the
// deployment has changed nothing.
//
// nil is what keeps the default page byte for byte what it was: renderIndex
// emits no config blob at all, and the client falls back to the same default
// list. The two defaults are pinned against each other by
// TestDefaultCapabilitiesMatchTheClient and by the browser suite, because a
// default that drifts between Go and JavaScript is a grant nobody wrote.
func (p PageAPI) clientOptions() []string {
	if p.isDefault() {
		return nil
	}
	got := p.resolve()
	out := make([]string, 0, len(got))
	for _, c := range got {
		out = append(out, string(c))
	}
	return out
}
