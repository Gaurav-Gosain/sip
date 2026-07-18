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
