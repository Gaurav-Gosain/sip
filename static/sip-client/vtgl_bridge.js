// Drives the vtgl glyph-atlas renderer underneath the ghostty-web bundle.
//
// Layering. A WebGL2 context and a 2D context cannot share one canvas, so vtgl
// gets its own. It is positioned absolutely behind the bundle's canvas, which
// stays in normal flow (so page layout is unchanged) and becomes a transparent
// overlay. vtgl draws the text grid; the bundle keeps drawing everything it
// already knows how to draw on top of it: kitty graphics, the cursor, the
// scrollbar. Selection is tinted here because vtgl has no selection concept.
//
//   z 0  vtgl canvas    text grid + cell backgrounds        (pointer-events: none)
//   z 1  bundle canvas  selection tint, kitty, cursor, bar  (receives input)
//
// The seam. The bundle exposes one hook, `renderer.__sipRenderHook`. When it is
// set, the bundle's renderLine() clears its row instead of painting it, and the
// hook is invoked once per frame after the row pass and before the kitty/cursor
// pass. Everything else in the bundle -- input, selection tracking, clipboard,
// scrollback, link detection, kitty -- runs untouched, which is why this mode
// does not fork the bundle's behavior.
//
// Geometry. The bundle's cell metrics stay authoritative so that toggling the
// renderer never reflows the terminal or shifts mouse hit-testing. vtgl is
// coerced onto those metrics by deriving lineHeight and letterSpacing from
// them. The one value that flows the other way is the text baseline: the
// bundle's block cursor re-draws its cell's glyph with the 2D text path, so
// that path has to sit on vtgl's baseline or the cursor cell's glyph would jump
// relative to its neighbours.

import { SipVtSource, parseHexColor } from './vtgl_source.js';

/** Measure the advance vtgl will measure, using vtgl's own measurement recipe. */
function measureDeviceAdvance(fontFamily, fontSize, dpr) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fontSize * dpr * 0.6;
    ctx.font = `${fontSize * dpr}px ${fontFamily}`;
    const w = ctx.measureText('M').width;
    return w > 0 ? w : fontSize * dpr * 0.6;
}

export class VtglBridge {
    /**
     * @param {object} term the ghostty-web Terminal
     * @param {object} vtgl the vtgl module namespace
     * @param {object} theme sip theme (CSS hex strings)
     */
    constructor(term, vtgl, theme) {
        this.term = term;
        this.vtgl = vtgl;
        this.theme = theme;
        this.renderer = null;     // vtgl renderer
        this.canvas = null;       // vtgl canvas
        this.source = null;
        this.bundleRenderer = null;
        this.installed = false;
        this.lastStats = null;

        // Geometry the vtgl canvas was last sized for.
        this._cols = -1;
        this._rows = -1;
        this._dpr = -1;
        this._cellW = -1;
        this._cellH = -1;
    }

    /** True once the WebGL2 renderer is live and the hook is installed. */
    get active() {
        return this.installed && this.renderer !== null;
    }

    get backend() {
        return this.renderer ? this.renderer.backend : null;
    }

    /**
     * Construct a vtgl renderer whose derived cell size matches the bundle's
     * measured one at the given DPR.
     *
     * vtgl computes its cell box from fontSize, lineHeight and letterSpacing
     * rather than taking one, so those two are solved for here: lineHeight
     * from the bundle's cell height, letterSpacing from the difference between
     * the bundle's cell width and the advance vtgl will measure. Both depend
     * on DPR, which is why a DPR change rebuilds rather than just resizing.
     */
    _makeRenderer(dpr) {
        const br = this.bundleRenderer;
        const m = br.metrics;
        const advance = measureDeviceAdvance(br.fontFamily, br.fontSize, dpr);
        try {
            return new this.vtgl.WebGL2Renderer({
                fontFamily: br.fontFamily,
                fontSize: br.fontSize,
                lineHeight: m.height / br.fontSize,
                letterSpacing: (m.width * dpr - advance) / dpr,
                dpr,
                resolveInverse: true,
                theme: this._theme,
            });
        } catch (_) {
            return null;
        }
    }

    /**
     * Stand the renderer up. Returns false (leaving the bundle's 2D path fully
     * intact) if WebGL2 is unavailable or vtgl fails to construct, so the
     * caller never has to unwind a half-installed state.
     */
    install() {
        const bundleRenderer = this.term && this.term.renderer;
        const bundleCanvas = bundleRenderer && bundleRenderer.getCanvas && bundleRenderer.getCanvas();
        if (!bundleRenderer || !bundleCanvas) return false;
        if (!this.vtgl.supportsWebGL2 || !this.vtgl.supportsWebGL2()) return false;

        this.bundleRenderer = bundleRenderer;

        const fg = parseHexColor(this.theme && this.theme.foreground, 0xcdd6f4);
        const bg = parseHexColor(this.theme && this.theme.background, 0x1e1e2e);
        const cursor = parseHexColor(this.theme && this.theme.cursor, 0xf5e0dc);
        const cursorText = parseHexColor(this.theme && this.theme.cursorAccent, bg);

        const dpr = bundleRenderer.devicePixelRatio || window.devicePixelRatio || 1;
        this._theme = { foreground: fg, background: bg, cursor, cursorText };

        const renderer = this._makeRenderer(dpr);
        if (!renderer) return false;

        const canvas = document.createElement('canvas');
        canvas.className = 'sip-vtgl-canvas';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '0';

        try {
            renderer.mount(canvas);
        } catch (_) {
            return false;
        }

        // Slot the vtgl canvas behind the bundle's, which stays in flow.
        const parent = bundleCanvas.parentElement;
        if (!parent) return false;
        if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
        parent.insertBefore(canvas, bundleCanvas);
        bundleCanvas.style.position = 'relative';
        bundleCanvas.style.zIndex = '1';
        bundleCanvas.style.background = 'transparent';

        this.canvas = canvas;
        this.renderer = renderer;
        this.source = new SipVtSource(fg, bg);
        // The bundle draws the cursor on the overlay, above vtgl's output.
        this.source.hideCursor = true;

        renderer.on('render', (stats) => { this.lastStats = stats; });

        // Keep the bundle's own measurement, since the baseline patch below
        // replaces the metrics object and must not compound across rebuilds.
        this._bundleMetrics = { ...bundleRenderer.metrics };
        this._applyBaseline();

        this._syncGeometry(this.term.cols, this.term.rows, dpr);

        bundleRenderer.__sipRenderHook = (buffer, forceFull, viewportY, provider) => {
            this._onFrame(buffer, forceFull, viewportY, provider);
        };
        this.installed = true;
        return true;
    }

