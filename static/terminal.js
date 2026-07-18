// Sip web terminal client — libghostty (ghostty-web) renderer.
//
// Wraps the SipTerminal helper from /static/sip-client/, which in turn
// drives the ghostty-web wasm Terminal. The protocol byte stream
// (msg types 0..8) matches the server-side wire format defined in
// handlers.go.

import {
    SipTerminal,
    SipProtocolAdapter,
    SipAutoAdapter,
    resolveSipURLs,
} from './sip-client/sip.js';

const STORAGE_KEY = 'sip-web-settings';
const FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace";

const CATPPUCCIN_MOCHA = {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
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
    brightWhite: '#a6adc8',
};

function loadSettings() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return { transport: 'auto', fontSize: 14, ...JSON.parse(saved) };
    } catch (_) {}
    return { transport: 'auto', fontSize: 14 };
}

function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
}

function isLoopback(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

const settings = loadSettings();

// Per-deployment config injected by the server (see handleIndex).
// Falls back to embedded JetBrainsMono Nerd Font.
const sipConfig = window.__sipConfig || {};
const fontFamily = sipConfig.fontFamily || FONT_FAMILY;

const statusEl = document.getElementById('connection-status');
const statusTextEl = document.getElementById('status-text');

function updateStatus(state, msg) {
    if (!statusEl) return;
    statusEl.classList.remove('connecting', 'connected', 'disconnected', 'reconnecting', 'webtransport');
    statusEl.classList.add(state);
    if (statusTextEl) statusTextEl.textContent = msg;
}

const sipTerm = new SipTerminal('terminal', {
    fontFamily,
    fontSize: settings.fontSize,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    allowOSC52: true,
    convertEol: false,
    theme: CATPPUCCIN_MOCHA,
});

let activeAdapter = null;
let currentTransport = 'unknown';

sipTerm.onStatusChange = (state, message) => {
    let display = message;
    if (state === 'connected') {
        if (currentTransport === 'webtransport') display = 'Connected (WebTransport)';
        else if (currentTransport === 'websocket') display = 'Connected (WebSocket)';
    }
    updateStatus(state === 'connected' && currentTransport === 'webtransport' ? 'webtransport' : state, display);
    const info = document.getElementById('transport-info');
    if (info) info.textContent = `Transport: ${currentTransport}`;
};

sipTerm.onTitleChange = (title) => {
    document.title = title || 'Sip';
};

sipTerm.onBell = () => {
    const c = document.getElementById('terminal-container');
    if (!c) return;
    c.style.outline = '2px solid #f9e2af';
    setTimeout(() => { c.style.outline = 'none'; }, 150);
};

// Wait for all 4 font weights/styles to load before opening the canvas
// renderer. Canvas2D won't synthesize from a partial set — bold/italic
// fall back to system monospace (different glyph metrics, no Nerd Font
// codepoints) until the file is actually loaded.
if (document.fonts?.load) {
    const fam = fontFamily.split(',')[0].trim();
    const px = settings.fontSize || 14;
    try {
        await Promise.race([
            Promise.all([
                document.fonts.load(`${px}px ${fam}`),
                document.fonts.load(`bold ${px}px ${fam}`),
                document.fonts.load(`italic ${px}px ${fam}`),
                document.fonts.load(`bold italic ${px}px ${fam}`),
            ]),
            new Promise((r) => setTimeout(r, 2000)),
        ]);
    } catch (_) {}
}

await sipTerm.init();

const urls = resolveSipURLs(document.baseURI);
const wtSupported = typeof WebTransport !== 'undefined' &&
    (window.location.protocol === 'https:' || isLoopback(window.location.hostname));

function pickAdapter() {
    const callbacks = {
        onTitle: (t) => { document.title = t || 'Sip'; },
        onOptions: (_) => {},
        onClose: (reason) => {
            sipTerm.term?.write(`\r\n${reason}\r\n`);
        },
    };
    switch (settings.transport) {
        case 'webtransport':
            if (!wtSupported) {
                console.warn('WebTransport requested but unsupported; using WebSocket');
                currentTransport = 'websocket';
                return new SipProtocolAdapter(urls.wsUrl, callbacks);
            }
            currentTransport = 'webtransport';
            // Auto-adapter handles cert-hash fetch + WT→WS fallback even
            // in "force WT" mode, keeping the cert handshake centralized.
            return new SipAutoAdapter(urls.wsUrl, urls.wtUrl, urls.certHashUrl, callbacks);
        case 'websocket':
            currentTransport = 'websocket';
            return new SipProtocolAdapter(urls.wsUrl, callbacks);
        case 'auto':
        default:
            currentTransport = wtSupported ? 'webtransport→ws fallback' : 'websocket';
            return new SipAutoAdapter(
                urls.wsUrl,
                wtSupported ? urls.wtUrl : null,
                wtSupported ? urls.certHashUrl : null,
                callbacks,
            );
    }
}

function connect() {
    activeAdapter = pickAdapter();
    sipTerm.connectAdapter(activeAdapter);
    sipTerm.focus();
}

connect();

// --- Settings panel ---
const toggle = document.getElementById('settings-toggle');
const panel = document.getElementById('settings-panel');
const apply = document.getElementById('settings-apply');
const closeBtn = document.getElementById('settings-close');
const transportSelect = document.getElementById('transport-select');
const fontSizeInput = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');

transportSelect.value = settings.transport;
fontSizeInput.value = settings.fontSize;
fontSizeValue.textContent = settings.fontSize + 'px';

toggle.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    const info = document.getElementById('transport-info');
    if (info) info.textContent = `Transport: ${currentTransport}`;
});
closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
fontSizeInput.addEventListener('input', () => {
    fontSizeValue.textContent = fontSizeInput.value + 'px';
}, { passive: true });

apply.addEventListener('click', () => {
    settings.transport = transportSelect.value;
    settings.fontSize = parseInt(fontSizeInput.value, 10);
    saveSettings(settings);

    // Live font-size update; full reconnect would lose scrollback.
    if (sipTerm.term && sipTerm.term.options) {
        sipTerm.term.options.fontSize = settings.fontSize;
    }
    sipTerm.fitAddon?.fit();

    panel.classList.add('hidden');

    // Transport switch requires a reconnect.
    if (activeAdapter) {
        sipTerm.disconnect();
        connect();
    }
});

// --- Mobile keyboard handling ---
if (window.visualViewport) {
    const container = document.getElementById('terminal-container');
    window.visualViewport.addEventListener('resize', () => {
        const keyboardHeight = window.innerHeight - window.visualViewport.height;
        if (keyboardHeight > 100) {
            container.style.height = window.visualViewport.height + 'px';
        } else {
            container.style.height = '';
        }
        sipTerm.fitAddon?.fit();
    });
}

// Right-click selects word in libghostty; suppress browser context menu.
document.getElementById('terminal').addEventListener('contextmenu', (e) => e.preventDefault());

// Surface for debugging / extension consumers.
window.sip = { term: sipTerm, settings };
