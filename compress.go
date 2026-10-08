package sip

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// The client's text files are served gzipped to a browser that accepts it.
// static/webterm.js alone is 928 KB, and 254 KB gzipped. Fonts are WOFF2,
// which is compressed already, so they are not compressed again.
//
// Only sip's own embedded files are compressed. An override from StaticFS is
// read on every request and can change on disk, so it is served as it is.

// compressible reports whether an asset is text worth compressing.
func compressible(name string) bool {
	for _, ext := range []string{".js", ".css", ".html", ".json", ".svg"} {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether a request accepts a gzip body: it names gzip,
// or "*", with a weight above zero. Coding names and the q parameter are
// case-insensitive (RFC 9110, section 12.5.3).
func acceptsGzip(r *http.Request) bool {
	star := false
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		fields := strings.Split(part, ";")
		name := strings.TrimSpace(fields[0])
		weight := 1.0
		for _, param := range fields[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			q, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				q = 0
			}
			weight = q
		}
		switch {
		case strings.EqualFold(name, "gzip"):
			return weight > 0
		case name == "*":
			star = weight > 0
		}
	}
	return star
}

// gzipEntry is one compressed embedded asset.
type gzipEntry struct {
	once sync.Once
	body []byte
	etag string
	ok   bool
}

// embeddedGzip caches the gzipped body of each embedded asset, by name. The
// files are part of the binary, so each is compressed once per process.
var embeddedGzip sync.Map

// gzippedAsset returns the gzipped body of an embedded asset and its ETag,
// which differs from the plain body's tag, as RFC 9110 requires of a
// different representation.
func gzippedAsset(name string) ([]byte, string, bool) {
	v, _ := embeddedGzip.LoadOrStore(name, &gzipEntry{})
	e := v.(*gzipEntry)
	e.once.Do(func() {
		data, err := staticFiles.ReadFile("static/" + name)
		if err != nil {
			return
		}
		var buf bytes.Buffer
		zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		if err != nil {
			return
		}
		if _, err := zw.Write(data); err != nil {
			return
		}
		if err := zw.Close(); err != nil {
			return
		}
		e.body = buf.Bytes()
		tag := contentETag(data)
		e.etag = tag[:len(tag)-1] + `-gzip"`
		e.ok = true
	})
	return e.body, e.etag, e.ok
}
