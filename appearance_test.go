package sip

import (
	"encoding/json"
	"strings"
	"testing"
)

// defaultOptionsPayload is the handshake blob a deployment that configures no
// appearance has always received. Pinned as a literal: the whole promise of
// the zero value is that such a deployment sees no change at all, and a
// pointer field that marshalled as "appearance":null would break it silently.
const defaultOptionsPayload = `{"readOnly":false}`

// TestAppearanceZeroShipsNothing checks the zero value reaches neither route
// into the page. A program that sets nothing must render exactly as it did
// before Appearance existed.
func TestAppearanceZeroShipsNothing(t *testing.T) {
	var a Appearance
	if !a.IsZero() {
		t.Fatal("zero Appearance does not report itself zero")
	}
	if got := a.clientOptions(); got != nil {
		t.Fatalf("zero Appearance built a client blob: %+v", got)
	}

	s := &httpServer{config: Config{}}
	msg := s.optionsMessage()
	if msg[0] != MsgOptions {
		t.Fatalf("options frame starts with %q, want %q", msg[0], MsgOptions)
	}
	if got := string(msg[1:]); got != defaultOptionsPayload {
		t.Fatalf("options payload = %s, want %s", got, defaultOptionsPayload)
	}

	const page = "<head>{{FONT_FACE_EXTRA}}</head>"
	if got := string(s.renderIndex([]byte(page))); strings.Contains(got, "appearance") {
		t.Fatalf("zero Appearance injected a blob: %s", got)
	}
}

// TestOptionsMessageCarriesAppearance checks the configured appearance travels
// on the handshake frame both transports send.
func TestOptionsMessageCarriesAppearance(t *testing.T) {
	s := &httpServer{config: Config{
		ReadOnly:   true,
		Appearance: Appearance{Theme: Theme{Background: "#282828"}, MouseCursor: "pointer"},
	}}
	var got OptionsMessage
	if err := json.Unmarshal(s.optionsMessage()[1:], &got); err != nil {
		t.Fatalf("options payload does not parse: %v", err)
	}
	if !got.ReadOnly {
		t.Fatal("readOnly was lost")
	}
	if got.Appearance == nil || got.Appearance.Theme == nil {
		t.Fatalf("appearance was lost: %+v", got.Appearance)
	}
	if got.Appearance.Theme.Background != "#282828" {
		t.Fatalf("background = %q, want #282828", got.Appearance.Theme.Background)
	}
	if got.Appearance.MouseCursor != "pointer" {
		t.Fatalf("mouseCursor = %q, want pointer", got.Appearance.MouseCursor)
	}
}

// TestRenderIndexAppearance checks the same blob is seeded into the page, under
// the key static/terminal.js reads. The field names are the contract, so a tag
// rename is a client break, not an implementation detail.
func TestRenderIndexAppearance(t *testing.T) {
	s := &httpServer{config: Config{Appearance: Appearance{
		Theme:       Theme{Red: "#cc241d"},
		MouseCursor: "crosshair",
		CursorStyle: "bar",
		Scrollback:  9000,
		FontSize:    17,
		Title:       "Gruvbox shell",
	}}}
	got := string(s.renderIndex([]byte("<head>{{FONT_FACE_EXTRA}}</head>")))
	for _, want := range []string{
		`"appearance":`, `"red":"#cc241d"`, `"mouseCursor":"crosshair"`,
		`"cursorStyle":"bar"`, `"scrollback":9000`, `"fontSize":17`,
		`"title":"Gruvbox shell"`,
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("index is missing %s: %s", want, got)
		}
	}
}

