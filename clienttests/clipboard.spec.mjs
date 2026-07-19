// Copy and paste chords, against a running sip server and a real clipboard.
//
// This suite exists because the copy path has two failure modes that look
// identical to a user ("Ctrl+C does nothing") and only one of them is a key
// encoding problem:
//
//  1. No copy binding at all, so Ctrl+C on a selection fell through to the
//     encoder and sent SIGINT while the selection stayed on screen.
//  2. A copy binding that runs but whose clipboard write rejects, which the
//     async Clipboard API does silently unless the rejection is handled.
//
// Only reading the system clipboard back distinguishes those from a working
// copy, so every assertion here goes through navigator.clipboard.readText()
// rather than through the handler's own bookkeeping.
//
// The Ctrl+C-with-no-selection case is asserted at the transport boundary for
// the same reason keyboard.spec.mjs does it there: SIGINT is the behaviour
// that must not regress, and the only proof it survived is the 0x03 byte
// actually reaching the wire.

import { test, expect } from '@playwright/test';

const MARKER = 'CLIPBOARD_MARKER_7F3A';

/** Pin the transport through the same stored setting the settings panel writes. */
function pinTransport(page, transport) {
  return page.addInitScript((t) => {
    localStorage.setItem('sip-web-settings', JSON.stringify({
      transport: t, fontSize: 14, copyOnSelect: false, cursorBlink: false, renderer: 'canvas',
    }));
  }, transport);
}

/** Record the raw MsgInput payload at the WebSocket boundary. */
async function captureWire(page) {
  await page.evaluate(() => {
    window.__sentInput = [];
    const MSG_INPUT = 0x30;
    const conn = window.sipTerm.connection;
    if (!conn) throw new Error('no connection to hook');
    if (conn.__sipWireHooked) return;
    conn.__sipWireHooked = true;
    if (!conn.ws) throw new Error('expected a WebSocket to hook');
    const ws = conn.ws;
    const send = ws.send.bind(ws);
    ws.send = (frame) => {
      const b = new Uint8Array(frame);
      if (b[0] === MSG_INPUT) window.__sentInput.push(Array.from(b.subarray(1)));
      return send(frame);
    };
  });
}

async function boot(page) {
  await pinTransport(page, 'websocket');
  await page.goto('/');
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  await captureWire(page);
  await page.locator('#terminal').click();
  await page.waitForTimeout(200);
}

/**
 * Put a known string on the screen and select it.
 *
 * Written straight into the emulator rather than echoed by the shell: the
 * marker then sits at a known row and column whatever the prompt is doing,
 * which is what makes the selection text an exact-match assertion.
 *
 * The click that focuses the terminal is what clears any selection, so the
 * selection is made after focusing, never before.
 */
async function selectMarker(page, marker) {
  await page.evaluate((m) => {
    const wt = window.sipTerm.webterm;
    wt.write('\x1b[2J\x1b[H' + m);
  }, marker);
  await page.waitForTimeout(150);
  await page.evaluate((m) => {
    window.sipTerm.webterm.xterm.select(0, 0, m.length);
  }, marker);
  return page.evaluate(() => window.sipTerm.webterm.xterm.getSelection());
}

function readClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

function wireBytes(page) {
  return page.evaluate(() => window.__sentInput.flat());
}

test.describe('clipboard', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are granted for chromium only');

  test('Ctrl+C with a selection copies it and does not send SIGINT', async ({ page }) => {
    await boot(page);
    const selected = await selectMarker(page, MARKER);
    expect(selected).toBe(MARKER);

    await page.evaluate(() => navigator.clipboard.writeText('CLIPBOARD_NOT_WRITTEN'));
    await page.evaluate(() => { window.__sentInput.length = 0; });

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);

    expect(await readClipboard(page)).toBe(MARKER);
    // The whole point of the branch: a copy must swallow the chord, so no
    // interrupt may appear on the wire.
    expect(await wireBytes(page)).not.toContain(0x03);
  });

  test('Ctrl+C with no selection still sends SIGINT', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.sipTerm.webterm.xterm.clearSelection());
    await page.evaluate(() => { window.__sentInput.length = 0; });

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(300);

    expect(await wireBytes(page)).toContain(0x03);
  });

  test('Ctrl+Shift+C copies the selection when the browser lets it through', async ({ page }) => {
    await boot(page);
    const selected = await selectMarker(page, MARKER);
    expect(selected).toBe(MARKER);

    await page.evaluate(() => navigator.clipboard.writeText('CLIPBOARD_NOT_WRITTEN'));
    await page.evaluate(() => { window.__sentInput.length = 0; });

    await page.keyboard.press('Control+Shift+C');
    await page.waitForTimeout(300);

    expect(await readClipboard(page)).toBe(MARKER);
    expect(await wireBytes(page)).not.toContain(0x03);
  });

  // PASTE IS NOT BOUND BY SIP, and deliberately so: xterm listens for the
  // browser's native paste event, so both paste chords already reach the
  // terminal on their own. Binding them here as well would paste twice.
  //
  // Only Ctrl+Shift+V is asserted. Synthesized key events do not make Chromium
  // run the "Paste" editing command for Ctrl+V, so no paste event fires for it
  // under Playwright and a test on that chord would measure the harness rather
  // than the client. Ctrl+Shift+V maps to PasteAndMatchStyle, which Chromium
  // does execute, and it reaches the terminal through the same single xterm
  // paste listener, so this covers the path both chords share.
  test('Ctrl+Shift+V pastes the clipboard into the terminal', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.sipTerm.webterm.xterm.clearSelection());
    await page.evaluate(() => navigator.clipboard.writeText('PASTED_TEXT'));
    await page.evaluate(() => { window.__sentInput.length = 0; });

    await page.keyboard.press('Control+Shift+V');
    await page.waitForTimeout(400);

    const bytes = await wireBytes(page);
    const text = String.fromCharCode(...bytes);
    expect(text).toContain('PASTED_TEXT');
  });

  // The copy binding must not swallow Ctrl+V on its way past.
  test('Ctrl+V is left for the browser and sends no interrupt', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.sipTerm.webterm.xterm.clearSelection());
    await page.evaluate(() => { window.__sentInput.length = 0; });

    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);

    expect(await wireBytes(page)).not.toContain(0x03);
  });
});
