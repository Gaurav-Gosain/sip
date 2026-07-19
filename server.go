package sip

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/log"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

//go:embed static/*
var staticFiles embed.FS

// warnStaleEmbed reports assets that differ between the binary's embedded
// copy and the working directory.
//
// Every asset the client runs is baked in by go:embed at build time, so
// editing static/ and restarting without rebuilding silently keeps serving
// the old bundle. That has already cost a debugging session: a keyboard fix
// was verified present in static/ghostty-web/ghostty-web.js while the server
// went on serving the previous build of it, so the fix appeared to do
// nothing and the investigation went looking for a second bug that did not
// exist.
//
// Only runs when static/ exists next to the process, which means a developer
// running from the source tree; an installed binary elsewhere stays quiet.
func warnStaleEmbed() {
	if fi, err := os.Stat("static"); err != nil || !fi.IsDir() {
		return
	}
	var stale []string
	err := fs.WalkDir(staticFiles, "static", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		onDisk, err := os.ReadFile(p)
		if err != nil {
			return nil // not a mismatch: the file simply is not there
		}
		embedded, err := staticFiles.ReadFile(p)
		if err != nil {
			return nil
		}
		if !bytes.Equal(onDisk, embedded) {
			stale = append(stale, p)
		}
		return nil
	})
	if err != nil || len(stale) == 0 {
		return
	}
	logger.Warn("serving a STALE embedded bundle: static/ on disk differs from the binary; rebuild to pick the changes up",
		"files", strings.Join(stale, ", "),
		"count", len(stale),
	)
}

// Package-level logger
var logger *log.Logger

func init() {
	logger = log.NewWithOptions(os.Stderr, log.Options{
		ReportTimestamp: true,
		Prefix:          "sip",
	})
	// Disable ANSI colors so escape sequences don't leak.
	logger.SetColorProfile(0)
}

// httpServer is the internal HTTP server implementation.
type httpServer struct {
	config     Config
	handler    ProgramHandler
	cmdHandler *CommandHandler
	httpServer *http.Server
	wtServer   *webtransport.Server
	sessions   sync.Map
	connCount  int32
	certInfo   *CertInfo
	connectMW  []ConnectMiddleware
}

func newHTTPServer(config Config, handler ProgramHandler) *httpServer {
	return &httpServer{
		config:  config,
		handler: handler,
	}
}

