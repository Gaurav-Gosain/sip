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
      testMatch: /keyboard\.spec\.mjs/,
      use: {
        baseURL: BASE_URL,
        browserName: 'firefox',
      },
    },
  ],
  webServer: {
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
  },
});
