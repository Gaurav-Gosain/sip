// End-to-end checks for the vtgl (renderer=webgl) path against a running sip
// server.
//
// What these tests are actually pinning down, in order of how badly a
// regression would hurt:
//
//  1. The WebGL renderer takes over at all, and the 2D canvas stays on top as
//     a transparent overlay rather than painting over it.
//  2. Text actually lands on the WebGL canvas, in the right rows, for ascii,
//     CJK and emoji.
//  3. The bundle's own machinery still works underneath: input, selection,
//     clipboard, scrollback, kitty graphics.
//  4. A lost GL context recovers instead of leaving a dead terminal.
//
// Everything is asserted structurally (which canvas has ink, and where),
// never as pixel-exact comparisons: headless GL is SwiftShader and its
// rasterization does not match Canvas2D's fillText pixel for pixel.

import { test, expect } from '@playwright/test';

const WEBGL = '/?renderer=webgl';
const CANVAS = '/?renderer=canvas';

/** Wait until the client has booted and reports which renderer won. */
async function boot(page, url) {
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#renderer-info')?.dataset.renderer !== undefined,
    null,
    { timeout: 30_000 },
  );
  // The shell needs to be connected before typing into it means anything.
  await page.waitForFunction(
    () => document.querySelector('#connection-status')?.classList.contains('connected'),
    null,
    { timeout: 30_000 },
  );
  return page.locator('#renderer-info').getAttribute('data-renderer');
}

/** Type a shell command and give the output a moment to land. */
async function run(page, cmd) {
  await page.locator('#terminal').click();
  await page.keyboard.type(cmd);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/**
 * Read back one canvas as per-row ink: for each terminal row, how many pixels
 * differ from the terminal background, and how far right the rightmost such
 * pixel sits (in columns).
 *
 * The WebGL context is created with preserveDrawingBuffer: false, so its
 * drawing buffer is undefined once the frame has been composited -- reading it
 * later yields a cleared buffer and every pixel looks like ink. The fix is to
 * force a synchronous full redraw and read it back in the same task, before
 * the compositor gets a turn. Without this the assertions below pass
 * vacuously, which is exactly what happened the first time these were written.
 */
async function inkByRow(page, which) {
  return page.evaluate((sel) => {
    const t = window.__sipTest.term.term;
    const canvas = sel === 'vtgl'
      ? document.querySelector('canvas.sip-vtgl-canvas')
      : document.querySelector('#terminal canvas:not(.sip-vtgl-canvas)');
    if (!canvas) return null;

    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });

    t.renderer.render(t.wasmTerm, true, t.viewportY || 0, t);
    ctx.drawImage(canvas, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, copy.width, copy.height);

    const rows = t.rows;
    const cols = t.cols;
    const cellH = height / rows;
    const cellW = width / cols;
    const count = new Array(rows).fill(0);
    const maxX = new Array(rows).fill(-1);
    // Catppuccin Mocha background, the terminal default.
    const [br, bg, bb] = [0x1e, 0x1e, 0x2e];
    for (let y = 0; y < height; y++) {
      const row = Math.min(rows - 1, Math.floor(y / cellH));
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue;
        if (Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb) > 24) {
          count[row]++;
          if (x > maxX[row]) maxX[row] = x;
        }
      }
    }
    return {
      count,
      widthCols: maxX.map((x) => (x < 0 ? 0 : Math.round((x + 1) / cellW))),
      total: count.reduce((a, b) => a + b, 0),
    };
  }, which);
}

/** Sanity check that a readback saw a real background, not a cleared buffer. */
function assertNotCleared(ink, rows) {
  const saturated = ink.count.filter((n) => n > 0).length;
  expect(saturated, 'every row has ink: the drawing buffer was read after compositing')
    .toBeLessThan(rows);
}

// Expose a little state the assertions need, without reaching into the bundle
// from every test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const install = () => {
      const t = window.sipTerm || window.__sipTerm;
      if (!t || !t.term) return false;
      window.__sipTest = {
        get rows() { return t.term.rows; },
        get cols() { return t.term.cols; },
        term: t,
      };
      return true;
    };
    const iv = setInterval(() => { if (install()) clearInterval(iv); }, 50);
  });
});

