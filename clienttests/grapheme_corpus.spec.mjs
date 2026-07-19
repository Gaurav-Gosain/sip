// Grapheme cluster widths in the xterm.js client, against a corpus measured
// from the real ghostty-vt.
//
// Text correctness was the sole reason the browser client was ever migrated to
// a ghostty-vt bundle, so it is the one thing the revert to xterm.js has to
// answer for. The expectations below are not assumptions and not xterm's own
// output: they are the column counts the real ghostty-vt wasm produced when
// this corpus was first measured, recorded here as the reference the revert is
// held against.
//
// What makes xterm able to meet them is the vendored
// @xterm/addon-unicode-graphemes provider. The bundle's default UnicodeV6
// provider is a thin wrapper over wcwidth: it has no notion of a cluster, so
// it bills every scalar in an emoji ZWJ sequence separately and a family emoji
// eats eight columns instead of two. The graphemes addon supplies UAX 29
// segmentation against the same charProperties bit layout the bundle's
// InputHandler already consumes.
//
// Escapes are written explicitly so no editor can normalize a combining
// sequence into its precomposed form, which would silently test nothing.
//
// Columns are measured as cursor advance rather than by walking cells. The two
// emulators represent a cluster differently -- ghostty splits a combining
// sequence across cells where xterm keeps it in one -- but that is an internal
// representation detail. What a user sees, and what a TUI's layout arithmetic
// depends on, is how far the cursor moved.

import { test, expect } from '@playwright/test';

/**
 * name, text, expected columns.
 *
 * Measured from the real ghostty-vt. See KNOWN_DIVERGENCE below for the one
 * entry where xterm deliberately disagrees.
 */
const CORPUS = [
  ['cjk-han', '\u{4e16}', 2],
  ['cjk-kana', '\u{3042}', 2],
  ['hangul-syllable', '\u{d55c}', 2],
  ['fullwidth-latin', '\u{ff21}', 2],
  ['halfwidth-kana', '\u{ff71}', 1],
  ['emoji-simple', '\u{1f600}', 2],
  ['emoji-zwj-family', '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}', 2],
  ['emoji-zwj-profession', '\u{1f469}\u{200d}\u{1f4bb}', 2],
  ['emoji-skin-tone', '\u{1f44d}\u{1f3fd}', 2],
  ['emoji-flag', '\u{1f1ef}\u{1f1f5}', 2],
  ['emoji-tag-flag', '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}', 2],
  ['emoji-keycap', '1\u{fe0f}\u{20e3}', 2],
  ['emoji-zwj-rainbow', '\u{1f3f3}\u{fe0f}\u{200d}\u{1f308}', 2],
  ['vs16-emoji-presentation', '\u{2764}\u{fe0f}', 2],
  ['vs15-text-presentation', '\u{2764}\u{fe0e}', 1],
  ['combining-acute', 'e\u{301}', 1],
  ['combining-stack', 'e\u{323}\u{300}\u{301}', 1],
  ['combining-zalgo', 'a\u{300}\u{301}\u{302}\u{303}\u{308}\u{30a}\u{323}\u{324}\u{325}\u{330}\u{331}', 1],
  ['devanagari-ksha', '\u{915}\u{94d}\u{937}', 2],
  ['devanagari-consonant', '\u{928}', 1],
  ['devanagari-matra', '\u{928}\u{93f}', 2],
  ['arabic-isolated', '\u{627}', 1],
  ['arabic-word', '\u{633}\u{644}\u{627}\u{645}', 4],
  ['arabic-lam-alef', '\u{644}\u{627}', 2],
];

/**
 * The one case where xterm and ghostty-vt disagree, documented rather than
 * papered over.
 *
 * U+093F DEVANAGARI VOWEL SIGN I is a spacing combining mark. ghostty gives it
 * its own advance, so the cluster is two columns; xterm treats it as part of
 * the preceding cluster and bills one. Both are defensible: the disagreement is
 * about whether a spacing mark earns an advance, not about where the cluster
 * boundary falls, and every other Indic case in this corpus (including the
 * ksha conjunct) agrees exactly.
 *
 * If this ever needs to match ghostty, the cheap fix is a wrapper provider that
 * delegates to the addon and overrides the spacing-mark range. It is not worth
 * a ghostty-vt-backed provider: the wasm exports no standalone width or
 * grapheme-break function, only grid-scoped cell reads, so backing this would
 * mean a shadow VT and a wasm round trip per character on xterm's hottest path.
 */
