// A deployment that changes how sip's page looks and behaves without forking
// sip.
//
// It uses every extension point sip has, in the order you should reach for
// them. Read it top to bottom: the cheap, upgrade-safe mechanisms come first
// and the one that forks a file comes last.
//
//	go run ./examples/hackable -p 7681
//
// See docs/extending.md for the argument behind each one.
package main

import (
	"context"
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/Gaurav-Gosain/sip"
)

// assets holds this deployment's own client files. brand.svg is a file sip
// does not ship, and index.html replaces the page sip does.
//
//go:embed assets
var assets embed.FS

// brandCSS is Config.ExtraCSS: rules appended after sip's own stylesheet.
//
// Reach for this first. Sip goes on serving terminal.css underneath, so an
// upgrade carries every fix to it and only these rules stay this
// deployment's. There is nothing here to go stale.
//
// The background image is served from the embedded assets above, which is how
// a page gets a file sip does not ship.
const brandCSS = `
#hack-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    line-height: 28px;
    padding-left: 30px;
    background: #181825 url('brand.svg') no-repeat 8px center;
    color: #a6e3a1;
    font: 13px/28px system-ui, sans-serif;
    z-index: 20;
}

#terminal-container {
    padding-top: 28px;
}

#connection-status {
    border-color: #a6e3a1;
}
`

// brandJS is Config.ExtraJS: a classic script run after sip's client and
// before the terminal opens.
//
// It talks to the page through window.sip, which is the only part of the page
// sip promises to keep. Four calls and five events; docs/extending.md says
// what each one means and what is deliberately missing from it.
const brandJS = `
(function () {
    'use strict';

    var banner = document.getElementById('hack-banner');
    var seen = [];

    function note(text) {
        seen.push(text);
        if (banner) banner.textContent = 'hackable example — ' + seen.join(' → ');
    }

    // ready is sticky, so this runs even though the terminal opens later.
    sip.on('ready', function (e) { note('ready ' + e.cols + 'x' + e.rows); });
    sip.on('connect', function (e) { note('connect ' + e.transport); });
    sip.on('disconnect', function (e) { note('disconnect ' + e.reason); });
    sip.on('resize', function (e) { note('resize ' + e.cols + 'x' + e.rows); });
    sip.on('title', function (e) { note('title ' + e.title); });

    // What a page script can do with the session: type into it.
    window.hackDemo = {
        events: seen,
        greet: function () { return sip.send('echo hackable\n'); },
        size: function () { return sip.size(); },
    };
})();
`

// manifest answers /manifest.webmanifest, so a phone can install this
// deployment as an app of its own.
//
// A route is for a URL outside /static/ that sip has no option for. The tab
// icon is not one of those any more: Appearance.Favicon names it and StaticFS
// serves the file, so nothing here has to.
func manifest(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/manifest+json")
	_, _ = w.Write([]byte(`{"name":"Hackable terminal","display":"standalone","start_url":"/","icons":[{"src":"/static/brand.svg","sizes":"any","type":"image/svg+xml"}]}`))
}

func main() {
	port := flag.String("p", "7681", "Port to listen on")
	flag.Parse()

	// index.html here is a copy of sip's, cut down to the elements the client
	// needs. A copy is a fork of one file, so stale_test.go pins the digest of
	// the original and fails on the upgrade that moves it. Nothing else tells
	// you.
	pages, err := fs.Sub(assets, "assets")
	if err != nil {
		log.Fatal(err)
	}

	cfg := sip.DefaultConfig()
	cfg.Port = *port
	// The tab's name and its icon are Appearance, beside the palette. The
	// icon is a file this deployment serves through StaticFS, so the page
	// carries a URL rather than an inline copy of the image.
	cfg.Appearance.Title = "Hackable terminal"
	cfg.Appearance.Favicon = "static/brand.svg"
	cfg.ExtraCSS = brandCSS
	cfg.ExtraJS = brandJS
	cfg.StaticFS = pages
	cfg.Routes = []sip.Route{
		{Pattern: "/manifest.webmanifest", Handler: http.HandlerFunc(manifest)},
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := sip.NewServer(cfg).ServeCommand(ctx, "sh", nil, ""); err != nil {
		log.Fatal(err)
	}
}
