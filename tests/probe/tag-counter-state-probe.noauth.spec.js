const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only): where is the chain's tag after Counter Allocation +
// Counter Accept? The invoice says "This tag is not in Counter stock." -
// list the tag's rows on the Counter Allocation list, the Counter Accept
// pending grid, the Counter Transfer add form (counter stock) and the
// Barcode Generated Tags list, and dump the allocation/accept API answers.
test('PROBE tag counter state', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(400_000);
  const st = makeState('e2e-approval-sales-state.json').readState();
  const tagNo = process.env.PROBE_TAG || st.tagNo;
  console.log(`probing tag ${tagNo} (allocation ${st.allocationNo}, accepted ${st.counterAccepted})`);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });

  page.on('response', async (r) => {
    const url = r.url();
    if (!/Counter|Tag|Barcode/i.test(url) || /KeepAlive|Translation|\.js|\.css|\.png|\.svg/i.test(url)) return;
    const req = r.request();
    if (!['POST', 'PUT'].includes(req.method())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 700); } catch { body = '(no body)'; }
    console.log(`API ${req.method()} ${r.status()} ${url.replace(/^https?:\/\/[^/]+/, '')} req=${(req.postData() || '').slice(0, 300)} res=${body}`);
  });

  const rowsWith = async (label, needle) => {
    const rows = await page.locator('tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
    const norm = rows.map((t) => t.replace(/\s+/g, ' ').trim());
    const hits = norm.filter((t) => t.includes(needle));
    const headers = await page.locator('th').locator('visible=true').allInnerTexts().catch(() => []);
    console.log(`${label}: ${norm.length} rows, ${hits.length} with "${needle}" -> ${JSON.stringify(hits.map((t) => t.slice(0, 220)))}`);
    if (hits.length) console.log(`${label} headers: ${JSON.stringify(headers.map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean).slice(0, 25))}`);
    return hits;
  };
  const search = async (text) => {
    const box = page.getByRole('textbox', { name: 'Search' }).locator('visible=true').first();
    if (await box.count()) { await box.fill(text); await box.press('Enter'); await logisticsSales.settle(2_500); }
  };

  // 1. Counter Allocation list
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await search(st.allocationNo || tagNo);
  await rowsWith('ALLOCATION list', st.allocationNo || tagNo);

  // 2. Counter Accept list + pending grid
  await logisticsSales.goto('/sls/view-counter-accept-reject');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await rowsWith('ACCEPT list (first page)', 'AAA');
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pickTolerant('Item Type *', 'Metal').catch(() => logisticsSales.pickTolerant('Item Type', 'Metal'));
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_500);
  await rowsWith('ACCEPT pending grid', tagNo);

  // 3. Counter Transfer add form - counter stock
  await logisticsSales.goto('/sls/view-counter-transfer');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await logisticsSales.clickVisibleAdd().catch(() => console.log('counter transfer: no Add'));
  const sel = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent).map((n) => n.getAttribute('controlname')));
  console.log(`COUNTER TRANSFER form selects: ${JSON.stringify(sel)}`);
  for (const ctl of sel) {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${ctl}: ${JSON.stringify(opts.slice(0, 12))}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
  const scan = page.locator('input[placeholder*="Scan" i], input[formcontrolname="scanInput"]').locator('visible=true').first();
  if (await scan.count()) {
    await scan.fill(tagNo);
    await scan.press('Enter');
    await page.waitForTimeout(3_500);
    await rowsWith('COUNTER TRANSFER after scan', tagNo);
    console.log(`COUNTER TRANSFER toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
  }

  // 4. Barcode Generated Tags list
  await logisticsSales.goto('/inv/view-barcode-generation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  const tagsTab = page.getByRole('tab', { name: /Generated Tags/i }).first();
  if (await tagsTab.count()) { await tagsTab.click(); await logisticsSales.settle(2_000); }
  await search(tagNo);
  await rowsWith('GENERATED TAGS', tagNo);
});
