const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE: Advance Registration with Advance Type "General" (Business Type Retail)
// at Kakkanad - which fields / buttons the form offers after each pick, what
// "Proceed To Payment" opens, and whether a Submit appears. Nothing is saved
// unless SAVE=1. Run:
//   CUSTOMER="Aneesh Maradu" npx playwright test tests/probe/advance-general-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE advance registration (General / Retail)', async ({ loginPage, advanceRegistration, page }) => {
  test.setTimeout(400_000);
  const customer = process.env.CUSTOMER || 'Aneesh Maradu';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = advanceRegistration;

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return {
        dialog: !!root,
        text: root ? root.innerText.replace(/\s+/g, ' ').slice(0, 1200) : document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500),
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };

  await pg.open();
  await pg.openAddForm();
  await pg.settle(2_000);
  await dump('FORM OPEN');
  await pg.pick('customerID', customer, { search: true });
  await pg.settle(2_000);
  await dump('AFTER CUSTOMER');
  const opts = await pg.optionsOf ? await pg.optionsOf('advanceType').catch(() => null) : null;
  if (opts) console.log('advanceType options', JSON.stringify(opts));
  await pg.pick('advanceType', 'General', { exact: true });
  await pg.settle(2_000);
  await dump('AFTER ADVANCE TYPE GENERAL');
  if (await pg.select('advanceSubType').count()) {
    const cur = await pg.selectValue('advanceSubType').catch(() => '');
    console.log(`advanceSubType currently "${cur}"`);
    if (cur !== 'Registration') await pg.pick('advanceSubType', 'Registration', { exact: true }).catch((e) => console.log('subType pick failed', e.message));
    await pg.settle(1_500);
  }
  const bt = (await pg.selectValue('businessType').catch(() => '')) || '';
  if (!/retail/i.test(bt)) await pg.pick('businessType', 'Retail', { exact: true }).catch((e) => console.log('businessType pick failed', e.message));
  await pg.settle(2_000);
  await dump('AFTER BUSINESS TYPE RETAIL');
  if (await pg.select('orderEntryMode').count()) {
    console.log(`orderEntryMode currently "${await pg.selectValue('orderEntryMode').catch(() => '')}"`);
  }
  // any enabled amount-like input?
  const amt = page.locator('xpath=//label[contains(translate(normalize-space(.),"amount","AMOUNT"),"AMOUNT")]/following::input[not(@type="checkbox")][1]').locator('visible=true');
  console.log(`amount inputs: ${await amt.count()}`);
  for (let i = 0; i < (await amt.count()); i++) console.log(`  amount[${i}] placeholder="${await amt.nth(i).getAttribute('placeholder')}" id="${await amt.nth(i).getAttribute('id')}" disabled=${await amt.nth(i).isDisabled()} value="${await amt.nth(i).inputValue()}"`);
  if (process.env.AMOUNT) {
    const a = amt.locator('visible=true').first();
    if ((await a.count()) && !(await a.isDisabled())) { await a.fill(process.env.AMOUNT); await a.blur(); await pg.settle(1_500); await dump('AFTER AMOUNT'); }
  }
  await page.screenshot({ path: 'test-results/screens/probe-advance-general-form.png', fullPage: true }).catch(() => {});

  // Advance Details block (General): Sales Executive, Supervisor, Advance Amount
  if (await pg.select('salesExecutiveID').count()) {
    const openSel = async (name) => { await pg.select(name).click(); await pg.settle(1_000); const o = await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => []); console.log(`${name} options: ${JSON.stringify(o.slice(0, 15))}`); await page.keyboard.press('Escape'); await pg.settle(500); return o; };
    await openSel('salesExecutiveID');
    await pg.pick('salesExecutiveID', process.env.SALES || 'Chandu', { search: true });
    await pg.settle(1_500);
    const sup = await openSel('supervisorID');
    if (process.env.NOSUP) console.log('supervisor left empty (NOSUP)');
    else if (sup.length && !/No items/i.test(sup[0])) await pg.pick('supervisorID', process.env.SUPERVISOR || sup[0].trim(), { search: true }).catch((e) => console.log('supervisor pick failed', e.message));
    await pg.settle(1_000);
    const adv = page.locator('input#advanceAmount').locator('visible=true').first();
    await adv.fill(process.env.AMOUNT || '5000');
    await adv.blur();
    await page.locator('input[formcontrolname="description"], [controlname="description"] input, input[placeholder="Remarks"]').locator('visible=true').first().fill('E2E general advance probe').catch(() => {});
    await pg.settle(1_500);
    await dump('AFTER ADVANCE DETAILS');
    // once the amount is in, the footer is Proceed to Payment / Previous / Submit (no Next)
    const next = page.getByRole('button', { name: /^Next$/ }).locator('visible=true').last();
    if (await next.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await next.click({ timeout: 15_000 });
      await pg.waitForIdle();
      await pg.settle(3_000);
      await dump('AFTER NEXT (step 2)');
    }
  }

  const proceed =page.getByRole('button', { name: /Proceed to Payment/i }).locator('visible=true').last();
  const saves = [];
  page.on('response', async (r) => { if (['POST', 'PUT'].includes(r.request().method()) && /Advance|Registration|Order/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation/i.test(r.url())) saves.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 300)}`); });
  if (await proceed.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await proceed.click({ timeout: 15_000 });
    await page.waitForTimeout(5_000);
    await dump('AFTER PROCEED TO PAYMENT');
    await page.screenshot({ path: 'test-results/screens/probe-advance-general-payment.png', fullPage: true }).catch(() => {});
    if (process.env.PAY) {
      const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
      await dlg.getByRole('button', { name: /^Close$/i }).locator('visible=true').last().click({ timeout: 5_000 }).catch(() => {});
      await pg.settle(1_000);
      const paid = await pg.collectPayment({ mode: 'Cash', amount: Number(process.env.PAY), what: 'probe' });
      console.log('paid', paid);
      await dump('AFTER PAYMENT');
    }
  } else {
    console.log('no Proceed to Payment button');
  }
  if (process.env.SAVE === '1') {
    await page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: 15_000 });
    await page.waitForTimeout(8_000);
    await dump('AFTER SUBMIT');
  }
  console.log('responses', JSON.stringify(saves, null, 1));
  console.log('alerts', JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
