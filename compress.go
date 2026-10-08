package sip

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// The client's text files are served gzipped to a browser that accepts it.
// static/webterm.js alone is 928 KB, and 254 KB gzipped. Fonts are WOFF2,
// which is compressed already, and a TTF is the fallback for a browser
// without WOFF2, so neither is compressed again.
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

// acceptsGzip reports whether a request accepts a gzip body.
//
// It reads the coding names and ignores quality values, apart from an
// explicit "gzip;q=0", which refuses gzip.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		q := strings.ReplaceAll(strings.TrimSpace(params), " ", "")
		return q != "q=0" && q != "q=0.0" && q != "q=0.00" && q != "q=0.000"
	}
	return false
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
