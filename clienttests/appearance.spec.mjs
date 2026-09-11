// Config.Appearance, read back out of a real browser.
//
// Two servers run for this suite. The default one on BASE_URL configures no
// appearance at all and is here to prove the zero value changed nothing; the
// one on APPEARANCE_URL is examples/appearance, which sets a Gruvbox palette,
// a crosshair mouse cursor, a bar text cursor and a page title in Go.
//
// A colour is proved by reading the pixel the renderer painted, never by
// asserting that a JSON field arrived. A field can arrive and still be dropped
// by xterm, by a stylesheet or by a merge that puts the default back on top,
// and every one of those looks like a green test from the wire's side.
//
// The renderer is pinned to canvas wherever a pixel is read: WebGL's drawing
// buffer cannot be read back without preserveDrawingBuffer.

import { test, expect } from '@playwright/test';
import { BASE_URL, APPEARANCE_URL } from './playwright.config.mjs';

// What examples/appearance configures. Kept here as literals so a test failure
// names the colour that was expected rather than pointing at the Go file.
const GRUVBOX = {
  background: '#282828',
  foreground: '#ebdbb2',
  red: '#cc241d',
  blue: '#458588',
  cursor: '#fe8019',
};
const CATPPUCCIN = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  red: '#f38ba8',
};

async function boot(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
}

/** The live transport, the same way keyboard.spec.mjs asks. */
function liveTransport(page) {
  return page.evaluate(() => {
    const conn = window.sipTerm.connection;
    if (!conn) return 'unknown';
    if (conn.useWebTransport && conn.wtWriter) return 'webtransport';
    if (conn.ws) return 'websocket';
    return 'unknown';
  });
}

