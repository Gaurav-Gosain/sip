package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/Gaurav-Gosain/sip"
	"github.com/charmbracelet/x/term"
	"github.com/spf13/cobra"
)

var (
	certDir     string
	certHosts   []string
	certDays    int
	autoTLS     bool
	certForce   bool
	certKeyPath bool
)

// certValidity turns the --cert-days flag into a duration, with 0 meaning
// sip's default.
func certValidity() time.Duration {
	if certDays <= 0 {
		return 0
	}
	return time.Duration(certDays) * 24 * time.Hour
}

func newCertCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cert",
		Short: "Manage sip's self-signed TLS certificate",
		Long: `Manage the self-signed TLS certificate sip keeps for this user.

A non-loopback bind requires TLS, and this is the certificate for it when you
do not have one from anywhere else. It signs for itself, so browsers show a
warning on the first visit; ` + "`sip cert info`" + ` says what the warning looks like and
how to stop seeing it.

With no subcommand this prints the certificate's status.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCertInfo(cmd.OutOrStdout())
		},
	}

	info := &cobra.Command{
		Use:     "info",
		Aliases: []string{"status", "show"},
		Short:   "Where the certificate is, what it covers, when it expires",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCertInfo(cmd.OutOrStdout())
		},
	}

	newCmd := &cobra.Command{
		Use:     "new",
		Aliases: []string{"create", "regenerate"},
		Short:   "Generate a certificate, replacing any existing one",
		Long: `Generate a self-signed certificate and key.

The certificate covers localhost, this machine's hostname and hostname.local,
and every non-loopback address on every interface, so it keeps working for the
LAN address a phone actually types. Add more with --cert-host.

