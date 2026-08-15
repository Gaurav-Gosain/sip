package sip

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The managed keypair's file names inside the cert directory.
const (
	certFileName = "sip.crt"
	keyFileName  = "sip.key"
)

// DefaultCertValidity is how long a managed certificate is good for.
//
// A year, because the cost of a self-signed certificate is not generating it,
// it is walking to every phone and accepting the browser warning again. A
// shorter life would spend that cost repeatedly for no gain: nothing revokes
// these and nothing consults a CRL.
//
// One thing does care about the length. Chrome accepts a WebTransport
// serverCertificateHashes handshake only for certificates valid under 14 days,
// which is why the ephemeral loopback certificate in cert.go is 10 days. A
// managed certificate is served over HTTPS to a browser that has been told to
// trust it, so it trades that path (WebTransport falls back to WebSocket over
// the same TLS) for not expiring every fortnight. Pass a shorter Validity to
// get it back.
const DefaultCertValidity = 365 * 24 * time.Hour

// CertOptions configures a managed certificate.
type CertOptions struct {
	// Dir is the directory holding the keypair. Empty means DefaultCertDir.
	Dir string

	// Hosts are extra DNS names and IP addresses to put in the SAN, on top
	// of the ones discovered from the machine. A name that parses as an IP
	// becomes an IP SAN; everything else becomes a DNS SAN.
	Hosts []string

	// BindHost is the address the server will listen on, if known. It is
	// covered by the SAN even when it is not an address of this machine
	// (a name resolved by a router's DNS, say).
	BindHost string

	// Validity is how long the certificate lasts. 0 means
	// DefaultCertValidity.
	Validity time.Duration
}

// ManagedCert describes the keypair sip keeps for a deployment: where it is,
// what it covers and how long it lasts.
type ManagedCert struct {
	// CertFile and KeyFile are the PEM paths. KeyFile is 0600.
	CertFile string
	KeyFile  string

	// DNSNames and IPs are the subject alternative names. A browser
	// rejects the certificate outright for an address that is in neither,
	// whatever the user has agreed to trust.
	DNSNames []string
	IPs      []string

	NotBefore time.Time
	NotAfter  time.Time

	// Fingerprint is the SHA-256 of the DER, colon-separated and upper
	// case: the same form browsers show in their certificate viewer, so a
	// suspicious user can compare the two.
	Fingerprint string
}

// Expired reports whether the certificate is outside its validity window.
func (c *ManagedCert) Expired() bool {
	now := time.Now()
	return now.Before(c.NotBefore) || now.After(c.NotAfter)
}

// ExpiresWithin reports whether the certificate runs out inside d.
func (c *ManagedCert) ExpiresWithin(d time.Duration) bool {
	return time.Now().Add(d).After(c.NotAfter)
}

// Covers reports whether host is in the certificate's SAN. A browser will
// refuse the connection when it is not, so this is what a caller checks before
// telling a user to point a phone at an address.
func (c *ManagedCert) Covers(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		for _, s := range c.IPs {
			if other := net.ParseIP(s); other != nil && other.Equal(ip) {
				return true
			}
		}
		return false
	}
	for _, n := range c.DNSNames {
		if strings.EqualFold(n, host) {
			return true
		}
	}
	return false
}

// SelfSignedWarning is what a user is going to see in the browser, said before
// they see it.
//
// Nobody reads a warning they were not warned about: an unexplained "Your
// connection is not private" on a tool that just told them everything worked
// reads as the tool being broken, and the next move is either giving up or
// turning TLS off for good. Both are worse than the warning.
const SelfSignedWarning = `This certificate signs for itself, so no browser trusts it yet.
The first visit shows a warning ("Your connection is not private",
NET::ERR_CERT_AUTHORITY_INVALID, or "Potential Security Risk Ahead").
That is expected. Choose Advanced and then Proceed / Accept the Risk.
The connection is encrypted either way; what the browser cannot do is
vouch for who is on the other end.

To lose the warning for good, copy the .crt to the device and install it
as a trusted certificate (Android: Settings, Encryption & credentials,
Install a certificate, CA certificate. iOS: open the file, install the
profile, then enable it under About, Certificate Trust Settings).`

// DefaultCertDir is where sip keeps a managed keypair: a "sip" directory
// inside the user's config directory ($XDG_CONFIG_HOME/sip on Linux,
// ~/Library/Application Support/sip on macOS, %AppData%\sip on Windows).
func DefaultCertDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate user config dir: %w", err)
	}
	return filepath.Join(base, "sip"), nil
}