/** '#rrggbb' from a 'rgb(r, g, b)' computed value. */
function toHex(css) {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return css;
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

/**
 * Paint text through the terminal and read one cell's pixel back off the
 * composited canvases.
 *
 * Reading the middle of the cell, because the glyph is drawn inside it: the
 * first sample asked for the top-left corner and got the background every
 * time.
 */
async function cellPixel(page, text, { col, row, dx = 0.5, dy = 0.5 }) {
  return page.evaluate(async ({ text, col, row, dx, dy }) => {
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
    const cell = t._core._renderService.dimensions.css.cell;
    const x = Math.round(cell.width * dpr * (col + dx));
    const y = Math.round(cell.height * dpr * (row + dy));
    const d = ctx.getImageData(x, y, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }, { text, col, row, dx, dy });
}

// --- The configured server ------------------------------------------------

test.describe('a configured appearance reaches the browser', () => {
  test('the ANSI palette paints the pixels', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'pixel reads need the pinned GL setup');
    await boot(page, `${APPEARANCE_URL}/?renderer=canvas`);

    // A full block in ANSI red fills its cell with the palette's colour, so
    // the cell centre is the colour itself rather than antialiased glyph ink.
    const red = await cellPixel(page, '\x1b[31m██\x1b[0m', { col: 0, row: 0 });
    expect(red, `ANSI red painted ${red}, not the configured ${GRUVBOX.red}`).toBe(GRUVBOX.red);

    const blue = await cellPixel(page, '\x1b[34m██\x1b[0m', { col: 0, row: 0 });
    expect(blue, `ANSI blue painted ${blue}, not the configured ${GRUVBOX.blue}`).toBe(GRUVBOX.blue);
  });

  test('the theme background paints the empty grid', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'pixel reads need the pinned GL setup');
    await boot(page, `${APPEARANCE_URL}/?renderer=canvas`);

    // Row 4 column 20 of a cleared screen is ground and nothing else.
    const bg = await cellPixel(page, '', { col: 20, row: 4 });
    expect(bg, `the empty grid painted ${bg}, not the configured ${GRUVBOX.background}`)
      .toBe(GRUVBOX.background);
  });

  test('the page behind the terminal follows the theme', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a computed style');
    await boot(page, APPEARANCE_URL);

    const ground = await page.evaluate(() => ({
      container: getComputedStyle(document.getElementById('terminal-container')).backgroundColor,
      // webterm paints its own ground behind the grid. A palette that stops
      // at sip's properties leaves a strip of the built-in colour under the
      // terminal wherever the rows do not divide the window evenly.
      webterm: getComputedStyle(document.getElementById('terminal')).backgroundColor,
    }));
    expect(toHex(ground.container), 'the letterbox around the grid kept the built-in ground')
      .toBe(GRUVBOX.background);
    expect(toHex(ground.webterm), 'the strip under the grid kept the built-in ground')
      .toBe(GRUVBOX.background);
  });

  test('the mouse cursor is the configured one', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a computed style');
    await boot(page, APPEARANCE_URL);

    const cursor = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.xterm-screen')).cursor);
    expect(cursor, `the terminal shows the ${cursor} cursor, not the configured crosshair`)
      .toBe('crosshair');
  });

  test('the text cursor shape is the configured one', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a terminal option');
    await boot(page, APPEARANCE_URL);

    const style = await page.evaluate(() => window.sipTerm.term.options.cursorStyle);
    expect(style, `the text cursor is a ${style}, not the configured bar`).toBe('bar');
  });

  test('the other terminal options are the configured ones', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for terminal options');
    await boot(page, APPEARANCE_URL);

    const opts = await page.evaluate(() => {
      const o = window.sipTerm.term.options;
      return {
        scrollback: o.scrollback,
        fontSize: o.fontSize,
        cursorBlink: o.cursorBlink,
        cursorInactiveStyle: o.cursorInactiveStyle,
      };
    });
    expect(opts.scrollback, `scrollback is ${opts.scrollback}, not the configured 9000`).toBe(9000);
    expect(opts.fontSize, `fontSize is ${opts.fontSize}, not the configured 17`).toBe(17);
    expect(opts.cursorBlink, 'the cursor does not blink, but the deployment asked it to').toBe(true);
    expect(
      opts.cursorInactiveStyle,
      `the unfocused cursor is a ${opts.cursorInactiveStyle}, not the configured none`,
    ).toBe('none');
  });

  test('the tab is named and iconned by the deployment', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a document title');
    await boot(page, APPEARANCE_URL);
    expect(await page.title(), 'the tab kept the built-in name').toBe('Gruvbox shell');

    const icon = await page.evaluate(() => {
      const l = document.querySelector('link[rel="icon"]');
      return l ? l.getAttribute('href') : null;
    });
    expect(icon, 'the page has no tab icon, but the deployment configured one').not.toBeNull();
    expect(icon, `the tab icon is ${icon}, not the configured square`).toContain('fe8019');
  });

  test('the page is painted before the socket opens', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a seeded page');
    // The terminal is constructed before the handshake, so the appearance is
    // also seeded into the page at index render. Without it the first paint
    // is sip's own palette and the deployment's arrives a moment later, which
    // on a light theme is a dark flash on every load.
    //
    // Proved by never letting the socket open: the transport is blocked, the
    // handshake never happens, and what is on screen is the seed alone.
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.goto(APPEARANCE_URL);
    await page.waitForFunction(() => !!window.sipTerm?.term, null, { timeout: 30_000 });

    const state = await page.evaluate(() => ({
      connected: window.sipTerm.connected,
      background: window.sipTerm.term.options.theme.background,
      title: document.title,
    }));
    expect(state.connected, 'the socket opened, so this proves nothing about the seed').toBe(false);
    expect(
      state.background,
      `with no session the terminal is ${state.background}, so the page was not seeded`,
    ).toBe(GRUVBOX.background);
    expect(state.title, 'with no session the tab kept the built-in name').toBe('Gruvbox shell');
  });

  test('a stored font size still beats the deployment default', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a stored setting');
    // The deployment picks a starting point, the user picks an answer. This
    // is the rule the renderer preference already follows, and getting it
    // backwards would let a config silently undo the settings panel.
    await page.addInitScript(() => {
      localStorage.setItem('sip-web-settings', JSON.stringify({ fontSize: 11 }));
    });
    await boot(page, APPEARANCE_URL);
    const size = await page.evaluate(() => window.sipTerm.term.options.fontSize);
    expect(size, `fontSize is ${size}; the deployment default overrode the user's 11`).toBe(11);
  });

  test('the chrome follows the palette', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a computed style');
    await boot(page, APPEARANCE_URL);

    // The settings panel is painted from the same palette as the terminal.
    // Without that it is a Catppuccin panel over a Gruvbox terminal.
    await page.locator('#settings-toggle').click();
    const text = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#settings-panel h3')).color);
    expect(toHex(text), 'the settings panel kept the built-in accent')
      .toBe(GRUVBOX.blue);
  });

  test('a screenshot of the configured page', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a screenshot');
    await boot(page, `${APPEARANCE_URL}/?renderer=canvas`);
    await page.evaluate(async () => {
      const t = window.sipTerm.term;
      t.write('\x1b[H\x1b[2J');
      let line = '';
      for (let i = 0; i < 8; i++) line += `\x1b[4${i}m  `;
      line += '\x1b[0m\r\n';
      for (let i = 0; i < 8; i++) line += `\x1b[10${i}m  `;
      await new Promise((r) => t.write(line + '\x1b[0m\r\n\r\n  Gruvbox, set from Go.\r\n', r));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.mouse.move(200, 120);
    await page.screenshot({ path: testInfo.outputPath('configured-appearance.png') });
  });

  test('a screenshot of the unconfigured page, for comparison', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a screenshot');
    await boot(page, `${BASE_URL}/?renderer=canvas`);
    await page.evaluate(async () => {
      const t = window.sipTerm.term;
      t.write('\x1b[H\x1b[2J');
      let line = '';
      for (let i = 0; i < 8; i++) line += `\x1b[4${i}m  `;
      line += '\x1b[0m\r\n';
      for (let i = 0; i < 8; i++) line += `\x1b[10${i}m  `;
      await new Promise((r) => t.write(line + '\x1b[0m\r\n\r\n  The built-in palette.\r\n', r));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.screenshot({ path: testInfo.outputPath('default-appearance.png') });
  });
});

