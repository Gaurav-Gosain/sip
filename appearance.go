package sip

import (
	"fmt"
	"strconv"
	"strings"
)

// Color is a colour the browser understands, written as CSS hex: "#rgb",
// "#rgba", "#rrggbb" or "#rrggbbaa".
//
// The empty string means "leave the default alone". That is what makes a
// partial palette work: a deployment that sets three colours gets three
// colours changed and keeps the other thirteen, rather than thirteen black
// cells from a struct nobody finished filling in.
//
// Only hex is accepted. A browser drops a colour it cannot parse and paints
// the default instead, with nothing in the console, so "rebeccapurple" or a
// stray "0x" would reach the page and look like the option was ignored.
// Appearance.Validate refuses it at the server instead, where the deployment
// can see it.
type Color string

// hexDigits reports whether s is n hex digits.
func hexDigits(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := range len(s) {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		case c >= 'A' && c <= 'F':
		default:
			return false
		}
	}
	return true
}

// IsZero reports whether the colour is unset.
func (c Color) IsZero() bool { return c == "" }

// valid reports whether the colour is one of the four hex forms.
func (c Color) valid() bool {
	s := string(c)
	if !strings.HasPrefix(s, "#") {
		return false
	}
	d := s[1:]
	return hexDigits(d, 3) || hexDigits(d, 4) || hexDigits(d, 6) || hexDigits(d, 8)
}

// rgb returns the colour's red, green and blue channels as 0-255. Alpha is
// dropped: the chrome colours derived from a palette are painted on opaque
// surfaces, so a translucent source would only make them muddy.
func (c Color) rgb() (r, g, b int, ok bool) {
	if !c.valid() {
		return 0, 0, 0, false
	}
	d := string(c)[1:]
	if len(d) == 3 || len(d) == 4 {
		// #rgb is #rrggbb with every digit doubled.
		d = string([]byte{d[0], d[0], d[1], d[1], d[2], d[2]})
	}
	n, err := strconv.ParseUint(d[:6], 16, 32)
	if err != nil {
		return 0, 0, 0, false
	}
	return int(n>>16) & 0xff, int(n>>8) & 0xff, int(n) & 0xff, true
}

// mix blends two colours, taking frac of b and the rest of c. It is how the
// panel and input surface is derived from a palette that does not name one:
// every terminal theme has a background and a foreground, and almost none has
// a "slightly lighter than the background" entry.
func (c Color) mix(b Color, frac float64) Color {
	r1, g1, b1, ok1 := c.rgb()
	r2, g2, b2, ok2 := b.rgb()
	if !ok1 || !ok2 {
		return ""
	}
	blend := func(x, y int) int {
		v := int(float64(x)*(1-frac) + float64(y)*frac + 0.5)
		return min(max(v, 0), 255)
	}
	return Color(fmt.Sprintf("#%02x%02x%02x", blend(r1, r2), blend(g1, g2), blend(b1, b2)))
}

// ANSIPalette is the sixteen ANSI colours in index order, 0 to 15: the eight
// normal colours then the eight bright ones.
//
// It exists because that is the shape a palette arrives in. A theme read out
// of kitty, ghostty, alacritty or wezterm is an indexed list, and so is the
// palette a Go program already holds for its own rendering, so the alternative
// is sixteen hand-written assignments per theme and a silent swap the first
// time colour 5 lands in BrightMagenta.
type ANSIPalette [16]Color

