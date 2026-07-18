// Node-runnable tests for the VtSource adapter that sits between the
// ghostty-web wasm buffer and vtgl.
//
// Run with: node --test 'clienttests/*.test.mjs'
//
// The two things worth pinning down here are the coordinate translation
// (screen rows + a scrollback provider on one side, absolute rows on the
// other) and the default-color substitution, because both are silent
// failures: get them wrong and the terminal still renders, just with the
// wrong rows or invisible text.
//
// Like clipboard.test.mjs, the module is loaded through a data: URL so no
// package.json has to exist next to the browser sources.

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../static/sip-client/vtgl_source.js', import.meta.url), 'utf8');
const { SipVtSource, parseHexColor } = await import('data:text/javascript,' + encodeURIComponent(src));

const FG = 0xcdd6f4;
const BG = 0x1e1e2e;

/** Build a bundle-shaped cell. */
function cell(ch, over = {}) {
    const cp = ch ? ch.codePointAt(0) : 0;
    return {
        codepoint: cp,
        grapheme_len: 0,
        width: 1,
        fg_r: 0, fg_g: 0, fg_b: 0,
        bg_r: 0, bg_g: 0, bg_b: 0,
        flags: 0,
        hyperlink_id: 0,
        ...over,
    };
}

/** Build a row of cells from a string, padded to cols. */
function row(text, cols = 8) {
    const out = [];
    for (const ch of text) out.push(cell(ch));
    while (out.length < cols) out.push(cell(' '));
    return out;
}

/**
 * A stand-in for the wasm buffer plus the bundle Terminal that provides
 * scrollback. Mirrors only the methods the adapter actually calls.
 */
function fakeStack({ screen, scrollback = [], cols = 8, dirty = new Set() }) {
    const buffer = {
        getDimensions: () => ({ cols, rows: screen.length }),
        getLine: (r) => screen[r] ?? null,
        getCursor: () => ({ x: 2, y: 1, visible: true, blinking: false, style: 'block' }),
        isRowDirty: (r) => dirty.has(r),
        getGraphemeString: (r, c) => graphemes.get(`${r},${c}`) ?? '',
        getMode: () => false,
    };
    const graphemes = new Map();
    const provider = {
        getScrollbackLength: () => scrollback.length,
        getScrollbackLine: (i) => scrollback[i] ?? null,
    };
    return { buffer, provider, graphemes };
}

function textOf(view) {
    let s = '';
    for (let i = 0; i < view.length; i++) s += String.fromCodePoint(view.codepoint(i) || 32);
    return s.trimEnd();
}

test('maps absolute rows across the scrollback boundary', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('old0'), row('old1'), row('old2')],
        screen: [row('act0'), row('act1')],
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);

    assert.equal(s.scrollbackRows, 3);
    assert.equal(s.rows, 2);
    // [0,3) is scrollback, [3,5) is the active screen.
    assert.equal(textOf(s.getLine(0)), 'old0');
    assert.equal(textOf(s.getLine(2)), 'old2');
    assert.equal(textOf(s.getLine(3)), 'act0');
    assert.equal(textOf(s.getLine(4)), 'act1');
});

test('viewport top follows the bundle scrollback offset', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('old0'), row('old1'), row('old2')],
        screen: [row('act0'), row('act1')],
    });
    const s = new SipVtSource(FG, BG);

    // Not scrolled: the viewport starts at the active screen.
    assert.equal(s.frame(buffer, provider, 0, false).viewportTop, 3);
    // Scrolled back two lines: two scrollback rows show above the screen,
    // which is exactly the row the bundle would have drawn at screen row 0.
    assert.equal(s.frame(buffer, provider, 2, false).viewportTop, 1);
    // Scrolled to the very top.
    assert.equal(s.frame(buffer, provider, 3, false).viewportTop, 0);
});

test('translates the cursor into absolute coordinates', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('a'), row('b')],
        screen: [row('c'), row('d'), row('e')],
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    const cur = s.getCursor();
    // Buffer reports screen row 1; absolute is scrollbackRows + 1.
    assert.equal(cur.y, 3);
    assert.equal(cur.x, 2);
    assert.equal(cur.shape, 'block');
});

