// The network worker. It owns the socket and nothing else, so receiving
// (which costs about 0.3 ms per 64 KiB message in Chromium, on whichever
// thread owns the socket) runs in parallel with parsing in the engine
// worker. Output buffers are transferred to the engine over a
// MessagePort without a copy. The main thread is not involved.
import { openTransport } from './transport.js';

let conn = null;
let engine = null; // MessagePort to the engine worker

// At most two output batches in flight. While the engine parses a batch,
// output that arrives here is gathered into the next one, so a flood
// crosses to the engine in a few large messages and a single keystroke
// echo crosses at once. Control messages (title, options, close) wait in
// the same queue, so they never overtake output that came before them.
const queue = [];
let inflight = 0;
const MAX_BATCH = 1024 * 1024;
const MAX_INFLIGHT = 2; // the next batch waits at the engine while it parses this one
function enqueue(item) {
  queue.push(item);
  if (inflight < MAX_INFLIGHT) ship();
}
function ship() {
  while (queue.length && queue[0].ctl) engine.postMessage(queue.shift().ctl);
  if (!queue.length) return;
  let n = 0, len = 0;
  while (n < queue.length && !queue[n].ctl && (n === 0 || len + queue[n].bytes.length <= MAX_BATCH)) len += queue[n++].bytes.length;
  let bytes;
  if (n === 1) bytes = queue[0].bytes;
  else {
    bytes = new Uint8Array(len);
    let o = 0;
    for (let i = 0; i < n; i++) { bytes.set(queue[i].bytes, o); o += queue[i].bytes.length; }
  }
  queue.splice(0, n);
  inflight++;
  engine.postMessage({ type: 'output', bytes }, [bytes.buffer]);
}

self.onmessage = async ({ data: m }) => {
  if (m.type !== 'connect') return;
  engine = m.port;
  engine.onmessage = ({ data: d }) => {
    if (d.type === 'ack') { inflight--; ship(); }
    else if (d.type === 'input') conn?.input(d.bytes);
    else if (d.type === 'resize') conn?.resize(d.cols, d.rows, d.widthPx, d.heightPx);
  };
  let pingTimer = 0;
  try {
    conn = openTransport(m.transport, {
      output: (bytes) => {
        // A whole-message view can be kept as is; a view into a shared
        // reassembly buffer (WebTransport) has to be copied out first.
        enqueue({ bytes: bytes.byteOffset === 1 && bytes.buffer.byteLength === bytes.length + 1 ? bytes : bytes.slice() });
      },
      // Everything after output goes through the engine too, so the page
      // sees a title or a close only after the output before it is parsed.
      title: (title) => enqueue({ ctl: { type: 'title', title } }),
      options: (options) => enqueue({ ctl: { type: 'options', options } }),
      closed: (err) => { clearInterval(pingTimer); enqueue({ ctl: { type: 'closed', error: err ? String(err) : undefined } }); },
      open: () => {
        engine.postMessage({ type: 'open' });
        if (m.transport.pingMs) pingTimer = setInterval(() => conn.ping(), m.transport.pingMs);
      },
    });
    await conn.ready;
    self.postMessage({ type: 'result', id: m.id, value: true });
  } catch (err) {
    self.postMessage({ type: 'result', id: m.id, error: String(err) });
  }
};
