import { MsgInput, MsgOutput, MsgResize, MsgPing, MsgPong, MsgTitle, MsgOptions, MsgClose, encodeWSMessage, decodeWSMessage, jsonPayload, parseJsonPayload, } from './protocol.js';
export class SipProtocolAdapter {
    constructor(url, callbacks = {}) {
        this.url = url;
        this.ws = null;
        this.onDataCallback = null;
        this.pingInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectBaseDelay = 1000;
        this.reconnectMultiplier = 1.5;
        this.onStateChangeCallback = null;
        this.shouldReconnect = true;
        this.callbacks = callbacks;
    }
    sipRead() {
        return null;
    }
    sipWrite(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this.ws.send(encodeWSMessage(MsgInput, bytes));
    }
    sipResize(cols, rows, widthPx, heightPx) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        const msg = { cols, rows };
        if (widthPx && widthPx > 0)
            msg.widthPx = widthPx;
        if (heightPx && heightPx > 0)
            msg.heightPx = heightPx;
        this.ws.send(encodeWSMessage(MsgResize, jsonPayload(msg)));
    }
    connect(onData, onStateChange) {
        this.onDataCallback = onData;
        this.onStateChangeCallback = onStateChange;
        this.shouldReconnect = true;
        this._connect();
    }
    _connect() {
        this.onStateChangeCallback?.('connecting', 'Connecting...');
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.onStateChangeCallback?.('connected', 'Connected');
            this._startPing();
        };
        this.ws.onmessage = (e) => {
            const data = new Uint8Array(e.data);
            const [msgType, payload] = decodeWSMessage(data);
            switch (msgType) {
                case MsgOutput:
                    this.onDataCallback?.(payload);
                    break;
                case MsgPong:
                    break;
                case MsgTitle:
                    this.callbacks.onTitle?.(new TextDecoder().decode(payload));
                    break;
                case MsgOptions:
                    this.callbacks.onOptions?.(parseJsonPayload(payload));
                    break;
                case MsgClose: {
                    this.shouldReconnect = false;
                    const reason = payload.length > 0 ? new TextDecoder().decode(payload) : 'Session ended';
                    this.callbacks.onClose?.(reason);
                    break;
                }
                default:
                    break;
            }
        };
        this.ws.onclose = () => {
            this._stopPing();
            if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                this._reconnect();
            }
            else {
                this.onStateChangeCallback?.('disconnected', 'Disconnected');
            }
        };
        this.ws.onerror = () => { };
    }
    _reconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectBaseDelay * Math.pow(this.reconnectMultiplier, this.reconnectAttempts - 1);
        this.onStateChangeCallback?.('reconnecting', `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(() => this._connect(), delay);
    }
    _startPing() {
        this.pingInterval = window.setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(encodeWSMessage(MsgPing));
            }
        }, 30000);
    }
    _stopPing() {
        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    disconnect() {
        this.shouldReconnect = false;
        this._stopPing();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.onDataCallback = null;
    }
}
