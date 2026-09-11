package sip

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestPointerShapeNamesAreTheSpecifiedThirty pins the list against the
// specification rather than against itself. A name added here by mistake is a
// name a program can put into a CSS property.
func TestPointerShapeNamesAreTheSpecifiedThirty(t *testing.T) {
	if len(pointerShapes) != 30 {
		t.Errorf("ASSERTION: the protocol names 30 shapes, this list has %d", len(pointerShapes))
	}
	ok := regexp.MustCompile(`^[a-z0-9_-]+$`)
	seen := map[string]bool{}
	for _, s := range pointerShapes {
		if seen[s] {
			t.Errorf("ASSERTION: %q is in the shape list twice", s)
		}
		seen[s] = true
		// The specification: "Valid names must consist of only the
		// characters from the set a-z0-9_-".
		if !ok.MatchString(s) {
			t.Errorf("ASSERTION: %q is not a valid shape name, use only a-z, 0-9, _ and -", s)
		}
	}
	for _, want := range []string{"alias", "nwse-resize", "vertical-text", "zoom-out", "default", "text"} {
		if !seen[want] {
			t.Errorf("ASSERTION: the required shape %q is missing from the list", want)
		}
	}
	// Not in the protocol, however reasonable a deployment cursor it is.
	for _, no := range []string{"none", "auto", "context-menu", "all-scroll"} {
		if seen[no] {
			t.Errorf("ASSERTION: %q is not one of the protocol's shapes, a program must not be able to ask for it", no)
		}
	}
}

// clientShapeNames reads the list static/terminal.js validates against.
func clientShapeNames(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("static/terminal.js")
	if err != nil {
		t.Fatalf("read static/terminal.js: %v", err)
	}
	const open = "const POINTER_SHAPES = new Set(["
	i := strings.Index(string(src), open)
	if i < 0 {
		t.Fatal("ASSERTION: static/terminal.js has no POINTER_SHAPES set, so nothing validates a name from the PTY")
	}
	rest := string(src)[i+len(open):]
	j := strings.Index(rest, "]")
	if j < 0 {
		t.Fatal("ASSERTION: the POINTER_SHAPES set in static/terminal.js is not closed")
	}
	return regexp.MustCompile(`'([^']*)'`).FindAllString(rest[:j], -1)
}

// TestClientAndGoAgreeOnTheShapes is the guard on two hand-written lists.
//
// The browser does the parsing and owns the only allowlist that stops a name
// from the PTY reaching a CSS property, so its list is the one that has to be
// right. Go carries the same names because the same vocabulary is behind
// Appearance.MouseCursor. This is what keeps them from drifting.
func TestClientAndGoAgreeOnTheShapes(t *testing.T) {
	got := clientShapeNames(t)
	if len(got) != len(pointerShapes) {
		t.Fatalf("ASSERTION: static/terminal.js validates against %d shapes, pointershapes.go lists %d",
			len(got), len(pointerShapes))
	}
	for i, want := range pointerShapes {
		if got[i] != "'"+want+"'" {
			t.Errorf("ASSERTION: shape %d is %s in static/terminal.js and %q in pointershapes.go", i, got[i], want)
		}
	}
}

// TestMouseCursorAllowsEveryProtocolShape checks the reconciliation: the
// deployment's allowlist is a superset of the protocol's, so a deployment can
// name any shape a program can.
func TestMouseCursorAllowsEveryProtocolShape(t *testing.T) {
	for _, s := range pointerShapes {
		if err := (Appearance{MouseCursor: s}).Validate(); err != nil {
			t.Errorf("ASSERTION: Appearance.MouseCursor refuses the protocol shape %q: %v", s, err)
		}
	}
	// The four the protocol does not offer a program are still a
	// deployment's to choose.
	for _, s := range extraMouseCursors {
		if err := (Appearance{MouseCursor: s}).Validate(); err != nil {
			t.Errorf("ASSERTION: Appearance.MouseCursor refuses %q: %v", s, err)
		}
	}
	// And nothing else is.
	for _, s := range []string{"url(https://example.com/x.png)", "pointer;", "", " text", "POINTER"} {
		if s == "" {
			continue
		}
		if err := (Appearance{MouseCursor: s}).Validate(); err == nil {
			t.Errorf("ASSERTION: Appearance.MouseCursor accepted %q", s)
		}
	}
}
