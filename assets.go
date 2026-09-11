package sip

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"sort"
	"strings"
)

// Asset names that carry config rather than a file. A consumer's StaticFS
// cannot claim them, because the whole point of ExtraCSS and ExtraJS is that
// they arrive without a file.
const (
	extraCSSName = "sip-extra.css"
	extraJSName  = "sip-extra.js"
)

// reservedRoutes are the paths sip's own client depends on. A consumer route
// that took one of them would break the terminal it is decorating, so the
// server refuses to start instead.
//
// /favicon.ico is deliberately absent: sip answers it with 204 only because it
// has no icon to give, and handing one over is the commonest reason to want a
// route at all.
var reservedRoutes = []string{"/", "/static/", "/ws", "/webtransport", "/health", "/cert-hash"}

// Route serves a consumer's own URL alongside the terminal.
//
// Pattern is an http.ServeMux pattern, so a trailing slash makes it a subtree:
//
//	sip.Route{Pattern: "/favicon.ico", Handler: http.HandlerFunc(myIcon)}
//	sip.Route{Pattern: "/brand/", Handler: http.StripPrefix("/brand/", http.FileServerFS(brand))}
//
// Every route is behind the same Basic Auth as the rest of the server. Sip
// cannot tell which of a consumer's URLs is safe to publish, so it treats them
// all as private, the way it treats the static assets.
type Route struct {
	// Pattern is where the route is served. It must not be one of sip's
	// own paths, and the server reports which one it clashed with.
	Pattern string

	// Handler answers the request.
	Handler http.Handler
}

// Assets returns the client files sip ships, rooted so the names match the
// URLs under /static/: "terminal.css", "fonts/JetBrainsMonoNerdFontMono-Regular.ttf".
//
// Read from it to derive an override from the file sip actually serves,
// instead of guessing at its content.
func Assets() fs.FS {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		// static/ is embedded by a directive in this package, so this
		// cannot fail in a built binary.
		panic("sip: embedded assets missing: " + err.Error())
	}
	return sub
}

// AssetNames lists every file Assets holds, sorted.
func AssetNames() []string {
	var names []string
	_ = fs.WalkDir(Assets(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		names = append(names, p)
		return nil
	})
	sort.Strings(names)
	return names
}

