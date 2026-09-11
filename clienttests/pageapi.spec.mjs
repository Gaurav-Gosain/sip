// What a page script may do through window.sip, and what it may not.
//
// Three servers carry this file, and the three of them are the claim:
//
//   BASE_URL        configures no PageAPI at all. It proves the default is
//                   what sip granted before capabilities existed, and it is
//                   where every denied call is proved denied.
//   HACK_URL        examples/hackable grants every capability. It is where
//                   each granted call is proved to work.
//   APPEARANCE_URL  examples/appearance grants appearance and revokes input.
//                   It proves the split the whole design turns on: a page that
//                   repaints the terminal need not be a page that types into it.
//
// Every check reads the effect out of the browser. A call that exists proves
// nothing. A colour on the document element, a byte back through the PTY and a
// string on the system clipboard do.
//
// This file has no transport dimension, and that is a decision rather than an
// omission. The capability list is seeded into the page at index render and the
// handshake deliberately does not carry it, so there is no second framing of it
// to get wrong. The one call here that does reach the wire, input.send, is
// already driven over both transports by keyboard.spec.mjs.

import { test, expect } from '@playwright/test';
import { BASE_URL, HACK_URL, APPEARANCE_URL } from './playwright.config.mjs';

/** Open a page and wait for the terminal to carry a session. */
async function boot(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
}

/** Wait for a marker to come back through the PTY, and say so when it does not. */
async function waitForOutput(page, marker) {
  await expect
    .poll(
      () => page.evaluate((m) => {
        const b = window.sipTerm.term.buffer.active;
        for (let i = 0; i < b.length; i++) {
          if (b.getLine(i).translateToString(true).includes(m)) return true;
        }
        return false;
      }, marker),
      { message: `${marker} never came back through the PTY`, timeout: 15_000 },
    )
    .toBe(true);
}

/** Run a command in the served shell through the page API. */
async function shell(page, command) {
  await page.evaluate((c) => window.hackDemo.api.input.send(c + '\n'), command);
}

/** The CSS custom properties sip has written on the document element. */
function chromeProps(page) {
  return page.evaluate(() => {
    const style = document.documentElement.style;
    const out = {};
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.startsWith('--sip-') || name.startsWith('--webterm-')) {
        out[name] = style.getPropertyValue(name).trim();
      }
    }
    return out;
  });
}

/** Call something on the claimed API and report what it threw, if anything. */
function attempt(page, body) {
  return page.evaluate((src) => {
    const api = window.hackDemo ? window.hackDemo.api : window.sip.claim();
    try {
      // eslint-disable-next-line no-new-func
      const out = new Function('api', 'return (' + src + ')')(api);
      return { ok: true, value: out === undefined ? null : out };
    } catch (e) {
      return { ok: false, name: e.name, message: String(e.message), capability: e.capability || null };
    }
  }, body);
}

test.describe('a deployment that configures no PageAPI', () => {
  test('grants exactly what sip granted before capabilities existed', async ({ page }) => {
    await boot(page, BASE_URL);

    const caps = await page.evaluate(() => window.sip.capabilities());
    expect(caps, 'the default grant changed. Every deployment that upgrades gains this').toEqual(['observe', 'input']);

    // The four calls the old window.sip carried are still the four calls on
    // it. claim and capabilities are the way into the rest.
    const keys = await page.evaluate(() => Object.keys(window.sip).filter((k) => typeof window.sip[k] === 'function'));
    expect(keys.sort()).toEqual(['capabilities', 'claim', 'off', 'on', 'send', 'size']);
  });

  test('refuses every call it did not grant, by name', async ({ page }) => {
    await boot(page, BASE_URL);

    const denied = {
      appearance: 'api.appearance.set({ theme: { background: "#ff0000" } })',
      view: 'api.view.clear()',
      read: 'api.selection.get()',
      clipboard: 'api.clipboard.copySelection()',
      connection: 'api.connection.reconnect()',
    };
    const claimed = await page.evaluate(() => { window.__api = window.sip.claim(); return true; });
    expect(claimed).toBe(true);

    for (const [cap, call] of Object.entries(denied)) {
      const got = await page.evaluate((src) => {
        try {
          // eslint-disable-next-line no-new-func
          new Function('api', 'return (' + src + ')')(window.__api);
          return { ok: true };
        } catch (e) {
          return { ok: false, name: e.name, message: String(e.message), capability: e.capability };
        }
      }, call);

      expect(got.ok, `${call} ran on a page that was never granted ${cap}`).toBe(false);
      expect(got.name, `${call} threw the wrong kind of error`).toBe('SipCapabilityError');
      expect(got.capability, `${call} blamed the wrong capability`).toBe(cap);
      // The message has to send the deployment to the option that fixes it.
      // A refusal nobody can act on is a bug report.
      expect(got.message).toContain('Config.PageAPI.Grant');
    }

    // And the refusal is a refusal, not a warning: nothing moved.
    expect(await chromeProps(page), 'a denied appearance call still repainted the page').toEqual({});
  });

  test('hands the API over once', async ({ page }) => {
    await boot(page, BASE_URL);
    const twice = await page.evaluate(() => {
      window.sip.claim();
      try {
        window.sip.claim();
        return null;
      } catch (e) {
        return String(e.message);
      }
    });
    expect(twice, 'the page API was handed over twice').not.toBeNull();
    expect(twice).toContain('claimed already');
  });
});

