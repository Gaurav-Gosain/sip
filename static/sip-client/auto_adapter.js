import { SipProtocolAdapter } from './websocket_adapter.js';
import { SipWebTransportAdapter } from './webtransport_adapter.js';
export class SipAutoAdapter {
    constructor(wsUrl, wtUrl, certHashUrl, callbacks = {}) {
        this.wsUrl = wsUrl;
        this.wtUrl = wtUrl;
        this.certHashUrl = certHashUrl;
        this.callbacks = callbacks;
        this.adapter = null;
        this.onDataCallback = null;
        this.onStateChangeCallback = null;
        // Set once a transport actually connects, so the UI reflects what's
        // live instead of the pre-connect guess.
        this.activeTransport = null;
    }
    sipRead() {
        return this.adapter?.sipRead() ?? null;
    }
    sipWrite(data) {
        this.adapter?.sipWrite(data);
    }
    sipResize(cols, rows, widthPx, heightPx) {
        this.adapter?.sipResize(cols, rows, widthPx, heightPx);
    }
    connect(onData, onStateChange) {
        this.onDataCallback = onData;
        this.onStateChangeCallback = onStateChange;
        this._tryConnect();
    }
    async _tryConnect() {
        // Try WebTransport first if URL and cert hash endpoint are available
        if (this.wtUrl && this.certHashUrl && typeof WebTransport !== 'undefined') {
            try {
                const resp = await fetch(this.certHashUrl);
                if (resp.ok) {
                    // The server sends the cert digest as `hashBytes` (an int
                    // array) and the reachable endpoint as `wtUrl` (it knows the
                    // +1 UDP port and its own host; the page-derived guess does
                    // not). Prefer the server's wtUrl, fall back to the guess.
                    const info = await resp.json();
                    const hashBytes = info.hashBytes;
                    const wtUrl = info.wtUrl || this.wtUrl;
                    if (Array.isArray(hashBytes) && hashBytes.length > 0) {
                        const wt = new SipWebTransportAdapter(wtUrl, hashBytes, this.callbacks);
                        this.adapter = wt;
                        await wt.connect(this.onDataCallback, this.onStateChangeCallback);
                        this.activeTransport = 'webtransport';
                        this.callbacks.onTransport?.('webtransport');
                        return; // WebTransport connected successfully
                    }
                }
            }
            catch (err) {
                // WebTransport failed — fall through to WebSocket, but say so
                // instead of failing silently. This is a degradation, so warn:
                // a rejected origin or an untrusted cert otherwise looks
                // exactly like a working session that is merely slower.
                console.warn(
                    'sip: WebTransport handshake failed, falling back to WebSocket. ' +
                    'A rejected Origin shows as "request origin not allowed" in the server log; ' +
                    'add the page origin to OriginPatterns if the server is behind a proxy.',
                    err);
                this.wtError = err;
            }
        }
        // Fall back to WebSocket
        const ws = new SipProtocolAdapter(this.wsUrl, this.callbacks);
        this.adapter = ws;
        this.activeTransport = 'websocket';
        this.callbacks.onTransport?.('websocket');
        ws.connect(this.onDataCallback, this.onStateChangeCallback);
    }
    disconnect() {
        this.adapter?.disconnect();
        this.adapter = null;
    }
}
