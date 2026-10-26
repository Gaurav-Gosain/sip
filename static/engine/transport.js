// The connection, opened inside the worker so PTY output never crosses the
// main thread. Two wire formats:
//
//   'sip'  sip's protocol: each message is a type byte and a payload
//          ('0' input, '1' output, '2' resize JSON, '3' ping, '4' pong,
//          '5' title, '6' options JSON, '7' close). Over WebTransport every
//          message also carries a 4-byte big-endian length prefix.
//   'raw'  the WebSocket carries PTY bytes both ways, no framing.
//
// handlers: output(bytes), title(text), options(obj), closed(error?), open()

export const MSG = { INPUT: 0x30, OUTPUT: 0x31, RESIZE: 0x32, PING: 0x33, PONG: 0x34, TITLE: 0x35, OPTIONS: 0x36, CLOSE: 0x37 };
const MAX_FRAME = 16 * 1024 * 1024;
const INPUT_CHUNK = 64 * 1024; // sip drops one input message over its paste limit
const decoder = new TextDecoder();

export function openTransport(cfg, h) {
  const sip = (cfg.protocol ?? 'sip') === 'sip';
  let send = () => {};
  let close = () => {};
  let closedByUs = false;

  function message(data) {
    if (!sip) return h.output(data);
    if (!data.length) return;
    switch (data[0]) {
      case MSG.OUTPUT: if (data.length > 1) h.output(data.subarray(1)); break;
      case MSG.TITLE: h.title?.(decoder.decode(data.subarray(1))); break;
      case MSG.OPTIONS: try { h.options?.(JSON.parse(decoder.decode(data.subarray(1)))); } catch {} break;
      case MSG.CLOSE: h.closed?.(); break;
      case MSG.PONG: break;
    }
  }

  function frame(type, payload) {
    const msg = new Uint8Array(1 + (payload?.length ?? 0));
    msg[0] = type;
    if (payload) msg.set(payload, 1);
    return msg;
  }

  const ready = new Promise((resolve, reject) => {
    if (cfg.kind === 'webtransport') {
      (async () => {
        const wt = new WebTransport(cfg.url, cfg.options ?? {});
        wt.closed.then(() => !closedByUs && h.closed?.(), (err) => !closedByUs && h.closed?.(err));
        await wt.ready;
        const stream = await wt.createBidirectionalStream();
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        send = (msg) => {
          const f = new Uint8Array(4 + msg.length);
          new DataView(f.buffer).setUint32(0, msg.length, false);
          f.set(msg, 4);
          return writer.write(f);
        };
        close = () => { try { wt.close(); } catch {} };
        resolve();
        h.open?.();
        // Reassemble length-prefixed frames from the byte stream.
        let buf = new Uint8Array(256 * 1024), len = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (len + value.length > buf.length) {
            const g = new Uint8Array(Math.max(buf.length * 2, len + value.length));
            g.set(buf.subarray(0, len));
            buf = g;
          }
          buf.set(value, len);
          len += value.length;
          let off = 0;
          while (len - off >= 4) {
            const size = (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;
            if (size > MAX_FRAME) throw new Error(`frame too large: ${size}`);
            if (len - off < 4 + size) break;
            message(buf.subarray(off + 4, off + 4 + size));
            off += 4 + size;
          }
          if (off) { buf.copyWithin(0, off, len); len -= off; }
        }
        if (!closedByUs) h.closed?.();
      })().catch((err) => { reject(err); if (!closedByUs) h.closed?.(err); });
      return;
    }
    const ws = new WebSocket(cfg.url, cfg.protocols);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      send = (msg) => { if (ws.readyState === 1) ws.send(msg); };
      close = () => { try { ws.close(); } catch {} };
      resolve();
      h.open?.();
    };
    ws.onmessage = (ev) => message(typeof ev.data === 'string' ? new TextEncoder().encode(ev.data) : new Uint8Array(ev.data));
    ws.onerror = () => { if (ws.readyState !== 1) reject(new Error('websocket failed to open')); };
    ws.onclose = (ev) => { if (!closedByUs) h.closed?.(ev.wasClean ? undefined : new Error(`websocket closed: ${ev.code}`)); };
  });

  return {
    ready,
    /** Bytes for the PTY, split under sip's per-message limit. */
    input(bytes) {
      for (let o = 0; o < bytes.length; o += INPUT_CHUNK) {
        const part = bytes.subarray(o, Math.min(bytes.length, o + INPUT_CHUNK));
        send(sip ? frame(MSG.INPUT, part) : part.slice());
      }
    },
    resize(cols, rows, widthPx, heightPx) {
      if (sip) send(frame(MSG.RESIZE, new TextEncoder().encode(JSON.stringify({ cols, rows, widthPx, heightPx }))));
    },
    ping() { if (sip) send(frame(MSG.PING)); },
    close() { closedByUs = true; close(); },
  };
}
