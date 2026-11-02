const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const sessionCache = require('../../utils/session-cache');

// PROBE: retail Invoice with Sales Type "Order" - which fields appear (order
// number select?), whether the chain's registered order (advance receipt) is
// listed, and what picking it stages. Reads e2e-retail-order-estimation-state.json.
// Nothing is submitted unless SAVE=1.
//   npx playwright test tests/probe/invoice-order-salestype-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE invoice with Sales Type Order', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(400_000);
  const state = makeState(process.env.STATE || 'e2e-retail-order-estimation-state.json');
  const { estimationNo, advanceNo } = state.readState();
  const customer = process.env.CUSTOMER || 'Aneesh Maradu';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = retailInvoice;
  const log = [];
  page.on('response', async (r) => {
    if (/RateFixAdvancesPaginated/i.test(r.url())) {
      const b = await r.json().catch(() => null);
      const rows = ((b && b.data) || []).map((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => !/ID$/i.test(k) && (typeof v !== 'string' || v.length < 40))));
      log.push(`RateFixAdvances total ${b && b.totalRecords}: ${JSON.stringify(rows, null, 0)}`);
      return;
    }
    if (/Invoice|Order|Estimation|Advance/i.test(r.url()) && !/KeepAlive|Translation|CustomersPaginated|GetAllSalesInvoice|view-sales|Dropdown|MasterData/i.test(r.url())) log.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-2).join('/').split('?')[0]} req=${(r.request().postData() || r.url().split('?')[1] || '').slice(0, 300)} -> ${JSON.stringify(await r.json().catch(() => null)).slice(0, 500)}`);
  });

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        dialog: !!root,
        text: (root || document.querySelector('form') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 1800),
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        rows: [...scope.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 8),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  const optionsOf = async (controlname, typed) => {
    const sel = pg.select(controlname);
    await sel.click({ timeout: 10_000 }); await pg.settle(800);
    if (typed) { await sel.locator('input[role="combobox"], input[type="text"]').first().type(typed, { delay: 50 }); await pg.waitForIdle(); await pg.settle(2_500); }
    else await pg.settle(2_000);
    const o = (await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    console.log(`${controlname}${typed ? ` search "${typed}"` : ''} options: ${JSON.stringify(o.slice(0, 12))}`);
    return o;
  };

  await pg.open();
  await pg.openAddForm();
  await pg.pick('customerID', customer, { search: true });
  await pg.settle(2_000);
  await pg.pick('masterDataValueID_InvoiceSalesType', 'Order', { exact: true });
  await pg.waitForIdle();
  await pg.settle(2_500);
  const before = await dump('AFTER SALES TYPE ORDER');
  // Order Type first - the Receipt No lookup (GetSalesInvoiceRateFixAdvancesPaginated) answers "Order Type is Required." otherwise
  await pg.pick('advanceTypeID', process.env.ORDER_TYPE || 'Order', { exact: true });
  await pg.waitForIdle(); await pg.settle(2_000);
  const known = new Set(['mobileNumber', 'customerID', 'masterDataValueID_InvoiceType', 'masterDataValueID_BusinessType', 'masterDataValueID_InvoiceMakingType', 'masterDataValueID_InvoiceSource', 'masterDataValueID_InvoiceLineType', 'masterDataValueID_InvoiceSalesType', 'salesExecutiveCode', 'masterDataValueID_ScanType', 'supervisorID', 'helperID', 'advanceTypeID']);
  const fresh = before.selects.map((s) => s.split('=')[0]).filter((n) => !known.has(n));
  console.log(`new selects with Sales Type Order: ${JSON.stringify(fresh)}`);
  for (const n of fresh) {
    const o = await optionsOf(n);
    await page.keyboard.press('Escape'); await pg.settle(300);
    if (o.length === 1 && /Type to search|No items/i.test(o[0])) {
      for (const c of [String(advanceNo), String(estimationNo)]) {
        const oo = await optionsOf(n, c);
        const hit = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: c }).first();
        if (await hit.isVisible().catch(() => false)) { await hit.click(); console.log(`picked ${c} in ${n}`); break; }
        await page.keyboard.press('Escape'); await pg.settle(300);
        await pg.select(n).click(); await pg.settle(300);
        await pg.select(n).locator('input[role="combobox"], input[type="text"]').first().fill('');
        await page.keyboard.press('Escape'); await pg.settle(300);
      }
    } else {
      const hit = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(`${advanceNo}|${estimationNo}`) }).first();
      await pg.select(n).click(); await pg.settle(800);
      if (await hit.isVisible().catch(() => false)) { await hit.click(); console.log(`picked order in ${n}`); } else await page.keyboard.press('Escape');
    }
    await pg.waitForIdle(); await pg.settle(2_500);
  }
  await dump('AFTER ORDER PICK');
  // Invoice Source options under Sales Type Order
  await optionsOf('masterDataValueID_InvoiceSource').catch(() => {});
  await page.keyboard.press('Escape');
  // any order-related button?
  for (const name of [/Add Order/i, /Fetch/i, /Add Estimation/i]) {
    const b = page.getByRole('button', { name }).locator('visible=true').last();
    if (await b.isVisible({ timeout: 1_000 }).catch(() => false)) { console.log(`button ${name} visible -> clicking`); await b.click(); await pg.waitForIdle(); await pg.settle(3_000); await dump(`AFTER ${name}`); }
  }
  // TAG=... : scan a stock tag against the order and open the payment dialog (PAY=1); SAVE=1 submits
  if (process.env.TAG) {
    await pg.pickSalesExecutive('Chandu').catch(() => {});
    await pg.scanTag(process.env.TAG, {}).catch((e) => console.log('scan failed', e.message.slice(0, 400)));
    await dump('AFTER SCAN');
    if (process.env.PAY) {
      await page.getByRole('button', { name: /Proceed To Payment/i }).locator('visible=true').last().click({ timeout: 15_000 });
      await pg.waitForIdle(); await pg.settle(3_000);
      await dump('PAYMENT DIALOG');
      const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
      const adv = dlg.locator('button').filter({ hasText: /Advance/i }).locator('visible=true').first();
      if (await adv.count()) {
        await adv.click(); await pg.settle(1_500);
        const typeSel = dlg.locator('sioniq-ng-select[controlname="advanceTypeId"] ng-select, ng-select[formcontrolname="advanceTypeId"]').locator('visible=true').first();
        if (await typeSel.count()) { await typeSel.click(); await pg.settle(800); await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /^\s*Order\s*$/ }).first().click(); await pg.settle(1_500); }
        const ref = dlg.locator('input[formcontrolname="referenceNumber"], [controlname="referenceNumber"] input').locator('visible=true').first();
        if (await ref.count()) { await ref.fill(String(advanceNo)); await ref.press('Enter'); await ref.blur(); await pg.waitForIdle(); await pg.settle(3_000); }
        await dump('ADVANCE PANEL (Order)');
      }
    }
  }
  await page.screenshot({ path: 'test-results/screens/probe-invoice-order-salestype.png', fullPage: true }).catch(() => {});
  console.log('responses', JSON.stringify(log, null, 1));
  console.log('alerts', JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
