// Read-only exploration of Retail Operations > Operations > Estimations >
// Order Estimation: fills the configuration cascade far enough to reveal the
// dependent options and step 2 (Build Order Items), dumping every select's
// options. Nothing is submitted.
// Run: BU=Cochin npx playwright test tests/diag/estimation-explore.diag.js (rename to *.noauth.spec.js to run) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const { StockInwardBasePage } = require('../../pages/StockInwardBasePage');
const fs = require('fs');

const DIR = 'bug-reports/shots-estimation';
const CUSTOMER = process.env.CUSTOMER || 'Aneesh Maradu';
const BUSINESS_TYPE = process.env.BUSINESS_TYPE || 'Retail';

async function options(page, pg, controlname) {
  const host = pg.select(controlname);
  if (!(await host.count())) return null;
  await host.locator('.ng-select-container').first().click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log(`options of ${controlname} (${opts.length}): ${JSON.stringify(opts.slice(0, 30))}`);
  return opts;
}

async function dump(page, tag) {
  const out = await page.evaluate(() => {
    const vis = (el) => !!(el && el.offsetParent);
    const labelOf = (el) => {
      const wrap = el.closest('[controlname]');
      const col = el.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-lg-2, .col-lg-3, .col-lg-4, .form-group') || el.parentElement;
      const lbl = col && col.querySelector('label');
      return `${(wrap && wrap.getAttribute('controlname')) || el.getAttribute('formcontrolname') || '-'} | ${lbl ? lbl.textContent.trim() : (el.placeholder || '-')}`;
    };
    return {
      selects: [...document.querySelectorAll('ng-select')].filter(vis).map((ng) => `${labelOf(ng)} | ${ng.querySelector('.ng-value') ? ng.querySelector('.ng-value').textContent.trim() : '(empty)'}${ng.classList.contains('ng-select-disabled') ? ' (disabled)' : ''}`),
      inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([role=combobox]), textarea')].filter(vis).map((i) => `${labelOf(i)} | "${i.value}"${i.disabled || i.readOnly ? ' (ro)' : ''}`),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
    };
  });
  console.log(`--- ${tag}`);
  for (const [k, v] of Object.entries(out)) console.log(`${k} (${v.length}):\n  ${v.join('\n  ')}`);
}

test('order estimation exploration', async ({ loginPage, page }) => {
  test.setTimeout(400_000);
  fs.mkdirSync(DIR, { recursive: true });
  const pg = new StockInwardBasePage(page, 'Estimation');
  await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  await page.goto('/pos/app-order-estimation-setup', { waitUntil: 'commit' });
  await page.waitForTimeout(6_000);
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await page.waitForTimeout(5_000);

  await pg.pick('customerID', CUSTOMER, { search: true });
  await pg.settle(2_000);
  await pg.pick('businessType', BUSINESS_TYPE, { exact: true });
  await pg.settle(2_000);
  await pg.pick('orderMakingType', process.env.TX_TYPE || 'Job Work', { exact: true });
  await pg.settle(2_000);
  if (await pg.select('itemType').count()) { await options(page, pg, 'itemType'); await pg.pick('itemType', 'Metal', { exact: true }).catch(() => {}); await pg.settle(1_500); }
  await pg.pick('salesExecutiveID', process.env.SALES_EXEC || 'Abc', { search: true });
  await pg.settle(2_000);
  await dump(page, 'configuration filled');

  // Job Work item entry: reveal the cascade one pick at a time
  const stepPick = async (ctl, want, opts = {}) => {
    const list = await options(page, pg, ctl);
    if (!list || !list.length || /No items|Type to search/i.test(list[0])) {
      if (!want) return;
    }
    await pg.pick(ctl, want, opts).catch((e) => console.log(`pick ${ctl} "${want}" failed: ${String(e).slice(0, 120)}`));
    await pg.settle(1_500);
  };
  await stepPick('referenceType', process.env.REF_TYPE || 'Combination', { exact: true });
  await stepPick('metalID', 'Gold', { exact: true });
  await stepPick('productCategoryID', 'Ring', { exact: true });
  await stepPick('productArticleID', 'Tendulkar', { search: true });
  await stepPick('purityID', '91.60');
  const gw = page.locator('input[formcontrolname="grossWeightTran"], sioniq-input[controlname="grossWeightTran"] input, [controlname="grossWeightTran"] input').locator('visible=true').first();
  if (await gw.count()) { await gw.fill('60'); await gw.blur(); }
  await pg.settle(1_500);
  await dump(page, 'item entry filled');
  await page.screenshot({ path: `${DIR}/step1-item.png`, fullPage: true });
  // metal only (no stone): "Add Item" stages the row in Order Items
  await page.getByRole('button', { name: /^\s*Add Item\s*$/ }).locator('visible=true').last().click({ timeout: 5_000 });
  await pg.settle(2_500);
  await dump(page, 'after Add Item');
  const rows = await page.locator('table tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
  console.log(`order item rows: ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' ').trim()).slice(0, 5))}`);
  await page.screenshot({ path: `${DIR}/step1-added.png`, fullPage: true });

  // step 2
  const nextBtn = page.locator('button').filter({ hasText: /^\s*Next\s*$/ }).locator('visible=true').last();
  const proceed = page.locator('button').filter({ hasText: /Proceed to Payment/ }).locator('visible=true').last();
  console.log(`Next: count=${await nextBtn.count()} enabled=${await nextBtn.isEnabled().catch(() => '?')}; Proceed to Payment: count=${await proceed.count()}`);
  if (await nextBtn.count() && await nextBtn.isEnabled().catch(() => false)) await nextBtn.click({ timeout: 10_000 });
  else await proceed.click({ timeout: 10_000 });
  await page.waitForTimeout(5_000);
  await dump(page, 'step 2');
  await page.screenshot({ path: `${DIR}/step2.png`, fullPage: true });
  const text = ((await page.locator('.offcanvas, .modal, main, body').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  console.log(`step 2 text: ${text.slice(0, 1200)}`);
  const names = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname]')].filter((n) => n.offsetParent && !n.querySelector('.ng-value')).map((n) => n.getAttribute('controlname')));
  for (const n of [...new Set(names)].slice(0, 12)) await options(page, pg, n);
});
