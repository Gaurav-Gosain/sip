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
      // Input handling diverges between engines in ways a Chromium-only suite
      // cannot see: the chord-leak bug (Ctrl+L arriving as "l") only fires when
      // the browser reports the IME sentinel keyCode, which Firefox on Linux
      // does and Chromium does not. Firefox also negotiates WebTransport here
      // where Chromium falls back to WebSocket, so it covers that path too.
      //
      // Only the input specs run here. The renderer specs read pixels back out
      // of a SwiftShader WebGL context, which is a Chromium-specific setup.
      name: 'firefox',
      testMatch: /(chord_leak|keyboard)\.spec\.mjs/,
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
