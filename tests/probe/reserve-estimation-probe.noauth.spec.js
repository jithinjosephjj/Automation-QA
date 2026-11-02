const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE (read-only): the "Reserve Estimation" tab of Retail Operations >
// Estimations (its Add form: selects, inputs, buttons, options) and what the
// Advance Registration form offers for Advance Type "Reserve". TAG=<tag no>
// also scans a tag on the reserve form. Nothing is saved.
// Run: npx playwright test tests/probe/reserve-estimation-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE reserve estimation + reserve advance', async ({ loginPage, orderEstimation, advanceRegistration, page }) => {
  test.setTimeout(500_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = orderEstimation;

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => {
        const box = n.closest('.form-group, .col, [class*="col-"], .mb-2, .mb-3, div');
        const lab = box && (box.querySelector('label') || box.previousElementSibling);
        return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40);
      };
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select'))
        .map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); const val = ng && ng.querySelector('.ng-value') ? ng.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''; return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${captionOf(n)}]=${val}${ng && ng.classList.contains('ng-invalid') ? ' *' : ''}${ng && ng.classList.contains('ng-select-disabled') ? ' (dis)' : ''}`; });
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar'))
        .map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? ' *' : ''}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 40);
      const tabs = [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim());
      const headings = [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 60);
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      return { url: location.pathname, tabs, headings, selects, inputs, buttons, headers };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).locator('visible=true').first();
    if (!(await host.count())) { console.log(`  ${ctl}: (absent)`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`  options ${ctl}: ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    return opts;
  };
  const emptySelects = async () => page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent && !n.querySelector('.ng-value')).map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname')));

  // ---- Reserve Estimation
  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForIdle();
  await pg.waitForSpinner();
  await page.waitForTimeout(3_000);
  const tab = page.getByRole('tab', { name: /Reserve Estimation/i }).locator('visible=true').first();
  console.log(`Reserve Estimation tab: ${await tab.count()}`);
  await tab.click({ timeout: 15_000 });
  await pg.waitForIdle();
  await pg.waitForSpinner();
  await page.waitForTimeout(3_000);
  await describe('RESERVE LIST');
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await page.waitForTimeout(5_000);
  await describe('RESERVE ADD FORM');
  await page.screenshot({ path: 'test-results/screens/probe-reserve-add.png', fullPage: true });
  for (const ctl of await emptySelects()) await options(ctl);
  const cust = (await emptySelects()).find((c) => /customer/i.test(c));
  if (cust) {
    await pg.pick(cust, process.env.CUSTOMER || 'Aneesh Maradu', { search: true }).catch((e) => console.log(`pick customer failed: ${String(e).slice(0, 200)}`));
    await page.waitForTimeout(3_000);
    await describe('RESERVE AFTER CUSTOMER');
    for (const ctl of await emptySelects()) await options(ctl);
  }
  await pg.pick('masterDataValueID_BusinessType', 'Retail', { exact: true }).catch((e) => console.log('bt: ' + String(e).slice(0, 120)));
  await page.waitForTimeout(1_500);
  await pg.pick('masterDataValueID_StockSourceType', process.env.EST_TYPE || 'TagWise', { exact: true }).catch((e) => console.log('est type: ' + String(e).slice(0, 120)));
  await page.waitForTimeout(2_000);
  await pg.pick('salesExecutiveID', 'Chandu', { search: true }).catch((e) => console.log('se: ' + String(e).slice(0, 120)));
  await page.waitForTimeout(2_000);
  await describe('RESERVE AFTER TYPE PICKS');
  if (process.env.TAG) {
    const scan = page.locator('input[placeholder*="Tag" i], input[placeholder*="Scan" i], input#scanValue, input[formcontrolname="scanInput"], input#scanInput').locator('visible=true').first();
    console.log('scan input count ' + (await scan.count()) + ' ' + JSON.stringify(await scan.evaluate((e) => e.id + '|' + e.placeholder + '|' + (e.getAttribute('formcontrolname') || '')).catch(() => '')));
    if (await scan.count()) {
      await scan.fill(process.env.TAG);
      await scan.press('Enter');
      await page.waitForTimeout(5_000);
      await describe('RESERVE AFTER SCAN');
      console.log('toasts: ' + JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])));
      const rows = await page.locator('table tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
      console.log('rows: ' + JSON.stringify(rows.map((r) => r.replace(/s+/g, ' ').trim().slice(0, 200)).slice(0, 5)));
      await page.screenshot({ path: 'test-results/screens/probe-reserve-scanned.png', fullPage: true });
      const next = page.getByRole('button', { name: /^s*Nexts*$/ }).locator('visible=true').last();
      if (await next.isVisible().catch(() => false)) { await next.click(); await page.waitForTimeout(4_000); await describe('RESERVE STEP 2'); await page.screenshot({ path: 'test-results/screens/probe-reserve-step2.png', fullPage: true }); for (const ctl of await emptySelects()) await options(ctl); }
    }
  }
  // ---- Advance Registration, Advance Type Reserve
  await advanceRegistration.open();
  await advanceRegistration.openAddForm();
  await advanceRegistration.settle(2_000);
  await advanceRegistration.pick('customerID', process.env.CUSTOMER || 'Aneesh Maradu', { search: true });
  await page.waitForTimeout(2_000);
  await options('advanceType');
  await advanceRegistration.pick('advanceType', 'Reserve', { exact: true });
  await page.waitForTimeout(2_500);
  await describe('ADVANCE (Reserve)');
  await advanceRegistration.pick('advanceSubType', 'Registration', { exact: true }).catch((e) => console.log('sub: ' + String(e).slice(0, 120)));
  await page.waitForTimeout(2_500);
  await describe('ADVANCE (Reserve, Registration)');
  const est = page.locator('input[formcontrolname="estimationNumber"], [controlname="estimationNumber"] input, input[placeholder*="stimation" i]').locator('visible=true').first();
  console.log('estimation number input: ' + (await est.count()));
  for (const ctl of await emptySelects()) await options(ctl);
  await page.screenshot({ path: 'test-results/screens/probe-reserve-advance.png', fullPage: true });
});
