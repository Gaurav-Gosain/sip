// Sip web terminal client — xterm.js renderer and input.
//
// The protocol byte stream (msg types 0..7) matches the server-side wire
// format defined in handlers.go. Loaded as a classic script after the
// vendored xterm.js bundle and its addons, all of which publish globals.
(function() {
    'use strict';

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

    const DEFAULT_SETTINGS = {
        transport: 'auto',
        renderer: 'auto',
        fontSize: 14,
        copyOnSelect: false,
        // A blinking cursor is a persistent animation, so it repaints forever
        // on an otherwise idle terminal. Off unless asked for.
        cursorBlink: false,
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
     * Copy text using a layered strategy.
     *
     * The async Clipboard API is the preferred path but exists only in secure
     * contexts, so a LAN IP or an http reverse proxy has no navigator.clipboard
     * at all. Fall back to a hidden textarea and execCommand there, and when
     * even that fails for want of a user gesture, retry on the next one.
     */
    const clipboard = {
        pending: null,
        gestureBound: false,

        write(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => {
                    this.pending = text;
                    this.bindGestureFlush();
                });
                return;
            }
            if (!this.execCopy(text)) {
                this.pending = text;
                this.bindGestureFlush();
            }
        },

        execCopy(text) {
            if (typeof document.execCommand !== 'function') return false;
            const active = document.activeElement;
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '0';
            ta.style.width = '1px';
            ta.style.height = '1px';
            ta.style.opacity = '0';
            (document.body || document.documentElement).appendChild(ta);
            let ok = false;
            try {
                ta.focus();
                ta.select();
                ta.setSelectionRange(0, text.length);
                ok = document.execCommand('copy');
            } catch (e) {
                ok = false;
            }
            ta.remove();
            if (active && typeof active.focus === 'function') active.focus();
            return ok;
        },

        bindGestureFlush() {
            if (this.gestureBound) return;
            this.gestureBound = true;
            const flush = () => {
                const text = this.pending;
                this.pending = null;
                this.gestureBound = false;
                window.removeEventListener('pointerdown', flush, true);
                window.removeEventListener('keydown', flush, true);
                if (text == null) return;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).catch(() => this.execCopy(text));
                } else {
                    this.execCopy(text);
                }
            };
            window.addEventListener('pointerdown', flush, true);
            window.addEventListener('keydown', flush, true);
        },
    };

    class SipTerminal {
        constructor() {
            this.term = null;
            this.fitAddon = null;
            this.webglAddon = null;
            this.canvasAddon = null;
            this.imageAddon = null;
            this.webLinksAddon = null;
            this.kittyOverlay = null;
            this.connected = false;
            this.readOnly = false;
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectDelay = 1000;
            this.pingInterval = null;
            this.encoder = new TextEncoder();
            this.decoder = new TextDecoder();
            this.useWebTransport = false;
            this.wsConnection = null;
            this.wtTransport = null;
            this.wtWriter = null;
            this.wtReader = null;
            this.webTransportUnavailable = false;
            this.resizeTimeout = null;

            // Pre-allocated buffers (read path only; write frames are always
            // allocated fresh so concurrent sends cannot race on one buffer).
            this.pingBuffer = new Uint8Array([MSG_PING]);
            this.writeBuffer = new Uint8Array(64 * 1024);

            // Batch terminal writes with requestAnimationFrame.
            this.pendingWrites = [];
            this.writeScheduled = false;

            // Mouse event deduplication.
            this.lastMouseCell = { col: -1, row: -1, button: -1 };
            this.mouseEventsFiltered = 0;
            this.mouseEventsSent = 0;

            this.settings = this.loadSettings();
            this.fontFamily = sipConfig.fontFamily || FONT_FAMILY;
            this.currentRenderer = 'unknown';
            this.currentTransport = 'unknown';
            this.urls = resolveSipURLs(document.baseURI);

            this.statusEl = null;
            this.statusTextEl = null;
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

        getTerminalOptions() {
            return {
                fontFamily: this.fontFamily,
                fontSize: this.settings.fontSize,
                fontWeight: 'normal',
                fontWeightBold: 'bold',
                // No multiplier. The font's own line box already includes its
                // line gap, so scaling it again renders glyph ink taller than
                // the cell and leaves seams between adjacent rows.
                lineHeight: 1.0,
                letterSpacing: 0,
                cursorBlink: this.settings.cursorBlink,
                cursorStyle: 'block',
                cursorInactiveStyle: 'outline',
                scrollback: 5000,
                tabStopWidth: 8,
                allowProposedApi: true,
                allowTransparency: false,
                smoothScrollDuration: 0,
                macOptionIsMeta: true,
                macOptionClickForcesSelection: true,
                rightClickSelectsWord: true,
                drawBoldTextInBrightColors: false,
                fastScrollModifier: 'alt',
                fastScrollSensitivity: 5,
                minimumContrastRatio: 1,
                theme: {
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
                }
            };
        }

        async init() {
            this.statusEl = document.getElementById('connection-status');
            this.statusTextEl = document.getElementById('status-text');

            // Fonts first: constructing the Terminal before the font resolves
            // makes it measure the fallback and cache the wrong cell box.
            await this.loadFonts();
            this.updateStatus('connecting', 'Initializing terminal...');

            this.term = new Terminal(this.getTerminalOptions());

            // Grapheme clustering. The bundle's own UnicodeV6 provider is a
            // thin wrapper over wcwidth, which splits emoji ZWJ sequences and
            // mismeasures combining marks. The graphemes addon supplies a
            // UAX 29 provider against the same charProperties bit layout.
            try {
                this.term.loadAddon(new UnicodeGraphemesAddon.UnicodeGraphemesAddon());
                this.term.unicode.activeVersion = '15-graphemes';
            } catch (e) {
                console.warn('Unicode graphemes addon failed to load:', e);
            }

            this.fitAddon = new FitAddon.FitAddon();
            this.term.loadAddon(this.fitAddon);

            const container = document.getElementById('terminal');
            this.term.open(container);
            this.installContextMenuPolicy(container);
            this.installReservedKeyCapture();

            // Renderer selection runs after open so the addons have an
            // element to attach to.
            await new Promise(resolve => setTimeout(() => this.initRenderer().then(resolve), 100));

            try {
                this.webLinksAddon = new WebLinksAddon.WebLinksAddon();
                this.term.loadAddon(this.webLinksAddon);
            } catch (e) {}

            // Image addon for sixel only. Kitty graphics are handled by our
            // own KittyOverlay (see xterm-kitty-overlay.js), which renders
            // into an absolutely-positioned DOM layer above the terminal
            // instead of baking images into the cell buffer. The addon's kitty
            // implementation cannot reposition placements, which is fatal for
            // a window manager that moves windows around.
            try {
                this.imageAddon = new ImageAddon.ImageAddon({
                    enableSizeReports: true,
                    sixelSupport: true,
                    sixelScrolling: true,
                    sixelPaletteLimit: 4096,
                    sixelSizeLimit: 25000000,
                    kittySupport: false,
                    storageLimit: 128
                });
                this.term.loadAddon(this.imageAddon);
            } catch (e) {
                console.warn('Image addon failed to load:', e);
            }

            try {
                if (typeof KittyOverlay !== 'undefined') {
                    this.kittyOverlay = new KittyOverlay(this.term, container);
                }
            } catch (e) {
                console.warn('KittyOverlay failed to initialize:', e);
            }

            this.registerOSC52();

            this.fitAddon.fit();

            this.term.onData(data => {
                if (!this.readOnly && this.connected) this.sendInput(data);
            });

            this.term.onBinary(data => {
                if (!this.readOnly && this.connected) this.sendMouseEvent(data);
            });

            this.term.onTitleChange(title => {
                document.title = title || 'Sip';
            });

            this.term.onBell(() => {
                const c = document.getElementById('terminal-container');
                if (!c) return;
                c.style.outline = '2px solid #f9e2af';
                setTimeout(() => { c.style.outline = 'none'; }, 150);
            });

            const resizeObserver = new ResizeObserver(() => this.handleResize());
            resizeObserver.observe(container);
            window.addEventListener('resize', () => this.handleResize(), { passive: true });

            this.setupSettingsPanel();
            this.setupCopyOnSelect();
            this.setupMobileKeyboard();

            await this.connect();
            this.term.focus();
        }

        /**
         * OSC 52 clipboard handler. xterm.js registers none by default, so
         * apps that emit \e]52;c;<base64>\a to copy (tmux, vim, bubbletea's
         * tea.SetClipboard) are otherwise ignored. The server-side osc52gate
         * decides whether the sequence reaches us at all; if it does, we are
         * the consumer.
         */
        registerOSC52() {
            try {
                this.term.parser.registerOscHandler(52, data => {
                    // Format: "<targets>;<payload>", targets = p|s|c|q|...
                    const sep = data.indexOf(';');
                    if (sep < 0) return false;
                    const payload = data.slice(sep + 1);
                    // "?" is a read request. Answering it would echo the
                    // system clipboard back to the remote, so never do.
                    if (payload === '?') return true;
                    // Empty payload is the spec's clear form.
                    if (payload === '') {
                        clipboard.write('');
                        return true;
                    }
                    try {
                        // atob yields one char per byte, and those bytes are
                        // UTF-8, so decode them rather than treating the
                        // latin1 string as the text (which mojibakes anything
                        // outside Latin-1).
                        const binary = atob(payload);
                        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                        clipboard.write(new TextDecoder().decode(bytes));
                    } catch (e) {
                        console.warn('OSC 52: decode failed', e);
                    }
                    return true;
                });
            } catch (e) {
                console.warn('OSC 52 handler registration failed:', e);
            }
        }

        /**
         * Copy-on-select, opt-in and default off. xterm owns the selection
         * made by a plain left-drag; what it does not own is the native
         * browser selection produced by Shift+drag while an app holds mouse
         * tracking. Cover both on mouseup. Reads the setting live so an Apply
         * toggle takes effect without re-binding.
         */
        setupCopyOnSelect() {
            document.addEventListener('mouseup', () => {
                if (!this.settings.copyOnSelect) return;
                const termText = this.term && this.term.getSelection();
                if (termText) {
                    clipboard.write(termText);
                    return;
                }
                const sel = window.getSelection && window.getSelection();
                if (!sel || sel.isCollapsed) return;
                const text = sel.toString();
                if (!text) return;
                const container = document.getElementById('terminal-container');
                if (container && sel.anchorNode && !container.contains(sel.anchorNode)) return;
                clipboard.write(text);
            });
        }

        setupMobileKeyboard() {
            if (!window.visualViewport) return;
            const container = document.getElementById('terminal-container');
            window.visualViewport.addEventListener('resize', () => {
                const keyboardHeight = window.innerHeight - window.visualViewport.height;
                container.style.height = keyboardHeight > 100
                    ? window.visualViewport.height + 'px'
                    : '';
                this.handleResize();
            });
        }

        // Parse an SGR mouse escape sequence and extract cell coordinates.
        parseMouseEvent(data) {
            if (data.length < 6) return null;

            if (data.charCodeAt(0) !== 0x1b ||
                data.charCodeAt(1) !== 0x5b ||
                data.charCodeAt(2) !== 0x3c) {
                return null;
            }

            const rest = data.substring(3);
            const terminator = rest[rest.length - 1];

            if (terminator !== 'M' && terminator !== 'm') return null;

            const parts = rest.substring(0, rest.length - 1).split(';');
            if (parts.length !== 3) return null;

            const button = parseInt(parts[0], 10);
            const col = parseInt(parts[1], 10);
            const row = parseInt(parts[2], 10);

            if (isNaN(button) || isNaN(col) || isNaN(row)) return null;

            return {
                button,
                col,
                row,
                isMotion: (button & 32) !== 0,
                isRelease: terminator === 'm',
            };
        }

        async sendMouseEvent(data) {
            const parsed = this.parseMouseEvent(data);

            if (parsed) {
                // Motion within the same cell tells the app nothing it does
                // not already know, and a busy TUI generates a lot of it.
                if (parsed.isMotion &&
                    parsed.col === this.lastMouseCell.col &&
                    parsed.row === this.lastMouseCell.row &&
                    parsed.button === this.lastMouseCell.button) {
                    this.mouseEventsFiltered++;
                    return;
                }

                this.lastMouseCell.col = parsed.col;
                this.lastMouseCell.row = parsed.row;
                this.lastMouseCell.button = parsed.button;

                if (parsed.isRelease) {
                    this.lastMouseCell = { col: -1, row: -1, button: -1 };
                }

                this.mouseEventsSent++;
            }

            await this.sendBinary(data);
        }

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
                if (reservedKeysInput) {
                    this.settings.captureReservedKeys = reservedKeysInput.checked;
                    this.syncReservedKeyCapture?.();
                }
                this.saveSettings();

                panel.classList.add('hidden');

                // The renderer addon is attached once, when the terminal is
                // opened, so switching it needs a reload rather than a
                // reconnect.
                if (rendererChanged) {
                    window.location.reload();
                    return;
                }

                this.term.options.fontSize = this.settings.fontSize;
                this.term.options.cursorBlink = this.settings.cursorBlink;
                this.fitAddon.fit();

                await this.reconnect();
            });
        }

        updateSettingsInfo() {
            const rendererInfo = document.getElementById('renderer-info');
            const transportInfo = document.getElementById('transport-info');

            rendererInfo.textContent = `Renderer: ${this.currentRenderer}`;
            transportInfo.textContent = `Transport: ${this.currentTransport}`;

            const total = this.mouseEventsSent + this.mouseEventsFiltered;
            if (total > 0) {
                const pct = Math.round(this.mouseEventsFiltered / total * 100);
                transportInfo.textContent += ` | Mouse: ${pct}% filtered`;
            }
        }

        async loadFonts() {
            this.updateStatus('connecting', 'Loading fonts...');

            // A custom deployment font arrives through the server's injected
            // @font-face rule, so only the embedded family is loaded here.
            const fonts = [
                new FontFace('JetBrainsMono Nerd Font Mono', 'url(static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf)', { weight: '400', style: 'normal' }),
                new FontFace('JetBrainsMono Nerd Font Mono', 'url(static/fonts/JetBrainsMonoNerdFontMono-Bold.ttf)', { weight: '700', style: 'normal' }),
                new FontFace('JetBrainsMono Nerd Font Mono', 'url(static/fonts/JetBrainsMonoNerdFontMono-Italic.ttf)', { weight: '400', style: 'italic' }),
                new FontFace('JetBrainsMono Nerd Font Mono', 'url(static/fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf)', { weight: '700', style: 'italic' }),
            ];

            try {
                const loadedFonts = await Promise.all(fonts.map(font => font.load()));
                loadedFonts.forEach(font => document.fonts.add(font));
                await document.fonts.ready;
            } catch (e) {
                console.warn('Font loading failed:', e);
            }
        }

        // Suppress the browser context menu over the terminal so a right click
        // reaches the program instead of being covered by a menu. Shift is the
        // conventional escape hatch: holding it always yields the browser menu,
        // matching how the same modifier bypasses mouse reporting for
        // selection.
        installContextMenuPolicy(container) {
            if (!container) return;
            container.addEventListener('contextmenu', (e) => {
                if (this.settings.browserContextMenu || e.shiftKey) return;
                e.preventDefault();
            });
        }

        // Ask for the keys the browser normally keeps for itself (Ctrl+W,
        // Ctrl+T, Ctrl+N, Ctrl+Tab and so on) so they reach the terminal.
        //
        // preventDefault cannot stop these: browsers reserve them deliberately
        // so a page cannot trap the user. The Keyboard Lock API is the only
        // sanctioned route, and it is granted only while the document is
        // fullscreen, so the lock is taken on entering fullscreen and dropped
        // on leaving. Outside fullscreen these keys keep their browser meaning
        // and there is nothing to be done about it.
        installReservedKeyCapture() {
            if (!navigator.keyboard || typeof navigator.keyboard.lock !== 'function') return;
            const sync = async () => {
                const wantLock = this.settings.captureReservedKeys && !!document.fullscreenElement;
                try {
                    if (wantLock) {
                        await navigator.keyboard.lock([
                            'KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyL',
                            'Tab', 'Escape', 'Digit1', 'Digit2', 'Digit3',
                        ]);
                    } else {
                        navigator.keyboard.unlock();
                    }
                } catch (e) {
                    console.warn('sip: keyboard lock unavailable:', e);
                }
            };
            document.addEventListener('fullscreenchange', sync);
            this.syncReservedKeyCapture = sync;
            sync();
        }

        async initRenderer() {
            const preference = this.settings.renderer;

            if (preference === 'dom') {
                this.currentRenderer = 'DOM';
                return;
            }

            if ((preference === 'webgl' || preference === 'auto') && await this.tryWebGL()) return;
            if ((preference === 'canvas' || preference === 'auto') && this.tryCanvas()) return;

            this.currentRenderer = 'DOM';
        }

        async tryWebGL() {
            try {
                if (!this.term || !this.term.element) return false;

                const testCanvas = document.createElement('canvas');
                const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
                if (!gl) return false;

                this.webglAddon = new WebglAddon.WebglAddon();
                this.webglAddon.onContextLoss(() => {
                    console.log('WebGL context lost');
                    this.webglAddon.dispose();
                    this.webglAddon = null;
                    this.tryCanvas();
                });

                this.term.loadAddon(this.webglAddon);
                this.currentRenderer = 'WebGL';
                return true;
            } catch (e) {
                if (this.webglAddon) {
                    try { this.webglAddon.dispose(); } catch (_) {}
                    this.webglAddon = null;
                }
                return false;
            }
        }

        tryCanvas() {
            try {
                if (typeof CanvasAddon !== 'undefined' && CanvasAddon.CanvasAddon) {
                    this.canvasAddon = new CanvasAddon.CanvasAddon();
                    this.term.loadAddon(this.canvasAddon);
                    this.currentRenderer = 'Canvas';
                    return true;
                }
            } catch (e) {}
            return false;
        }

        async connect() {
            this.updateStatus('connecting', 'Connecting...');

            const preference = this.settings.transport;
            const wantsWebTransport = preference === 'auto' || preference === 'webtransport';
            this.webTransportUnavailable = false;

            if (wantsWebTransport && typeof WebTransport !== 'undefined') {
                try {
                    await this.connectWebTransport();
                    return;
                } catch (e) {
                    console.log('WebTransport unavailable:', e.message);
                    this.webTransportUnavailable = true;
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

        async reconnect() {
            this.handleDisconnect();
            this.reconnectAttempts = 0;
            await this.connect();
        }

        async connectWebTransport() {
            let transportOptions = {};
            let wtUrl = this.urls.wtUrl;

            try {
                const resp = await fetch(this.urls.certHashUrl);
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

            this.wtTransport = new WebTransport(wtUrl, transportOptions);

            this.wtTransport.closed
                .then(() => this.handleDisconnect())
                .catch(() => this.handleDisconnect());

            await this.wtTransport.ready;

            this.useWebTransport = true;
            this.connected = true;
            this.reconnectAttempts = 0;
            this.currentTransport = 'WebTransport (QUIC)';
            this.updateStatus('webtransport', 'Connected (QUIC)');

            const stream = await this.wtTransport.createBidirectionalStream();
            this.wtWriter = stream.writable.getWriter();
            this.wtReader = stream.readable.getReader();

            this.readWebTransportLoop();
            this.sendResize();
            this.startPing();
        }

        async connectWebSocket() {
            return new Promise((resolve, reject) => {
                this.wsConnection = new WebSocket(this.urls.wsUrl);
                this.wsConnection.binaryType = 'arraybuffer';

                this.wsConnection.onopen = () => {
                    this.useWebTransport = false;
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.currentTransport = this.webTransportUnavailable
                        ? 'WebSocket (WebTransport unavailable)'
                        : 'WebSocket';
                    this.updateStatus('connected', `Connected (${this.currentTransport})`);
                    this.sendResize();
                    this.startPing();
                    resolve();
                };

                this.wsConnection.onmessage = event => {
                    if (event.data instanceof ArrayBuffer) {
                        this.handleMessage(new Uint8Array(event.data));
                    }
                };

                this.wsConnection.onerror = reject;
                this.wsConnection.onclose = () => this.handleDisconnect();
            });
        }

        async readWebTransportLoop() {
            if (!this.useWebTransport || !this.wtReader) return;

            let buffer = new Uint8Array(64 * 1024);
            let bufferLen = 0;

            try {
                while (true) {
                    const { value, done } = await this.wtReader.read();
                    if (done) break;

                    if (bufferLen + value.length > buffer.length) {
                        const newBuffer = new Uint8Array(Math.max(buffer.length * 2, bufferLen + value.length));
                        newBuffer.set(buffer.subarray(0, bufferLen));
                        buffer = newBuffer;
                    }

                    buffer.set(value, bufferLen);
                    bufferLen += value.length;

                    let offset = 0;
                    while (bufferLen - offset >= 4) {
                        const msgLen = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);

                        if (msgLen > 16 * 1024 * 1024) {
                            console.error('WebTransport frame too large:', msgLen);
                            return;
                        }

                        if (bufferLen - offset < 4 + msgLen) break;

                        this.handleMessage(buffer.subarray(offset + 4, offset + 4 + msgLen));
                        offset += 4 + msgLen;
                    }

                    if (offset > 0) {
                        if (bufferLen > offset) buffer.copyWithin(0, offset, bufferLen);
                        bufferLen -= offset;
                    }
                }
            } catch (e) {
                if (this.connected) console.error('WebTransport read error:', e);
            }
        }

        handleMessage(data) {
            if (!data || data.length === 0) return;

            switch (data[0]) {
                case MSG_OUTPUT:
                    if (data.length > 1) this.scheduleWrite(data.subarray(1));
                    break;

                case MSG_CLOSE:
                    this.term.write('\r\n\x1b[33m[Session ended. Refresh to start new session.]\x1b[0m\r\n');
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
                        if (this.readOnly) this.updateStatus('connected', 'Connected (Read-Only)');
                    } catch (e) {}
                    break;

                case MSG_PONG:
                    break;
            }
        }

        // Batch terminal writes into one per animation frame.
        scheduleWrite(data) {
            this.pendingWrites.push(new Uint8Array(data));

            if (!this.writeScheduled) {
                this.writeScheduled = true;
                requestAnimationFrame(() => this.flushWrites());
            }
        }

        flushWrites() {
            this.writeScheduled = false;

            if (this.pendingWrites.length === 0) return;

            if (this.pendingWrites.length === 1) {
                this.term.write(this.pendingWrites[0]);
            } else {
                let totalLen = 0;
                for (const w of this.pendingWrites) totalLen += w.length;

                const combined = totalLen <= this.writeBuffer.length
                    ? this.writeBuffer.subarray(0, totalLen)
                    : new Uint8Array(totalLen);

                let offset = 0;
                for (const w of this.pendingWrites) {
                    combined.set(w, offset);
                    offset += w.length;
                }

                this.term.write(combined);
            }

            this.pendingWrites.length = 0;
        }

        async sendInput(data) {
            const encoded = this.encoder.encode(data);

            // A paste arrives from onData as one string, and the server drops
            // an input message over MaxPasteBytes rather than killing the
            // session, so split anything large across several messages. The
            // PTY sees one ordered byte stream either way, so a split in the
            // middle of a multi-byte character is harmless.
            if (encoded.length <= INPUT_CHUNK_SIZE) {
                await this.sendInputChunk(encoded);
                return;
            }
            for (let off = 0; off < encoded.length; off += INPUT_CHUNK_SIZE) {
                await this.sendInputChunk(encoded.subarray(off, off + INPUT_CHUNK_SIZE));
            }
        }

        async sendInputChunk(bytes) {
            const msg = new Uint8Array(bytes.length + 1);
            msg[0] = MSG_INPUT;
            msg.set(bytes, 1);
            await this.send(msg);
        }

        async sendBinary(data) {
            // Allocated fresh so concurrent sends cannot race on one buffer.
            const msg = new Uint8Array(data.length + 1);
            msg[0] = MSG_INPUT;
            for (let i = 0; i < data.length; i++) {
                msg[i + 1] = data.charCodeAt(i);
            }
            await this.send(msg);
        }

        /**
         * Pixel dimensions of the rendered grid. The server forwards these to
         * the PTY winsize, so TUIs that ask for the cell size in pixels (kitty
         * graphics sizing, sixel scaling) get a real answer instead of zeros.
         */
        pixelDimensions() {
            const screen = this.term.element && this.term.element.querySelector('.xterm-screen');
            if (!screen) return { widthPx: 0, heightPx: 0 };
            return {
                widthPx: Math.round(screen.clientWidth),
                heightPx: Math.round(screen.clientHeight),
            };
        }

        async sendResize() {
            if (!this.term) return;

            const px = this.pixelDimensions();
            const payload = this.encoder.encode(JSON.stringify({
                cols: this.term.cols,
                rows: this.term.rows,
                widthPx: px.widthPx,
                heightPx: px.heightPx,
            }));
            const msg = new Uint8Array(payload.length + 1);
            msg[0] = MSG_RESIZE;
            msg.set(payload, 1);
            await this.send(msg);
        }

        async sendPing() {
            await this.send(this.pingBuffer);
        }

        async send(data) {
            if (!this.connected) return;

            try {
                if (this.useWebTransport && this.wtWriter) {
                    const frame = new Uint8Array(4 + data.length);
                    new DataView(frame.buffer).setUint32(0, data.length, false);
                    frame.set(data, 4);
                    await this.wtWriter.write(frame);
                } else if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
                    this.wsConnection.send(data);
                }
            } catch (e) {
                console.error('Send error:', e);
            }
        }

        handleResize() {
            if (!this.fitAddon || !this.term) return;

            if (this.resizeTimeout) clearTimeout(this.resizeTimeout);

            this.resizeTimeout = setTimeout(() => {
                try {
                    this.fitAddon.fit();
                    if (this.connected) this.sendResize();
                } catch (e) {}
            }, 50);
        }

        handleDisconnect() {
            const wasConnected = this.connected;
            this.connected = false;

            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }

            if (this.useWebTransport) {
                if (this.wtWriter) { try { this.wtWriter.releaseLock(); } catch (_) {} this.wtWriter = null; }
                if (this.wtReader) { try { this.wtReader.releaseLock(); } catch (_) {} this.wtReader = null; }
                if (this.wtTransport) { try { this.wtTransport.close(); } catch (_) {} this.wtTransport = null; }
                this.useWebTransport = false;
            }

            if (this.wsConnection) {
                try { this.wsConnection.close(); } catch (_) {}
                this.wsConnection = null;
            }

            this.lastMouseCell = { col: -1, row: -1, button: -1 };

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
                this.term.write('\r\n\x1b[31m[Connection lost. Refresh to reconnect.]\x1b[0m\r\n');
            }
        }

        startPing() {
            if (this.pingInterval) clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => {
                if (this.connected) this.sendPing();
            }, 30000);
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
