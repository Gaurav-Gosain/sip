import { MsgInput, MsgOutput, MsgResize, MsgPing, MsgPong, MsgTitle, MsgOptions, MsgClose, encodeWTMessage, jsonPayload, parseJsonPayload, tryDecodeWTFrame, } from './protocol.js';
// Cap a single input frame well under the server read limit; larger writes
// (pastes) are split across frames.
const INPUT_CHUNK_SIZE = 64 * 1024;
export class SipWebTransportAdapter {
    constructor(url, certHash, callbacks = {}) {
        this.url = url;
        this.certHash = certHash;
        this.transport = null;
        this.writer = null;
        this.onDataCallback = null;
        this.onStateChangeCallback = null;
        this.pingInterval = null;
        this.closed = false;
        this.callbacks = callbacks;
    }
    sipRead() {
        return null;
    }
    sipWrite(data) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        // A large paste as one frame would exceed the server read limit and
        // kill the session; split it into bounded MsgInput frames. The stream
        // writer applies backpressure via its ready promise.
        if (bytes.length <= INPUT_CHUNK_SIZE) {
            this._write(MsgInput, bytes);
            return;
        }
        this._writeChunked(bytes);
    }
    async _writeChunked(bytes) {
        for (let off = 0; off < bytes.length; off += INPUT_CHUNK_SIZE) {
            if (!this.writer)
                return;
            const chunk = bytes.subarray(off, off + INPUT_CHUNK_SIZE);
            try {
                await this.writer.ready;
                await this.writer.write(encodeWTMessage(MsgInput, chunk));
            }
            catch {
                return; // writer closed
            }
        }
    }
    sipResize(cols, rows, widthPx, heightPx) {
        const msg = { cols, rows };
        if (widthPx && widthPx > 0)
            msg.widthPx = widthPx;
        if (heightPx && heightPx > 0)
            msg.heightPx = heightPx;
        this._write(MsgResize, jsonPayload(msg));
    }
    async connect(onData, onStateChange) {
        this.onDataCallback = onData;
        this.onStateChangeCallback = onStateChange;
        this.closed = false;
        onStateChange('connecting', 'Connecting (WebTransport)...');
        try {
            // Convert hex cert hash to Uint8Array for serverCertificateHashes
            const hashBytes = new Uint8Array(this.certHash.match(/.{2}/g).map(h => parseInt(h, 16)));
            this.transport = new WebTransport(this.url, {
                serverCertificateHashes: [{
                        algorithm: 'sha-256',
                        value: hashBytes,
                    }],
            });
            await this.transport.ready;
            const stream = await this.transport.createBidirectionalStream();
            this.writer = stream.writable.getWriter();
            onStateChange('connected', 'Connected (WebTransport)');
            this._startPing();
            // Read from the stream
            this._readLoop(stream.readable);
            // Handle transport closure
            this.transport.closed.then(() => {
                if (!this.closed) {
                    this._stopPing();
                    onStateChange('disconnected', 'Disconnected');
                }
            }).catch(() => {
                if (!this.closed) {
                    this._stopPing();
                    onStateChange('disconnected', 'Disconnected');
                }
            });
        }
        catch (err) {
            onStateChange('disconnected', `WebTransport failed: ${err}`);
            throw err; // Let the auto adapter catch this and fall back
        }
    }
    async _readLoop(readable) {
        const reader = readable.getReader();
        // Pre-allocate a growable buffer; expands by doubling when needed.
        let buf = new Uint8Array(4096);
        let len = 0;
        const grow = (need) => {
            if (buf.length >= need)
                return;
            let n = buf.length * 2;
            while (n < need)
                n *= 2;
            const next = new Uint8Array(n);
            next.set(buf.subarray(0, len));
            buf = next;
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                if (!value)
                    continue;
                grow(len + value.length);
                buf.set(value, len);
                len += value.length;
                // Parse complete length-prefixed messages
                let consumed = 0;
                while (true) {
                    const frame = tryDecodeWTFrame(buf, consumed, len);
                    if (!frame)
                        break;
                    this._handleMessage(frame.msgType, frame.payload);
                    consumed += frame.consumed;
                }
                // Shift any unconsumed bytes to the front
                if (consumed > 0) {
                    const remaining = len - consumed;
                    if (remaining > 0) {
                        buf.set(buf.subarray(consumed, len), 0);
                    }
                    len = remaining;
                }
            }
        }
        catch {
            // Stream closed
        }
        finally {
            reader.releaseLock();
        }
    }
    _handleMessage(msgType, payload) {
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
                this.closed = true;
                const reason = payload.length > 0 ? new TextDecoder().decode(payload) : 'Session ended';
                this.callbacks.onClose?.(reason);
                break;
            }
            default:
                break;
        }
    }
    _write(msgType, payload) {
        if (!this.writer)
            return;
        const msg = encodeWTMessage(msgType, payload);
        this.writer.write(msg).catch(() => { });
    }
    _startPing() {
        this.pingInterval = window.setInterval(() => {
            this._write(MsgPing);
        }, 30000);
    }
    _stopPing() {
        if (this.pingInterval !== null) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    disconnect() {
        this.closed = true;
        this._stopPing();
        this.writer?.close().catch(() => { });
        this.writer = null;
        this.transport?.close();
        this.transport = null;
        this.onDataCallback = null;
    }
}
