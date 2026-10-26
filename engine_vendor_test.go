package sip

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"regexp"
	"testing"
)

// TestVendoredEngineMatchesItsRecord holds static/engine, the opt-in worker
// engine, to the webterm commit engine-vendor.json says it came from, the
// way TestVendoredWebtermMatchesItsRecord holds the xterm.js client. A file
// copied by hand, edited after vendoring, or left behind fails here until
// scripts/vendor-engine.sh is run.
func TestVendoredEngineMatchesItsRecord(t *testing.T) {
	raw, err := os.ReadFile("engine-vendor.json")
	if err != nil {
		t.Fatal(err)
	}
	var rec struct {
		Commit string            `json:"commit"`
		Files  map[string]string `json:"files"`
	}
	if err := json.Unmarshal(raw, &rec); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(rec.Commit) {
		t.Fatalf("engine-vendor.json names commit %q, want a full git hash", rec.Commit)
	}
	embedded, err := fs.ReadDir(staticFiles, "static/engine")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, e := range embedded {
		name := e.Name()
		seen[name] = true
		want, ok := rec.Files[name]
		if !ok {
			t.Errorf("static/engine/%s is not in engine-vendor.json", name)
			continue
		}
		data, err := staticFiles.ReadFile("static/engine/" + name)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Errorf("static/engine/%s does not match engine-vendor.json; run scripts/vendor-engine.sh", name)
		}
	}
	for name := range rec.Files {
		if !seen[name] {
			t.Errorf("engine-vendor.json names %s, which static/engine does not have", name)
		}
	}
}
