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
                    const { hash } = await resp.json();
                    const wt = new SipWebTransportAdapter(this.wtUrl, hash, this.callbacks);
                    this.adapter = wt;
                    await wt.connect(this.onDataCallback, this.onStateChangeCallback);
                    return; // WebTransport connected successfully
                }
            }
            catch {
                // WebTransport failed — fall through to WebSocket
            }
        }
        // Fall back to WebSocket
        const ws = new SipProtocolAdapter(this.wsUrl, this.callbacks);
        this.adapter = ws;
        ws.connect(this.onDataCallback, this.onStateChangeCallback);
    }
    disconnect() {
        this.adapter?.disconnect();
        this.adapter = null;
    }
}
