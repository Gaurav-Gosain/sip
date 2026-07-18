// Modifier chords must never reach the PTY as their bare printable character.
//
// The bug this pins: handleKeyDown had three paths that returned WITHOUT
// calling preventDefault. The browser then carried on to its default action,
// fired `beforeinput` with inputType "insertText", and the beforeinput handler
// sent the plain character. Ctrl+L put 0x6c ("l") on the wire instead of 0x0c,
// and every chord degraded the same way.
//
// The trigger in the wild is Firefox on Linux with an IME daemon (ibus/fcitx)
// running: it reports keyCode 229, the "IME is processing" sentinel, for
// ordinary keys. Synthesized Playwright key events never carry that sentinel,
// which is exactly why a green keyboard suite still shipped this. So these
// tests drive the bail-out conditions directly rather than hoping the harness
// reproduces the environment.

import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#connection-status');
      // Either transport counts as connected; Firefox reaches WebTransport.
      return el && (el.classList.contains('connected') || el.classList.contains('webtransport'));
    },
    null,
    { timeout: 45_000 },
  );
  await page.waitForFunction(() => window.sipTerm?.term?.wasmTerm, null, { timeout: 45_000 });

  // Capture at the adapter, not at WebSocket.send: the client may be on
  // WebTransport, in which case nothing passes through WebSocket at all.
  await page.evaluate(() => {
    const adapter = window.sipTerm.adapter;
    const original = adapter.sipWrite.bind(adapter);
    window.__sent = [];
    adapter.sipWrite = (data) => {
      window.__sent.push(
        typeof data === 'string'
          ? Array.from(new TextEncoder().encode(data))
          : Array.from(new Uint8Array(data.buffer ?? data)),
      );
      return original(data);
    };
  });
}

/**
 * Dispatch a Ctrl+L keydown under a chosen bail-out condition, then deliver the
 * beforeinput the browser would generate if the keydown went unprevented.
 * Returns every byte the client tried to send.
 */
function ctrlLUnder(page, condition) {
  return page.evaluate((cond) => {
    window.__sent.length = 0;

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      code: cond === 'unmappedCode' ? 'Bogus999' : 'KeyL',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    if (cond === 'imeSentinel') {
      Object.defineProperty(event, 'keyCode', { get: () => 229 });
      Object.defineProperty(event, 'which', { get: () => 229 });
    }
    if (cond === 'composing') {
      Object.defineProperty(event, 'isComposing', { get: () => true });
    }

    document.querySelector('#terminal').dispatchEvent(event);

    if (!event.defaultPrevented) {
      const textarea = document.querySelector('#terminal textarea')
        || document.querySelector('textarea');
      textarea?.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'l',
        bubbles: true,
        cancelable: true,
      }));
    }

    return { bytes: window.__sent.flat(), prevented: event.defaultPrevented };
  }, condition);
}

const LITERAL_L = 0x6c;
const CTRL_L = 0x0c;

test.describe('modifier chords never leak as text', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });

  for (const condition of ['imeSentinel', 'composing']) {
    test(`Ctrl+L sends 0x0c under ${condition}`, async ({ page }) => {
      const { bytes } = await ctrlLUnder(page, condition);
      expect(bytes, 'the chord must not arrive as the literal character')
        .not.toContain(LITERAL_L);
      expect(bytes, 'the chord must arrive as its control byte').toContain(CTRL_L);
    });
  }

  test('an unmapped key code swallows the chord rather than leaking it', async ({ page }) => {
    const { bytes, prevented } = await ctrlLUnder(page, 'unmappedCode');
    expect(prevented, 'a chord on an unmapped code must still be prevented').toBe(true);
    expect(bytes).not.toContain(LITERAL_L);
  });

  test('ordinary typing still reaches the PTY', async ({ page }) => {
    await page.locator('#terminal').click();
    await page.evaluate(() => { window.__sent.length = 0; });
    await page.keyboard.type('hello');
    await page.waitForTimeout(300);
    const bytes = await page.evaluate(() => window.__sent.flat());
    expect(String.fromCharCode(...bytes.filter((b) => b >= 0x20 && b < 0x7f))).toBe('hello');
  });

  test('unmodified input still routes through beforeinput for IME and mobile', async ({ page }) => {
    const bytes = await page.evaluate(() => {
      window.__sent.length = 0;
      const textarea = document.querySelector('#terminal textarea')
        || document.querySelector('textarea');
      textarea?.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText', data: 'x', bubbles: true, cancelable: true,
      }));
      return window.__sent.flat();
    });
    expect(bytes, 'the IME/mobile text path must keep working').toContain(0x78);
  });

  test('the real Ctrl chords put their control bytes on the wire', async ({ page }) => {
    await page.locator('#terminal').click();
    const chords = [['Control+l', 0x0c], ['Control+c', 0x03], ['Control+d', 0x04],
                    ['Control+a', 0x01], ['Control+u', 0x15], ['Control+w', 0x17]];
    for (const [combo, expected] of chords) {
      await page.evaluate(() => { window.__sent.length = 0; });
      await page.keyboard.press(combo);
      await page.waitForTimeout(150);
      const bytes = await page.evaluate(() => window.__sent.flat());
      expect(bytes, `${combo} should send 0x${expected.toString(16)}`).toContain(expected);
      expect(bytes, `${combo} must not send its bare letter`)
        .not.toContain(combo.slice(-1).charCodeAt(0));
    }
  });
});
