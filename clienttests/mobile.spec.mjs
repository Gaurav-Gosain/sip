// The touch key bar, driven with real touch events against a running server.
//
// Every assertion here goes through either the transport boundary (what byte
// reached the wire) or the DOM state the bar is supposed to leave behind. None
// of it is inferred from a synthesized click, because a click is exactly the
// thing the bar does not use: the whole gesture is cancelled at touchstart and
// the tap is reconstructed from the touch sequence.
//
// The pan test is the one that matters most. The bar used to be an
// overflow-x: auto strip and the browser scrolled it, which cost the software
// keyboard: a native touch scroll arrives at the page with cancelable false, so
// the page cannot stop it, and Blink takes the keyboard down when a scroll
// starts under it. The fix is that the strip is overflow: hidden and the pan is
// done by assigning scrollLeft. What that test asserts is the shape of the fix:
// the strip moved, the touch sequence stayed cancellable, and focus never left
// the element the keyboard is riding on. Anyone who reverts to a native
// scroller will see it fail.

import { test, expect } from '@playwright/test';

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
}

/** Everything sent since the last clear, as one flat byte array. */
function wire(page) {
  return page.evaluate(() => window.__sentInput.flat());
}

function clearWire(page) {
  return page.evaluate(() => { window.__sentInput.length = 0; });
}

