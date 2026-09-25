const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing): the Material Transaction Issue / Receipt
 * forms with Stock Entity Type = "Material" (QA lead, 25-09-2026) - dumps the
 * entity / identity type options, the grid, and the dialog the grid's Add
 * opens, then leaves without Submit.
 */
const WORKER = process.env.CASTING_WORKER || 'Sioniquser34';

async function optionsOf(page, production, controlname) {
  const sel = production.select(controlname);
  if (!(await sel.count())) return null;
  await sel.locator('.ng-select-container').first().click();
  await page.waitForTimeout(1_500);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return opts;
}

const IDENTITY = process.env.IDENTITY || 'Stock';
for (const tab of ['Issue', 'Receipt']) {
  test(`probe material ${tab} with Stock Entity Type = Material / ${IDENTITY}`, async ({ loginPage, production, page }) => {
    test.setTimeout(300_000);
    await loginPage.ensureLoggedIn();
    await production.openMaterialTabAdd(tab);
    await production.pick('employeeID', 'Asmi', { search: true });
    await production.pick('departmentProcessID', 'Casting Process', { search: true });
    await production.pick('departmentSubProcessID', 'Casting Inspection', { search: true }).catch(() => {});
    await production.pick('masterDataValueID_ProductionWorkerType', 'Inhouse Worker', { exact: true });
    await production.pick('vendorID', WORKER, { search: true });
    console.log(`${tab}: Stock Entity Type options = ${JSON.stringify(await optionsOf(page, production, 'masterDataValueID_StockEntityType'))}`);
    await production.pick('masterDataValueID_StockEntityType', 'Material', { exact: true });
    await production.waitForIdle();
    await page.waitForTimeout(2_500);
    console.log(`${tab}: Stock Identity Type options = ${JSON.stringify(await optionsOf(page, production, 'masterDataValueID_StockIdentityType'))}`);
    await production.pick('masterDataValueID_StockIdentityType', IDENTITY, { exact: true });
    await production.waitForIdle();
    await page.waitForTimeout(3_000);
    const controls = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent)
      .map((n) => `${n.getAttribute('controlname')}=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.querySelector('ng-select')?.classList.contains('ng-invalid') ? '(invalid)' : ''}`));
    console.log(`${tab}: selects = ${JSON.stringify(controls)}`);
    await production.describeMaterialGrid(`${tab} grid (Material)`);
    await page.screenshot({ path: `test-results/probe-material-${tab.toLowerCase()}.png`, fullPage: true });

    // the grid's first selectable row -> Add -> dump the dialog, then close it
    const row = page.locator('tbody tr').locator('visible=true').filter({ has: page.locator('input[type="checkbox"]:not([disabled])') });
    const rows = (await row.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
    console.log(`${tab}: ${rows.length} selectable rows ${JSON.stringify(rows.slice(0, 15))}`);
    if (!rows.length) return;
    await row.first().locator('input[type="checkbox"]:not([disabled])').first().check({ force: true }).catch(() => {});
    await page.waitForTimeout(1_500);
    const add = page.locator('button').filter({ hasText: /^\s*\+?\s*Add(\s+\d+|\s+Items?|\s+to\s+\w+)?\s*$/i }).locator('visible=true').last();
    if (!(await add.isVisible({ timeout: 2_000 }).catch(() => false))) { console.log(`${tab}: no grid Add button`); return; }
    await add.click();
    await page.waitForTimeout(2_500);
    const dlg = page.locator('.modal, ngb-modal-window, [role="dialog"], .offcanvas').locator('visible=true').last();
    if (!(await dlg.count())) { console.log(`${tab}: Add opened no dialog`); return; }
    const info = await dlg.evaluate((d) => ({
      title: (d.querySelector('h4, h5, .modal-title, .offcanvas-title')?.textContent || '').trim(),
      text: d.innerText.replace(/\s+/g, ' ').slice(0, 1500),
      selects: [...d.querySelectorAll('ng-select')].filter((n) => n.offsetParent).map((n) => `${n.closest('[controlname]')?.getAttribute('controlname') || '?'}=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.classList.contains('ng-invalid') ? '(invalid)' : ''}`),
      inputs: [...d.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter((i) => i.offsetParent).map((i) => `${i.id || i.getAttribute('formcontrolname') || i.placeholder}=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}`),
    }));
    console.log(`${tab}: dialog ${JSON.stringify(info)}`);
    await page.screenshot({ path: `test-results/probe-material-${tab.toLowerCase()}-dialog.png`, fullPage: true });
  });
}
