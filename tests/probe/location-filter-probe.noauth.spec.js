const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const fs = require('fs');

// PROBE (read-only): the inward and lot pages gained a LOCATION filter
// (21-09-2026). Where is it - list toolbar, add form, item panel - what does
// it offer, and what is preselected?
test('PROBE location filter on inward and lot pages', async ({ loginPage, metalInward, lotGeneration, page }) => {
  test.setTimeout(400_000);
  fs.mkdirSync('bug-reports/shots', { recursive: true });
  const inwardNo = makeState('e2e-b2b-order-lot-state.json').readState().inwardVoucherNo || 'M293';
  await loginPage.ensureLoggedIn();

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const selects = [];
      for (const w of [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis)) {
        if (w.matches('ng-select') && w.closest('sioniq-ng-select')) continue; // wrapper already listed
        const host = w.matches('ng-select') ? w : w.querySelector('ng-select');
        if (!host) continue;
        const ctl = w.getAttribute('controlname') || host.getAttribute('formcontrolname') || host.id || '';
        const box = w.closest('div.grid, div.form-group, div.col, div[class*=col-]') || w.parentElement;
        let lbl = box ? (box.querySelector('label')?.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (!lbl) { let p = w.previousSibling; while (p && !(p.textContent || '').trim()) p = p.previousSibling; lbl = (p?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); }
        const val = host.querySelector('.ng-value')?.textContent.replace(/\s+/g, ' ').trim() || '';
        const ph = host.querySelector('.ng-placeholder')?.textContent.trim() || '';
        selects.push(`${lbl || '(no label)'} [${ctl}] = ${val || '<' + ph + '>'}`);
      }
      const natives = [...document.querySelectorAll('select')].filter(vis).map((s) => `${s.id || s.name || 'select'} = ${s.options[s.selectedIndex]?.text} of [${[...s.options].map((o) => o.text).join('|')}]`);
      const locText = [...document.querySelectorAll('label, th, span, div, button')].filter(vis).map((n) => (n.children.length ? '' : n.textContent.trim())).filter((t) => t && t.length < 40 && /location|locker|branch/i.test(t));
      return { selects, natives, locText: [...new Set(locText)] };
    });
    console.log(`\n[${label}] selects:\n  ` + (info.selects.join('\n  ') || '(none)'));
    if (info.natives.length) console.log(`[${label}] native selects: ${JSON.stringify(info.natives)}`);
    console.log(`[${label}] location-like text: ${JSON.stringify(info.locText)}`);
  };
  const optionsOf = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    if (!(await host.count())) return;
    await host.locator('.ng-select-container').click();
    await page.waitForTimeout(800);
    console.log(`  options ${ctl}: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()))}`);
    await page.keyboard.press('Escape');
  };

  // ---- Metal Inward: list toolbar + column headers, then add form step 1 ----
  await metalInward.open();
  await metalInward.settle(2_000);
  const headers = (await page.getByRole('columnheader').allTextContents()).map((t) => t.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
  console.log('Metal Inward LIST columns: ' + JSON.stringify(headers));
  await dump('Metal Inward LIST');
  await page.screenshot({ path: 'bug-reports/shots/loc-inward-list.png' });
  await metalInward.openAddWizard();
  await metalInward.settle(2_000);
  await dump('Metal Inward ADD step 1');
  await optionsOf('businessUnit');
  await page.screenshot({ path: 'bug-reports/shots/loc-inward-add.png' });

  // ---- Lot Generation: list, add form through all filters, item panel ----
  await lotGeneration.open();
  await lotGeneration.settle(2_000);
  console.log('Lot LIST columns: ' + JSON.stringify((await page.getByRole('columnheader').allTextContents()).map((t) => t.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean)));
  await dump('Lot Generation LIST');
  await lotGeneration.waitForSpinner();
  await lotGeneration.addBtn.click({ timeout: 60_000 });
  await lotGeneration.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await lotGeneration.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lotGeneration.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await lotGeneration.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await lotGeneration.settle(2_000);
  await dump('Lot ADD after From Transaction Type');
  console.log('Pending grid columns: ' + JSON.stringify((await page.getByRole('columnheader').allTextContents()).map((t) => t.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean)));
  for (const ctl of ['locationID', 'businessUnitFilter', 'stockLocationID', 'fromLocationID', 'lockerID']) await optionsOf(ctl);
  const row = lotGeneration.rowMatcher(inwardNo).first();
  if (await row.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await row.getByRole('checkbox').first().check({ force: true });
    await lotGeneration.settle(3_000);
    await dump('Lot ADD item panel (after ticking the inward)');
    await optionsOf('businessUnitID');
    await optionsOf('employeeID');
  } else console.log(`inward ${inwardNo} not in the pending grid`);
  await page.screenshot({ path: 'bug-reports/shots/loc-lot-add.png', fullPage: true });
});
