// Node-runnable test for the client-side OSC 52 parse path.
//
// Run with: node --test 'clienttests/*.test.mjs'
//
// clipboard.js is a browser ES module with no relative imports, so we load
// its source and import it via a data: URL (ESM regardless of file
// extension) rather than adding a package.json that would land in the Go
// embed. The DOM globals it touches on write (navigator/document/window) are
// absent under node, so _writeClipboard degrades to stashing text in
// this.pending; we override it per-instance to capture what would be copied.

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../static/sip-client/clipboard.js', import.meta.url), 'utf8');
const { OSC52Scanner } = await import('data:text/javascript,' + encodeURIComponent(src));

// osc builds the raw OSC 52 byte sequence for a base64 payload string.
function osc(data, sel = 'c', term = '\x07') {
    return new TextEncoder().encode(`\x1b]52;${sel};${data}${term}`);
}

// capture returns a scanner whose writes land in an array.
function capture(allow = true) {
    const s = new OSC52Scanner(allow);
    const writes = [];
    s._writeClipboard = (t) => { writes.push(t); };
    return { s, writes };
}

test('decodes a basic OSC 52 write', () => {
    const { s, writes } = capture();
    s.scan(osc(btoa('arch-btw')));
    assert.deepEqual(writes, ['arch-btw']);
});

test('decodes multibyte UTF-8 without mojibake', () => {
    const { s, writes } = capture();
    const text = 'café — 日本語 🎉';
    // base64 of the UTF-8 bytes, as a terminal emits it.
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    s.scan(osc(b64));
    assert.deepEqual(writes, [text]);
});

test('accepts the ST (ESC backslash) terminator', () => {
    const { s, writes } = capture();
    s.scan(osc(btoa('via-st'), 'c', '\x1b\\'));
    assert.deepEqual(writes, ['via-st']);
});

test('reassembles a sequence split across scan calls', () => {
    const { s, writes } = capture();
    const full = osc(btoa('split-me'));
    const cut = 9; // mid-sequence, inside the payload
    s.scan(full.slice(0, cut));
    s.scan(full.slice(cut));
    assert.deepEqual(writes, ['split-me']);
});

test('never answers a query read (52;c;?)', () => {
    const { s, writes } = capture();
    s.scan(new TextEncoder().encode('\x1b]52;c;?\x07'));
    assert.deepEqual(writes, [], 'a read query must not produce a clipboard write');
});

test('clear form (empty data) writes an empty string', () => {
    const { s, writes } = capture();
    s.scan(new TextEncoder().encode('\x1b]52;c;\x07'));
    assert.deepEqual(writes, ['']);
});

test('does nothing when OSC 52 is disabled', () => {
    const { s, writes } = capture(false);
    s.scan(osc(btoa('nope')));
    assert.deepEqual(writes, []);
});

test('a non-52 OSC (title) is ignored and does not copy', () => {
    const { s, writes } = capture();
    s.scan(new TextEncoder().encode('\x1b]0;my title\x07'));
    assert.deepEqual(writes, []);
});

test('passes a large payload through intact', () => {
    const { s, writes } = capture();
    const big = 'arch-btw '.repeat(50000); // ~450 KiB
    const b64 = Buffer.from(big, 'utf8').toString('base64');
    // Feed it in small chunks to exercise cross-read buffering.
    const bytes = osc(b64);
    for (let i = 0; i < bytes.length; i += 37) {
        s.scan(bytes.slice(i, i + 37));
    }
    assert.equal(writes.length, 1);
    assert.equal(writes[0], big);
});
