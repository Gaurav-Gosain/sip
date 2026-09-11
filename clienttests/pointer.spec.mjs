// The kitty mouse pointer shapes protocol, OSC 22, read back out of a real
// browser.
//
// Every sequence here leaves a real program: the suite types a `printf` into
// the shell sip is serving, so the bytes travel the PTY, the wire and xterm's
// parser exactly as a program's would. Nothing calls the client's own parser.
//
// The pointer is proved with getComputedStyle on the terminal's screen
// element, because Playwright cannot screenshot a mouse cursor. That is the
// same thing the appearance suite does for Appearance.MouseCursor, and for the
// same reason.
//
// A query is proved twice. Once at the transport boundary, which is where this
// project's tests read what the client sent, and once end to end: `cat -v`
// reads the reply off the program's own stdin and prints it, so the assertion
// is on what the program received rather than on what the browser believed it
// sent.

import { test, expect } from '@playwright/test';
import { BASE_URL, APPEARANCE_URL } from './playwright.config.mjs';

const SCREEN = '.xterm-screen';

// sip's own default over the terminal, with nothing configured and nothing on
// the stack.
const DEFAULT_SHAPE = 'text';
// What examples/appearance sets in Go. Kept as a literal so a failure names
// the value rather than pointing at the Go file.
const CONFIGURED_SHAPE = 'crosshair';

async function boot(page, url) {
  // A computed style is a computed style in any engine, so the shape checks
  // run in one. The transport is the dimension that has caught this suite
  // blind before, and bootAnyEngine below is where that is covered.
  test.info().skip(test.info().project.name !== 'chromium', 'one engine is enough for a computed style');
  await bootAnyEngine(page, url);
}

async function bootAnyEngine(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
  // The shell has to be reading before a typed line means anything.
  await page.waitForTimeout(500);
}

/** The transport actually carrying the session, the way keyboard.spec.mjs asks. */
function liveTransport(page) {
  return page.evaluate(() => {
    const conn = window.sipTerm.connection;
    if (!conn) return 'unknown';
    if (conn.useWebTransport && conn.wtWriter) return 'webtransport';
    if (conn.ws) return 'websocket';
    return 'unknown';
  });
}

/**
 * Type one shell command line and press return.
 *
 * The leading Ctrl-U kills whatever is already in the line buffer, and that is
 * load bearing here. A query reply is written to the PTY as input, so it lands
 * in the shell's own line buffer and the next line typed arrives with the
 * reply glued to the front of it. The shell then runs a different command than
 * the test asked for. Measured: a push and a query sent on one line ran as
 * three commands, the push became `0<ESC>\\printf` and never happened, and the
 * query truthfully answered 0. A program that queries has to read its own
 * reply, and this suite is that program's stand-in.
 */
async function run(page, line) {
  await page.evaluate((l) => window.sipTerm.sendInput('\x15' + l + '\n'), line);
}

/**
 * The printf that makes a real OSC 22 leave the program.
 *
 * `\033]22;` then the payload then `\033\` — ESC ] 22 ; ... ESC \, which is
 * the sequence a program writes to its own stdout.
 */
function osc22(payload) {
  return `printf '\\033]22;${payload}\\033\\\\'`;
}

/** The cursor the browser actually computes for the terminal grid. */
function cursor(page) {
  return page.evaluate((s) => getComputedStyle(document.querySelector(s)).cursor, SCREEN);
}

/**
 * Wait for the cursor to settle, then assert it.
 *
 * The wait is not the test. It stops the assertion racing the shell, and the
 * assertion after it is what fails, with the shape it found in the message.
 */
async function expectCursor(page, want, why) {
  await page
    .waitForFunction(
      ([s, w]) => getComputedStyle(document.querySelector(s)).cursor === w,
      [SCREEN, want],
      { timeout: 10_000 },
    )
    .catch(() => {});
  const got = await cursor(page);
  expect(got, `${why}: the terminal shows the ${got} pointer, want ${want}`).toBe(want);
}

/** Everything on the screen, rows joined. */
function screenText(page) {
  return page.evaluate(() => {
    const b = window.sipTerm.term.buffer.active;
    let out = '';
    for (let i = 0; i < b.length; i++) out += b.getLine(i).translateToString(true) + '\n';
    return out;
  });
}

/**
 * Ask a query and read the answer off the program's own stdin.
 *
 * `stty -icanon -echo min 1` is what makes this readable: without -icanon the
 * reply sits in the line discipline's buffer, because it carries no newline
 * and the shell is waiting for one, and without -echo the line discipline
 * echoes it back through the terminal as well. `cat -v` then prints the reply
 * with its escapes spelled out, so the assertion is on characters the program
 * read rather than on bytes the browser thinks it wrote.
 */
