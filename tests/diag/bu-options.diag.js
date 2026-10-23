// Read-only: the Business Units the login form offers per user (the list is
// fetched when the username field loses focus). USERS=suja,admin
// Run: npx playwright test tests/diag/bu-options.noauth.spec.js --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');

test('business units per user', async ({ loginPage, page }) => {
  test.setTimeout(240_000);
  const users = (process.env.USERS || 'suja,admin').split(',').map((s) => s.trim()).filter(Boolean);
  for (const user of users) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await loginPage.username.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const t0 = Date.now();
    const opts = await loginPage.businessUnitOptions(user).catch((e) => `ERROR ${String(e).slice(0, 120)}`);
    console.log(`BU options for "${user}" after ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(opts)}`);
    await page.screenshot({ path: `bug-reports/shots-form-fields/bu-options-${user}.png` }).catch(() => {});
  }
});
