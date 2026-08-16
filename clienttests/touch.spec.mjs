// A finger on the terminal, driven through Chrome's own gesture recognizer.
//
// Every assertion here reads the bytes at the transport boundary. Nothing is
// inferred from a DOM state or from a listener count, because the whole point
// of this layer is what reaches the program, and the two have been observed
// disagreeing: xterm's inertial scroll happily *called* its encoder for every
// frame of a fling while what it put on the wire was `NaN;NaNM`.
//
// The gestures go through `Input.synthesizeTapGesture` and
// `Input.synthesizeScrollGesture` rather than `Input.dispatchTouchEvent`,
// because only the recognizer produces what a finger produces: the timing that
// makes a fling a fling, and the compatibility events a browser synthesizes
// from a touch it was allowed to keep.

import { test, expect } from '@playwright/test';

const MSG_INPUT = 0x30;

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
    const conn = window.sipTerm.connection;
    if (!conn) throw new Error('no connection to hook');
    if (!conn.ws) throw new Error('expected a WebSocket to hook');
    const ws = conn.ws;
    const send = ws.send.bind(ws);
    ws.send = (frame) => {
      const b = new Uint8Array(frame);
      if (b[0] === 0x30) window.__sentInput.push(Array.from(b.subarray(1)));
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

/**
 * Put the terminal into mouse reporting the way a program does it.
 *
 * 1000 (click), 1002 (drag) and 1006 (SGR encoding) are what a modern
 * full-screen program asks for. Writing them through xterm's parser is the
 * same path a program's own bytes take.
 */
async function enableMouse(page, modes = '1000;1002;1006') {
  await page.evaluate((m) => window.sipTerm.webterm.xterm.write(`\x1b[?${m}h`), modes);
  await page.waitForTimeout(120);
}

/** Everything sent since the last clear, decoded as latin-1 text. */
function wireText(page) {
  return page.evaluate(() =>
    window.__sentInput.flat().map((b) => String.fromCharCode(b)).join(''));
}

function clearWire(page) {
  return page.evaluate(() => { window.__sentInput.length = 0; });
}

/** The centre of the terminal screen element, in viewport pixels. */
async function screenCentre(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.xterm-screen');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
}

/** Every SGR mouse report in a byte stream, as {button, col, row, release}. */
function sgrReports(text) {
  const out = [];
  const re = /\x1b\[<(\d+);([^;]*);([^Mm]*)([Mm])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ button: Number(m[1]), col: m[2], row: m[3], release: m[4] === 'm' });
  }
  return out;
}

