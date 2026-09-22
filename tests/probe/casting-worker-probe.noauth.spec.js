const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): is the worker named in CASTING_WORKER (default
// Sioniquser25) offered as an Inhouse Worker for Casting Process on the
// Material Transaction header? Lists the Sioniquser* workers offered.
test('PROBE casting worker offered', async ({ loginPage, production, page }) => {
  test.setTimeout(240_000);
  const wanted = process.env.CASTING_WORKER || 'Sioniquser25';
  await loginPage.ensureLoggedIn();
  await production.openMaterialTabAdd('Issue');
  await production.pick('employeeID', 'Asmi', { search: true });
  await production.pick('departmentProcessID', 'Casting Process', { search: true });
  await production.pick('departmentSubProcessID', 'Casting Inspection', { search: true }).catch(() => {});
  await production.pick('masterDataValueID_ProductionWorkerType', 'Inhouse Worker', { exact: true });
  const host = page.locator('sioniq-ng-select[controlname="vendorID"] ng-select').first();
  await production.closeStalePanels();
  await host.locator('.ng-select-container').click();
  const input = host.locator('input[type="text"], input[role="combobox"]').first();
  // the panel is virtual-scrolled (first ~12 options rendered), so filter
  // narrowly: the 2x range, then the exact name
  for (const term of ['Sioniquser2', wanted]) {
    await input.fill(term);
    await page.waitForTimeout(1200);
    const offered = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).filter(Boolean);
    console.log(`"${term}" -> offered for Casting: ${JSON.stringify(offered)}`);
  }
  const exact = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`${wanted} offered: ${exact.some((o) => o.toLowerCase() === wanted.toLowerCase())}`);
  await page.keyboard.press('Escape');
});