func (s *httpServer) start(ctx context.Context) error {
	if err := s.validateConfig(); err != nil {
		return err
	}

	// Compose the layer-1 ConnectMiddleware chain. Built-ins (basic auth,
	// connection limit) appended last so they run innermost.
	s.connectMW = append([]ConnectMiddleware{}, s.config.ConnectMiddleware...)
	if s.config.BasicUsername != "" || s.config.BasicPassword != "" {
		s.connectMW = append(s.connectMW, basicAuthMiddleware(s.config.BasicUsername, s.config.BasicPassword))
	}
	s.connectMW = append(s.connectMW, connLimitMiddleware(s))

	// Layer-2 SessionMiddleware: prepend idle timeout (no-op when 0).
	if s.config.IdleTimeout > 0 {
		s.config.SessionMiddleware = append(
			[]SessionMiddleware{idleTimeoutMiddleware(s.config.IdleTimeout)},
			s.config.SessionMiddleware...,
		)
	}

	httpPort := s.config.Port
	wtPortNum := 7682
	if p, err := strconv.Atoi(s.config.Port); err == nil {
		wtPortNum = p + 1
	}
	wtPort := strconv.Itoa(wtPortNum)

	httpAddr := net.JoinHostPort(s.config.Host, httpPort)
	// Bind WebTransport to the same host as HTTP so the advertised wtUrl
	// (derived per-request from the client's Host header) is actually
	// reachable. Hardcoding 127.0.0.1 here left WT dead for any non-loopback
	// or hostname-based deployment.
	wtAddr := net.JoinHostPort(s.config.Host, wtPort)

	if err := s.configureCert(); err != nil {
		return err
	}

	httpMux := http.NewServeMux()
	httpMux.HandleFunc("/", s.handleIndex)
	httpMux.HandleFunc("/static/", s.authGate(s.handleStatic))
	httpMux.HandleFunc("/ws", s.handleWebSocket)
	httpMux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})
	httpMux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	if s.certInfo != nil {
		httpMux.HandleFunc("/cert-hash", s.handleCertHash(wtPort))
	}

	wtMux := http.NewServeMux()
	wtMux.HandleFunc("/webtransport", s.handleWebTransport)

	if s.certInfo != nil {
		s.wtServer = &webtransport.Server{
			H3: http3.Server{
				Addr:            wtAddr,
				TLSConfig:       s.certInfo.TLSConfig,
				Handler:         wtMux,
				EnableDatagrams: true,
			},
			CheckOrigin: s.checkOrigin,
		}
	}

	s.httpServer = &http.Server{
		Addr:         httpAddr,
		Handler:      httpMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}
	if s.mainTLSEnabled() {
		s.httpServer.TLSConfig = s.certInfo.TLSConfig
	}

	errChan := make(chan error, 2)

	go func() {
		scheme := "http"
		if s.mainTLSEnabled() {
			scheme = "https"
		}
		logger.Info("HTTP server starting",
			"addr", httpAddr,
			"url", fmt.Sprintf("%s://%s", scheme, httpAddr),
		)
		var err error
		if s.mainTLSEnabled() {
			err = s.httpServer.ListenAndServeTLS(s.config.TLSCert, s.config.TLSKey)
		} else {
			err = s.httpServer.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			errChan <- fmt.Errorf("HTTP server error: %w", err)
		}
	}()

	if s.wtServer != nil {
		go func() {
			logger.Info("WebTransport server starting",
				"addr", wtAddr,
				"protocol", "QUIC/UDP",
			)
			if err := s.wtServer.ListenAndServe(); err != nil && err.Error() != "http: Server closed" {
				logger.Warn("WebTransport server error", "err", err)
			}
		}()
	}

	scheme := "http"
	if s.mainTLSEnabled() {
		scheme = "https"
	}
	logger.Info("server ready",
		"url", fmt.Sprintf("%s://%s", scheme, httpAddr),
	)
	warnStaleEmbed()

	select {
	case <-ctx.Done():
		logger.Info("shutting down web server")

		s.sessions.Range(func(_, value any) bool {
			if sess, ok := value.(*cmdSession); ok {
				s.closeCmdSession(sess)
			} else if sess, ok := value.(*webSession); ok {
				s.closeSession(sess)
			}
			return true
		})

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_ = s.httpServer.Shutdown(shutdownCtx)
		if s.wtServer != nil {
			_ = s.wtServer.Close()
		}
		return nil
	case err := <-errChan:
		return err
	}
}

func (s *httpServer) validateConfig() error {
	switch {
	case (s.config.TLSCert == "") != (s.config.TLSKey == ""):
		return fmt.Errorf("TLSCert and TLSKey must be provided together")
	case s.hasBasicAuth() && !s.mainTLSEnabled() && !s.config.AllowInsecureNoTLS:
		return fmt.Errorf("basic auth requires TLS; pass --cert/--key, or set AllowInsecureNoTLS to override (insecure)")
	case !s.mainTLSEnabled() && !isLoopbackHost(s.config.Host) && !s.config.AllowInsecureNoTLS:
		return fmt.Errorf("non-loopback listeners require TLS; pass --cert/--key, or set AllowInsecureNoTLS to override (insecure)")
	}

	if s.hasBasicAuth() && !s.mainTLSEnabled() && s.config.AllowInsecureNoTLS {
		logger.Warn("basic auth enabled without TLS — credentials are sent in plaintext on every request")
	}
	if !s.mainTLSEnabled() && !isLoopbackHost(s.config.Host) && s.config.AllowInsecureNoTLS {
		logger.Warn("non-loopback bind without TLS — terminal traffic is unencrypted")
	}
	return nil
}

