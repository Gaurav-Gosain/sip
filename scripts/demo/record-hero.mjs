#!/usr/bin/env node
// Records the README hero: a real sip server, a real browser, a real session.
//
// sip's subject is a terminal running in a browser tab, so a terminal-side
// screen recorder is the wrong instrument. It would film the pseudo-terminal
// and miss the only claim worth making, which is that the thing on the far side
// of the socket draws, scrolls, selects and copies like a terminal. So this
// drives an actual chromium at an actual sip server and films the page.
//
// Nothing on screen is authored here. Every glyph is the wrapped shell's own
// output arriving over the wire, the image is a real kitty graphics placement
// decoded by the client's overlay, and the selection is a real drag with a real
// mouse followed by a real copy. This script only decides what to type and when
// to look.
//
// Chromium is driven over the DevTools protocol directly, on Node's built-in
// WebSocket. A browser automation library would do the same work, but it would
// put a node_modules tree between a fresh clone and a regenerable asset, and
// this repository's other generated images already refuse that trade.
//
// Requires: go, chromium, ffmpeg, kitty's `kitten`, and eza. No network.
//
//   node scripts/demo/record-hero.mjs                 # writes docs/images/hero.gif
//   node scripts/demo/record-hero.mjs --keep-frames   # leaves the frames behind

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'docs/images/hero.gif');

// The page is filmed at this size and the GIF is not resized afterwards, so
// this is also the README's asset width. Wide enough for an 96-column terminal
// to be read at half scale, short enough that the GIF budget is spent on the
// session rather than on empty rows.
const VIEW = { width: 1000, height: 580 };
const PORT = process.env.SIP_HERO_PORT ?? '7734';
const CHROMIUM = process.env.SIP_CHROMIUM ?? '/usr/bin/chromium';
const FPS = 10;
// How long the finished screen is held before the GIF loops.
const TAIL_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- devtools protocol ------------------------------------------------------
// A minimal client: one websocket to the page target, promise per command id,
// and a listener table for the events this script waits on.
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }

  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('devtools socket failed')), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  /** Evaluate in the page and return the value, throwing on a page-side throw. */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  /** Poll a page-side predicate. Every wait in this script goes through here. */
  async until(expr, what, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.eval(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(60);
    }
  }
}

// --- the session ------------------------------------------------------------
// Everything the recording types, and what it waits for before moving on. The
// waits are on text that has actually come back through the pseudo-terminal, so
// the pacing follows the real session rather than a guess about how long a
// command takes. The holds are camera direction: time for a reader to take in
// a result before the next command replaces it.
const term = {
  /** Type a line and wait for a marker to arrive on screen. */
  async run(cdp, line, marker, hold = 900) {
    await cdp.eval(`window.sipTerm.sendInput(${JSON.stringify(line + '\r')})`);
    if (marker) await cdp.until(screenHas(marker), JSON.stringify(marker));
    await sleep(hold);
  },
  /** Send raw bytes, for keys inside a full-screen program. */
  async keys(cdp, bytes, hold = 400) {
    await cdp.eval(`window.sipTerm.sendInput(${JSON.stringify(bytes)})`);
    await sleep(hold);
  },
};

/** A page-side expression that is true once `s` is anywhere in the buffer. */
function screenHas(s) {
  return `(() => {
    const b = window.sipTerm.term.buffer.active;
    for (let i = 0; i < b.length; i++) {
      if (b.getLine(i).translateToString(true).includes(${JSON.stringify(s)})) return true;
    }
    return false;
  })()`;
}

/** Press a chord as a real key event, the way a user's keyboard delivers it. */
async function chord(cdp, { key, code, keyCode, modifiers }) {
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }
}

/** Drag the mouse across the screen, in steps, so the selection grows visibly. */
async function dragSelect(cdp, from, to, steps = 14) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
    });
    await sleep(45);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1, buttons: 0 });
}

// --- sandbox ----------------------------------------------------------------
// A throwaway HOME with a fixed prompt, so the recording shows the same shell
// wherever it is run and never films the operator's dotfiles or directories.
function writeSandbox(dir) {
  writeFileSync(join(dir, 'bashrc'), [
    'unset PROMPT_COMMAND',
    // Amber is the banner's accent, so the prompt belongs to this project's
    // images rather than to whoever pressed record.
    "PS1='\\[\\e[38;2;224;168;106m\\]sip\\[\\e[0m\\] \\[\\e[38;2;154;163;178m\\]~/sip\\[\\e[0m\\] $ '",
    'unset HISTFILE',
    'export LANG=en_US.UTF-8',
    'clear',
  ].join('\n') + '\n');
}

