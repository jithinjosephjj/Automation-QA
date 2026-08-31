const { test: setup, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { LoginPage } = require('../pages/LoginPage');
const env = require('../utils/env');

/**
 * Runs once before the browser projects. Logs in for real and writes the
 * session to auth/admin-cochin.json so no other spec ever sees the login screen.
 */
setup('authenticate', async ({ page }) => {
  setup.setTimeout(120_000);

  const login = new LoginPage(page);
  await login.open();
  await login.login();

  // Distinguish an environment gate from a genuine credential failure before
  // spending 60s waiting for a navigation that can never happen.
  await login.throwIfGated();

  // Landing anywhere other than /login is the success signal - the app
  // redirects to its returnUrl, which is not a fixed route.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');

  fs.mkdirSync(path.dirname(env.AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: env.AUTH_FILE });
  console.log(`  saved session -> ${env.AUTH_FILE} (landed on ${page.url()})`);
});
