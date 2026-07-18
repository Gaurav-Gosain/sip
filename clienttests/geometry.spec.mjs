// Cell geometry agreement between the bundle and vtgl, against a real font in
// a real browser.
//
// The defect these pin: the bundle sized its cell from the ink box of "M",
// which has no descender, plus a two-pixel fudge, and vtgl sized its cell from
// the nominal font size with a guessed 0.18 descender. Neither asked the face
// what line box it actually declares, so rows came out shorter than the font
// needs (visibly cramped) and the two sides disagreed on the baseline by a
// pixel, which the bridge then propagated into the bundle's own text path.
//
// Both now measure fontBoundingBoxAscent/Descent, so the assertions are that
// the cell is at least the face's line box and that the two sides agree
// exactly. Nothing here asserts a specific pixel count, since that is a
// property of whichever font the machine actually resolved.

import { test, expect } from '@playwright/test';

async function boot(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#renderer-info')?.dataset.renderer !== undefined,
    null,
    { timeout: 30_000 },
  );
  return page.locator('#renderer-info').getAttribute('data-renderer');
}

/** What the face itself declares at this size, in CSS pixels. */
async function faceLineBox(page) {
  return page.evaluate(() => {
    const r = (window.sipTerm.term ?? window.sipTerm.terminal).renderer;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${r.fontSize}px ${r.fontFamily}`;
    const m = ctx.measureText('M');
    return {
      ascent: m.fontBoundingBoxAscent,
      descent: m.fontBoundingBoxDescent,
      fontSize: r.fontSize,
    };
  });
}

test('the bundle sizes its cell from the face, not from the ink box of "M"', async ({ page }) => {
  await boot(page, '/?renderer=canvas');
  const face = await faceLineBox(page);
  test.skip(!(face.ascent > 0), 'this engine reports no font bounding box');

  const m = await page.evaluate(() => ({ ...(window.sipTerm.term ?? window.sipTerm.terminal).renderer.metrics }));

  // The cell must hold the whole line box. The old derivation produced 15px
  // against an 18px line box for JetBrains Mono at 14px.
  expect(m.height).toBeGreaterThanOrEqual(Math.ceil(face.ascent + face.descent));
  // And the baseline must sit where the face puts it, leaving descender room.
  expect(m.baseline).toBe(Math.round(face.ascent));
  expect(m.height - m.baseline).toBeGreaterThanOrEqual(Math.floor(face.descent));
});

test('vtgl and the bundle agree on cell height and baseline', async ({ page }) => {
  const active = await boot(page, '/?renderer=webgl');
  test.skip(active !== 'webgl', 'webgl renderer unavailable in this environment');

  const g = await page.evaluate(() => {
    const bridge = window.sipTerm.vtglBridge;
    const vm = bridge.renderer.getMetrics();
    return {
      vtglCellH: vm.cellHeight,
      vtglCellW: vm.cellWidth,
      vtglBaseline: vm.baseline,
      dpr: vm.dpr,
      bundle: { ...bridge._bundleMetrics },
      canvasHeight: vm.canvasHeight,
      rows: vm.rows,
    };
  });

  // The bridge coerces vtgl onto the bundle's cell so switching renderers
  // never reflows the grid or moves mouse hit-testing.
  expect(g.vtglCellH).toBe(Math.round(g.bundle.height * g.dpr));
  expect(g.vtglCellW).toBe(Math.round(g.bundle.width * g.dpr));

  // The baseline is the value the bridge pushes back into the bundle's 2D
  // text path, so a disagreement here shows up as the glyph under the block
  // cursor sitting off from its neighbours.
  expect(g.vtglBaseline).toBe(Math.round(g.bundle.baseline * g.dpr));

  // The canvas has to be an exact whole number of cells.
  expect(g.canvasHeight).toBe(g.rows * g.vtglCellH);
});

test('the grid reported to the PTY matches the cell geometry', async ({ page }) => {
  await boot(page, '/?renderer=canvas');
  const ok = await page.evaluate(() => {
    const t = window.sipTerm.term ?? window.sipTerm.terminal;
    const m = t.renderer.metrics;
    const el = t.renderer.getCanvas().parentElement;
    const rows = t.rows;
    // Rows must fit in the space they are drawn into. When the cell was
    // undersized the client claimed more rows than the viewport could show.
    return { rows, fits: rows * m.height <= el.clientHeight + m.height };
  });
  expect(ok.fits).toBe(true);
  expect(ok.rows).toBeGreaterThan(0);
});
