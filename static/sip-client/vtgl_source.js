// Adapts the ghostty-web wasm buffer to the read-only VtSource interface that
// vtgl renders from.
//
// Two coordinate systems meet here. The bundle addresses rows as screen rows
// 0..rows-1 plus a separate scrollback provider, and reports viewportY as "how
// many scrollback lines are showing at the top". vtgl addresses rows
// absolutely across the whole buffer:
//
//   absolute row < scrollbackRows              -> scrollback line, oldest first
//   absolute row >= scrollbackRows             -> active screen line
//
// The two agree because the bundle computes a scrollback line index as
// (scrollbackLength - viewportY + screenRow) and an active line index as
// (screenRow - viewportY), which are the same absolute row expressed either
// side of the boundary. So the absolute top row is simply
// (scrollbackLength - floor(viewportY)).
//
// Colors: the wasm buffer reports rgb(0,0,0) to mean "use the default", not
// "black". The bundle's 2D renderer resolves that against the theme at draw
// time; vtgl expects colors already resolved, so the same substitution happens
// here. True black therefore renders as the theme default, which is exactly
// what the 2D path does today.

const DEFAULT_RGB = 0;

/** Pack a bundle cell's fg/bg triple, substituting the theme default for (0,0,0). */
function packFg(cell, themeFg) {
    const r = cell.fg_r, g = cell.fg_g, b = cell.fg_b;
    if (r === 0 && g === 0 && b === 0) return themeFg;
    return (r << 16) | (g << 8) | b;
}

function packBg(cell, themeBg) {
    const r = cell.bg_r, g = cell.bg_g, b = cell.bg_b;
    if (r === 0 && g === 0 && b === 0) return themeBg;
    return (r << 16) | (g << 8) | b;
}

/**
 * Allocation-free column accessor over one row of bundle cells. Reused across
 * rows; a small ring of these lives on the source so a caller that holds two
 * lines at once still sees distinct views.
 */
class BundleLineView {
    constructor() {
        this.cells = null;
        this.themeFg = 0xcdd6f4;
        this.themeBg = 0x1e1e2e;
        // Screen row for grapheme lookups, or -1 when this row is scrollback
        // (the wasm grapheme table only covers the active screen).
        this.screenRow = -1;
        this.buffer = null;
    }

    bind(cells, screenRow, buffer, themeFg, themeBg) {
        this.cells = cells;
        this.screenRow = screenRow;
        this.buffer = buffer;
        this.themeFg = themeFg;
        this.themeBg = themeBg;
        return this;
    }

    get length() {
        return this.cells ? this.cells.length : 0;
    }

    codepoint(col) {
        const c = this.cells && this.cells[col];
        return c ? c.codepoint : 0;
    }

    grapheme(col) {
        const c = this.cells && this.cells[col];
        if (!c) return ' ';
        if (c.grapheme_len > 0 && this.screenRow >= 0 && this.buffer && this.buffer.getGraphemeString) {
            const s = this.buffer.getGraphemeString(this.screenRow, col);
            if (s) return s;
        }
        return String.fromCodePoint(c.codepoint || 32);
    }

    width(col) {
        const c = this.cells && this.cells[col];
        return c ? c.width : 1;
    }

    fg(col) {
        const c = this.cells && this.cells[col];
        return c ? packFg(c, this.themeFg) : this.themeFg;
    }

    bg(col) {
        const c = this.cells && this.cells[col];
        return c ? packBg(c, this.themeBg) : this.themeBg;
    }

    flags(col) {
        const c = this.cells && this.cells[col];
        return c ? c.flags : 0;
    }
}

/**
 * A VtSource view of the wasm buffer. One instance is retained for the life of
 * the terminal; `frame()` re-points it at the arguments the bundle's renderer
 * was called with, so no per-frame allocation happens on this side either.
 */
export class SipVtSource {
    /**
     * @param {number} themeFg packed 0xRRGGBB default foreground
     * @param {number} themeBg packed 0xRRGGBB default background
     */
    constructor(themeFg, themeBg) {
        this.themeFg = themeFg;
        this.themeBg = themeBg;

        this.buffer = null;          // wasm terminal (active screen + dirty state)
        this.provider = null;        // scrollback provider (the bundle Terminal)
        this._cols = 0;
        this._rows = 0;
        this._scrollbackRows = 0;
        this._forceFull = false;

        this._views = [new BundleLineView(), new BundleLineView(), new BundleLineView(), new BundleLineView()];
        this._viewNext = 0;

        // When the caller draws its own cursor (sip does: the bundle's 2D
        // overlay already handles blink, shape and the block cursor's glyph
        // overpaint), the cursor is reported as hidden so the renderer does
        // not draw a second one on top.
        this.hideCursor = false;

        this._cursor = { x: 0, y: 0, visible: false, shape: 'block', blink: false };
    }

