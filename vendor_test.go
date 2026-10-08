package sip

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// webtermVendor is webterm-vendor.json, which scripts/vendor-webterm.sh
// writes when it copies webterm's script-tag bundles into static/.
type webtermVendor struct {
	Repository string            `json:"repository"`
	Commit     string            `json:"commit"`
	Version    string            `json:"version"`
	Xterm      string            `json:"xterm"`
	Vtgl       string            `json:"vtgl"`
	VtglCommit string            `json:"vtglCommit"`
	Files      map[string]string `json:"files"`
}

// TestVendoredWebtermMatchesItsRecord holds the vendored client to the
// webterm commit it says it came from.
//
// The bundles used to carry no record of their source, so nobody could tell
// which webterm fixes a sip release had. A bundle copied by hand, or edited
// after vendoring, now fails here until scripts/vendor-webterm.sh is run.
func TestVendoredWebtermMatchesItsRecord(t *testing.T) {
	raw, err := os.ReadFile("webterm-vendor.json")
	if err != nil {
		t.Fatal(err)
	}
	var rec webtermVendor
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatal(err)
	}
	hash := regexp.MustCompile(`^[0-9a-f]{40}$`)
	if !hash.MatchString(rec.Commit) {
		t.Fatalf("webterm-vendor.json names commit %q, want a full git hash", rec.Commit)
	}
	// webterm-vtgl.js inlines vtgl, so its source is two commits.
	if !hash.MatchString(rec.VtglCommit) {
		t.Errorf("webterm-vendor.json names vtgl commit %q, want a full git hash", rec.VtglCommit)
	}
	if rec.Xterm == "" {
		t.Error("webterm-vendor.json does not name the xterm.js version")
	}
	for _, name := range []string{"webterm.js", "webterm-vtgl.js", "webterm.css", "xterm.css"} {
		want, ok := rec.Files[name]
		if !ok {
			t.Errorf("webterm-vendor.json has no hash for %s", name)
			continue
		}
		data, err := staticFiles.ReadFile("static/" + name)
		if err != nil {
			t.Errorf("static/%s: %v", name, err)
			continue
		}
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Errorf("static/%s is %s, webterm-vendor.json says %s. Run scripts/vendor-webterm.sh.", name, got, want)
		}
	}
}

// TestVendoredWebtermCarriesWhatTheClientUses checks the default bundle for
// the pieces terminal.js reads off the WebTerm global, and for the one piece it
// must not carry.
func TestVendoredWebtermCarriesWhatTheClientUses(t *testing.T) {
	data, err := staticFiles.ReadFile("static/webterm.js")
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	for _, want := range []string{
		// xterm.js 6.0.0 stable has no APC parser, and without it kitty
		// graphics stop. See AGENTS.md.
		"registerApcHandler",
		// The transports and touch support that terminal.js no longer
		// carries copies of.
		"webSocketTransport", "webTransportTransport", "reconnecting",
		"installKeyBar", "installTouchMouse",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("static/webterm.js has no %s", want)
		}
	}
	// vtgl is about 900 KB and has its own file, loaded only when the vtgl
	// renderer is chosen. Its HarfBuzz glue names the wasm exports it calls.
	if strings.Contains(body, "hb_buffer_create") {
		t.Error("static/webterm.js carries vtgl. It belongs in static/webterm-vtgl.js only.")
	}
	vtgl, err := staticFiles.ReadFile("static/webterm-vtgl.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(vtgl), "hb_buffer_create") {
		t.Error("static/webterm-vtgl.js does not carry vtgl's HarfBuzz shaper")
	}
}