// --- main -------------------------------------------------------------------
async function main() {
  const keepFrames = process.argv.includes('--keep-frames');
  const sandbox = mkdtempSync(join(tmpdir(), 'sip-hero-'));
  const frames = join(sandbox, 'frames');
  mkdirSync(frames);
  writeSandbox(sandbox);

  const bin = join(sandbox, 'sip');
  process.stdout.write('building sip\n');
  execFileSync('go', ['build', '-o', bin, './cmd/sip'], { cwd: ROOT, stdio: 'inherit' });

  // The server runs in the repository, so the paths on screen are this
  // repository's paths and the image the session displays is a file that is
  // actually committed here.
  const server = spawn(bin, ['-p', PORT, '--', 'bash', '--rcfile', join(sandbox, 'bashrc'), '-i'], {
    cwd: ROOT,
    env: { ...process.env, HOME: sandbox, TERM: 'xterm-256color', COLUMNS: '', LINES: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', () => {});

  const browser = spawn(CHROMIUM, [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${join(sandbox, 'profile')}`,
    '--no-first-run', '--no-sandbox', '--disable-extensions',
    // The same software GL the browser tests pin. The webgl renderer is the one
    // sip picks by default, and filming the canvas fallback instead would be a
    // recording of a code path most readers never take.
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1', '--hide-scrollbars',
    `--window-size=${VIEW.width},${VIEW.height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', () => {});

  let cdp;
  try {
    // Wait for both listeners rather than sleeping at them.
    const target = await waitForTarget();
    cdp = await CDP.attach(target);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
    });

    // The clipboard round trip at the end is a real one: the copy goes through
    // navigator.clipboard and the paste reads it back. Headless chromium keeps
    // its own clipboard, but it still gates both on permission.
    await cdp.send('Browser.grantPermissions', {
      origin: `http://localhost:${PORT}`,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await cdp.until('window.sipTerm && window.sipTerm.connected', 'the client to connect', 60000);
    await cdp.until('window.sipTerm.term.buffer.active.length > 0', 'the terminal to open');
    await sleep(1200);

    // --- capture ----------------------------------------------------------
    // Screencast frames arrive only when the page repaints, each with the
    // wall-clock time it was produced. They are resampled to a constant frame
    // rate below, which is what keeps the pauses in the session the length they
    // actually were.
    const shots = [];
    const t0 = Date.now();
    cdp.on('Page.screencastFrame', async (p) => {
      shots.push({ t: Date.now() - t0, data: p.data });
      try { await cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }); } catch { /* shutting down */ }
    });
    await cdp.send('Page.startScreencast', {
      format: 'png', everyNthFrame: 1,
      maxWidth: VIEW.width, maxHeight: VIEW.height,
    });

    await runSession(cdp);

    // The screencast emits on compositor commits, and the commit carrying the
    // last change of a session that then goes idle is routinely never pushed:
    // the recording ends one repaint short, on a prompt that the page has in
    // fact already filled in. This cost two rebuilds before the frames were
    // checked against a direct screenshot rather than against the buffer.
    //
    // So the closing frame is taken explicitly. It is the same page and the
    // same pixels, captured through a call that cannot be coalesced away, and
    // writeFrames holds it for the tail so the loop rests on a finished screen.
    await sleep(500);
    const closing = await cdp.send('Page.captureScreenshot', { format: 'png' });
    shots.push({ t: Date.now() - t0, data: closing.data });

    await cdp.send('Page.stopScreencast');

    // Taken after the screencast stops, so opening the panel cannot appear in
    // the recording. It is the client's own settings, which is the part of sip
    // that only exists because the terminal is a web page.
    await cdp.eval("document.getElementById('settings-toggle').click()");
    await sleep(600);
    await still(cdp, 'settings.png');
    process.stdout.write(`captured ${shots.length} frames over ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    writeFrames(shots, frames, TAIL_MS);
    encode(frames, OUT);
  } finally {
    try { await cdp?.send('Browser.close'); } catch { /* already gone */ }
    browser.kill('SIGKILL');
    server.kill('SIGKILL');
    if (!keepFrames) rmSync(sandbox, { recursive: true, force: true });
    else process.stdout.write(`frames left in ${frames}\n`);
  }

  const bytes = execFileSync('stat', ['-c', '%s', OUT]).toString().trim();
  const dims = execFileSync('magick', ['identify', '-format', '%wx%h', `${OUT}[0]`]).toString().trim();
  process.stdout.write(`${OUT}  ${dims}  ${(bytes / 1024).toFixed(0)} KB\n`);
}

/** Poll the DevTools endpoint until chromium publishes a page target. */
async function waitForTarget() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('chromium never published a page target');
    await sleep(150);
  }
}

// --- what the recording does ------------------------------------------------
const ICAT = 'kitten icat --align left docs/images/banner.png';

async function runSession(cdp) {
  // A directory listing first: ordinary output, colour, and the Nerd Font
  // glyphs the client ships, which is the cheapest proof that the far side is a
  // terminal and not a text box. Scoped to this repository's own files, because
  // a recording that films whatever happens to be on the operator's machine is
  // a recording that cannot be committed.
  await term.run(cdp, 'eza -l --icons=always --no-user --no-permissions --git *.go', 'server.go', 1500);

  // A full-screen program on the alternate screen. glow is itself a Bubble Tea
  // program, which is the case sip exists for, and it is reading this
  // repository's README rather than anything about the machine it runs on. The
  // wheel events are dispatched at the page, so what scrolls the pager is a
  // real mouse crossing the wire as SGR mouse reports.
  await term.run(cdp, 'glow -p README.md', 'sip', 1500);
  const mid = await centre(cdp);
  for (let i = 0; i < 5; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid.x, y: mid.y, deltaX: 0, deltaY: 120 });
    await sleep(320);
  }
  await sleep(900);
  await still(cdp, 'tui.png');
  await term.keys(cdp, 'q', 1400);

  // A real kitty graphics placement, and the last thing left on screen: a GIF
  // loops, so the frame it rests on is the one most readers see. kitten icat
  // probes the terminal for support and the reply comes from the client's own
  // overlay; the payload is this repository's banner, transmitted as PNG over
  // the same socket as the text and decoded in the browser.
  //
  // It runs after the pager and not before it. A placement is anchored to the
  // buffer row that introduced it, and taking the alternate screen and giving
  // it back leaves the row without its canvas, so an image placed first spends
  // the rest of the recording as a hole in the scrollback.
  await term.run(cdp, ICAT, null, 2800);
  await still(cdp, 'kitty.png');

  // Selection and copy, then the paste that proves it. The chord is Ctrl+C on a
  // selection, which is the path the client actually binds; Ctrl+Shift+C is
  // reserved by both browsers and never reaches the page. Copying is invisible
  // on its own, so the recording pastes the text straight back at the prompt:
  // the command that reappears there came out of the system clipboard.
  const at = await locate(cdp, 'kitten icat');
  if (!at) throw new Error('the icat command line was not found on screen');
  await sleep(600);
  await dragSelect(cdp, await cell(cdp, at.from, at.row), await cell(cdp, at.to, at.row));
  await sleep(1100);
  await chord(cdp, { key: 'c', code: 'KeyC', keyCode: 67, modifiers: 2 });

  // Assert the system clipboard, not the selection. The chord can be swallowed
  // anywhere between the key handler and the async clipboard API, and every one
  // of those failures still leaves the text highlighted on screen, which is the
  // one thing a reader would take as proof that it worked.
  const clip = await cdp.eval('navigator.clipboard.readText()');
  if (clip.trim() !== ICAT) throw new Error(`the copy did not reach the clipboard (got ${JSON.stringify(clip)})`);
  // Taken here rather than after the paste: pasting clears the selection, so a
  // single still cannot carry both the highlight and the result.
  await still(cdp, 'selection.png');
  await sleep(1200);

  // Paste it back at the prompt. The text is read out of the system clipboard
  // and handed to xterm's own paste entry point, which is the call its paste
  // event handler makes: it goes out bracketed, over the same socket, exactly
  // as a keyboard paste does. The trigger is programmatic in the same way every
  // other line this recording types is, and for the same reason the browser
  // tests here drive sendInput rather than synthesize keys.
  //
  // Ctrl+V is not dispatched instead, because a headless browser will not run
  // the paste editing command and the recording would end on an empty prompt
  // with nothing to say it had failed.
  //
  // The pasted text is identical to the text it was copied from, so the wait
  // counts occurrences rather than looking for a string: the screen already
  // contains one, and a predicate that only asks whether it is there passes
  // before the paste has done anything at all.
  const before = await countOf(cdp, ICAT);
  await cdp.eval('(async () => window.sipTerm.term.paste(await navigator.clipboard.readText()))()');
  await cdp.until(`${countExpr(ICAT)} > ${before}`, 'the pasted command to reach the shell', 15000);

  // Drag-selecting near the top of the screen leaves the viewport scrolled up,
  // and a paste that the shell echoes below the visible rows is a paste that
  // did not happen as far as the recording is concerned. The buffer having the
  // text proves nothing about the frame. This scrolls back to the prompt and
  // then checks the rendered viewport, which is the only claim the GIF makes.
  await cdp.eval('window.sipTerm.term.scrollToBottom()');
  await cdp.until(onScreenAtPrompt(ICAT), 'the pasted command to be visible at the prompt', 10000);
  await sleep(400);
  await still(cdp, 'clipboard.png');
  await sleep(600);
}

/**
 * Write a still of the page as it stands. The README's table of images is
 * filled from the same session the hero is filmed from, so a still can never
 * show a state the recording never reached.
 */
async function still(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const path = join(ROOT, 'docs/images', name);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  process.stdout.write(`  ${path}\n`);
}

/**
 * Page-side predicate: the viewport is scrolled to the prompt and the cursor's
 * own row, as rendered, carries `s`.
 */
function onScreenAtPrompt(s) {
  return `(() => {
    const t = window.sipTerm.term, b = t.buffer.active;
    if (b.viewportY !== b.baseY) return false;
    const line = b.getLine(b.baseY + b.cursorY);
    return !!line && line.translateToString(true).includes(${JSON.stringify(s)});
  })()`;
}

/** Page-side expression counting the buffer lines that contain `s`. */
function countExpr(s) {
  return `(() => {
    const b = window.sipTerm.term.buffer.active;
    let n = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.getLine(i).translateToString(true).includes(${JSON.stringify(s)})) n++;
    }
    return n;
  })()`;
}

const countOf = (cdp, s) => cdp.eval(countExpr(s));

/**
 * Where `marker` last appears on screen, as the viewport row and the columns
 * the text spans. Selecting from column zero instead would drag the prompt in
 * with the command, and a paste of the prompt back into the shell is not what
 * anyone does with a copied command line.
 */
function locate(cdp, marker) {
  return cdp.eval(`(() => {
    const t = window.sipTerm.term, b = t.buffer.active;
    for (let r = t.rows - 1; r >= 0; r--) {
      const line = b.getLine(b.viewportY + r);
      if (!line) continue;
      const s = line.translateToString(true);
      const i = s.indexOf(${JSON.stringify(marker)});
      if (i >= 0) return { row: r, from: i, to: s.replace(/\\s+$/, '').length };
    }
    return null;
  })()`);
}

/** Page coordinates of a terminal cell, measured off the screen element. */
async function cell(cdp, col, row) {
  const b = await cdp.eval(`(() => {
    const s = document.querySelector('.xterm-screen').getBoundingClientRect();
    const t = window.sipTerm.term;
    return { x: s.left, y: s.top, cw: s.width / t.cols, ch: s.height / t.rows };
  })()`);
  return { x: Math.round(b.x + col * b.cw), y: Math.round(b.y + row * b.ch + b.ch / 2) };
}

async function centre(cdp) {
  return cdp.eval(`(() => {
    const s = document.querySelector('.xterm-screen').getBoundingClientRect();
    return { x: Math.round(s.left + s.width / 2), y: Math.round(s.top + s.height / 2) };
  })()`);
}

// --- frames and encoding ----------------------------------------------------
/**
 * Resample the repaint-driven capture onto a constant frame rate by holding the
 * most recent frame across each interval. Encoding the raw capture instead
 * would silently cut every pause out of the session, because a still page
 * produces no frames at all.
 */
function writeFrames(shots, dir, tailMs = 0) {
  if (!shots.length) throw new Error('the screencast produced no frames');
  const end = shots[shots.length - 1].t + tailMs;
  const step = 1000 / FPS;
  let i = 0, n = 0;
  for (let t = 0; t <= end; t += step) {
    while (i + 1 < shots.length && shots[i + 1].t <= t) i++;
    writeFileSync(join(dir, `f${String(++n).padStart(5, '0')}.png`), Buffer.from(shots[i].data, 'base64'));
  }
  process.stdout.write(`resampled to ${n} frames at ${FPS} fps\n`);
}

/**
 * One palette for the whole recording, generated from every frame, then applied
 * without dithering. The page is flat colour over a flat background, so a
 * global palette costs nothing in fidelity and dithering would spray noise into
 * exactly the regions that compress best.
 *
 * stats_mode is full rather than diff. diff weights the pixels that change
 * between frames, and the kitty placement is the one region that never changes
 * once it is drawn, so it is scored as background and loses its accent to a
 * grey: the banner comes out of the encoder desaturated while the text around
 * it is exact. It is also the frame the recording rests on.
 */
function encode(dir, out) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'),
    '-filter_complex',
    `split[a][b];[a]palettegen=max_colors=${process.env.SIP_HERO_COLORS ?? 128}:stats_mode=full[p];` +
    '[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', out,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
}

main().catch((e) => { process.stderr.write(`hero: ${e.message}\n`); process.exit(1); });
