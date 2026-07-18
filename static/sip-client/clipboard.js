/**
 * OSC 52 clipboard handler.
 *
 * Scans terminal output for OSC 52 sequences and copies decoded
 * content to the system clipboard.
 *
 * OSC 52 format: \x1b]52;c;<base64-data>\a (or \x1b\\ as terminator)
 */
const OSC_START = '\x1b]52;';
const ST_BEL = '\x07';
const ST_ESC = '\x1b\\';
export class OSC52Scanner {
    constructor(allowOSC52 = false) {
        this.allowOSC52 = allowOSC52;
        this.buffer = '';
    }
    /** Process a chunk of output data, extracting OSC 52 clipboard sequences. */
    scan(data) {
        if (!this.allowOSC52)
            return;
        const text = new TextDecoder().decode(data);
        this.buffer += text;
        let startIdx;
        while ((startIdx = this.buffer.indexOf(OSC_START)) !== -1) {
            const afterStart = startIdx + OSC_START.length;
            let endIdx = this.buffer.indexOf(ST_BEL, afterStart);
            let endLen = 1;
            if (endIdx === -1) {
                endIdx = this.buffer.indexOf(ST_ESC, afterStart);
                endLen = 2;
            }
            if (endIdx === -1) {
                // Incomplete sequence — keep buffering from start
                this.buffer = this.buffer.substring(startIdx);
                return;
            }
            const payload = this.buffer.substring(afterStart, endIdx);
            const semiIdx = payload.indexOf(';');
            if (semiIdx !== -1) {
                const base64Data = payload.substring(semiIdx + 1);
                if (base64Data.length > 0) {
                    try {
                        const decoded = atob(base64Data);
                        navigator.clipboard.writeText(decoded).catch(() => { });
                    }
                    catch {
                        // Invalid base64
                    }
                }
            }
            this.buffer = this.buffer.substring(endIdx + endLen);
        }
        // No OSC start found — clear buffer
        if (this.buffer.indexOf('\x1b]') === -1) {
            this.buffer = '';
        }
    }
}