// certDirOrDefault resolves an explicit directory, falling back to
// DefaultCertDir when it is empty.
func certDirOrDefault(dir string) (string, error) {
	if dir != "" {
		return dir, nil
	}
	return DefaultCertDir()
}

// CertPaths reports where the managed keypair lives without touching the
// filesystem, for a caller that wants to name the paths in a config file or a
// unit file before anything has been generated.
func CertPaths(dir string) (certFile, keyFile string, err error) {
	d, err := certDirOrDefault(dir)
	if err != nil {
		return "", "", err
	}
	return filepath.Join(d, certFileName), filepath.Join(d, keyFileName), nil
}

// LoadManagedCert reads the managed certificate's metadata. It returns an
// error wrapping fs.ErrNotExist when there is none, which is a normal state
// and not a failure: callers test it with errors.Is.
func LoadManagedCert(dir string) (*ManagedCert, error) {
	certFile, keyFile, err := CertPaths(dir)
	if err != nil {
		return nil, err
	}
	pemBytes, err := os.ReadFile(certFile)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(keyFile); err != nil {
		return nil, fmt.Errorf("certificate %s has no key beside it: %w", certFile, err)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("%s is not a PEM certificate", certFile)
	}
	parsed, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", certFile, err)
	}
	ips := make([]string, 0, len(parsed.IPAddresses))
	for _, ip := range parsed.IPAddresses {
		ips = append(ips, ip.String())
	}
	return &ManagedCert{
		CertFile:    certFile,
		KeyFile:     keyFile,
		DNSNames:    parsed.DNSNames,
		IPs:         ips,
		NotBefore:   parsed.NotBefore,
		NotAfter:    parsed.NotAfter,
		Fingerprint: fingerprint(block.Bytes),
	}, nil
}

// CreateManagedCert generates a keypair and writes it to the cert directory,
// replacing whatever was there. The key is written 0600 inside a 0700
// directory.
func CreateManagedCert(opts CertOptions) (*ManagedCert, error) {
	dir, err := certDirOrDefault(opts.Dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create cert dir: %w", err)
	}

	validity := opts.Validity
	if validity <= 0 {
		validity = DefaultCertValidity
	}
	dnsNames, ips := certSANs(opts.BindHost, opts.Hosts)

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, err
	}

	notBefore := time.Now().Add(-time.Hour) // clock skew between this box and a phone
	notAfter := notBefore.Add(validity)
	template := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "sip", Organization: []string{"sip self-signed"}},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		DNSNames:     dnsNames,
		IPAddresses:  ips,
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		// A self-signed leaf can be trusted per-site on a desktop, but
		// Android and iOS only offer to install a certificate that is a
		// CA, and installing it is the one route that removes the
		// warning on a phone for good.
		IsCA:                  true,
		BasicConstraintsValid: true,
	}

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return nil, fmt.Errorf("create certificate: %w", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("marshal private key: %w", err)
	}

	certFile := filepath.Join(dir, certFileName)
	keyFile := filepath.Join(dir, keyFileName)
	// The key goes down first and at 0600 from the moment it exists: a
	// create-then-chmod leaves a window in which anyone on the box can read
	// it, and on a multi-user machine that window is the whole attack.
	if err := writeFileAtomic(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return nil, fmt.Errorf("write key: %w", err)
	}
	if err := writeFileAtomic(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return nil, fmt.Errorf("write certificate: %w", err)
	}

	ipStrings := make([]string, 0, len(ips))
	for _, ip := range ips {
		ipStrings = append(ipStrings, ip.String())
	}
	return &ManagedCert{
		CertFile:    certFile,
		KeyFile:     keyFile,
		DNSNames:    dnsNames,
		IPs:         ipStrings,
		NotBefore:   notBefore,
		NotAfter:    notAfter,
		Fingerprint: fingerprint(der),
	}, nil
}

// EnsureManagedCert returns the existing managed certificate, generating one
// when there is none, when it has expired, or when it does not cover the
// address the server is about to bind. It reports whether it generated one, so
// a caller can say so and show the browser warning only when it is news.
func EnsureManagedCert(opts CertOptions) (cert *ManagedCert, created bool, err error) {
	existing, err := LoadManagedCert(opts.Dir)
	switch {
	case err == nil && !existing.Expired() && certCoversBind(existing, opts):
		return existing, false, nil
	case err != nil && !os.IsNotExist(err):
		// A certificate that is there but unreadable is not something to
		// paper over by overwriting it: it may be a keypair the user put
		// there by hand.
		return nil, false, err
	}
	cert, err = CreateManagedCert(opts)
	if err != nil {
		return nil, false, err
	}
	return cert, true, nil
}

