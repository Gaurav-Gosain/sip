package sip

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
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

// Package-level logger
var logger *log.Logger

func init() {
	logger = log.NewWithOptions(os.Stderr, log.Options{
		ReportTimestamp: true,
		Prefix:          "sip",
	})
}

// httpServer is the internal HTTP server implementation.
type httpServer struct {
	config     Config
	handler    ProgramHandler
	httpServer *http.Server
	wtServer   *webtransport.Server
	sessions   sync.Map
	connCount  int32
	certInfo   *CertInfo
}

func newHTTPServer(config Config, handler ProgramHandler) *httpServer {
	return &httpServer{
		config:  config,
		handler: handler,
	}
}

func (s *httpServer) start(ctx context.Context) error {
	httpPort := s.config.Port
	wtPortNum := 7682
	if p, err := strconv.Atoi(s.config.Port); err == nil {
		wtPortNum = p + 1
	}
	wtPort := strconv.Itoa(wtPortNum)

	httpAddr := net.JoinHostPort(s.config.Host, httpPort)
	wtAddr := net.JoinHostPort("127.0.0.1", wtPort)

	logger.Debug("generating self-signed certificate")
	certInfo, err := GenerateSelfSignedCert(s.config.Host)
	if err != nil {
		return fmt.Errorf("failed to generate self-signed certificate: %w", err)
	}
	s.certInfo = certInfo

	logger.Info("certificate generated",
		"validity", "10 days",
		"algorithm", "ECDSA P-256",
	)

	httpMux := http.NewServeMux()

	httpMux.HandleFunc("/", s.handleIndex)
	httpMux.HandleFunc("/static/", s.handleStatic)
	httpMux.HandleFunc("/ws", s.handleWebSocket)
	httpMux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})

	httpMux.HandleFunc("/cert-hash", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		hashArray := make([]int, len(s.certInfo.Hash))
		for i, b := range s.certInfo.Hash {
			hashArray[i] = int(b)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"algorithm": "sha-256",
			"hashBytes": hashArray,
			"wtUrl":     fmt.Sprintf("https://127.0.0.1:%s/webtransport", wtPort),
		})
	})

	wtMux := http.NewServeMux()
	wtMux.HandleFunc("/webtransport", s.handleWebTransport)

	s.wtServer = &webtransport.Server{
		H3: http3.Server{
			Addr:            wtAddr,
			TLSConfig:       s.certInfo.TLSConfig,
			Handler:         wtMux,
			EnableDatagrams: true,
		},
		CheckOrigin: func(_ *http.Request) bool { return true },
	}

	s.httpServer = &http.Server{
		Addr:         httpAddr,
		Handler:      httpMux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	errChan := make(chan error, 2)

	go func() {
		logger.Info("HTTP server starting",
			"addr", httpAddr,
			"url", fmt.Sprintf("http://%s", httpAddr),
		)
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errChan <- fmt.Errorf("HTTP server error: %w", err)
		}
	}()

	go func() {
		logger.Info("WebTransport server starting",
			"addr", wtAddr,
			"protocol", "QUIC/UDP",
		)
		if err := s.wtServer.ListenAndServe(); err != nil {
			logger.Warn("WebTransport server error", "err", err)
		}
	}()

	logger.Info("server ready",
		"url", fmt.Sprintf("http://%s", httpAddr),
	)

	select {
	case <-ctx.Done():
		logger.Info("shutting down web server")
		_ = s.httpServer.Shutdown(ctx)
		_ = s.wtServer.Close()
		return nil
	case err := <-errChan:
		return err
	}
}

func (s *httpServer) handleIndex(w http.ResponseWriter, r *http.Request) {
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

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *httpServer) handleStatic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
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
	case strings.HasSuffix(path, ".woff2"):
		w.Header().Set("Content-Type", "font/woff2")
	case strings.HasSuffix(path, ".woff"):
		w.Header().Set("Content-Type", "font/woff")
	case strings.HasSuffix(path, ".ttf"):
		w.Header().Set("Content-Type", "font/ttf")
	}

	if strings.Contains(path, "fonts/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000")
	}

	_, _ = w.Write(data)
}

func (s *httpServer) checkConnectionLimit() bool {
	if s.config.MaxConnections <= 0 {
		return true
	}
	newCount := s.incrementConnCount()
	if int(newCount) > s.config.MaxConnections {
		s.decrementConnCount()
		logger.Warn("connection limit reached",
			"current", newCount-1,
			"max", s.config.MaxConnections,
		)
		return false
	}
	logger.Debug("connection accepted", "count", newCount)
	return true
}

func (s *httpServer) releaseConnection() {
	if s.config.MaxConnections <= 0 {
		return
	}
	newCount := s.decrementConnCount()
	logger.Debug("connection released", "count", newCount)
}