// TestThemePartialPalette checks three colours change three colours. The zero
// value of a Color means "keep the default", so the unset thirteen must not
// reach the browser at all: an empty string handed to xterm is a colour it
// cannot parse, and thirteen of them is a black terminal.
func TestThemePartialPalette(t *testing.T) {
	a := Appearance{Theme: Theme{Red: "#ff0000", Blue: "#0000ff", Background: "#101010"}}
	blob, err := json.Marshal(a.clientOptions().Theme)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]string
	if err := json.Unmarshal(blob, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 3 {
		t.Fatalf("a three-colour theme marshalled %d fields: %s", len(fields), blob)
	}
	for k, v := range fields {
		if v == "" {
			t.Fatalf("field %q shipped as an empty colour", k)
		}
	}
}

// TestThemeANSIRoundTrip checks the indexed form and the named form agree
// about which colour is which. Index 5 is magenta and index 13 is its bright
// twin; hand-copying a palette is exactly how those two get swapped.
func TestThemeANSIRoundTrip(t *testing.T) {
	var p ANSIPalette
	for i := range p {
		p[i] = Color("#0000" + string("0123456789abcdef"[i]) + "0")
	}
	th := Theme{}.WithANSI(p)
	if th.Magenta != p[5] {
		t.Fatalf("index 5 landed in %q, want magenta %q", th.Magenta, p[5])
	}
	if th.BrightMagenta != p[13] {
		t.Fatalf("index 13 landed in %q, want brightMagenta %q", th.BrightMagenta, p[13])
	}
	if got := th.ANSI(); got != p {
		t.Fatalf("round trip = %v, want %v", got, p)
	}

	// An empty slot leaves the named field alone, so a caller can set the
	// sixteen from a file that only names some of them.
	kept := Theme{Green: "#00ff00"}.WithANSI(ANSIPalette{})
	if kept.Green != "#00ff00" {
		t.Fatalf("an empty palette cleared green: %q", kept.Green)
	}
}

// TestAppearanceValidate checks a malformed value is reported to the caller at
// configuration time. Every one of these fails silently in a browser, so
// passing it on would look like sip ignoring the option.
func TestAppearanceValidate(t *testing.T) {
	tests := []struct {
		name string
		a    Appearance
		want string
	}{
		{"named colour", Appearance{Theme: Theme{Red: "rebeccapurple"}}, "theme.red"},
		{"short hex", Appearance{Theme: Theme{Blue: "#12"}}, "theme.blue"},
		{"no hash", Appearance{Theme: Theme{Green: "00ff00"}}, "theme.green"},
		{"bad digit", Appearance{Theme: Theme{Cyan: "#00gg00"}}, "theme.cyan"},
		{"page background", Appearance{PageBackground: "papayawhip"}, "pageBackground"},
		{"mouse cursor", Appearance{MouseCursor: "finger"}, "mouseCursor"},
		{"cursor style", Appearance{CursorStyle: "beam"}, "cursorStyle"},
		{"inactive style", Appearance{CursorInactiveStyle: "hollow"}, "cursorInactiveStyle"},
		{"negative scrollback", Appearance{Scrollback: -1}, "scrollback"},
		{"font size", Appearance{FontSize: 5000}, "fontSize"},
		{"favicon scheme", Appearance{Favicon: "javascript:alert(1)"}, "favicon"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.a.Validate()
			if err == nil {
				t.Fatal("a bad value passed validation")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error %q does not name %s", err, tt.want)
			}
		})
	}
}

// TestAppearanceValidateAccepts checks the forms a deployment actually writes.
func TestAppearanceValidateAccepts(t *testing.T) {
	good := []Appearance{
		{},
		{Theme: Theme{Red: "#f00", Green: "#00FF00", Blue: "#0000ffcc", Cyan: "#0ffc"}},
		{MouseCursor: "crosshair", CursorStyle: "bar", CursorInactiveStyle: "none"},
		{Scrollback: 100000, FontSize: 18, Title: "My shell"},
		{Favicon: "/static/icon.png"},
		{Favicon: "https://example.com/icon.png"},
		{Favicon: "data:image/svg+xml;base64,AAAA"},
	}
	for _, a := range good {
		if err := a.Validate(); err != nil {
			t.Fatalf("%+v was refused: %v", a, err)
		}
	}
}

