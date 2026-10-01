const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing): amount fields must show the currency's
 * 2 decimals (Finance > Currency). Sweeps every transaction list (and each
 * of its tabs) and flags cells under an AMOUNT-type column that carry
 * exactly 3 decimals (weights legitimately carry 3 and are excluded).
 * Screenshots every screen with a finding into bug-reports/shots-decimals/.
 */
const DIR = 'bug-reports/shots-decimals';
const AMOUNT = /amount|value|rate\b|price|charge|payable|taxable|\btax\b|tax amount|making|mrp|total|cost|discount amt|discount amount|deduction|invoice amt|\bmc\b|amt/i;
const NOT_AMOUNT = /weight|\bwt\b|pcs|pieces|purity|%|percent|tunch|qty|quantity|no\.? ?of|count|date|days|lines|serial|carat|\bno\b|number|status|uom/i;

async function scanTables(page) {
  return page.evaluate(({ a, n }) => {
    const AM = new RegExp(a, 'i'); const NA = new RegExp(n, 'i');
    const vis = (el) => !!el.offsetParent;
    const out = [];
    for (const t of [...document.querySelectorAll('table')].filter(vis)) {
      const heads = [...t.querySelectorAll('thead th')].map((h) => h.innerText.replace(/\s+/g, ' ').replace(/ Sort Ascending.*$/, '').trim());
      const cols = heads.map((h, i) => ({ h, i })).filter((c) => c.h && AM.test(c.h) && !NA.test(c.h));
      if (!cols.length) continue;
      const rows = [...t.querySelectorAll('tbody tr')].filter(vis).slice(0, 25);
      for (const r of rows) {
        const cells = [...r.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim());
        const offset = cells.length - heads.length; // rows may carry fewer/more cells than headers
        for (const c of cols) {
          const v = cells[c.i + (offset > 0 ? 0 : 0)];
          if (v !== undefined && /^[-₹\s]*[\d,]*\.\d{3}$/.test(v)) out.push({ col: c.h, value: v, row: cells.slice(0, 3).join(' | ').slice(0, 60) });
        }
      }
    }
    // read-only amount inputs / summary figures with 3 decimals next to an amount caption
    for (const el of [...document.querySelectorAll('input[disabled], input[readonly]')].filter(vis)) {
      const cap = (el.closest('.form-group, [class*="col-"], div')?.querySelector('label')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (cap && AM.test(cap) && !NA.test(cap) && /^[\d,]*\.\d{3}$/.test(el.value)) out.push({ col: `[field] ${cap}`, value: el.value, row: '' });
    }
    return out;
  }, { a: AMOUNT.source, n: NOT_AMOUNT.source });
}

async function tabsOf(page) {
  return (await page.getByRole('tab').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean).slice(0, 12);
}

test('currency setup decimals', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(180_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await stoneInward.goto('/fin/currency-setup');
  await stoneInward.waitForIdle();
  await stoneInward.settle(3_000);
  const heads = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.trim()).filter(Boolean);
  const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  console.log(`CURRENCY headers: ${JSON.stringify(heads)}`);
  console.log(`CURRENCY rows: ${JSON.stringify(rows.slice(0, 10))}`);
  await page.screenshot({ path: `${DIR}/0-currency-setup.png`, fullPage: false });
});

const ROUTES = [
  '/prc/stock-inward-setup', '/prc/view-alloy-inward', '/prc/view-purchase-return', '/prc/view-goods-receipt', '/prc/view-logistics',
  '/prc/app-bullion-list', '/prc/view-bullion-issue', '/prc/view-samplejobwork-issue', '/prc/app-repair-setup', '/prc/app-stone-transaction',
  '/inv/view-lot-generation', '/inv/view-barcode-generation', '/inv/app-issue-list', '/inv/app-receipt-list',
  '/prd/app-job-finalize-list', '/prd/app-view-worker-settlement', '/prd/view-job-work',
  '/sls/app-invoice-setup', '/sls/view-b2b-approval-issue', '/sls/view-approval-receipt', '/sls/view-b2b-metal-sales-return',
  '/sls/view-repair-registration', '/sls/view-repair-delivery', '/sls/order-booking', '/sls/view-counter-allocation', '/sls/view-transfer',
];

