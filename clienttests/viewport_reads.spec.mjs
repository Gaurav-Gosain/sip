// Guards the per-frame cost of the ghostty-web read path.
//
// getLine(row) is implemented as "walk the whole viewport, then slice one
// row", and the bundle's render loop calls getLine once per damaged row. With
// no memo that makes a single frame O(rows^2 * cols) wasm crossings, which is
// invisible at the 80x24 and 120x40 sizes the rest of the suite runs at and
// ruinous at the ~200x55 a maximised terminal actually uses.
//
// So this asserts the shape of the work, not a wall-clock time: however many
// rows are damaged, a frame must perform at most one full viewport walk. The
// count is the thing that regressed and the count is what is pinned here.
// Timings would be meaningless under SwiftShader anyway.

import { test, expect } from '@playwright/test';

/**
 * Boot the client, then wrap the two functions whose call ratio is the
 * subject of this test: the wasm viewport walk, and the renderer's frame.
 */
async function bootInstrumented(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#connection-status')?.classList.contains('connected'),
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => window.sipTerm?.term?.wasmTerm, null, { timeout: 30_000 });

  return page.evaluate(() => {
    const term = window.sipTerm.term;
    const wasmTerm = term.wasmTerm;
    const stats = { walks: 0, getLineCalls: 0, frames: 0 };
    window.__viewportStats = stats;

    // Count only walks that actually cross into wasm. A memoized call
    // returns the pooled cells without touching the iterators, and the
    // memo is invalidated by writes, so "walk" means "__sipViewportValid
    // was false on entry".
    const getViewport = wasmTerm.getViewport.bind(wasmTerm);
    wasmTerm.getViewport = function () {
      if (!this.__sipViewportValid) stats.walks++;
      return getViewport();
    };

    const getLine = wasmTerm.getLine.bind(wasmTerm);
    wasmTerm.getLine = function (row) {
      stats.getLineCalls++;
      return getLine(row);
    };

    const renderer = term.renderer;
    const render = renderer.render.bind(renderer);
    renderer.render = function (...args) {
      stats.frames++;
      return render(...args);
    };

    return { cols: term.cols, rows: term.rows };
  });
}

const reset = (page) =>
  page.evaluate(() => {
    const s = window.__viewportStats;
    s.walks = s.getLineCalls = s.frames = 0;
  });

const read = (page) => page.evaluate(() => ({ ...window.__viewportStats }));

for (const renderer of ['canvas', 'webgl']) {
  test(`a frame walks the viewport at most once under ${renderer}`, async ({ page }) => {
    const grid = await bootInstrumented(page, `/?renderer=${renderer}`);

    // Fill the screen so rows carry real cells rather than blanks, and so a
    // keystroke damages a row in a populated grid.
    await page.evaluate(() => {
      const term = window.sipTerm.term;
      let out = '';
      for (let row = 0; row < term.rows; row++) {
        out += `\x1b[${row + 1};1H`;
        for (let col = 0; col < term.cols; col++) {
          out += String.fromCharCode(65 + ((row + col) % 26));
        }
      }
      term.write(out);
    });
    await page.waitForTimeout(500);

    await page.locator('#terminal').click();
    await reset(page);

    for (let i = 0; i < 10; i++) {
      await page.keyboard.type('x');
      await page.waitForTimeout(60);
    }

    const stats = await read(page);

    expect(stats.frames, 'typing should produce frames to measure').toBeGreaterThan(0);

    // The regression this pins: getLine was called per damaged row and each
    // call walked the whole viewport, so walks tracked getLine calls. With
    // the memo, walks track frames instead.
    expect(
      stats.walks,
      `${stats.walks} viewport walks across ${stats.frames} frames at ${grid.cols}x${grid.rows} ` +
        `(${stats.getLineCalls} getLine calls); a walk is O(rows*cols) wasm crossings so it must ` +
        'not scale with the number of rows read',
    ).toBeLessThanOrEqual(stats.frames);
  });
}

test('reading every row costs a single walk', async ({ page }) => {
  const grid = await bootInstrumented(page, '/?renderer=canvas');
  await reset(page);

  // Read the whole grid row by row with no writes in between. This is the
  // exact access pattern the render loop uses on a full repaint.
  const rowsRead = await page.evaluate(() => {
    const wasmTerm = window.sipTerm.term.wasmTerm;
    let seen = 0;
    for (let row = 0; row < wasmTerm.rows; row++) {
      if (wasmTerm.getLine(row)) seen++;
    }
    return seen;
  });

  const stats = await read(page);

  expect(rowsRead).toBe(grid.rows);
  expect(stats.getLineCalls).toBe(grid.rows);
  expect(
    stats.walks,
    `reading ${grid.rows} rows caused ${stats.walks} full viewport walks; it should cause 1`,
  ).toBe(1);
});

test('a write invalidates the memo so rows never go stale', async ({ page }) => {
  await bootInstrumented(page, '/?renderer=canvas');

  const result = await page.evaluate(() => {
    const term = window.sipTerm.term;
    const wasmTerm = term.wasmTerm;

    term.write('\x1b[2J\x1b[1;1HAAA');
    const before = wasmTerm
      .getLine(0)
      .slice(0, 3)
      .map((cell) => cell.codepoint);

    term.write('\x1b[1;1HBBB');
    const after = wasmTerm
      .getLine(0)
      .slice(0, 3)
      .map((cell) => cell.codepoint);

    return { before, after };
  });

  expect(result.before).toEqual([65, 65, 65]);
  expect(result.after).toEqual([66, 66, 66]);
});
