// Read-only: lists the selects on the Lot Generation item panel (after ticking
// the first pending inward row) with controlname, label and current value.
// Run: npx playwright test tests/diag/lot-panel-fields.noauth.spec.js --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const fs = require('fs');

const DIR = process.env.SHOT_DIR || 'bug-reports/shots-lot-panel';

async function dumpSelects(page, tag) {
  const rows = await page.evaluate(() => {
    const vis = (el) => !!(el && el.offsetParent);
    return [...document.querySelectorAll('ng-select')].filter(vis).map((ng) => {
      const wrap = ng.closest('[controlname]');
      const col = ng.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-lg-2, .col-lg-3, .col-lg-4, .form-group') || ng.parentElement;
      const lbl = col && col.querySelector('label');
      const val = ng.querySelector('.ng-value');
      return `${(wrap && wrap.getAttribute('controlname')) || ng.getAttribute('formcontrolname') || '?'} | ${lbl ? lbl.textContent.trim() : '?'} | ${val ? val.textContent.trim() : '(empty)'}${ng.classList.contains('ng-select-disabled') ? ' (disabled)' : ''}`;
    });
  });
  console.log(`--- ${tag}: ${rows.length} visible selects\n` + rows.join('\n'));
}

test('lot panel fields', async ({ loginPage, lotGeneration, page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(DIR, { recursive: true });
  await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  await lotGeneration.open();
  await lotGeneration.waitForSpinner();
  await lotGeneration.addBtn.click({ timeout: 60_000 });
  await lotGeneration.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await lotGeneration.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lotGeneration.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await lotGeneration.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await lotGeneration.waitForIdle();
  await lotGeneration.settle(2_500);
  await dumpSelects(page, 'configuration');

  const row = page.getByRole('row').filter({ hasText: /M\d+/ }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.getByRole('checkbox').first().check({ force: true });
  await lotGeneration.settle(2_500);
  await dumpSelects(page, 'item panel');
  await page.screenshot({ path: `${DIR}/lot-item-panel.png`, fullPage: true });

  // does the Employee pick drive the (disabled) Location?
  await lotGeneration.pick('employeeID', process.env.EMPLOYEE || 'Ubaid', { search: true });
  await lotGeneration.settle(2_000);
  await dumpSelects(page, 'item panel after Employee');
  await page.screenshot({ path: `${DIR}/lot-item-panel-after-employee.png`, fullPage: true });
  const loc = lotGeneration.select('refLocationID');
  if (await loc.count()) {
    console.log(`refLocationID disabled=${await loc.evaluate((el) => el.classList.contains('ng-select-disabled')).catch(() => '?')} readonly attrs=${await loc.evaluate((el) => (el.closest('[controlname]') || el).outerHTML.slice(0, 300)).catch(() => '?')}`);
  }

  // what the Location / Business Unit style selects offer
  for (const name of ['refLocationID', 'locationID', 'businessUnitID', 'lockerID', 'counterID']) {
    const sel = lotGeneration.select(name);
    if (!(await sel.count())) continue;
    await sel.locator('.ng-select-container').first().click().catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).slice(0, 15);
    console.log(`options of ${name}: ${JSON.stringify(opts)}`);
    await page.keyboard.press('Escape');
  }
});
