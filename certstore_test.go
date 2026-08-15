package sip

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestLoadManagedCertMissing(t *testing.T) {
	// Absent is a normal state and callers branch on it, so it has to be
	// distinguishable from a real failure.
	_, err := LoadManagedCert(t.TempDir())
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("want an fs.ErrNotExist, got %v", err)
	}
}

func TestCreateManagedCertWritesUsableKeypair(t *testing.T) {
	dir := t.TempDir()
	cert, err := CreateManagedCert(CertOptions{Dir: dir, BindHost: "192.0.2.10"})
	if err != nil {
		t.Fatal(err)
	}

	pair, err := tls.LoadX509KeyPair(cert.CertFile, cert.KeyFile)
	if err != nil {
		t.Fatalf("the generated keypair does not load: %v", err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if !leaf.IsCA {
		t.Error("want a CA certificate: Android and iOS only offer to install one that is")
	}
	// The SAN is the whole point. A certificate that does not sign for the
	// address the user types fails with a name mismatch the browser does
	// not offer to click through.
	if err := leaf.VerifyHostname("192.0.2.10"); err != nil {
		t.Errorf("bind host is not covered: %v", err)
	}
	if err := leaf.VerifyHostname("localhost"); err != nil {
		t.Errorf("localhost is not covered: %v", err)
	}
	if err := leaf.VerifyHostname("127.0.0.1"); err != nil {
		t.Errorf("loopback is not covered: %v", err)
	}
	if got := cert.NotAfter.Sub(cert.NotBefore); got < DefaultCertValidity {
		t.Errorf("validity = %v, want at least %v", got, DefaultCertValidity)
	}
	if len(cert.Fingerprint) != 32*3-1 || !strings.Contains(cert.Fingerprint, ":") {
		t.Errorf("fingerprint %q is not the colon-separated form a browser shows", cert.Fingerprint)
	}
}

func TestCreateManagedCertKeyIsPrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX modes are not meaningful here")
	}
	dir := filepath.Join(t.TempDir(), "nested")
	cert, err := CreateManagedCert(CertOptions{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(cert.KeyFile)
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Errorf("key mode = %o, want 600", perm)
	}
	di, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if perm := di.Mode().Perm(); perm != 0o700 {
		t.Errorf("cert dir mode = %o, want 700", perm)
	}
}

func TestManagedCertRoundTrip(t *testing.T) {
	dir := t.TempDir()
	created, err := CreateManagedCert(CertOptions{Dir: dir, Hosts: []string{"sip.example", "198.51.100.7"}})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadManagedCert(dir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Fingerprint != created.Fingerprint {
		t.Errorf("fingerprint changed across a reload: %q vs %q", loaded.Fingerprint, created.Fingerprint)
	}
	if !loaded.Covers("sip.example") || !loaded.Covers("198.51.100.7") {
		t.Errorf("extra hosts missing from the SAN: dns=%v ips=%v", loaded.DNSNames, loaded.IPs)
	}
	if loaded.Covers("elsewhere.example") {
		t.Error("Covers said yes to a name that is not in the SAN")
	}
	if loaded.Expired() {
		t.Error("a certificate generated a moment ago reports as expired")
	}
}

func TestEnsureManagedCertReusesThenRegenerates(t *testing.T) {
	dir := t.TempDir()
	first, created, err := EnsureManagedCert(CertOptions{Dir: dir, BindHost: "192.0.2.10"})
	if err != nil || !created {
		t.Fatalf("first call: created=%v err=%v", created, err)
	}
	same, created, err := EnsureManagedCert(CertOptions{Dir: dir, BindHost: "192.0.2.10"})
	if err != nil {
		t.Fatal(err)
	}
	if created || same.Fingerprint != first.Fingerprint {
		t.Error("a usable certificate was regenerated instead of reused")
	}

	// A DHCP lease that moved is the common way a working certificate
	// stops working, and it surfaces as a name mismatch with no hint that
	// regenerating is the fix. So the address being bound is checked.
	moved, created, err := EnsureManagedCert(CertOptions{Dir: dir, BindHost: "198.51.100.4"})
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("a certificate that does not cover the bind address was reused")
	}
	if !moved.Covers("198.51.100.4") {
		t.Error("the regenerated certificate still does not cover the bind address")
	}
}

func TestRemoveManagedCertIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	if _, err := CreateManagedCert(CertOptions{Dir: dir}); err != nil {
		t.Fatal(err)
	}
	if err := RemoveManagedCert(dir); err != nil {
		t.Fatal(err)
	}
	if err := RemoveManagedCert(dir); err != nil {
		t.Fatalf("removing what is already gone is not a failure: %v", err)
	}
	if _, err := LoadManagedCert(dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("want gone, got %v", err)
	}
}

