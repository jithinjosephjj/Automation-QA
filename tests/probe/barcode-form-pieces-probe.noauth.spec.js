const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only evidence): open the Barcode Generation form on a Jobwork Stock
// lot and screenshot the Weight Details block - is the Pieces box disabled and
// what does it hold vs the lot summary? Nothing is submitted.
//   LOT=NN405 npx playwright test tests/probe/barcode-form-pieces-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE barcode form Pieces box on a jobwork lot', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(300_000);
  const lot = process.env.LOT || 'NN405';
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123', bu: 'Kakkanad' });
  const pg = barcodeGeneration;
  await pg.open();
  await pg.waitForSpinner();
  await pg.addBtn.click({ timeout: 60_000 });
  await pg.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await pg.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await pg.pick('masterDataValueID_StockIdentityType', 'Jobwork Stock', { exact: true });
  await pg.pick('vendorID', 'RAJA');
  await pg.pick('lotGenerationID', lot, { exact: true });
  await pg.waitForIdle();
  await pg.settle(3_000);
  const pieces = page.locator('input#noOfPcs, input[formcontrolname="noOfPcs"]').locator('visible=true').first();
  console.log(`lot ${lot}: Pieces value "${await pieces.inputValue().catch(() => '?')}" disabled=${await pieces.isDisabled().catch(() => '?')}; lot pcs ${await pg.lotSummaryNumber('Lot Pcs')} weight ${await pg.lotSummaryNumber('Lot Weight')}`);
  await pieces.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `test-results/screens/probe-barcode-form-${lot}-pieces.png`, fullPage: false }).catch(() => {});
  await page.screenshot({ path: `test-results/screens/probe-barcode-form-${lot}-full.png`, fullPage: true }).catch(() => {});
});
