// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // tests/not-implemented holds workflows the app cannot complete yet (Brand
  // and Stone sales invoices: no invoice screen sells them, 24-09-2026) -
  // parked out of every run so they don't turn the suite red.
  // RUN_NOT_IMPLEMENTED=1 runs them on purpose.
  testIgnore: process.env.RUN_NOT_IMPLEMENTED ? [] : ['**/not-implemented/**'],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial by default: Sioniq shares voucher/reference series across the BU,
  // so parallel workers collide on document numbering.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  use: {
    baseURL: process.env.SIONIQ_URL || 'https://qa.sioniq.com',
    // The suite is HEADED-ONLY (Device Radar gate blocks headless logins), so
    // pin it here instead of relying on the --headed flag - VS Code extension
    // runs otherwise launch headless and every test dies at the login gate.
    headless: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video off (30-09-2026): it was encoded for every test and thrown away
    // on pass, costing CPU the headed browser needs on an 8 GB laptop; the
    // trace already replays a failure step by step. PW_VIDEO=1 turns it
    // back on (retain-on-failure) for a run that needs the recording.
    video: process.env.PW_VIDEO ? 'retain-on-failure' : 'off',
    // 15 s / 30 s suit one lane on a quiet qa. Parallel lanes (scripts/
    // run-parallel.js) raise them through the env: 4 browsers kept the
    // loading overlay up for 15-60 s per page on 29-09-2026 and the action
    // timeout caps every click, overlay handler included.
    actionTimeout: Number(process.env.PW_ACTION_TIMEOUT || 15_000),
    navigationTimeout: Number(process.env.PW_NAV_TIMEOUT || 30_000),
    // Full-screen (maximized) window: viewport null lets the page use the
    // real window size, and --start-maximized maximizes it. Both are needed;
    // a fixed viewport would clamp the page regardless of the window.
    viewport: null,
    ignoreHTTPSErrors: true,
    launchOptions: {
      // --start-maximized: run the browser maximized (full screen).
      // --disable-features=LocalNetworkAccessChecks: Chrome's Local Network
      // Access permission prompt ("wants to access other apps and services on
      // this device") otherwise blocks the app's Device Radar check on
      // http://127.0.0.1:5151 - nobody can click Allow in a fresh automation
      // profile, so login never proceeds.
      args: ['--start-maximized', '--disable-features=LocalNetworkAccessChecks'],
    },
  },

  projects: [
    // Specs that must NOT start from a saved session: the login screen itself,
    // credential-validation cases, permission checks. No dependency on setup,
    // so these still run when authentication is broken.
    {
      name: 'no-auth',
      testMatch: /.*\.noauth\.spec\.js/,
      // viewport: null overrides the fixed viewport that devices['Desktop
      // Chrome'] sets, so --start-maximized takes effect. deviceScaleFactor
      // must be cleared too - it cannot coexist with a null viewport.
      use: { ...devices['Desktop Chrome'], viewport: null, deviceScaleFactor: undefined, storageState: { cookies: [], origins: [] } },
    },

    // Logs in once and writes auth/admin-cochin.json
    { name: 'setup', testMatch: /global\.setup\.js/ },

    {
      name: 'chromium',
      testIgnore: /.*\.noauth\.spec\.js/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: null, // maximized window (overrides the device's fixed viewport)
        deviceScaleFactor: undefined, // cannot coexist with a null viewport
        storageState: 'auth/admin-cochin.json',
      },
    },
    // Chromium only (06-10-2026): the Firefox project was removed - this 8 GB
    // laptop cannot carry a second headed browser, and the suite's Device
    // Radar / Local Network Access handling is Chromium-specific.
  ],

  // JSON output is what maps spec titles (TC IDs) into the 5-sheet Excel workbook.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'results.json' }],
  ],
});