    /**
     * Point the bundle's 2D text path at vtgl's baseline. The block cursor
     * redraws its cell's glyph through that path, so if the two baselines
     * disagree the glyph under the cursor sits a pixel or two off from its
     * neighbours. Cell width and height stay the bundle's.
     */
    _applyBaseline() {
        const vm = this.renderer.getMetrics();
        this.bundleRenderer.metrics = {
            ...this._bundleMetrics,
            baseline: vm.baseline / (vm.dpr || 1),
        };
    }

    /** Tear the hook out and restore the bundle's own 2D grid rendering. */
    uninstall() {
        if (this.bundleRenderer) this.bundleRenderer.__sipRenderHook = null;
        this.installed = false;
        if (this.renderer) {
            try { this.renderer.dispose(); } catch (_) {}
            this.renderer = null;
        }
        if (this.canvas && this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
        this.canvas = null;
        this.source = null;
    }

    /**
     * Resize the vtgl backing store when the grid, cell size or DPR moves.
     * Called from the frame hook so it picks up the bundle's own resize and
     * devicePixelRatio paths without needing to subscribe to either.
     */
    _syncGeometry(cols, rows, dpr) {
        const m = this._bundleMetrics;
        if (cols === this._cols && rows === this._rows && dpr === this._dpr
            && m.width === this._cellW && m.height === this._cellH) {
            return;
        }
        const dprChanged = this._dpr !== -1 && dpr !== this._dpr;
        this._cols = cols;
        this._rows = rows;
        this._dpr = dpr;
        this._cellW = m.width;
        this._cellH = m.height;

        // lineHeight and letterSpacing were solved for the previous DPR, so a
        // DPR change (browser zoom, moving to another display) needs a rebuilt
        // renderer rather than just a resize, or vtgl's cell box drifts off
        // the bundle's by a fraction of a pixel per cell.
        if (dprChanged) {
            const next = this._makeRenderer(dpr);
            if (next) {
                try { this.renderer.dispose(); } catch (_) {}
                next.mount(this.canvas);
                this.renderer = next;
                next.on('render', (stats) => { this.lastStats = stats; });
                this._applyBaseline();
            }
        }

        this.renderer.resize(cols, rows, dpr);
        const vm = this.renderer.getMetrics();
        this.canvas.width = vm.canvasWidth;
        this.canvas.height = vm.canvasHeight;
        this.canvas.style.width = `${m.width * cols}px`;
        this.canvas.style.height = `${m.height * rows}px`;
    }

    _onFrame(buffer, forceFull, viewportY, provider) {
        const renderer = this.renderer;
        if (!renderer) return;

        const dims = buffer.getDimensions();
        const dpr = this.bundleRenderer.devicePixelRatio || 1;
        this._syncGeometry(dims.cols, dims.rows, dpr);

        const source = this.source.frame(buffer, provider, viewportY, forceFull);
        try {
            renderer.render(source, source.viewportTop);
        } catch (_) {
            // A lost context throws until it is restored; vtgl re-creates its
            // resources on webglcontextrestored and forces a full redraw, so
            // dropping this frame is the whole recovery path.
        }

        this._drawSelection(dims.cols, dims.rows);
    }

    /**
     * Tint the selection onto the overlay. vtgl renders no selection, and the
     * bundle's own selection painting lived inside the per-cell background pass
     * that this mode bypasses, so it is reproduced here as a translucent
     * overlay. Runs are coalesced so a full-screen selection is a handful of
     * fillRects rather than one per cell.
     */
    _drawSelection(cols, rows) {
        const br = this.bundleRenderer;
        const sm = br.selectionManager;
        if (!sm || !sm.hasSelection || !sm.hasSelection()) return;

        const ctx = br.ctx;
        const m = br.metrics;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = br.theme.selectionBackground;
        ctx.globalAlpha = 0.45;
        for (let row = 0; row < rows; row++) {
            let runStart = -1;
            for (let col = 0; col <= cols; col++) {
                const inSel = col < cols && br.isInSelection(col, row);
                if (inSel && runStart < 0) {
                    runStart = col;
                } else if (!inSel && runStart >= 0) {
                    ctx.fillRect(runStart * m.width, row * m.height, (col - runStart) * m.width, m.height);
                    runStart = -1;
                }
            }
        }
        ctx.restore();
    }
}