async function askEndToEnd(page, payload) {
  await run(page, `stty -icanon -echo min 1; ${osc22('?' + payload)}; cat -v`);
  await page
    .waitForFunction(() => {
      const b = window.sipTerm.term.buffer.active;
      let out = '';
      for (let i = 0; i < b.length; i++) out += b.getLine(i).translateToString(true);
      return /\^\[\]22;[^\n]*\^\[\\/.test(out);
    }, null, { timeout: 15_000 })
    .catch(() => {});
  const text = await screenText(page);
  const m = text.match(/\^\[\]22;([^\n]*?)\^\[\\/);
  return { reply: m ? m[1] : null, text };
}

/** The OSC 22 replies the client put on the wire as terminal input. */
async function captureReplies(page, body) {
  await page.evaluate(() => {
    window.__sipOsc22 = [];
    const conn = window.sipTerm.connection;
    const real = conn.sendMessage.bind(conn);
    conn.sendMessage = (type, payload) => {
      // '0' is MsgInput, the frame a keystroke travels in. A reply has to go
      // out on that path or the program never reads it.
      if (type === 0x30 && payload) {
        const s = new TextDecoder().decode(payload);
        if (s.startsWith('\x1b]22;')) window.__sipOsc22.push(s);
      }
      return real(type, payload);
    };
  });
  await body();
  return page.evaluate(() => window.__sipOsc22);
}

// --- Setting, pushing and popping -----------------------------------------

test.describe('a program sets the pointer shape', () => {
  test('a set names the shape', async ({ page }) => {
    await boot(page, BASE_URL);
    await expectCursor(page, DEFAULT_SHAPE, 'before anything is set');

    await run(page, osc22('wait'));
    await expectCursor(page, 'wait', 'after a bare set');

    // `=` is the same operation spelled out.
    await run(page, osc22('=progress'));
    await expectCursor(page, 'progress', 'after an explicit = set');

    // An empty name is the specification's reset to the default.
    await run(page, osc22(''));
    await expectCursor(page, DEFAULT_SHAPE, 'after a set with no name');
  });

  test('a push makes the last name current and a pop puts the previous one back', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>wait'));
    await expectCursor(page, 'wait', 'after one push');

    // The last name in the list becomes current.
    await run(page, osc22('>help,move,zoom-in'));
    await expectCursor(page, 'zoom-in', 'after pushing a list');

    await run(page, osc22('<'));
    await expectCursor(page, 'move', 'after one pop');
    await run(page, osc22('<'));
    await expectCursor(page, 'help', 'after two pops');
    await run(page, osc22('<'));
    await expectCursor(page, 'wait', 'after three pops');
  });

  test('a pop past the bottom leaves the default and nothing else', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>grab'));
    await expectCursor(page, 'grab', 'after a push');

    for (let i = 0; i < 6; i++) await run(page, osc22('<'));
    await expectCursor(page, DEFAULT_SHAPE, 'after popping five times past the bottom');

    // And the stack is still usable afterwards.
    await run(page, osc22('>copy'));
    await expectCursor(page, 'copy', 'after pushing onto an over-popped stack');
  });

  test('the stack is sixteen deep and evicts the bottom', async ({ page }) => {
    await boot(page, BASE_URL);

    // Twenty distinct shapes. The stack holds sixteen, so the first four are
    // evicted from the bottom as the specification says.
    const twenty = [
      'alias', 'cell', 'copy', 'crosshair', 'e-resize',
      'ew-resize', 'grab', 'grabbing', 'help', 'move',
      'n-resize', 'ne-resize', 'nesw-resize', 'no-drop', 'not-allowed',
      'ns-resize', 'nw-resize', 'nwse-resize', 'pointer', 'progress',
    ];
    await run(page, osc22('>' + twenty.join(',')));
    await expectCursor(page, 'progress', 'after pushing twenty shapes');

    // Fifteen pops from a sixteen-deep stack leaves the fifth shape pushed,
    // which is the one at the bottom once the first four are gone.
    for (let i = 0; i < 15; i++) await run(page, osc22('<'));
    await expectCursor(page, 'e-resize', 'after fifteen pops of a capped stack');

    // The sixteenth empties it. Without the cap four more entries would be
    // waiting underneath.
    await run(page, osc22('<'));
    await expectCursor(page, DEFAULT_SHAPE, 'after the sixteenth pop');
  });
});

// --- What sip refuses ------------------------------------------------------

