const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): what do the Material Receipt header selects offer now
// (the recording of 21-09-2026 shows a "Metal Tree" option), and does worker
// Sioniquser23 exist for Casting?
test('PROBE material receipt options', async ({ loginPage, production, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  const options = async (ctl) => {
    const host = page.locator('sioniq-ng-select[controlname="' + ctl + '"] ng-select').first();
    if (!(await host.count())) { console.log(ctl + ': (no such select)'); return; }
    await production.closeStalePanels();
    await host.locator('.ng-select-container').click();
    await page.waitForTimeout(900);
    console.log(ctl + ' options: ' + JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).slice(0, 30)));
    await page.keyboard.press('Escape');
  };
  const labelsWithControls = async () => page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent).map((n) => (n.closest('div.grid, div.form-group, div.col, div[class*=col-]')?.querySelector('label')?.textContent || '').trim() + ' [' + n.getAttribute('controlname') + ']'));
  await production.openMaterialTabAdd('Receipt');
  await production.pick('employeeID', 'Asmi', { search: true });
  await production.pick('departmentProcessID', 'Casting Process', { search: true });
  await production.pick('departmentSubProcessID', 'Casting Inspection', { search: true }).catch(() => {});
  await production.pick('masterDataValueID_ProductionWorkerType', 'Inhouse Worker', { exact: true });
  await options('vendorID');
  await production.pick('vendorID', 'Sioniquser23', { search: true }).catch((e) => console.log('Sioniquser23 pick: ' + String(e).split('\n')[0]));
  await options('masterDataValueID_StockEntityType');
  console.log('receipt header controls: ' + JSON.stringify(await labelsWithControls()));
  for (const ent of await (async () => { const h = page.locator('sioniq-ng-select[controlname="masterDataValueID_StockEntityType"] ng-select').first(); await h.locator('.ng-select-container').click(); await page.waitForTimeout(800); const o = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()); await page.keyboard.press('Escape'); return o; })()) {
    await production.pick('masterDataValueID_StockEntityType', ent, { exact: true });
    await production.settle(1500);
    console.log('after entity "' + ent + '": controls ' + JSON.stringify(await labelsWithControls()));
    await options('masterDataValueID_StockIdentityType');
    const rows = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)));
    console.log('  grid rows: ' + JSON.stringify(rows.slice(0, 4)));
  }
});
