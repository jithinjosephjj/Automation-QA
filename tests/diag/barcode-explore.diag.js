// Read-only: on the Barcode page at the given login, for every Stock Identity
// Type lists the vendors offered and, when VENDOR is among them, the lots
// offered (filtered by LOT_PREFIX). Finds where a lot is tag-able from.
// Run: BU=Kakkanad VENDOR=RAJA LOT_PREFIX=NN32 npx playwright test tests/diag/barcode-explore.noauth.spec.js --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');

const VENDOR = process.env.VENDOR || 'RAJA';
const PREFIX = process.env.LOT_PREFIX || 'NN3';

async function optionsOf(page, pg, controlname) {
  const host = pg.select(controlname);
  if (!(await host.count())) return null;
  await host.locator('.ng-select-container').first().click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_800);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return opts;
}

test('barcode page: stock identity types, vendors and lots', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(400_000);
  const pg = barcodeGeneration;
  await loginPage.ensureLoggedIn({ ...(process.env.USER_NAME ? { user: process.env.USER_NAME, pwd: process.env.USER_PWD || '123' } : {}), ...(process.env.BU ? { bu: process.env.BU } : {}) });
  await pg.open();
  await pg.addBtn.click({ timeout: 60_000 });
  await pg.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await pg.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await pg.settle(1_500);
  const types = await optionsOf(page, pg, 'masterDataValueID_StockIdentityType');
  console.log(`Stock Identity Types: ${JSON.stringify(types)}`);
  for (const t of types || []) {
    if (/No items/i.test(t)) continue;
    await pg.pick('masterDataValueID_StockIdentityType', t, { exact: true }).catch((e) => console.log(`  pick ${t}: ${String(e).slice(0, 80)}`));
    await pg.settle(2_000);
    const vendors = await optionsOf(page, pg, 'vendorID');
    console.log(`[${t}] vendors: ${JSON.stringify((vendors || []).slice(0, 25))}`);
    if (vendors && vendors.some((v) => v.toLowerCase().includes(VENDOR.toLowerCase()))) {
      await pg.pick('vendorID', VENDOR).catch(() => {});
      await pg.settle(2_000);
      const lots = await optionsOf(page, pg, 'lotGenerationID');
      const mine = (lots || []).filter((l) => l.includes(PREFIX));
      console.log(`[${t}] ${VENDOR} lots (${(lots || []).length}): matching "${PREFIX}" -> ${JSON.stringify(mine)}; first 10 -> ${JSON.stringify((lots || []).slice(0, 10))}`);
    }
  }
});
