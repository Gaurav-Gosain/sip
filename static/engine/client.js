// Main-thread side of the worker engine. It owns the DOM canvas and hands
// it to the worker, batches writes per microtask so a burst crosses the
// worker boundary once, and resolves each write() after its bytes are
// parsed. Rendering never touches this thread.

import { attachInput } from './input.js';

export class WorkerTerm {
  /**
   * Whether this browser can run the engine at all. A page that gets
   * false (or a rejected mount with err.code) keeps its other client.
   */
  static supported() {
    const reasons = [];
    if (typeof WebAssembly !== 'object') reasons.push('no-wasm');
    if (typeof Worker !== 'function') reasons.push('no-worker');
    if (typeof OffscreenCanvas !== 'function' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) reasons.push('no-offscreen-canvas');
    return { ok: reasons.length === 0, reasons };
  }

  static async mount(host, opts = {}) {
    const s = WorkerTerm.supported();
    if (!s.ok) throw Object.assign(new Error(`worker engine unsupported: ${s.reasons.join(', ')}`), { code: s.reasons[0] });
    const t = new WorkerTerm(host, opts);
    try {
      await t.ready;
    } catch (err) {
      t.dispose();
      throw err;
    }
    return t;
  }

  constructor(host, opts) {
    this.opts = opts;
    this.cols = opts.cols ?? 80;
    this.rows = opts.rows ?? 24;
    this.dpr = opts.dpr ?? (self.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wt-canvas';
    host.append(this.canvas);
    const off = this.canvas.transferControlToOffscreen();
    this.worker = new Worker(opts.workerUrl ?? new URL('./worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.batch = [];
    this.batchLen = 0;
    this.batchIds = [];
    this.flushQueued = false;
    this.tick = new MessageChannel();
    this.tick.port1.onmessage = () => this.sendWrites();
    this.renders = 0;
    this.worker.onmessage = ({ data: m }) => this.onMessage(m);
    this.worker.onerror = (ev) => { ev.preventDefault?.(); this.readyReject?.(Object.assign(new Error(`worker engine failed to start: ${ev.message || 'load error'}`), { code: 'worker-failed' })); };
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker.postMessage({
      type: 'init', canvas: off, cols: this.cols, rows: this.rows, dpr: this.dpr,
      scrollback: opts.scrollback ?? 10000, fontFamily: opts.fontFamily, fontSize: opts.fontSize ?? 14,
      fonts: opts.fonts, theme: opts.theme, renderer: opts.renderer, debugNoWebGL2: !!opts.debugNoWebGL2, warmFonts: !!opts.warmFonts, wasmUrl: String(opts.wasmUrl ?? new URL('../dist/engine.wasm', import.meta.url)),
    }, [off]);
  }

  onMessage(m) {
    if (m.type === 'data') { this.opts.onData?.(m.bytes); return; }
    if (m.type === 'frame') { this.opts.onFrame?.(m); return; }
    if (m.type === 'title') { this.opts.onTitle?.(m.title); return; }
    if (m.type === 'bell') { this.opts.onBell?.(); return; }
    if (m.type === 'pointerShape') {
      // null means the program reset it: the page's own default applies.
      this.pointerShape = m.shape;
      if (this.opts.onPointerShape) this.opts.onPointerShape(m.shape);
      else this.canvas.style.cursor = m.shape ?? '';
      return;
    }
    if (m.type === 'metrics') {
      this.cw = m.cw; this.ch = m.ch;
      this.canvas.style.width = `${(this.cols * m.cw) / this.dpr}px`;
      this.canvas.style.height = `${(this.rows * m.ch) / this.dpr}px`;
      this.opts.onMetrics?.(m);
      return;
    }
    if (m.type === 'search') { this.searchState = m; this.opts.onSearch?.(m); return; }
    if (m.type === 'hover') {
      this.hoveredLink = m.uri;
      this.canvas.style.cursor = m.uri ? 'pointer' : '';
      this.canvas.title = m.uri ?? '';
      this.opts.onLinkHover?.(m.uri);
      return;
    }
    if (m.type === 'openLink') {
      // The click that asked for it was a moment ago, so the page still has
      // user activation and the browser allows the new tab.
      if (this.opts.onLinkOpen) this.opts.onLinkOpen(m.uri);
      else { const w = window.open(m.uri, '_blank', 'noopener,noreferrer'); if (w) w.opener = null; }
      return;
    }
    if (m.type === 'cursor') { this.cursor = m; this.input?.cursor(m.x, m.y); return; }
    if (m.type === 'selection') {
      this.selection = m.text;
      this.input?.setSelection(m.text);
      if (m.copy) this.writeClipboard(m.text);
      this.opts.onSelection?.(m.text);
      return;
    }
    if (m.type === 'clipboard') {
      // OSC 52 from the program. sip's osc52gate filters it on the server
      // when the deployment says so; here it is only written.
      if (this.opts.onClipboard) this.opts.onClipboard(m.text, m.location);
      else if (m.location !== 'primary') this.writeClipboard(m.text);
      return;
    }
    if (m.type === 'options') { this.opts.onOptions?.(m.options); return; }
    if (m.type === 'closed') { this.opts.onClose?.(m.error); return; }
    if (m.type === 'ready') {
      this.cw = m.cw; this.ch = m.ch; this.renderer = m.renderer;
      this.canvas.style.width = `${(this.cols * m.cw) / this.dpr}px`;
      this.canvas.style.height = `${(this.rows * m.ch) / this.dpr}px`;
      if (this.opts.input !== false) this.input = attachInput(this.canvas.parentElement, this.canvas, (msg) => this.worker.postMessage(msg), { cell: () => ({ cw: this.cw / this.dpr, ch: this.ch / this.dpr }), onKey: (ev) => this.opts.onKey?.(ev), keyFilter: (ev) => (this.opts.keyFilter ? this.opts.keyFilter(ev) : ev), textFilter: (t) => (this.opts.textFilter ? this.opts.textFilter(t) : t), onTap: () => this.opts.onTap?.(), longPressMs: this.opts.longPressMs, slopPx: this.opts.slopPx, preeditStyle: { font: `${this.opts.fontSize ?? 14}px ${JSON.stringify(this.opts.fontFamily || 'monospace')}, monospace`, color: '#fff', background: 'rgba(0,0,0,0.8)' } });
      this.readyResolve();
    } else if (m.type === 'written') {
      for (const id of m.ids) { const p = this.pending.get(id); this.pending.delete(id); p?.resolve(); }
    } else if (m.type === 'result') {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (m.error) p?.reject(new Error(m.error)); else p?.resolve(m.value);
    } else if (m.type === 'error') {
      if (this.readyReject) this.readyReject(Object.assign(new Error(m.error), { code: m.code || 'engine-error' }));
      console.error(m.error);
    }
  }

  request(msg) {
    const id = this.seq++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); });
  }