// configureCert loads the configured TLS keypair, or generates a
// self-signed cert for loopback hosts so WebTransport keeps working
// out of the box.
func (s *httpServer) configureCert() error {
	if s.config.TLSCert != "" && s.config.TLSKey != "" {
		cert, err := tls.LoadX509KeyPair(s.config.TLSCert, s.config.TLSKey)
		if err != nil {
			return fmt.Errorf("load TLS keypair: %w", err)
		}
		certInfo, err := newCertInfoFromTLS(cert)
		if err != nil {
			return fmt.Errorf("certinfo from keypair: %w", err)
		}
		s.certInfo = certInfo
		logger.Info("loaded TLS certificate", "cert", s.config.TLSCert)
		return nil
	}

	// Auto-generate self-signed only for loopback. Non-loopback without
	// TLS is already either rejected (validateConfig) or running without
	// WT (no cert) — both fine.
	if !isLoopbackHost(s.config.Host) {
		s.certInfo = nil
		return nil
	}

	logger.Debug("generating self-signed certificate")
	host := s.config.Host
	if host == "" || host == "0.0.0.0" {
		host = "localhost"
	}
	certInfo, err := GenerateSelfSignedCert(host)
	if err != nil {
		logger.Warn("WebTransport disabled: cert generation failed", "err", err)
		s.certInfo = nil
		return nil
	}
	s.certInfo = certInfo
	logger.Info("certificate generated",
		"validity", "10 days",
		"algorithm", "ECDSA P-256",
	)
	return nil
}

func (s *httpServer) handleIndex(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(w, r) {
		return
	}
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	logger.Debug("serving index", "remote", r.RemoteAddr)

	data, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	rendered := s.renderIndex(data)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(rendered)
}

// renderIndex injects per-deployment font config into the index HTML.
// The {{FONT_FACE_EXTRA}} placeholder is replaced with an additional
// @font-face rule + a window.__sipConfig blob so the JS picks the
// custom family up.
func (s *httpServer) renderIndex(data []byte) []byte {
	out := bytes.NewBuffer(make([]byte, 0, len(data)+512))
	body := string(data)

	var extra strings.Builder
	cfg := map[string]string{}
	if s.config.FontPath != "" {
		family := s.config.FontFamily
		if family == "" {
			family = "Sip Custom Font"
		}
		// Serve the font under /static/fonts/custom<ext> via handleStatic's
		// virtual route. Just need a stable URL the browser can hit.
		extra.WriteString(`<style>@font-face { font-family: '`)
		extra.WriteString(family)
		extra.WriteString(`'; src: url('static/fonts/custom`)
		extra.WriteString(filepath.Ext(s.config.FontPath))
		extra.WriteString(`'); font-weight: 100 900; font-style: normal; font-display: block; }</style>`)
		cfg["fontFamily"] = "'" + family + "', 'JetBrainsMono Nerd Font Mono', monospace"
	} else if s.config.FontFamily != "" {
		cfg["fontFamily"] = s.config.FontFamily
	}
	if s.config.Renderer != "" {
		cfg["renderer"] = s.config.Renderer
	}
	if len(cfg) > 0 {
		blob, _ := json.Marshal(cfg)
		extra.WriteString("<script>window.__sipConfig=")
		extra.Write(blob)
		extra.WriteString(";</script>")
	}

	body = strings.ReplaceAll(body, "{{FONT_FACE_EXTRA}}", extra.String())
	out.WriteString(body)
	return out.Bytes()
}

// writeRevalidatingHeaders tags a response with a content ETag and asks the
// browser to revalidate before reusing it. It reports whether the request was
// answered with 304, in which case the caller must not write a body.
func writeRevalidatingHeaders(w http.ResponseWriter, r *http.Request, data []byte) bool {
	sum := sha256.Sum256(data)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	return false
}

