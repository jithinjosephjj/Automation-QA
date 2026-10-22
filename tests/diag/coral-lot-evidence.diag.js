// Evidence screenshots for the bug report "Lot Generation does not list the
// new vendor Coral Jewelry / its inward" (21-10-2026). Read-only: no saves.
// Run: npx playwright test tests/diag/coral-lot-evidence.diag.js (rename it back to *.noauth.spec.js to run; kept out of the suite's testMatch) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const fs = require('fs');

const INWARD = process.env.INWARD_NO || 'M669';
const VENDOR = process.env.VENDOR || 'Coral';
const DIR = process.env.SHOT_DIR || 'bug-reports/shots-coral-lot';

async function gridSearch(page, text) {
  const box = page.locator('input[placeholder="Search"], input[placeholder*="Search" i]').locator('visible=true').last();
  await box.fill(text);
  await box.press('Enter');
  await page.waitForTimeout(3_000);
}

test('coral lot evidence screenshots', async ({ loginPage, metalInward, lotGeneration, page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(DIR, { recursive: true });
  await loginPage.ensureLoggedIn();

  // 1. the inward exists with the new vendor
  await metalInward.open();
  await metalInward.waitForIdle();
  await metalInward.settle(2_000);
  await gridSearch(page, INWARD);
  await page.screenshot({ path: `${DIR}/1-metal-inward-list.png`, fullPage: false });

  // 2. Lot Generation > Add > Metal / Inward / Metal Inward, vendor filter typed
  await lotGeneration.open();
  await lotGeneration.waitForSpinner();
  await lotGeneration.addBtn.click({ timeout: 60_000 });
  await lotGeneration.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await lotGeneration.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lotGeneration.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await lotGeneration.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await lotGeneration.waitForIdle();
  await lotGeneration.settle(2_500);
  const vendorHost = lotGeneration.select('vendorFilter');
  await vendorHost.locator('.ng-select-container').click();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: `${DIR}/2-lot-vendor-filter-list.png` });
  await vendorHost.locator('input[role="combobox"]').fill(VENDOR);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${DIR}/3-lot-vendor-filter-search.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 3. the pending inward stock grid searched for the inward
  await gridSearch(page, INWARD);
  await page.screenshot({ path: `${DIR}/4-lot-pending-inward-search.png` });
  console.log('evidence screenshots written to ' + DIR);
});
