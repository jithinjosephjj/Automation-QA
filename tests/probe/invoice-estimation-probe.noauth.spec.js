const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const sessionCache = require('../../utils/session-cache');

// PROBE: retail Invoice with Invoice Source "Estimation" for an ORDER estimation -
// what the estimationID type-to-search sends / lists for the chain's estimation,
// what "Add Estimation" stages, and the payment dialog's Advance panel with
// ADVANCE TYPE Order. Reads e2e-retail-order-estimation-state.json. Nothing is
// submitted unless SAVE=1.
//   PAY=1 npx playwright test tests/probe/invoice-estimation-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE invoice from an order estimation', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(400_000);
  const state = makeState(process.env.STATE || 'e2e-retail-order-estimation-state.json');
  const { estimationNo, advanceNo } = state.readState();
  const customer = process.env.CUSTOMER || 'Aneesh Maradu';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = retailInvoice;
  const log = [];
  page.on('response', async (r) => { if (/Invoice|Estimation|Advance/i.test(r.url()) && !/KeepAlive|Translation|CustomersPaginated|GetAllSalesInvoice|view-sales/i.test(r.url())) log.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-2).join('/').split('?')[0]} req=${(r.request().postData() || r.url().split('?')[1] || '').slice(0, 300)} -> ${JSON.stringify(await r.json().catch(() => null)).slice(0, 400)}`); });

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        dialog: !!root,
        text: (root || document.querySelector('form') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 1500),
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        rows: [...scope.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 8),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };

  await pg.open();
  await pg.openAddForm();
  await pg.pick('customerID', customer, { search: true });
  await pg.settle(2_000);
  await pg.pick('masterDataValueID_InvoiceSource', 'Estimation', { exact: true });
  await pg.waitForIdle();
  await pg.settle(2_500);
  await dump('AFTER SOURCE ESTIMATION');

  // the estimation select: type candidates into its search box and list what comes back
  const est = pg.select('estimationID');
  const search = est.locator('input[role="combobox"], input[type="text"]').first();
  const candidates = [String(estimationNo), String(estimationNo).split(/\s+/).pop(), String(estimationNo).replace(/\D/g, '')];
  let picked = false;
  for (const c of candidates) {
    await est.click();
    await pg.settle(600);
    await search.fill('');
    await search.type(c, { delay: 60 });
    await pg.waitForIdle();
    await pg.settle(2_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    console.log(`estimationID search "${c}" -> ${JSON.stringify(opts.slice(0, 10))}`);
    const hit = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: String(estimationNo) }).first();
    if (await hit.isVisible().catch(() => false)) { await hit.click(); picked = true; break; }
    await page.keyboard.press('Escape');
    await pg.settle(400);
  }
  console.log(`estimation picked: ${picked}`);
  await pg.waitForIdle();
  await pg.settle(2_500);
  await dump('AFTER ESTIMATION PICK');
  const addEst = page.getByRole('button', { name: /Add Estimation/i }).locator('visible=true').last();
  if (picked && (await addEst.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await addEst.click();
    await pg.waitForIdle();
    await pg.settle(3_000);
    await dump('AFTER ADD ESTIMATION');
  }
  await page.screenshot({ path: 'test-results/screens/probe-invoice-estimation-form.png', fullPage: true }).catch(() => {});

  if (process.env.PAY && picked) {
    await page.getByRole('button', { name: /Proceed To Payment/i }).locator('visible=true').last().click({ timeout: 15_000 });
    await pg.waitForIdle();
    await pg.settle(3_000);
    const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
    await dump('PAYMENT DIALOG');
    const adv = dlg.locator('button').filter({ hasText: /Advance/i }).locator('visible=true').first();
    if (await adv.count()) {
      await adv.click(); await pg.settle(1_500);
      const typeSel = dlg.locator('sioniq-ng-select[controlname="advanceTypeId"] ng-select, ng-select[formcontrolname="advanceTypeId"]').locator('visible=true').first();
      if (await typeSel.count()) {
        await typeSel.click(); await pg.settle(800);
        await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /^\s*Order\s*$/ }).first().click();
        await pg.settle(1_500);
      }
      await dump('ADVANCE PANEL (Order)');
      const ref = dlg.locator('input[formcontrolname="referenceNumber"], [controlname="referenceNumber"] input').locator('visible=true').first();
      if (await ref.count()) { await ref.fill(String(advanceNo)); await ref.press('Enter'); await ref.blur(); await pg.waitForIdle(); await pg.settle(3_000); await dump('AFTER ORDER REFERENCE'); }
    }
  }
  console.log('responses', JSON.stringify(log, null, 1));
  console.log('alerts', JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
