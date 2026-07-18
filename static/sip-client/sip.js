import { init, Terminal, FitAddon } from '../ghostty-web/ghostty-web.js';
import { SipWasmAdapter } from './adapter.js';
import { SipProtocolAdapter } from './websocket_adapter.js';
import { SipAutoAdapter } from './auto_adapter.js';
import { OSC52Scanner } from './clipboard.js';
export class SipTerminal {
    constructor(containerId, options = {}) {
        this.container = null;
        this.term = null;
        this.adapter = null;
        this.fitAddon = null;
        this._resizeHandler = null;
        this._dprCleanup = null;
        // --- Event Callbacks ---
        this.onStatusChange = null;
        this.onBell = null;
        this.onSelectionChange = null;
        this.onKey = null;
        this.onTitleChange = null;
        this.onScroll = null;
        this.onRender = null;
        this.onCursorMove = null;
        this.container = document.getElementById(containerId);
        this.options = {
            fontSize: 15,
            cols: 80,
            rows: 24,
            allowOSC52: false,
            convertEol: true,
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
            },
            ...options
        };
        this.osc52Scanner = new OSC52Scanner(this.options.allowOSC52 ?? false);
    }
    async init() {
        if (!this.container) {
            throw new Error('SipTerminal.init: container element is null');
        }
        // Resolve wasm URL relative to this module so it works regardless
        // of where the page is mounted. Bundle's default resolves
        // "./ghostty-vt.wasm" against self.location (page URL), which
        // 404s when the page is not in the same dir as the asset.
        const wasmUrl = new URL('../ghostty-web/ghostty-vt.wasm', import.meta.url).href;
        await init(wasmUrl);
        const term = new Terminal(this.options);
        this.term = term;
        this.fitAddon = new FitAddon();
        term.loadAddon(this.fitAddon);
        term.open(this.container);
        this.fitAddon.fit();
        this.fitAddon.observeResize();
        // Handle window resize as fallback
        this._resizeHandler = () => { this.fitAddon?.fit(); };
        window.addEventListener('resize', this._resizeHandler);
        // Watch for devicePixelRatio changes (browser zoom, display switch)
        this._dprCleanup = this._watchDevicePixelRatio();
        // Listen for resize events from the terminal (triggered by fit addon)
        term.onResize((size) => {
            const px = this._pixelDims(size.cols, size.rows);
            this.adapter?.sipResize(size.cols, size.rows, px.widthPx, px.heightPx);
        });
        console.log('Terminal opened. Size:', term.cols, 'x', term.rows);
        // Send user input through adapter
        term.onData((data) => {
            this.adapter?.sipWrite(data);
        });
        term.onBell(() => {
            this.onBell?.();
        });
        term.onSelectionChange(() => {
            this.onSelectionChange?.();
        });
        term.onKey((event) => {
            this.onKey?.(event);
        });
        term.onTitleChange((title) => {
            this.onTitleChange?.(title);
        });
        term.onScroll((viewportY) => {
            this.onScroll?.(viewportY);
        });
        term.onRender((event) => {
            this.onRender?.(event);
        });
        term.onCursorMove(() => {
            this.onCursorMove?.();
        });
    }
    /**
     * Connect to a BubbleTea backend via WebSocket
     * @param url WebSocket URL (e.g., 'ws://localhost:8080/ws')
     */
    connectWebSocket(url) {
        const callbacks = {
            onTitle: (title) => { this.onTitleChange?.(title); },
            onOptions: (_opts) => { },
            onClose: (reason) => {
                this.term?.write(`\r\n${reason}\r\n`);
            },
        };
        this.adapter = new SipProtocolAdapter(url, callbacks);
        this._setupAdapter();
    }
    /**
     * Connect with auto-detection: tries WebTransport first, falls back to WebSocket.
     * @param wsUrl WebSocket URL (e.g., 'ws://localhost:8080/ws')
     * @param wtUrl WebTransport URL (e.g., 'https://localhost:8080/wt'), or null to skip
     * @param certHashUrl URL to fetch cert hash (e.g., 'https://localhost:8080/cert-hash'), or null
     */
    connectAuto(wsUrl, wtUrl = null, certHashUrl = null) {
        const callbacks = {
            onTitle: (title) => { this.onTitleChange?.(title); },
            onOptions: (_opts) => { },
            onClose: (reason) => { this.term?.write(`\r\n${reason}\r\n`); },
        };
        this.adapter = new SipAutoAdapter(wsUrl, wtUrl, certHashUrl, callbacks);
        this._setupAdapter();
    }
    /**
     * Connect to a BubbleTea program running in WASM
     * @param pollMs Polling interval in milliseconds (default: 16ms / ~60fps)
     */
    connectWasm(pollMs = 16) {
        this.adapter = new SipWasmAdapter(pollMs);
        this._setupAdapter();
    }
    /**
     * Use a custom adapter implementation
     * @param adapter Custom BubbleTeaAdapter
     */
    connectAdapter(adapter) {
        this.adapter = adapter;
        this._setupAdapter();
    }
    _setupAdapter() {
        if (!this.adapter)
            return;
        this.adapter.connect((data) => {
            if (data instanceof Uint8Array) {
                this.osc52Scanner.scan(data);
            }
            this.term?.write(data);
        }, (state, message) => {
            this._updateStatus(state, message);
            const term = this.term;
            if (state === 'connected' && term) {
                const px = this._pixelDims(term.cols, term.rows);
                this.adapter?.sipResize(term.cols, term.rows, px.widthPx, px.heightPx);
            }
            if (state === 'disconnected') {
                term?.write('\r\nConnection closed.\r\n');
            }
        });
    }
    disconnect() {
        this.adapter?.disconnect();
        this.adapter = null;
    }
    // --- Selection & Clipboard ---
    /** Get the currently selected text */
    getSelection() {
        return this.term?.getSelection() ?? '';
    }
    /** Check if there's an active selection */
    hasSelection() {
        return this.term?.hasSelection() ?? false;
    }
    /** Clear the current selection */
    clearSelection() {
        this.term?.clearSelection();
    }
    /** Copy the current selection to clipboard. Returns true if text was copied. */
    copySelection() {
        return this.term?.copySelection() ?? false;
    }
    /**
     * Copy arbitrary text to the clipboard using the OSC 52 scanner's layered
     * write strategy (async Clipboard API, then execCommand, then a
     * gesture-deferred retry). Works on insecure origins where the native
     * copy path's requirements are the same.
     */
    copyText(text) {
        this.osc52Scanner.copyText(text);
    }
    /** Select all text in the terminal */
    selectAll() {
        this.term?.selectAll();
    }
    /** Select text at a specific position */
    select(column, row, length) {
        this.term?.select(column, row, length);
    }
    /** Select entire lines from start to end (inclusive) */
    selectLines(start, end) {
        this.term?.selectLines(start, end);
    }
    /** Get the selection position as a buffer range, or undefined if no selection */
    getSelectionPosition() {
        return this.term?.getSelectionPosition();
    }
    // --- Scrollback & Viewport ---
    /** Scroll by a number of lines (positive = down, negative = up into history) */
    scrollLines(amount) {
        this.term?.scrollLines(amount);
    }
    /** Scroll by a number of pages */
    scrollPages(amount) {
        this.term?.scrollPages(amount);
    }
    /** Scroll to the top of the scrollback buffer */
    scrollToTop() {
        this.term?.scrollToTop();
    }
    /** Scroll to the bottom (current output) */
    scrollToBottom() {
        this.term?.scrollToBottom();
    }
    /** Scroll to a specific line in the buffer */
    scrollToLine(line) {
        this.term?.scrollToLine(line);
    }
    /** Get the current viewport Y position (lines scrolled back from bottom) */
    getViewportY() {
        return this.term?.getViewportY() ?? 0;
    }
    // --- Terminal Control ---
    /** Paste text into the terminal (uses bracketed paste if the program supports it) */
    paste(data) {
        this.term?.paste(data);
    }
    /** Input data as if typed by the user */
    input(data) {
        this.term?.input(data, true);
    }
    /** Focus the terminal */
    focus() {
        this.term?.focus();
    }
    /** Remove focus from the terminal */
    blur() {
        this.term?.blur();
    }
    /** Clear the terminal screen */
    clear() {
        this.term?.clear();
    }
    /** Reset the terminal state */
    reset() {
        this.term?.reset();
    }
    /** Write data to the terminal display */
    write(data, callback) {
        this.term?.write(data, callback);
    }
    /** Write data with a trailing newline */
    writeln(data, callback) {
        this.term?.writeln(data, callback);
    }
    // --- Terminal Mode Queries ---
    /** Check if the program has enabled mouse tracking */
    hasMouseTracking() {
        return this.term?.hasMouseTracking() ?? false;
    }
    /** Check if the program has enabled bracketed paste mode */
    hasBracketedPaste() {
        return this.term?.hasBracketedPaste() ?? false;
    }
    /** Check if the program has enabled focus event reporting */
    hasFocusEvents() {
        return this.term?.hasFocusEvents() ?? false;
    }
    /** Query an arbitrary terminal mode by number */
    getMode(mode, isAnsi) {
        return this.term?.getMode(mode, isAnsi) ?? false;
    }
    // --- Link Detection ---
    /**
     * Register a link provider for detecting clickable links in terminal output.
     */
    registerLinkProvider(provider) {
        this.term?.registerLinkProvider(provider);
    }
    // --- Custom Event Handlers ---
    /** Attach a custom keyboard event handler. Return true to prevent default handling. */
    attachCustomKeyEventHandler(handler) {
        this.term?.attachCustomKeyEventHandler(handler);
    }
    /** Attach a custom wheel event handler. Return true to prevent default scroll handling. */
    attachCustomWheelEventHandler(handler) {
        this.term?.attachCustomWheelEventHandler(handler);
    }
    // --- Lifecycle ---
    /** Dispose the terminal and clean up all resources */
    dispose() {
        this.disconnect();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        this._dprCleanup?.();
        this._dprCleanup = null;
        this.term?.dispose();
        this.term = null;
        this.fitAddon = null;
    }
    // --- Advanced Access ---
    /** Get the underlying ghostty-web Terminal instance for advanced use cases */
    get terminal() {
        return this.term;
    }
    /** Get the current number of columns */
    get cols() {
        return this.term?.cols ?? 0;
    }
    /** Get the current number of rows */
    get rows() {
        return this.term?.rows ?? 0;
    }
    _updateStatus(state, message) {
        if (this.onStatusChange) {
            this.onStatusChange(state, message);
        }
    }
    /**
     * Compute the canvas pixel dimensions corresponding to a (cols, rows) grid.
     * Returns zeros when the renderer hasn't measured yet so the server-side
     * resize falls back to character-only dimensions.
     */
    _pixelDims(cols, rows) {
        const renderer = this.term?.renderer;
        if (!renderer)
            return { widthPx: 0, heightPx: 0 };
        const m = renderer.getMetrics();
        return {
            widthPx: Math.max(0, Math.round(m.width * cols)),
            heightPx: Math.max(0, Math.round(m.height * rows)),
        };
    }
    /**
     * Watch for devicePixelRatio changes (browser zoom, moving between displays).
     * Patches the renderer's cached DPR and forces a canvas re-scale.
     */
    _watchDevicePixelRatio() {
        let currentDpr = window.devicePixelRatio;
        let mql = null;
        const onChange = () => {
            const newDpr = window.devicePixelRatio;
            if (newDpr !== currentDpr) {
                currentDpr = newDpr;
                const term = this.term;
                const renderer = term?.renderer;
                if (term && renderer) {
                    renderer.devicePixelRatio = newDpr;
                    renderer.resize(term.cols, term.rows);
                }
                this.fitAddon?.fit();
            }
            // Re-register: matchMedia for DPR is a one-shot per value
            listen();
        };
        const listen = () => {
            mql?.removeEventListener('change', onChange);
            mql = window.matchMedia(`(resolution: ${currentDpr}dppx)`);
            mql.addEventListener('change', onChange);
        };
        listen();
        return () => {
            mql?.removeEventListener('change', onChange);
        };
    }
}
// Re-export adapter types for convenience
export { SipWasmAdapter };
export { SipProtocolAdapter } from './websocket_adapter.js';
export { SipAutoAdapter } from './auto_adapter.js';
export { SipWebTransportAdapter } from './webtransport_adapter.js';
export { OSC52Scanner } from './clipboard.js';
export { resolveSipURLs } from './urls.js';
