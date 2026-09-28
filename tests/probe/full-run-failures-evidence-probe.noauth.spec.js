const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY evidence probe (saves nothing) for the full run of 26-09-2026:
 *  - the Stone Inward list status of the inwards the stone chains saved that
 *    day (SS27..SS30) - held for approval ("Created") or approved?
 *  - the Approval inbox - are they pending there?
 *  - the Counter Accept list - was the GRN chain's tag 2026-06-2400004
 *    (RFID 9A227E258A9740BE820F2277) really accepted?
 */
const rowsText = async (page) => (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const headers = async (page) => (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);

async function searchList(page, base, key) {
  const box = page.locator('input[placeholder="Search"]').filter({ hasNot: page.locator('xpath=ancestor::header') }).locator('visible=true').last();
  if (await box.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await box.fill(key);
    await box.press('Enter').catch(() => {});
    await base.waitForIdle();
    await base.settle(2_000);
  }
  return (await rowsText(page)).filter((t) => t.toLowerCase().includes(key.toLowerCase()));
}

test('evidence: stone inward status of SS27..SS31', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.settle(2_500);
  console.log(`STONE LIST headers: ${JSON.stringify(await headers(page))}`);
  for (const no of ['SS27', 'SS28', 'SS29', 'SS30', 'SS31', 'SS22', 'SS20', 'SS10']) {
    const rows = await searchList(page, stoneInward, no);
    console.log(`STONE ${no}: ${JSON.stringify(rows.filter((t) => new RegExp(`\\b${no}\\b`).test(t)).map((t) => t.slice(0, 220)))}`);
  }
});

test('evidence: approval inbox', async ({ loginPage, stoneInward, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await stoneInward.goto('/adm/app-approval');
  await stoneInward.waitForIdle();
  await stoneInward.settle(4_000);
  const tabs = (await page.getByRole('tab').allInnerTexts().catch(() => [])).map((t) => t.trim());
  console.log(`APPROVAL tabs: ${JSON.stringify(tabs)}`);
  console.log(`APPROVAL headers: ${JSON.stringify(await headers(page))}`);
  const rows = await rowsText(page);
  console.log(`APPROVAL ${rows.length} rows: ${JSON.stringify(rows.slice(0, 25).map((t) => t.slice(0, 200)))}`);
  console.log(`APPROVAL rows naming SS27..SS30: ${JSON.stringify(rows.filter((t) => /\bSS(27|28|29|30)\b/.test(t)).map((t) => t.slice(0, 220)))}`);
  await page.screenshot({ path: 'test-results/evidence-approval.png', fullPage: true });
});

test('evidence: counter accept list for the GRN tag', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-accept-reject');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  console.log(`ACCEPT LIST headers: ${JSON.stringify(await headers(page))}`);
  const all = await rowsText(page);
  console.log(`ACCEPT LIST first rows: ${JSON.stringify(all.slice(0, 8).map((t) => t.slice(0, 200)))}`);
  for (const key of ['2026-06-2400004', '9A227E258A9740BE820F2277', 'cc46']) {
    const rows = await searchList(page, logisticsSales, key);
    console.log(`ACCEPT LIST ${key}: ${JSON.stringify(rows.map((t) => t.slice(0, 220)))}`);
  }
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  console.log(`ALLOCATION LIST headers: ${JSON.stringify(await headers(page))}`);
  for (const key of ['cc46', '2026-06-2400004']) {
    const rows = await searchList(page, logisticsSales, key);
    console.log(`ALLOCATION LIST ${key}: ${JSON.stringify(rows.map((t) => t.slice(0, 220)))}`);
  }
});

test('evidence: is the GRN tag still pending in Counter Accept (no save)', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-counter-accept-reject');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true }).catch(() => logisticsSales.pickTolerant('Item Type', 'Metal', { exact: true }));
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  console.log(`PENDING ACCEPT headers: ${JSON.stringify(await headers(page))}`);
  const rows = await rowsText(page);
  console.log(`PENDING ACCEPT ${rows.length} rows: ${JSON.stringify(rows.slice(0, 20).map((t) => t.slice(0, 220)))}`);
  console.log(`PENDING ACCEPT rows for the GRN tag: ${JSON.stringify(rows.filter((t) => /2026-06-2400004|9A227E258A9740BE820F2277/.test(t)))}`);
  await page.screenshot({ path: 'test-results/evidence-pending-accept.png', fullPage: true });
});
