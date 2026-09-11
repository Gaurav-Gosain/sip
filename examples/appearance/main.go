// Example: serve a shell with the deployment's own colours and cursor.
//
// It also backs clienttests/appearance.spec.mjs, which drives this server in a
// real browser and reads the colours back out of the page, so the palette here
// is deliberately nothing like sip's default: a test that cannot tell the two
// apart proves nothing.
//
//	go run ./examples/appearance -p 7700
//
// Then open http://localhost:7700.
package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/Gaurav-Gosain/sip"
)

func main() {
	port := flag.String("p", "7700", "port to listen on")
	shell := flag.String("shell", "sh", "command to serve")
	flag.Parse()

	cfg := sip.DefaultConfig()
	cfg.Port = *port
	cfg.Appearance = sip.Appearance{
		// Gruvbox dark. The sixteen arrive in index order, which is how
		// every terminal theme file carries them.
		Theme: sip.Theme{
			Foreground: "#ebdbb2",
			Background: "#282828",
			Cursor:     "#fe8019",
		}.WithANSI(sip.ANSIPalette{
			"#282828", "#cc241d", "#98971a", "#d79921",
			"#458588", "#b16286", "#689d6a", "#a89984",
			"#928374", "#fb4934", "#b8bb26", "#fabd2f",
			"#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
		}),
		MouseCursor:         "crosshair",
		CursorStyle:         "bar",
		CursorInactiveStyle: "none",
		CursorBlink:         true,
		Scrollback:          9000,
		FontSize:            17,
		Title:               "Gruvbox shell",
		// A one-cell orange square, so the tab icon needs no second file.
		Favicon: "data:image/svg+xml," +
			"%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'" +
			"%3E%3Crect width='8' height='8' fill='%23fe8019'/%3E%3C/svg%3E",
	}

	// What this deployment's page script may do. It repaints the terminal
	// and it does not type into it, which is the split Config.PageAPI
	// exists for: a theme switcher has no business holding a keystroke
	// primitive. clienttests/pageapi.spec.mjs reads both halves back out
	// of the browser.
	cfg.PageAPI = sip.PageAPI{
		Grant:  []sip.Capability{sip.CapAppearance},
		Revoke: []sip.Capability{sip.CapInput},
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := sip.NewServer(cfg).ServeCommand(ctx, *shell, nil, ""); err != nil {
		os.Stderr.WriteString("sip: " + err.Error() + "\n")
		os.Exit(1)
	}
}
