// Cell-grid agreement between the real ghostty-vt wasm and vtgl's torture
// corpus.
//
// vtgl deliberately does not depend on the VT, so its own tests drive a fake
// source and can only assert that the renderer honours the widths it is given.
// The open question that leaves is whether those widths are the ones a real
// grapheme-aware VT actually reports. This suite answers it: each cluster is
// written straight into the ghostty-vt parser (Terminal.write bypasses the PTY,
// so no shell can mangle the bytes), then read back through SipVtSource, which
// is the exact VtSource interface vtgl consumes.
//
// The corpus below mirrors src/testing/torture.ts in the vtgl repo. It is
// duplicated rather than imported because the two repositories are independent
// and vtgl's test sources are not part of its published bundle. Escapes are
// written explicitly so no editor can normalize a combining sequence into its
// precomposed form, which would silently test nothing.

import { test, expect } from '@playwright/test';

const WEBGL = '/?renderer=webgl';

/**
 * name, text, expected columns, expected scalar count, expected cell layout.
 *
 * 'wide' is a width-N head plus N-1 width-0 spacer tails; 'split' is one
 * width-1 cell per scalar. These values are not assumptions: they are what the
 * real ghostty-vt produced when this suite was first run, and vtgl's own corpus
 * records the same measurements.
 */
const CORPUS = [
  ['cjk-han', '\u{4e16}', 2, 1, 'wide'],
  ['cjk-kana', '\u{3042}', 2, 1, 'wide'],
  ['hangul-syllable', '\u{d55c}', 2, 1, 'wide'],
  ['fullwidth-latin', '\u{ff21}', 2, 1, 'wide'],
  ['halfwidth-kana', '\u{ff71}', 1, 1, 'split'],
  ['emoji-simple', '\u{1f600}', 2, 1, 'wide'],
  ['emoji-zwj-family', '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}', 2, 7, 'wide'],
  ['emoji-zwj-profession', '\u{1f469}\u{200d}\u{1f4bb}', 2, 3, 'wide'],
  ['emoji-skin-tone', '\u{1f44d}\u{1f3fd}', 2, 2, 'wide'],
  ['emoji-flag', '\u{1f1ef}\u{1f1f5}', 2, 2, 'wide'],
  ['emoji-tag-flag', '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}', 2, 7, 'wide'],
  ['emoji-keycap', '1\u{fe0f}\u{20e3}', 2, 3, 'wide'],
  ['emoji-zwj-rainbow', '\u{1f3f3}\u{fe0f}\u{200d}\u{1f308}', 2, 4, 'wide'],
  ['vs16-emoji-presentation', '\u{2764}\u{fe0f}', 2, 2, 'wide'],
  ['vs15-text-presentation', '\u{2764}\u{fe0e}', 1, 2, 'split'],
  ['combining-acute', 'e\u{301}', 1, 2, 'split'],
  ['combining-stack', 'e\u{323}\u{300}\u{301}', 1, 4, 'split'],
  ['combining-zalgo', 'a\u{300}\u{301}\u{302}\u{303}\u{308}\u{30a}\u{323}\u{324}\u{325}\u{330}\u{331}', 1, 12, 'split'],
  ['devanagari-ksha', '\u{915}\u{94d}\u{937}', 2, 3, 'wide'],
  ['devanagari-consonant', '\u{928}', 1, 1, 'split'],
  ['devanagari-matra', '\u{928}\u{93f}', 2, 2, 'wide'],
  ['arabic-isolated', '\u{627}', 1, 1, 'split'],
  ['arabic-word', '\u{633}\u{644}\u{627}\u{645}', 4, 4, 'split'],
  ['arabic-lam-alef', '\u{644}\u{627}', 2, 2, 'split'],
];

async function boot(page) {
  await page.goto(WEBGL);
  await page.waitForFunction(
    () => document.querySelector('#renderer-info')?.dataset.renderer !== undefined,
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => document.querySelector('#connection-status')?.classList.contains('connected'),
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => (window.sipTerm || window.__sipTerm)?.vtglBridge?.source !== undefined,
    null,
    { timeout: 30_000 },
  );
}

/**
 * Write every cluster into the VT, one per row, and read the grid back through
 * the adapter vtgl consumes. Done in a single evaluate so the whole corpus
 * shares one screen state and one readback.
 */