test('sweep transaction lists for 3-decimal amounts', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(1_800_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const findings = [];
  for (const route of ROUTES) {
    await stoneInward.goto(route).catch(() => {});
    await stoneInward.waitForIdle();
    await stoneInward.settle(3_000);
    const tabs = await tabsOf(page);
    const targets = tabs.length ? tabs : ['(default)'];
    for (const tab of targets) {
      if (tab !== '(default)') {
        await page.getByRole('tab', { name: tab, exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
        await stoneInward.waitForIdle();
        await stoneInward.settle(2_500);
      }
      const hits = await scanTables(page).catch(() => []);
      const byCol = {};
      for (const h of hits) (byCol[h.col] = byCol[h.col] || []).push(h.value);
      const summary = Object.entries(byCol).map(([c, v]) => `${c}: ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` (+${v.length - 3})` : ''}`);
      console.log(`SCREEN ${route} [${tab}] -> ${summary.length ? 'THREE-DECIMAL AMOUNTS ' + JSON.stringify(summary) : 'ok'}`);
      if (summary.length) {
        findings.push({ route, tab, summary });
        const name = `${route.replace(/\//g, '_').replace(/^_/, '')}-${tab.replace(/[^A-Za-z0-9]+/g, '_')}`.slice(0, 80);
        await page.screenshot({ path: `${DIR}/list-${name}.png`, fullPage: false });
      }
    }
  }
  console.log(`FINDINGS ${findings.length}: ${JSON.stringify(findings)}`);
});

// ---------------------------------------------------------------- item-entry grids (no Submit)
const { businessDate, uniqueInvoiceNo, uniqueRef } = require('../../utils/unique');

async function reportForm(page, label, shot) {
  const hits = await scanTables(page).catch(() => []);
  const byCol = {};
  for (const h of hits) (byCol[h.col] = byCol[h.col] || []).push(h.value);
  const summary = Object.entries(byCol).map(([c, v]) => `${c}: ${[...new Set(v)].slice(0, 3).join(', ')}`);
  const heads = await page.evaluate(() => [...document.querySelectorAll('table')].filter((t) => t.offsetParent).map((t) => [...t.querySelectorAll('thead th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean)));
  const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 4);
  console.log(`FORM ${label} -> ${summary.length ? 'THREE-DECIMAL AMOUNTS ' + JSON.stringify(summary) : 'ok'}\n  tables ${JSON.stringify(heads)}\n  rows ${JSON.stringify(rows)}`);
  await page.screenshot({ path: `${DIR}/${shot}.png`, fullPage: false });
}

test('stone inward item grid (no submit)', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.settle(2_500);
  await reportForm(page, 'stone inward LIST', 'list-stone-inward');
  await stoneInward.openAddWizard();
  await stoneInward.fillBasicDetails({ inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', invoiceNo: uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, ''), invoiceDate: businessDate(0).replace(/-/g, '/') });
  await stoneInward.clickNext();
  await stoneInward.waitForIdle();
  await stoneInward.fillItem({ refType: 'Combination', stoneArticle: 'Jerald', entryMode: 'Without Tare', uom: 'Gram', noOfPcs: 4, grossWeight: 6, discountPercent: 7, returnPercent: 5 });
  await stoneInward.addItem();
  await stoneInward.settle(2_000);
  await reportForm(page, 'stone inward ITEM GRID', 'form-stone-inward-item-grid');
});

test('metal inward item grid (no submit)', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await metalInward.open();
  await metalInward.openAddWizard();
  await metalInward.fillBasicDetails({ subTransactionType: 'Invoice', businessUnit: 'Cochin', inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', purchaser: 'Abc', invoiceNo: uniqueInvoiceNo() });
  await metalInward.clickNext();
  await metalInward.waitForIdle();
  await metalInward.fillItem({ entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 60 });
  await metalInward.addItem();
  await metalInward.settle(2_000);
  await reportForm(page, 'metal inward ITEM GRID (step 2)', 'form-metal-inward-item-grid');
  await metalInward.clickNext().catch(() => {});
  await metalInward.waitForIdle();
  await metalInward.settle(2_500);
  await reportForm(page, 'metal inward REVIEW GRID (step 3)', 'form-metal-inward-review-grid');
});

test('brand inward item grid (no submit)', async ({ loginPage, brandInward, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await brandInward.open();
  await brandInward.selectTab();
  await brandInward.settle(2_500);
  await reportForm(page, 'brand inward LIST', 'list-brand-inward');
  await brandInward.openAddWizard();
  await brandInward.fillBasicDetails({ vendor: 'RAJA', purchaseType: 'Direct', costCenter: 'Cochin', inwardType: 'Stock', purchaser: 'Ajin G', invoiceNo: uniqueRef('BI-DEC') });
  await brandInward.clickNext();
  await brandInward.waitForIdle();
  await brandInward.fillItem({ referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', brand: 'Amraa', article: 'Tendulkar', purity: '91.60', noOfPcs: 10, grossWeight: 20, mrp: 100000, discountPercent: 5 });
  await brandInward.addItem();
  await brandInward.settle(2_000);
  await reportForm(page, 'brand inward ITEM GRID', 'form-brand-inward-item-grid');
});

test('metal invoice list amount formats', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).first().click({ timeout: 30_000 }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  // widen the date filter is not needed - the list shows the business date's invoices; also try the previous business date
  const read = async (label) => {
    const data = await page.evaluate(() => {
      const t = [...document.querySelectorAll('table')].find((x) => x.offsetParent && x.querySelector('thead th'));
      if (!t) return null;
      const heads = [...t.querySelectorAll('thead th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim());
      const rows = [...t.querySelectorAll('tbody tr')].filter((r) => r.offsetParent).map((r) => [...r.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
      return { heads, rows: rows.slice(0, 15) };
    });
    if (!data) { console.log(`INVOICE ${label}: no table`); return; }
    const amountCols = data.heads.map((h, i) => ({ h, i })).filter((c) => /amount|charges|taxable|tax |tax$|payable|value|deduction|collection/i.test(c.h));
    console.log(`INVOICE ${label} headers: ${JSON.stringify(data.heads)}`);
    for (const r of data.rows) {
      const receipt = r[data.heads.indexOf('Receipt No')] || r[1] || '';
      const cells = amountCols.map((c) => `${c.h}=${r[c.i]}`);
      console.log(`INVOICE ${label} row ${receipt}: ${cells.join(' | ')}`);
    }
  };
  await read('current date');
  // scroll the grid to the amount columns and screenshot
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollWidth > el.clientWidth + 50 && getComputedStyle(el).overflowX !== 'visible' && el.querySelector('table')) el.scrollLeft = el.scrollWidth;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/invoice-list-amounts-right.png`, fullPage: false });
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0; });
  await page.screenshot({ path: `${DIR}/invoice-list-left.png`, fullPage: false });
});

test('metal invoice list amounts over 23-25/06', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).first().click({ timeout: 30_000 }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  // PrimeNG range calendar: click the input, then day 23 and day 25 of June 2026
  const inputs = page.locator('input').locator('visible=true');
  let range = inputs.first();
  for (let i = 0; i < await inputs.count(); i++) {
    if (/\d{2}\/\d{2}\/\d{4}\s*-/.test(await inputs.nth(i).inputValue().catch(() => ''))) { range = inputs.nth(i); break; }
  }
  await range.click();
  const cal = page.locator('.p-datepicker-calendar-container').first();
  await cal.waitFor({ state: 'visible', timeout: 10_000 });
  const day = (d) => cal.getByRole('gridcell', { name: String(d), exact: true }).first();
  await day(23).click();
  await page.waitForTimeout(500);
  await day(25).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape').catch(() => {});
  const how = await range.inputValue().catch(() => '?');
  console.log(`DATE RANGE: ${how}`);
  // the grid reloads on its own Search box (Enter) - type the invoice series prefix
  const gridSearch = page.locator('input[placeholder="Search"]').filter({ hasNot: page.locator('xpath=ancestor::header') }).locator('visible=true').last();
  await gridSearch.fill(process.env.INV_SEARCH || 'SSS');
  await gridSearch.press('Enter');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  console.log(`RECORDS: ${(await page.getByText(/Records\s*:\s*\d+/).first().textContent().catch(() => '?')).trim()}`);
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_500);
  const data = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => x.offsetParent && x.querySelector('thead th'));
    const heads = [...t.querySelectorAll('thead th')].map((h) => h.innerText.replace(/\s+/g, ' ').trim());
    const rows = [...t.querySelectorAll('tbody tr')].filter((r) => r.offsetParent).map((r) => [...r.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
    return { heads, rows: rows.slice(0, 12) };
  });
  const cols = data.heads.map((h, i) => ({ h, i })).filter((c) => /amount|charges|taxable|collection|payable|deduction/i.test(c.h));
  for (const r of data.rows) console.log(`INVOICE ${r[2] || r[1]}: ${cols.map((c) => `${c.h}=${r[c.i]}`).join(' | ')}`);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollWidth > el.clientWidth + 50 && getComputedStyle(el).overflowX !== 'visible' && el.querySelector('table')) el.scrollLeft = el.scrollWidth;
    }
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/invoice-list-amounts-right.png`, fullPage: false });
});

test('invoice list date picker shape', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).first().click({ timeout: 30_000 }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const inp = page.locator('input').filter({ hasNot: page.locator('xpath=ancestor::header') }).locator('visible=true');
  const n = await inp.count();
  for (let i = 0; i < n; i++) {
    const v = await inp.nth(i).inputValue().catch(() => '');
    if (/\d{2}\/\d{2}\/\d{4}\s*-/.test(v)) {
      await inp.nth(i).click();
      await page.waitForTimeout(1_200);
      const pop = await page.evaluate(() => [...document.querySelectorAll('bs-daterangepicker-container, .bs-datepicker, .daterangepicker, ngb-datepicker, .mat-datepicker-content, [class*="picker"], [class*="calendar"]')].filter((e) => e.offsetParent).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} :: ${e.innerText.replace(/\s+/g, ' ').slice(0, 300)}`));
      console.log(`PICKER: ${JSON.stringify(pop.slice(0, 5))}`);
      await page.screenshot({ path: `${DIR}/tmp-picker.png`, fullPage: false });
      break;
    }
  }
});