    /**
     * Re-point at the state for one frame. Mirrors the argument list the
     * bundle's renderer.render() receives.
     */
    frame(buffer, provider, viewportY, forceFull) {
        this.buffer = buffer;
        this.provider = provider;
        const dims = buffer.getDimensions();
        this._cols = dims.cols;
        this._rows = dims.rows;
        this._scrollbackRows =
            provider && provider.getScrollbackLength ? provider.getScrollbackLength() : 0;
        this._forceFull = !!forceFull;

        // Absolute row of the top of the viewport.
        this.viewportTop = Math.max(0, this._scrollbackRows - Math.floor(viewportY || 0));

        const cur = buffer.getCursor();
        this._cursor.x = cur.x;
        this._cursor.y = this._scrollbackRows + cur.y;
        this._cursor.visible = this.hideCursor ? false : !!cur.visible;
        this._cursor.shape = cur.style || 'block';
        this._cursor.blink = !!cur.blinking;
        return this;
    }

    setTheme(themeFg, themeBg) {
        this.themeFg = themeFg;
        this.themeBg = themeBg;
    }

    get rows() { return this._rows; }
    get cols() { return this._cols; }
    get scrollbackRows() { return this._scrollbackRows; }

    /** Absolute row -> the bundle's cell array for that row, or null. */
    _cellsFor(row) {
        if (row < this._scrollbackRows) {
            if (!this.provider || !this.provider.getScrollbackLine) return null;
            return this.provider.getScrollbackLine(row);
        }
        const screenRow = row - this._scrollbackRows;
        if (screenRow < 0 || screenRow >= this._rows) return null;
        return this.buffer.getLine(screenRow);
    }

    getLine(row) {
        const view = this._views[this._viewNext];
        this._viewNext = (this._viewNext + 1) % this._views.length;
        const cells = this._cellsFor(row);
        const screenRow = row >= this._scrollbackRows ? row - this._scrollbackRows : -1;
        return view.bind(cells || EMPTY_CELLS, screenRow, this.buffer, this.themeFg, this.themeBg);
    }

    getCell(row, col) {
        const cells = this._cellsFor(row);
        const c = cells && cells[col];
        if (!c) {
            return {
                codepoint: 0,
                grapheme: ' ',
                width: 1,
                fg: this.themeFg,
                bg: this.themeBg,
                flags: 0,
            };
        }
        return {
            codepoint: c.codepoint,
            grapheme: this.getGraphemeString(row, col),
            width: c.width,
            fg: packFg(c, this.themeFg),
            bg: packBg(c, this.themeBg),
            flags: c.flags,
        };
    }

    getGraphemeString(row, col) {
        const cells = this._cellsFor(row);
        const c = cells && cells[col];
        if (!c) return ' ';
        if (c.grapheme_len > 0 && row >= this._scrollbackRows && this.buffer.getGraphemeString) {
            const s = this.buffer.getGraphemeString(row - this._scrollbackRows, col);
            if (s) return s;
        }
        return String.fromCodePoint(c.codepoint || 32);
    }

    getCursor() {
        return this._cursor;
    }

    isRowDirty(row) {
        if (this._forceFull) return true;
        // Scrollback never changes in place; it only grows, and growth shifts
        // the viewport, which vtgl already treats as a full repaint.
        if (row < this._scrollbackRows) return false;
        const screenRow = row - this._scrollbackRows;
        if (screenRow < 0 || screenRow >= this._rows) return false;
        return this.buffer.isRowDirty(screenRow);
    }

    getMode(mode) {
        if (!this.buffer || !this.buffer.getMode) return false;
        try {
            return !!this.buffer.getMode(mode, false);
        } catch (_) {
            return false;
        }
    }
}

const EMPTY_CELLS = [];

/** Parse a CSS hex color ("#rrggbb") to packed 0xRRGGBB. */
export function parseHexColor(css, fallback) {
    if (typeof css !== 'string') return fallback;
    const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
    if (!m) return fallback;
    return parseInt(m[1], 16);
}

export { DEFAULT_RGB };
