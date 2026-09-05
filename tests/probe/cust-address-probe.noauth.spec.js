const { test, expect } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe of the Customer Registration Identity-step address block:
 * dump each address ng-select's options, then type 'HYD' into the zip/city
 * search and report what cascades. Saves NOTHING.
 */
test.describe('Customer address probe (read-only)', () => {
  test('inspect the address cascade', async ({ loginPage, customerRegistration: cr, page }) => {
    test.setTimeout(420_000);
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    await cr.open();
    await cr.openAddForm();

    const dumpVals = async (tag) => {
      const vals = await page.evaluate(() => {
        const vis = (el) => !!(el && el.offsetParent);
        const out = {};
        ['zipCode', 'area', 'city', 'district', 'state', 'country'].forEach((cn) => {
          const w = document.querySelector(`sioniq-ng-select[controlname="${cn}"]`);
          const v = w && w.querySelector('.ng-value');
          out[cn] = { present: !!w && vis(w), value: v ? v.textContent.trim() : '' };
        });
        return out;
      });
      console.log(`ADDRESS ${tag}:`, JSON.stringify(vals));
    };
    await dumpVals('initial');

    // dump options offered by each address select (open, read, escape)
    for (const cn of ['country', 'state', 'district', 'city', 'zipCode', 'area']) {
      const sel = page.locator(`sioniq-ng-select[controlname="${cn}"] ng-select`);
      if (!(await sel.isVisible().catch(() => false))) { console.log(`${cn}: not visible`); continue; }
      await sel.locator('.ng-select-container').click();
      await page.waitForTimeout(1_200);
      const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((s) => s.trim()).slice(0, 8);
      console.log(`${cn} options:`, JSON.stringify(opts));
      // type HYD to see server suggestions
      await sel.locator('input[role="combobox"]').fill('HYD').catch(() => {});
      await page.waitForTimeout(2_000);
      const hyd = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((s) => s.trim()).slice(0, 8);
      console.log(`${cn} search "HYD":`, JSON.stringify(hyd));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: 'test-results/screens/cust-address.png', fullPage: true });
  });
});
