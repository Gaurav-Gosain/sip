// Byte-level checks on the control chords, against a running sip server.
//
// The report that prompted these was "ctrl+C ctrl+D nothing working". Reading
// the key path could not settle it, because the encoder's output depends on
// runtime state (the kitty keyboard flags the VT negotiates) that only exists
// in a real page. So these assert the actual bytes on the wire: the client
// frames terminal input as MsgInput (0x30) followed by the payload, and the
// hook below records every such frame.
//
// Each chord runs in a fresh page. Ctrl+C, Ctrl+D, Ctrl+Z and Ctrl+\ kill,
// suspend or EOF the shell, so sharing a session between them lets one chord
// silently poison every chord after it -- which is what happened the first
// time this was measured, and it looked exactly like a widespread regression.

import { test, expect } from '@playwright/test';

/** Record the payload of every MsgInput frame the client sends. */
async function captureInput(page) {
  await page.addInitScript(() => {
    window.__sentInput = [];
    // A test that boots twice on one page installs this twice; wrapping the
    // wrapper would record every frame once per layer.
    if (window.__sentInputHooked) return;
    window.__sentInputHooked = true;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        let bytes = null;
        if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
        else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        if (bytes && bytes.length > 0 && bytes[0] === 0x30) {
          window.__sentInput.push(Array.from(bytes.subarray(1)));
        }
      } catch {
        // Never let instrumentation break the client.
      }
      return send.call(this, data);
    };
  });
}

async function boot(page, url = '/') {
  await captureInput(page);
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('#connection-status')?.classList.contains('connected'),
    null,
    { timeout: 30_000 },
  );
  await page.locator('#terminal').click();
  await page.waitForTimeout(200);
}

/** Press one chord in a clean session and return the bytes it put on the wire. */
async function bytesFor(page, chord, url = '/') {
  await boot(page, url);
  await page.evaluate(() => { window.__sentInput.length = 0; });
  await page.keyboard.press(chord);
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => window.__sentInput.map((f) => f.slice()));
  return frames.flat();
}

// Ctrl+A..Ctrl+Z map to 0x01..0x1a. Ctrl+I and Ctrl+M are excluded: the
// ghostty encoder disambiguates them from Tab and Enter by emitting CSI u, and
// it did so before this branch too, so they are upstream behaviour rather than
// a sip regression. Tab and Enter themselves are asserted separately below.
const CTRL_LETTERS = [];
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(97 + i);
  if (letter === 'i' || letter === 'm') continue;
  CTRL_LETTERS.push([letter, i + 1]);
}

test.describe('control chords put the right byte on the wire', () => {
  for (const [letter, code] of CTRL_LETTERS) {
    test(`Ctrl+${letter.toUpperCase()} sends 0x${code.toString(16).padStart(2, '0')}`, async ({ page }) => {
      expect(await bytesFor(page, `Control+${letter}`)).toEqual([code]);
    });
  }

  test('Tab and Enter send their own bytes, not a control chord', async ({ page }) => {
    expect(await bytesFor(page, 'Tab')).toEqual([0x09]);
    expect(await bytesFor(page, 'Enter')).toEqual([0x0d]);
  });
});

test('Ctrl+C and Ctrl+D are unaffected by the webgl renderer', async ({ page }) => {
  // The renderer owns the text grid but must not sit anywhere near the key
  // path. This is the check that the seam did not swallow input.
  expect(await bytesFor(page, 'Control+c', '/?renderer=webgl')).toEqual([0x03]);
  expect(await bytesFor(page, 'Control+d', '/?renderer=webgl')).toEqual([0x04]);
});

test('Ctrl+C interrupts a foreground process', async ({ page }) => {
  await boot(page);
  await page.keyboard.type('PS1="READY$ "\n');
  await page.waitForTimeout(500);

  const prompts = () => page.evaluate(() => {
    const t = window.sipTerm.term ?? window.sipTerm.terminal;
    const d = t.wasmTerm.getDimensions();
    let text = '';
    for (let r = 0; r < d.rows; r++) {
      for (const c of t.wasmTerm.getLine(r) ?? []) text += String.fromCodePoint(c.codepoint || 32);
      text += '\n';
    }
    return (text.match(/READY\$/g) ?? []).length;
  });

  await page.keyboard.type('sleep 100');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const before = await prompts();

  await page.keyboard.press('Control+c');
  await page.waitForTimeout(1000);

  // A new prompt means the shell got SIGINT and reaped the sleep.
  expect(await prompts()).toBeGreaterThan(before);
});

test('Ctrl+D sends EOF to a foreground process', async ({ page }) => {
  await boot(page);
  await page.keyboard.type('PS1="READY$ "\n');
  await page.waitForTimeout(500);

  const prompts = () => page.evaluate(() => {
    const t = window.sipTerm.term ?? window.sipTerm.terminal;
    const d = t.wasmTerm.getDimensions();
    let text = '';
    for (let r = 0; r < d.rows; r++) {
      for (const c of t.wasmTerm.getLine(r) ?? []) text += String.fromCodePoint(c.codepoint || 32);
      text += '\n';
    }
    return (text.match(/READY\$/g) ?? []).length;
  });

  await page.keyboard.type('cat > /dev/null');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const before = await prompts();

  await page.keyboard.press('Control+d');
  await page.waitForTimeout(1000);

  expect(await prompts()).toBeGreaterThan(before);
});