test('substitutes theme defaults for the buffer default color', () => {
    const screen = [row('x')];
    // The wasm buffer reports (0,0,0) to mean "default", not black.
    screen[0][0] = cell('x');
    screen[0][1] = cell('y', { fg_r: 255, fg_g: 128, fg_b: 0, bg_r: 1, bg_g: 2, bg_b: 3 });
    const { buffer, provider } = fakeStack({ screen });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    const line = s.getLine(0);

    assert.equal(line.fg(0), FG);
    assert.equal(line.bg(0), BG);
    assert.equal(line.fg(1), 0xff8000);
    assert.equal(line.bg(1), 0x010203);
});

test('reads dirty state only for active-screen rows', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('a'), row('b')],
        screen: [row('c'), row('d')],
        dirty: new Set([1]),
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);

    // Scrollback is immutable, so never individually dirty.
    assert.equal(s.isRowDirty(0), false);
    assert.equal(s.isRowDirty(1), false);
    // Screen row 0 is absolute row 2, screen row 1 is absolute row 3.
    assert.equal(s.isRowDirty(2), false);
    assert.equal(s.isRowDirty(3), true);
});

test('a forced full redraw dirties every row', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('a')],
        screen: [row('b'), row('c')],
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, true);
    for (let r = 0; r < 3; r++) assert.equal(s.isRowDirty(r), true);
});

test('prefers the wasm grapheme string for multi-codepoint clusters', () => {
    const screen = [row('x')];
    screen[0][0] = cell('\u{1F469}', { grapheme_len: 5, width: 2 });
    screen[0][1] = cell('', { width: 0 });
    const { buffer, provider, graphemes } = fakeStack({ screen });
    graphemes.set('0,0', '\u{1F469}‍\u{1F4BB}');

    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    const line = s.getLine(0);
    assert.equal(line.grapheme(0), '\u{1F469}‍\u{1F4BB}');
    // Width is passed through: 2 for the head, 0 for the spacer tail.
    assert.equal(line.width(0), 2);
    assert.equal(line.width(1), 0);
});

test('falls back to the codepoint when no grapheme table covers the row', () => {
    const { buffer, provider } = fakeStack({
        scrollback: [row('hi')],
        screen: [row('x')],
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    // Scrollback rows have no grapheme table; the codepoint stands in.
    assert.equal(s.getLine(0).grapheme(0), 'h');
    assert.equal(s.getGraphemeString(0, 1), 'i');
});

test('line views survive being held two at a time', () => {
    const { buffer, provider } = fakeStack({
        screen: [row('aaa'), row('bbb')],
    });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    const first = s.getLine(0);
    const second = s.getLine(1);
    assert.equal(textOf(first), 'aaa');
    assert.equal(textOf(second), 'bbb');
});

test('out-of-range rows read as blanks rather than throwing', () => {
    const { buffer, provider } = fakeStack({ screen: [row('a')] });
    const s = new SipVtSource(FG, BG).frame(buffer, provider, 0, false);
    const line = s.getLine(99);
    assert.equal(line.length, 0);
    assert.equal(s.isRowDirty(99), false);
    assert.equal(s.getCell(99, 0).codepoint, 0);
});

test('parses hex colors and falls back on junk', () => {
    assert.equal(parseHexColor('#1e1e2e', 0), 0x1e1e2e);
    assert.equal(parseHexColor('cdd6f4', 0), 0xcdd6f4);
    assert.equal(parseHexColor('rgb(1,2,3)', 0x123456), 0x123456);
    assert.equal(parseHexColor(undefined, 0x123456), 0x123456);
});

test('hideCursor suppresses the cursor for callers that draw their own', () => {
    const { buffer, provider } = fakeStack({ screen: [row('a'), row('b')] });
    const s = new SipVtSource(FG, BG);

    assert.equal(s.frame(buffer, provider, 0, false).getCursor().visible, true);
    s.hideCursor = true;
    const cur = s.frame(buffer, provider, 0, false).getCursor();
    assert.equal(cur.visible, false);
    // Position is still reported; only visibility is suppressed.
    assert.equal(cur.y, 1);
});