test('webgl renderer activates and layers behind a transparent 2D overlay', async ({ page }) => {
  const active = await boot(page, WEBGL);
  expect(active).toBe('webgl');

  const layout = await page.evaluate(() => {
    const vtgl = document.querySelector('canvas.sip-vtgl-canvas');
    const overlay = document.querySelector('#terminal canvas:not(.sip-vtgl-canvas)');
    if (!vtgl || !overlay) return null;
    const vs = getComputedStyle(vtgl);
    const os = getComputedStyle(overlay);
    return {
      vtglZ: vs.zIndex,
      overlayZ: os.zIndex,
      vtglPointerEvents: vs.pointerEvents,
      // The vtgl canvas must come first in document order and cover the
      // same box as the overlay, or the two grids would not line up.
      vtglFirst: vtgl.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
      sameBox:
        Math.abs(vtgl.getBoundingClientRect().width - overlay.getBoundingClientRect().width) < 1 &&
        Math.abs(vtgl.getBoundingClientRect().height - overlay.getBoundingClientRect().height) < 1,
      hasGL: !!vtgl.getContext('webgl2'),
    };
  });

  expect(layout).not.toBeNull();
  expect(layout.hasGL).toBe(true);
  expect(Number(layout.vtglZ)).toBeLessThan(Number(layout.overlayZ));
  expect(layout.vtglPointerEvents).toBe('none');
  expect(layout.vtglFirst).toBeTruthy();
  expect(layout.sameBox).toBe(true);
});

test('the default path is unchanged and stays on the 2D canvas', async ({ page }) => {
  const active = await boot(page, CANVAS);
  expect(active).toBe('canvas');
  const vtglPresent = await page.evaluate(() => !!document.querySelector('canvas.sip-vtgl-canvas'));
  expect(vtglPresent).toBe(false);

  await run(page, 'clear; printf "default-path-ok\\n"');
  const ink = await inkByRow(page, 'overlay');
  assertNotCleared(ink, ink.count.length);
  // "default-path-ok" is 15 columns; it must be on the 2D canvas.
  expect(ink.widthCols[0]).toBeGreaterThanOrEqual(14);
  expect(ink.widthCols[0]).toBeLessThanOrEqual(17);
});

test('golden scenarios render on the webgl canvas, not the overlay', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');

  await run(page, 'clear; printf "ascii ABC xyz 0123\\n\\u4f60\\u597d\\u4e16\\u754c CJK\\n\\U0001F600\\U0001F469\\u200D\\U0001F4BB emoji\\n"');

  const vtglInk = await inkByRow(page, 'vtgl');
  const overlayInk = await inkByRow(page, 'overlay');
  assertNotCleared(vtglInk, vtglInk.count.length);

  // Each scenario lands on its own row, at its own expected display width.
  // "ascii ABC xyz 0123" is 18 columns.
  expect(vtglInk.widthCols[0]).toBeGreaterThanOrEqual(17);
  expect(vtglInk.widthCols[0]).toBeLessThanOrEqual(20);
  // Four CJK glyphs (8 columns) + " CJK" (4) = 12.
  expect(vtglInk.widthCols[1]).toBeGreaterThanOrEqual(11);
  expect(vtglInk.widthCols[1]).toBeLessThanOrEqual(14);
  // Two emoji clusters (4 columns) + " emoji" (6) = 10. The ZWJ sequence
  // must be one cluster of width 2, not two separate glyphs.
  expect(vtglInk.widthCols[2]).toBeGreaterThanOrEqual(9);
  expect(vtglInk.widthCols[2]).toBeLessThanOrEqual(12);

  // Rows past the prompt are genuinely blank, which is what proves the
  // background is being read correctly rather than a cleared buffer.
  for (let r = 4; r < vtglInk.count.length; r++) {
    expect(vtglInk.count[r], `row ${r} should be blank`).toBe(0);
  }

  // The overlay carries only the cursor. This is the assertion that catches
  // the 2D renderer being left on and double-drawing the whole grid.
  expect(overlayInk.total).toBeLessThan(vtglInk.total / 3);
});

