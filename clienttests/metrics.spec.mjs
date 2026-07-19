// Text metrics and glyph tiling for the restored xterm.js client.
//
// This suite pins the second defect that motivated the revert. The ghostty-web
// client drew a block glyph as roughly 20px of font ink into an 18px cell, so
// four stacked rows of U+2588 showed a background-coloured seam wherever two
// rows met, and vtgl and the bundle disagreed on cell height because vtgl
// multiplied an already gap-inclusive line box by a further 1.2 line-height
// factor.
//
// The expectations below are derived from the font's own tables rather than
// from what the client currently does, so a renderer that drifts fails here
// instead of quietly redefining correct. Read from
// static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf:
//
//   unitsPerEm       1000
//   advanceWidth      600  ->  0.60 em
//   hhea ascender    1020
//   hhea descender   -300
//   hhea lineGap        0
//
// So at the client's default 14px with lineHeight 1.0 the cell is
// 0.60 * 14 = 8.4px wide and (1020 + 300 + 0) / 1000 * 14 = 18.48px tall, and
// the baseline sits 1020 / 1000 * 14 = 14.28px below the cell top. 18.48 is
// the number the old client rounded to 18 while rasterising 20px of block ink
// into it, and 18.48 * 1.2 = 22.18 is the number vtgl disagreed by.

import { test, expect } from '@playwright/test';

const FONT = {
  unitsPerEm: 1000,
  advanceWidth: 600,
  ascender: 1020,
  descender: -300,
  lineGap: 0,
};

/** What the font's tables say a cell must be at a given px size. */
function expectedCell(fontSize) {
  const em = FONT.unitsPerEm;
  return {
    width: (FONT.advanceWidth / em) * fontSize,
    height: ((FONT.ascender - FONT.descender + FONT.lineGap) / em) * fontSize,
    baseline: (FONT.ascender / em) * fontSize,
  };
}

async function boot(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  // The font must be the real one before any metric is read. If the FontFace
  // load lost its race with Terminal construction, xterm measured a fallback
  // and every number below would describe the wrong typeface.
  await page.waitForFunction(
    () => document.fonts.check('14px "JetBrainsMono Nerd Font Mono"'),
    null,
    { timeout: 30_000 },
  );
}

/** xterm's own measured cell geometry, in CSS pixels. */
function cellMetrics(page) {
  return page.evaluate(() => {
    const term = window.sipTerm.term;
    const core = term._core;
    const dims = core._renderService.dimensions.css.cell;
    const screen = term.element.querySelector('.xterm-screen');
    return {
      fontSize: term.options.fontSize,
      fontFamily: term.options.fontFamily,
      lineHeight: term.options.lineHeight,
      letterSpacing: term.options.letterSpacing,
      cellWidth: dims.width,
      cellHeight: dims.height,
      charWidth: core._charSizeService.width,
      charHeight: core._charSizeService.height,
      rows: term.rows,
      cols: term.cols,
      screenWidth: screen.clientWidth,
      screenHeight: screen.clientHeight,
    };
  });
}

test('the terminal measures the cell the font says it should', async ({ page }) => {
  await boot(page);
  const m = await cellMetrics(page);

  expect(m.fontFamily).toContain('JetBrainsMono Nerd Font Mono');
  // lineHeight 1.0 is the whole point: the font's line box is already
  // gap-inclusive, so any multiplier here re-introduces the vtgl disagreement.
  expect(m.lineHeight, 'a line-height multiplier double-counts the font line gap').toBe(1);
  expect(m.letterSpacing).toBe(0);

  const want = expectedCell(m.fontSize);

  // Half a pixel of slack: the browser rounds a fractional advance to the
  // device pixel grid, and xterm rounds the line box to an integer cell.
  expect(m.charWidth, `advance should be ${want.width}px at ${m.fontSize}px`).toBeCloseTo(want.width, 1);
  expect(Math.abs(m.cellHeight - want.height), `cell height ${m.cellHeight} vs font line box ${want.height}`).toBeLessThanOrEqual(1);

  // The specific regression: a cell height near 1.2x the line box is vtgl's
  // double-counted gap coming back.
  expect(m.cellHeight, 'cell height looks like the line box multiplied by 1.2 again').toBeLessThan(want.height * 1.15);
});