test.describe('touch on the terminal', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('an inertial fling never reports a NaN coordinate', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    // Three flings, the way they were measured: a fast swipe that the page
    // lets go of, so xterm's Gesture runs its own inertia afterwards.
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: c.x, y: c.y, xDistance: 0, yDistance: -260,
        speed: 6000, gestureSourceType: 'touch', preventFling: false,
      });
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(400);

    const text = await wireText(page);
    const reports = sgrReports(text);
    const nan = reports.filter((r) => r.col === 'NaN' || r.row === 'NaN');
    console.log(`fling: ${reports.length} mouse reports, ${nan.length} with NaN coordinates`);

    // The fling has to have produced reports at all, or this proves nothing.
    expect(reports.length).toBeGreaterThan(0);
    expect(nan.length).toBe(0);
    expect(text).not.toContain('NaN');
  });

  test('a tap is a click, and it raises the software keyboard', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    await cdp.send('Input.synthesizeTapGesture', {
      x: c.x, y: c.y, duration: 60, tapCount: 1, gestureSourceType: 'touch',
    });
    await page.waitForTimeout(200);

    const reports = sgrReports(await wireText(page));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ button: 0, release: false });
    expect(reports[1]).toMatchObject({ button: 0, release: true });
    // Press and release at the same cell: that is what a click is.
    expect(reports[1].col).toBe(reports[0].col);
    expect(reports[1].row).toBe(reports[0].row);

    // And the tap put the keyboard up, which means focus on xterm's textarea.
    const focused = await page.evaluate(() =>
      document.activeElement === window.sipTerm.webterm.xterm.textarea);
    expect(focused).toBe(true);
  });

  test('a tap reports the cell it landed on', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const cdp = await page.context().newCDPSession(page);

    // Two taps a known number of cells apart must differ by that many cells.
    const geom = await page.evaluate(() => {
      const el = document.querySelector('.xterm-screen');
      const r = el.getBoundingClientRect();
      const t = window.sipTerm.webterm.xterm;
      return { left: r.left, top: r.top, w: r.width / t.cols, h: r.height / t.rows };
    });
    const at = (col, row) => ({
      x: Math.round(geom.left + (col + 0.5) * geom.w),
      y: Math.round(geom.top + (row + 0.5) * geom.h),
    });

    await clearWire(page);
    const a = at(3, 2);
    await cdp.send('Input.synthesizeTapGesture', { ...a, duration: 60, gestureSourceType: 'touch' });
    await page.waitForTimeout(150);
    const b = at(9, 7);
    await cdp.send('Input.synthesizeTapGesture', { ...b, duration: 60, gestureSourceType: 'touch' });
    await page.waitForTimeout(150);

    const reports = sgrReports(await wireText(page));
    expect(reports).toHaveLength(4);
    // SGR coordinates are 1-based, so the first tap is column 4, row 3.
    expect(reports[0]).toMatchObject({ col: '4', row: '3' });
    expect(reports[2]).toMatchObject({ col: '10', row: '8' });
  });

  test('a long press is a right click', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    // Past the recognizer's 700ms hold delay, and without moving, which is
    // what tells a long press from the drag below.
    await cdp.send('Input.synthesizeTapGesture', {
      x: c.x, y: c.y, duration: 900, gestureSourceType: 'touch',
    });
    await page.waitForTimeout(200);

    const reports = sgrReports(await wireText(page));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ button: 2, release: false });
    expect(reports[1]).toMatchObject({ button: 2, release: true });
  });

  test('press, hold and drag is a press, motion and release', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const cdp = await page.context().newCDPSession(page);
    const c = await screenCentre(page);

    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
    });

    await clearWire(page);
    await touch('touchStart', c.x, c.y);
    // Sit still long enough for the hold to land. A move before this is a pan.
    await page.waitForTimeout(600);
    for (let i = 1; i <= 6; i++) await touch('touchMove', c.x, c.y + i * 12);
    await touch('touchEnd', c.x, c.y + 72);
    await page.waitForTimeout(300);

    const reports = sgrReports(await wireText(page));
    const press = reports[0];
    const release = reports[reports.length - 1];
    expect(press).toMatchObject({ button: 0, release: false });
    expect(release).toMatchObject({ button: 0, release: true });

    // Everything between is motion with button 1 held: 32 is the motion bit.
    const motion = reports.slice(1, -1);
    expect(motion.length).toBeGreaterThan(0);
    expect(motion.every((r) => r.button === 32 && !r.release)).toBe(true);

    // The drag walked down the screen, and no two reports name the same cell:
    // xterm drops a motion report that repeats the previous one.
    expect(Number(release.row)).toBeGreaterThan(Number(press.row));
    const cells = motion.map((r) => `${r.col},${r.row}`);
    expect(new Set(cells).size).toBe(cells.length);

    // A drag is not also a scroll. Wheel reports (64 up, 65 down) would mean
    // xterm's own pan handler ran underneath the finger at the same time.
    expect(reports.some((r) => r.button === 64 || r.button === 65)).toBe(false);
    // Nor is the touch that ended the drag also a tap.
    expect(reports.filter((r) => r.button === 0).length).toBe(2);
  });

  test('a pan is still a scroll', async ({ page }) => {
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: c.x, y: c.y, xDistance: 0, yDistance: -120,
      speed: 800, gestureSourceType: 'touch', preventFling: true,
    });
    await page.waitForTimeout(300);

    const reports = sgrReports(await wireText(page));
    expect(reports.length).toBeGreaterThan(0);
    // Wheel and nothing else: no press, no release, no motion.
    expect(reports.every((r) => r.button === 64 || r.button === 65)).toBe(true);
  });

  test('with no mouse mode a hold and drag selects text', async ({ page }) => {
    await boot(page);
    // Something to select, and no mouse mode: this is the plain shell case.
    await page.evaluate(() => window.sipTerm.webterm.xterm.write(
      '\r\nalpha beta gamma delta epsilon zeta\r\n'));
    await page.waitForTimeout(150);

    // Find the row the text actually landed on rather than assuming one: the
    // shell owns the cursor and the prompt is not this test's business.
    const geom = await page.evaluate(() => {
      const el = document.querySelector('.xterm-screen');
      const r = el.getBoundingClientRect();
      const t = window.sipTerm.webterm.xterm;
      const buf = t.buffer.active;
      let row = -1;
      for (let i = 0; i < t.rows; i++) {
        const line = buf.getLine(buf.viewportY + i);
        if (line && line.translateToString(true).includes('alpha')) { row = i; break; }
      }
      return { left: r.left, top: r.top, w: r.width / t.cols, h: r.height / t.rows, row };
    });
    expect(geom.row).toBeGreaterThanOrEqual(0);
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(geom.top + (geom.row + 0.5) * geom.h);
    const x0 = Math.round(geom.left + 0.5 * geom.w);

    await clearWire(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }],
    });
    await page.waitForTimeout(600);
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: Math.round(x0 + i * geom.w), y, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);

    const selection = await page.evaluate(() => window.sipTerm.webterm.xterm.getSelection());
    expect(selection.trim().length).toBeGreaterThan(0);
    expect('alpha beta gamma delta epsilon zeta').toContain(selection.trim());
    // And a program that asked for no mouse reports got none.
    expect(await wireText(page)).toBe('');
  });
});

