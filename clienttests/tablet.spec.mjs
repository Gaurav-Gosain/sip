// The key bar and the touch layer on a tablet, and the software keyboard
// going away.
//
// The keyboard cannot be raised in emulation, so it is played back through
// the two APIs mobile.js measures it with: the VirtualKeyboard API's
// geometrychange with a shadowed boundingRect, which is Chrome on Android, and
// a visualViewport resize with a shadowed height, which is Safari on iOS. What
// the tests hold to is geometry, not CSS: after the keyboard goes, every row of
// the grid is above the bar, the bar says the keyboard is down, and a layout
// viewport change that arrives after the visual one is not left describing a
// keyboard that is no longer there.

import { test, expect, devices } from '@playwright/test';

// The descriptors carry defaultBrowserType, which test.use refuses inside a
// describe group. The project already picks the browser.
const profile = ({ defaultBrowserType, ...rest }) => rest;
const TABLET_LANDSCAPE = profile(devices['Galaxy Tab S4 landscape']);
const TABLET_PORTRAIT = profile(devices['Galaxy Tab S4']);

function pinTransport(page, transport) {
  return page.addInitScript((t) => {
    localStorage.setItem('sip-web-settings', JSON.stringify({
      transport: t, fontSize: 14, copyOnSelect: false, cursorBlink: false, renderer: 'canvas',
    }));
  }, transport);
}

async function boot(page) {
  await pinTransport(page, 'websocket');
  await page.goto('/');
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  await expect(page.locator('#sip-keybar')).toHaveCount(1);
}

/** Where the grid ends and the bar begins, in viewport pixels. */
function layout(page) {
  return page.evaluate(() => {
    const t = window.sipTerm.webterm.xterm;
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    const bar = document.getElementById('sip-keybar').getBoundingClientRect();
    const rows = document.getElementById('sip-keybar-rows').getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    return {
      rows: t.rows,
      cols: t.cols,
      screenBottom: screen.bottom,
      barTop: bar.top,
      barLeft: bar.left,
      barRight: bar.right,
      rowsLeft: rows.left,
      rowsRight: rows.right,
      inset: cs.getPropertyValue('--sip-kb-inset').trim(),
      keybarH: cs.getPropertyValue('--sip-keybar-h').trim(),
      innerW: window.innerWidth,
      kbOpen: document.body.classList.contains('sip-kb-open'),
      keyboardLabel: (document.querySelector('#sip-keybar-pin button:last-child') || {}).textContent,
      fits: document.getElementById('sip-keybar').classList.contains('fits'),
    };
  });
}

/** Chrome on Android: the keyboard reports its rectangle, focus stays put. */
function vkGeometry(page, height) {
  return page.evaluate((h) => {
    const vk = navigator.virtualKeyboard;
    if (!vk) throw new Error('this chromium has no VirtualKeyboard API');
    const W = window.innerWidth;
    const H = window.innerHeight;
    Object.defineProperty(vk, 'boundingRect', {
      configurable: true,
      value: h
        ? { x: 0, y: H - h, width: W, height: h, top: H - h, bottom: H, left: 0, right: W }
        : { x: 0, y: 0, width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 },
    });
    vk.dispatchEvent(new Event('geometrychange'));
  }, height);
}

/** Safari on iOS: the visual viewport shrinks, the layout viewport does not. */
function vvHeight(page, height) {
  return page.evaluate((h) => {
    const vv = window.visualViewport;
    if (h == null) {
      delete vv.height;
    } else {
      Object.defineProperty(vv, 'height', { configurable: true, value: h });
    }
    vv.dispatchEvent(new Event('resize'));
  }, height);
}

async function tapTerminal(page) {
  const c = await page.evaluate(() => {
    const r = document.querySelector('.xterm-screen').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeTapGesture', {
    x: c.x, y: c.y, duration: 60, gestureSourceType: 'touch',
  });
  await page.waitForTimeout(150);
  return cdp;
}

