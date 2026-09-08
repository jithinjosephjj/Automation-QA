/**
 * Full-screen (maximized) recorder for qa.sioniq.com.
 *
 * `npx playwright codegen` can't pass browser args, so it can't maximize the
 * window or set the Local Network Access flag the app's Device Radar gate
 * needs. This launcher does both, then page.pause() opens the Playwright
 * Inspector - click the red "Record" button to generate code as you click.
 *
 * Run:   node record.js
 *        node record.js https://qa.sioniq.com/sls/view-transfer   (custom start URL)
 */
const { chromium } = require('@playwright/test');

(async () => {
  const url = process.argv[2] || 'https://qa.sioniq.com/login';
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: null, // let the page use the whole maximized window
    ignoreHTTPSErrors: true,
    args: [
      '--start-maximized',
      '--disable-features=LocalNetworkAccessChecks', // Device Radar gate on 127.0.0.1:5151
    ],
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url);
  // opens the Inspector; press Record there to capture actions as Playwright code
  await page.pause();
})();