// The switches a deployment actually has. Config.MobileMouse reaches the page
// as window.__sipConfig.mobileMouse and nothing else, so setting it here is
// the same thing the server does, one step earlier.
test.describe('turning it off', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  const withConfig = (page, cfg) =>
    page.addInitScript((c) => { window.__sipConfig = { mobileMouse: c }; }, cfg);

  test('DisableTap leaves a tap doing nothing', async ({ page }) => {
    await withConfig(page, { tap: false });
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    await cdp.send('Input.synthesizeTapGesture', {
      x: c.x, y: c.y, duration: 60, gestureSourceType: 'touch',
    });
    await page.waitForTimeout(200);
    expect(await wireText(page)).toBe('');
  });

  test('DisableDrag leaves press-hold-drag as a pan', async ({ page }) => {
    await withConfig(page, { drag: false });
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }],
    });
    await page.waitForTimeout(600);
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: c.x, y: c.y + i * 12, id: 1 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    // Wheel and nothing else: xterm's own pan handler, which is what this
    // gesture did before the drag layer existed.
    const reports = sgrReports(await wireText(page));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((r) => r.button === 64 || r.button === 65)).toBe(true);
  });

  test('the inertia repair has no switch', async ({ page }) => {
    await withConfig(page, { tap: false, drag: false });
    await boot(page);
    await enableMouse(page);
    const c = await screenCentre(page);
    const cdp = await page.context().newCDPSession(page);

    await clearWire(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: c.x, y: c.y, xDistance: 0, yDistance: -260,
      speed: 6000, gestureSourceType: 'touch', preventFling: false,
    });
    await page.waitForTimeout(700);

    // Turning the touch layer off must not hand back the corruption. There is
    // no honest setting for "keep typing NaN into my shell".
    expect(await wireText(page)).not.toContain('NaN');
  });
});

test.describe('touch on the terminal (no touch screen)', () => {
  test('installs nothing on a desktop', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.sipTerm.touchMouse.enabled)).toBe(false);
  });
});

