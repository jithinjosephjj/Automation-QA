const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE: the two sales-return screens of Retail Operations > Operations at
// Kakkanad - the "Sales Return Estimation" tab of Estimations and the "Sales
// Return Registration" page: list, Add form, every select's options, what the
// invoice number (BILL env, default 45 of SioniqCustomertwentyseven) reveals.
// Nothing is saved.
//   BILL=45 CUSTOMER=SioniqCustomertwentyseven MOBILE=9613207185 npx playwright test tests/probe/sales-return-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE sales return estimation + registration', async ({ loginPage, estimationSalesType, page }) => {
  test.setTimeout(600_000);
  const bill = process.env.BILL || '45';
  const customer = process.env.CUSTOMER || 'SioniqCustomertwentyseven';
  const mobile = process.env.MOBILE || '9613207185';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = estimationSalesType;

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      const main = document.querySelector('.page-content, main') || document.body;
      return {
        url: location.pathname,
        text: main.innerText.replace(/\s+/g, ' ').slice(0, 2500),
        tabs: [...document.querySelectorAll('[role=tab], .nav-link')].filter(vis).map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.id || '-'}|${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        checkboxes: [...document.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(vis).map((c) => `${c.id || c.getAttribute('formcontrolname') || '-'}[${labelOf(c)}]=${c.checked}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
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
    if (['POST', 'GET'].includes(r.request().method()) && /sioniq\/.*(Return|Estimation|Invoice|Bill)/i.test(r.url()) && !/KeepAlive|Translation|Customers|GetAll\w*Pagination/i.test(r.url())) {
      const b = await r.text().catch(() => '');
      calls.push(`${r.status()} ${r.request().method()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} req:${(r.request().postData() || '').slice(0, 250)} res:${b.replace(/\s+/g, ' ').slice(0, 350)}`);
    }
  });
  const openAdd = async (ready) => {
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
      if (await ready.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) return true;
    }
    return false;
  };
  const feedBill = async (label) => {
    const info = await dump(`${label} FORM`);
    const names = info.selects.map((s) => s.split('[')[0]);
    for (const n of names) if (!/mobile|customerID/i.test(n)) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
    const billSel = names.find((n) => /bill|invoice|oldBill|salesInvoice/i.test(n));
    const billInput = page.locator('input[id*="bill" i], input[id*="invoice" i], input[placeholder*="bill" i], input[placeholder*="invoice" i]').locator('visible=true').first();
    if (billSel) {
      await pg.pick(billSel, bill, { search: true }).catch((e) => console.log(`pick ${billSel} "${bill}" failed ${e.message.split('\n')[0]}`));
    } else if (await billInput.count()) {
      console.log(`bill input: ${await billInput.getAttribute('id')}|${await billInput.getAttribute('placeholder')}`);
      await billInput.fill(bill);
      await billInput.press('Enter');
    } else console.log(`${label}: no bill select / input found (selects ${JSON.stringify(names)})`);
    await pg.waitForIdle();
    await pg.settle(3_000);
    const after = await dump(`${label} AFTER BILL ${bill}`);
    const newNames = after.selects.map((s) => s.split('[')[0]).filter((n) => !names.includes(n));
    for (const n of newNames) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
    for (const n of names.filter((x) => /item|return/i.test(x))) await openSel(n).catch(() => {});
    await page.screenshot({ path: `test-results/screens/probe-${label.replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: true }).catch(() => {});
  };

  // 1. Sales Return Estimation tab
  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForSpinner();
  await pg.settle(2_000);
  const sreTab = page.getByRole('tab', { name: /^\s*Sales Return Estimation\s*$/ }).locator('visible=true').first();
  await sreTab.click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(2_500);
  await dump('SALES RETURN ESTIMATION LIST');
  if (await openAdd(page.locator('ng-select').locator('visible=true').first())) {
    await pg.settle(2_000);
    const mob = page.locator('input#mobileNumber, input[type=tel]').locator('visible=true').first();
    if (await mob.count()) { await mob.fill(mobile); await mob.blur(); await pg.settle(2_500); }
    if (await pg.select('customerID').count()) await pg.pick('customerID', customer, { search: true }).catch((e) => console.log('customer pick failed ' + e.message.split('\n')[0]));
    await pg.settle(2_000);
    await feedBill('SALES RETURN ESTIMATION');
  } else console.log('Sales Return Estimation: Add form did not open');

  // 2. Sales Return Registration page (tab strip of the Operations pages)
  const srr = page.locator('a, button, [role=tab], li').filter({ hasText: /^\s*Sales Return Registration\s*$/ }).locator('visible=true').first();
  await srr.click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(3_000);
  const list = await dump('SALES RETURN REGISTRATION LIST');
  console.log('registration route: ' + list.url);
  if (await openAdd(page.locator('ng-select').locator('visible=true').first())) {
    await pg.settle(2_000);
    const mob = page.locator('input#mobileNumber, input[type=tel]').locator('visible=true').first();
    if (await mob.count()) { await mob.fill(mobile); await mob.blur(); await pg.settle(2_500); }
    if (await pg.select('customerID').count()) await pg.pick('customerID', customer, { search: true }).catch((e) => console.log('customer pick failed ' + e.message.split('\n')[0]));
    await pg.settle(2_000);
    await feedBill('SALES RETURN REGISTRATION');
  } else console.log('Sales Return Registration: Add form did not open');
  console.log('calls ' + JSON.stringify(calls, null, 1));
});
