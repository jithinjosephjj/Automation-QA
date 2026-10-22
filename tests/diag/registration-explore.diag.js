// Read-only exploration of Retail Operations > Operations > Registrations >
// Advance Registration: customer + Advance Type Order + Order Entry Mode
// Estimation, then Next, dumping what step 2 shows. Nothing is submitted.
// Run: BU=Cochin npx playwright test tests/diag/registration-explore.diag.js (rename to *.noauth.spec.js to run) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const { StockInwardBasePage } = require('../../pages/StockInwardBasePage');
const fs = require('fs');

const DIR = 'bug-reports/shots-registration';
const CUSTOMER = process.env.CUSTOMER || 'Aneesh Maradu';

async function options(page, pg, controlname) {
  const host = pg.select(controlname);
  if (!(await host.count())) { console.log(`options of ${controlname}: not on screen`); return null; }
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
      checks: [...document.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(vis).map((i) => `${labelOf(i)}=${i.checked}`),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      rows: [...document.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).slice(0, 8),
    };
  });
  console.log(`--- ${tag}`);
  for (const [k, v] of Object.entries(out)) console.log(`${k} (${v.length}):\n  ${v.join('\n  ')}`);
}

test('advance registration exploration', async ({ loginPage, page }) => {
  test.setTimeout(400_000);
  fs.mkdirSync(DIR, { recursive: true });
  // the list page keeps a hidden filter select with the same controlname - scope every pick to the visible one
  class VisiblePage extends StockInwardBasePage {
    select(controlname) {
      return this.page.locator(`sioniq-ng-select[controlname="${controlname}"] ng-select, ng-select[formcontrolname="${controlname}"]`).locator('visible=true').first();
    }
  }
  const pg = new VisiblePage(page, 'Registration');
  if (process.env.FRESH) {
    // user 22-10-2026: "login again and check - counter validation issue" - a
    // replayed session may lack the POS counter binding; go through the form
    require('../../utils/session-cache').clear(process.env.SIONIQ_USER || 'admin', process.env.BU || process.env.SIONIQ_BU);
    await loginPage.ensureLoggedIn({ bu: process.env.BU || undefined });
    console.log('fresh form login done (session cache cleared first)');
  } else {
    await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  }
  await page.goto('/pos/view-order-advance-registration', { waitUntil: 'commit' });
  await page.waitForTimeout(6_000);
  // the "+" is swallowed while the list is still loading - click until the form shows
  await pg.waitForSpinner().catch(() => {});
  await page.waitForTimeout(4_000);
  const candidates = page.locator('button:has(i.ri-add-fill), button:has(i[class*="add"]), .btn.border-0').locator('visible=true');
  const n = await candidates.count();
  console.log(`add-style buttons: ${n}`);
  let opened = false;
  for (let i = 0; i < n && !opened; i++) {
    const b = candidates.nth(i);
    const html = await b.evaluate((el) => el.outerHTML.slice(0, 140)).catch(() => '?');
    const box = await b.boundingBox().catch(() => null);
    console.log(`  [${i}] ${JSON.stringify(box)} ${html}`);
    await b.click({ timeout: 5_000, force: true }).catch((e) => console.log(`  click failed: ${String(e).slice(0, 80)}`));
    opened = await pg.select('customerID').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    const alerts = (await page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`  -> form open: ${opened}; alerts: ${JSON.stringify(alerts)}`);
  }
  if (!opened) {
    // last resort: a DOM click on the toolbar "+" (the one beside the Search box)
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('i.ri-add-fill') && x.offsetParent); if (b) b.click(); });
    opened = await pg.select('customerID').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    console.log(`DOM click -> form open: ${opened}`);
  }
  console.log(`add form open: ${opened}; url ${page.url().replace(/^https?:\/\/[^/]+/, '')}`);
  if (!opened) { await dump(page, 'after + (form not detected)'); await page.screenshot({ path: `${DIR}/after-plus.png`, fullPage: true }); }
  await page.waitForTimeout(2_000);

  await pg.pick('customerID', CUSTOMER, { search: true });
  await pg.settle(2_000);
  await pg.pick('advanceType', 'Order', { exact: true });
  await pg.settle(2_000);
  await options(page, pg, 'businessType');
  await pg.pick('businessType', 'Retail', { exact: true }).catch((e) => console.log('businessType: ' + String(e).slice(0, 100)));
  await pg.settle(1_500);
  await pg.pick('orderEntryMode', 'Estimation', { exact: true });
  await pg.settle(2_500);
  await dump(page, 'step 1 filled');
  await page.screenshot({ path: `${DIR}/step1.png`, fullPage: true });
  const names1 = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname]')].filter((n) => n.offsetParent && !n.querySelector('.ng-value')).map((n) => n.getAttribute('controlname')));
  for (const n of [...new Set(names1)].slice(0, 10)) await options(page, pg, n);

  const nextBtn = page.locator('button').filter({ hasText: /^\s*Next\s*$/ }).locator('visible=true').last();
  console.log(`Next: count=${await nextBtn.count()} enabled=${await nextBtn.isEnabled().catch(() => '?')}`);
  await nextBtn.click({ timeout: 10_000 }).catch((e) => console.log('Next click: ' + String(e).slice(0, 120)));
  await page.waitForTimeout(5_000);
  await dump(page, 'step 2');
  await page.screenshot({ path: `${DIR}/step2.png`, fullPage: true });
  const names2 = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname]')].filter((n) => n.offsetParent && !n.querySelector('.ng-value')).map((n) => n.getAttribute('controlname')));
  for (const n of [...new Set(names2)].slice(0, 12)) await options(page, pg, n);
});
