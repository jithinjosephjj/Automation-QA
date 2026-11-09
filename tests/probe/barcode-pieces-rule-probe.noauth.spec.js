const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): what piece counts does the Barcode form accept for a lot?
// Opens the form on LOT (ITEM_TYPE / STOCK_TYPE / VENDOR), reads the lot summary,
// then types each count in PIECES (default 10,9,5,2,1) and reports the inline
// "Pcs exceeds Lot Pcs" alert, then the same with GROSS (default 10,20). No Submit.
//   LOT=NNN12 ITEM_TYPE=Brand STOCK_TYPE=Stock npx playwright test tests/probe/barcode-pieces-rule-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE barcode pieces rule', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(400_000);
  const lot = process.env.LOT || 'NNN12';
  const itemType = process.env.ITEM_TYPE || 'Brand';
  const stockType = process.env.STOCK_TYPE || 'Stock';
  const vendor = process.env.VENDOR || 'RAJA';
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123', bu: 'Kakkanad' });
  const pg = barcodeGeneration;
  await pg.open();
  await pg.waitForSpinner();
  await pg.addBtn.click({ timeout: 60_000 });
  await pg.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await pg.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
  await pg.pick('masterDataValueID_StockIdentityType', stockType, { exact: true });
  await pg.pick('vendorID', vendor);
  await pg.pick('lotGenerationID', lot, { exact: true });
  await pg.waitForIdle();
  await pg.settle(3_000);
  const alerts = async () => (await page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const summary = await page.evaluate(() => (document.body.innerText.match(/Lot Pcs\s*:\s*\S+|Lot Weight\s*:\s*\S+|Net Weight\s*:\s*\S+/g) || []).join(' | '));
  const pieces = page.locator('input#noOfPcs, input[formcontrolname="noOfPcs"]').locator('visible=true').first();
  console.log(`lot ${lot}: summary ${summary}; Pieces holds "${await pieces.inputValue()}" disabled=${await pieces.isDisabled()}; alerts ${JSON.stringify(await alerts())}`);
  for (const n of (process.env.PIECES || '10,9,5,2,1').split(',')) {
    await pieces.fill(n.trim());
    await pieces.blur();
    await pg.settle(1_200);
    console.log(`pieces ${n.trim()} -> alerts ${JSON.stringify(await alerts())}`);
    await page.screenshot({ path: `test-results/screens/probe-pieces-rule-${lot}-pcs${n.trim()}.png`, fullPage: false }).catch(() => {});
  }
  const gross = pg.inputByLabel('Gross Weight');
  for (const g of (process.env.GROSS || '10,20').split(',')) {
    await gross.fill(g.trim());
    await gross.blur();
    await pg.settle(1_200);
    console.log(`gross ${g.trim()} (pieces ${await pieces.inputValue()}) -> alerts ${JSON.stringify(await alerts())}`);
  }
  await page.screenshot({ path: `test-results/screens/probe-pieces-rule-${lot}.png`, fullPage: true }).catch(() => {});
});
