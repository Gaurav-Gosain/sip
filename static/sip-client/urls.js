/**
 * URL helpers for hosting sip behind a path-prefix reverse proxy.
 *
 * Deriving endpoint URLs from the document's baseURI (instead of
 * hardcoded "/ws", "/wt", "/cert-hash") keeps the page working when the
 * index is served at a non-root path — e.g. an nginx `location /terminal/`
 * that proxies to the sip server root. The browser resolves the
 * relative paths against the current document, and the proxy strips the
 * prefix before forwarding.
 */
/**
 * Resolve sip's endpoint URLs against a document base URI. Use
 * `document.baseURI` from an inline script in index.html; tests pass
 * a literal URL string.
 */
export function resolveSipURLs(baseURI) {
    const base = new URL('./', baseURI);
    const wsScheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
    // Best-effort WebTransport fallback: the QUIC listener runs on the HTTP
    // port + 1 and serves /webtransport. This is only used when /cert-hash
    // omits a `wtUrl`; normally the server advertises the authoritative
    // endpoint (which also handles reverse-proxy host/port remapping) and the
    // auto adapter prefers that.
    const httpPort = base.port ? parseInt(base.port, 10) : (base.protocol === 'https:' ? 443 : 80);
    const wtHost = `${base.hostname}:${httpPort + 1}`;
    return {
        wsUrl: `${wsScheme}//${base.host}${base.pathname}ws`,
        wtUrl: `https://${wtHost}/webtransport`,
        certHashUrl: `${base.origin}${base.pathname}cert-hash`,
    };
}