test.describe('a deployment that grants everything', () => {
  test('the deployment script claimed the API, so nothing after it can', async ({ page }) => {
    await boot(page, HACK_URL);

    // examples/hackable calls sip.claim() on the first line of its own
    // script. This is what that buys: a script that arrives later — an
    // analytics tag, a widget, anything appended at runtime — finds the
    // handoff already spent.
    const late = await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'try { window.__late = window.sip.claim(); }'
        + ' catch (e) { window.__lateError = String(e.message); }';
      document.head.appendChild(s);
      return { got: !!window.__late, error: window.__lateError || null };
    });
    expect(late.got, 'a script appended at runtime took the page API').toBe(false);
    expect(late.error).toContain('claimed already');

    const caps = await page.evaluate(() => window.hackDemo.api.capabilities());
    expect(caps, 'the granted list never reached the page').toEqual(
      ['observe', 'input', 'appearance', 'view', 'read', 'clipboard', 'connection'],
    );

    // The other half of the same bar. window.sip is a plain object, so a
    // later script can replace a call on it. The claimed object holds its own
    // handles, so replacing one must not put that script between the
    // deployment and its terminal.
    const patched = await page.evaluate(async () => {
      window.__stolen = [];
      window.sip.send = (data) => { window.__stolen.push(String(data)); };
      await window.hackDemo.api.send('echo NOT_STOLEN\n');
      return window.__stolen;
    });
    expect(patched, 'a script replaced window.sip.send and saw what the deployment sent').toEqual([]);
    await waitForOutput(page, 'NOT_STOLEN');
  });

  test('repaints the terminal and the chrome around it, live', async ({ page }) => {
    await boot(page, HACK_URL);

    const before = await page.evaluate(() => window.sipTerm.term.options.theme.background);
    const propsBefore = await chromeProps(page);
    await page.evaluate(() => window.hackDemo.api.appearance.set({
      theme: { background: '#102030', foreground: '#a0b0c0', blue: '#0000ff' },
      fontSize: 19,
      cursorStyle: 'underline',
      scrollback: 1234,
      mouseCursor: 'crosshair',
    }));

    const after = await page.evaluate(() => {
      const o = window.sipTerm.term.options;
      return {
        background: o.theme.background,
        foreground: o.theme.foreground,
        fontSize: o.fontSize,
        cursorStyle: o.cursorStyle,
        scrollback: o.scrollback,
      };
    });
    expect(after.background, 'the live theme never reached the terminal').toBe('#102030');
    expect(after.background).not.toBe(before);
    expect(after.foreground).toBe('#a0b0c0');
    expect(after.fontSize).toBe(19);
    expect(after.cursorStyle).toBe('underline');
    expect(after.scrollback).toBe(1234);

    // The chrome follows the palette, which is the rule Config.Appearance
    // already follows. A terminal in one theme inside a panel in another is
    // what skipping this produces.
    const props = await chromeProps(page);
    expect(props['--sip-bg'], 'the panel colours did not follow the new palette').toBe('#102030');
    expect(props['--webterm-background']).toBe('#102030');
    expect(props['--sip-fg']).toBe('#a0b0c0');
    expect(props['--sip-accent']).toBe('#0000ff');
    expect(props['--sip-mouse-cursor']).toBe('crosshair');

    // reset puts the deployment's own appearance back, the chrome with it.
    // A reset that leaves the panel in the page's colours is not a reset.
    await page.evaluate(() => window.hackDemo.api.appearance.reset());
    await expect
      .poll(() => page.evaluate(() => window.sipTerm.term.options.theme.background))
      .toBe(before);
    expect(await chromeProps(page), 'reset left the page in the colours it set').toEqual(propsBefore);
  });

  test('a live theme survives the reconnect that re-sends the deployment blob', async ({ page }) => {
    await boot(page, HACK_URL);
    await page.evaluate(() => window.hackDemo.api.appearance.set({ theme: { background: '#0b0b17' } }));
    expect(await page.evaluate(() => window.sipTerm.term.options.theme.background)).toBe('#0b0b17');

    // The handshake carries the deployment's appearance on every connect, so
    // without the page's patch going back on top this is where a live theme
    // silently reverts.
    await page.evaluate(() => { window.__conn = window.sipTerm.connection; });
    await page.evaluate(() => window.hackDemo.api.connection.reconnect());
    await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
    await page.waitForTimeout(300);

    // The session really was restarted, so the assertion below is about a
    // handshake that happened rather than about one that never did.
    expect(
      await page.evaluate(() => window.sipTerm.connection !== window.__conn),
      'reconnect never opened a new session, so this test proves nothing',
    ).toBe(true);

    expect(
      await page.evaluate(() => window.sipTerm.term.options.theme.background),
      'the reconnect pulled the page theme back to the deployment default',
    ).toBe('#0b0b17');
  });

  test('refuses a value the browser would drop, or follow', async ({ page }) => {
    await boot(page, HACK_URL);
    const propsBefore = await chromeProps(page);

    // Each of these is a string that reaches a CSS property, a font
    // declaration or a link href. Every one of them is refused at the call,
    // which is the only place sip can refuse it.
    const poisoned = [
      ['a cursor that names a URL', 'api.appearance.set({ mouseCursor: "url(https://example.com/x.png), auto" })'],
      ['a colour that closes the declaration', 'api.appearance.set({ theme: { background: "red; background-image: url(https://example.com/x)" } })'],
      ['a colour the browser cannot parse', 'api.appearance.set({ theme: { background: "rebeccapurple" } })'],
      ['a colour under a name no theme has', 'api.appearance.set({ theme: { backgroundImage: "#fff" } })'],
      ['the derived chrome map', 'api.appearance.set({ chrome: { "--sip-bg": "url(https://example.com/x)" } })'],
      ['a javascript: tab icon', 'api.appearance.set({ favicon: "javascript:alert(1)" })'],
      ['a javascript: tab icon with a tab in it', 'api.appearance.set({ favicon: "java\\tscript:alert(1)" })'],
      ['a font family that ends the declaration', 'api.appearance.set({ fontFamily: "x; background: url(https://example.com/y)" })'],
      ['a cursor style that is not a shape', 'api.appearance.set({ cursorStyle: "url(x)" })'],
      ['a font size that is a string', 'api.appearance.set({ fontSize: "19px" })'],
    ];

    for (const [what, call] of poisoned) {
      const got = await attempt(page, call);
      expect(got.ok, `${what} was accepted`).toBe(false);
      expect(got.name, `${what} threw ${got.name}`).toBe('TypeError');
    }

    // Nothing moved. A validation that refuses and half-applies is worse than
    // no validation, because it looks like it worked.
    expect(await chromeProps(page), 'a refused value reached the page anyway').toEqual(propsBefore);
    expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe('static/brand.svg');
  });

  test('finds what the program printed, on the screen and in a wrapped line', async ({ page }) => {
    await boot(page, HACK_URL);

    // Split in the source so the shell's own echo of the command does not
    // contain the marker. One match, on one row, is what makes the
    // selection an exact-match assertion.
    await shell(page, "printf 'Z9MAR''KER\\n'");
    await waitForOutput(page, 'Z9MARKER');

    const hit = await page.evaluate(() => window.hackDemo.api.search.find('z9marker'));
    expect(hit, 'search found nothing that is on the screen').not.toBeNull();
    expect(hit.length).toBe(8);
    expect(
      await page.evaluate(() => window.hackDemo.api.selection.get()),
      'search selected something other than the match',
    ).toBe('Z9MARKER');

    // A terminal wraps constantly, so a search that stops at the row
    // boundary misses most of what is on the screen. This marker straddles
    // one on purpose.
    const cols = await page.evaluate(() => window.sipTerm.term.cols);
    const pad = 'y'.repeat(cols - 4);
    await shell(page, `printf '${pad}WRAPMARK\\n'`);
    await waitForOutput(page, 'WRAPMARK');

    const straddling = await page.evaluate((c) => {
      const api = window.hackDemo.api;
      api.search.clear();
      const found = [];
      let m = api.search.find('WRAPMARK');
      for (let i = 0; m && i < 6; i++) {
        found.push({ col: m.col, text: api.selection.get() });
        m = api.search.findNext();
        if (found.some((f) => f.col === m?.col)) break;
      }
      return { found, cols: c };
    }, cols);

    expect(straddling.found.length, 'the wrapped marker was never found').toBeGreaterThan(0);
    for (const f of straddling.found) {
      expect(f.text, 'a match selected the wrong text').toBe('WRAPMARK');
    }
    expect(
      straddling.found.some((f) => f.col + 8 > straddling.cols),
      'no match started near the right edge, so the wrapped line was never searched',
    ).toBe(true);
  });

  test('copies the selection to the system clipboard without handing it over', async ({ page }) => {
    await boot(page, HACK_URL);
    await page.evaluate(() => navigator.clipboard.writeText('CLIPBOARD_NOT_WRITTEN'));

    await page.evaluate(() => {
      window.sipTerm.webterm.write('\x1b[2J\x1b[HCOPYME');
    });
    await page.waitForTimeout(150);
    const ok = await page.evaluate(async () => {
      const api = window.hackDemo.api;
      window.sipTerm.term.select(0, 0, 6);
      return api.clipboard.copySelection();
    });
    expect(ok, 'copySelection reported that nothing was copied').toBe(true);
    expect(
      await page.evaluate(() => navigator.clipboard.readText()),
      'the selection never reached the system clipboard',
    ).toBe('COPYME');
  });

  test('moves the viewport and clears the scrollback', async ({ page }) => {
    await boot(page, HACK_URL);
    // More lines than the grid has rows, so there is a scrollback to move
    // through and to throw away. Ten lines on a tall terminal scroll nothing,
    // and every assertion below would then be comparing a number to itself.
    await shell(page, "i=0; while [ $i -lt 120 ]; do printf 'line%s\\n' $i; i=$((i+1)); done");
    await waitForOutput(page, 'line119');

    const rows = await page.evaluate(() => window.sipTerm.term.rows);
    expect(
      await page.evaluate(() => window.sipTerm.term.buffer.active.length),
      'nothing scrolled off the screen, so this test would prove nothing',
    ).toBeGreaterThan(rows);

    const scrolled = await page.evaluate(() => {
      const api = window.hackDemo.api;
      api.view.scrollToTop();
      const top = window.sipTerm.term.buffer.active.viewportY;
      api.view.scrollToBottom();
      return { top, bottom: window.sipTerm.term.buffer.active.viewportY };
    });
    expect(scrolled.bottom, 'the viewport never moved').toBeGreaterThan(scrolled.top);

    const cleared = await page.evaluate(() => {
      const before = window.sipTerm.term.buffer.active.length;
      window.hackDemo.api.view.clear();
      return { before, after: window.sipTerm.term.buffer.active.length };
    });
    expect(cleared.after, 'view.clear kept the scrollback').toBeLessThan(cleared.before);
  });

  test('types and pastes into the shell', async ({ page }) => {
    await boot(page, HACK_URL);
    await page.evaluate(() => window.hackDemo.greet());
    await waitForOutput(page, 'hackable');

    await page.evaluate(() => window.hackDemo.api.input.paste('echo PASTED_OK\n'));
    await waitForOutput(page, 'PASTED_OK');
  });

  test('reports what the terminal is doing', async ({ page }) => {
    await boot(page, HACK_URL);
    const status = await page.evaluate(() => window.hackDemo.api.status());
    const grid = await page.evaluate(() => ({
      cols: window.sipTerm.term.cols,
      rows: window.sipTerm.term.rows,
      renderer: window.sipTerm.currentRenderer,
    }));
    expect(status.connected).toBe(true);
    expect(status.readOnly).toBe(false);
    expect(status.transport).toContain('Web');
    expect(status.renderer).toBe(grid.renderer);
    expect(
      { cols: status.cols, rows: status.rows },
      'status reported a grid the terminal does not have',
    ).toEqual({ cols: grid.cols, rows: grid.rows });
  });
});

