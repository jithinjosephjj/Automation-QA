// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
    launchOptions: {
      // Chrome's Local Network Access permission prompt ("wants to access
      // other apps and services on this device") otherwise blocks the app's
      // Device Radar check on http://127.0.0.1:5151 - nobody can click Allow
      // in a fresh automation profile, so login never proceeds.
      args: ['--disable-features=LocalNetworkAccessChecks'],
    },
  },

  projects: [
    // Specs that must NOT start from a saved session: the login screen itself,
    // credential-validation cases, permission checks. No dependency on setup,
    // so these still run when authentication is broken.
    {
      name: 'no-auth',
      testMatch: /.*\.noauth\.spec\.js/,
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
    },

    // Logs in once and writes auth/admin-cochin.json
    { name: 'setup', testMatch: /global\.setup\.js/ },

    {
      name: 'chromium',
      testIgnore: /.*\.noauth\.spec\.js/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'auth/admin-cochin.json',
      },
    },

    // Enable when cross-browser coverage is needed:
    // { name: 'firefox', dependencies: ['setup'],
    //   use: { ...devices['Desktop Firefox'], storageState: 'auth/admin-cochin.json' } },
  ],

  // JSON output is what maps spec titles (TC IDs) into the 5-sheet Excel workbook.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'results.json' }],
  ],
});
