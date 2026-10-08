// The server caps the terminal size (MaxWindowDims, MaxWindowCells) and
// clamps a resize that is over the cap. The client must draw the grid the PTY
// has, not the grid its window would fit. Otherwise a program that writes to
// its bottom row lands in the middle of the screen, over stale lines.
//
// The default cap is 250000 cells. A 3840x2160 window at font size 6 fits
// about 960x270, which is over it, so the server gives the PTY fewer rows.

import { test, expect } from '@playwright/test';

const MAX_CELLS = 250000;

test.use({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });

// Chromium reaches the server over WebSocket. Firefox is the only engine
// here that negotiates WebTransport, whose clamp notice goes through a
// different writer, so it runs this file pinned to that transport.
async function boot(page, testInfo) {
  const transport = testInfo.project.name === 'firefox' ? 'webtransport' : 'websocket';
  await page.addInitScript((t) => {
    localStorage.setItem('sip-web-settings', JSON.stringify({ fontSize: 6, renderer: 'canvas', transport: t }));
  }, transport);
  await page.goto('/');
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  const live = await page.evaluate(() => {
    const c = window.sipTerm.connection;
    if (c?.useWebTransport && c.wtWriter) return 'webtransport';
    return c?.ws ? 'websocket' : 'unknown';
  });
  expect(live, `asked for ${transport} but the live transport is ${live}`).toBe(transport);
}

/** The grid the window would fit, before any cap. */
function proposed(page) {
  return page.evaluate(() => window.sipTerm.webterm.proposeGeometry());
}

function grid(page) {
  return page.evaluate(() => ({ cols: window.sipTerm.term.cols, rows: window.sipTerm.term.rows }));
}

/**
 * Runs the repro: fill the screen, move to the PTY's last row and write a
 * marker there. Returns the viewport row the marker is on and the size the
 * shell reported.
 */
async function bottomRow(page, tag) {
  const marker = `BOTTOM_${tag}`;
  await page.evaluate((m) => window.sipTerm.sendInput(
    `seq 400; tput cup $(($(tput lines)-1)) 0; printf "${m.slice(0, 3)}""${m.slice(3)} %s" "$(stty size)"\n`), marker);
  const re = new RegExp(`${marker} (\\d+) (\\d+)`);
  await page.waitForFunction((src) => {
    const b = window.sipTerm.term.buffer.active;
    const r = new RegExp(src);
    for (let i = 0; i < b.length; i++) if (r.test(b.getLine(i).translateToString(true))) return true;
    return false;
  }, re.source, { timeout: 15_000 });
  return page.evaluate((src) => {
    const t = window.sipTerm.term;
    const b = t.buffer.active;
    const r = new RegExp(src);
    for (let y = 0; y < t.rows; y++) {
      const m = r.exec(b.getLine(b.viewportY + y).translateToString(true));
      if (m) return { row: y, ptyRows: Number(m[1]), ptyCols: Number(m[2]) };
    }
    return { row: -1 };
  }, re.source);
}

test('a clamped session draws the bottom row on the last row of the grid', async ({ page }, testInfo) => {
  await boot(page, testInfo);
  const fit = await proposed(page);
  expect(fit.cols * fit.rows, `the window fits ${fit.cols}x${fit.rows}, under the cap, so nothing is clamped`)
    .toBeGreaterThan(MAX_CELLS);

  // A client that ignores the cap never gets here, so the wait is allowed to
  // run out. The checks below then say where the bottom row landed.
  await page.waitForFunction((max) => window.sipTerm.term.cols * window.sipTerm.term.rows <= max, MAX_CELLS,
    { timeout: 15_000 }).catch(() => {});
  const g = await grid(page);

  const got = await bottomRow(page, 'CAP');
  expect(got.row, `the bottom-row marker is on grid row ${got.row} of ${g.rows}`).toBe(g.rows - 1);
  expect(got.ptyRows, 'the PTY and the grid disagree on rows').toBe(g.rows);
  expect(got.ptyCols, 'the PTY and the grid disagree on columns').toBe(g.cols);
  expect(g.cols * g.rows, 'the grid is over the cell cap').toBeLessThanOrEqual(MAX_CELLS);
  expect(g.cols, 'the clamp keeps the columns').toBe(fit.cols);
});

test("the server's clamp notice is the authority", async ({ page }, testInfo) => {
  await boot(page, testInfo);
  const fit = await proposed(page);

  // Forget the caps and force the grid over them, as a client with no caps
  // would ask. Only the server's MsgResize can bring the grid back.
  await page.evaluate(({ c, r }) => {
    window.sipTerm.sizeCaps = null;
    window.sipTerm.serverClamp = null;
    window.sipTerm.term.resize(c, r);
  }, { c: fit.cols, r: fit.rows });

  await page.waitForFunction((max) => window.sipTerm.term.cols * window.sipTerm.term.rows <= max, MAX_CELLS,
    { timeout: 15_000 }).catch(() => {});
  const g = await grid(page);
  const got = await bottomRow(page, 'ECHO');
  expect(got.ptyRows, 'the PTY and the grid disagree on rows').toBe(g.rows);
  expect(got.row, `the bottom-row marker is on grid row ${got.row} of ${g.rows}`).toBe(g.rows - 1);
});