// Theme is the terminal's palette: the sixteen ANSI colours plus the
// foreground, background, cursor and selection colours that a terminal theme
// carries alongside them.
//
// The field names and their JSON tags are xterm.js's own, because the struct
// is handed to the browser as-is and given straight to xterm's theme option.
// Keeping the names is what makes an imported theme readable next to the file
// it came from.
//
// Every field is optional. An unset colour keeps sip's default, so this is a
// patch over the built-in palette rather than a replacement for it. The zero
// Theme changes nothing.
type Theme struct {
	// Foreground and Background are the default text and ground colours,
	// used for every cell a program does not colour itself.
	Foreground Color `json:"foreground,omitempty"`
	Background Color `json:"background,omitempty"`

	// Cursor is the text cursor's colour and CursorAccent is the colour of
	// the character underneath it, which is why a block cursor needs both:
	// with only the first set, the glyph under the block keeps the
	// foreground colour and disappears into it.
	Cursor       Color `json:"cursor,omitempty"`
	CursorAccent Color `json:"cursorAccent,omitempty"`

	// SelectionBackground and SelectionForeground paint selected text.
	// SelectionInactiveBackground paints it while the terminal does not
	// hold focus, so a user can see what they selected before clicking
	// away.
	SelectionBackground         Color `json:"selectionBackground,omitempty"`
	SelectionForeground         Color `json:"selectionForeground,omitempty"`
	SelectionInactiveBackground Color `json:"selectionInactiveBackground,omitempty"`

	// The eight normal ANSI colours, indices 0 to 7.
	Black   Color `json:"black,omitempty"`
	Red     Color `json:"red,omitempty"`
	Green   Color `json:"green,omitempty"`
	Yellow  Color `json:"yellow,omitempty"`
	Blue    Color `json:"blue,omitempty"`
	Magenta Color `json:"magenta,omitempty"`
	Cyan    Color `json:"cyan,omitempty"`
	White   Color `json:"white,omitempty"`

	// The eight bright ANSI colours, indices 8 to 15. A palette that calls
	// index 5 "purple" rather than "magenta" means this one.
	BrightBlack   Color `json:"brightBlack,omitempty"`
	BrightRed     Color `json:"brightRed,omitempty"`
	BrightGreen   Color `json:"brightGreen,omitempty"`
	BrightYellow  Color `json:"brightYellow,omitempty"`
	BrightBlue    Color `json:"brightBlue,omitempty"`
	BrightMagenta Color `json:"brightMagenta,omitempty"`
	BrightCyan    Color `json:"brightCyan,omitempty"`
	BrightWhite   Color `json:"brightWhite,omitempty"`
}

// ansiFields returns pointers to the sixteen ANSI slots in index order, so
// WithANSI and ANSI cannot disagree about which field is index 5.
func (t *Theme) ansiFields() [16]*Color {
	return [16]*Color{
		&t.Black, &t.Red, &t.Green, &t.Yellow,
		&t.Blue, &t.Magenta, &t.Cyan, &t.White,
		&t.BrightBlack, &t.BrightRed, &t.BrightGreen, &t.BrightYellow,
		&t.BrightBlue, &t.BrightMagenta, &t.BrightCyan, &t.BrightWhite,
	}
}

// WithANSI returns a copy of the theme with the sixteen ANSI colours taken
// from an indexed palette. An empty entry leaves that slot as it was, so a
// caller can fill the sixteen from a file and the rest by name:
//
//	th := sip.Theme{Background: "#282828", Foreground: "#ebdbb2"}.WithANSI(pal)
func (t Theme) WithANSI(p ANSIPalette) Theme {
	f := t.ansiFields()
	for i, c := range p {
		if c != "" {
			*f[i] = c
		}
	}
	return t
}

// ANSI returns the sixteen ANSI colours in index order. An unset slot comes
// back empty.
func (t Theme) ANSI() ANSIPalette {
	var p ANSIPalette
	f := t.ansiFields()
	for i := range p {
		p[i] = *f[i]
	}
	return p
}

// colors returns every field paired with the name used in an error message.
func (t *Theme) colors() []struct {
	name string
	c    *Color
} {
	named := []struct {
		name string
		c    *Color
	}{
		{"foreground", &t.Foreground},
		{"background", &t.Background},
		{"cursor", &t.Cursor},
		{"cursorAccent", &t.CursorAccent},
		{"selectionBackground", &t.SelectionBackground},
		{"selectionForeground", &t.SelectionForeground},
		{"selectionInactiveBackground", &t.SelectionInactiveBackground},
	}
	ansiNames := [16]string{
		"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
		"brightBlack", "brightRed", "brightGreen", "brightYellow",
		"brightBlue", "brightMagenta", "brightCyan", "brightWhite",
	}
	f := t.ansiFields()
	for i, n := range ansiNames {
		named = append(named, struct {
			name string
			c    *Color
		}{n, f[i]})
	}
	return named
}

// IsZero reports whether no colour is set.
func (t Theme) IsZero() bool {
	for _, f := range t.colors() {
		if *f.c != "" {
			return false
		}
	}
	return true
}