test.describe('a deployment that grants appearance and revokes input', () => {
  test('the page repaints the terminal and cannot type into it', async ({ page }) => {
    await boot(page, APPEARANCE_URL);

    const caps = await page.evaluate(() => window.sip.capabilities());
    expect(caps, 'the revoked list never reached the page').toEqual(['observe', 'appearance']);

    const typed = await page.evaluate(() => {
      try {
        window.sip.send('echo NEVER\n');
        return null;
      } catch (e) {
        return { name: e.name, capability: e.capability };
      }
    });
    expect(typed, 'a page with input revoked still typed into the shell').not.toBeNull();
    expect(typed.name).toBe('SipCapabilityError');
    expect(typed.capability).toBe('input');

    // And the half it does have still works.
    await page.evaluate(() => window.sip.claim().appearance.set({ fontSize: 21 }));
    expect(
      await page.evaluate(() => window.sipTerm.term.options.fontSize),
      'a granted appearance call did nothing',
    ).toBe(21);
  });

  test('the chrome the page derives is the chrome the server derived', async ({ page }) => {
    await boot(page, APPEARANCE_URL);

    // Appearance.chrome derives the page's own colours from the palette, in
    // Go, where the mix is unit-tested. A page that repaints the palette has
    // no server to ask, so the same derivation lives in the client too. Two
    // implementations of one rule drift, and this is what stops them: the
    // client derives the palette the server already derived, and the maps
    // have to come out identical.
    const server = await page.evaluate(() => window.__sipConfig.appearance.chrome);
    expect(Object.keys(server).length, 'the server derived no chrome to compare against').toBeGreaterThan(10);

    const theme = await page.evaluate(() => window.__sipConfig.appearance.theme);
    await page.evaluate((t) => window.sip.claim().appearance.set({ theme: t }), theme);

    const client = await chromeProps(page);
    for (const [prop, value] of Object.entries(server)) {
      expect(client[prop], `${prop} differs between the Go derivation and the client's`).toBe(value);
    }
  });
});