async function measureCorpus(page, corpus) {
  return page.evaluate((entries) => {
    const sip = window.sipTerm || window.__sipTerm;
    const term = sip.term;
    const source = sip.vtglBridge.source;

    // Home the cursor and clear, then place each cluster at the start of its
    // own row so a wide cluster cannot be confused with its neighbour.
    term.write('\x1b[H\x1b[2J');
    entries.forEach(([, text], i) => {
      term.write('\x1b[' + (i + 1) + ';1H');
      term.write(text);
    });

    // Let the parser drain before reading the grid back.
    if (typeof term.flushWriteQueue === 'function') term.flushWriteQueue();

    const top = source.scrollbackRows;
    return entries.map(([name, text], i) => {
      const row = top + i;
      const line = source.getLine(row);
      const widths = [];
      const codepoints = [];
      for (let c = 0; c < 8; c++) {
        widths.push(line.width(c));
        codepoints.push(line.codepoint(c));
      }
      return {
        name,
        headWidth: line.width(0),
        widths,
        codepoints,
        grapheme: source.getGraphemeString(row, 0),
        headCodepoint: line.codepoint(0),
        expectedFirstScalar: text.codePointAt(0),
      };
    });
  }, corpus);
}

/**
 * Columns a cluster occupies, measured from what the VT actually wrote.
 *
 * There are two layouts and they cannot be told apart from the head width
 * alone. A wide cluster is a width-N head plus N-1 width-0 spacer tails. A
 * cluster the VT splits per scalar (Arabic letters, Devanagari conjuncts) is a
 * run of width-1 cells, so its extent has to be read off the occupied cells:
 * everything up to the first blank. Getting this wrong is what made lam-alef
 * look like a disagreement when the VT and vtgl in fact agree it takes two
 * columns.
 */
function occupiedColumns(widths, codepoints) {
  if (widths[0] > 1) return widths[0];
  let n = 0;
  while (n < codepoints.length && codepoints[n] !== 0 && codepoints[n] !== 32) n++;
  return Math.max(n, 1);
}

test('ghostty-vt reports the cell widths vtgl assumes for the torture corpus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  expect(measured.length).toBe(CORPUS.length);

  const mismatches = [];
  measured.forEach((m, i) => {
    const [name, , expectedColumns] = CORPUS[i];
    const actual = occupiedColumns(m.widths, m.codepoints);
    if (actual !== expectedColumns) {
      mismatches.push(
        `${name}: vtgl assumes ${expectedColumns} columns, ghostty-vt reports ${actual} ` +
          `(widths ${m.widths.join(',')})`,
      );
    }
  });
  expect(mismatches, mismatches.join('\n')).toEqual([]);
});

test('ghostty-vt keeps multi-scalar clusters on one cell', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);

  const split = [];
  measured.forEach((m, i) => {
    const [name, text, , scalars] = CORPUS[i];
    if (scalars < 2) return;
    // Arabic and Devanagari legitimately occupy one cell per scalar; the ZWJ,
    // flag, keycap and combining cases must not be split.
    // Arabic is the one family ghostty-vt splits per scalar. Devanagari is
    // not: the VT keeps even the ksha conjunct as a single width-2 cluster.
    if (CORPUS[i][4] === 'split' && CORPUS[i][2] > 1) return;
    if (m.grapheme !== text) {
      split.push(
        `${name}: expected the whole cluster on the head cell, got ${JSON.stringify(m.grapheme)}`,
      );
    }
  });
  expect(split, split.join('\n')).toEqual([]);
});

test('report the layout ghostty-vt chose for each cluster', async ({ page }) => {
  // Diagnostic, not a bar: prints the cell layout the real VT produces so the
  // corpus in vtgl can record it rather than guess at it.
  test.setTimeout(120_000);
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  const lines = measured.map((m, i) => {
    const [name, , columns] = CORPUS[i];
    const wide = m.widths[0] > 1;
    return (
      name.padEnd(26) +
      ' declared=' + String(columns) +
      ' widths=' + m.widths.slice(0, 5).join(',') +
      ' layout=' + (wide ? 'wide-head+spacers' : 'one-cell-per-scalar')
    );
  });
  console.log('\n' + lines.join('\n') + '\n');
});

test('ghostty-vt uses the cell layout vtgl records for each cluster', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  const wrong = [];
  measured.forEach((m, i) => {
    const [name, , , , expectedLayout] = CORPUS[i];
    const actual = m.widths[0] > 1 ? 'wide' : 'split';
    if (actual !== expectedLayout) {
      wrong.push(`${name}: recorded ${expectedLayout}, ghostty-vt produced ${actual}`);
    }
  });
  expect(wrong, wrong.join('\n')).toEqual([]);
});

test('the head cell carries the cluster first scalar', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const measured = await measureCorpus(page, CORPUS);
  for (const m of measured) {
    expect(m.headCodepoint, `${m.name} head codepoint`).toBe(m.expectedFirstScalar);
  }
});
