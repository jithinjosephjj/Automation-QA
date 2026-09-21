const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only, never submits): the Lot Generation inward grid rendered
// ZERO rows for a fresh jobwork-return inward (21-09-2026). What does the
// grid show at each filter step, and does the search box find the inward?
test('PROBE lot generation inward grid', async ({ loginPage, lotGeneration, page }) => {
  test.setTimeout(300_000);
  const inwardNo = makeState('e2e-b2b-order-lot-state.json').readState().inwardVoucherNo || 'M293';
  console.log(`looking for inward ${inwardNo}`);
  await loginPage.ensureLoggedIn();
  const lg = lotGeneration;
  await lg.open();
  await lg.waitForSpinner();
  await lg.addBtn.click({ timeout: 60_000 });
  await lg.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });

  const dump = async (label) => {
    await lg.waitForIdle();
    await lg.settle(2_500);
    const rows = (await page.getByRole('row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const empty = (await page.getByText(/No Data|No records|No pending|Select .* to load/i).allTextContents().catch(() => [])).map((t) => t.trim());
    const buttons = (await page.getByRole('button').allTextContents()).map((t) => t.trim()).filter((t) => /search|load|fetch|filter|get/i.test(t));
    console.log(`[${label}] rows=${rows.length} hasInward=${rows.some((r) => r.includes(inwardNo))} empty=${JSON.stringify(empty)} buttons=${JSON.stringify(buttons)}`);
    if (rows.length) console.log(`  M-numbers listed: ${JSON.stringify([...new Set(rows.join(' ').match(/\bM\d{2,4}\b/g) || [])])} | first data row: ${(rows[1] || '').slice(0, 160)}`);
  };

  await lg.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lg.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await dump('after item type + source');
  await lg.select('fromTransactionTypeID').locator('.ng-select-container').click();
  console.log('From Transaction Type options:', JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim())));
  await page.keyboard.press('Escape');
  await lg.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await dump('after from-transaction-type');
  const vendorSel = lg.select('vendorFilter');
  if (await vendorSel.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await vendorSel.locator('.ng-select-container').click();
    console.log('Vendor filter options:', JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).slice(0, 20)));
    await page.keyboard.press('Escape');
    await lg.pick('vendorFilter', 'RAJA', { closePanel: true }).catch((e) => console.log('vendor pick:', String(e).split('\n')[0]));
    await dump('after vendor RAJA');
  } else console.log('no vendorFilter select on the form');
  const search = page.getByRole('textbox', { name: 'Search' }).last();
  if (await search.isVisible().catch(() => false)) {
    await search.fill(inwardNo);
    await dump(`after search "${inwardNo}"`);
    await search.press('Enter');
    await dump(`after search Enter`);
  }
  const labels = await page.evaluate(() => [...document.querySelectorAll('label')].map((l) => l.textContent.trim()).filter(Boolean));
  console.log('form labels:', JSON.stringify(labels));
});