// Validate reports the first colour that is not hex. It is called for you when
// the server starts; call it yourself to check a theme as it is read from a
// file, where the offending line is still in hand.
func (t Theme) Validate() error {
	for _, f := range t.colors() {
		if *f.c != "" && !f.c.valid() {
			return fmt.Errorf("theme.%s %q is not a hex colour, write it as #rgb, #rgba, #rrggbb or #rrggbbaa", f.name, string(*f.c))
		}
	}
	return nil
}

// mouseCursors are the CSS cursor keywords Appearance.MouseCursor accepts.
// An allowlist rather than a free string, for the reason Color is hex-only: a
// browser ignores a cursor value it does not know and keeps the one it had, so
// a typo would read as the option doing nothing.
var mouseCursors = map[string]bool{
	"default": true, "text": true, "pointer": true, "crosshair": true,
	"cell": true, "move": true, "none": true, "auto": true,
	"grab": true, "grabbing": true, "copy": true, "alias": true,
	"context-menu": true, "help": true, "progress": true, "wait": true,
	"not-allowed": true, "no-drop": true, "all-scroll": true,
	"vertical-text": true, "zoom-in": true, "zoom-out": true,
}

var cursorStyles = map[string]bool{"block": true, "bar": true, "underline": true}

var cursorInactiveStyles = map[string]bool{
	"outline": true, "block": true, "bar": true, "underline": true, "none": true,
}

// maxFontSize bounds Appearance.FontSize. A terminal above this is one cell
// wide, which is a typo rather than a choice.
const maxFontSize = 200

// Appearance is how the page looks: the terminal's palette, its two cursors,
// and the small amount of chrome around it.
//
// Everything here was a constant in static/terminal.js until a deployment
// asked for its own colours and its own mouse cursor and there was no answer
// but a fork. The zero value is exactly what sip rendered before this existed,
// field by field, so a program that sets nothing sees no change at all.
//
// It travels to the browser twice, from one producer. The page is built before
// the session handshake, so the values are seeded into window.__sipConfig at
// index render, which is also what lets the font be loaded before the terminal
// measures its cell box; the same blob is then sent over MsgOptions on connect,
// which is what reaches a page sip did not render and what re-applies on a
// reconnect. A missing or partial blob leaves the built-in defaults standing.
type Appearance struct {
	// Theme is the terminal's palette. Unset colours keep sip's built-in
	// Catppuccin Mocha, so a theme is a patch, not a replacement.
	//
	// The chrome follows it: the settings panel, the status indicator, the
	// scrollbar and the touch key bar are all painted from the palette
	// rather than from a second set of colours, because a Gruvbox terminal
	// in a Catppuccin panel is what a second set of colours produces the
	// first time one of them is updated alone.
	Theme Theme

	// MouseCursor is the CSS cursor over the terminal. Empty keeps "text",
	// which is what a terminal shows because its main gesture is selecting
	// text.
	//
	// It also replaces the arrow xterm switches to while a program is
	// reading the mouse: a deployment that names a cursor means it in both
	// states, and a cursor that changes under a program the user is
	// clicking through reads as a glitch.
	//
	// Accepts a CSS cursor keyword: "default", "pointer", "crosshair",
	// "cell", "none" and the rest of the standard set.
	MouseCursor string

	// CursorStyle is the text cursor's shape: "block", "bar" or
	// "underline". Empty keeps "block". A program that sets its own shape
	// through DECSCUSR still wins, as it does in any terminal.
	CursorStyle string

	// CursorInactiveStyle is the text cursor's shape while the terminal
	// does not hold focus: "outline", "block", "bar", "underline" or
	// "none". Empty keeps "outline", which is the hollow box that tells a
	// user the keyboard is somewhere else.
	CursorInactiveStyle string

	// CursorBlink starts the text cursor blinking. Off by default because
	// a blinking cursor is a permanent animation, so an idle terminal
	// repaints forever and a laptop notices.
	//
	// This sets the default, not the answer: a user who has picked one in
	// the settings panel keeps their choice.
	CursorBlink bool

	// Scrollback is how many lines above the screen the browser keeps.
	// 0 keeps the default, 5000. Each line costs memory in the browser,
	// not on the server.
	Scrollback int

	// FontSize is the terminal's font size in CSS pixels. 0 keeps the
	// default, 14. Like CursorBlink this is the default and not the
	// answer: the settings panel's slider still wins, and a narrow touch
	// screen still starts a point smaller until the user picks a size.
	FontSize int

	// Title is the page title before the program sets one, and what the
	// tab falls back to when a program clears it. Empty keeps "Sip".
	//
	// A program's own title sequence still wins while it is running: this
	// is what the tab says during the second before the session connects,
	// which for a deployment with several sip tabs open is the whole
	// difference between them.
	Title string

	// Favicon is the tab icon, as a relative path, an http(s) URL or a
	// data: URI. Empty ships no icon, which is what sip does today.
	//
	// A data: URI is the one that needs no second route into the page, so
	// a deployment can carry its icon in the same Go file as the palette.
	Favicon string

	// PageBackground is the ground behind the terminal: the letterbox left
	// by a grid that does not divide evenly into the window, and the page
	// before the terminal is drawn.
	//
	// Empty follows Theme.Background, which is what a deployment setting a
	// light theme wants and would otherwise have to say twice. Set it only
	// to make the two differ.
	PageBackground Color
}

