// Byte-level checks on the control chords, against a running sip server.
//
// The report that prompted these was "ctrl+C ctrl+D nothing working". Reading
// the key path could not settle it, because the encoder's output depends on
// runtime state (the kitty keyboard flags the VT negotiates) that only exists
// in a real page. So these assert the actual bytes on the wire.
//
// TRANSPORT IS AN EXPLICIT DIMENSION HERE, and it is not optional. This suite
// has twice been caught blind to a configuration it silently was not testing:
// first Chromium-only, then WebSocket-only. The second time, a 27/27 green
// chord matrix was cited as proof a WebTransport bug could not exist, when in
// fact every one of those 27 cases had run over WebSocket.
//
// Two rules follow, and both matter more than the assertions themselves:
//
//  1. Capture happens at the TRANSPORT BOUNDARY -- the WebSocket's send() or
//     the WebTransport stream writer's write() -- never at the shared adapter
//     above them. A hook above the transport records identical bytes whichever
//     transport is live, so it cannot tell the two apart and a green run says
//     nothing about either. Capturing at the boundary also proves the framing.
//
//  2. Every test declares the transport it wants and FAILS if it did not get
//     it. Silently accepting a fallback is what made the last green run
//     meaningless.
//
// Each chord runs in a fresh page. Ctrl+C, Ctrl+D, Ctrl+Z and Ctrl+\ kill,
// suspend or EOF the shell, so sharing a session between them lets one chord
// silently poison every chord after it -- which is what happened the first
// time this was measured, and it looked exactly like a widespread regression.

import { test, expect } from '@playwright/test';

// What each engine can actually reach against a loopback server, measured
// rather than assumed. Chromium refuses WebTransport to a loopback origin with
// a self-signed cert hash and falls back; Firefox negotiates it, which makes
// Firefox the ONLY coverage of the WebTransport input path.
//
// This table is asserted, not merely consulted: an engine that gains (or
// loses) a transport fails the run instead of quietly changing what is
// covered.
const TRANSPORT_SUPPORT = {
  chromium: { websocket: true, webtransport: false },
  firefox: { websocket: true, webtransport: true },
};

const TRANSPORTS = ['websocket', 'webtransport'];

function supports(projectName, transport) {
  return TRANSPORT_SUPPORT[projectName]?.[transport] ?? false;
}

/** Pin the transport through the same stored setting the settings panel writes. */
function pinTransport(page, transport) {
  return page.addInitScript((t) => {
    localStorage.setItem('sip-web-settings', JSON.stringify({
      transport: t, fontSize: 14, copyOnSelect: false, renderer: 'canvas',
    }));
  }, transport);
}

/**
 * Record the input payload at the transport boundary.
 *
 * Deliberately NOT hooked on the shared adapter: that sits above the transport
 * and reports the same bytes either way, which is exactly the blind spot this
 * suite is meant to close. Hooking the socket and the stream writer means a
 * transport that drops, mangles or never flushes a frame shows up as missing
 * bytes here, and it verifies the on-the-wire framing too:
 *
 *   WebSocket    [type][payload]
 *   WebTransport [4-byte big-endian length][type][payload]
 *
 * Both are normalised back to the raw MsgInput payload.
 */
async function captureWire(page) {
  await page.evaluate(() => {
    window.__sentInput = [];
    const MSG_INPUT = 0x30;

    // Unwrap the auto adapter to reach the live transport adapter.
    const outer = window.sipTerm.adapter;
    const live = outer.adapter ?? outer;
    if (live.__sipWireHooked) return;
    live.__sipWireHooked = true;

    const record = (payload) => {
      try {
        window.__sentInput.push(Array.from(payload));
      } catch {
        // Never let instrumentation break the client.
      }
    };

    if (live.ws) {
      const send = live.ws.send.bind(live.ws);
      live.ws.send = (frame) => {
        const b = new Uint8Array(frame);
        if (b[0] === MSG_INPUT) record(b.subarray(1));
        return send(frame);
      };
      window.__sipWireKind = 'websocket';
      return;
    }

    if (live.writer) {
      const w = live.writer;
      const write = w.write.bind(w);
      w.write = (frame) => {
        const b = new Uint8Array(frame);
        // [len:4][type][payload]
        if (b.length >= 5 && b[4] === MSG_INPUT) record(b.subarray(5));
        return write(frame);
      };
      window.__sipWireKind = 'webtransport';
      return;
    }

    throw new Error('no transport to hook: neither a socket nor a stream writer');
  });
}

/** The transport that is actually carrying bytes right now. */
function liveTransport(page) {
  return page.evaluate(() => {
    const outer = window.sipTerm.adapter;
    if (outer.activeTransport) return outer.activeTransport;
    // A directly-constructed adapter reports itself by shape.
    if (outer.ws) return 'websocket';
    if (outer.writer) return 'webtransport';
    return 'unknown';
  });
}