test.describe('sip validates every name from the PTY', () => {
  test('a url() cursor never reaches the DOM', async ({ page }) => {
    await boot(page, BASE_URL);

    // A set takes the whole payload as one name, so this is the shape of the
    // attack: `url(...), pointer` is a valid CSS cursor value, and a name
    // passed through because it looked plausible would point the browser at
    // that URL.
    await run(page, osc22('=url(https://example.invalid/x.png),pointer'));
    await page.waitForTimeout(600);

    const got = await cursor(page);
    expect(got, `a url() cursor from the PTY reached the DOM as ${got}`).not.toMatch(/url\(/);
    expect(got, `an unsupported name changed the pointer to ${got}`).toBe(DEFAULT_SHAPE);
  });

  test('an unsupported name in a set is a no-op', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('wait'));
    await expectCursor(page, 'wait', 'after a supported set');

    await run(page, osc22('no-such-shape'));
    await page.waitForTimeout(600);
    const got = await cursor(page);
    expect(got, `an unsupported set changed the pointer to ${got}`).toBe('wait');
  });

  test('an unsupported name in a push still takes a slot', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>wait'));
    await expectCursor(page, 'wait', 'after a supported push');

    // The name is not supported, so the pointer goes back to the default. The
    // slot is still there, which is what keeps the pop below balanced.
    await run(page, osc22('>no-such-shape'));
    await expectCursor(page, DEFAULT_SHAPE, 'after pushing an unsupported name');

    await run(page, osc22('<'));
    await expectCursor(page, 'wait', 'after popping the unsupported name off again');
  });

  test('an over-long sequence is dropped whole', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('crosshair'));
    await expectCursor(page, 'crosshair', 'after the set this test starts from');

    // Well past the 1024-byte cap, and every name in it is a real one, so
    // only the cap can stop it.
    const huge = new Array(120).fill('nesw-resize').join(',');
    await run(page, osc22('>' + huge));
    await page.waitForTimeout(800);

    const got = await cursor(page);
    expect(got, `a ${huge.length}-byte sequence was parsed and set ${got}`).toBe('crosshair');
  });
});

// --- Queries ---------------------------------------------------------------

test.describe('sip answers a query', () => {
  test('the reply reaches the program on its own stdin', async ({ page }) => {
    await boot(page, BASE_URL);

    const { reply, text } = await askEndToEnd(page, 'pointer,no-such-name,__grabbed__');
    expect(reply, `the program read no OSC 22 reply. The screen held:\n${text}`).not.toBeNull();
    expect(reply, 'a supported name, an unsupported name and __grabbed__, in order')
      .toBe('1,0,grabbing');
  });

  test('the reply leaves as terminal input', async ({ page }) => {
    await boot(page, BASE_URL);

    const sent = await captureReplies(page, async () => {
      await run(page, osc22('?crosshair,zoom-out,nope'));
      await page.waitForTimeout(800);
    });

    expect(sent.length, 'the client sent no OSC 22 reply frame at all').toBeGreaterThan(0);
    expect(sent[0], 'the reply is an OSC 22 carrying one answer per queried name')
      .toBe('\x1b]22;1,1,0\x1b\\');
  });

  test('__current__ reports the shape on the stack, and 0 when there is none', async ({ page }) => {
    await boot(page, BASE_URL);

    let sent = await captureReplies(page, async () => {
      await run(page, osc22('?__current__'));
      await page.waitForTimeout(800);
    });
    expect(sent[0], '__current__ on an empty stack reports 0').toBe('\x1b]22;0\x1b\\');

    sent = await captureReplies(page, async () => {
      await run(page, `${osc22('>zoom-in')}; ${osc22('?__current__')}`);
      await page.waitForTimeout(800);
    });
    expect(sent[0], '__current__ reports the shape that was pushed').toBe('\x1b]22;zoom-in\x1b\\');
  });

  test('__default__ reports sip s own default', async ({ page }) => {
    await boot(page, BASE_URL);

    const sent = await captureReplies(page, async () => {
      await run(page, osc22('?__default__'));
      await page.waitForTimeout(800);
    });
    expect(sent[0], `__default__ must report ${DEFAULT_SHAPE}, sip's cursor over a terminal`)
      .toBe(`\x1b]22;${DEFAULT_SHAPE}\x1b\\`);
  });

  test('__default__ reports the deployment s Appearance.MouseCursor', async ({ page }) => {
    await boot(page, APPEARANCE_URL);

    // The same question against a server that named a cursor in Go. A pop
    // back to an empty stack restores this, so this is the answer a program
    // needs to restore the pointer itself.
    const sent = await captureReplies(page, async () => {
      await run(page, osc22('?__default__'));
      await page.waitForTimeout(800);
    });
    expect(sent[0], `__default__ must report the configured ${CONFIGURED_SHAPE}`)
      .toBe(`\x1b]22;${CONFIGURED_SHAPE}\x1b\\`);

    // And the pixel agrees with the answer.
    await run(page, `${osc22('>wait')}; ${osc22('<')}`);
    await expectCursor(page, CONFIGURED_SHAPE, 'after popping back to an empty stack');
  });
});

