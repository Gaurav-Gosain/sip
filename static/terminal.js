// Sip web terminal client.
//
// The terminal itself, its renderer, kitty graphics, clipboard, unicode widths
// and input policy all come from the vendored webterm bundle (static/webterm.js,
// which publishes the WebTerm global). What is left here is the part that is
// sip's and not reusable: the wire protocol (message types 0..7, matching
// handlers.go), the WebTransport length framing, the /cert-hash exchange, the
// settings panel, the status indicator and the reconnect policy.
//
// Loaded as a classic script after the webterm bundle.
(function() {
    'use strict';

    const { WebTerm } = window.WebTerm;

    // Message types (must match server)
    const MSG_INPUT = 0x30;    // '0'
    const MSG_OUTPUT = 0x31;   // '1'
    const MSG_RESIZE = 0x32;   // '2'
    const MSG_PING = 0x33;     // '3'
    const MSG_PONG = 0x34;     // '4'
    const MSG_TITLE = 0x35;    // '5'
    const MSG_OPTIONS = 0x36;  // '6'
    const MSG_CLOSE = 0x37;    // '7'

    // Font family with fallbacks.
    const FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace";

    // Settings storage.
    const STORAGE_KEY = 'sip-web-settings';

    // The server drops a single input message larger than MaxPasteBytes
    // (1 MiB by default) rather than killing the session, so a big paste has
    // to arrive as several messages. 64 KiB stays well under any configured
    // limit and keeps each frame small enough not to stall the socket.
    const INPUT_CHUNK_SIZE = 64 * 1024;

    const MAX_FRAME_BYTES = 16 * 1024 * 1024;

    // Reserved chords worth asking the Keyboard Lock API for. Only ever
    // granted to a fullscreen document, so this does nothing outside one.
    const RESERVED_KEYS = [
        'KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyL',
        'Tab', 'Escape', 'Digit1', 'Digit2', 'Digit3',
    ];

    const DEFAULT_SETTINGS = {
        transport: 'auto',
        renderer: 'auto',
        fontSize: 14,
        // A blinking cursor is a persistent animation, so it repaints forever
        // on an otherwise idle terminal. Off unless asked for.
        cursorBlink: false,
        copyOnSelect: false,
        // The browser context menu covers the terminal on right click, which
        // hides whatever the program under the cursor wanted to do with the
        // button. Terminals suppress it for that reason; turn this on to get
        // the browser menu back.
        browserContextMenu: false,
        // Ctrl+W, Ctrl+T and friends are reserved by the browser and cannot be
        // intercepted by an ordinary page. The Keyboard Lock API hands them to
        // us, but only while the document is fullscreen, so this only takes
        // effect there.
        captureReservedKeys: true,
    };

    const THEME = {
        foreground: '#cdd6f4',
        background: '#1e1e2e',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b70',
        selectionForeground: '#cdd6f4',
        selectionInactiveBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
    };

    // Per-deployment config injected by the server (see renderIndex). Absent
    // unless sip was started with a font or renderer flag.
    const sipConfig = window.__sipConfig || {};

    /**
     * Resolve sip's endpoint URLs against the document base URI, so the page
     * keeps working when the index is served at a non-root path behind a
     * reverse proxy.
     *
     * The WebTransport URL here is only a fallback for a /cert-hash response
     * that omits wtUrl. Normally the server advertises the authoritative
     * endpoint, derived from the host the browser actually reached, and that
     * is the value the same-origin check on both transports expects.
     */
    function resolveSipURLs(baseURI) {
        const base = new URL('./', baseURI);
        const wsScheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
        const httpPort = base.port ? parseInt(base.port, 10) : (base.protocol === 'https:' ? 443 : 80);
        return {
            wsUrl: `${wsScheme}//${base.host}${base.pathname}ws`,
            wtUrl: `https://${base.hostname}:${httpPort + 1}/webtransport`,
            certHashUrl: `${base.origin}${base.pathname}cert-hash`,
        };
    }

    /**
     * sip's wire protocol as a webterm Transport.
     *
     * webterm hands over raw input bytes and knows nothing about the framing;
     * everything sip-specific lives here. `send` is the Transport method and
     * carries terminal input only. Resize, ping and any other control message
     * goes through sendMessage, which the client calls directly, because those
     * are not terminal traffic and the package has no notion of them.
     */
    class SipConnection {
        constructor(client) {
            this.client = client;
            this.sink = null;
            this.ready = null;
            this.closed = false;

            this.useWebTransport = false;
            this.ws = null;
            this.wt = null;
            this.wtWriter = null;
            this.wtReader = null;
            this.webTransportUnavailable = false;
            this.name = 'sip';
        }

        // --- Transport ----------------------------------------------------

        start(sink) {
            this.sink = sink;
            this.ready = this.connect();
            return this.ready;
        }

        /** Terminal input, already chunked by webterm to input.chunkBytes. */
        send(bytes) {
            return this.sendMessage(MSG_INPUT, bytes);
        }

        close() {
            this.teardown();
        }

        // --- Connection ---------------------------------------------------

        async connect() {
            const preference = this.client.settings.transport;
            const wantsWebTransport = preference === 'auto' || preference === 'webtransport';
            this.webTransportUnavailable = false;

            if (wantsWebTransport && typeof WebTransport !== 'undefined') {
                try {
                    await this.connectWebTransport();
                    return;
                } catch (e) {
                    console.log('WebTransport unavailable:', e.message);
                    this.webTransportUnavailable = true;
                    // Drop the half-open transport so the fallback below does
                    // not inherit it and teardown has nothing stale to close.
                    if (this.wt) { try { this.wt.close(); } catch (_) {} this.wt = null; }
                }
            } else if (preference === 'webtransport') {
                console.log('WebTransport requested but this browser does not support it');
                this.webTransportUnavailable = true;
            }

            // Fall back even when WebTransport was explicitly chosen. Chromium
            // refuses a QUIC connection to a loopback origin with a self-signed
            // cert hash where Firefox accepts it, so an honoured preference on
            // one machine is an unreachable one on the next; leaving a dead
            // page there helps nobody. The status line names the transport that
            // actually carried the session, so the fallback is visible rather
            // than silent.
            await this.connectWebSocket();
        }

        async connectWebTransport() {
            const urls = this.client.urls;
            let transportOptions = {};
            let wtUrl = urls.wtUrl;

            try {
                const resp = await fetch(urls.certHashUrl);
                if (resp.ok) {
                    const data = await resp.json();
                    // Prefer the server's own advertised endpoint: it is
                    // derived from the host the browser actually reached, and
                    // the same-origin check on both transports expects that
                    // value rather than a guess.
                    if (data.wtUrl) wtUrl = data.wtUrl;

                    const hashBytes = new Uint8Array(data.hashBytes);
                    transportOptions = {
                        serverCertificateHashes: [{
                            algorithm: 'sha-256',
                            value: hashBytes.buffer
                        }]
                    };
                }
            } catch (e) {}

            const wt = new WebTransport(wtUrl, transportOptions);
            this.wt = wt;

            // Only report a close once this transport is the one carrying the
            // session. A failed handshake settles `closed` too, and treating
            // that as a session close would tear the connection down before
            // the WebSocket fallback has even been tried.
            const reportIfLive = () => {
                if (this.useWebTransport && this.wt === wt) this.reportClosed();
            };
            wt.closed.then(reportIfLive, reportIfLive);

            await wt.ready;

            this.useWebTransport = true;
            const stream = await this.wt.createBidirectionalStream();
            this.wtWriter = stream.writable.getWriter();
            this.wtReader = stream.readable.getReader();

            this.client.onConnected('WebTransport (QUIC)', 'webtransport', 'Connected (QUIC)');
            this.readLoop();
        }

        connectWebSocket() {
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.client.urls.wsUrl);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    this.useWebTransport = false;
                    const name = this.webTransportUnavailable
                        ? 'WebSocket (WebTransport unavailable)'
                        : 'WebSocket';
                    this.client.onConnected(name, 'connected', `Connected (${name})`);
                    resolve();
                };

                this.ws.onmessage = event => {
                    if (event.data instanceof ArrayBuffer) {
                        this.client.handleMessage(new Uint8Array(event.data));
                    }
                };

                this.ws.onerror = reject;
                this.ws.onclose = () => this.reportClosed();
            });
        }

        /**
         * Reassemble the length-prefixed frames sip puts on a WebTransport
         * stream. A QUIC stream is a byte stream with no message boundaries,
         * so the 4-byte big-endian prefix is what re-establishes them.
         */
        async readLoop() {
            if (!this.wtReader) return;

            let buffer = new Uint8Array(64 * 1024);
            let bufferLen = 0;

            try {
                while (true) {
                    const { value, done } = await this.wtReader.read();
                    if (done) break;

                    if (bufferLen + value.length > buffer.length) {
                        const grown = new Uint8Array(Math.max(buffer.length * 2, bufferLen + value.length));
                        grown.set(buffer.subarray(0, bufferLen));
                        buffer = grown;
                    }

                    buffer.set(value, bufferLen);
                    bufferLen += value.length;

                    let offset = 0;
                    while (bufferLen - offset >= 4) {
                        const msgLen = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);

                        if (msgLen > MAX_FRAME_BYTES) {
                            console.error('WebTransport frame too large:', msgLen);
                            return;
                        }

                        if (bufferLen - offset < 4 + msgLen) break;

                        this.client.handleMessage(buffer.subarray(offset + 4, offset + 4 + msgLen));
                        offset += 4 + msgLen;
                    }

                    if (offset > 0) {
                        if (bufferLen > offset) buffer.copyWithin(0, offset, bufferLen);
                        bufferLen -= offset;
                    }
                }
            } catch (e) {
                if (!this.closed) console.error('WebTransport read error:', e);
            }
        }

        /** Prefix `payload` with its message type and put it on the wire. */
        async sendMessage(type, payload) {
            if (this.closed) return;

            const body = payload || new Uint8Array(0);
            const msg = new Uint8Array(body.length + 1);
            msg[0] = type;
            msg.set(body, 1);

            try {
                if (this.useWebTransport && this.wtWriter) {
                    const frame = new Uint8Array(4 + msg.length);
                    new DataView(frame.buffer).setUint32(0, msg.length, false);
                    frame.set(msg, 4);
                    await this.wtWriter.write(frame);
                } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(msg);
                }
            } catch (e) {
                console.error('Send error:', e);
            }
        }

        reportClosed() {
            if (this.closed) return;
            this.teardown();
            if (this.sink) this.sink.closed();
            this.client.handleDisconnect();
        }

        teardown() {
            if (this.closed) return;
            this.closed = true;

            if (this.wtWriter) { try { this.wtWriter.releaseLock(); } catch (_) {} this.wtWriter = null; }
            if (this.wtReader) { try { this.wtReader.releaseLock(); } catch (_) {} this.wtReader = null; }
            if (this.wt) { try { this.wt.close(); } catch (_) {} this.wt = null; }
            if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
        }
    }

    class SipTerminal {
        constructor() {
            this.webterm = null;
            this.connection = null;
            this.connected = false;
            this.readOnly = false;

            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectDelay = 1000;
            this.pingInterval = null;

            this.encoder = new TextEncoder();
            this.decoder = new TextDecoder();

            this.settings = this.loadSettings();
            this.fontFamily = sipConfig.fontFamily || FONT_FAMILY;
            this.currentTransport = 'unknown';
            this.urls = resolveSipURLs(document.baseURI);

            this.statusEl = null;
            this.statusTextEl = null;
        }

        // --- Handles the browser tests and the console reach for ------------
        //
        // These kept their names across the move to the webterm package, so the
        // suites in clienttests/ still describe the client rather than the
        // wrapper underneath it.

        get term() {
            return this.webterm ? this.webterm.xterm : null;
        }

        get kittyOverlay() {
            return this.webterm ? this.webterm.kitty : null;
        }

        get imageAddon() {
            return this.webterm ? this.webterm.image : null;
        }

        /** 'WebGL' | 'Canvas' | 'DOM', the labels the settings panel shows. */
        get currentRenderer() {
            if (!this.webterm) return 'unknown';
            switch (this.webterm.renderer) {
                case 'webgl': return 'WebGL';
                case 'canvas': return 'Canvas';
                default: return 'DOM';
            }
        }

        loadSettings() {
            let stored = {};
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) stored = JSON.parse(saved) || {};
            } catch (e) {}
            const settings = Object.assign({}, DEFAULT_SETTINGS, stored);
            // A ?renderer= query param pins a backend for the browser tests
            // without touching stored settings; the per-deployment config from
            // the sip --renderer flag outranks a default but not a saved
            // preference the user set themselves.
            const q = new URLSearchParams(window.location.search).get('renderer');
            if (q) settings.renderer = q;
            else if (!stored.renderer && sipConfig.renderer) settings.renderer = sipConfig.renderer;
            return settings;
        }

        saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
            } catch (e) {}
        }

        /** The webterm option groups derived from sip's stored settings. */
        webtermOptions() {
            return {
                fontFamily: this.fontFamily,
                fontSize: this.settings.fontSize,
                // A custom deployment font arrives through the server's
                // injected @font-face rule, so only the embedded family is
                // named here. webterm awaits these before it constructs the
                // Terminal, which is what keeps the cell box off the fallback.
                fonts: [
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf)', weight: '400', style: 'normal' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Bold.ttf)', weight: '700', style: 'normal' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Italic.ttf)', weight: '400', style: 'italic' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf)', weight: '700', style: 'italic' },
                ],
                theme: THEME,
                cursorBlink: this.settings.cursorBlink,
                scrollback: 5000,
                links: true,
                renderer: { prefer: this.settings.renderer },
                clipboard: { copyOnSelect: this.settings.copyOnSelect },
                // sip's compositor moves windows between frames and re-emits
                // every placement, so a placement anchored to the buffer row
                // that introduced it would be parked in scrollback by the
                // newlines the compositor itself emitted.
                graphics: { kitty: { anchor: 'viewport' }, sixel: true },
                keyboard: {
                    captureReservedKeys: this.settings.captureReservedKeys,
                    reservedKeys: RESERVED_KEYS,
                },
                mouse: { suppressContextMenu: !this.settings.browserContextMenu },
                input: { chunkBytes: INPUT_CHUNK_SIZE, readOnly: false },
                xterm: { cursorInactiveStyle: 'outline', tabStopWidth: 8 },
            };
        }

        async init() {
            this.statusEl = document.getElementById('connection-status');
            this.statusTextEl = document.getElementById('status-text');
            this.updateStatus('connecting', 'Initializing terminal...');

            this.webterm = new WebTerm(this.webtermOptions());
            await this.webterm.open(document.getElementById('terminal'));

            // Input, mouse reports and kitty protocol replies leave through the
            // attached transport on their own. What is wired here is the part
            // that is sip's: the resize message, the page title and the bell.
            this.webterm.on('resize', () => {
                if (this.connected) this.sendResize();
            });
            this.webterm.on('title', title => {
                document.title = title || 'Sip';
            });
            this.webterm.on('bell', () => {
                const c = document.getElementById('terminal-container');
                if (!c) return;
                c.style.outline = '2px solid #f9e2af';
                setTimeout(() => { c.style.outline = 'none'; }, 150);
            });

            this.setupSettingsPanel();
            this.setupMobileKeyboard();

            await this.connect();
            this.webterm.focus();
        }

        // --- Connection ----------------------------------------------------

        async connect() {
            this.updateStatus('connecting', 'Connecting...');
            const conn = new SipConnection(this);
            this.connection = conn;
            this.webterm.attach(conn);
            try {
                await conn.ready;
            } catch (e) {
                console.error('Connect failed:', e);
                this.handleDisconnect();
            }
        }

        async reconnect() {
            this.webterm.detach();
            this.handleDisconnect();
            this.reconnectAttempts = 0;
            await this.connect();
        }

        /** Called by the connection once a transport is carrying the session. */
        onConnected(name, status, text) {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.currentTransport = name;
            this.updateStatus(status, text);
            this.sendResize();
            this.startPing();
        }

        handleMessage(data) {
            if (!data || data.length === 0) return;

            switch (data[0]) {
                case MSG_OUTPUT:
                    // webterm batches these to one write per animation frame.
                    if (data.length > 1) this.webterm.write(data.subarray(1));
                    break;

                case MSG_CLOSE:
                    this.webterm.write('\r\n\x1b[33m[Session ended. Refresh to start new session.]\x1b[0m\r\n');
                    this.connected = false;
                    this.updateStatus('disconnected', 'Session ended');
                    break;

                case MSG_TITLE:
                    document.title = this.decoder.decode(data.subarray(1)) || 'Sip';
                    break;

                case MSG_OPTIONS:
                    try {
                        const options = JSON.parse(this.decoder.decode(data.subarray(1)));
                        this.readOnly = options.readOnly || false;
                        // Read-only is enforced inside webterm, so keystrokes,
                        // mouse reports and kitty protocol replies alike stop
                        // at the source rather than being filtered per path.
                        this.webterm.setOptions({
                            input: { chunkBytes: INPUT_CHUNK_SIZE, readOnly: this.readOnly },
                        });
                        if (this.readOnly) this.updateStatus('connected', 'Connected (Read-Only)');
                    } catch (e) {}
                    break;

                case MSG_PONG:
                    break;
            }
        }

        handleDisconnect() {
            const wasConnected = this.connected;
            this.connected = false;

            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }

            if (!wasConnected) return;

            this.currentTransport = 'disconnected';
            this.updateStatus('disconnected', 'Disconnected');

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
                this.updateStatus('connecting', `Reconnecting in ${Math.round(delay / 1000)}s...`);
                setTimeout(() => this.connect(), delay);
            } else {
                this.updateStatus('disconnected', 'Connection lost');
                this.webterm.write('\r\n\x1b[31m[Connection lost. Refresh to reconnect.]\x1b[0m\r\n');
            }
        }

        // --- Outbound messages ----------------------------------------------

        /**
         * Send terminal input, as if it had been typed.
         *
         * webterm chunks what leaves through its own data path; this is the
         * direct route the tests and the console use, so it chunks too. The
         * server drops a single input message over MaxPasteBytes rather than
         * killing the session, and the PTY sees one ordered byte stream either
         * way, so a split mid-character is harmless.
         */
        async sendInput(data) {
            if (!this.connection || this.readOnly) return;
            const encoded = this.encoder.encode(data);
            if (encoded.length <= INPUT_CHUNK_SIZE) {
                await this.connection.sendMessage(MSG_INPUT, encoded);
                return;
            }
            for (let off = 0; off < encoded.length; off += INPUT_CHUNK_SIZE) {
                await this.connection.sendMessage(MSG_INPUT, encoded.subarray(off, off + INPUT_CHUNK_SIZE));
            }
        }

        /**
         * Pixel dimensions of the rendered grid. The server forwards these to
         * the PTY winsize, so TUIs that ask for the cell size in pixels (kitty
         * graphics sizing, sixel scaling) get a real answer instead of zeros.
         */
        pixelDimensions() {
            const px = this.webterm ? this.webterm.pixelSize : { width: 0, height: 0 };
            return { widthPx: px.width, heightPx: px.height };
        }

        async sendResize() {
            if (!this.webterm || !this.connection) return;
            const px = this.pixelDimensions();
            const payload = this.encoder.encode(JSON.stringify({
                cols: this.webterm.cols,
                rows: this.webterm.rows,
                widthPx: px.widthPx,
                heightPx: px.heightPx,
            }));
            await this.connection.sendMessage(MSG_RESIZE, payload);
        }

        startPing() {
            if (this.pingInterval) clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => {
                if (this.connected && this.connection) this.connection.sendMessage(MSG_PING, null);
            }, 30000);
        }

        // --- Page furniture --------------------------------------------------

        setupSettingsPanel() {
            const toggle = document.getElementById('settings-toggle');
            const panel = document.getElementById('settings-panel');
            const apply = document.getElementById('settings-apply');
            const close = document.getElementById('settings-close');
            const transportSelect = document.getElementById('transport-select');
            const rendererSelect = document.getElementById('renderer-select');
            const fontSizeInput = document.getElementById('font-size');
            const fontSizeValue = document.getElementById('font-size-value');
            const copyOnSelectInput = document.getElementById('copy-on-select');
            const cursorBlinkInput = document.getElementById('cursor-blink');
            const contextMenuInput = document.getElementById('browser-context-menu');
            const reservedKeysInput = document.getElementById('capture-reserved-keys');

            transportSelect.value = this.settings.transport;
            rendererSelect.value = this.settings.renderer;
            fontSizeInput.value = this.settings.fontSize;
            fontSizeValue.textContent = this.settings.fontSize + 'px';
            copyOnSelectInput.checked = !!this.settings.copyOnSelect;
            cursorBlinkInput.checked = !!this.settings.cursorBlink;
            if (contextMenuInput) contextMenuInput.checked = !!this.settings.browserContextMenu;
            if (reservedKeysInput) reservedKeysInput.checked = !!this.settings.captureReservedKeys;

            toggle.addEventListener('click', () => {
                panel.classList.toggle('hidden');
                this.updateSettingsInfo();
            });

            close.addEventListener('click', () => panel.classList.add('hidden'));

            fontSizeInput.addEventListener('input', () => {
                fontSizeValue.textContent = fontSizeInput.value + 'px';
            }, { passive: true });

            apply.addEventListener('click', async () => {
                const rendererChanged = rendererSelect.value !== this.settings.renderer;

                this.settings.transport = transportSelect.value;
                this.settings.renderer = rendererSelect.value;
                this.settings.fontSize = parseInt(fontSizeInput.value, 10);
                this.settings.copyOnSelect = copyOnSelectInput.checked;
                this.settings.cursorBlink = cursorBlinkInput.checked;
                if (contextMenuInput) this.settings.browserContextMenu = contextMenuInput.checked;
                if (reservedKeysInput) this.settings.captureReservedKeys = reservedKeysInput.checked;
                this.saveSettings();

                panel.classList.add('hidden');

                // The renderer addon is attached once, when the terminal is
                // opened, so switching it needs a reload rather than a
                // reconnect.
                if (rendererChanged) {
                    window.location.reload();
                    return;
                }

                // Every one of these is read live inside webterm, so applying
                // them needs no re-binding and no reload.
                this.webterm.setOptions({
                    fontSize: this.settings.fontSize,
                    cursorBlink: this.settings.cursorBlink,
                    clipboard: { copyOnSelect: this.settings.copyOnSelect },
                    mouse: { suppressContextMenu: !this.settings.browserContextMenu },
                    keyboard: {
                        captureReservedKeys: this.settings.captureReservedKeys,
                        reservedKeys: RESERVED_KEYS,
                    },
                });

                await this.reconnect();
            });
        }

        updateSettingsInfo() {
            const rendererInfo = document.getElementById('renderer-info');
            const transportInfo = document.getElementById('transport-info');
            rendererInfo.textContent = `Renderer: ${this.currentRenderer}`;
            transportInfo.textContent = `Transport: ${this.currentTransport}`;
        }

        setupMobileKeyboard() {
            if (!window.visualViewport) return;
            const container = document.getElementById('terminal-container');
            window.visualViewport.addEventListener('resize', () => {
                const keyboardHeight = window.innerHeight - window.visualViewport.height;
                container.style.height = keyboardHeight > 100
                    ? window.visualViewport.height + 'px'
                    : '';
                // webterm's own ResizeObserver refits from the height change.
            });
        }

        updateStatus(status, text) {
            if (!this.statusEl || !this.statusTextEl) return;

            this.statusEl.className = status;
            this.statusTextEl.textContent = text;

            if (status === 'connected' || status === 'webtransport') {
                setTimeout(() => this.statusEl.classList.add('hidden'), 2000);
            } else {
                this.statusEl.classList.remove('hidden');
            }
        }
    }

    function start() {
        const sipTerm = new SipTerminal();
        // Handle for the browser tests and for debugging from the console.
        window.sipTerm = sipTerm;
        window.sip = { term: sipTerm, settings: sipTerm.settings };
        sipTerm.init().catch(console.error);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
