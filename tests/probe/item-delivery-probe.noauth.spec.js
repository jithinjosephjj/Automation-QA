const { test } = require('../../fixtures/test-fixtures');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');
const sessionCache = require('../../utils/session-cache');

/**
 * READ-ONLY probe (saves nothing): find the "Item Delivery" screen under
 * Retail Operation at Kakkanad, dump its list and its Add form (every select
 * with its options), then feed it a recent retail invoice number (from the
 * Invoice list) and dump what the lookup reveals. Nothing is submitted.
 *
 * Run: npx playwright test tests/probe/item-delivery-probe.noauth.spec.js --project=no-auth --reporter=list
 */
const BU = process.env.BU || 'Kakkanad';
const INVOICE = process.env.INVOICE || '';

async function dump(page, label) {
  const info = await page.evaluate(() => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside, app-sidebar');
    const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
    return {
      url: location.pathname,
      selects: [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${ng?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}${ng?.classList.contains('ng-invalid') ? ' (invalid)' : ''}`; }),
      inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}${i.classList.contains('ng-invalid') ? ' (invalid)' : ''}`).slice(0, 50),
      checks: [...document.querySelectorAll('input[type=checkbox], input[type=radio], .form-switch input, [role=switch]')].filter((c) => c.offsetParent).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`).slice(0, 20),
      headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 260)).slice(0, 5),
      headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 80),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => `${b.textContent.replace(/\s+/g, ' ').trim() || b.querySelector('i')?.className || '?'}${b.disabled ? '(disabled)' : ''}`).filter((t) => t && t.length < 48),
      tabs: [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim()),
      alerts: [...document.querySelectorAll('.toast, .toast-message, [role="alert"], .swal2-container, .invalid-feedback, .text-danger')].filter((n) => n.offsetParent).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10),
      text: document.querySelector('main, .main-content, .page-content, router-outlet ~ *')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 1500) || '',
    };
  });
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

test('item delivery screen', async ({ loginPage, page }) => {
  test.setTimeout(600_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', BU);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: BU });
  const pg = new RetailInvoicePage(page);

  // 1. the menu: every link whose text or href mentions delivery
  await page.waitForTimeout(4_000);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href], a[routerlink], [routerlink]')]
    .map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), href: a.getAttribute('href') || a.getAttribute('routerlink') || '' }))
    .filter((l) => /deliver/i.test(l.text) || /deliver/i.test(l.href)));
  console.log(`menu links mentioning delivery: ${JSON.stringify(links)}`);
  const posLinks = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => `${a.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)} -> ${a.getAttribute('href')}`).filter((l) => /\/pos\//.test(l)));
  console.log(`pos links (${posLinks.length}): ${JSON.stringify(posLinks)}`);

  // 2. a recent invoice number from the Invoice list, unless given
  let invoiceNo = INVOICE;
  if (!invoiceNo) {
    await pg.open();
    const list = await dump(page, 'INVOICE list');
    const first = list.rows[0] || '';
    const m = first.match(/\b(\d{1,6})\b/);
    invoiceNo = m ? m[1] : '';
    console.log(`recent invoice row: "${first}" -> invoice no "${invoiceNo}"`);
  }

  // 3. the Item Delivery screen
  const target = links.find((l) => /item/i.test(l.text) && /deliver/i.test(l.text)) || links[0];
  const route = target ? (target.href.startsWith('/') ? target.href : `/${target.href}`) : '/pos/view-item-delivery';
  console.log(`navigating to ${route}`);
  await pg.goto(route);
  await pg.waitForIdle();
  await pg.waitForSpinner().catch(() => {});
  await page.waitForTimeout(4_000);
  const list = await dump(page, 'ITEM DELIVERY list');
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-list.png', fullPage: true }).catch(() => {});
  for (const s of list.selects) { const c = s.split(' ')[0]; if (c && c !== '?') await options(page, c); }

  // the "+" (or an Add button) opens the form
  const add = page.locator('button:has(i.ri-add-fill), button:has(i[class*="add"])').locator('visible=true').first();
  const addBtn = page.getByRole('button', { name: /Add|New|\+/ }).locator('visible=true').first();
  if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) await add.click({ timeout: 10_000 }).catch((e) => console.log(`+ click: ${String(e).slice(0, 100)}`));
  else if (await addBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await addBtn.click({ timeout: 10_000 }).catch((e) => console.log(`Add click: ${String(e).slice(0, 100)}`));
  else console.log('no add-style button found');
  await pg.waitForIdle();
  await page.waitForTimeout(4_000);
  const form = await dump(page, 'ITEM DELIVERY form (empty)');
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-form.png', fullPage: true }).catch(() => {});
  for (const s of form.selects) { const c = s.split(' ')[0]; if (c && c !== '?') await options(page, c); }

  // 4. feed the invoice number into whatever looks like an invoice / bill / receipt lookup
  if (invoiceNo) {
    const lookup = page.locator('input').locator('visible=true').filter({ has: page.locator(':scope') })
      .and(page.locator('input[placeholder*="Invoice" i], input[placeholder*="Bill" i], input[placeholder*="Receipt" i], input[id*="invoice" i], input[id*="receipt" i], input[formcontrolname*="invoice" i], input[formcontrolname*="receipt" i], input[formcontrolname*="bill" i]')).first();
    if (await lookup.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const name = await lookup.evaluate((i) => i.getAttribute('formcontrolname') || i.id || i.placeholder);
      console.log(`invoice lookup input: ${name}`);
      await lookup.fill(String(invoiceNo));
      const resp = page.waitForResponse((r) => !/KeepAlive|Translation|GetMasterData/i.test(r.url()) && r.request().method() !== 'OPTIONS' && Date.now(), { timeout: 15_000 }).catch(() => null);
      await lookup.press('Enter');
      const search = page.getByRole('button', { name: /Search|Fetch|Get|Load/i }).locator('visible=true').first();
      if (await search.isVisible({ timeout: 2_000 }).catch(() => false)) await search.click({ timeout: 5_000 }).catch(() => {});
      const r = await resp;
      if (r) console.log(`lookup response: ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 400)}`);
      await pg.waitForIdle();
      await page.waitForTimeout(4_000);
      const after = await dump(page, `ITEM DELIVERY after invoice ${invoiceNo}`);
      await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-after-invoice.png', fullPage: true }).catch(() => {});
      for (const s of after.selects) { const c = s.split(' ')[0]; if (c && c !== '?' && !form.selects.some((f) => f.startsWith(c + ' ') && !f.includes('(empty)'))) await options(page, c); }
    } else {
      // maybe the invoice is picked from a select
      const sel = form.selects.map((s) => s.split(' ')[0]).find((c) => /invoice|receipt|bill/i.test(c));
      console.log(`no invoice lookup input; invoice-like select: ${sel || '(none)'}`);
      if (sel) {
        await pg.pick(sel, invoiceNo, { search: true }).catch((e) => console.log(`pick ${sel} ${invoiceNo}: ${String(e).slice(0, 160)}`));
        await page.waitForTimeout(4_000);
        await dump(page, `ITEM DELIVERY after invoice select ${invoiceNo}`);
        await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-after-invoice.png', fullPage: true }).catch(() => {});
      }
    }
  }
});