// TestServerRefusesBadAppearance checks the server does not start on one, so a
// typo is a failure the deployment sees rather than a page that looks normal.
func TestServerRefusesBadAppearance(t *testing.T) {
	s := &httpServer{config: Config{
		Host:       "localhost",
		Appearance: Appearance{MouseCursor: "finger"},
	}}
	err := s.validateConfig()
	if err == nil {
		t.Fatal("validateConfig accepted an unknown cursor keyword")
	}
	if !strings.Contains(err.Error(), "mouseCursor") {
		t.Fatalf("error %q does not name the field", err)
	}
}

// TestChromeFollowsTheTheme checks the page's own colours are derived from the
// palette, and that a partial palette derives only what it names. A property
// nobody set is not a missing colour: static/terminal.css carries the built-in
// value as the var() fallback.
func TestChromeFollowsTheTheme(t *testing.T) {
	full := Appearance{Theme: Theme{
		Background: "#282828", Foreground: "#ebdbb2", Cursor: "#fe8019",
		Black: "#3c3836", BrightBlack: "#928374", BrightWhite: "#fbf1c7",
		Blue: "#458588", BrightBlue: "#83a598",
		Green: "#98971a", Yellow: "#d79921", Red: "#cc241d",
	}}.chrome()
	want := map[string]string{
		"--sip-bg": "#282828",
		// webterm paints its own ground behind the grid. Missing this one
		// leaves a strip of the built-in colour under the terminal.
		"--webterm-background": "#282828",
		"--webterm-scrollbar":  "#928374",
		"--sip-bg-rgb":         "40, 40, 40",
		"--sip-fg":             "#ebdbb2",
		"--sip-border":         "#3c3836",
		"--sip-border-strong":  "#928374",
		"--sip-muted":          "#fbf1c7",
		"--sip-accent":         "#458588",
		"--sip-accent-strong":  "#83a598",
		"--sip-ok":             "#98971a",
		"--sip-warn":           "#d79921",
		"--sip-error":          "#cc241d",
		"--sip-cursor":         "#fe8019",
	}
	for prop, v := range want {
		if full[prop] != v {
			t.Fatalf("%s = %q, want %q", prop, full[prop], v)
		}
	}
	// The one surface no theme names is mixed from the two every theme has.
	if full["--sip-surface"] == "" || full["--sip-surface"] == "#282828" {
		t.Fatalf("--sip-surface = %q, want a mix of the ground and the text", full["--sip-surface"])
	}

	// A palette that names one colour derives one thing.
	partial := Appearance{Theme: Theme{Red: "#cc241d"}}.chrome()
	if partial["--sip-error"] != "#cc241d" {
		t.Fatalf("--sip-error = %q, want #cc241d", partial["--sip-error"])
	}
	if _, ok := partial["--sip-bg"]; ok {
		t.Fatalf("a theme with no background still derived one: %v", partial)
	}

	// PageBackground overrides the theme's, for a ground that differs.
	split := Appearance{Theme: Theme{Background: "#282828"}, PageBackground: "#000000"}.chrome()
	if split["--sip-bg"] != "#000000" {
		t.Fatalf("--sip-bg = %q, want the explicit page background", split["--sip-bg"])
	}
}

// TestColorMix checks the derived surface blends the two ends rather than
// picking one of them.
func TestColorMix(t *testing.T) {
	if got := Color("#000000").mix("#ffffff", 0.5); got != "#808080" {
		t.Fatalf("half way between black and white = %q, want #808080", got)
	}
	if got := Color("#fff").mix("#000", 0); got != "#ffffff" {
		t.Fatalf("no mix = %q, want #ffffff", got)
	}
	if got := Color("bogus").mix("#000", 0.5); got != "" {
		t.Fatalf("mixing an invalid colour = %q, want empty", got)
	}
}
