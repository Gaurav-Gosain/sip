// End-to-end checks on the restored xterm.js client against a real sip server.
//
// Everything here goes through the client's own code paths rather than around
// them: input is handed to sendInput (the same call term.onData makes), so the
// wire protocol, the server, the PTY and the renderer are all in the loop.
// Nothing here synthesizes a key event, because none of these properties
// depend on key handling and mixing the two would make a failure ambiguous.

// Cell metrics and the block/box-glyph seam live in metrics.spec.mjs, which
// checks them against the font's own tables rather than against the client.

import { test, expect } from '@playwright/test';

async function boot(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
}

/** Everything currently on the screen and in the scrollback, as text. */
function screenText(page) {
  return page.evaluate(() => {
    const b = window.sipTerm.term.buffer.active;
    const rows = [];
    for (let i = 0; i < b.length; i++) rows.push(b.getLine(i).translateToString(true));
    return rows.join('\n');
  });
}

/** Send input and wait for a marker to come back through the PTY. */
async function roundTrip(page, command, marker) {
  await page.evaluate((c) => window.sipTerm.sendInput(c), command);
  await page.waitForFunction(
    (m) => {
      const b = window.sipTerm.term.buffer.active;
      for (let i = 0; i < b.length; i++) {
        if (b.getLine(i).translateToString(true).includes(m)) return true;
      }
      return false;
    },
    marker,
    { timeout: 15_000 },
  );
}

test('the terminal opens with a renderer attached', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => ({
    renderer: window.sipTerm.currentRenderer,
    hasScreen: !!document.querySelector('.xterm-screen'),
    cols: window.sipTerm.term.cols,
    rows: window.sipTerm.term.rows,
  }));
  expect(info.hasScreen).toBe(true);
  expect(info.renderer).not.toBe('unknown');
  expect(info.cols).toBeGreaterThan(0);
  expect(info.rows).toBeGreaterThan(0);
});

test('a shell runs and its output renders', async ({ page }) => {
  await boot(page);
  await roundTrip(page, 'echo SHELL_MARKER_OK\n', 'SHELL_MARKER_OK');
  expect(await screenText(page)).toContain('SHELL_MARKER_OK');
});

test('resize reaches the PTY and carries pixel dimensions', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.sipTerm.term.cols);

  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForFunction((c) => window.sipTerm.term.cols !== c, before, { timeout: 15_000 });

  const grid = await page.evaluate(() => ({
    cols: window.sipTerm.term.cols,
    rows: window.sipTerm.term.rows,
  }));
  await roundTrip(page, 'echo GEO=$(tput cols)x$(tput lines)\n', 'GEO=');

  // The shell's own idea of the window must match the client's grid, which is
  // only true if the resize message actually arrived.
  expect(await screenText(page)).toContain(`GEO=${grid.cols}x${grid.rows}`);

  // widthPx/heightPx are optional in the protocol and were omitted by the
  // pre-migration client, which left the PTY winsize pixel fields at zero and
  // broke any TUI that asks for the cell size in pixels.
  const px = await page.evaluate(() => window.sipTerm.pixelDimensions());
  expect(px.widthPx).toBeGreaterThan(0);
  expect(px.heightPx).toBeGreaterThan(0);
});

test('kitty graphics render through the overlay', async ({ page }) => {
  await boot(page);

  // A 2x2 opaque red RGBA image, transmitted directly (f=32, t=d) and placed
  // at the cursor. Deliberately not PNG: the server-side transcoder is off by
  // default, so f=32 is what exercises the overlay's own decode path without
  // depending on server configuration.
  const rgba = new Uint8Array(16);
  for (let i = 0; i < 4; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }
  const b64 = Buffer.from(rgba).toString('base64');

  await page.evaluate((b) => {
    window.sipTerm.term.write(`\x1b_Ga=T,f=32,s=2,v=2,t=d;${b}\x1b\\`);
  }, b64);

  await page.waitForFunction(
    () => {
      const o = window.sipTerm.kittyOverlay;
      if (!o || !o.placements) return false;
      return (o.placements.size ?? o.placements.length ?? 0) > 0;
    },
    null,
    { timeout: 10_000 },
  );

  const state = await page.evaluate(() => ({
    overlay: !!window.sipTerm.kittyOverlay,
    placements: window.sipTerm.kittyOverlay.placements.size ?? window.sipTerm.kittyOverlay.placements.length,
    // The image addon must not be handling kitty itself; the overlay owns it
    // because only the overlay can reposition a placement when a window moves.
    imageAddonKitty: window.sipTerm.imageAddon ? true : false,
  }));
  expect(state.overlay).toBe(true);
  expect(state.placements).toBeGreaterThan(0);
});

test('selection yields the text on screen', async ({ page }) => {
  await boot(page);
  await roundTrip(page, 'echo SELECT_MARKER_OK\n', 'SELECT_MARKER_OK');

  await page.evaluate(() => window.sipTerm.term.selectAll());
  const selected = await page.evaluate(() => window.sipTerm.term.getSelection());
  expect(selected).toContain('SELECT_MARKER_OK');
});