// handleStatic serves embedded static files plus a virtual
// /static/fonts/custom<ext> route for the user-supplied font.
func (s *httpServer) handleStatic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")

	// Virtual custom font route — sniff the prefix instead of an exact
	// match so we accept any extension the user supplied.
	if s.config.FontPath != "" && strings.HasPrefix(path, "static/fonts/custom") {
		s.serveCustomFont(w, r)
		return
	}

	data, err := staticFiles.ReadFile(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	logger.Debug("serving static", "path", path, "size", len(data))

	switch {
	case strings.HasSuffix(path, ".js"):
		w.Header().Set("Content-Type", "application/javascript")
	case strings.HasSuffix(path, ".css"):
		w.Header().Set("Content-Type", "text/css")
	case strings.HasSuffix(path, ".wasm"):
		w.Header().Set("Content-Type", "application/wasm")
	case strings.HasSuffix(path, ".woff2"):
		w.Header().Set("Content-Type", "font/woff2")
	case strings.HasSuffix(path, ".woff"):
		w.Header().Set("Content-Type", "font/woff")
	case strings.HasSuffix(path, ".ttf"):
		w.Header().Set("Content-Type", "font/ttf")
	case strings.HasSuffix(path, ".otf"):
		w.Header().Set("Content-Type", "font/otf")
	}

	// Assets are served from the binary, so they change whenever sip is
	// rebuilt while their URLs stay the same. A long max-age therefore pins a
	// browser to a stale client for as long as the header says, and an ES
	// module graph is not reliably revalidated by a reload, so the stale copy
	// survives even a hard refresh. Revalidate every asset instead: the
	// payloads come from memory and an unchanged one answers 304.
	if writeRevalidatingHeaders(w, r, data) {
		return
	}

	_, _ = w.Write(data)
}

func (s *httpServer) serveCustomFont(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(s.config.FontPath)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	switch strings.ToLower(filepath.Ext(s.config.FontPath)) {
	case ".woff2":
		w.Header().Set("Content-Type", "font/woff2")
	case ".woff":
		w.Header().Set("Content-Type", "font/woff")
	case ".otf":
		w.Header().Set("Content-Type", "font/otf")
	default:
		w.Header().Set("Content-Type", "font/ttf")
	}
	if writeRevalidatingHeaders(w, r, data) {
		return
	}
	_, _ = w.Write(data)
}

func (s *httpServer) handleCertHash(wtPort string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkAuth(w, r) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		hashArray := make([]int, len(s.certInfo.Hash))
		for i, b := range s.certInfo.Hash {
			hashArray[i] = int(b)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"algorithm": "sha-256",
			"hashBytes": hashArray,
			"wtUrl":     wtURLFromHost(r.Host, wtPort),
		})
	}
}

func (s *httpServer) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	if validateBasicAuth(r, s.config.BasicUsername, s.config.BasicPassword) {
		return true
	}
	w.Header().Set("WWW-Authenticate", `Basic realm="sip"`)
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
	return false
}

// authGate wraps a non-session HTTP handler so it fails closed when
// Basic Auth is configured. Static assets stay private.
func (s *httpServer) authGate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkAuth(w, r) {
			return
		}
		next(w, r)
	}
}

func (s *httpServer) hasBasicAuth() bool {
	return s.config.BasicUsername != "" || s.config.BasicPassword != ""
}

func (s *httpServer) mainTLSEnabled() bool {
	return s.config.TLSCert != "" && s.config.TLSKey != ""
}

// wtURLFromHost builds the WebTransport endpoint the client should dial,
// reusing the hostname the browser reached the HTTP server on and swapping
// in the QUIC/UDP port. Deriving it from the request Host keeps WT working
// under hostname-based and reverse-proxied deployments instead of pinning
// loopback.
func wtURLFromHost(reqHost, wtPort string) string {
	host := reqHost
	if h, _, err := net.SplitHostPort(reqHost); err == nil {
		host = h
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("https://%s/webtransport", net.JoinHostPort(host, wtPort))
}

func isLoopbackHost(host string) bool {
	if host == "" || host == "localhost" {
		return true
	}
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		host = parsed
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
