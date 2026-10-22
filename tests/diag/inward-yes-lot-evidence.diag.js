// Evidence screenshots for the bug report "Barcode refused for a lot created
// by Metal Inward Yes -> Lot" (21-10-2026). Read-only: no saves.
// Run: rename to *.noauth.spec.js, then
//   INWARD_NO=M679 LOT_NO=NN292 npx playwright test tests/diag/inward-yes-lot-evidence.noauth.spec.js --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const fs = require('fs');

const INWARD = process.env.INWARD_NO || 'M679';
const LOT = process.env.LOT_NO || 'NN292';
const DIR = process.env.SHOT_DIR || 'bug-reports/shots-inward-yes-lot';

async function gridSearch(page, text) {
  const box = page.locator('input[placeholder="Search"], input[placeholder*="Search" i]').locator('visible=true').last();
  await box.fill(text);
  await box.press('Enter');
  await page.waitForTimeout(3_000);
}

test('inward yes-lot evidence screenshots', async ({ loginPage, metalInward, lotGeneration, page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(DIR, { recursive: true });
  await loginPage.ensureLoggedIn();

  await metalInward.open();
  await metalInward.waitForIdle();
  await metalInward.settle(2_000);
  await gridSearch(page, INWARD);
  await page.screenshot({ path: `${DIR}/1-metal-inward-list.png` });

  await lotGeneration.open();
  await lotGeneration.waitForSpinner();
  await lotGeneration.settle(2_000);
  await gridSearch(page, LOT);
  await page.screenshot({ path: `${DIR}/2-lot-generation-list.png` });
  console.log('evidence screenshots written to ' + DIR);
});
