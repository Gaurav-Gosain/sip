// What a deployment can change about the page without forking sip.
//
// Two servers run for this file. examples/hackable configures every extension
// point sip has; the default server on BASE_URL configures none. Every check
// here reads the effect out of the browser — a computed style, an element, a
// byte that came back through the PTY — rather than asserting that a file was
// read. A file being read proves nothing about what the page did with it.
//
// The pair matters as much as either half: an extension point that quietly
// changes the default page is a bug in sip for every deployment that never
// asked for it, so the second half of this file is the default page.

import { test, expect } from '@playwright/test';
import { BASE_URL, HACK_URL } from './playwright.config.mjs';

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
      { message: `nothing that sip sent reached the shell: ${marker} never came back through the PTY`, timeout: 15_000 },
    )
    .toBe(true);
}

test.describe('a deployment that hacks the page', () => {
  test('its stylesheet reaches the browser and wins over sip\'s own', async ({ page }, testInfo) => {
    await boot(page, HACK_URL);

    // The banner is the deployment's own element and every rule that shapes
    // it comes from Config.ExtraCSS. Reading the computed style proves the
    // stylesheet was fetched, parsed and applied, which fetching it does not.
    const banner = page.locator('#hack-banner');
    await expect(banner).toBeVisible();

    const style = await banner.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, height: cs.height, color: cs.color, image: cs.backgroundImage };
    });
    expect(style.position).toBe('fixed');
    expect(style.height).toBe('28px');
    // #a6e3a1.
    expect(style.color).toBe('rgb(166, 227, 161)');

    // The background is brand.svg, a file sip does not ship, served from the
    // deployment's StaticFS. A stylesheet that loaded but could not reach the
    // asset would still report the url here, so the request is checked too.
    expect(style.image).toContain('/static/brand.svg');
    const svg = await page.request.get(`${HACK_URL}/static/brand.svg`);
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toBe('image/svg+xml');

    // A rule of sip's own that the deployment overrode, read off sip's
    // element rather than the deployment's.
    const container = await page.locator('#terminal-container').evaluate(
      (el) => getComputedStyle(el).paddingTop,
    );
    expect(container).toBe('28px');

    // Kept on disk, not only in the report: a green run that nobody can look
    // at is not proof that the page looks right.
    const shot = testInfo.outputPath('consumer-css-applied.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('consumer-css-applied.png', { path: shot, contentType: 'image/png' });
  });

  test('its script runs and window.sip tells it what happened', async ({ page }) => {
    await boot(page, HACK_URL);

    // The deployment's script subscribed before the terminal opened and wrote
    // what it saw into the banner. The banner text is the proof the script
    // ran; the event list is the proof of what it was told.
    await expect(page.locator('#hack-banner')).toContainText('ready ');
    await expect(page.locator('#hack-banner')).toContainText('connect ');

    const events = await page.evaluate(() => window.hackDemo.events);
    const ready = events.find((e) => e.startsWith('ready '));
    const connect = events.find((e) => e.startsWith('connect '));
    expect(ready, 'the ready event never reached the page script').toBeTruthy();
    expect(connect, 'the connect event never reached the page script').toBeTruthy();
    // ready must arrive before connect: a script that waits for the terminal
    // and then subscribes would otherwise miss the first connection.
    expect(events.indexOf(ready)).toBeLessThan(events.indexOf(connect));
    expect(ready).toMatch(/^ready \d+x\d+$/);

    // size() agrees with the grid the terminal actually has.
    const [size, grid] = await page.evaluate(() => [
      window.hackDemo.size(),
      { cols: window.sipTerm.term.cols, rows: window.sipTerm.term.rows },
    ]);
    expect(size).toEqual(grid);
    expect(ready).toBe(`ready ${grid.cols}x${grid.rows}`);
  });

  test('sip.send puts bytes in the shell', async ({ page }) => {
    await boot(page, HACK_URL);
    // greet() is the deployment's own wrapper around sip.send. The marker
    // comes back through the PTY, so the whole path is in the measurement.
    await page.evaluate(() => window.hackDemo.greet());
    await waitForOutput(page, 'hackable');
  });

  test('a resize reaches the page script', async ({ page }) => {
    await boot(page, HACK_URL);
    const before = await page.evaluate(() => window.sipTerm.term.cols);
    await page.setViewportSize({ width: 760, height: 560 });
    await page.waitForFunction((c) => window.sipTerm.term.cols !== c, before, { timeout: 15_000 });
    await page.waitForFunction(
      () => window.hackDemo.events.some((e) => e.startsWith('resize ')),
      null,
      { timeout: 15_000 },
    );
    const resize = (await page.evaluate(() => window.hackDemo.events)).filter((e) => e.startsWith('resize ')).pop();
    const grid = await page.evaluate(() => ({ cols: window.sipTerm.term.cols, rows: window.sipTerm.term.rows }));
    expect(resize).toBe(`resize ${grid.cols}x${grid.rows}`);
  });

  test('its route serves a URL of its own, behind the terminal', async ({ page }) => {
    // A route is for a URL sip has no option for. This one makes the
    // deployment installable on a phone.
    const res = await page.request.get(`${HACK_URL}/manifest.webmanifest`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/manifest+json');
    expect(JSON.parse(await res.text()).name).toBe('Hackable terminal');

    // The icon the manifest names is the file the deployment supplies
    // through StaticFS, and Appearance.Favicon puts it on the tab.
    await boot(page, HACK_URL);
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(icon).toBe('static/brand.svg');
    expect(await page.title()).toBe('Hackable terminal');
  });

  test('its own index.html is the page, and the terminal still runs in it', async ({ page }) => {
    // Chromium cannot reach a loopback WebTransport server and says so in the
    // console on every load. That one is the transport falling back, not the
    // page failing, so it is filtered out by name rather than by loosening the
    // check to nothing.
    const errors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/QUIC|webtransport/i.test(m.text())) return;
      errors.push(m.text());
    });
    await page.goto(HACK_URL);

    // The replaced page drops sip's settings panel. The terminal has to open
    // anyway: a page that leaves out an optional control must not cost the
    // product, and it must not cost it silently either.
    await expect(page.locator('#settings-panel'), 'the replaced page is not the page being served').toHaveCount(0);
    await expect(
      page.locator('.xterm-screen'),
      'the terminal never opened in the replaced page',
    ).toHaveCount(1, { timeout: 20_000 });
    expect(errors, 'the client logged an error while opening the replaced page').toEqual([]);

    await page.waitForFunction(() => window.sipTerm?.connected, null, { timeout: 30_000 });
    await page.evaluate(() => window.sipTerm.sendInput('echo OVERRIDE_PAGE_OK\n'));
    await waitForOutput(page, 'OVERRIDE_PAGE_OK');
  });
});