// IsZero reports whether nothing about the appearance is configured.
func (a Appearance) IsZero() bool {
	return a.Theme.IsZero() &&
		a.MouseCursor == "" && a.CursorStyle == "" && a.CursorInactiveStyle == "" &&
		!a.CursorBlink && a.Scrollback == 0 && a.FontSize == 0 &&
		a.Title == "" && a.Favicon == "" && a.PageBackground == ""
}

// Validate reports the first setting the browser would not understand.
//
// The server refuses to start on one rather than passing it on, because every
// one of these fails silently in a browser: an unparseable colour, an unknown
// cursor keyword and a bad favicon URL all leave the page looking exactly as
// it did before the option was added, which is indistinguishable from sip
// having ignored it.
func (a Appearance) Validate() error {
	if err := a.Theme.Validate(); err != nil {
		return fmt.Errorf("appearance: %w", err)
	}
	if a.PageBackground != "" && !a.PageBackground.valid() {
		return fmt.Errorf("appearance: pageBackground %q is not a hex colour, write it as #rgb, #rgba, #rrggbb or #rrggbbaa", string(a.PageBackground))
	}
	if a.MouseCursor != "" && !mouseCursors[a.MouseCursor] {
		return fmt.Errorf("appearance: mouseCursor %q is not a CSS cursor keyword, use one of default, text, pointer, crosshair, cell, move or none", a.MouseCursor)
	}
	if a.CursorStyle != "" && !cursorStyles[a.CursorStyle] {
		return fmt.Errorf("appearance: cursorStyle %q is unknown, use block, bar or underline", a.CursorStyle)
	}
	if a.CursorInactiveStyle != "" && !cursorInactiveStyles[a.CursorInactiveStyle] {
		return fmt.Errorf("appearance: cursorInactiveStyle %q is unknown, use outline, block, bar, underline or none", a.CursorInactiveStyle)
	}
	if a.Scrollback < 0 {
		return fmt.Errorf("appearance: scrollback %d is negative, use 0 for the default", a.Scrollback)
	}
	if a.FontSize < 0 || a.FontSize > maxFontSize {
		return fmt.Errorf("appearance: fontSize %d is out of range, use 0 for the default or a size up to %d", a.FontSize, maxFontSize)
	}
	if err := validateFaviconURL(a.Favicon); err != nil {
		return fmt.Errorf("appearance: %w", err)
	}
	return nil
}

// validateFaviconURL refuses a scheme the page must not load. The value is
// assigned to a link element's href from script, never written into HTML, so
// the risk is not markup: it is a javascript: URL, which some browsers still
// run from a link the page activates.
func validateFaviconURL(s string) error {
	if s == "" {
		return nil
	}
	scheme, _, ok := strings.Cut(s, ":")
	if !ok || strings.ContainsAny(scheme, "/?#") {
		return nil // a relative path, which is fine
	}
	switch strings.ToLower(scheme) {
	case "http", "https", "data":
		return nil
	default:
		return fmt.Errorf("favicon %q uses the %q scheme, use a relative path or an http, https or data URL", s, scheme)
	}
}