Regenerating invalidates what any device has already been told to trust: every
browser that accepted the old certificate asks again.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCertNew(cmd.OutOrStdout())
		},
	}

	rm := &cobra.Command{
		Use:     "rm",
		Aliases: []string{"remove", "delete"},
		Short:   "Delete the certificate and key",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCertRemove(cmd.OutOrStdout())
		},
	}

	pathCmd := &cobra.Command{
		Use:   "path",
		Short: "Print the certificate's path and nothing else",
		Long: `Print the certificate's path, for a script or a unit file.

--key prints the private key's path instead. It is not printed anywhere else,
including by ` + "`sip cert info`" + `: sip's whole job is putting a terminal on a screen
that may be shared or recorded, and a private key's location is not something
to volunteer into that. Ask for it and you get it.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			certFile, keyFile, err := sip.CertPaths(certDir)
			if err != nil {
				return err
			}
			if certKeyPath {
				fmt.Fprintln(cmd.OutOrStdout(), keyFile)
				return nil
			}
			fmt.Fprintln(cmd.OutOrStdout(), certFile)
			return nil
		},
	}
	pathCmd.Flags().BoolVar(&certKeyPath, "key", false, "Print the private key's path instead")

	newCmd.Flags().BoolVarP(&certForce, "force", "f", false, "Replace an existing certificate without asking")
	rm.Flags().BoolVarP(&certForce, "force", "f", false, "Delete without asking")

	cmd.AddCommand(info, newCmd, rm, pathCmd)
	return cmd
}

func runCertInfo(w io.Writer) error {
	cert, err := sip.LoadManagedCert(certDir)
	if os.IsNotExist(err) {
		dir, dirErr := sip.DefaultCertDir()
		if certDir != "" {
			dir, dirErr = certDir, nil
		}
		if dirErr != nil {
			return dirErr
		}
		fmt.Fprintf(w, "No certificate yet.\n\n  Would live in: %s\n  Generate one:  sip cert new\n", dir)
		return nil
	}
	if err != nil {
		return err
	}
	printCertSummary(w, cert)
	return nil
}

func runCertNew(w io.Writer) error {
	if existing, err := sip.LoadManagedCert(certDir); err == nil && !certForce {
		// Refusing rather than defaulting either way. A script that reaches
		// here asked for something that would throw away trust every device
		// has already granted, and the answer to an ambiguous instruction
		// is to stop, not to guess.
		if !interactive() {
			return fmt.Errorf("a certificate already exists (valid until %s); pass --force to replace it",
				existing.NotAfter.Format("2006-01-02"))
		}
		fmt.Fprintf(w, "A certificate is already there, valid until %s.\n",
			existing.NotAfter.Format("2006-01-02"))
		fmt.Fprintln(w, "Replacing it means every device that trusted it asks again.")
		if !confirm("Replace it?", false) {
			fmt.Fprintln(w, "Left alone.")
			return nil
		}
	}
	cert, err := sip.CreateManagedCert(sip.CertOptions{
		Dir:      certDir,
		Hosts:    certHosts,
		BindHost: host,
		Validity: certValidity(),
	})
	if err != nil {
		return err
	}
	fmt.Fprintln(w, "Generated a certificate.")
	fmt.Fprintln(w)
	printCertSummary(w, cert)
	return nil
}

func runCertRemove(w io.Writer) error {
	if _, err := sip.LoadManagedCert(certDir); os.IsNotExist(err) {
		fmt.Fprintln(w, "There is no certificate to remove.")
		return nil
	}
	if !certForce {
		if !interactive() {
			return fmt.Errorf("pass --force to delete the certificate without being asked")
		}
		if !confirm("Delete the certificate and its key?", false) {
			fmt.Fprintln(w, "Left alone.")
			return nil
		}
	}
	if err := sip.RemoveManagedCert(certDir); err != nil {
		return err
	}
	fmt.Fprintln(w, "Removed. `sip cert new` makes another one.")
	return nil
}

// printCertSummary says everything a user needs in order to use the
// certificate and nothing that helps anyone attack it. The private key's path
// is deliberately absent; see the `sip cert path --key` help.
func printCertSummary(w io.Writer, cert *sip.ManagedCert) {
	fmt.Fprintf(w, "  Certificate: %s\n", cert.CertFile)
	fmt.Fprintf(w, "  Private key: sip.key beside it, readable only by you (0600)\n")
	fmt.Fprintf(w, "  Valid until: %s", cert.NotAfter.Format("2006-01-02 15:04 MST"))
	switch {
	case cert.Expired():
		fmt.Fprint(w, "  (EXPIRED: run `sip cert new`)")
	case cert.ExpiresWithin(14 * 24 * time.Hour):
		fmt.Fprint(w, "  (expiring soon)")
	}
	fmt.Fprintln(w)
	fmt.Fprintf(w, "  Fingerprint: SHA-256 %s\n", cert.Fingerprint)
	fmt.Fprintf(w, "  Covers:      %s\n", strings.Join(append(append([]string{}, cert.DNSNames...), cert.IPs...), ", "))
	fmt.Fprintln(w)
	fmt.Fprintln(w, sip.SelfSignedWarning)
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Serve with it:  sip --host <address> --auto-tls -- bash")
}

// maybeOfferTLS is the friendly half of the TLS requirement.
//
// The refusal it stands in front of is correct and stays: this only asks
// whether to satisfy it, and the one thing it will not offer is turning the
// requirement off. It answers no on its own whenever stdin or stderr is not a
// terminal, which is every script, cron job, container and systemd unit, so
// what those get is the refusal they got before, with a message naming the
// flag. Nothing here blocks waiting for an answer that cannot arrive.
func maybeOfferTLS() {
	if autoTLS || certFile != "" || allowInsecureNoTLS || isLoopbackBind(host) {
		return
	}
	if !interactive() {
		return
	}
	fmt.Fprintf(os.Stderr, "\n%s is reachable from other devices, so sip requires TLS for it.\n", host)
	fmt.Fprintln(os.Stderr, "Without it the terminal and everything typed into it crosses the network in the clear.")
	fmt.Fprintln(os.Stderr, "\nsip can generate a self-signed certificate and serve HTTPS from it. Browsers show")
	fmt.Fprintln(os.Stderr, "a warning on the first visit, which is expected; sip prints what to do about it.")
	if !confirm("Generate a certificate and continue over HTTPS?", true) {
		fmt.Fprintln(os.Stderr, "\nNot generating one. To run anyway, pass your own with --cert/--key,")
		fmt.Fprintln(os.Stderr, "or --allow-insecure-no-tls to serve in cleartext (insecure).")
		return
	}
	autoTLS = true
}

// interactive reports whether there is a person on the other end. Both ends
// are checked: a prompt written to a redirected stderr is a prompt nobody
// sees, waiting on an answer nobody knows to give.
func interactive() bool {
	return term.IsTerminal(os.Stdin.Fd()) && term.IsTerminal(os.Stderr.Fd())
}

// confirm asks a yes/no question on stderr, and answers it itself with the
// default when there is nobody to ask.
func confirm(question string, defaultYes bool) bool {
	if !interactive() {
		return defaultYes
	}
	hint := "[y/N]"
	if defaultYes {
		hint = "[Y/n]"
	}
	fmt.Fprintf(os.Stderr, "\n%s %s ", question, hint)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return defaultYes
	}
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	case "n", "no":
		return false
	default:
		return defaultYes
	}
}

// isLoopbackBind mirrors the server's own test so the CLI knows whether the
// bind about to happen is one that requires TLS.
func isLoopbackBind(h string) bool {
	if h == "" || h == "localhost" {
		return true
	}
	if parsed, _, err := net.SplitHostPort(h); err == nil {
		h = parsed
	}
	ip := net.ParseIP(strings.Trim(h, "[]"))
	return ip != nil && ip.IsLoopback()
}