test.describe('a deployment that configures nothing', () => {
  test('gets sip\'s page, with none of the extension markup in it', async ({ page }) => {
    const res = await page.goto(BASE_URL);
    const html = await res.text();

    expect(html, 'the default page links a stylesheet nobody configured').not.toContain('sip-extra.css');
    expect(html, 'the default page loads a script nobody configured').not.toContain('sip-extra.js');
    expect(html, 'the default page carries client config nobody asked for').not.toContain('__sipConfig');
    expect(html, 'the placeholder was left in the page').not.toContain('{{FONT_FACE_EXTRA}}');
    expect(html).toContain('<title>Sip</title>');
    expect(html).toContain('id="settings-panel"');
    expect(html, 'the default page has the deployment banner in it').not.toContain('hack-banner');
  });

  test('serves nothing at the extension URLs', async ({ page }) => {
    for (const path of ['/static/sip-extra.css', '/static/sip-extra.js', '/static/brand.svg']) {
      const res = await page.request.get(`${BASE_URL}${path}`);
      expect(res.status(), `${path} is served on a server that configured nothing`).toBe(404);
    }
    // Sip's own empty answer, unchanged: a deployment that supplies no icon
    // still gets no icon.
    const icon = await page.request.get(`${BASE_URL}/favicon.ico`);
    expect(icon.status()).toBe(204);
    const manifest = await page.request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(manifest.status(), 'a route nobody configured is served').toBe(404);
  });

  test('refuses a request that walks out of the static directory', async ({ page }) => {
    for (const path of ['/static/%2e%2e/go.mod', '/static/fonts/%2e%2e/%2e%2e/go.mod', '/static/%2e']) {
      const res = await page.request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      expect([307, 404], `${path} answered ${res.status()}`).toContain(res.status());
      if (res.status() === 200) expect(await res.text()).not.toContain('module github.com');
    }
  });

  test('still publishes window.sip, because the page API is the default client', async ({ page }) => {
    await boot(page, BASE_URL);
    const api = await page.evaluate(() => ({
      keys: ['on', 'off', 'send', 'size'].filter((k) => typeof window.sip[k] === 'function'),
      size: window.sip.size(),
      grid: { cols: window.sipTerm.term.cols, rows: window.sipTerm.term.rows },
    }));
    expect(api.keys).toEqual(['on', 'off', 'send', 'size']);
    expect(api.size).toEqual(api.grid);

    // ready is sticky, so a listener added long after the event still runs.
    // Everything a deferred script relies on rests on this.
    const late = await page.evaluate(
      () => new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);
        window.sip.on('ready', (e) => { clearTimeout(timer); resolve(e); });
      }),
    );
    expect(late, 'a listener added after ready fired was never called').not.toBeNull();
    expect(late.cols).toBe(api.grid.cols);

    // A listener that throws must not stop the ones behind it, or one bad
    // line in a deployment's script takes the terminal with it.
    const survived = await page.evaluate(
      () => new Promise((resolve) => {
        window.sip.on('title', () => { throw new Error('deliberate'); });
        window.sip.on('title', (e) => resolve(e.title));
        window.sipTerm.setTitle('throw-test');
      }),
    );
    expect(survived).toBe('throw-test');

    // off removes the listener, and the function on returns does the same.
    const removed = await page.evaluate(() => {
      let n = 0;
      const fn = () => { n++; };
      const undo = window.sip.on('title', fn);
      window.sipTerm.setTitle('one');
      undo();
      window.sipTerm.setTitle('two');
      window.sip.off('title', fn);
      return n;
    });
    expect(removed).toBe(1);
  });
});