// --- The options frame, per transport -------------------------------------
//
// The appearance is written at two sites, one per transport, from one
// producer. This is the test that would catch the two drifting apart, which is
// why it runs in both projects and refuses to accept a fallback.

test.describe('the options frame carries the appearance', () => {
  test('the palette survives being clobbered and reconnecting', async ({ page }, testInfo) => {
    await boot(page, APPEARANCE_URL);

    const want = testInfo.project.name === 'firefox' ? 'webtransport' : 'websocket';
    const live = await liveTransport(page);
    expect(
      live,
      `asked for ${want} but the live transport is ${live}; this test proves nothing about ${want}`,
    ).toBe(want);

    // Paint the terminal with something that is nobody's configuration, so a
    // pass cannot come from the palette seeded into the page at render time.
    await page.evaluate(() => {
      window.sipTerm.webterm.setOptions({ theme: { background: '#123456', red: '#123456' } });
    });
    expect(await page.evaluate(() => window.sipTerm.term.options.theme.red)).toBe('#123456');

    // A reconnect sends the options frame again, over this transport.
    await page.evaluate(() => window.sipTerm.reconnect());
    await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
    await page.waitForFunction(
      (c) => window.sipTerm.term.options.theme.red === c,
      GRUVBOX.red,
      { timeout: 10_000 },
    ).catch(() => {});

    const theme = await page.evaluate(() => window.sipTerm.term.options.theme);
    expect(
      theme.red,
      `the options frame did not restore the palette over ${live}: red is ${theme.red}`,
    ).toBe(GRUVBOX.red);
    expect(
      theme.background,
      `the options frame did not restore the ground over ${live}: it is ${theme.background}`,
    ).toBe(GRUVBOX.background);
  });
});

// --- The default server ---------------------------------------------------
//
// The other half of the claim: a deployment that configures nothing renders
// what it always did. Asserted against the same properties, so a change that
// leaks a default into the unconfigured page fails here rather than in a
// screenshot nobody compared.

test.describe('an unconfigured deployment is unchanged', () => {
  test('the palette is still the built-in one', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'pixel reads need the pinned GL setup');
    await boot(page, `${BASE_URL}/?renderer=canvas`);

    const red = await cellPixel(page, '\x1b[31m██\x1b[0m', { col: 0, row: 0 });
    expect(red, `an unconfigured server painted ANSI red as ${red}`).toBe(CATPPUCCIN.red);

    const bg = await cellPixel(page, '', { col: 20, row: 4 });
    expect(bg, `an unconfigured server painted the ground as ${bg}`).toBe(CATPPUCCIN.background);
  });

  test('the page ships no appearance blob at all', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a page property');
    await boot(page, BASE_URL);

    const seeded = await page.evaluate(() => (window.__sipConfig || {}).appearance);
    expect(seeded, 'an unconfigured server seeded an appearance into the page').toBeUndefined();
  });

  test('the mouse cursor is still the text bar', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a computed style');
    await boot(page, BASE_URL);

    const cursor = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.xterm-screen')).cursor);
    expect(cursor, 'an unconfigured server changed the mouse cursor').toBe('text');
  });

  test('the tab is still named Sip', async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'chromium', 'one engine is enough for a document title');
    await boot(page, BASE_URL);
    expect(await page.title()).toBe('Sip');
  });
});
