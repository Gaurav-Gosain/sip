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
    return {
        wsUrl: `${wsScheme}//${base.host}${base.pathname}ws`,
        wtUrl: `https://${base.host}${base.pathname}wt`,
        certHashUrl: `${base.origin}${base.pathname}cert-hash`,
    };
}
