const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing) for the stone logistics chain (QA lead
 * 26-09-2026: Logistics Inward Stone -> Goods Receipt Stone -> Stone Inward
 * -> ... -> B2B sales invoice). Dumps the controls each screen shows once
 * the material type is Stone, and the invoice screen's tabs / selects.
 */
async function dump(page, label) {
  const info = await page.evaluate(() => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside, app-sidebar');
    const labelOf = (n) => {
      let el = n;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        const l = el && el.querySelector(':scope > label, :scope > .form-label, :scope > span');
        if (l && l.textContent.trim()) return l.textContent.trim().slice(0, 40);
      }
      return '';
    };
    return {
      selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => {
        const w = n.closest('sioniq-ng-select, [controlname], [formcontrolname]') || n;
        return `"${labelOf(n)}" [${w.getAttribute('controlname') || w.getAttribute('formcontrolname') || n.getAttribute('formcontrolname') || ''}]=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.classList.contains('ng-invalid') ? ' (invalid)' : ''}${n.classList.contains('ng-select-disabled') ? ' (disabled)' : ''}`;
      }),
      inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=file]), textarea')].filter(vis).filter((i) => !i.closest('ng-select'))
        .map((i) => `"${labelOf(i)}" fcn=${i.getAttribute('formcontrolname') || ''} id=${i.id || ''}=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? ' (invalid)' : ''}`).slice(0, 45),
      tabs: [...document.querySelectorAll('[role=tab], .nav-link')].filter(vis).map((t) => t.textContent.trim()).filter(Boolean).slice(0, 20),
    };
  });
  console.log(`===== ${label}\nTABS ${JSON.stringify(info.tabs)}\n${info.selects.join('\n')}\n${info.inputs.join('\n')}`);
}

async function options(page, logisticsSales, controlname) {
  const host = logisticsSales.select(controlname);
  if (!(await host.count())) return null;
  await host.locator('.ng-select-container').click().catch(() => {});
  await page.waitForTimeout(1_200);
  const o = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  return o;
}

test('probe stone logistics inward form', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await logisticsSales.goto('/prc/view-logistics');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  console.log(`materialType options: ${JSON.stringify(await options(page, logisticsSales, 'materialType'))}`);
  await logisticsSales.pick('materialType', 'Stone', { exact: true });
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  await dump(page, 'logistics inward, material Stone');
});

test('probe stone goods receipt form', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await logisticsSales.goto('/prc/view-goods-receipt');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('vendor', 'RAJA');
  await logisticsSales.pick('generationType', 'Direct', { exact: true }).catch(() => {});
  console.log(`materialtype options: ${JSON.stringify(await options(page, logisticsSales, 'materialtype'))}`);
  await logisticsSales.pick('materialtype', 'Stone', { exact: true });
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  await dump(page, 'goods receipt (Direct), material Stone');
});

test('probe stone inward with purchase type goods receipt', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await stoneInward.open();
  await stoneInward.openAddWizard();
  await stoneInward.pick('inwardType', 'Stock');
  const pt = await (async () => { const h = stoneInward.select('purchaseType'); await h.locator('.ng-select-container').click(); await page.waitForTimeout(1_000); const o = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()); await page.keyboard.press('Escape'); return o; })();
  console.log(`purchaseType options: ${JSON.stringify(pt)}`);
  await stoneInward.pick('purchaseType', 'Goods Receipt').catch((e) => console.log(`no Goods Receipt purchase type: ${String(e).split('\n')[0]}`));
  await stoneInward.pick('vendor', 'RAJA');
  await stoneInward.settle(2_000);
  await dump(page, 'stone inward step 1 (Goods Receipt)');
});

test('probe invoice screen tabs', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(4_000);
  await dump(page, 'invoice setup list');
  await logisticsSales.clickVisibleAdd().catch(() => {});
  await logisticsSales.settle(2_000);
  await dump(page, 'invoice add form');
  for (const ctl of ['transactionSubTypeID', 'masterDataValueID_StockSourceFrom', 'masterDataValueID_InvoiceIssueType', 'masterDataValueID_ScanType', 'itemType', 'masterDataValueID_JewelleryItemType']) {
    const o = await options(page, logisticsSales, ctl);
    if (o) console.log(`${ctl} options: ${JSON.stringify(o)}`);
  }
});

test('probe stone category cascade + invoice "Invoice" tab', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn();
  await logisticsSales.goto('/prc/view-logistics');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('materialType', 'Stone', { exact: true });
  await logisticsSales.settle(2_000);
  for (const ctl of ['stonegroup', 'stonecategory', 'stonesubcategory']) {
    const o = await options(page, logisticsSales, ctl);
    console.log(`${ctl} options: ${JSON.stringify(o)}`);
    const want = (o || []).find((x) => /jerald|emerald|precious|stone/i.test(x)) || (o || [])[0];
    if (want) await logisticsSales.pick(ctl, want, { exact: true }).catch(() => {});
    await logisticsSales.settle(1_500);
  }
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await page.getByRole('tab', { name: 'Invoice', exact: true }).click();
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  await logisticsSales.clickVisibleAdd().catch(() => {});
  await logisticsSales.settle(2_500);
  await dump(page, 'invoice tab "Invoice" add form');
  for (const ctl of ['transactionSubTypeID', 'masterDataValueID_JewelleryItemType', 'itemType', 'masterDataValueID_StockSourceFrom', 'masterDataValueID_InvoiceIssueType', 'masterDataValueID_ScanType']) {
    const o = await options(page, logisticsSales, ctl);
    if (o) console.log(`Invoice tab ${ctl} options: ${JSON.stringify(o)}`);
  }
  await page.screenshot({ path: 'test-results/probe-invoice-tab.png', fullPage: true });
});
