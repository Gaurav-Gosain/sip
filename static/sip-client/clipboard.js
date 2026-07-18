/**
 * OSC 52 clipboard handler.
 *
 * Scans terminal output for OSC 52 sequences and copies decoded
 * content to the system clipboard.
 *
 * OSC 52 format: \x1b]52;<selection>;<base64-data>\a (or \x1b\\ as terminator)
 *
 * Implemented as a byte-level state machine mirroring the server-side gate
 * (middleware/osc52gate). Operating on raw bytes (never on a per-chunk
 * TextDecoder) is what keeps multi-byte UTF-8 copies from turning into
 * mojibake and lets a sequence split across reads decode correctly. Only the
 * OSC 52 payload is ever buffered, and it is capped, so an unrelated OSC (a
 * shell's title sequence on every prompt) can never pin memory.
 */
const ESC = 0x1b;
const BEL = 0x07;
const SEMI = 0x3b; // ';'
const BACKSLASH = 0x5c; // '\' (second byte of ST)
const BRACKET = 0x5d; // ']'

// Cap the buffered base64 payload. ~4 MiB of base64 decodes to ~3 MiB of
// clipboard text; past this we drop the sequence rather than grow unbounded.
const MAX_PAYLOAD = 4 * 1024 * 1024;

// Parser states.
const S_TEXT = 0; // normal output
const S_ESC = 1; // saw ESC
const S_OSC_NUM = 2; // in OSC, reading the numeric Ps
const S_OSC_SKIP = 3; // in a non-52 OSC, skipping to its terminator
const S_OSC_SKIP_ESC = 4; // saw ESC while skipping (maybe ST)
const S_PAYLOAD = 5; // in OSC 52, accumulating payload
const S_PAYLOAD_ESC = 6; // saw ESC in payload (maybe ST terminator)