test.describe('the program on the other end', () => {
  // The terminal renders bytes from whatever the user is running, so every one
  // of those bytes is hostile. This is the test that says so: it puts the
  // sequences a program would use to reach the page into the PTY, through a
  // real shell, and asserts that none of them reached anything.
  test('cannot reach one call, one capability or one CSS property', async ({ page }) => {
    await boot(page, HACK_URL);

    const before = {
      caps: await page.evaluate(() => window.hackDemo.api.capabilities()),
      props: await chromeProps(page),
      icon: await page.locator('link[rel="icon"]').getAttribute('href'),
      appearance: await page.evaluate(() => window.hackDemo.api.appearance.get()),
      heads: await page.evaluate(() => document.head.querySelectorAll('script, style, link').length),
    };

    // OSC 0 renames the tab, which sip does on purpose and which is the one
    // place a program's own string reaches the page. It is the canary here:
    // if the title does not change, the sequences never arrived and every
    // assertion below would pass for the wrong reason.
    const attack = [
      "\\033]0;PTY_CANARY\\007",
      "\\033]4;1;#ff0000\\007",
      "\\033]10;#ff0000\\007",
      "\\033]11;#ff0000\\007",
      "\\033]12;#ff0000\\007",
      "\\033]22;url(https://example.com/evil.png)\\033\\\\",
      "\\033]52;c;UFRZX0NMSVBCT0FSRA==\\007",
      "\\033]1337;File=inline=1\\007",
    ].join('');
    await shell(page, `printf '${attack}'`);
    // And the same bytes as ordinary text, because a program that cannot
    // find an escape sequence that works will simply print the call.
    await shell(page, "printf 'sip.appearance.set({favicon:\\042javascript:alert(1)\\042})\\n'");
    await shell(page, "printf '<script>window.PWNED=1</script>\\n'");

    await expect.poll(() => page.title(), { timeout: 15_000 }).toBe('PTY_CANARY');

    // The canary landed, so the bytes reached the emulator. Now the claim.
    expect(
      await page.evaluate(() => window.hackDemo.api.capabilities()),
      'a program changed what the page is allowed to do',
    ).toEqual(before.caps);
    expect(
      await chromeProps(page),
      'a program reached a CSS custom property through the terminal',
    ).toEqual(before.props);
    expect(
      await page.locator('link[rel="icon"]').getAttribute('href'),
      'a program changed the tab icon',
    ).toBe(before.icon);
    expect(
      await page.evaluate(() => window.hackDemo.api.appearance.get()),
      'appearance.get reported something a program set rather than something the page asked for',
    ).toEqual({ ...before.appearance, title: 'PTY_CANARY' });
    expect(
      await page.evaluate(() => document.head.querySelectorAll('script, style, link').length),
      'a program put a tag in the page head',
    ).toBe(before.heads);
    expect(await page.evaluate(() => window.PWNED), 'a program ran script in the page').toBeUndefined();
  });
});
