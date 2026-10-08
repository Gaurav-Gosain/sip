package sip

import (
	"net"
	"net/http"
	"slices"
	"strings"
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
func hostCheckMiddleware(allowed []string) ConnectMiddleware {
	return func(next ConnectHandler) ConnectHandler {
		return func(r *http.Request) error {
			if !hostAllowed(r.Host, allowed) {
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
// check runs on a loopback bind, which is the bind DNS rebinding reaches. A
// "*" entry in AllowedHosts turns it off.
func (s *httpServer) hostCheckEnabled() bool {
	if slices.Contains(s.config.AllowedHosts, "*") {
		return false
	}
	return isLoopbackHost(s.config.Host)
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

// normalizeHost strips the port, IPv6 brackets and a trailing dot from a
// host name, and lowers its case.
func normalizeHost(h string) string {
	if host, _, err := net.SplitHostPort(h); err == nil {
		h = host
	}
	return strings.ToLower(strings.TrimSuffix(strings.Trim(h, "[]"), "."))
}