test.describe('the key bar on a tablet', () => {
  test.use({ ...TABLET_LANDSCAPE });

  test('rows that fit are centred, with the pinned keys beside them', async ({ page }) => {
    await boot(page);
    const l = await layout(page);
    expect(l.fits, 'the bar should know that its rows fit on a 1138px screen').toBe(true);
    // Centred: the rows box sits in the middle of the screen, not in the
    // left corner, and the bar itself still spans the width.
    const rowsCentre = (l.rowsLeft + l.rowsRight) / 2;
    expect(Math.abs(rowsCentre - l.innerW / 2), 'the rows should be centred on the screen').toBeLessThan(80);
    expect(l.rowsLeft, 'the first key should not be pressed into the left corner').toBeGreaterThan(80);
    expect(l.barLeft).toBe(0);
    expect(l.barRight).toBeCloseTo(l.innerW, 0);
    // The pinned keys sit next to the rows, within reach of the same hand.
    const pin = await page.locator('#sip-keybar-pin').boundingBox();
    expect(pin.x - l.rowsRight, 'the pinned keys should sit beside the rows, not at the far edge').toBeLessThan(40);
  });

  test('the keys are sized for a thumb', async ({ page }) => {
    await boot(page);
    const boxes = await page.locator('.sip-keybar-scroll button').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, h: r.height })));
    for (const b of boxes) {
      expect(b.h, 'every key should be at least 42px tall').toBeGreaterThanOrEqual(42);
      expect(b.w, 'every key should be at least 38px wide').toBeGreaterThanOrEqual(38);
    }
    // Space between neighbours, so a thumb does not land across two.
    const gaps = [];
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].w);
      if (gap >= 0 && gap < 30) gaps.push(gap);
    }
    expect(gaps.length).toBeGreaterThan(5);
    expect(Math.min(...gaps), 'neighbouring keys should be at least 5px apart').toBeGreaterThanOrEqual(5);
    const pad = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('sip-keybar'));
      return { l: parseFloat(cs.paddingLeft), t: parseFloat(cs.paddingTop) };
    });
    expect(pad.l, 'the bar should keep its keys off the screen edge').toBeGreaterThanOrEqual(6);
    expect(pad.t).toBeGreaterThanOrEqual(6);
  });

  test('the grid keeps a margin from the glass', async ({ page }) => {
    await boot(page);
    const screen = await page.evaluate(() => document.querySelector('.xterm-screen').getBoundingClientRect().toJSON());
    expect(screen.left, 'the first column should not touch the left edge').toBeGreaterThanOrEqual(4);
    expect(screen.top, 'the first row should not touch the top edge').toBeGreaterThanOrEqual(4);
  });

  test('on load the bar does not claim a keyboard that was never raised', async ({ page }) => {
    await boot(page);
    // The page focuses the terminal itself, which raises no keyboard.
    expect(await page.evaluate(() => document.activeElement === window.sipTerm.webterm.xterm.textarea)).toBe(true);
    const l = await layout(page);
    expect(l.kbOpen, 'programmatic focus is not a keyboard').toBe(false);
    expect(l.keyboardLabel).toBe('abc');

    // A tap is a gesture, so the focus it brings is a keyboard on its way.
    await tapTerminal(page);
    const after = await layout(page);
    expect(after.kbOpen, 'a tap on the terminal asks for the keyboard').toBe(true);
    expect(after.keyboardLabel).toBe('hide');
  });
});

for (const [name, device] of [['landscape', TABLET_LANDSCAPE], ['portrait', TABLET_PORTRAIT]]) {
  test.describe(`the software keyboard closing (${name})`, () => {
    test.use({ ...device });

    test('through the VirtualKeyboard API leaves no row behind the bar', async ({ page }) => {
      await boot(page);
      await tapTerminal(page);
      const before = await layout(page);

      await vkGeometry(page, 320);
      await page.waitForTimeout(400);
      const open = await layout(page);
      expect(open.inset).toBe('320px');
      expect(open.rows, 'the keyboard should have taken rows away').toBeLessThan(before.rows);
      expect(open.screenBottom, 'no row may sit behind the bar while the keyboard is up').toBeLessThanOrEqual(open.barTop);
      expect(open.kbOpen).toBe(true);

      // The Android back button: the keyboard goes, focus stays.
      await vkGeometry(page, 0);
      await page.waitForTimeout(400);
      const closed = await layout(page);
      expect(closed.inset, 'the inset must return to zero when the keyboard goes').toBe('0px');
      expect(closed.rows, 'the rows the keyboard took should come back').toBe(before.rows);
      expect(closed.screenBottom, 'no row may sit behind the bar after the keyboard has gone').toBeLessThanOrEqual(closed.barTop);
      expect(closed.kbOpen, 'a keyboard that measured zero is down, whatever focus says').toBe(false);
      expect(closed.keyboardLabel).toBe('abc');
      expect(await page.evaluate(() => document.activeElement === window.sipTerm.webterm.xterm.textarea),
        'the keyboard going must not have cost the terminal its focus').toBe(true);
    });

    test('through the visual viewport leaves no row behind the bar', async ({ page }) => {
      await boot(page);
      await tapTerminal(page);
      const before = await layout(page);
      const innerH = await page.evaluate(() => window.innerHeight);

      await vvHeight(page, innerH - 300);
      await page.waitForTimeout(400);
      const open = await layout(page);
      expect(open.inset).toBe('300px');
      expect(open.rows).toBeLessThan(before.rows);
      expect(open.screenBottom).toBeLessThanOrEqual(open.barTop);

      await vvHeight(page, null);
      await page.waitForTimeout(400);
      const closed = await layout(page);
      expect(closed.inset, 'the inset must return to zero when the keyboard goes').toBe('0px');
      expect(closed.rows).toBe(before.rows);
      expect(closed.screenBottom, 'no row may sit behind the bar after the keyboard has gone').toBeLessThanOrEqual(closed.barTop);
      expect(closed.kbOpen).toBe(false);
    });
  });
}

