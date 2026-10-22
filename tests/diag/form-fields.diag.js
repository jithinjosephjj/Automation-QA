// Read-only form mapper: opens ROUTE, clicks Add (unless NO_ADD=1), lists every
// visible select (controlname | label | value), input (label/placeholder) and
// button, opens the selects named in OPEN (comma-separated controlnames or
// label texts) to list their options, and takes a screenshot.
// Run: BU=Cochin ROUTE=/pos/app-order-estimation-setup OPEN="Transaction Mode" npx playwright test tests/diag/form-fields.diag.js (rename to *.noauth.spec.js to run) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const fs = require('fs');

// a leading slash is added when missing (Git Bash rewrites "/pos/..." env values into Windows paths)
const ROUTE = '/' + (process.env.ROUTE || 'pos/app-order-estimation-setup').replace(/^.*?(?=(pos|sls|prc|inv|prd|fin|oms|ema|adm|dsb)\/)/, '');
const TAB = process.env.TAB || '';
const OPEN = (process.env.OPEN || '').split(',').map((s) => s.trim()).filter(Boolean);
const DIR = process.env.SHOT_DIR || 'bug-reports/shots-form-fields';

async function dump(page, tag) {
  const out = await page.evaluate(() => {
    const vis = (el) => !!(el && el.offsetParent);
    const labelOf = (el) => {
      const wrap = el.closest('[controlname]');
      const col = el.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-lg-2, .col-lg-3, .col-lg-4, .form-group') || el.parentElement;
      const lbl = col && col.querySelector('label');
      return { ctl: (wrap && wrap.getAttribute('controlname')) || el.getAttribute('formcontrolname') || '', label: lbl ? lbl.textContent.trim() : '' };
    };
    const selects = [...document.querySelectorAll('ng-select')].filter(vis).map((ng) => {
      const { ctl, label } = labelOf(ng);
      const val = ng.querySelector('.ng-value');
      return `${ctl || '-'} | ${label || '-'} | ${val ? val.textContent.trim() : '(empty)'}${ng.classList.contains('ng-select-disabled') ? ' (disabled)' : ''}`;
    });
    const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([role=combobox]), textarea')]
      .filter(vis).map((i) => { const { ctl, label } = labelOf(i); return `${ctl || i.id || '-'} | ${label || i.placeholder || '-'} | "${i.value}"${i.disabled || i.readOnly ? ' (ro)' : ''}`; });
    const checks = [...document.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(vis).map((i) => { const { label } = labelOf(i); return `${label || i.id || '-'}=${i.checked}`; });
    const buttons = [...document.querySelectorAll('button, a.btn')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const tabs = [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim());
    const headings = [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { selects, inputs, checks, buttons, tabs, headings };
  });
  console.log(`--- ${tag} @ ${page.url().replace(/^https?:\/\/[^/]+/, '')}`);
  for (const [k, v] of Object.entries(out)) console.log(`${k} (${v.length}):\n  ${v.join('\n  ')}`);
}

test('form fields', async ({ loginPage, page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(DIR, { recursive: true });
  await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  await page.goto(ROUTE, { waitUntil: 'commit' });
  await page.waitForTimeout(6_000);
  if (TAB) { await page.getByRole('tab', { name: new RegExp(TAB, 'i') }).first().click({ timeout: 60_000 }); await page.waitForTimeout(3_000); }
  await dump(page, 'list');
  await page.screenshot({ path: `${DIR}/${ROUTE.replace(/\W+/g, '_')}-list.png` });
  if (!process.env.NO_ADD) {
    let add = page.locator('button:has(i.ri-add-fill)').locator('visible=true').first();
    if (!(await add.count())) add = page.locator('button:has(i[class*="add"]), button[title*="Add" i], button:has-text("+")').locator('visible=true').first();
    if (!(await add.count())) add = page.getByRole('button', { name: /^\+$|Add New|Add$/ }).locator('visible=true').first();
    console.log(`add button: ${await add.count() ? await add.evaluate((b) => b.outerHTML.slice(0, 160)) : 'NOT FOUND'}`);
    await add.click({ timeout: 60_000 });
    await page.waitForTimeout(5_000);
    await dump(page, 'add form');
    await page.screenshot({ path: `${DIR}/${ROUTE.replace(/\W+/g, '_')}-add.png`, fullPage: true });
  }
  for (const want of OPEN) {
    let host = page.locator(`sioniq-ng-select[controlname="${want}"] ng-select, ng-select[formcontrolname="${want}"]`).locator('visible=true').first();
    if (!(await host.count())) host = page.locator(`xpath=//label[normalize-space(text())="${want}"]/following::ng-select[1]`).locator('visible=true').first();
    if (!(await host.count())) { console.log(`options of "${want}": select not found`); continue; }
    await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    console.log(`options of "${want}" (${opts.length}): ${JSON.stringify(opts.slice(0, 40))}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
});
