const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE: which invoice configuration (Invoice Type / Business Type / Making Type /
// Estimation Type / Sales Type) makes GetSalesInvoiceEstimationsPaginated return
// estimations? Lists each select's options, then tries every Making Type (and
// Invoice Type) with Invoice Source "Estimation" and logs what the estimation
// search returns. Also lists the Estimations page tabs. Read-only.
//   npx playwright test tests/probe/invoice-estimation-filters-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE invoice estimation-source filters', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(500_000);
  const customer = process.env.CUSTOMER || 'Aneesh Maradu';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = retailInvoice;
  const seen = [];
  page.on('response', async (r) => { if (/GetSalesInvoiceEstimationsPaginated/i.test(r.url())) { const b = await r.json().catch(() => null); seen.push(`req=${(r.request().postData() || '').slice(0, 260)} -> total ${b && b.totalRecords} ${JSON.stringify((b && b.data || []).slice(0, 2)).slice(0, 400)}`); } });

  const options = async (controlname) => {
    const sel = pg.select(controlname);
    if (!(await sel.count())) return null;
    await sel.click({ timeout: 10_000 });
    await pg.settle(900);
    const o = (await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    await page.keyboard.press('Escape');
    await pg.settle(300);
    console.log(`${controlname} options: ${JSON.stringify(o)}`);
    return o;
  };

  await pg.open();
  await pg.openAddForm();
  await pg.pick('customerID', customer, { search: true });
  await pg.settle(2_000);
  const names = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent).map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname')}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`));
  console.log(`form selects: ${JSON.stringify(names)}`);
  const all = {};
  for (const n of ['masterDataValueID_InvoiceType', 'masterDataValueID_BusinessType', 'masterDataValueID_InvoiceMakingType', 'masterDataValueID_InvoiceSource', 'masterDataValueID_EstimationType', 'masterDataValueID_InvoiceSalesType']) all[n] = await options(n).catch((e) => `ERR ${e.message.slice(0, 60)}`);

  await pg.pick('masterDataValueID_InvoiceSource', 'Estimation', { exact: true });
  await pg.waitForIdle();
  await pg.settle(2_000);
  const estOptions = async (label) => {
    const est = pg.select('estimationID');
    if (!(await est.count())) { console.log(`${label}: no estimationID select`); return; }
    await est.click(); await pg.settle(2_500);
    const o = (await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    await page.keyboard.press('Escape'); await pg.settle(300);
    console.log(`${label}: estimationID -> ${JSON.stringify(o.slice(0, 8))}`);
  };
  await estOptions('Normal making type');
  for (const mt of (Array.isArray(all.masterDataValueID_InvoiceMakingType) ? all.masterDataValueID_InvoiceMakingType : []).filter((o) => !/No items|Normal/i.test(o))) {
    await pg.pick('masterDataValueID_InvoiceMakingType', mt, { exact: true }).catch((e) => console.log(`making type ${mt}: ${e.message.slice(0, 80)}`));
    await pg.waitForIdle(); await pg.settle(2_000);
    if (!(await pg.selectValue('masterDataValueID_InvoiceSource').catch(() => ''))) await pg.pick('masterDataValueID_InvoiceSource', 'Estimation', { exact: true }).catch(() => {});
    await pg.settle(1_500);
    await estOptions(`making type ${mt}`);
  }
  for (const it of (Array.isArray(all.masterDataValueID_InvoiceType) ? all.masterDataValueID_InvoiceType : []).filter((o) => !/No items|^Invoice$/i.test(o))) {
    await pg.pick('masterDataValueID_InvoiceType', it, { exact: true }).catch((e) => console.log(`invoice type ${it}: ${e.message.slice(0, 80)}`));
    await pg.waitForIdle(); await pg.settle(2_000);
    console.log(`invoice type ${it}: selects ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent).map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname')}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`)))}`);
    await options('masterDataValueID_InvoiceSource').catch(() => {});
    if (!(await pg.selectValue('masterDataValueID_InvoiceSource').catch(() => '')).match(/Estimation/)) await pg.pick('masterDataValueID_InvoiceSource', 'Estimation', { exact: true }).catch(() => {});
    await pg.settle(1_500);
    await estOptions(`invoice type ${it}`);
  }
  console.log('estimation lookups', JSON.stringify(seen, null, 1));

  // the Estimations page tabs
  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForIdle(); await pg.settle(2_500);
  console.log(`Estimations tabs: ${JSON.stringify(await page.getByRole('tab').allInnerTexts().catch(() => []))}`);
  console.log(`Estimations links/buttons: ${JSON.stringify((await page.locator('.nav-link, .nav-tabs a, .nav-tabs button, ul.nav li').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean).slice(0, 15))}`);
});