  /** Resolves after the bytes are parsed. flush() waits for the frame. */
  write(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const id = this.seq++;
    this.batch.push(bytes);
    this.batchLen += bytes.length;
    this.batchIds.push(id);
    // Send at the end of the current task, not the current microtask: a
    // feeder that awaits each write wakes in its own microtask, and a
    // microtask flush would post one message per write.
    if (!this.flushQueued) { this.flushQueued = true; this.tick.port2.postMessage(0); }
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  sendWrites() {
    this.flushQueued = false;
    if (!this.batchIds.length) return;
    const out = new Uint8Array(this.batchLen);
    const lens = new Uint32Array(this.batch.length);
    let o = 0;
    this.batch.forEach((b, i) => { out.set(b, o); o += b.length; lens[i] = b.length; });
    this.worker.postMessage({ type: 'write', bytes: out, ids: this.batchIds, lens }, [out.buffer, lens.buffer]);
    this.batch = []; this.batchLen = 0; this.batchIds = [];
  }

  async flush() {
    this.sendWrites();
    const r = await this.request({ type: 'flush' });
    this.renders = r.renders;
  }

  /** Write text to the system clipboard; false if the browser refused. */
  async writeClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    // Insecure origin or no user gesture: the copy event path, which works
    // only during a user gesture but needs no permission.
    const prev = this.selection;
    this.input?.setSelection(text);
    try { return this.input?.copy() ?? false; } catch { return false; } finally { this.input?.setSelection(prev ?? ''); }
  }
  /**
   * Search the screen and scrollback (ASCII letters ignore case). Resolves
   * with { total, index, done } after the first step; onSearch gets each
   * later count while the search catches up. An empty needle closes it.
   */
  search(needle) { return this.request({ type: 'search', needle }); }
  /** Select the next older match ('next') or newer match ('prev'). */
  searchSelect(dir = 'next') { return this.request({ type: 'searchSelect', dir }); }
  selectAll() { this.worker.postMessage({ type: 'selectAll' }); }
  clearSelection() { this.worker.postMessage({ type: 'selectClear' }); }
  setCopyOnSelect(on) { this.worker.postMessage({ type: 'options', copyOnSelect: on }); }
  /**
   * Change the look: theme (an xterm.js ITheme), fontSize, fontFamily, fonts
   * ([{ url, weight, style }]), cursorStyle ('block' | 'bar' | 'underline'),
   * cursorBlink, scrollback (lines). A new font changes the cell size; call
   * fit() afterwards to keep the grid filling its host.
   */
  setOptions(o) { return this.request({ type: 'setOptions', ...o }); }
  scrollToTop() { this.worker.postMessage({ type: 'scrollTo', where: 'top' }); }
  scrollToBottom() { this.worker.postMessage({ type: 'scrollTo', where: 'bottom' }); }
  /** xterm's clear(): keep the cursor's line as the first, drop the rest. */
  clear() { this.worker.postMessage({ type: 'clearScrollback' }); }
  paste(text) { this.worker.postMessage({ type: 'paste', text: String(text) }); }
  blur() { this.input?.textarea.blur(); }
  hasSelection() { return !!this.selection; }
  getSelection() { return this.selection || ''; }
  /** Raw input for the program (a phone key bar, a page button). */
  sendInput(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.worker.postMessage({ type: 'send', bytes }, [bytes.buffer]);
  }
  /** The element that holds focus and the software keyboard. */
  get textarea() { return this.input?.textarea ?? null; }
  /**
   * Resize the grid to fill an element (the host by default). Returns the
   * new size. Call it from a ResizeObserver; the phone keyboard inset
   * changes the host's size through CSS.
   */
  async fit(el = this.canvas.parentElement) {
    const cs = getComputedStyle(el);
    const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cols = Math.max(2, Math.floor(w / (this.cw / this.dpr)));
    const rows = Math.max(1, Math.floor(h / (this.ch / this.dpr)));
    if (cols !== this.cols || rows !== this.rows) await this.resize(cols, rows);
    return { cols: this.cols, rows: this.rows };
  }
  scroll(delta) { this.worker.postMessage({ type: 'scroll', delta }); }
  /**
   * Open the connection inside the worker. transport: { kind: 'websocket' |
   * 'webtransport', url, protocol: 'sip' | 'raw', options (WebTransport
   * constructor options, e.g. serverCertificateHashes), pingMs }.
   */
  connect(transport, { thread = 'net' } = {}) {
    if (thread === 'engine') return this.request({ type: 'connect', transport });
    // Default: a third thread owns the socket. Receiving a WebSocket message
    // costs about 0.3 ms per 64 KiB on the owning thread, so a separate
    // network worker lets receive and parse run in parallel.
    const ch = new MessageChannel();
    this.net = new Worker(this.opts.netWorkerUrl ?? new URL('./net-worker.js', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'net', port: ch.port1 }, [ch.port1]);
    return new Promise((resolve, reject) => {
      this.net.onmessage = ({ data: m }) => {
        if (m.type === 'result') return m.error ? reject(new Error(m.error)) : resolve(true);
        this.onMessage(m);
      };
      this.net.postMessage({ type: 'connect', transport, port: ch.port2 }, [ch.port2]);
    });
  }
  async resize(cols, rows) {
    const ok = await this.request({ type: 'resize', cols, rows });
    if (ok) {
      this.cols = cols; this.rows = rows;
      this.canvas.style.width = `${(cols * this.cw) / this.dpr}px`;
      this.canvas.style.height = `${(rows * this.ch) / this.dpr}px`;
    }
    return ok;
  }
  /** Ask the worker to report each drawn frame through onFrame. */
  observe(on = true) { this.worker.postMessage({ type: 'observe', on }); }
  focus() { this.input?.focus(); }
  stats() { return this.request({ type: 'stats' }); }
  /** kind 'render' reads the instance buffer, 'direct' reads Ghostty's cells. */
  dump(kind = 'render') { this.sendWrites(); return this.request({ type: 'dump', kind }); }
  dispose() { this.input?.detach(); this.net?.terminate(); this.worker.terminate(); this.canvas.remove(); }
}
