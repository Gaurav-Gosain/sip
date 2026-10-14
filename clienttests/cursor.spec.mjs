// The cursor shape a program sets, end to end: sh prints DECSCUSR through the
// PTY and the wire protocol, and the page draws it. Read back from the colour
// of the cursor cell in a screenshot.
//
// Up to webterm 778ff70 the canvas and vtgl renderers drew every shape as a
// block, the WebGL renderer never blinked a shape that asked to, and vtgl hid
// the cursor on blur instead of drawing it hollow.

import { test, expect } from '@playwright/test';

async function boot(page, renderer) {
  await page.goto(`/?renderer=${renderer}`);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  await page.waitForFunction((r) => window.sipTerm.webterm?.renderer === r, renderer, { timeout: 30_000 });
  await page.locator('.xterm-helper-textarea').focus();
}

/** Run `printf` in sh and wait until a marker it prints is on screen. */
async function printf(page, format, marker) {
  await page.evaluate(
    ([f, m]) => window.sipTerm.sendInput(`clear; printf '${f}'; printf '${m}'\r`),
    [format, marker],
  );
  await page.waitForFunction(
    (m) => {
      const t = window.sipTerm.term;
      const b = t.buffer.active;
      for (let i = 0; i < t.rows; i++) {
        const text = b.getLine(b.viewportY + i)?.translateToString(true) ?? '';
        if (text.startsWith(m)) return true;
      }
      return false;
    },
    marker,
    { timeout: 15_000 },
  );
}

/** The shape drawn in the cursor's cell, by the cursor colour. */
async function shape(page) {
  const box = await page.evaluate(() => {
    const t = window.sipTerm.term;
    const screen = t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const cell = t._core._renderService.dimensions.css.cell;
    const b = t.buffer.active;
    return {
      x: screen.left + b.cursorX * cell.width,
      y: screen.top + b.cursorY * cell.height,
      width: cell.width,
      height: cell.height,
    };
  });
  const png = await page.screenshot({ clip: box, scale: 'device' });
  return page.evaluate(
    async ([base64]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data, width: w, height: h } = ctx.getImageData(0, 0, image.width, image.height);
      const hit = (x, y) => {
        const i = (y * w + x) * 4;
        // Magenta by hue rather than by value: sip draws the canvas cursor
        // layer at 60% opacity while the page has no focus.
        return data[i] > data[i + 1] + 80 && data[i + 2] > data[i + 1] + 80;
      };
      let count = 0;
      const columns = new Array(w).fill(0);
      const rows = new Array(h).fill(0);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!hit(x, y)) continue;
          count++;
          columns[x]++;
          rows[y]++;
        }
      }
      if (count === 0) return 'none';
      if (count >= w * h * 0.9) return 'block';
      const fullColumns = columns.map((n) => n >= h - 1);
      const fullRows = rows.map((n) => n >= w - 1);
      if (fullRows[0] && fullRows[h - 1] && fullColumns[0] && fullColumns[w - 1]) return 'outline';
      if (fullColumns[0] && columns.slice(Math.ceil(w / 2)).every((n) => n === 0)) return 'bar';
      if (fullRows.lastIndexOf(true) >= h - 3 && rows.slice(0, Math.floor(h / 2)).every((n) => n === 0)) {
        return 'underline';
      }
      return 'other';
    },
    [png.toString('base64')],
  );
}

const poll = (page) => expect.poll(() => shape(page), { timeout: 3_000 });

for (const renderer of ['webgl', 'canvas', 'dom', 'vtgl']) {
  test(`a program's DECSCUSR reaches the ${renderer} renderer`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'reads pixels under the pinned GL setup');
    await boot(page, renderer);
    let n = 0;
    const set = (seq) => printf(page, `\\033]12;#ff00ff\\007${seq}`, `mark${++n}`);

    for (const [param, expected] of [
      [2, 'block'],
      [4, 'underline'],
      [6, 'bar'],
      [3, 'underline'],
      [5, 'bar'],
      [1, 'block'],
    ]) {
      await set(`\\033[${param} q`);
      await poll(page).toBe(expected);
    }

    // A blinking bar shows and hides; a steady one only shows.
    const over = async (ms) => {
      const seen = new Set();
      for (const end = Date.now() + ms; Date.now() < end; ) {
        seen.add(await shape(page));
        await page.waitForTimeout(80);
      }
      return [...seen].sort();
    };
    await set('\\033[5 q');
    expect(await over(2000), 'DECSCUSR 5').toEqual(['bar', 'none']);
    await set('\\033[6 q');
    expect(await over(2000), 'DECSCUSR 6').toEqual(['bar']);

    // Without the focus the cursor is a hollow block, whatever its shape.
    // xterm's DOM renderer outlines the glyph's span, which with this font is
    // taller than the row and so not inside the cell this reads.
    if (renderer === 'dom') return;
    await page.evaluate(() => {
      window.sipTerm.term.blur();
      document.activeElement?.blur();
    });
    await poll(page).toBe('outline');
  });
}
