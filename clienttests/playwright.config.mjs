// Browser tests for the sip web client, run against a real sip server.
//
// The browser is the system chromium; no Playwright browser downloads are
// needed. Headless GL here is ANGLE over SwiftShader, i.e. software
// rasterization, so these tests assert correctness and structure (what is on
// the canvas, which canvas it is on, that recovery happens) and never assert
// frame rates or absolute timings.

import { defineConfig } from '@playwright/test';

const CHROMIUM = process.env.SIP_CHROMIUM ?? '/usr/bin/chromium';
export const PORT = process.env.SIP_TEST_PORT ?? '7699';
export const BASE_URL = `http://localhost:${PORT}`;

// A second server, started from examples/appearance, which configures a
// palette and a mouse cursor in Go. It is a separate process because
// appearance is read once per server and the default server has to stay
// default: the whole claim is that a deployment configuring nothing renders
// what it always did, and one server cannot be both. Its port leaves the one
// above it free for its own WebTransport listener.
export const APPEARANCE_PORT = String(Number(PORT) + 10);
export const APPEARANCE_URL = `http://localhost:${APPEARANCE_PORT}`;

// A third, from examples/hackable: a deployment that replaces and adds to the
// client files rather than configuring colours. extend.spec.mjs reads the
// effects out of it and reads the default server above for the other half of
// the claim, that a deployment configuring nothing pays nothing.
export const HACK_PORT = String(Number(PORT) + 20);
export const HACK_URL = `http://localhost:${HACK_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      use: {
        baseURL: BASE_URL,
        launchOptions: {
          executablePath: CHROMIUM,
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-lcd-text',
            '--force-device-scale-factor=1',
          ],
        },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      // Firefox is the only engine here that negotiates WebTransport against a
      // loopback server with a self-signed cert hash; Chromium refuses and
      // falls back to WebSocket. That makes this project the sole coverage of
      // the WebTransport input path, which is why the keyboard suite asserts
      // the transport it got instead of accepting a fallback.
      //
      // Only the keyboard suite runs here. The renderer checks read pixels
      // back out of a canvas under a pinned GL setup, which is Chromium-only.
      name: 'firefox',
      // The appearance suite runs here for one test: the options frame is
      // written at two sites, one per transport, and Firefox is the only
      // engine that reaches WebTransport. Its pixel checks skip themselves.
      testMatch: /(keyboard|appearance)\.spec\.mjs/,
      use: {
        baseURL: BASE_URL,
        browserName: 'firefox',
      },
    },
  ],
  webServer: [{
    // A bare, rc-free shell: deterministic prompt-free behaviour, and it
    // stays alive for the whole run so every test shares one server.
    command: `go run ./cmd/sip -p ${PORT} -- sh`,
    cwd: '..',
    url: BASE_URL,
    // Never reuse a server, not even locally. The client assets are go:embed'ed
    // into the binary, so a server left running from an earlier build serves the
    // old static/ files while the source on disk says otherwise. Editing
    // static/ and rerunning then tests the previous build and reports a pass or
    // a failure that has nothing to do with the change. Nothing surfaces an
    // error when this happens, which is what makes it expensive: it cost three
    // meaningless runs of the clipboard work before the pattern gave it away.
    // A rebuild per run is cheap next to a result that cannot be trusted.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  }, {
    // The same shell, served by a program that sets Config.Appearance.
    command: `go run ./examples/appearance -p ${APPEARANCE_PORT} -shell sh`,
    cwd: '..',
    url: APPEARANCE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  }, {
    // The same shell again, served by a program that hacks the page itself.
    command: `go run ./examples/hackable -p ${HACK_PORT}`,
    cwd: '..',
    url: HACK_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  }],
});
