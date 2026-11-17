const { test } = require('../../fixtures/test-fixtures');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');
const sessionCache = require('../../utils/session-cache');

/**
 * READ-ONLY probe 2 (saves nothing): Item Delivery with invoice 81 loaded -
 * tag Verify, row selection, Delivery Mode / Received By options, Pending
 * Delivery list, Preview Challan; the Invoice list's payment statuses; the
 * Invoice form's Summary & Payment block for a customer (credit / balance);
 * the Credit Limit Setup list. "Deliver & Print Challan" is never clicked.
 */
const BU = process.env.BU || 'Kakkanad';
const INVOICE = process.env.INVOICE || '81';
const TAG = process.env.TAG || '2026-06-2900132';

async function dump(page, label, { rows = 6, text = 1800 } = {}) {
  const info = await page.evaluate(({ rows, text }) => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside, app-sidebar');
    const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
    return {
      url: location.pathname,
      selects: [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${ng?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}${ng?.classList.contains('ng-invalid') ? ' (invalid)' : ''}`; }),
      inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}${i.classList.contains('ng-invalid') ? ' (invalid)' : ''}`).slice(0, 50),
      checks: [...document.querySelectorAll('input[type=checkbox], input[type=radio], .form-switch input, [role=switch]')].filter((c) => c.offsetParent).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}${c.closest('tr') ? '(row)' : ''}=${c.checked}${c.disabled ? '(disabled)' : ''}`).slice(0, 20),
      headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 260)).slice(0, rows),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => `${b.textContent.replace(/\s+/g, ' ').trim() || b.querySelector('i')?.className || '?'}${b.disabled ? '(disabled)' : ''}`).filter((t) => t && t.length < 48),
      alerts: [...document.querySelectorAll('.toast, .toast-message, [role="alert"], .swal2-container, .invalid-feedback, .text-danger')].filter((n) => n.offsetParent).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10),
      modal: [...document.querySelectorAll('.modal.show, ngb-modal-window, .swal2-container, .offcanvas.show')].filter((n) => n.offsetParent).map((n) => n.innerText.replace(/\s+/g, ' ').trim().slice(0, 1200)),
      text: document.querySelector('main, .main-content, .page-content, router-outlet ~ *')?.innerText.replace(/\s+/g, ' ').trim().slice(0, text) || '',
    };
  }, { rows, text });
  console.log(`${label}: ${JSON.stringify(info)}`);
  return info;
}

async function options(page, ctl) {
  const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).locator('visible=true').first();
  if (!(await host.count())) { console.log(`  OPTIONS ${ctl}: (absent)`); return []; }
  if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_800);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
  console.log(`  OPTIONS ${ctl}: ${opts.length} -> ${JSON.stringify(opts.slice(0, 25))}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  return opts;
}

async function closeModals(page) {
  for (let i = 0; i < 3; i++) {
    const x = page.locator('.modal.show .btn-close, ngb-modal-window .btn-close, .swal2-container button').locator('visible=true').last();
    if (!(await x.isVisible({ timeout: 800 }).catch(() => false))) break;
    await x.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

test('item delivery deep probe', async ({ loginPage, page }) => {
  test.setTimeout(600_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', BU);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: BU });
  const pg = new RetailInvoicePage(page);
  page.on('response', async (r) => {
    const u = r.url();
    if (/KeepAlive|Translation|GetMasterData|\.js|\.css|\.png|\.woff/i.test(u) || r.request().method() === 'OPTIONS') return;
    if (/Deliver|Credit|Invoice|Otp|Tag|Challan/i.test(u)) console.log(`  net ${r.request().method()} ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 220)}`);
  });

  // A. Invoice list: all rows -> payment statuses of the credit invoices
  await pg.open();
  const perPage = page.locator('select').locator('visible=true').first();
  if (await perPage.isVisible({ timeout: 2_000 }).catch(() => false)) await perPage.selectOption({ label: 'All' }).catch(() => {});
  await page.waitForTimeout(3_000);
  await dump(page, 'INVOICE list (all)', { rows: 40, text: 200 });

  // B. Item Delivery: load the invoice, Verify the tag, tick the row
  await pg.goto('/pos/view-sales-credit-item-delivery');
  await pg.waitForIdle();
  await pg.waitForSpinner().catch(() => {});
  await page.waitForTimeout(3_000);
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 10_000 });
  await page.waitForTimeout(3_000);
  // the Pending Delivery button (a list of what waits?)
  const pending = page.getByRole('button', { name: /Pending Delivery/ }).locator('visible=true').first();
  if (await pending.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await pending.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    await dump(page, 'after Pending Delivery click', { rows: 20 });
    await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-pending.png', fullPage: true }).catch(() => {});
    await closeModals(page);
  }
  // type the invoice number into the Invoice No search, pick it
  const host = pg.select('salesInvoiceID');
  await host.locator('.ng-select-container').click({ timeout: 5_000 });
  await host.locator('input[role="combobox"]').fill(String(INVOICE));
  await page.waitForTimeout(1_500);
  const typed = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim());
  console.log(`Invoice No search "${INVOICE}" -> ${JSON.stringify(typed)}`);
  await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(`^\\s*${INVOICE}\\s*$`) }).first().click({ timeout: 5_000 });
  await pg.waitForIdle();
  await page.waitForTimeout(4_000);
  await dump(page, `after invoice ${INVOICE}`);
  await options(page, 'masterDataValueID_DeliveryMode');
  await options(page, 'masterDataValueID_ReceivedByType');

  // Scan / Enter Tag No + Verify
  const tagIn = page.locator('input#tagNo, input[formcontrolname="tagNo"], input[placeholder*="Tag" i]').locator('visible=true').first();
  await tagIn.fill(TAG);
  await page.waitForTimeout(500);
  const verify = page.getByRole('button', { name: /^\s*Verify\s*$/ }).locator('visible=true').first();
  console.log(`Verify enabled: ${await verify.isEnabled().catch(() => '?')}`);
  await verify.click({ timeout: 5_000 }).catch((e) => console.log(`Verify click: ${String(e).slice(0, 100)}`));
  await pg.waitForIdle();
  await page.waitForTimeout(3_500);
  await dump(page, 'after Verify');
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-verified.png', fullPage: true }).catch(() => {});

  // the row checkbox (if any) -> Releasing Now
  const rowCb = page.locator('tbody tr input[type=checkbox]').locator('visible=true').first();
  if (await rowCb.isVisible({ timeout: 2_000 }).catch(() => false)) {
    console.log(`row checkbox checked=${await rowCb.isChecked().catch(() => '?')} disabled=${await rowCb.isDisabled().catch(() => '?')}`);
    if (!(await rowCb.isChecked().catch(() => false))) { await rowCb.click({ timeout: 5_000 }).catch((e) => console.log(`row tick: ${String(e).slice(0, 100)}`)); await page.waitForTimeout(2_000); }
    await dump(page, 'after row tick');
  }
  // the row's "Detail" control
  const detail = page.locator('tbody tr').first().locator('button, a, i').locator('visible=true').last();
  if (await detail.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await detail.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await dump(page, 'after row Detail', { rows: 3 });
    await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-detail.png', fullPage: true }).catch(() => {});
    await closeModals(page);
  }
  // Preview Challan (read-only)
  const preview = page.getByRole('button', { name: /Preview Challan/ }).locator('visible=true').first();
  console.log(`Preview Challan enabled: ${await preview.isEnabled().catch(() => '?')}; Deliver enabled: ${await page.getByRole('button', { name: /Deliver & Print/ }).locator('visible=true').first().isEnabled().catch(() => '?')}`);
  if (await preview.isEnabled().catch(() => false)) {
    await preview.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(4_000);
    await dump(page, 'after Preview Challan', { rows: 3 });
    await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-preview.png', fullPage: true }).catch(() => {});
    await closeModals(page);
  }
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-final.png', fullPage: true }).catch(() => {});

  // C. the Invoice form's Summary & Payment block for the credit customer
  await pg.open();
  await pg.openAddForm();
  await pg.pick('customerID', 'Abhilash', { search: true }).catch((e) => console.log(`customer: ${String(e).slice(0, 120)}`));
  await page.waitForTimeout(3_000);
  const f = await dump(page, 'INVOICE form after customer', { rows: 2, text: 2500 });
  for (const s of f.selects) { const c = s.split(' ')[0]; if (/Payment|Credit|Balance|Mode/i.test(c)) await options(page, c); }
  const paymentModes = await page.evaluate(() => [...document.querySelectorAll('input[type=radio], input[type=checkbox]')].filter((c) => c.offsetParent).map((c) => `${c.name || c.id}:${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`));
  console.log(`invoice radios/checks: ${JSON.stringify(paymentModes)}`);
  await page.screenshot({ path: 'test-results/adhoc/probe-invoice-form-customer.png', fullPage: true }).catch(() => {});

  // D. Credit Limit Setup list
  await pg.goto('/pos/credit-limit');
  await pg.waitForIdle();
  await page.waitForTimeout(4_000);
  await dump(page, 'CREDIT LIMIT list', { rows: 15 });
  await page.screenshot({ path: 'test-results/adhoc/probe-credit-limit.png', fullPage: true }).catch(() => {});
});
