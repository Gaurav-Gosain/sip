package sip

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strconv"
	"strings"

	// register additional decoders so the transcoder can rewrite JPEG/GIF
	// payloads (kitty graphics f=100 covers PNG; some apps abuse it for
	// other formats — these registrations make image.Decode fall through).
	_ "image/gif"
	_ "image/jpeg"
)

// kittyGfxTranscoder is a stateful byte-stream filter that intercepts kitty
// graphics protocol APC sequences carrying PNG payloads (f=100) and rewrites
// them as raw RGBA payloads (f=32). The wasm build of ghostty-vt used by
// ghostty-web does not link wuffs, so PNGs are rejected with
// "EINVAL: unsupported format" — this transcoder makes PNG-emitting TUI
// libraries (kitten icat, ntcharts, etc.) work transparently.
//
// Single- and multi-chunk APC transmissions are both supported. APC sequences
// using formats other than f=100 pass through untouched. So do non-graphics
// bytes.
//
// One transcoder per session. Not safe for concurrent use.
type kittyGfxTranscoder struct {
	state   transcoderState
	apcBody bytes.Buffer
	loading *pngLoading
}

type transcoderState int

const (
	stPass transcoderState = iota
	stEsc
	stEscUnderscore
	stApc
	stApcEsc
)

type pngLoading struct {
	meta    map[string]string
	encoded bytes.Buffer
}

const kittyEmitChunkSize = 4096
const maxAPCBody = 16 * 1024 * 1024

// Filter consumes a slice of PTY bytes and returns the (possibly rewritten)
// stream. The output may be larger or smaller than the input.
func (t *kittyGfxTranscoder) Filter(in []byte) []byte {
	var out bytes.Buffer
	for _, b := range in {
		switch t.state {
		case stPass:
			if b == 0x1b {
				t.state = stEsc
			} else {
				out.WriteByte(b)
			}
		case stEsc:
			if b == '_' {
				t.state = stEscUnderscore
			} else {
				out.WriteByte(0x1b)
				out.WriteByte(b)
				t.state = stPass
			}
		case stEscUnderscore:
			if b == 'G' {
				t.state = stApc
				t.apcBody.Reset()
			} else {
				out.WriteByte(0x1b)
				out.WriteByte('_')
				out.WriteByte(b)
				t.state = stPass
			}
		case stApc:
			switch b {
			case 0x1b:
				t.state = stApcEsc
			case 0x07:
				t.flushAPC(&out)
				t.state = stPass
			default:
				if t.apcBody.Len() >= maxAPCBody {
					t.abortAPC(&out)
					out.WriteByte(b)
					t.state = stPass
				} else {
					t.apcBody.WriteByte(b)
				}
			}
		case stApcEsc:
			if b == '\\' {
				t.flushAPC(&out)
				t.state = stPass
			} else {
				if t.apcBody.Len()+2 >= maxAPCBody {
					t.abortAPC(&out)
					out.WriteByte(0x1b)
					out.WriteByte(b)
					t.state = stPass
				} else {
					t.apcBody.WriteByte(0x1b)
					t.apcBody.WriteByte(b)
					t.state = stApc
				}
			}
		}
	}
	return out.Bytes()
}

func (t *kittyGfxTranscoder) abortAPC(out *bytes.Buffer) {
	out.WriteString("\x1b_G")
	out.Write(t.apcBody.Bytes())
	t.apcBody.Reset()
	t.loading = nil
}

func (t *kittyGfxTranscoder) flushAPC(out *bytes.Buffer) {
	body := t.apcBody.Bytes()
	semi := bytes.IndexByte(body, ';')
	var metaRaw, payload []byte
	if semi == -1 {
		metaRaw = body
	} else {
		metaRaw = body[:semi]
		payload = body[semi+1:]
	}
	meta := parseKittyMeta(metaRaw)

	if t.loading != nil {
		t.appendChunk(payload)
		if isFinalChunk(meta) {
			t.emitDecoded(out)
			t.loading = nil
		}
		return
	}

	if meta["f"] != "100" {
		writeAPC(out, body)
		return
	}

	t.loading = &pngLoading{meta: meta}
	t.appendChunk(payload)
	if isFinalChunk(meta) {
		t.emitDecoded(out)
		t.loading = nil
	}
}

func (t *kittyGfxTranscoder) appendChunk(payload []byte) {
	t.loading.encoded.Write(payload)
}

