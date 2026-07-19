package sip

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

// pngB64 renders a small solid PNG and returns its standard base64 encoding.
func pngB64(t *testing.T, w, h int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestTranscoderSingleChunkPNGDecodes(t *testing.T) {
	tr := &kittyGfxTranscoder{}
	seq := "\x1b_Ga=T,f=100,t=d,i=1;" + pngB64(t, 4, 3) + "\x1b\\"
	out := string(tr.Filter([]byte(seq)))
	if !strings.Contains(out, "f=32") {
		t.Fatalf("expected transcoded f=32 output, got %q", out)
	}
	if !strings.Contains(out, "s=4") || !strings.Contains(out, "v=3") {
		t.Fatalf("expected pixel dims s=4,v=3 in output, got %q", out)
	}
	if strings.Contains(out, "f=100") {
		t.Fatalf("PNG format leaked through untranscoded: %q", out)
	}
}

// A multi-chunk transfer that never sends its terminating chunk must not
// swallow the images that follow it.
func TestTranscoderStaleContinuationDoesNotWedge(t *testing.T) {
	tr := &kittyGfxTranscoder{}

	// Start a chunked PNG transfer but never send the m=0 chunk.
	partial := pngB64(t, 2, 2)[:16]
	stale := "\x1b_Ga=T,f=100,t=d,i=1,m=1;" + partial + "\x1b\\"
	tr.Filter([]byte(stale))

	// A brand-new, complete image arrives.
	good := "\x1b_Ga=T,f=100,t=d,i=2;" + pngB64(t, 5, 4) + "\x1b\\"
	out := string(tr.Filter([]byte(good)))

	if !strings.Contains(out, "s=5") || !strings.Contains(out, "v=4") {
		t.Fatalf("new image after stale continuation was swallowed; out=%q", out)
	}
	// The abandoned transfer's bytes should still be flushed (never dropped).
	if !strings.Contains(out, partial) {
		t.Fatalf("stale transfer bytes were dropped instead of flushed; out=%q", out)
	}
	if tr.loading != nil {
		t.Fatalf("transcoder left in loading state after new image")
	}
}

// When decode fails, the passed-through bytes must not carry a dangling m=1
// that leaves the client parser waiting forever.
func TestTranscoderPassthroughDropsDanglingM(t *testing.T) {
	tr := &kittyGfxTranscoder{}
	// Two-chunk transfer whose combined payload is not a valid image.
	c1 := "\x1b_Ga=T,f=100,t=d,i=7,m=1;bm90\x1b\\" // "not" in base64
	c2 := "\x1b_Gm=0;YXBuZw==\x1b\\"               // "apng"
	tr.Filter([]byte(c1))
	out := string(tr.Filter([]byte(c2)))

	if strings.Contains(out, "m=1") {
		t.Fatalf("passthrough emitted a dangling m=1: %q", out)
	}
	if tr.loading != nil {
		t.Fatalf("transcoder stuck loading after failed decode")
	}
}

func TestTranscoderNonGraphicsAPCUntouched(t *testing.T) {
	tr := &kittyGfxTranscoder{}
	// f defaults away from 100 (a query) — should pass through verbatim.
	seq := "\x1b_Ga=q,i=1\x1b\\"
	out := string(tr.Filter([]byte(seq)))
	if out != seq {
		t.Fatalf("non-PNG APC was altered: in=%q out=%q", seq, out)
	}
}

func TestIsContinuationChunk(t *testing.T) {
	cases := []struct {
		meta map[string]string
		want bool
	}{
		{map[string]string{"m": "1"}, true},
		{map[string]string{"m": "0", "q": "1"}, true},
		{map[string]string{"m": "1", "a": "T"}, false},
		{map[string]string{"f": "100"}, false},
		{map[string]string{}, false},
	}
	for _, c := range cases {
		if got := isContinuationChunk(c.meta); got != c.want {
			t.Errorf("isContinuationChunk(%v) = %v, want %v", c.meta, got, c.want)
		}
	}
}
