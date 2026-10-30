const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): is inward INWARD (env, e.g. M778) offered by Lot
// Generation's Pending Inward Stock grid - with and without the vendor
// filter, via the grid's own Search - and what does the Stock Inward list
// say about it (status / vendor / BU columns)? Nothing is saved.
// Run: INWARD=M778 npx playwright test tests/probe/lot-pending-inward-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE lot pending inward', async ({ loginPage, lotGeneration, metalInward, page }) => {
  test.setTimeout(400_000);
  const inward = process.env.INWARD || 'M778';
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });

  // 1. the inward list row
  await metalInward.open();
  await metalInward.waitForSpinner();
  const search = page.locator('xpath=//input[contains(translate(@placeholder, "SEARCH", "search"), "search") and not(ancestor::header) and not(ancestor::*[contains(@class, "topbar") or contains(@class, "navbar")])]').locator('visible=true').first();
  if (await search.count()) { await search.fill(inward); await page.waitForTimeout(4_000); }
  const headers = await page.locator('th').locator('visible=true').allInnerTexts();
  const rows = await page.locator('table tbody tr').locator('visible=true').allInnerTexts();
  console.log(`INWARD LIST headers: ${JSON.stringify(headers.map((h) => h.replace(/\s+/g, ' ').trim()))}`);
  console.log(`INWARD LIST rows for ${inward}: ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' ').trim()).filter((r) => r.includes(inward)).slice(0, 3))}`);

  // 2. the lot pending grid
  await lotGeneration.open();
  await lotGeneration.waitForSpinner();
  await lotGeneration.addBtn.click({ timeout: 60_000 });
  await lotGeneration.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await lotGeneration.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lotGeneration.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await lotGeneration.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await lotGeneration.waitForIdle();
  await page.waitForTimeout(5_000);
  const dump = async (label) => {
    const all = (await page.locator('table tbody tr').locator('visible=true').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
    const recs = await page.getByText(/Records\s*:\s*\d+/).first().textContent().catch(() => '');
    console.log(`${label}: ${recs} rows=${all.length} first=${JSON.stringify(all.slice(0, 6).map((r) => r.slice(0, 60)))} hasInward=${all.some((r) => r.includes(inward))}`);
  };
  await dump('NO VENDOR FILTER');
  const gridSearch = page.locator('xpath=//input[contains(translate(@placeholder, "SEARCH", "search"), "search") and not(ancestor::header) and not(ancestor::*[contains(@class, "topbar") or contains(@class, "navbar")])]').locator('visible=true').first();
  if (await gridSearch.count()) { await gridSearch.fill(inward); await page.waitForTimeout(4_000); await dump('NO VENDOR, SEARCHED'); await gridSearch.fill(''); await page.waitForTimeout(2_000); }
  // vendor options
  const host = lotGeneration.select('vendorFilter');
  await host.locator('.ng-select-container').click();
  await page.waitForTimeout(1_500);
  const vendors = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`vendor options: ${JSON.stringify(vendors.slice(0, 30))}`);
  await page.keyboard.press('Escape');
  await lotGeneration.pick('vendorFilter', 'RAJA', { closePanel: true });
  await lotGeneration.waitForIdle();
  await page.waitForTimeout(5_000);
  await dump('VENDOR RAJA');
  await page.screenshot({ path: 'test-results/screens/probe-lot-pending.png', fullPage: true });
});