test('the cell grid tiles the screen exactly', async ({ page }) => {
  // If cell height times rows does not fill the screen box, the leftover is
  // distributed as sub-pixel drift down the viewport, which is the other way a
  // seam appears even when a single cell is the right size.
  await boot(page);
  const m = await cellMetrics(page);

  expect(Math.abs(m.cellHeight * m.rows - m.screenHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(m.cellWidth * m.cols - m.screenWidth)).toBeLessThanOrEqual(1);
});

/**
 * Composite the renderer's canvases and read a vertical strip back.
 *
 * The canvas renderer is pinned because its layers can be composited and read
 * with getImageData; a WebGL context cannot be without preserveDrawingBuffer.
 */
async function sampleColumn(page, text, { columnCell, rows }) {
  return page.evaluate(async ({ text, columnCell, rows }) => {
    const t = window.sipTerm.term;
    t.write('\x1b[H\x1b[2J');
    await new Promise((r) => t.write(text, r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvases = [...document.querySelectorAll('#terminal canvas')];
    const merged = document.createElement('canvas');
    merged.width = canvases[0].width;
    merged.height = canvases[0].height;
    const ctx = merged.getContext('2d');
    for (const c of canvases) ctx.drawImage(c, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const dims = t._core._renderService.dimensions.css.cell;
    const cellW = dims.width * dpr;
    const cellH = dims.height * dpr;

    // Sample down the middle of the requested cell column, spanning `rows`
    // rows and therefore rows-1 row boundaries.
    const x = Math.round(cellW * (columnCell + 0.5));
    const height = Math.round(cellH * rows);
    const data = ctx.getImageData(x, 0, 1, height).data;

    const px = [];
    for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2]]);
    return { px, cellH, cellW };
  }, { text, columnCell, rows });
}

// Catppuccin Mocha, as the client sets it.
const BG = [30, 30, 46];
const near = (c, target, tol) =>
  Math.abs(c[0] - target[0]) < tol && Math.abs(c[1] - target[1]) < tol && Math.abs(c[2] - target[2]) < tol;

test('stacked block glyphs leave no seam between rows', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reads canvas pixels back; the chromium project pins the GL setup');

  // xterm's canvas and webgl renderers draw box and block characters as vector
  // shapes fitted to the cell rather than rasterising them from the font, so a
  // column through several stacked block rows must be foreground the whole way
  // down. This is a structural fix, not a tuning of the old one.
  await boot(page, '/?renderer=canvas');
  await page.waitForFunction(() => window.sipTerm.currentRenderer === 'Canvas', null, { timeout: 30_000 });

  const rows = 6;
  const { px } = await sampleColumn(page, Array(rows).fill('█'.repeat(20)).join('\r\n'), {
    columnCell: 3,
    rows,
  });

  const background = px.filter((c) => near(c, BG, 24));
  expect(px.length).toBeGreaterThan(0);
  expect(
    background.length,
    `a background-coloured pixel inside stacked blocks is the seam (${background.length} of ${px.length})`,
  ).toBe(0);
});

test('adjacent block glyphs leave no seam between columns', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reads canvas pixels back; the chromium project pins the GL setup');

  // The vertical seam was the visible one, but xterm floors the cell width to
  // an integer (8px against the font's 8.4px advance), so a glyph fitted to
  // the wrong box would tile badly across a row as well as down a column.
  await boot(page, '/?renderer=canvas');
  await page.waitForFunction(() => window.sipTerm.currentRenderer === 'Canvas', null, { timeout: 30_000 });

  const px = await page.evaluate(async () => {
    const t = window.sipTerm.term;
    t.write('\x1b[H\x1b[2J');
    await new Promise((r) => t.write('█'.repeat(20), r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvases = [...document.querySelectorAll('#terminal canvas')];
    const merged = document.createElement('canvas');
    merged.width = canvases[0].width;
    merged.height = canvases[0].height;
    const ctx = merged.getContext('2d');
    for (const c of canvases) ctx.drawImage(c, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const dims = t._core._renderService.dimensions.css.cell;
    // A horizontal strip through the middle of the row, spanning 20 cells and
    // therefore 19 column boundaries.
    const y = Math.round(dims.height * dpr * 0.5);
    const data = ctx.getImageData(0, y, Math.round(dims.width * dpr * 20), 1).data;
    const out = [];
    for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
    return out;
  });

  const background = px.filter((c) => near(c, BG, 24));
  expect(px.length).toBeGreaterThan(0);
  expect(
    background.length,
    `a background-coloured pixel between adjacent blocks is a column seam (${background.length} of ${px.length})`,
  ).toBe(0);
});

test('stacked box-drawing verticals leave no seam between rows', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reads canvas pixels back; the chromium project pins the GL setup');

  // The block character is the easy case: it fills its cell in both axes, so a
  // renderer that merely oversized the glyph would still pass. U+2503 draws a
  // stroke that has to meet the cell's top and bottom edge exactly, which is
  // where a rounding error in cell height shows up as a dashed line.
  await boot(page, '/?renderer=canvas');
  await page.waitForFunction(() => window.sipTerm.currentRenderer === 'Canvas', null, { timeout: 30_000 });

  const rows = 6;
  const { px } = await sampleColumn(page, Array(rows).fill('┃').join('\r\n'), { columnCell: 0, rows });

  const background = px.filter((c) => near(c, BG, 24));
  expect(
    background.length,
    `a gap in a continuous vertical rule is the seam (${background.length} of ${px.length})`,
  ).toBe(0);
});

test('a block-heavy fixture is captured for eyeballing', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'the chromium project pins the GL setup');

  // Not an assertion. The seam was found by eye and the pixel checks above
  // only sample two columns, so the run leaves behind an artefact a human can
  // look at: block shades, box-drawing joins and a filled region together.
  await boot(page, '/?renderer=canvas');
  await page.waitForFunction(() => window.sipTerm.currentRenderer === 'Canvas', null, { timeout: 30_000 });

  await page.evaluate(async () => {
    const t = window.sipTerm.term;
    const lines = [
      '┏' + '━'.repeat(30) + '┳' + '━'.repeat(20) + '┓',
      ...Array(4).fill('┃' + '█'.repeat(30) + '┃' + '░▒▓'.repeat(6) + ' ┃'),
      '┣' + '━'.repeat(30) + '╋' + '━'.repeat(20) + '┫',
      ...Array(4).fill('┃' + '▄'.repeat(30) + '┃' + '▀'.repeat(20) + '┃'),
      '┗' + '━'.repeat(30) + '┻' + '━'.repeat(20) + '┛',
    ];
    t.write('\x1b[H\x1b[2J');
    await new Promise((r) => t.write(lines.join('\r\n'), r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // Written to a path rather than attached as a body: the list reporter keeps
  // no report to hold an attachment, so a body would be discarded on success,
  // which is exactly the run where you want the picture.
  const file = testInfo.outputPath('block-and-box-fixture.png');
  await page.locator('#terminal').screenshot({ path: file });
  await testInfo.attach('block-and-box-fixture.png', { path: file, contentType: 'image/png' });
  console.log(`block/box fixture written to ${file}`);
});
