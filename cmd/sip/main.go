// Command sip wraps any CLI command and exposes it through a web browser.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Gaurav-Gosain/sip"
	"github.com/charmbracelet/fang"
	"github.com/charmbracelet/log"
	"github.com/spf13/cobra"
)

// Version information (set by goreleaser)
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
	builtBy = "unknown"
)

// Command-line flags
var (
	host               string
	port               string
	debug              bool
	workDir            string
	certFile           string
	keyFile            string
	basicUser          string
	basicPass          string
	basicPassFile      string
	allowInsecureNoTLS bool
	originPatterns     []string
	idleTimeout        time.Duration
	maxConns           int
	enableKitty        bool
	fontPath           string
	fontFamily         string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "sip [flags] -- command [args...]",
		Short: "Serve CLI commands through the browser",
		Long: `sip - Serve CLI commands through the browser

Wraps any CLI command and exposes it through a web browser with full
terminal emulation. Renders with libghostty (ghostty-web wasm) for
high-fidelity terminal output, decodes kitty graphics (including PNG)
client-side in the wasm VT, and speaks WebSocket or WebTransport
(HTTP/3 over QUIC).

The command to run must be specified after "--".`,
		Example: `  # Run htop in browser
  sip -- htop

  # Run on custom port
  sip -p 8080 -- claude -c

  # Bind to all interfaces (TLS required by default)
  sip --host 0.0.0.0 --cert server.crt --key server.key -- bash

  # Bind to all interfaces without TLS (insecure)
  sip --host 0.0.0.0 --allow-insecure-no-tls -- bash

  # Basic Auth
  sip --basic-user admin --basic-pass-file /run/secrets/sip --cert s.crt --key s.key -- bash

  # Custom font from disk
  sip --font /path/to/CommitMono.ttf --font-family "Commit Mono" -- nvim

  # Run with debug logging
  sip --debug -- nvim`,
		Version:      version,
		SilenceUsage: true,
		RunE: func(_ *cobra.Command, args []string) error {
			if len(args) == 0 {
				return fmt.Errorf("no command specified\n\nUsage: sip [flags] -- command [args...]")
			}
			return runServer(args)
		},
	}

	// Listener / TLS
	rootCmd.Flags().StringVarP(&host, "host", "H", "localhost", "Host to bind to")
	rootCmd.Flags().StringVarP(&port, "port", "p", "7681", "Port to listen on")
	rootCmd.Flags().StringVar(&certFile, "cert", "", "TLS certificate file (PEM)")
	rootCmd.Flags().StringVar(&keyFile, "key", "", "TLS key file (PEM)")
	rootCmd.Flags().BoolVar(&allowInsecureNoTLS, "allow-insecure-no-tls", false,
		"Allow non-loopback bind / basic auth without TLS (insecure; use behind trusted proxy only)")
	rootCmd.Flags().StringSliceVar(&originPatterns, "origin", nil,
		"Browser origin allowlist (path.Match glob, repeatable)")

	// Auth
	rootCmd.Flags().StringVar(&basicUser, "basic-user", "", "HTTP Basic Auth username")
	rootCmd.Flags().StringVar(&basicPass, "basic-pass", "",
		"HTTP Basic Auth password (prefer --basic-pass-file or $SIP_PASSWORD)")
	rootCmd.Flags().StringVar(&basicPassFile, "basic-pass-file", "",
		"Read basic auth password from file (precedence: file > env > flag)")

	// Limits
	rootCmd.Flags().IntVar(&maxConns, "max-conns", 0, "Concurrent session limit (0 = unlimited)")
	rootCmd.Flags().DurationVar(&idleTimeout, "idle-timeout", 0,
		"Close sessions with no inbound bytes for this duration (0 = disabled)")

	// Renderer / fonts
	rootCmd.Flags().StringVar(&fontPath, "font", "",
		"Custom font file (.ttf/.otf/.woff/.woff2) served at /static/fonts/custom*")
	rootCmd.Flags().StringVar(&fontFamily, "font-family", "",
		"CSS font-family for the terminal (overrides default JetBrains Mono Nerd Font)")
	rootCmd.Flags().BoolVar(&enableKitty, "enable-kitty-transcoder", false,
		"Force the server-side kitty graphics PNG → RGBA transcoder (client decodes PNG by default)")

	// Misc
	rootCmd.Flags().BoolVar(&debug, "debug", false, "Enable debug logging")
	rootCmd.Flags().StringVarP(&workDir, "dir", "d", "", "Working directory for the command")

	if err := fang.Execute(
		context.Background(),
		rootCmd,
		fang.WithVersion(fmt.Sprintf("%s\nCommit: %s\nBuilt: %s\nBy: %s", version, commit, date, builtBy)),
	); err != nil {
		os.Exit(1)
	}
}

func runServer(cmdArgs []string) error {
	if debug {
		sip.SetLogLevel(log.DebugLevel)
	}

	wd := workDir
	if wd == "" {
		var err error
		wd, err = os.Getwd()
		if err != nil {
			return fmt.Errorf("getting working directory: %w", err)
		}
	}

	// Resolve basic auth password: file > env > flag.
	password := basicPass
	if envPass := os.Getenv("SIP_PASSWORD"); envPass != "" {
		password = envPass
	}
	if basicPassFile != "" {
		data, err := os.ReadFile(basicPassFile)
		if err != nil {
			return fmt.Errorf("read basic-pass-file: %w", err)
		}
		password = strings.TrimRight(string(data), "\r\n")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	config := sip.Config{
		Host:                  host,
		Port:                  port,
		Debug:                 debug,
		TLSCert:               certFile,
		TLSKey:                keyFile,
		BasicUsername:         basicUser,
		BasicPassword:         password,
		AllowInsecureNoTLS:    allowInsecureNoTLS,
		OriginPatterns:        originPatterns,
		MaxConnections:        maxConns,
		IdleTimeout:           idleTimeout,
		FontPath:              fontPath,
		FontFamily:            fontFamily,
		EnableKittyTranscoder: enableKitty,
	}

	server := sip.NewServer(config)

	scheme := "http"
	if certFile != "" {
		scheme = "https"
	}
	fmt.Printf("Starting server at %s://%s:%s\n", scheme, host, port)
	fmt.Printf("Running: %s\n", strings.Join(cmdArgs, " "))

	return server.ServeCommand(ctx, cmdArgs[0], cmdArgs[1:], wd)
}
