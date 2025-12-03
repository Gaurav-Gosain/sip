// Command sip wraps any CLI command and exposes it through a web browser.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

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
	host    string
	port    string
	debug   bool
	workDir string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "sip [flags] -- command [args...]",
		Short: "Serve CLI commands through the browser",
		Long: `sip - Serve CLI commands through the browser

Wraps any CLI command and exposes it through a web browser with full
terminal emulation. Uses xterm.js for rendering and supports WebSocket
connections.

The command to run must be specified after "--".`,
		Example: `  # Run htop in browser
  sip -- htop

  # Run on custom port
  sip -p 8080 -- claude -c

  # Bind to all interfaces
  sip --host 0.0.0.0 -- bash

  # Run with debug logging
  sip --debug -- nvim`,
		Version:      version,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Args after "--" are passed as args
			if len(args) == 0 {
				return fmt.Errorf("no command specified\n\nUsage: sip [flags] -- command [args...]")
			}
			return runServer(args)
		},
	}

	// Flags
	rootCmd.Flags().StringVarP(&host, "host", "H", "localhost", "Host to bind to")
	rootCmd.Flags().StringVarP(&port, "port", "p", "7681", "Port to listen on")
	rootCmd.Flags().BoolVar(&debug, "debug", false, "Enable debug logging")
	rootCmd.Flags().StringVarP(&workDir, "dir", "d", "", "Working directory for the command")

	// Execute with fang
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

	// Set up working directory
	wd := workDir
	if wd == "" {
		var err error
		wd, err = os.Getwd()
		if err != nil {
			return fmt.Errorf("getting working directory: %w", err)
		}
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	config := sip.Config{
		Host:  host,
		Port:  port,
		Debug: debug,
	}

	server := sip.NewServer(config)

	fmt.Printf("Starting server at http://%s:%s\n", host, port)
	fmt.Printf("Running: %s\n", strings.Join(cmdArgs, " "))

	return server.ServeCommand(ctx, cmdArgs[0], cmdArgs[1:], wd)
}
