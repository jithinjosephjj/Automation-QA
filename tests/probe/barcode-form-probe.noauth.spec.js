const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only, never submits): after picking a lot on the Barcode
// Generation form, which fields tell us the lot's weight / balance, so the
// tag's Gross Weight can be capped to what the lot still holds?
test('PROBE barcode form lot weight fields', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123' });
  const bc = barcodeGeneration;
  await bc.open();
  await bc.waitForSpinner();
  await bc.addBtn.click({ timeout: 60_000 });
  await bc.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await bc.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await bc.pick('masterDataValueID_StockIdentityType', 'Jobwork Stock', { exact: true });
  await bc.pick('vendorID', 'RAJA');
  // list the lots offered, then pick the first
  await bc.select('lotGenerationID').locator('.ng-select-container').click();
  const lots = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`lots offered (${lots.length}): ${JSON.stringify(lots.slice(0, 15))}`);
  await page.keyboard.press('Escape');
  await bc.pick('lotGenerationID', lots[0], { exact: true });
  await bc.waitForIdle();
  await bc.settle(2_500);
  if (!(await bc.selectValue('lotGenerationMetalID'))) { await bc.pickFirstOption('lotGenerationMetalID'); await bc.settle(2_000); }

  const fields = await page.evaluate(() => {
    const out = [];
    for (const lbl of document.querySelectorAll('label')) {
      const text = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const box = lbl.closest('div.grid, div.form-group, div.col, div[class*=col-]') || lbl.parentElement;
      const input = box && box.querySelector('input:not([type=checkbox])');
      const sel = box && box.querySelector('ng-select .ng-value');
      out.push(`${text} = ${input ? JSON.stringify(input.value) + (input.disabled ? ' (disabled)' : '') : sel ? '[' + sel.textContent.trim() + ']' : '?'}`);
    }
    return out;
  });
  console.log('FORM FIELDS:\n  ' + fields.join('\n  '));
  const numbers = await page.evaluate(() => (document.body.innerText.match(/[A-Za-z ()/]*(Weight|Wt|Balance|Available|Pcs|Pieces)[A-Za-z ()/]*[:\s]+[0-9.,]+/gi) || []).slice(0, 30));
  console.log('WEIGHT-LIKE TEXT:', JSON.stringify(numbers));
  await bc.closeVisibleDialog();
});