// clientAppearance is the browser-side appearance object. It carries only what
// the deployment set, so a program that configures nothing ships nothing and
// the client keeps every built-in default.
//
// The JSON names are the contract static/terminal.js reads. Both routes into
// the page are built from this one function, so an option cannot reach the
// index and miss the socket, or reach WebSocket and miss WebTransport.
type clientAppearance struct {
	Theme               *Theme            `json:"theme,omitempty"`
	MouseCursor         string            `json:"mouseCursor,omitempty"`
	CursorStyle         string            `json:"cursorStyle,omitempty"`
	CursorInactiveStyle string            `json:"cursorInactiveStyle,omitempty"`
	CursorBlink         bool              `json:"cursorBlink,omitempty"`
	Scrollback          int               `json:"scrollback,omitempty"`
	FontSize            int               `json:"fontSize,omitempty"`
	Title               string            `json:"title,omitempty"`
	Favicon             string            `json:"favicon,omitempty"`
	Chrome              map[string]string `json:"chrome,omitempty"`
}

// clientOptions returns the browser-side object, or nil when nothing is
// configured. nil is what keeps the wire bytes and the index page identical to
// what a deployment that predates this option already receives.
func (a Appearance) clientOptions() *clientAppearance {
	if a.IsZero() {
		return nil
	}
	c := &clientAppearance{
		MouseCursor:         a.MouseCursor,
		CursorStyle:         a.CursorStyle,
		CursorInactiveStyle: a.CursorInactiveStyle,
		CursorBlink:         a.CursorBlink,
		Scrollback:          a.Scrollback,
		FontSize:            a.FontSize,
		Title:               a.Title,
		Favicon:             a.Favicon,
		Chrome:              a.chrome(),
	}
	if !a.Theme.IsZero() {
		t := a.Theme
		c.Theme = &t
	}
	return c
}

// chrome derives the page's own colours from the palette: the settings panel,
// the status indicator, the scrollbar, the bell flash and the touch key bar.
//
// Each custom property is emitted only when the colour it comes from is set,
// so a palette with three colours repaints the three things those colours
// name and leaves the rest of the chrome alone. static/terminal.css declares
// the same names with today's values as their defaults, which is what keeps an
// unconfigured page pixel-identical.
func (a Appearance) chrome() map[string]string {
	t := a.Theme
	bg := a.PageBackground
	if bg == "" {
		bg = t.Background
	}
	out := map[string]string{}
	set := func(prop string, c Color) {
		if c != "" {
			out[prop] = string(c)
		}
	}
	set("--sip-bg", bg)
	// webterm's own two hooks, in its namespace rather than sip's. The
	// container paints its own ground behind the grid, so a palette that
	// stops at sip's properties leaves a strip of the built-in colour
	// under the terminal wherever the rows do not divide the window
	// evenly. That strip is how this was found.
	set("--webterm-background", bg)
	set("--webterm-scrollbar", t.BrightBlack)
	set("--sip-fg", t.Foreground)
	set("--sip-border", t.Black)
	set("--sip-border-strong", t.BrightBlack)
	set("--sip-muted", t.BrightWhite)
	set("--sip-accent", t.Blue)
	set("--sip-accent-strong", t.BrightBlue)
	set("--sip-ok", t.Green)
	set("--sip-warn", t.Yellow)
	set("--sip-error", t.Red)
	set("--sip-cursor", t.Cursor)
	// The one surface no terminal theme names: the panel's inputs and
	// buttons sit slightly off the ground, so it is mixed from the two
	// colours every theme does carry.
	if s := bg.mix(t.Foreground, 0.12); s != "" {
		out["--sip-surface"] = string(s)
	}
	// The settings panel, the status pill and the touch key bar all sit
	// over the terminal on a translucent ground. Each keeps its own alpha,
	// so what travels is the colour's three channels and the stylesheet
	// supplies the transparency: collapsing the three to one opaque colour
	// would have quietly changed how much terminal shows through.
	if r, g, b, ok := bg.rgb(); ok {
		out["--sip-bg-rgb"] = fmt.Sprintf("%d, %d, %d", r, g, b)
		// The key bar sits a little darker than the page, the way it
		// already did against the built-in palette.
		if dr, dg, db, ok := bg.mix("#000000", 0.10).rgb(); ok {
			out["--sip-bar-bg-rgb"] = fmt.Sprintf("%d, %d, %d", dr, dg, db)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
