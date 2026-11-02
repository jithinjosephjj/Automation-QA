const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const sessionCache = require('../../utils/session-cache');

// PROBE: how does the retail Invoice sell a RESERVED tag? Lists the Invoice Source
// options, picks the reserve / estimation one (SOURCE env overrides), shows what the
// form then asks for (estimation number box / select), fetches the chain's reserve
// estimation, and opens the payment dialog's Advance panel with Advance Type Reserve.
// Reads e2e-retail-reserve-state.json. Nothing is submitted unless SAVE=1.
//   npx playwright test tests/probe/invoice-reserve-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE invoice for a reserved tag', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(400_000);
  const state = makeState(process.env.STATE || 'e2e-retail-reserve-state.json');
  const { tagNo, estimationNo, advanceNo } = state.readState();
  const customer = process.env.CUSTOMER || 'Aneesh Maradu';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = retailInvoice;
  const log = [];
  page.on('response', async (r) => { if (/Invoice|Estimation|Reserve|Advance/i.test(r.url()) && !/KeepAlive|Translation|CustomersPaginated/i.test(r.url())) log.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-2).join('/').split('?')[0]} req=${(r.request().postData() || r.url().split('?')[1] || '').slice(0, 200)} -> ${JSON.stringify(await r.json().catch(() => null)).slice(0, 300)}`); });

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return {
        dialog: !!root,
        text: (root || document.querySelector('form') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 1800),
        selects: [...scope.querySelectorAll('ng-select, select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : (n.value || '')}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        rows: [...scope.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).slice(0, 8),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  const options = async (controlname) => {
    await pg.select(controlname).click({ timeout: 10_000 });
    await pg.settle(1_000);
    const o = (await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.trim());
    await page.keyboard.press('Escape');
    await pg.settle(400);
    console.log(`${controlname} options: ${JSON.stringify(o)}`);
    return o;
  };

  await pg.open();
  await pg.openAddForm();
  await pg.pick('customerID', customer, { search: true });
  await pg.settle(2_000);
  await dump('AFTER CUSTOMER');
  const sources = await options('masterDataValueID_InvoiceSource');
  const want = process.env.SOURCE || sources.find((s) => /reserv/i.test(s)) || sources.find((s) => /estimat/i.test(s));
  console.log(`-> picking Invoice Source "${want}"`);
  if (want) {
    await pg.pick('masterDataValueID_InvoiceSource', want, { exact: true });
    await pg.waitForIdle();
    await pg.settle(2_500);
  }
  await dump('AFTER INVOICE SOURCE');
  // list the options of every other visible select that is still empty
  const names = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent && !n.querySelector('.ng-value')).map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname')));
  console.log(`empty selects: ${JSON.stringify(names)}`);
  for (const n of names.filter((x) => !/mobile|dial|country/i.test(x)).slice(0, 6)) await options(n).catch((e) => console.log(`${n}: ${e.message.slice(0, 80)}`));

  // an estimation number box / select?
  const estInput = page.locator('input[formcontrolname*="stimation" i], [controlname*="stimation" i] input, input[placeholder*="stimation" i], input[placeholder*="Reserve" i]').locator('visible=true').first();
  if (await estInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    console.log(`estimation box placeholder "${await estInput.getAttribute('placeholder')}" -> ${estimationNo}`);
    await estInput.fill(String(estimationNo));
    await estInput.press('Enter');
    await estInput.blur();
    const fetch = page.getByRole('button', { name: /Fetch/ }).locator('visible=true').last();
    if (await fetch.isVisible({ timeout: 2_000 }).catch(() => false)) await fetch.click();
    await pg.waitForIdle();
    await pg.settle(3_000);
    await dump('AFTER ESTIMATION FETCH');
  } else {
    const estSel = names.find((n) => /stimation|reserve/i.test(n));
    if (estSel) { await pg.pick(estSel, String(estimationNo), { search: true }).catch((e) => console.log('estimation pick failed', e.message)); await pg.waitForIdle(); await pg.settle(3_000); await dump('AFTER ESTIMATION PICK'); }
    else if (process.env.SCAN) {
      await pg.pickSalesExecutive('Chandu').catch(() => {});
      await pg.scanTag(tagNo, {}).catch((e) => console.log('scan failed', e.message.slice(0, 300)));
      await dump('AFTER SCAN');
    }
  }
  await page.screenshot({ path: 'test-results/screens/probe-invoice-reserve-form.png', fullPage: true }).catch(() => {});

  const proceed = page.getByRole('button', { name: /Proceed To Payment/i }).locator('visible=true').last();
  if (process.env.PAY && (await proceed.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await proceed.click({ timeout: 15_000 });
    await pg.waitForIdle();
    await pg.settle(3_000);
    const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
    await dump('PAYMENT DIALOG');
    const adv = dlg.locator('button').filter({ hasText: /Advance/i }).locator('visible=true').first();
    if (await adv.count()) {
      await adv.click(); await pg.settle(1_500);
      const typeSel = dlg.locator('sioniq-ng-select[controlname="advanceTypeId"] ng-select, ng-select[formcontrolname="advanceTypeId"]').locator('visible=true').first();
      await typeSel.click(); await pg.settle(800);
      const advType = process.env.ADV_TYPE || 'Reserve';
      await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(`^\\s*${advType}\\s*$`) }).first().click();
      await pg.settle(1_500);
      await dump('ADVANCE PANEL (Reserve)');
      const ref = dlg.locator('input[formcontrolname="referenceNumber"], [controlname="referenceNumber"] input').locator('visible=true').first();
      if (await ref.count()) { await ref.fill(String(advanceNo)); await ref.press('Enter'); await ref.blur(); await pg.waitForIdle(); await pg.settle(3_000); await dump('AFTER RESERVE REFERENCE'); }
    }
  }
  console.log('responses', JSON.stringify(log, null, 1));
  console.log('alerts', JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
