const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE: Retail Operations > Operations > Estimations (/pos/app-order-estimation-setup)
// at Kakkanad - every tab's list (headers + first rows, do the chain numbers show?)
// and, on the "Estimation" tab's Add form, what each Sales Type (EMA / Normal
// Sale / Order / Sales Return) reveals: controlnames, inputs, grids; the EMA
// member and the order number are typed in to see the pick-up. Nothing is saved.
//   MEMBER=WB005KKD ORDER=FFFF6 npx playwright test tests/probe/estimation-sales-types-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE estimation tabs + sales types', async ({ loginPage, orderEstimation, page }) => {
  test.setTimeout(600_000);
  const member = process.env.MEMBER || 'WB005KKD';
  const order = process.env.ORDER || 'FFFF6';
  const numbers = ['TESTJun O59', 'FFFF6', 'RE-14', 'ADV-009KK', member, '27', '60', '47', '45'];
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = orderEstimation;

  const dump = async (label, { full = false } = {}) => {
    const info = await page.evaluate((full) => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      const main = document.querySelector('.page-content, main') || document.body;
      return {
        url: location.pathname,
        text: main.innerText.replace(/\s+/g, ' ').slice(0, full ? 4000 : 1800),
        tabs: [...document.querySelectorAll('[role=tab], .nav-link')].filter(vis).map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.id || '-'}|${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
        tables: [...document.querySelectorAll('table')].filter(vis).map((t) => ({ head: [...t.querySelectorAll('th')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).join('|'), rows: [...t.querySelectorAll('tbody tr')].slice(0, 5).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)) })),
      };
    }, full);
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
    if (['POST', 'PUT', 'GET'].includes(r.request().method()) && /sioniq\/.*(Estimation|Sales|EMA|ADP|Member|Return)/i.test(r.url()) && !/KeepAlive|Translation|Pagination|Dropdown/i.test(r.url())) {
      const b = await r.text().catch(() => '');
      calls.push(`${r.status()} ${r.request().method()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} req:${(r.request().postData() || '').slice(0, 200)} res:${b.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  });

  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  const home = await dump('PAGE OPEN');
  // every tab's list
  for (const t of home.tabs.filter((x) => /Estimation/i.test(x))) {
    const tab = page.getByRole('tab', { name: new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).locator('visible=true').first();
    if (!(await tab.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
    await tab.click({ timeout: 60_000 });
    await pg.waitForSpinner();
    await pg.settle(3_000);
    const info = await dump(`TAB ${t} (list)`);
    const blob = info.text + JSON.stringify(info.tables);
    console.log(`TAB ${t}: chain numbers present -> ${JSON.stringify(numbers.filter((n) => blob.includes(n)))}`);
    await page.screenshot({ path: `test-results/screens/probe-est-tab-${t.replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: true }).catch(() => {});
  }

  // the "Estimation" tab's Add form: Sales Type options and what each reveals
  const estTab = page.getByRole('tab', { name: /^\s*Estimation\s*$/ }).locator('visible=true').first();
  await estTab.click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(2_000);
  for (let i = 0; i < 3; i++) {
    await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
    if (await pg.select('customerID').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) break;
    console.log(`Add form not open after click ${i + 1}`);
  }
  await pg.settle(2_000);
  await dump('ESTIMATION ADD FORM');
  // customer: the EMA member's mobile narrows the customer list
  const mobile = page.locator('input#mobileNumber, input[type=tel]').locator('visible=true').first();
  if (await mobile.count()) { await mobile.fill(process.env.MOBILE || '1234567890'); await mobile.blur(); await pg.settle(2_500); }
  await openSel('customerID').catch(() => {});
  await pg.pick('customerID', process.env.CUSTOMER || 'Anu', { search: true }).catch((e) => console.log('customer pick failed ' + e.message.split('\n')[0]));
  await pg.settle(2_500);
  const form = await dump('AFTER CUSTOMER');
  const names = form.selects.map((s) => s.split('[')[0]);
  for (const n of names) if (!/mobile|customerID/i.test(n)) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
  const salesType = names.find((n) => /salesType|SalesType/i.test(n)) || (await page.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => /^\s*Sales Type/i.test(x.textContent)); const h = l && l.closest('div')?.querySelector('[controlname]'); return h ? h.getAttribute('controlname') : ''; }));
  console.log(`Sales Type controlname: "${salesType}"`);
  if (salesType) {
    const opts = (await openSel(salesType)).map((o) => o.trim()).filter((o) => o && !/No items/i.test(o));
    for (const o of opts) {
      await pg.pick(salesType, o, { exact: true }).catch((e) => console.log(`pick ${o} failed ${e.message.split('\n')[0]}`));
      await pg.waitForIdle();
      await pg.settle(2_500);
      const d = await dump(`SALES TYPE ${o}`, { full: true });
      await page.screenshot({ path: `test-results/screens/probe-est-sales-type-${o.replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: true }).catch(() => {});
      const newSelects = d.selects.map((s) => s.split('[')[0]).filter((n) => !names.includes(n));
      for (const n of newSelects) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
      // feed the chain number into the revealed number box, if any
      const box = page.locator('input[placeholder*="scan" i], input[placeholder*="number" i], input[id*="memberNo" i], input[id*="orderNo" i], input[id*="returnNo" i], input[id*="invoice" i]').locator('visible=true').filter({ hasNot: page.locator('[disabled]') }).first();
      if (await box.count()) {
        const val = /EMA/i.test(o) ? member : /Order/i.test(o) ? order : /Return/i.test(o) ? (process.env.RETURN || '60') : '';
        if (val) {
          console.log(`${o}: typing "${val}" into ${await box.getAttribute('id')}|${await box.getAttribute('placeholder')}`);
          await box.fill(val);
          await box.press('Enter');
          await pg.waitForIdle();
          await pg.settle(3_000);
          await dump(`SALES TYPE ${o} AFTER ${val}`, { full: true });
          await page.screenshot({ path: `test-results/screens/probe-est-sales-type-${o.replace(/\W+/g, '-').toLowerCase()}-after.png`, fullPage: true }).catch(() => {});
        }
      } else console.log(`${o}: no number box revealed`);
    }
  }
  console.log('calls ' + JSON.stringify(calls, null, 1));
});