test('wide and zero-width cells keep the grid aligned', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');

  // Four CJK glyphs must advance two columns each: eight columns total. If
  // the width-2 head / width-0 spacer handling were wrong this would come
  // back as four columns (spacers dropped) or sixteen (spacers drawn).
  await run(page, 'clear; printf "\\u4f60\\u597d\\u4f60\\u597d\\n"');
  const wide = await inkByRow(page, 'vtgl');
  assertNotCleared(wide, wide.count.length);
  expect(wide.widthCols[0]).toBeGreaterThanOrEqual(8);
  expect(wide.widthCols[0]).toBeLessThanOrEqual(9);

  // The same count of narrow glyphs occupies half the width.
  await run(page, 'clear; printf "abcd\\n"');
  const narrow = await inkByRow(page, 'vtgl');
  expect(narrow.widthCols[0]).toBeGreaterThanOrEqual(4);
  expect(narrow.widthCols[0]).toBeLessThanOrEqual(5);
});

test('selection and clipboard still work under the webgl renderer', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');
  await run(page, 'clear; printf "selectable-text-marker\\n"');

  // Drag across the first row on the overlay canvas, which is the element
  // that still receives pointer events.
  const box = await page.locator('#terminal canvas:not(.sip-vtgl-canvas)').boundingBox();
  const cell = await page.evaluate(() => {
    const m = window.__sipTest.term.term.renderer.getMetrics();
    return { w: m.width, h: m.height };
  });

  await page.mouse.move(box.x + 1, box.y + cell.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + cell.w * 21, box.y + cell.h * 0.5, { steps: 10 });
  await page.mouse.up();

  const selection = await page.evaluate(() => window.__sipTest.term.getSelection());
  expect(selection).toContain('selectable-text-marker');

  // The selection tint is drawn onto the overlay by the bridge; without it
  // a selection would be invisible in this mode.
  const overlayInk = await inkByRow(page, 'overlay');
  expect(overlayInk.count[0]).toBeGreaterThan(100);

  // And the copy path still reaches the real clipboard.
  await page.evaluate(() => window.__sipTest.term.copySelection());
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('selectable-text-marker');
});

test('kitty graphics composite above the webgl canvas', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');
  await run(page, 'clear');

  // A 24x24 pure-red RGB image placed directly, via the kitty graphics
  // protocol. f=24 is raw RGB, s/v are the pixel dimensions, a=T transmits
  // and places. 24x24x3 = 1728 bytes, which fits one un-chunked escape.
  //
  // Counting red specifically, rather than comparing total ink against a
  // baseline, keeps this independent of the blinking cursor: the cursor
  // contributes a variable amount of non-red ink from frame to frame.
  const SIDE = 24;
  await page.evaluate((side) => {
    const rgb = new Uint8Array(side * side * 3);
    for (let i = 0; i < side * side; i++) rgb[i * 3] = 255;
    let bin = '';
    for (const b of rgb) bin += String.fromCharCode(b);
    window.__sipTest.term.write(
      `\x1b_Gf=24,s=${side},v=${side},a=T;${btoa(bin)}\x1b\\`,
    );
  }, SIDE);
  await page.waitForTimeout(800);

  const red = await page.evaluate(() => {
    const t = window.__sipTest.term.term;
    const canvas = document.querySelector('#terminal canvas:not(.sip-vtgl-canvas)');
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    t.renderer.render(t.wasmTerm, true, t.viewportY || 0, t);
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 200) n++;
    }
    return n;
  });

  // The image is composited by the bundle onto the overlay canvas, above the
  // vtgl grid. Allow for scaling slop, but most of the 576 pixels must land.
  expect(red).toBeGreaterThan(400);

  // And the text grid is still alive afterwards. The screen was not cleared,
  // so "after-kitty" (11 columns) lands on whichever row the shell was on.
  await run(page, 'printf "after-kitty\\n"');
  const vtglInk = await inkByRow(page, 'vtgl');
  assertNotCleared(vtglInk, vtglInk.count.length);
  expect(vtglInk.widthCols.some((w) => w >= 11)).toBe(true);
});