const KNOWN_DIVERGENCE = {
  'devanagari-matra': { ghostty: 2, xterm: 1 },
};

async function boot(page) {
  await page.goto('/');
  // Wait for the session to settle before measuring. The provider is live as
  // soon as the Terminal is constructed, which is well before init() finishes
  // connecting, and measuring in that window races the transport handshake.
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  // The provider is what this suite exists to exercise, so refuse to measure
  // anything until it is the active one. Without it every emoji case below
  // would fail in a way that looks like a segmentation bug rather than a
  // missing addon.
  await page.waitForFunction(
    () => window.sipTerm.term.unicode.activeVersion === '15-graphemes',
    null,
    { timeout: 30_000 },
  );
}

/**
 * Write each cluster at the start of its own row and record how far the cursor
 * moved. Done in one evaluate so the corpus shares a single screen state.
 */
async function measureCorpus(page, corpus) {
  return page.evaluate(async (entries) => {
    const term = window.sipTerm.term;
    const drain = () => new Promise((r) => term.write('', r));

    term.write('\x1b[H\x1b[2J');
    await drain();

    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const [name, text] = entries[i];
      term.write('\x1b[' + (i + 1) + ';1H');
      term.write(text);
      await drain();
      const buf = term.buffer.active;
      const line = buf.getLine(buf.baseY + i);
      out.push({
        name,
        columns: buf.cursorX,
        headCell: line ? line.getCell(0).getChars() : '',
        headWidth: line ? line.getCell(0).getWidth() : -1,
      });
    }
    return out;
  }, corpus);
}

test('grapheme clusters advance the cursor the way ghostty-vt does', async ({ page }) => {
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  const byName = Object.fromEntries(measured.map((m) => [m.name, m]));

  const mismatches = [];
  for (const [name, text, ghosttyColumns] of CORPUS) {
    const m = byName[name];
    const expected = KNOWN_DIVERGENCE[name]?.xterm ?? ghosttyColumns;
    if (m.columns !== expected) {
      mismatches.push(`${name} (${JSON.stringify(text)}): expected ${expected} columns, measured ${m.columns}`);
    }
  }

  expect(mismatches, mismatches.join('\n')).toEqual([]);

  // Agreement with ghostty on everything outside the documented divergence.
  const diverging = Object.keys(KNOWN_DIVERGENCE);
  const agreeing = CORPUS.filter(([name]) => !diverging.includes(name));
  for (const [name, , ghosttyColumns] of agreeing) {
    expect(byName[name].columns, `${name} must match ghostty-vt exactly`).toBe(ghosttyColumns);
  }
});

test('the devanagari matra divergence is exactly where we think it is', async ({ page }) => {
  // Pinned so the divergence cannot silently spread. If the addon ever changes
  // its spacing-mark policy this fails and the note above gets revisited,
  // rather than the corpus quietly being retuned to whatever xterm now does.
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  const byName = Object.fromEntries(measured.map((m) => [m.name, m]));

  for (const [name, { ghostty, xterm }] of Object.entries(KNOWN_DIVERGENCE)) {
    expect(byName[name].columns, `${name} is the documented divergence`).toBe(xterm);
    expect(xterm, `${name} would not be a divergence if the two agreed`).not.toBe(ghostty);
  }
});

test('a ZWJ sequence occupies one cluster, not one cell per scalar', async ({ page }) => {
  // The specific failure the graphemes provider exists to prevent: without it
  // the wcwidth-only default bills each scalar of a family emoji separately.
  await boot(page);
  const family = await page.evaluate(async () => {
    const term = window.sipTerm.term;
    const drain = () => new Promise((r) => term.write('', r));
    term.write('\x1b[H\x1b[2J');
    await drain();
    // Home the cursor immediately before writing. A shell prompt arriving from
    // the PTY between the clear and the write would otherwise be counted into
    // the cursor advance.
    term.write('\x1b[1;1H\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}');
    await drain();
    const buf = term.buffer.active;
    const cell = buf.getLine(buf.baseY).getCell(0);
    return { columns: buf.cursorX, chars: cell.getChars(), width: cell.getWidth() };
  });

  expect(family.columns).toBe(2);
  expect(family.width).toBe(2);
  // The whole cluster lives in the one cell.
  expect([...family.chars].length).toBeGreaterThan(1);
});
