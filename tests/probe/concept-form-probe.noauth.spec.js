const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): what do the Concept add form's dropdowns offer now?
test('PROBE concept add form options', async ({ loginPage, production, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await production.openConceptTab('Concept');
  await production.clickAdd();
  for (const ctl of ['conceptFor', 'settingType', 'assignTo', 'dimension']) {
    const host = page.locator('sioniq-ng-select[controlname="' + ctl + '"] ng-select').first();
    if (!(await host.count())) { console.log(ctl + ': no such select'); continue; }
    await production.closeStalePanels();
    await host.locator('.ng-select-container').click();
    await page.waitForTimeout(1200);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    console.log(ctl + ' options (' + opts.length + '): ' + JSON.stringify(opts.slice(0, 30)));
    const search = host.locator('input[role="combobox"]');
    if (await search.count()) { await search.fill('Jum'); await page.waitForTimeout(1500); console.log(ctl + ' typed "Jum": ' + JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).slice(0, 15))); }
    await page.keyboard.press('Escape');
  }
});