/** The centre of a bar button, by its label. */
async function keyCentre(page, label) {
  const btn = page.locator(`#sip-keybar button`, { hasText: new RegExp(`^${label}$`) }).first();
  const box = await btn.boundingBox();
  if (!box) throw new Error(`no bar button labelled ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, btn };
}

async function tapKey(page, label) {
  const { x, y } = await keyCentre(page, label);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(80);
}

test.describe('touch key bar', () => {
  test('is not installed without a touch screen', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium');
    await boot(page);
    await expect(page.locator('#sip-keybar')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.classList.contains('sip-touch'))).toBe(false);
  });

  test('the floating gear is draggable and remembers where it was left', async ({ page }) => {
    await boot(page);
    const gear = page.locator('#settings-toggle');
    const box = await gear.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(50);

    const moved = await gear.boundingBox();
    expect(Math.abs(moved.x - box.x)).toBeGreaterThan(50);
    // Letting go of a drag must not also press the button it was dragged by.
    await expect(page.locator('#settings-panel')).toHaveClass(/hidden/);

    const stored = await page.evaluate(() => localStorage.getItem('sip-web-gear-pos'));
    expect(JSON.parse(stored)).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });
});

test.describe('touch key bar (touch viewport)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('installs, reserves its height, and folds the gear into the strip', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#sip-keybar')).toHaveCount(1);
    expect(await page.evaluate(() => document.body.classList.contains('sip-touch'))).toBe(true);

    // The bar's height is published as a custom property and the container
    // pads itself with it, which is what keeps the bottom row of the terminal
    // out from under the strip.
    const barH = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sip-keybar-h')));
    expect(barH).toBeGreaterThan(20);
    const pad = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('terminal-container')).paddingBottom));
    expect(pad).toBeCloseTo(barH, 0);

    // The floating gear would be floating over a screen with no room to
    // spare, so it is hidden and its action is on the bar instead.
    await expect(page.locator('#settings-toggle')).toBeHidden();
    expect(await page.locator('#sip-keybar button').count()).toBeGreaterThan(10);
  });

  test('a deployment key set replaces the default one', async ({ page }) => {
    // The other half of Config.MobileKeys, which server_test.go covers up to
    // the blob. This is the blob being read.
    await page.addInitScript(() => {
      window.__sipConfig = {
        mobileKeys: [
          { label: 'esc', title: 'Escape', key: 'Escape' },
          { label: '^C', title: 'Interrupt', key: 'c', ctrl: true },
        ],
      };
    });
    await boot(page);

    const labels = await page.locator('.sip-keybar-scroll button').allTextContents();
    expect(labels.slice(0, 2)).toEqual(['esc', '^C']);
    expect(labels).not.toContain('ctrl');

    await clearWire(page);
    await tapKey(page, '\\^C');
    expect(await wire(page)).toEqual([0x03]);
  });

  test('a tap sends the key', async ({ page }) => {
    await boot(page);
    await clearWire(page);
    await tapKey(page, 'esc');
    expect(await wire(page)).toEqual([0x1b]);

    await clearWire(page);
    await tapKey(page, 'tab');
    expect(await wire(page)).toEqual([0x09]);

    await clearWire(page);
    await tapKey(page, '←');
    expect(await wire(page)).toEqual([0x1b, 0x5b, 0x44]); // ESC [ D
  });

  test('ctrl arms for one key, then locks', async ({ page }) => {
    await boot(page);
    const ctrl = (await keyCentre(page, 'ctrl')).btn;

    await tapKey(page, 'ctrl');
    await expect(ctrl).toHaveClass(/armed/);

    // Typed on the keyboard, so this proves the fold happens on the byte path:
    // xterm has already encoded the key by the time the client sees it.
    await clearWire(page);
    await page.keyboard.type('c');
    await page.waitForTimeout(80);
    expect(await wire(page)).toEqual([0x03]);
    await expect(ctrl).not.toHaveClass(/armed/);

    // ... and the next key is unmodified, because it was a one-shot.
    await clearWire(page);
    await page.keyboard.type('c');
    await page.waitForTimeout(80);
    expect(await wire(page)).toEqual([0x63]);

    // Two taps lock it until it is tapped off.
    await tapKey(page, 'ctrl');
    await tapKey(page, 'ctrl');
    await expect(ctrl).toHaveClass(/locked/);
    await clearWire(page);
    await page.keyboard.type('aa');
    await page.waitForTimeout(120);
    expect(await wire(page)).toEqual([0x01, 0x01]);

    await tapKey(page, 'ctrl');
    await expect(ctrl).not.toHaveClass(/locked/);
  });

  test('an armed modifier reaches a bar key and a cursor key', async ({ page }) => {
    await boot(page);
    await tapKey(page, 'ctrl');
    await clearWire(page);
    await tapKey(page, '←');
    // ESC [ 1 ; 5 D
    expect(await wire(page)).toEqual([0x1b, 0x5b, 0x31, 0x3b, 0x35, 0x44]);
  });

  test('a mouse report does not spend an armed modifier', async ({ page }) => {
    await boot(page);
    await tapKey(page, 'ctrl');
    // A multi-byte sequence on the input path is not a keystroke. Spending the
    // modifier on it would take it away from the key the user is about to
    // press, so it passes through and the arm survives.
    await page.evaluate(() => window.sipTerm.connection.send(
      new TextEncoder().encode('\x1b[<0;5;3M')));
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.sipTerm.mobile.mods.ctrl)).toBe(1);
  });

  test('a pan moves the strip by hand and keeps the keyboard focus', async ({ page }) => {
    await boot(page);

    // Focus is what the software keyboard rides on, so the whole point of the
    // hand-driven pan is that this element still holds it afterwards.
    await page.evaluate(() => window.sipTerm.webterm.xterm.textarea.focus());
    const focused = () => page.evaluate(() =>
      document.activeElement === window.sipTerm.webterm.xterm.textarea);
    expect(await focused()).toBe(true);

    const scrollLeft = () => page.evaluate(() => document.querySelector('.sip-keybar-scroll').scrollLeft);
    expect(await scrollLeft()).toBe(0);

    // Record whether the browser ever handed us a non-cancellable touch event,
    // which is what a native scroll looks like from the page's side.
    await page.evaluate(() => {
      window.__uncancellable = 0;
      for (const type of ['touchmove', 'touchend']) {
        document.getElementById('sip-keybar').addEventListener(type, (e) => {
          if (!e.cancelable) window.__uncancellable++;
        }, { capture: true });
      }
    });

    // A real touch pan. Playwright's touchscreen only taps, so this goes
    // through CDP, which is also the only way to get a multi-step sequence
    // with the same touch point identity.
    const cdp = await page.context().newCDPSession(page);
    const start = await keyCentre(page, 'esc');
    await clearWire(page);
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: start.y, id: 1 }],
    });
    await touch('touchStart', start.x);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', start.x - i * 12);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', start.x - 120);
    await page.waitForTimeout(400);

    expect(await scrollLeft()).toBeGreaterThan(50);
    expect(await page.evaluate(() => window.__uncancellable)).toBe(0);
    expect(await focused()).toBe(true);
    // A flick past a button is not a press of it.
    expect(await wire(page)).toEqual([]);
  });
});

// The leader chord, which is the reason the bar can drive tmux, screen, zellij
// or emacs at all. None of them can be reached from a phone otherwise: their
// bindings all start with a modifier held while a letter is pressed, and a
// touch screen cannot hold anything.
//
// Every assertion here is a byte at the transport boundary. A chord that lights
// the button and sends nothing, or sends the leader twice, looks identical from
// the DOM and is exactly the failure worth catching.
test.describe('leader chords and rows (touch viewport)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  // A tmux-shaped deployment, written the way a stranger would write one:
  // nothing here knows anything about the program on the other end except its
  // leader and three of its bindings.
  const TMUX = {
    mobilePrefix: { key: 'b', code: 'KeyB', ctrl: true },
    mobileRows: [
      {
        label: 'tmux',
        collapsible: true,
        keys: [
          { label: 'pfx', title: 'Prefix, then a key', prefix: true },
          { label: 'new', title: 'New window', key: 'c', code: 'KeyC', prefixed: true },
          { label: 'next', title: 'Next window', key: 'n', code: 'KeyN', prefixed: true },
        ],
      },
      {
        keys: [
          { label: 'esc', title: 'Escape', key: 'Escape', code: 'Escape' },
          { label: 'ctrl', title: 'Ctrl', mod: 'ctrl' },
        ],
      },
    ],
  };

  const withConfig = (page, cfg) => page.addInitScript((c) => { window.__sipConfig = c; }, cfg);

  test('a chord button sends the leader and then the key, bare', async ({ page }) => {
    await withConfig(page, TMUX);
    await boot(page);
    await clearWire(page);
    await tapKey(page, 'new');
    // Ctrl+B, then a plain c. Not Ctrl+B Ctrl+C, which is a different chord.
    expect(await wire(page)).toEqual([0x02, 0x63]);

    await clearWire(page);
    await tapKey(page, 'next');
    expect(await wire(page)).toEqual([0x02, 0x6e]);
  });

  test('the prefix button arms the chord for the software keyboard', async ({ page }) => {
    await withConfig(page, TMUX);
    await boot(page);
    const pfx = (await keyCentre(page, 'pfx')).btn;

    await clearWire(page);
    await tapKey(page, 'pfx');
    expect(await wire(page)).toEqual([0x02]);
    await expect(pfx).toHaveClass(/armed/);

    // The half of the feature the bar cannot supply buttons for: every other
    // binding the program has, typed on the keyboard proper.
    await clearWire(page);
    await page.keyboard.type('d');
    await page.waitForTimeout(80);
    expect(await wire(page)).toEqual([0x64]);
    await expect(pfx).not.toHaveClass(/armed/);
  });

  test('arming by hand and then tapping a chord does not send the leader twice', async ({ page }) => {
    await withConfig(page, TMUX);
    await boot(page);
    await tapKey(page, 'pfx');
    await clearWire(page);
    await tapKey(page, 'new');
    expect(await wire(page)).toEqual([0x63]);
    await expect((await keyCentre(page, 'pfx')).btn).not.toHaveClass(/armed/);
  });

  test('a sticky modifier is cleared by a chord, not folded into it', async ({ page }) => {
    await withConfig(page, TMUX);
    await boot(page);
    const ctrl = (await keyCentre(page, 'ctrl')).btn;
    await tapKey(page, 'ctrl');
    await expect(ctrl).toHaveClass(/armed/);

    await clearWire(page);
    await tapKey(page, 'new');
    // A stuck Ctrl folded in would make this 0x02 0x03: a different chord
    // from the one on the button, sent by a user who pressed one button.
    expect(await wire(page)).toEqual([0x02, 0x63]);
    await expect(ctrl).not.toHaveClass(/armed/);
  });

  test('with no prefix configured the button is left out and a chord key sends itself', async ({ page }) => {
    await withConfig(page, { ...TMUX, mobilePrefix: undefined });
    await boot(page);

    // A button that armed a chord which is never sent would be a lie, so it
    // is not built. The keys around it still work.
    await expect(page.locator('#sip-keybar button', { hasText: /^pfx$/ })).toHaveCount(0);
    await clearWire(page);
    await tapKey(page, 'new');
    expect(await wire(page)).toEqual([0x63]);
  });

  test('rows stack, fold away, and are remembered', async ({ page }) => {
    await withConfig(page, TMUX);
    await boot(page);

    const rows = page.locator('.sip-keybar-row');
    await expect(rows).toHaveCount(2);
    // Declared order is drawn order, and the typing row goes last because it
    // is the one nearest the thumb already on the keyboard.
    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    expect(first.y).toBeLessThan(second.y);

    const barH = () => page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sip-keybar-h')));
    const open = await barH();

    await tapKey(page, '▾');
    await expect(rows.nth(0)).toBeHidden();
    await expect(rows.nth(1)).toBeVisible();
    // Folding has to give the space back, or it is only hiding the buttons.
    expect(await barH()).toBeLessThan(open);
    const pad = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('terminal-container')).paddingBottom));
    expect(pad).toBeCloseTo(await barH(), 0);
    expect(await page.evaluate(() => localStorage.getItem('sip.keybar.rows'))).toBe('0');

    await boot(page);
    await expect(page.locator('.sip-keybar-row').nth(0)).toBeHidden();
    await tapKey(page, '▴');
    await expect(page.locator('.sip-keybar-row').nth(0)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sip.keybar.rows'))).toBe('1');
  });

  test('each row pans on its own', async ({ page }) => {
    await withConfig(page, {
      mobilePrefix: TMUX.mobilePrefix,
      mobileRows: [
        { label: 'wide', keys: Array.from({ length: 24 }, (_, i) => ({ label: `a${i}`, key: 'a' })) },
        { label: 'also wide', keys: Array.from({ length: 24 }, (_, i) => ({ label: `b${i}`, key: 'b' })) },
      ],
    });
    await boot(page);

    const offsets = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('.sip-keybar-scroll')).map((el) => el.scrollLeft));
    expect(await offsets()).toEqual([0, 0]);

    const cdp = await page.context().newCDPSession(page);
    const start = await keyCentre(page, 'b0');
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: start.y, id: 1 }],
    });
    await touch('touchStart', start.x);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', start.x - i * 12);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', start.x - 120);
    await page.waitForTimeout(400);

    const [top, bottom] = await offsets();
    expect(bottom).toBeGreaterThan(50);
    // The row the finger did not touch stayed where it was. One shared
    // scroller would move both, which puts every key on the other row
    // somewhere else between one tap and the next.
    expect(top).toBe(0);
  });
});
