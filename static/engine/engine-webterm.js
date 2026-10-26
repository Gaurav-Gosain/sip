// A WebTerm-shaped wrapper around the worker engine, for a page built on
// webterm's WebTerm (sip's client is one). It takes the same options and
// answers the calls such a page makes: open, attach and detach a
// transport, write, paste, focus, blur, on('resize' | 'title' | 'bell'),
// setOptions, cols, rows, pixelSize, renderer. `xterm` is a small facade
// with the parts of xterm.js's Terminal those pages read: textarea, element,
// getSelection and friends, scroll calls and attachCustomKeyEventHandler.
// Nothing here parses or draws; the engine does that off the main thread.

import { WorkerTerm } from './client.js';

const cssUrl = (source) => {
  const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(source || '');
  return m ? new URL(m[2], document.baseURI).href : null;
};

const STYLE_OF = { block: 'block', bar: 'bar', underline: 'underline' };

export class EngineWebTerm {
  constructor(options = {}) {
    this.options = { ...options };
    this.isEngine = true;
    this.listeners = new Map();
    this.transport = undefined;
    this.keyHandler = null;
    this.term = null;
  }

  static supported() { return WorkerTerm.supported(); }

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }

  emit(name, ...args) {
    for (const fn of this.listeners.get(name) ?? []) {
      try { fn(...args); } catch (err) { console.error(`engine: a ${name} listener threw`, err); }
    }
  }

  async open(host) {
    const o = this.options;
    this.host = host;
    const fonts = (o.fonts || []).map((f) => ({ url: cssUrl(f.source), weight: f.weight, style: f.style })).filter((f) => f.url);
    const theme = o.theme || {};
    const num = (c, d) => { const m = /^#?([0-9a-f]{6})/i.exec(String(c || '')); if (!m) return d; const n = parseInt(m[1], 16); return ((n >> 16) & 255) | (((n >> 8) & 255) << 8) | ((n & 255) << 16); };
    this.term = await WorkerTerm.mount(host, {
      cols: 80,
      rows: 24,
      fontFamily: o.fontFamily,
      fontSize: o.fontSize ?? 14,
      fonts,
      scrollback: o.scrollback ?? 5000,
      // A page that moves the files (sip flattens them into one directory)
      // says where the wasm and the workers are.
      wasmUrl: o.engine?.wasmUrl,
      workerUrl: o.engine?.workerUrl,
      netWorkerUrl: o.engine?.netWorkerUrl,
      theme: [num(theme.foreground, 0xd0d0d0), num(theme.background, 0x101010), num(theme.cursor || theme.foreground, 0xffffff)],
      onData: (bytes) => {
        if (this.options.input?.readOnly || !this.transport) return;
        // Split as webterm does, under the server's per-message input limit.
        const n = this.options.input?.chunkBytes || bytes.length || 1;
        for (let o = 0; o < bytes.length; o += n) this.transport.send(bytes.subarray(o, o + n));
      },
      onTitle: (t) => this.emit('title', t),
      onBell: () => this.emit('bell'),
      // webterm's keyboard.onKeyEvent and xterm's custom key handler both get
      // a say before the engine encodes a key; false keeps it from the program.
      onKey: (ev) => {
        const kb = this.options.keyboard?.onKeyEvent;
        if (kb && kb(ev) === false) return false;
        return this.keyHandler ? this.keyHandler(ev) : true;
      },
      onTap: () => this.options.onTap?.(),
      onPointerShape: (shape) => {
        // Same custom property sip's own pointer-shape code sets, so the page's
        // CSS decides as before.
        const root = document.documentElement;
        if (shape) root.style.setProperty('--sip-pointer-shape', shape);
        else root.style.removeProperty('--sip-pointer-shape');
        this.options.onPointerShape?.(shape);
      },
    });
    await this.term.setOptions({ theme, cursorStyle: STYLE_OF[o.cursorStyle] || 'block', cursorBlink: !!o.cursorBlink, scrollback: o.scrollback ?? 5000 });
    if (o.clipboard?.copyOnSelect) this.term.setCopyOnSelect(true);
    // The grid follows its host, the way webterm's fit addon makes it.
    const fit = async () => {
      const before = `${this.term.cols}x${this.term.rows}`;
      await this.term.fit(host);
      if (`${this.term.cols}x${this.term.rows}` !== before) this.emit('resize', { cols: this.term.cols, rows: this.term.rows });
    };
    this.resizeObserver = new ResizeObserver(() => { fit(); });
    this.resizeObserver.observe(host);
    await fit();
    this.xterm = this.facade();
    return this;
  }

  facade() {
    const t = this.term;
    const self = this;
    return {
      get cols() { return t.cols; },
      get rows() { return t.rows; },
      get textarea() { return t.textarea; },
      get element() { return t.canvas.parentElement; },
      attachCustomKeyEventHandler(fn) { self.keyHandler = fn; },
      getSelection: () => t.getSelection(),
      hasSelection: () => t.hasSelection(),
      clearSelection: () => t.clearSelection(),
      selectAll: () => t.selectAll(),
      scrollToTop: () => t.scrollToTop(),
      scrollToBottom: () => t.scrollToBottom(),
      scrollLines: (n) => t.scroll(n),
      clear: () => t.clear(),
      focus: () => t.focus(),
      blur: () => t.blur(),
    };
  }

  get cols() { return this.term?.cols ?? 0; }
  get rows() { return this.term?.rows ?? 0; }
  get pixelSize() {
    if (!this.term) return { width: 0, height: 0 };
    return { width: Math.round((this.term.cols * this.term.cw) / this.term.dpr), height: Math.round((this.term.rows * this.term.ch) / this.term.dpr) };
  }
  /** 'engine' for the WebGL2 rung, 'engine-canvas2d' for the Canvas2D one. */
  get renderer() { return this.term?.renderer === 'worker-canvas2d' ? 'engine-canvas2d' : 'engine'; }
  get kitty() { return null; }
  get image() { return null; }

  focus() { this.term?.focus(); }
  blur() { this.term?.blur(); }
  write(data) { this.term?.write(typeof data === 'string' ? new TextEncoder().encode(data) : data); }
  paste(text) { this.term?.paste(text); }

  attach(transport) {
    this.detach();
    this.transport = transport;
    const sink = {
      data: (bytes) => this.write(bytes),
      closed: () => { if (this.transport === transport) this.transport = undefined; },
    };
    Promise.resolve(transport.start(sink)).catch((err) => {
      console.warn('engine: transport failed to start', err);
      if (this.transport === transport) this.transport = undefined;
    });
    return () => { if (this.transport === transport) this.detach(); };
  }

  detach() {
    const t = this.transport;
    this.transport = undefined;
    try { t?.close(); } catch {}
  }

  setOptions(patch = {}) {
    this.options = { ...this.options, ...patch };
    if (!this.term) return;
    const o = {};
    if (patch.theme) o.theme = patch.theme;
    if (patch.fontSize) o.fontSize = patch.fontSize;
    if (patch.fontFamily) o.fontFamily = patch.fontFamily;
    if (patch.cursorStyle) o.cursorStyle = STYLE_OF[patch.cursorStyle] || 'block';
    if ('cursorBlink' in patch) o.cursorBlink = !!patch.cursorBlink;
    if (patch.scrollback) o.scrollback = patch.scrollback;
    if (Object.keys(o).length) this.term.setOptions(o).then(() => (o.fontSize || o.fontFamily) && this.term.fit(this.host).then(() => this.emit('resize', { cols: this.term.cols, rows: this.term.rows })));
    if (patch.clipboard && 'copyOnSelect' in patch.clipboard) this.term.setCopyOnSelect(!!patch.clipboard.copyOnSelect);
  }

  /**
   * Search the screen and scrollback and select the match. Resolves with
   * { row, col, length } like webterm's BufferSearch (row counts from the
   * oldest line kept), plus index (0 = newest) and total, or null.
   * Ghostty compares ASCII letters without case, whatever the options say.
   */
  async find(query, { backwards = false } = {}) {
    if (!this.term || !query) return null;
    let fresh = false;
    if (query !== this.lastQuery) {
      fresh = true;
      this.lastQuery = query;
      let st = await this.term.search(query);
      // A whole scrollback takes a few steps; wait for the count to settle.
      for (let i = 0; i < 200 && !(this.term.searchState?.done ?? st.done); i++) await new Promise((r) => setTimeout(r, 5));
    }
    // A new query selects the newest match, the one nearest the prompt.
    // After that, forward means newer lines (higher rows), as in webterm's
    // BufferSearch, and backwards means older. Ghostty's "next" is older.
    const st = await this.term.searchSelect(fresh || backwards ? 'next' : 'prev');
    return st.index < 0 ? null : { row: st.row, col: st.col, length: query.length, index: st.index, total: st.total };
  }

  clearSearch() { this.lastQuery = ''; return this.term?.search(''); }

  dispose() {
    this.resizeObserver?.disconnect();
    this.detach();
    this.term?.dispose();
  }
}
