const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE (read-only, nothing saved): the CHANGED sales return flow at Kakkanad
// (user 14-11-2026: "sales return estimation and sales return registration is
// a separate flow ... direct from sales return estimation").
//   1. Sales Return Estimation Add form: Business Type, bill search of an OPEN
//      bill (BILL env, default 86 of Aneesh Maradu), Add Item -> what the form
//      then offers (buttons / steps / toggles - a direct registration?).
//   2. Sales Return Registration Add form: Entry Mode options, what "Direct"
//      reveals, what "Estimation" reveals.
//   BILL=86 npx playwright test tests/probe/sales-return-flow-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE changed sales return flow', async ({ loginPage, salesReturn, page }) => {
  test.setTimeout(600_000);
  const bill = process.env.BILL || '86';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = salesReturn;

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, .form-check, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      const main = document.querySelector('.page-content, main') || document.body;
      const dlg = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas, .swal2-popup')].filter(vis).pop();
      return {
        url: location.pathname,
        dialog: dlg ? dlg.innerText.replace(/\s+/g, ' ').slice(0, 1200) : '',
        text: main.innerText.replace(/\s+/g, ' ').slice(0, 3000),
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.id || '-'}|${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        checkboxes: [...document.querySelectorAll('input[type=checkbox], input[type=radio], [role=switch]')].filter(vis).map((c) => `${c.id || c.getAttribute('formcontrolname') || '-'}[${labelOf(c)}]=${c.checked}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => `${b.textContent.replace(/\s+/g, ' ').trim()}${b.disabled ? '(disabled)' : ''}`).filter((t) => t && t !== '(disabled)').slice(0, 50),
        tables: [...document.querySelectorAll('table')].filter(vis).map((t) => ({ head: [...t.querySelectorAll('th')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).join('|'), rows: [...t.querySelectorAll('tbody tr')].slice(0, 4).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)) })),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  const openSel = async (name) => {
    await pg.closeStalePanels();
    await pg.select(name).locator('.ng-select-container').click({ timeout: 10_000 });
    await pg.settle(1_500);
    const o = await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => []);
    console.log(`${name} options: ${JSON.stringify(o.slice(0, 20))}`);
    await page.keyboard.press('Escape');
    await pg.settle(500);
    return o;
  };
  const calls = [];
  page.on('response', async (r) => {
    if (['POST', 'GET'].includes(r.request().method()) && /sioniq\/.*(SalesReturn|Return)/i.test(r.url()) && !/KeepAlive|Translation|GetAll\w*Pagination/i.test(r.url())) {
      const b = await r.text().catch(() => '');
      calls.push(`${r.status()} ${r.request().method()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} req:${(r.request().postData() || '').slice(0, 250)} res:${b.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  });

  // 1. Sales Return Estimation
  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForSpinner();
  await pg.settle(2_000);
  await page.getByRole('tab', { name: /^\s*Sales Return Estimation\s*$/ }).locator('visible=true').first().click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(2_500);
  await dump('SRE LIST');
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await pg.select('masterDataValueID_RetailSalesReturnType').waitFor({ state: 'visible', timeout: 15_000 });
  await pg.settle(2_000);
  const form = await dump('SRE FORM');
  for (const n of form.selects.map((s) => s.split('[')[0])) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
  await pg.pickUnlessSet('masterDataValueID_BusinessType', 'Retail');
  await pg.settle(1_500);
  await pg.pick('salesmanID', 'AJ10', { search: true, exact: true }).catch((e) => console.log('salesman pick failed ' + e.message.split('\n')[0]));
  await pg.pick('helperID', 'Chandu', { search: true }).catch(() => {});
  await pg.settle(1_000);
  await dump('SRE AFTER CONFIG');
  const box = page.locator('input#receiptItemNo').locator('visible=true').first();
  await box.fill(bill);
  await box.press('Enter');
  await pg.waitForIdle();
  await pg.settle(3_000);
  await dump(`SRE AFTER BILL ${bill} SEARCH`);
  await page.screenshot({ path: 'test-results/screens/probe-sre-after-search.png', fullPage: true }).catch(() => {});
  const addItem = page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
  if (await addItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await addItem.click({ timeout: 15_000 });
    await pg.waitForIdle();
    await pg.settle(3_000);
    await dump('SRE AFTER ADD ITEM');
    await page.screenshot({ path: 'test-results/screens/probe-sre-after-add.png', fullPage: true }).catch(() => {});
    // any post-add toggles / buttons that lead on (registration / refund / payment)?
    const lead = page.locator('button, a').filter({ hasText: /Regist|Refund|Payment|Proceed|Next|Direct/i }).locator('visible=true');
    console.log(`SRE lead-on controls: ${JSON.stringify(await lead.allInnerTexts().catch(() => []))}`);
  } else console.log('SRE: no Add Item button after the search');
  if (process.env.SAVE === '1') {
    await page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: 15_000 });
    await page.waitForTimeout(8_000);
    await dump('SRE AFTER SUBMIT');
    await page.screenshot({ path: 'test-results/screens/probe-sre-after-submit.png', fullPage: true }).catch(() => {});
  }

  // 2. Sales Return Registration: Entry Mode Direct vs Estimation
  await pg.goto('/pos/view-sales-return-registration');
  await pg.waitForSpinner();
  await pg.settle(2_500);
  await dump('SRR LIST');
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await pg.select('entryMode').waitFor({ state: 'visible', timeout: 15_000 });
  await pg.settle(2_000);
  const srr = await dump('SRR FORM');
  for (const n of srr.selects.map((s) => s.split('[')[0])) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
  for (const mode of ['Direct', 'Estimation']) {
    await pg.pick('entryMode', mode, { exact: true }).catch((e) => console.log(`entryMode ${mode} pick failed ${e.message.split('\n')[0]}`));
    await pg.waitForIdle();
    await pg.settle(2_500);
    const d = await dump(`SRR ENTRY MODE ${mode}`);
    for (const n of d.selects.map((s) => s.split('[')[0]).filter((n) => n !== 'entryMode')) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
    await page.screenshot({ path: `test-results/screens/probe-srr-${mode.toLowerCase()}.png`, fullPage: true }).catch(() => {});
    if (mode === 'Direct') {
      const b = page.locator('input[id*="bill" i], input[id*="receipt" i], input[placeholder*="bill" i], input[placeholder*="receipt" i], input[placeholder*="scan" i]').locator('visible=true').first();
      if (await b.count()) { console.log(`Direct bill input ${await b.getAttribute('id')}|${await b.getAttribute('placeholder')}`); await b.fill(bill); await b.press('Enter'); await pg.waitForIdle(); await pg.settle(3_000); await dump(`SRR DIRECT AFTER BILL ${bill}`); }
    }
  }
  console.log('calls ' + JSON.stringify(calls, null, 1));
});
