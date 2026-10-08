// Command sip wraps any CLI command and exposes it through a web browser.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"runtime"
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
	rendererChoice     string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "sip [flags] -- command [args...]",
		Short: "Serve CLI commands through the browser",
		Long: `sip - Serve CLI commands through the browser

Wraps any CLI command and exposes it through a web browser with full
terminal emulation. Renders with xterm.js (WebGL, canvas or DOM),
draws kitty graphics through a repositionable overlay, and speaks
WebSocket or WebTransport (HTTP/3 over QUIC).

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
	rootCmd.Flags().BoolVar(&autoTLS, "auto-tls", false,
		"Serve HTTPS from a self-signed certificate sip generates and manages (see `sip cert`)")
	rootCmd.PersistentFlags().StringVar(&certDir, "cert-dir", "",
		"Where --auto-tls keeps its keypair (default: sip's directory in your user config dir)")
	rootCmd.PersistentFlags().StringSliceVar(&certHosts, "cert-host", nil,
		"Extra DNS name or IP for the --auto-tls certificate (repeatable)")
	rootCmd.PersistentFlags().IntVar(&certDays, "cert-days", 0,
		"Days an --auto-tls certificate is valid for (0 = 365; under 14 also keeps Chrome's WebTransport path)")
	rootCmd.Flags().StringSliceVar(&originPatterns, "origin", nil,
		"Browser origin allowlist (path.Match glob, repeatable)")

	// Auth
	rootCmd.Flags().StringVar(&basicUser, "basic-user", "", "HTTP Basic Auth username")
	rootCmd.Flags().StringVar(&basicPass, "basic-pass", "",
		"HTTP Basic Auth password (prefer --basic-pass-file or $SIP_PASSWORD)")
	rootCmd.Flags().StringVar(&basicPassFile, "basic-pass-file", "",
		"Read the basic auth password from a file other users cannot read (precedence: file > env > flag)")

	// Limits
	rootCmd.Flags().IntVar(&maxConns, "max-conns", 0, "Concurrent session limit (0 = unlimited)")
	rootCmd.Flags().DurationVar(&idleTimeout, "idle-timeout", 0,
		"Close sessions with no inbound bytes for this duration (0 = disabled)")

	// Renderer / fonts
	rootCmd.Flags().StringVar(&fontPath, "font", "",
		"Custom font file (.ttf/.otf/.woff/.woff2) served at /static/fonts/custom*")
	rootCmd.Flags().StringVar(&fontFamily, "font-family", "",
		"CSS font-family for the terminal (overrides default JetBrains Mono Nerd Font)")
	rootCmd.Flags().StringVar(&rendererChoice, "renderer", "",
		"Client terminal renderer: \"webgl\", \"canvas\", \"dom\", or empty to prefer WebGL and fall back")
	rootCmd.Flags().BoolVar(&enableKitty, "enable-kitty-transcoder", false,
		"Force the server-side kitty graphics PNG → RGBA transcoder (client decodes PNG by default)")

	// Misc
	rootCmd.Flags().BoolVar(&debug, "debug", false, "Enable debug logging")
	rootCmd.Flags().StringVarP(&workDir, "dir", "d", "", "Working directory for the command")

	rootCmd.AddCommand(newCertCmd())

	if err := fang.Execute(
		context.Background(),
		rootCmd,
		fang.WithVersion(fmt.Sprintf("%s\nCommit: %s\nBuilt: %s\nBy: %s", version, commit, date, builtBy)),
	); err != nil {
		os.Exit(1)
	}
}

// passwordEnv names the environment variable that can carry the password.
const passwordEnv = "SIP_PASSWORD"

// resolvePassword picks the Basic Auth password: the file, then the
// environment, then the flag.
//
// The variable is removed once read. The wrapped command inherits sip's
// environment, so a password left in it reaches the program in the browser.
// The file must not be readable by other users, because the point of a file
// is that ps and /proc do not show it.
func resolvePassword(flagValue, file string) (string, error) {
	chosen := flagValue
	if fromEnv, ok := os.LookupEnv(passwordEnv); ok {
		if err := os.Unsetenv(passwordEnv); err != nil {
			return "", fmt.Errorf("cannot remove %s from the environment: %w", passwordEnv, err)
		}
		if fromEnv != "" {
			chosen = fromEnv
		}
	}
	if file == "" {
		return chosen, nil
	}
	info, err := os.Stat(file)
	if err != nil {
		return "", fmt.Errorf("read basic-pass-file: %w", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o007 != 0 {
		return "", fmt.Errorf("other users can read the password file %s. Run 'chmod 600 %s', then start sip again", file, file)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", fmt.Errorf("read basic-pass-file: %w", err)
	}
	return strings.TrimRight(string(data), "\r\n"), nil
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

	authSecret, err := resolvePassword(basicPass, basicPassFile)
	if err != nil {
		return err
	}

	// Before the server refuses the bind, since the whole point is to offer
	// the way out while there is still someone there to take it.
	maybeOfferTLS()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	config := sip.Config{
		Host:                  host,
		Port:                  port,
		Debug:                 debug,
		TLSCert:               certFile,
		TLSKey:                keyFile,
		AutoTLS:               autoTLS,
		CertDir:               certDir,
		CertHosts:             certHosts,
		CertValidity:          certValidity(),
		BasicUsername:         basicUser,
		BasicPassword:         authSecret,
		AllowInsecureNoTLS:    allowInsecureNoTLS,
		OriginPatterns:        originPatterns,
		MaxConnections:        maxConns,
		IdleTimeout:           idleTimeout,
		FontPath:              fontPath,
		FontFamily:            fontFamily,
		Renderer:              rendererChoice,
		EnableKittyTranscoder: enableKitty,
	}

	server := sip.NewServer(config)

	scheme := "http"
	if certFile != "" || autoTLS {
		scheme = "https"
	}
	fmt.Printf("Starting server at %s://%s:%s\n", scheme, host, port)
	fmt.Printf("Running: %s\n", strings.Join(cmdArgs, " "))

	return server.ServeCommand(ctx, cmdArgs[0], cmdArgs[1:], wd)
}
