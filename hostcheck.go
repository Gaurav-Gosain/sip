package sip

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"time"
)

// hostCheckMiddleware refuses a session handshake whose Host header does not
// name this machine.
//
// It guards against DNS rebinding. A page on attacker.example can make its
// name resolve to 127.0.0.1 and then open a WebSocket to the loopback
// server. The browser sends Origin and Host both set to attacker.example, so
// the same-origin check passes. The Host header is the one thing such a page
// cannot set to a loopback name, so a server bound to loopback must refuse
// every other name.
//
// It runs on the WebSocket and the WebTransport handshake, which are the
// only ways to a session. The page and its static files hold nothing a
// rebinding page could use.
//
// anyIP lets every IP address through. It is set on an unspecified bind
// (0.0.0.0, ::), which answers on loopback and on the network. A rebinding
// page always sends a DNS name in Host: an origin that is an IP address has
// no name to rebind. So a browser that opens the server by its LAN address
// still works, and a rebinding page is still refused.
func hostCheckMiddleware(allowed []string, anyIP bool) ConnectMiddleware {
	return func(next ConnectHandler) ConnectHandler {
		return func(r *http.Request) error {
			if !hostAllowed(r.Host, allowed) && (!anyIP || !isIPLiteral(r.Host)) {
				// The browser cannot show the 403 body of a failed
				// WebSocket, so the log line carries the remedy too.
				logger.Warn("refused a session for a host name that is not allowed. Add the name with --allow-host (Config.AllowedHosts)",
					"host", r.Host, "remote", r.RemoteAddr)
				return &ConnectError{
					Status: http.StatusForbidden,
					Body:   "This server does not answer to this host name. Add the name to AllowedHosts (sip --allow-host NAME).",
				}
			}
			return next(r)
		}
	}
}

// hostCheckEnabled reports whether the server checks the Host header. The
// check runs on a loopback bind, which is the bind DNS rebinding reaches,
// and on an unspecified bind, which listens on loopback too. A "*" entry in
// AllowedHosts turns it off. It reads the resolved bind, so resolveBind must
// have run.
func (s *httpServer) hostCheckEnabled() bool {
	if slices.Contains(s.config.AllowedHosts, "*") {
		return false
	}
	return s.bind == bindLoopback || s.bind == bindUnspecified
}

// hostGuard is the Host check this server runs on a session handshake, or
// nil when it runs none. It reads the resolved bind, so resolveBind must
// have run.
func (s *httpServer) hostGuard() ConnectMiddleware {
	if !s.hostCheckEnabled() {
		return nil
	}
	return hostCheckMiddleware(s.allowedHosts(), s.bind == bindUnspecified)
}

// allowedHosts is the Host allowlist for the handshake: localhost, the bind
// host, the AutoTLS certificate names and AllowedHosts. Loopback IP
// addresses always pass and are not listed.
func (s *httpServer) allowedHosts() []string {
	hosts := []string{"localhost"}
	if s.config.Host != "" {
		hosts = append(hosts, s.config.Host)
	}
	hosts = append(hosts, s.config.CertHosts...)
	return append(hosts, s.config.AllowedHosts...)
}

// hostAllowed reports whether a Host header names this machine or a name on
// the list. The port is ignored, and so are case and a trailing dot. Any
// name under .localhost passes: browsers resolve it to loopback themselves
// and never ask DNS, so a rebinding page cannot use it.
func hostAllowed(hostHeader string, allowed []string) bool {
	host := normalizeHost(hostHeader)
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return true
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	return slices.ContainsFunc(allowed, func(a string) bool {
		return normalizeHost(a) == host
	})
}

// isIPLiteral reports whether a Host header is an IP address.
func isIPLiteral(hostHeader string) bool {
	_, err := netip.ParseAddr(normalizeHost(hostHeader))
	return err == nil
}

// normalizeHost strips the port, IPv6 brackets and a trailing dot from a
// host name, and lowers its case.
func normalizeHost(h string) string {
	if host, _, err := net.SplitHostPort(h); err == nil {
		h = host
	}
	return strings.ToLower(strings.TrimSuffix(strings.Trim(h, "[]"), "."))
}

// bindKind sorts a bind address by who can reach it.
type bindKind int

const (
	bindNetwork     bindKind = iota // one address that is not loopback
	bindLoopback                    // this machine only
	bindUnspecified                 // every interface, loopback included
)

