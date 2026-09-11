package main

import (
	"testing"

	"github.com/Gaurav-Gosain/sip"
)

// sipIndexDigest is the SHA-256 of the index.html this example's copy was
// taken from.
//
// assets/index.html is a fork of one file. Sip goes on developing the
// original, an upgrade brings the new one in, and nothing on the screen or in
// the log says the copy has fallen behind. This is the thing that says it.
//
// When this fails: read sip's current index.html out of sip.Assets(), see what
// changed, carry what matters into assets/index.html, then put the new digest
// here. Do not just update the digest.
const sipIndexDigest = "2a3f870fc6f650c9a3cdaa931b6b8e01661c4b9cac6a4e0a5af785e64c6d9693"

func TestOverrideIsStillCurrent(t *testing.T) {
	got, err := sip.AssetDigest("index.html")
	if err != nil {
		t.Fatalf("read sip's index.html: %v", err)
	}
	if got != sipIndexDigest {
		t.Fatalf("sip's index.html has changed since assets/index.html was copied from it.\n"+
			"  was: %s\n  now: %s\n"+
			"Compare the two, carry over what matters, then update sipIndexDigest.",
			sipIndexDigest, got)
	}
}