test('scrollback renders when scrolled back', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');
  await run(page, 'clear; i=0; while [ $i -lt 80 ]; do echo "scrollback-line-$i"; i=$((i+1)); done');

  await page.evaluate(() => window.__sipTest.term.scrollLines(-30));
  await page.waitForTimeout(400);

  const ink = await inkByRow(page, 'vtgl');
  // Scrolled into history every row carries a "scrollback-line-N" line, so
  // assertNotCleared would misfire here. The width of those lines is the
  // check that does the same job: 17-19 columns of real text on every row,
  // where a cleared buffer would report the full terminal width.
  const cols = await page.evaluate(() => window.__sipTest.cols);
  const filled = ink.count.filter((n) => n > 20).length;
  expect(filled).toBeGreaterThan(ink.count.length * 0.6);
  for (let r = 0; r < ink.count.length; r++) {
    if (ink.count[r] === 0) continue;
    expect(ink.widthCols[r], `row ${r} spans the full width, buffer was cleared`)
      .toBeLessThan(cols / 2);
  }
  // And the lines really are the ones we printed, not stale screen content.
  expect(ink.widthCols[0]).toBeGreaterThanOrEqual(16);

  await page.evaluate(() => window.__sipTest.term.scrollToBottom());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__sipTest.term.getViewportY())).toBe(0);
});

test('recovers from a lost webgl context', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');
  await run(page, 'clear; printf "before-context-loss\\n"');

  const lost = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas.sip-vtgl-canvas');
    const gl = canvas.getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no-extension';
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const wasLost = gl.isContextLost();
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 800));
    return wasLost ? 'lost-and-restored' : 'never-lost';
  });
  expect(lost).toBe('lost-and-restored');

  // The terminal has to come back, not just survive: new output must render.
  await run(page, 'printf "after-context-loss\\n"');
  await page.waitForTimeout(500);

  const ink = await inkByRow(page, 'vtgl');
  assertNotCleared(ink, ink.count.length);
  // "after-context-loss" is 18 columns; the grid genuinely came back.
  expect(ink.widthCols[0]).toBeGreaterThanOrEqual(17);

  // The page is still driving the renderer, not silently throwing per frame.
  expect(await page.evaluate(() => window.__sipTest.term.activeRenderer)).toBe('webgl');
});

test('damage tracking survives the integration', async ({ page }) => {
  expect(await boot(page, WEBGL)).toBe('webgl');
  await run(page, 'clear; i=0; while [ $i -lt 200 ]; do echo "line-$i abcdefghijklmnop"; i=$((i+1)); done');

  // The render loop runs continuously, so the last frame's stats are an idle
  // frame. Collect every frame over a window instead and reason about the
  // busiest one.
  await page.evaluate(() => {
    window.__frames = [];
    window.sipTerm.vtglBridge.renderer.on('render', (s) => window.__frames.push(s));
  });

  // Typing one character must dirty one row, not the screen. This is the
  // check that catches the adapter losing the buffer's dirty state and
  // silently falling back to repainting everything.
  await page.locator('#terminal').click();
  await page.keyboard.type('x');
  await page.waitForTimeout(400);

  const edit = await page.evaluate(() => {
    const busy = window.__frames.filter((f) => f.dirtyRows > 0);
    return {
      frames: window.__frames.length,
      busy: busy.length,
      maxDirty: Math.max(0, ...busy.map((f) => f.dirtyRows)),
      maxGlyphs: Math.max(0, ...busy.map((f) => f.glyphs)),
      drawCalls: window.__frames.length ? window.__frames[0].drawCalls : -1,
    };
  });

  // At least one frame did work, and none of them repainted the screen.
  expect(edit.busy).toBeGreaterThan(0);
  expect(edit.maxDirty).toBeLessThanOrEqual(3);
  expect(edit.maxGlyphs).toBeLessThan(60);

  // A full repaint touches every row but must not cost more draw calls: the
  // instanced pipeline issues a fixed handful either way. Draw-call counts
  // are the one performance figure that is meaningful here, since headless
  // GL is SwiftShader and any timing would be software rasterization.
  const full = await page.evaluate(() => {
    const t = window.sipTerm.term;
    t.renderer.render(t.wasmTerm, true, t.viewportY || 0, t);
    return window.sipTerm.getRenderStats();
  });
  expect(full.dirtyRows).toBeGreaterThan(edit.maxDirty * 10);
  expect(full.glyphs).toBeGreaterThan(edit.maxGlyphs * 5);
  expect(full.drawCalls).toBe(edit.drawCalls);
  expect(full.drawCalls).toBeLessThanOrEqual(6);
});