/** Boot a page pinned to one transport, and refuse to continue on any other. */
async function boot(page, transport, url = '/') {
  await pinTransport(page, transport);

  await page.goto(url);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#connection-status');
      // Firefox reaches WebTransport where Chromium falls back to WebSocket,
      // and the status class differs between them.
      return el && (el.classList.contains('connected') || el.classList.contains('webtransport'));
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => window.sipTerm?.adapter, null, { timeout: 30_000 });

  // Fail loudly on a transport we did not ask for. A fallback here silently
  // converts a WebTransport test into a second WebSocket test.
  const live = await liveTransport(page);
  expect(
    live,
    `asked for ${transport} but the live transport is ${live}; this test proves nothing about ${transport}`,
  ).toBe(transport);

  await captureWire(page);
  await page.locator('#terminal').click();
  await page.waitForTimeout(200);
}

/** Press one chord in a clean session and return the bytes it put on the wire. */
async function bytesFor(page, transport, chord, url = '/') {
  await boot(page, transport, url);
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

for (const transport of TRANSPORTS) {
  test.describe(`over ${transport}`, () => {
    // Assert the capability table rather than trusting it. On an engine that
    // cannot reach this transport, prove the fallback is exactly what we
    // believe it is; if that ever changes, this fails and the matrix above
    // gets updated deliberately instead of drifting.
    test.beforeEach(async ({ page }, testInfo) => {
      if (supports(testInfo.project.name, transport)) return;
      await pinTransport(page, transport);
      await page.goto('/');
      await page.waitForFunction(() => window.sipTerm?.adapter, null, { timeout: 30_000 });
      const live = await liveTransport(page);
      expect(
        live,
        `${testInfo.project.name} is recorded as unable to reach ${transport}, but it now reports `
        + `${live}. Update TRANSPORT_SUPPORT and let the chords run there.`,
      ).not.toBe(transport);
      testInfo.skip(true, `${testInfo.project.name} cannot reach ${transport} (verified fallback to ${live})`);
    });

    test.describe('control chords put the right byte on the wire', () => {
      for (const [letter, code] of CTRL_LETTERS) {
        test(`Ctrl+${letter.toUpperCase()} sends 0x${code.toString(16).padStart(2, '0')}`, async ({ page }) => {
          expect(await bytesFor(page, transport, `Control+${letter}`)).toEqual([code]);
        });
      }

      test('Tab and Enter send their own bytes, not a control chord', async ({ page }) => {
        expect(await bytesFor(page, transport, 'Tab')).toEqual([0x09]);
        expect(await bytesFor(page, transport, 'Enter')).toEqual([0x0d]);
      });
    });

    test('Ctrl+C and Ctrl+D are unaffected by the webgl renderer', async ({ page }) => {
      // The renderer owns the text grid but must not sit anywhere near the key
      // path. This is the check that the seam did not swallow input.
      expect(await bytesFor(page, transport, 'Control+c', '/?renderer=webgl')).toEqual([0x03]);
      expect(await bytesFor(page, transport, 'Control+d', '/?renderer=webgl')).toEqual([0x04]);
    });

    // The tests above stop at the transport boundary. These two carry all the
    // way to the PTY and back, so they are the only ones that prove the bytes
    // were actually delivered rather than merely handed to a transport that
    // could still drop them on the floor.
    const countPrompts = (page) => page.evaluate(() => {
      const t = window.sipTerm.term ?? window.sipTerm.terminal;
      const d = t.wasmTerm.getDimensions();
      let text = '';
      for (let r = 0; r < d.rows; r++) {
        for (const c of t.wasmTerm.getLine(r) ?? []) text += String.fromCodePoint(c.codepoint || 32);
        text += '\n';
      }
      return (text.match(/READY\$/g) ?? []).length;
    });

    test('Ctrl+C interrupts a foreground process', async ({ page }) => {
      await boot(page, transport);
      await page.keyboard.type('PS1="READY$ "\n');
      await page.waitForTimeout(500);

      await page.keyboard.type('sleep 100');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      const before = await countPrompts(page);

      await page.keyboard.press('Control+c');
      await page.waitForTimeout(1000);

      // A new prompt means the shell got SIGINT and reaped the sleep.
      expect(await countPrompts(page)).toBeGreaterThan(before);
    });

    test('Ctrl+D sends EOF to a foreground process', async ({ page }) => {
      await boot(page, transport);
      await page.keyboard.type('PS1="READY$ "\n');
      await page.waitForTimeout(500);

      await page.keyboard.type('cat > /dev/null');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      const before = await countPrompts(page);

      await page.keyboard.press('Control+d');
      await page.waitForTimeout(1000);

      expect(await countPrompts(page)).toBeGreaterThan(before);
    });
  });
}