export class OSC52Scanner {
    constructor(allowOSC52 = false) {
        this.allowOSC52 = allowOSC52;
        this.state = S_TEXT;
        this.numDigits = ''; // Ps digits collected so far
        this.payload = []; // bytes after "52;" (selection + base64)
        this.pending = null; // clipboard text awaiting a user gesture
        this.gestureBound = false;
    }
    _reset() {
        this.state = S_TEXT;
        this.numDigits = '';
        this.payload = [];
    }
    /** Process a chunk of output data, extracting OSC 52 clipboard sequences. */
    scan(data) {
        if (!this.allowOSC52)
            return;
        for (let i = 0; i < data.length; i++) {
            const b = data[i];
            switch (this.state) {
                case S_TEXT:
                    if (b === ESC)
                        this.state = S_ESC;
                    break;
                case S_ESC:
                    if (b === BRACKET) {
                        this.state = S_OSC_NUM;
                        this.numDigits = '';
                    }
                    else if (b !== ESC) {
                        this.state = S_TEXT;
                    }
                    break;
                case S_OSC_NUM:
                    if (b === SEMI) {
                        if (this.numDigits === '52') {
                            this.state = S_PAYLOAD;
                            this.payload = [];
                        }
                        else {
                            this.state = S_OSC_SKIP;
                        }
                    }
                    else if (b >= 0x30 && b <= 0x39 && this.numDigits.length < 4) {
                        this.numDigits += String.fromCharCode(b);
                    }
                    else if (b === BEL) {
                        this.state = S_TEXT;
                    }
                    else if (b === ESC) {
                        this.state = S_ESC;
                    }
                    else {
                        // Non-numeric OSC (e.g. a string command); skip it.
                        this.state = S_OSC_SKIP;
                    }
                    break;
                case S_OSC_SKIP:
                    if (b === BEL)
                        this.state = S_TEXT;
                    else if (b === ESC)
                        this.state = S_OSC_SKIP_ESC;
                    break;
                case S_OSC_SKIP_ESC:
                    if (b === BACKSLASH)
                        this.state = S_TEXT;
                    else if (b === BRACKET) {
                        this.state = S_OSC_NUM;
                        this.numDigits = '';
                    }
                    else if (b !== ESC)
                        this.state = S_OSC_SKIP;
                    break;
                case S_PAYLOAD:
                    if (b === BEL) {
                        this._finalize();
                        this.state = S_TEXT;
                    }
                    else if (b === ESC) {
                        this.state = S_PAYLOAD_ESC;
                    }
                    else {
                        this.payload.push(b);
                        if (this.payload.length > MAX_PAYLOAD) {
                            // Runaway payload — abandon it.
                            this._reset();
                            this.state = S_OSC_SKIP;
                        }
                    }
                    break;
                case S_PAYLOAD_ESC:
                    if (b === BACKSLASH) {
                        this._finalize();
                        this.state = S_TEXT;
                    }
                    else if (b === ESC) {
                        // Stay: ESC ESC, keep waiting for the ST terminator.
                    }
                    else {
                        // Bare ESC inside a base64 payload is malformed; abandon.
                        this._reset();
                    }
                    break;
            }
        }
    }
    _finalize() {
        const payload = this.payload;
        this.payload = [];
        // payload is "<selection>;<base64>"; split on the first ';'.
        const semi = payload.indexOf(SEMI);
        if (semi === -1)
            return;
        const b64bytes = payload.slice(semi + 1);
        if (b64bytes.length === 0) {
            // Clear form ("52;c;" with no data): per the OSC 52 spec this
            // clears the selection. Mirror it by writing an empty string.
            this._writeClipboard('');
            return;
        }
        // base64 is ASCII; latin1 maps each byte 1:1 to a char.
        const b64 = new TextDecoder('latin1').decode(Uint8Array.from(b64bytes));
        // "?" is a read query, not clipboard data. We never answer it: doing
        // so would echo the clipboard back to the remote (an exfiltration
        // hole). Silently ignore the query rather than atob() it.
        if (b64 === '?')
            return;
        let text;
        try {
            const binary = atob(b64);
            const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            text = new TextDecoder().decode(bytes);
        }
        catch {
            return; // invalid base64
        }
        this._writeClipboard(text);
    }
    /** Copy arbitrary text using the same layered strategy as OSC 52 writes. */
    copyText(text) {
        this._writeClipboard(text);
    }
    _writeClipboard(text) {
        // Preferred path: the async Clipboard API, available only in secure
        // contexts (https or localhost).
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {
                // Rejected (no user activation, or permission denied). Retry
                // on the next gesture, falling back to execCommand there.
                this.pending = text;
                this._bindGestureFlush();
            });
            return;
        }
        // Insecure context (LAN IP, or an http reverse proxy without TLS):
        // navigator.clipboard is undefined. The old code stopped here and the
        // copy failed silently forever. Try the legacy execCommand path now;
        // if that fails because it needs a user gesture, defer to the next one.
        if (!this._execCopy(text)) {
            this.pending = text;
            this._bindGestureFlush();
        }
    }
    /**
     * Legacy clipboard write via a hidden textarea + document.execCommand.
     * Works on insecure origins where navigator.clipboard is unavailable, but
     * most browsers only honor it inside a user-gesture callstack. Returns
     * true on success. Mirrors the ghostty-web native copy fallback.
     */
    _execCopy(text) {
        if (typeof document === 'undefined' || typeof document.execCommand !== 'function')
            return false;
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
        }
        catch {
            ok = false;
        }
        ta.remove();
        if (active && typeof active.focus === 'function')
            active.focus();
        return ok;
    }
    _bindGestureFlush() {
        if (this.gestureBound || typeof window === 'undefined')
            return;
        this.gestureBound = true;
        const flush = () => {
            const text = this.pending;
            this.pending = null;
            this.gestureBound = false;
            window.removeEventListener('pointerdown', flush, true);
            window.removeEventListener('keydown', flush, true);
            if (text == null)
                return;
            // Inside a real gesture now: the async API usually succeeds, and
            // execCommand is the last resort on insecure origins.
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
                navigator.clipboard.writeText(text).catch(() => { this._execCopy(text); });
            else
                this._execCopy(text);
        };
        window.addEventListener('pointerdown', flush, true);
        window.addEventListener('keydown', flush, true);
    }
}
