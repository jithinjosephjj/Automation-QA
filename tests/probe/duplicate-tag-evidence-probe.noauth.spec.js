const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY evidence for the duplicate barcode tag number defect (saves
 * nothing). Screenshots into bug-reports/shots-dup-tag/:
 *   1 Barcode > Generated Tags filtered on 2026-06-2400004 (as the barcode user)
 *   2 Counter Allocation list: cc46 carries the tag
 *   3 Counter Accept (Item Type Metal): nothing pending
 *   4 B2B Metal Invoice: the RFID scan answers "This tag is not in Counter stock."
 */
const TAG = '2026-06-2400004';
const RFID = '9A227E258A9740BE820F2277';
const DIR = 'bug-reports/shots-dup-tag';

async function search(page, base, key) {
  const box = page.locator('input[placeholder="Search"]').filter({ hasNot: page.locator('xpath=ancestor::header') }).locator('visible=true').last();
  if (await box.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await box.fill(key);
    await box.press('Enter').catch(() => {});
    await base.waitForIdle();
    await base.settle(2_500);
  }
}
const rows = async (page) => (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

test('1 generated tags carrying the same number', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123', bu: 'Cochin' });
  await barcodeGeneration.open();
  await barcodeGeneration.waitForSpinner();
  const view = page.getByRole('button', { name: 'Generated Tags' }).or(page.getByRole('tab', { name: 'Generated Tags' })).or(page.getByText(/^\s*Generated Tags\s*$/)).locator('visible=true').first();
  await view.click().catch(() => {});
  await barcodeGeneration.waitForIdle();
  await barcodeGeneration.settle(3_000);
  await search(page, barcodeGeneration, TAG);
  const r = await rows(page);
  console.log(`GENERATED TAGS headers: ${JSON.stringify((await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.trim()).filter(Boolean))}`);
  console.log(`GENERATED TAGS rows for ${TAG}: ${JSON.stringify(r.filter((t) => t.includes(TAG)))}`);
  await page.screenshot({ path: `${DIR}/1-generated-tags.png`, fullPage: false });
});

test('2 counter allocation cc46', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await search(page, logisticsSales, TAG);
  console.log(`ALLOCATION rows: ${JSON.stringify((await rows(page)).filter((t) => t.includes(TAG)))}`);
  await page.screenshot({ path: `${DIR}/2-counter-allocation.png`, fullPage: false });
});

test('3 counter accept - nothing pending', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-accept-reject');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true }).catch(() => logisticsSales.pickTolerant('Item Type', 'Metal', { exact: true }));
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  console.log(`ACCEPT rows: ${JSON.stringify(await rows(page))}`);
  await page.screenshot({ path: `${DIR}/3-counter-accept-empty.png`, fullPage: false });
});

test('4 metal invoice RFID scan refused', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  // screenshot the moment the refusal toast shows (the page object throws
  // right after it, before any save can happen)
  const shot = page.getByText(/not in Counter stock/i).first().waitFor({ state: 'visible', timeout: 240_000 })
    .then(() => page.screenshot({ path: `${DIR}/4-invoice-not-in-counter-stock.png`, fullPage: false }))
    .catch(() => {});
  await logisticsSales.b2bSalesInvoice({ subType: 'Invoice', customer: 'RAJA', salesman: 'Ajin G', tagNo: TAG, rfidNo: RFID })
    .then(() => console.log('INVOICE: unexpectedly accepted the tag'))
    .catch((e) => console.log(`INVOICE refused: ${String(e).split('\n')[0]}`));
  await shot;
});

test('1b counter allocation list: the same tag number allocated twice', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  for (const t of ['2026-06-2400002', '2026-06-2400003', '2026-06-2400001']) {
    await search(page, logisticsSales, t);
    const r = (await rows(page)).filter((x) => x.includes(t));
    console.log(`ALLOCATION ${t}: ${r.length} rows ${JSON.stringify(r)}`);
    if (r.length > 1) {
      await page.screenshot({ path: `${DIR}/1-same-tag-allocated-twice-${t.slice(-2)}.png`, fullPage: false });
    }
  }
});

test('5 allocations per tag number 2400001..2400015', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const only = process.env.TAGS ? process.env.TAGS.split(',') : Array.from({ length: 15 }, (_, i) => `2026-06-24000${String(i + 1).padStart(2, '0')}`);
  for (const t of only) {
    await search(page, logisticsSales, t);
    const r = (await rows(page)).filter((x) => x.includes(t));
    console.log(`TAGCOUNT ${t}: ${r.length} allocation(s) ${JSON.stringify(r.map((x) => x.split(' ').slice(1, 3).concat(x.split(' ').slice(-6, -5)).join(' ')))}`);
    if (process.env.SHOT && r.length) await page.screenshot({ path: `${DIR}/${process.env.SHOT}-${t.slice(-2)}.png`, fullPage: false });
  }
});

test('6 counter allocation: scan tag number 2026-06-2400008 (no save)', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const tag = process.env.DUP_TAG || '2026-06-2400008';
  page.on('response', async (r) => {
    if (!/CounterAllocation\/(Scan|Fetch|Get)/i.test(r.url())) return;
    const b = await r.json().catch(() => null);
    const items = Array.isArray(b) ? b : b && Array.isArray(b.data) ? b.data : b ? [b] : [];
    console.log(`SCAN RESPONSE ${r.url().split('/').pop()}: ${JSON.stringify(items.map((i) => i && ({ tagNo: i.tagNo, rfidNo: i.rfidNo, lotNo: i.lotNo, gross: i.grossWeightTran })))}`);
  });
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('masterDataValueID_JewelleryItemType', 'Metal');
  await logisticsSales.pick('groupCategoryMetalIDs', 'Gold', { closePanel: true }).catch(() => {});
  await logisticsSales.pickPreferred('masterDataValueID_ScanType', /tag/i);
  await logisticsSales.settle(1_200);
  const scan = page.getByPlaceholder('Scan / type then press Enter');
  await scan.fill(tag);
  await scan.press('Enter');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const staged = (await rows(page)).filter((x) => x.includes(tag));
  console.log(`STAGED rows for ${tag}: ${JSON.stringify(staged)}`);
  await page.screenshot({ path: `${DIR}/6-allocation-scan-${tag.slice(-2)}.png`, fullPage: false });
  // leave without Add / Submit - nothing is saved
});

test('7 invoice SSS17 sold the first 2026-06-2400008', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  const tab = page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).first();
  await tab.click({ timeout: 30_000 }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await search(page, logisticsSales, 'SSS17');
  console.log(`INVOICE LIST headers: ${JSON.stringify((await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.trim()).filter(Boolean))}`);
  console.log(`INVOICE LIST SSS17: ${JSON.stringify((await rows(page)).filter((x) => /SSS17\b/.test(x)))}`);
  await page.screenshot({ path: `${DIR}/7-invoice-sss17-list.png`, fullPage: false });
  const row = page.locator('tbody tr').filter({ hasText: /SSS17\b/ }).first();
  // open the record (view icon / row double-click) to see its tag lines
  const view = row.locator('i.ri-eye-line, i[class*="eye"], button[title*="View" i]').first();
  if (await view.isVisible({ timeout: 2_000 }).catch(() => false)) await view.click();
  else await row.dblclick().catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const lines = (await rows(page)).filter((x) => /2026-06-24/.test(x));
  console.log(`INVOICE SSS17 tag lines: ${JSON.stringify(lines)}`);
  await page.screenshot({ path: `${DIR}/8-invoice-sss17-detail.png`, fullPage: false });
});