// AssetDigest returns the SHA-256 of a shipped asset, hex encoded.
//
// It is the answer to "is my override stale". An override is a copy of a file
// that sip goes on developing, and nothing in an upgrade tells a consumer that
// the original moved on. Pin the digest of the file you copied in a test of
// your own:
//
//	func TestOverrideIsCurrent(t *testing.T) {
//	    got, err := sip.AssetDigest("terminal.css")
//	    if err != nil { t.Fatal(err) }
//	    if got != "12056d40…" {
//	        t.Fatal("sip's terminal.css changed; re-check static/terminal.css against it")
//	    }
//	}
//
// The test fails on the upgrade that changed the file, which is the only
// moment at which the answer is useful.
func AssetDigest(name string) (string, error) {
	data, err := fs.ReadFile(Assets(), name)
	if err != nil {
		return "", fmt.Errorf("sip asset %q: %w", name, err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// assetName maps a request path to an asset name, and reports whether the
// path names an asset at all.
//
// This is the only place a request decides which file is read, so it is the
// only place a traversal could start. fs.ValidPath rejects "..", an absolute
// path and an empty element, which is what an fs.FS is entitled to assume of
// a name. A backslash is rejected on top of that: it is an ordinary character
// to fs.ValidPath and a separator to Windows.
func assetName(urlPath string) (string, bool) {
	const prefix = "/static/"
	if !strings.HasPrefix(urlPath, prefix) {
		return "", false
	}
	name := urlPath[len(prefix):]
	// fs.ValidPath calls "." valid: it is the root of an FS. It is not a
	// file, so it is not an asset.
	if name == "" || name == "." || strings.Contains(name, `\`) || !fs.ValidPath(name) {
		return "", false
	}
	return name, true
}

// readAsset returns the bytes to serve for an asset name, preferring the
// consumer's StaticFS over the embedded copy.
//
// A missing file in StaticFS is the normal case and falls through quietly:
// overriding one stylesheet must not mean vendoring the other six files. Any
// other failure is logged and falls through too, because a consumer whose
// directory lost its read permission wants a working terminal and a line in
// the log, not a blank page.
func (s *httpServer) readAsset(name string) ([]byte, bool) {
	if s.config.StaticFS != nil {
		data, err := fs.ReadFile(s.config.StaticFS, name)
		switch {
		case err == nil:
			return data, true
		case errors.Is(err, fs.ErrNotExist):
			// Not an override. Serve sip's own copy.
		default:
			logger.Warn("cannot read the override. Sip serves its own copy of this file",
				"file", name, "err", err)
		}
	}
	data, err := staticFiles.ReadFile("static/" + name)
	if err != nil {
		return nil, false
	}
	return data, true
}

// overriddenAssets lists the shipped files a consumer's StaticFS replaces.
func (s *httpServer) overriddenAssets() []string {
	if s.config.StaticFS == nil {
		return nil
	}
	var over []string
	for _, name := range AssetNames() {
		if _, err := fs.Stat(s.config.StaticFS, name); err == nil {
			over = append(over, name)
		}
	}
	return over
}

// warnOverriddenAssets says which of sip's own files a deployment has
// replaced, once, at startup.
//
// It is the sibling of warnStaleEmbed and it exists for the same failure. That
// one catches a file sip developed past its build. This one catches a file sip
// developed past a consumer's copy: an override is a fork of one file, an
// upgrade moves the original, and nothing else says so. Naming the files is
// all sip can honestly do, because it cannot know which version was copied.
// AssetDigest is the part a consumer can pin.
func (s *httpServer) warnOverriddenAssets() {
	over := s.overriddenAssets()
	if len(over) == 0 {
		return
	}
	logger.Info("sip serves replaced client files. Check each one after a sip upgrade",
		"files", strings.Join(over, ", "),
		"count", len(over),
	)
}

// validateRoutes refuses a route that would shadow a path sip's own client
// needs. The clash is named, because "route rejected" without the reason
// sends the reader to the source.
func (s *httpServer) validateRoutes() error {
	seen := map[string]bool{}
	for _, r := range s.config.Routes {
		switch {
		case r.Pattern == "":
			return errors.New("a Route has an empty Pattern")
		case r.Handler == nil:
			return fmt.Errorf("route %q has no Handler", r.Pattern)
		case seen[r.Pattern]:
			return fmt.Errorf("route %q is registered twice", r.Pattern)
		}
		path := routePath(r.Pattern)
		if path == "" {
			return fmt.Errorf("route %q has no path. A pattern needs a leading slash", r.Pattern)
		}
		for _, reserved := range reservedRoutes {
			if path == reserved || (reserved != "/" && strings.HasSuffix(reserved, "/") && strings.HasPrefix(path, reserved)) {
				return fmt.Errorf("route %q is sip's own path %q. The terminal is served there. Pick another pattern", r.Pattern, reserved)
			}
		}
		seen[r.Pattern] = true
	}
	return nil
}

// routePath returns the path part of an http.ServeMux pattern, which may
// carry a method and a host in front of it ("GET example.com/x").
func routePath(pattern string) string {
	if i := strings.Index(pattern, "/"); i >= 0 {
		return pattern[i:]
	}
	return ""
}

// registerRoutes puts the deployment's own routes on the mux, behind the same
// auth gate as everything else, and supplies sip's empty favicon only when no
// route has claimed it.
//
// ServeMux panics on a pattern that conflicts with one already registered, and
// a panic during startup reads as a bug in sip. validateRoutes rejects the
// conflicts it can name; this turns the rest into the same kind of refusal.
func (s *httpServer) registerRoutes(mux *http.ServeMux) (err error) {
	claimedFavicon := false
	for _, r := range s.config.Routes {
		if routePath(r.Pattern) == "/favicon.ico" {
			claimedFavicon = true
		}
		if regErr := registerOne(mux, r, s.authGate); regErr != nil {
			return regErr
		}
	}
	if !claimedFavicon {
		mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})
	}
	return nil
}

func registerOne(mux *http.ServeMux, r Route, gate func(http.HandlerFunc) http.HandlerFunc) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("route %q clashes with a path already served: %v", r.Pattern, rec)
		}
	}()
	mux.Handle(r.Pattern, gate(r.Handler.ServeHTTP))
	return nil
}
