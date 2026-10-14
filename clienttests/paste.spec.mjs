// Paste, against a running sip server, in Chromium and Firefox.
//
// The browser does the paste. sip binds no paste chord and never reads the
// clipboard: the chord's default action fires a paste event on xterm's
// textarea, which reads clipboardData. That needs no clipboard permission, no
// secure context and no prompt. So what can break paste is a key handler that
// claims the chord and prevents its default, and that is what these tests
// look for.
//
// It did break, for every program that asks for the kitty keyboard protocol,
// and every Bubble Tea v2 program does. The protocol encoded Ctrl+Shift+V as
// CSI 118;6 u (and Cmd+V as CSI 118;9 u), prevented the default, and the paste
// never happened. A plain shell never asks for the protocol, which is why the
// Ctrl+Shift+V test in clipboard.spec.mjs stayed green throughout.
//
// Playwright makes both engines run their paste command for Ctrl+Shift+V and
// Shift+Insert, so those two are end to end here. It runs none for Ctrl+V or
// Cmd+V on Linux, and it cannot click the browser's context menu, so the menu
// and middle-click cases dispatch the paste event the browser would send to
// whatever holds focus after the click.

import { test, expect } from '@playwright/test';

const MSG_INPUT = 0x30;
const TEXT = 'PASTE_ONE_5821\nPASTE_TWO_5821';
const BRACKETED = '\x1b[200~PASTE_ONE_5821\rPASTE_TWO_5821\x1b[201~';

async function boot(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sip-web-settings', JSON.stringify({
      transport: 'websocket', fontSize: 14, copyOnSelect: false, cursorBlink: false, renderer: 'canvas',
    }));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  await page.evaluate((msgInput) => {
    window.__sent = [];
    const ws = window.sipTerm.connection.ws;
    if (!ws) throw new Error('expected a WebSocket to hook');
    const send = ws.send.bind(ws);
    ws.send = (frame) => {
      const b = new Uint8Array(frame);
      if (b[0] === msgInput) window.__sent.push(...b.subarray(1));
      return send(frame);
    };
  }, MSG_INPUT);
  await page.locator('#terminal').click();
  await page.waitForTimeout(200);
}

const wire = (page) => page.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__sent)));
const clearWire = (page) => page.evaluate(() => { window.__sent.length = 0; });

/** Run a command in the shell and wait for the terminal state it sets. */
async function shell(page, command, ready) {
  await page.keyboard.press('Control+u');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await page.waitForFunction(ready, null, { timeout: 10_000 });
}

/** Ask for the protocol and for bracketed paste, as a Bubble Tea v2 program does. */
async function likeBubbleTea(page, flags) {
  await shell(page, `printf '\\033[?2004h\\033[>${flags}u'`,
    `window.sipTerm.webterm.keyboard?.flags === ${flags}`);
}

/**
 * Put TEXT on the system clipboard. Chromium is granted the permission by the
 * config. Firefox has no such grant, so the write rides the user activation
 * that boot's click left behind.
 */
async function setClipboard(page) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), TEXT);
}

test.describe('paste', () => {
  for (const [chord, flags] of [['Control+Shift+V', 1], ['Control+Shift+V', 31], ['Shift+Insert', 31]]) {
    test(`${chord} pastes under kitty flags ${flags}`, async ({ page }) => {
      await boot(page);
      await likeBubbleTea(page, flags);
      await setClipboard(page);
      await clearWire(page);

      await page.keyboard.press(chord);

      // One paste, bracketed, with the line break as a carriage return.
      await expect.poll(() => wire(page), { timeout: 5_000 }).toContain(BRACKETED);
      const sent = await wire(page);
      expect(sent.split('\x1b[200~')).toHaveLength(2);
      // And nothing of the chord itself: no V, and no Insert.
      expect(sent).not.toContain('118;');
      expect(sent).not.toContain('\x1b[2;');
    });
  }

  test('Ctrl+V stays the program key', async ({ page }) => {
    // Literal-next in a shell, block select in vim. Not a paste chord.
    await boot(page);
    await clearWire(page);
    await page.keyboard.press('Control+v');
    await expect.poll(() => wire(page)).toBe('\x16');
    // The shell is now waiting to quote one key. Give it one, so the next
    // command line starts clean.
    await page.keyboard.press('x');
    await likeBubbleTea(page, 1);
    await clearWire(page);
    await page.keyboard.press('Control+v');
    await expect.poll(() => wire(page)).toBe('\x1b[118;5u');
  });

  test('the context menu and middle click paste into the terminal', async ({ page }) => {
    await boot(page);
    // Mouse reporting on, which is how a full-screen program runs. The clicks
    // must still leave focus where the browser's paste lands.
    await shell(page, `printf '\\033[?2004h\\033[?1000h\\033[?1006h'`,
      `window.sipTerm.webterm.xterm.modes.mouseTrackingMode !== 'none'`);
    for (const button of ['right', 'middle']) {
      await page.locator('#terminal').click({ button, position: { x: 120, y: 80 } });
      await clearWire(page);
      await page.evaluate((t) => {
        const data = new DataTransfer();
        data.setData('text/plain', t);
        document.activeElement.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: data, bubbles: true, cancelable: true,
        }));
      }, TEXT);
      await expect.poll(() => wire(page), { timeout: 5_000, message: button }).toContain('\x1b[200~');
      // Firefox drops clipboardData from a constructed event, so only Chromium
      // can carry the text through this route.
      if (test.info().project.name === 'chromium') {
        expect(await wire(page), button).toContain(BRACKETED);
      }
      await page.keyboard.press('Escape');
    }
  });
});