func TestCertSANsSkipsUnspecifiedAndLinkLocal(t *testing.T) {
	dns, ips := certSANs("0.0.0.0", []string{"::", "phone.lan"})
	for _, ip := range ips {
		if ip.IsUnspecified() {
			t.Errorf("0.0.0.0 / :: reached the SAN as %v", ip)
		}
		if ip.IsLinkLocalUnicast() {
			t.Errorf("link-local %v reached the SAN; it needs a zone index to be reachable", ip)
		}
	}
	var found bool
	for _, n := range dns {
		if n == "phone.lan" {
			found = true
		}
	}
	if !found {
		t.Errorf("caller-supplied name missing from %v", dns)
	}
	if !containsIP(ips, net.ParseIP("127.0.0.1")) || !containsIP(ips, net.ParseIP("::1")) {
		t.Errorf("loopback missing from %v", ips)
	}
}

func containsIP(list []net.IP, want net.IP) bool {
	for _, ip := range list {
		if ip.Equal(want) {
			return true
		}
	}
	return false
}

func TestAutoTLSSatisfiesTheNonLoopbackRefusal(t *testing.T) {
	dir := t.TempDir()

	// Without it, the refusal stands and points at the way out.
	bare := &httpServer{config: Config{Host: "192.0.2.10", Port: "7681"}}
	err := bare.validateConfig()
	if err == nil {
		t.Fatal("a non-loopback bind without TLS was accepted")
	}
	if !strings.Contains(err.Error(), "AutoTLS") {
		t.Errorf("the refusal does not name the remedy: %v", err)
	}

	// With it, the bind is allowed because it now has TLS, not because
	// the check was skipped.
	s := &httpServer{config: Config{Host: "192.0.2.10", Port: "7681", AutoTLS: true, CertDir: dir}}
	if err := s.resolveAutoTLS(); err != nil {
		t.Fatal(err)
	}
	if !s.mainTLSEnabled() {
		t.Fatal("AutoTLS did not produce a keypair")
	}
	if err := s.validateConfig(); err != nil {
		t.Fatalf("validateConfig still refuses with TLS in place: %v", err)
	}
	if s.config.AllowInsecureNoTLS {
		t.Error("AutoTLS must never set the insecure escape hatch")
	}
}

func TestAutoTLSDefersToAnExplicitKeypair(t *testing.T) {
	dir := t.TempDir()
	cert, err := CreateManagedCert(CertOptions{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	s := &httpServer{config: Config{
		Host: "192.0.2.10", AutoTLS: true, CertDir: other,
		TLSCert: cert.CertFile, TLSKey: cert.KeyFile,
	}}
	if err := s.resolveAutoTLS(); err != nil {
		t.Fatal(err)
	}
	if s.config.TLSCert != cert.CertFile {
		t.Errorf("AutoTLS overwrote an explicit --cert: %q", s.config.TLSCert)
	}
	if _, err := os.Stat(filepath.Join(other, certFileName)); !os.IsNotExist(err) {
		t.Error("AutoTLS generated a certificate it had no use for")
	}
}

func TestManagedCertExpiry(t *testing.T) {
	dir := t.TempDir()
	cert, err := CreateManagedCert(CertOptions{Dir: dir, Validity: 2 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if cert.Expired() {
		t.Error("a fresh certificate reports as expired")
	}
	if !cert.ExpiresWithin(24 * time.Hour) {
		t.Error("a two-hour certificate does not report as expiring within a day")
	}
	if cert.ExpiresWithin(time.Minute) {
		t.Error("a two-hour certificate reports as expiring within a minute")
	}
}
