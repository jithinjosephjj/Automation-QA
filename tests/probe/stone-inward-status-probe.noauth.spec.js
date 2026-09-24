const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the Stone Inward list rows for SS12 / SS13 (or
// PROBE_DOCS=a,b) with their column headers, and the list API's JSON for
// them - why is one inward lot-eligible and the other not?
test('PROBE stone inward status', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(200_000);
  const docs = (process.env.PROBE_DOCS || 'SS12,SS13').split(',');
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/StockInwardStone.*Pagination|StoneInward.*Pagination/i.test(r.url()) || r.request().method() !== 'POST') return;
    const body = await r.json().catch(() => null);
    const rows = (body && body.data) || [];
    for (const d of docs) {
      const row = rows.find((x) => x.receiptNo === d);
      if (row) console.log(`API ${d}: ${JSON.stringify(row).slice(0, 900)}`);
    }
  });
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.waitForIdle();
  await stoneInward.settle(2_500);
  const headers = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
  console.log(`headers: ${JSON.stringify(headers)}`);
  const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  for (const d of docs) console.log(`ROW ${d}: ${JSON.stringify(rows.filter((t) => t.includes(d)).map((t) => t.slice(0, 300)))}`);
});
