const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only): Counter Allocation lot mode - what does the lotNos
// multi-select offer after the vendor pick (untyped, then typed with a
// longer wait), and does Fetch Items stage the chain's tag?
test('PROBE counter allocation lot options', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  const st = makeState('e2e-approval-sales-state.json').readState();
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/CounterAllocation|Lot/i.test(r.url()) || /Pagination|KeepAlive/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 400); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 300)} res=${body}`);
  });
  await logisticsSales.goto('/sls/view-counter-allocation');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pick('masterDataValueID_JewelleryItemType', 'Metal');
  await logisticsSales.pick('groupCategoryMetalIDs', 'Gold', { closePanel: true });
  await logisticsSales.pickPreferred('masterDataValueID_ScanType', /lot/i);
  await logisticsSales.settle(1_500);
  await logisticsSales.pick('vendorIDs', 'RAJA', { exact: true, closePanel: true });
  await logisticsSales.settle(3_000);
  const host = page.locator('sioniq-ng-select[controlname="lotNos"] ng-select').first();
  await host.locator('.ng-select-container').click();
  await page.waitForTimeout(2_500);
  const panel = page.locator('.ng-dropdown-panel');
  const opts = (await panel.locator('.ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/[ \t\n]+/g, ' ').trim());
  console.log(`lotNos untyped: ${opts.length} options -> ${JSON.stringify(opts.slice(0, 20))}`);
  console.log(`lotNos panel html head: ${JSON.stringify((await panel.innerHTML().catch(() => '')).slice(0, 600))}`);
  await host.locator('input').first().fill(String(st.lotNo || 'NNNN3'));
  await page.waitForTimeout(3_500);
  const typed = (await panel.locator('.ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/[ \t\n]+/g, ' ').trim());
  console.log(`lotNos typed "${st.lotNo}": ${typed.length} options -> ${JSON.stringify(typed.slice(0, 20))}`);
  const target = panel.locator('.ng-option').filter({ hasText: String(st.lotNo) }).first();
  if (await target.count()) {
    await target.click();
    await page.keyboard.press('Escape');
    await logisticsSales.settle(1_500);
    await page.getByRole('button', { name: /Fetch Items/i }).locator('visible=true').last().click();
    await logisticsSales.settle(3_000);
    const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim().slice(0, 180));
    console.log(`after Fetch Items: ${JSON.stringify(rows.slice(0, 5))}`);
    console.log(`toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
  } else {
    console.log('lot option not found');
  }
});