func (t *kittyGfxTranscoder) emitDecoded(out *bytes.Buffer) {
	raw, err := decodeBase64Tolerant(t.loading.encoded.Bytes())
	if err != nil {
		t.passthroughLoading(out)
		return
	}
	// Try PNG explicitly first to keep the fast path; fall back to
	// image.Decode (which uses any registered decoder — JPEG, GIF,
	// etc.) so common image-format mismatches inside f=100 still work.
	img, perr := png.Decode(bytes.NewReader(raw))
	if perr != nil {
		decoded, _, derr := image.Decode(bytes.NewReader(raw))
		if derr != nil {
			t.passthroughLoading(out)
			return
		}
		img = decoded
	}
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()

	rgba, ok := img.(*image.NRGBA)
	var pix []byte
	if ok && bounds.Min.X == 0 && bounds.Min.Y == 0 && rgba.Stride == width*4 {
		pix = rgba.Pix
	} else {
		dst := image.NewNRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				dst.Set(x, y, img.At(x+bounds.Min.X, y+bounds.Min.Y))
			}
		}
		pix = dst.Pix
	}

	meta := t.loading.meta
	meta["f"] = "32"
	meta["s"] = strconv.Itoa(width)
	meta["v"] = strconv.Itoa(height)
	delete(meta, "m")
	delete(meta, "o")

	encoded := base64.StdEncoding.EncodeToString(pix)
	writeChunkedAPC(out, meta, encoded)
}

func (t *kittyGfxTranscoder) passthroughLoading(out *bytes.Buffer) {
	writeChunkedAPC(out, t.loading.meta, t.loading.encoded.String())
}

func decodeBase64Tolerant(in []byte) ([]byte, error) {
	if decoded, err := base64.StdEncoding.DecodeString(string(in)); err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(string(in))
}

func writeAPC(out *bytes.Buffer, body []byte) {
	out.WriteString("\x1b_G")
	out.Write(body)
	out.WriteString("\x1b\\")
}

func writeChunkedAPC(out *bytes.Buffer, meta map[string]string, encoded string) {
	if len(encoded) <= kittyEmitChunkSize {
		out.WriteString("\x1b_G")
		writeMeta(out, meta)
		out.WriteByte(';')
		out.WriteString(encoded)
		out.WriteString("\x1b\\")
		return
	}

	first := encoded[:kittyEmitChunkSize]
	out.WriteString("\x1b_G")
	writeMetaWithOverride(out, meta, "m", "1")
	out.WriteByte(';')
	out.WriteString(first)
	out.WriteString("\x1b\\")

	i := kittyEmitChunkSize
	for i+kittyEmitChunkSize < len(encoded) {
		out.WriteString("\x1b_Gm=1;")
		out.WriteString(encoded[i : i+kittyEmitChunkSize])
		out.WriteString("\x1b\\")
		i += kittyEmitChunkSize
	}
	out.WriteString("\x1b_Gm=0;")
	out.WriteString(encoded[i:])
	out.WriteString("\x1b\\")
}

func parseKittyMeta(in []byte) map[string]string {
	m := make(map[string]string, 8)
	if len(in) == 0 {
		return m
	}
	for _, pair := range strings.Split(string(in), ",") {
		eq := strings.IndexByte(pair, '=')
		if eq < 0 {
			continue
		}
		m[pair[:eq]] = pair[eq+1:]
	}
	return m
}

func writeMeta(out *bytes.Buffer, m map[string]string) {
	first := true
	for k, v := range m {
		if !first {
			out.WriteByte(',')
		}
		first = false
		out.WriteString(k)
		out.WriteByte('=')
		out.WriteString(v)
	}
}

func writeMetaWithOverride(out *bytes.Buffer, m map[string]string, key, value string) {
	wroteKey := false
	first := true
	for k, v := range m {
		if !first {
			out.WriteByte(',')
		}
		first = false
		out.WriteString(k)
		out.WriteByte('=')
		if k == key {
			out.WriteString(value)
			wroteKey = true
		} else {
			out.WriteString(v)
		}
	}
	if !wroteKey {
		if !first {
			out.WriteByte(',')
		}
		out.WriteString(key)
		out.WriteByte('=')
		out.WriteString(value)
	}
}

func isFinalChunk(meta map[string]string) bool {
	m, ok := meta["m"]
	if !ok {
		return true
	}
	return m == "0"
}