// RemoveManagedCert deletes the managed keypair. Missing files are not an
// error: the postcondition is that there is no managed certificate.
func RemoveManagedCert(dir string) error {
	certFile, keyFile, err := CertPaths(dir)
	if err != nil {
		return err
	}
	for _, p := range []string{keyFile, certFile} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", filepath.Base(p), err)
		}
	}
	return nil
}

// certCoversBind reports whether an existing certificate is usable for the
// address this server is about to bind and for every host the caller asked
// for. A DHCP lease that moved is the common way a working certificate stops
// working, and it fails in the browser as a name mismatch with no hint that
// regenerating is the fix.
func certCoversBind(c *ManagedCert, opts CertOptions) bool {
	for _, h := range opts.Hosts {
		if !c.Covers(h) {
			return false
		}
	}
	host := opts.BindHost
	if host == "" || isUnspecifiedHost(host) {
		// Bound to everything, so the address a phone types is any of
		// this machine's. Requiring all of them would regenerate on
		// every VPN or docker interface appearing, so this checks the
		// ones a user could plausibly type: the routable ones.
		for _, ip := range localIPs() {
			if !c.Covers(ip.String()) {
				return false
			}
		}
		return true
	}
	return c.Covers(host)
}

// certSANs works out what the certificate has to sign for.
//
// Getting this wrong is the failure mode that looks like sip is broken: the
// user follows the instructions, generates a certificate, types
// https://192.168.1.42:7681 on their phone and the browser refuses with a name
// mismatch, which is not a warning it offers to click through. So the SAN
// covers every address the machine can plausibly be reached at rather than the
// one it happens to be bound to:
//
//   - localhost and the loopback addresses, so the same certificate works when
//     testing on the machine itself;
//   - every non-loopback address on every interface, because that is the LAN
//     address a phone types, and the user finds it with `ip addr` rather than
//     from sip;
//   - the machine's hostname and hostname.local, which is what mDNS (Avahi,
//     Bonjour) answers for on a home network;
//   - whatever the caller passed, for a name only the router's DNS knows.
//
// IPv6 link-local addresses are left out. They need a zone index (%wlan0) that
// is meaningless on the other device, so nobody reaches a server that way.
//
// The cost is that the certificate lists the machine's interface addresses to
// anyone who connects. On a LAN development tool that is not worth a name
// mismatch on the address the user actually typed.
func certSANs(bindHost string, extra []string) (dnsNames []string, ips []net.IP) {
	dnsSet := map[string]bool{}
	ipSet := map[string]net.IP{}

	addHost := func(h string) {
		h = strings.TrimSpace(h)
		if h == "" {
			return
		}
		if parsed, _, err := net.SplitHostPort(h); err == nil {
			h = parsed
		}
		h = strings.Trim(h, "[]")
		if ip := net.ParseIP(h); ip != nil {
			if ip.IsUnspecified() {
				return
			}
			ipSet[ip.String()] = ip
			return
		}
		dnsSet[strings.ToLower(h)] = true
	}

	addHost("localhost")
	ipSet["127.0.0.1"] = net.ParseIP("127.0.0.1")
	ipSet["::1"] = net.ParseIP("::1")

	if name, err := os.Hostname(); err == nil && name != "" {
		addHost(name)
		if !strings.Contains(name, ".") {
			addHost(name + ".local")
		}
	}
	for _, ip := range localIPs() {
		ipSet[ip.String()] = ip
	}
	addHost(bindHost)
	for _, h := range extra {
		addHost(h)
	}

	for name := range dnsSet {
		dnsNames = append(dnsNames, name)
	}
	sort.Strings(dnsNames)
	keys := make([]string, 0, len(ipSet))
	for k := range ipSet {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		ips = append(ips, ipSet[k])
	}
	return dnsNames, ips
}

// localIPs lists the addresses another device on the network could reach this
// machine at: everything assigned to an up interface except loopback and the
// link-local ranges, which need a zone index to be usable from elsewhere.
func localIPs() []net.IP {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []net.IP
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}
			out = append(out, ip)
		}
	}
	return out
}

func isUnspecifiedHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return ip != nil && ip.IsUnspecified()
}

func fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

func randomSerial() (*big.Int, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("generate serial number: %w", err)
	}
	serial := int64(binary.BigEndian.Uint64(b) >> 1)
	return big.NewInt(serial), nil
}

// writeFileAtomic writes through a temporary file in the same directory so a
// reader never sees a half-written keypair, and creates it at its final mode
// rather than widening it afterwards.
func writeFileAtomic(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".sip-tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		_ = f.Close()
		_ = os.Remove(tmp)
	}()
	if err := f.Chmod(mode); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