test.describe('a layout viewport that changes after the visual one', () => {
  test.use({ ...TABLET_LANDSCAPE });

  test('is measured again on window resize', async ({ page }) => {
    await boot(page);
    await tapTerminal(page);
    const innerH = await page.evaluate(() => window.innerHeight);

    // A browser that resizes the layout viewport for the keyboard, but
    // reports the visual viewport a beat earlier: at that moment the
    // difference names a keyboard. Then the layout catches up and the only
    // event is window.resize.
    await vvHeight(page, innerH - 300);
    await page.waitForTimeout(300);
    expect((await layout(page)).inset).toBe('300px');

    await page.evaluate(() => {
      delete window.visualViewport.height;
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(300);
    const l = await layout(page);
    expect(l.inset, 'a window resize must re-read the visual viewport rather than keep a stale inset').toBe('0px');
    expect(l.screenBottom).toBeLessThanOrEqual(l.barTop);
  });
});

test.describe('what teaches the drag', () => {
  test.use({ ...TABLET_LANDSCAPE });

  test('a held finger shows a ring that follows the drag', async ({ page }) => {
    await boot(page);
    const c = await page.evaluate(() => {
      const r = document.querySelector('.xterm-screen').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });
    const ring = page.locator('#sip-touch-ring');

    await touch('touchStart', c.x, c.y);
    await page.waitForTimeout(150);
    expect(await ring.count() === 0 || !(await ring.evaluate((el) => el.classList.contains('on'))),
      'the ring must not show before the hold has landed').toBe(true);

    await page.waitForTimeout(500);
    await expect(ring, 'the ring should appear once the hold has landed').toHaveClass(/on/);
    const at = await ring.evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
    expect(Math.abs(at.x - c.x)).toBeLessThan(2);
    expect(Math.abs(at.y - c.y)).toBeLessThan(2);

    for (let i = 1; i <= 5; i++) await touch('touchMove', c.x + i * 20, c.y + i * 10);
    await page.waitForTimeout(50);
    const moved = await ring.evaluate((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
    expect(moved.x - at.x, 'the ring should follow the finger').toBeGreaterThan(80);
    await expect(ring).toHaveClass(/on/);

    await touch('touchEnd', c.x + 100, c.y + 50);
    await page.waitForTimeout(50);
    await expect(ring, 'the ring should go with the finger').not.toHaveClass(/on/);
  });

  test('the first pan shows the hint once', async ({ page }) => {
    await boot(page);
    const c = await page.evaluate(() => {
      const r = document.querySelector('.xterm-screen').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    const cdp = await page.context().newCDPSession(page);
    const pan = async () => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
      for (let i = 1; i <= 4; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y - i * 15, id: 1 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(100);
    };
    const hint = page.locator('#sip-touch-hint');
    await expect(hint).toHaveCount(0);

    await pan();
    await expect(hint, 'the first pan should show the hint').toHaveClass(/on/);
    await expect(hint).toHaveText('Hold, then drag to move or select.');
    // Above the bar, never over it.
    const h = await hint.boundingBox();
    const l = await layout(page);
    expect(h.y + h.height, 'the hint should sit above the bar').toBeLessThanOrEqual(l.barTop);
    expect(await page.evaluate(() => localStorage.getItem('sip.touch.hint'))).toBe('1');

    // Once. A second page load with the same storage shows nothing.
    await page.reload();
    await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
    await pan();
    await page.waitForTimeout(200);
    expect(await page.locator('#sip-touch-hint.on').count(), 'the hint is shown once, ever').toBe(0);
  });

  test('DisableHint draws neither', async ({ page }) => {
    await page.addInitScript(() => { window.__sipConfig = { mobileMouse: { hint: false } }; });
    await boot(page);
    const c = await page.evaluate(() => {
      const r = document.querySelector('.xterm-screen').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await page.waitForTimeout(650);
    expect(await page.locator('#sip-touch-ring').count()).toBe(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y - 60, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    expect(await page.locator('#sip-touch-hint').count()).toBe(0);
  });
});

test.describe('the key bar on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a row that overflows stays anchored at the left', async ({ page }) => {
    await boot(page);
    const l = await layout(page);
    expect(l.fits, 'twelve keys do not fit in 390px').toBe(false);
    const first = await page.locator('.sip-keybar-scroll button').first().boundingBox();
    expect(first.x, 'an overflowing row starts at the left edge so nothing is centred out of reach').toBeLessThan(20);
  });
});
