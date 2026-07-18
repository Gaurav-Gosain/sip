/**
 * Sip's BubbleTea Communication Adapter
 *
 * Provides an abstraction layer for communicating with BubbleTea programs.
 * Supports both WebSocket (backend-server) and WASM (pure embedding) modes.
 */
/**
 * WASM-based adapter for pure embedding mode
 *
 * Communicates with BubbleTea via global WASM functions:
 * - window.sip_write(data: string): void
 * - window.sip_read(): string
 * - window.sip_resize(cols: number, rows: number): void
 */
export class SipWasmAdapter {
    constructor(pollMs = 16) {
        this.pollMs = pollMs;
        this.pollInterval = null;
        this.onDataCallback = null;
    } // ~60fps
    sipRead() {
        if (typeof window.bubbletea_read !== 'function') {
            console.warn('bubbletea_read not available');
            return null;
        }
        const data = window.bubbletea_read();
        return data || null;
    }
    sipWrite(data) {
        if (typeof window.bubbletea_write !== 'function') {
            console.warn('bubbletea_write not available');
            return;
        }
        const dataStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
        window.bubbletea_write(dataStr);
    }
    sipResize(cols, rows, _widthPx, _heightPx) {
        if (typeof window.bubbletea_resize !== 'function') {
            console.warn('bubbletea_resize not available');
            return;
        }
        window.bubbletea_resize(cols, rows);
        console.log('Sent resize to WASM:', cols, rows);
    }
    connect(onData, onStateChange) {
        this.onDataCallback = onData;
        const startPolling = () => {
            this.pollInterval = window.setInterval(() => {
                const data = this.sipRead();
                if (data && data.length > 0 && this.onDataCallback) {
                    this.onDataCallback(data);
                }
            }, this.pollMs);
            onStateChange('connected', 'Connected');
            console.log('WASM adapter connected, polling at', this.pollMs, 'ms');
        };
        if (typeof window.bubbletea_read === 'function') {
            startPolling();
            return;
        }
        // Wait for WASM module to initialize
        let attempts = 0;
        const checkInterval = window.setInterval(() => {
            if (typeof window.bubbletea_read === 'function') {
                window.clearInterval(checkInterval);
                startPolling();
                return;
            }
            attempts++;
            if (attempts > 100) { // 100 * 50ms = 5 seconds timeout
                window.clearInterval(checkInterval);
                onStateChange('disconnected', 'WASM functions not available');
                console.error('WASM BubbleTea functions not found. Ensure the WASM module is loaded.');
            }
        }, 50);
    }
    disconnect() {
        if (this.pollInterval !== null) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.onDataCallback = null;
    }
}
