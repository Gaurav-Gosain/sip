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
});