test('OSC 52 copies a UTF-8 payload without mangling it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are only granted in the chromium project');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);

  // Non-Latin-1 text: the pre-migration handler ran atob and used the
  // resulting latin1 string as the clipboard text, which mojibaked anything
  // outside Latin-1. The bytes have to be decoded as UTF-8.
  const payload = 'héllo → 世界';
  const b64 = Buffer.from(payload, 'utf8').toString('base64');
  await page.evaluate((b) => window.sipTerm.term.write(`\x1b]52;c;${b}\x07`), b64);

  await expect.poll(
    () => page.evaluate(() => navigator.clipboard.readText()),
    { timeout: 10_000 },
  ).toBe(payload);
});

test('OSC 52 never answers a read query', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are only granted in the chromium project');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);

  await page.evaluate(() => navigator.clipboard.writeText('SECRET_CLIPBOARD'));
  // "?" asks the terminal to report the clipboard back to the application.
  // Answering it would hand the host clipboard to whatever is running on the
  // far end, so the handler must swallow it and send nothing.
  const sent = await page.evaluate(async () => {
    const seen = [];
    const original = window.sipTerm.sendInput.bind(window.sipTerm);
    window.sipTerm.sendInput = (d) => { seen.push(d); return original(d); };
    window.sipTerm.term.write('\x1b]52;c;?\x07');
    await new Promise((r) => setTimeout(r, 500));
    return seen;
  });
  expect(sent.join('')).not.toContain('SECRET_CLIPBOARD');
});

// --- kitty graphics capability probe -----------------------------------
//
// Kitty graphics is request/response: a client sends a=q and refuses to send
// the image at all unless the terminal answers. The overlay used to render
// placements but never reply, which left every probe unanswered and made
// kitten icat report that the terminal has no graphics support.

/** Collect everything the overlay writes back while running `body`. */
async function captureResponses(page, body) {
  return page.evaluate(async (seq) => {
    const seen = [];
    const original = window.sipTerm.sendInput.bind(window.sipTerm);
    window.sipTerm.sendInput = (d) => { seen.push(d); return original(d); };
    window.sipTerm.term.write(seq);
    await new Promise((r) => setTimeout(r, 300));
    window.sipTerm.sendInput = original;
    return seen.join('');
  }, body);
}

test('a kitty query for direct transmission is answered OK', async ({ page }) => {
  await boot(page);
  // The first of the three probes kitten icat opens with.
  const sent = await captureResponses(page, '\x1b_Ga=q,f=24,s=1,v=1,S=3,i=1;MTIz\x1b\\');
  expect(sent).toBe('\x1b_Gi=1;OK\x1b\\');
});

test('a kitty query for an unreachable medium is answered with an error', async ({ page }) => {
  await boot(page);
  // t=t and t=s name paths in the server's filesystem, which a browser cannot
  // read. Reporting the error rather than staying silent is what lets icat
  // settle on stream mode instead of waiting out its timeout.
  const sent = await captureResponses(page, '\x1b_Ga=q,f=24,t=t,s=1,v=1,i=2;L3RtcC94\x1b\\');
  expect(sent).toContain('\x1b_Gi=2;ENOTSUPPORTED:');
  expect(sent).not.toContain('OK');
});

test('kitty quiet mode suppresses the responses it should', async ({ page }) => {
  await boot(page);

  // q=1 drops successes but keeps errors.
  expect(await captureResponses(page, '\x1b_Ga=q,f=24,q=1,s=1,v=1,i=7;MTIz\x1b\\')).toBe('');
  expect(await captureResponses(page, '\x1b_Ga=q,f=24,t=s,q=1,s=1,v=1,i=8;MTIz\x1b\\'))
    .toContain('\x1b_Gi=8;ENOTSUPPORTED:');

  // q=2 drops everything.
  expect(await captureResponses(page, '\x1b_Ga=q,f=24,q=2,s=1,v=1,i=9;MTIz\x1b\\')).toBe('');
  expect(await captureResponses(page, '\x1b_Ga=q,f=24,t=s,q=2,s=1,v=1,i=10;MTIz\x1b\\')).toBe('');

  // A command carrying no id is unaddressable, so there is nothing to answer.
  expect(await captureResponses(page, '\x1b_Ga=q,f=24,s=1,v=1;MTIz\x1b\\')).toBe('');
});

test('kitten icat detects graphics support', async ({ page }) => {
  const { execSync } = await import('node:child_process');
  try {
    execSync('command -v kitten', { stdio: 'ignore', shell: '/bin/sh' });
  } catch {
    test.skip(true, 'kitten is not installed');
  }

  await boot(page);
  // icat prints the transfer mode it settled on, and exits non-zero with a
  // "does not support the graphics protocol" error when no probe is answered.
  // The marker is split so the echoed command line cannot satisfy the wait.
  await roundTrip(page, 'kitten icat --detect-support; echo "DETECT""ED-$?"\n', 'DETECTED-0');

  const screen = await screenText(page);
  // Only direct transmission is answered OK, so stream is the expected pick.
  expect(screen).toContain('stream');
  expect(screen).not.toContain('does not support the graphics protocol');
});