// --- Terminal state --------------------------------------------------------

test.describe('the shape follows the terminal', () => {
  test('a reset empties both stacks', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>wait'));
    await expectCursor(page, 'wait', 'after a push on the main screen');

    // RIS.
    await run(page, `printf '\\033c'`);
    await expectCursor(page, DEFAULT_SHAPE, 'after RIS');

    // And the stack is empty, not merely hidden: a pop finds nothing to
    // restore.
    await run(page, osc22('<'));
    await page.waitForTimeout(500);
    const got = await cursor(page);
    expect(got, `a pop after a reset brought back ${got}`).toBe(DEFAULT_SHAPE);
  });

  test('the main and the alternate screen keep separate stacks', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>wait'));
    await expectCursor(page, 'wait', 'on the main screen');

    // Into the alternate screen, which starts with a stack of its own.
    await run(page, `printf '\\033[?1049h'`);
    await expectCursor(page, DEFAULT_SHAPE, 'on entering the alternate screen');

    await run(page, osc22('>zoom-out'));
    await expectCursor(page, 'zoom-out', 'after a push on the alternate screen');

    // Back out. The main screen's shape is exactly where it was left, and the
    // alternate screen's push did not touch it.
    await run(page, `printf '\\033[?1049l'`);
    await expectCursor(page, 'wait', 'on returning to the main screen');
  });

  test('a reconnect does not inherit the shape', async ({ page }) => {
    await boot(page, BASE_URL);

    await run(page, osc22('>wait'));
    await expectCursor(page, 'wait', 'before the connection drops');

    // Drop the socket. The client reconnects on its own, to a new session
    // with a new PTY, and the program that pushed that shape is gone.
    await page.evaluate(() => window.sipTerm.connection.ws.close());
    await page.waitForFunction(() => window.sipTerm.connected === false, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.sipTerm.connected === true, null, { timeout: 30_000 });

    await expectCursor(page, DEFAULT_SHAPE, 'after reconnecting to a new session');
  });
});

// --- Precedence ------------------------------------------------------------

test('a hyperlink keeps sip s own pointer over a program s shape', async ({ page }) => {
  await boot(page, BASE_URL);

  await run(page, `${osc22('wait')}; printf '\\033[2J\\033[H'; printf 'https://example.com/\\r\\n'`);
  await expectCursor(page, 'wait', 'with a shape set and the pointer off the link');

  // Over the URL on row 0. xterm's web-links addon marks the screen element
  // while the pointer is over a link it found, and sip's stylesheet gives that
  // mark the last word: a link that can be clicked has to say so.
  const over = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const cell = window.sipTerm.term._core._renderService.dimensions.css.cell;
    return { x: r.left + cell.width * 5, y: r.top + cell.height * 0.5 };
  }, SCREEN);

  await page.mouse.move(over.x, over.y);
  await page.mouse.move(over.x + 1, over.y);
  await expectCursor(page, 'pointer', 'with the pointer over a hyperlink');

  // Off the link again and the program's shape is back.
  await page.mouse.move(over.x, over.y + 200);
  await expectCursor(page, 'wait', 'with the pointer off the link again');
});

// --- Transport -------------------------------------------------------------

// A reply leaves through sendInput, the call a keystroke makes, so it is
// framed and written by whichever transport is live. This project has twice
// shipped a path that worked over one transport and not the other, so the
// reply is proved over both: Chromium reaches WebSocket against a loopback
// server and Firefox reaches WebTransport. Each run declares the transport it
// wants and fails rather than accept a fallback, because a silent fallback
// makes a green run say nothing about either.

test('the reply reaches the program over the transport that is live', async ({ page }, testInfo) => {
  await bootAnyEngine(page, BASE_URL);

  const want = testInfo.project.name === 'firefox' ? 'webtransport' : 'websocket';
  const got = await liveTransport(page);
  expect(got, `this test wants ${want} and the session is on ${got}`).toBe(want);

  const { reply, text } = await askEndToEnd(page, 'wait,__current__');
  expect(reply, `over ${got} the program read no OSC 22 reply. The screen held:\n${text}`)
    .toBe('1,0');
});