// kindOf ignores the zone: netip compares IsUnspecified against a zoneless
// ::, so "::%lo" would otherwise read as a network address.
func kindOf(a netip.Addr) bindKind {
	a = a.WithZone("")
	switch {
	case a.IsUnspecified():
		return bindUnspecified
	case a.IsLoopback():
		return bindLoopback
	}
	return bindNetwork
}

func (k bindKind) String() string {
	switch k {
	case bindLoopback:
		return "loopback"
	case bindUnspecified:
		return "every interface"
	}
	return "network"
}

// hostResolver is the part of net.Resolver that resolveBindHost needs, so a
// test can give it the answers of any machine.
type hostResolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

// hostAddr parses a bind host as an IP address. It takes "addr",
// "[addr]" and "[addr]:port", and unmaps an IPv4-mapped address. The zone
// stays. net.ParseIP returns nil for "::%lo" and "::1%lo", which net.Listen
// binds as :: and ::1, so the zone must not hide what the address is.
func hostAddr(host string) (netip.Addr, bool) {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	a, err := netip.ParseAddr(strings.Trim(host, "[]"))
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap(), true
}

// resolveBindHost turns Config.Host into the one IP address the server
// listens on, and says what kind of address it is.
//
// The checks (the Host check, the TLS requirement, the loopback
// certificate) read the kind, and the listeners bind the address. Both come
// from one lookup. If the checks read the string and the listener resolved
// it, they could disagree: a cgo build reads "0" and "0x0" as 0.0.0.0, and
// "127.1" as 127.0.0.1, through getaddrinfo, and any build resolves
// "LOCALHOST" and the names in /etc/hosts to loopback.
//
// An IP address is used as it is. The zone is dropped from a loopback or an
// unspecified address, where it changes nothing, and kept on any other
// address, where it picks the interface (fe80::1%eth0).
//
// A name is resolved. Its addresses must all be of one kind, because the
// address picked would otherwise decide who can connect. Like net.Listen,
// the first IPv4 address is picked, or the first address when there is
// none. A link-local IPv6 address needs a zone that a name cannot give, so
// it is refused.
//
// An empty host is localhost, as it always was.
func resolveBindHost(ctx context.Context, r hostResolver, host string) (string, bindKind, error) {
	if host == "" {
		host = "localhost"
	}
	if a, ok := hostAddr(host); ok {
		kind := kindOf(a)
		if kind != bindNetwork {
			a = a.WithZone("")
		}
		return a.String(), kind, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	found, err := r.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return "", 0, fmt.Errorf("cannot find the address of the bind host %s: %w. Give an IP address, such as 127.0.0.1", host, err)
	}
	if len(found) == 0 {
		return "", 0, fmt.Errorf("the bind host %s has no address. Give an IP address, such as 127.0.0.1", host)
	}
	addrs := make([]netip.Addr, len(found))
	for i, a := range found {
		addrs[i] = a.WithZone("").Unmap()
	}
	kind := kindOf(addrs[0])
	for _, a := range addrs[1:] {
		if kindOf(a) != kind {
			list := make([]string, len(addrs))
			for i, a := range addrs {
				list[i] = a.String()
			}
			return "", 0, fmt.Errorf("the bind host %s has addresses of more than one kind (%s). Give one IP address as the host",
				host, strings.Join(list, ", "))
		}
	}
	pick := addrs[0]
	for _, a := range addrs {
		if a.Is4() {
			pick = a
			break
		}
	}
	if pick.Is6() && pick.IsLinkLocalUnicast() {
		return "", 0, fmt.Errorf("the bind host %s is a link-local address (%s). Give the address with its zone, such as fe80::1%%eth0", host, pick)
	}
	return pick.String(), kind, nil
}

// resolveBind resolves Config.Host once and keeps the result. Config.Host
// itself keeps the name as typed, for the URL, the messages and the
// certificate names.
func (s *httpServer) resolveBind(ctx context.Context) error {
	r := s.resolver
	if r == nil {
		r = net.DefaultResolver
	}
	addr, kind, err := resolveBindHost(ctx, r, s.config.Host)
	if err != nil {
		return err
	}
	s.listenHost, s.bind = addr, kind
	logger.Debug("bind host resolved", "host", s.config.Host, "addr", addr, "kind", kind)
	return nil
}
