const { test, expect } = require('../../fixtures/test-fixtures');

/**
 * Parallel-run warm-up (scripts/run-parallel.js runs this first, alone):
 * one login per user@BU the lanes use, so the session cache
 * (auth/sessions/<user>-<bu>.json) is fresh before 4 lanes start and no two
 * workers race to form-login and rewrite the same cache file. A cached
 * session still valid for the run is simply replayed.
 */
const LOGINS = [
  { bu: 'Cochin' },
  { user: 'suja', pwd: '123', bu: 'Cochin' },
  { bu: 'Kakkanad' }, // the B2B job-finalize chain transfers in at Kakkanad
];

for (const creds of LOGINS) {
  test(`prewarm session ${creds.user || 'admin'}@${creds.bu}`, async ({ loginPage, page }) => {
    test.setTimeout(180_000);
    await loginPage.ensureLoggedIn(creds);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  });
}
