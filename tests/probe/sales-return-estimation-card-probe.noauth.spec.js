const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE (read-only): what makes the Sales Return Estimation's ITEM CARD (Weight /
// Pricing Details + "Add Item") render after the old-bill search. The search by
// bill number pre-fills the "Item No" select but the card does not always come
// (bills 94 and 98, 14-11-2026). Tries, in order, dumping the card state after
// each: Enter in the bill box; the Search button; re-picking the Item No;
// typing the receipt item no ("<bill>.1") + Enter. Nothing is saved.
//   BILL=98 npx playwright test tests/probe/sales-return-estimation-card-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE sales return estimation item card trigger', async ({ loginPage, salesReturn, page }) => {
  test.setTimeout(400_000);
  const bill = process.env.BILL || '98';
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = salesReturn;
  const calls = [];
  page.on('response', async (r) => {
    if (/sioniq\/.*(SalesReturn|Tax)/i.test(r.url()) && !/Lookup|Pagination|KeepAlive/i.test(r.url())) calls.push(`${new Date().toTimeString().slice(0, 8)} ${r.status()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} req:${(r.request().postData() || '').slice(0, 120)}`);
  });
  const state = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const t = document.body.innerText.replace(/\s+/g, ' ');
      return {
        itemNo: (document.querySelector('sioniq-ng-select[controlname="selectedSalesInvoiceItemID"] .ng-value') || {}).textContent?.replace(/×/g, '').trim() || '',
        addItem: [...document.querySelectorAll('button')].some((b) => vis(b) && /Add Item/.test(b.textContent)),
        card: /Weight Details/.test(t) && /Pricing Details/.test(t),
        entries: [...document.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).filter((x) => !/No items/.test(x)).slice(0, 3),
        alerts: [...document.querySelectorAll('[role=alert], .toast')].filter(vis).map((a) => a.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info)}`);
    return info;
  };

  await pg.goto('/pos/app-order-estimation-setup');
  await pg.waitForIdle();
  await pg.waitForSpinner();
  await page.getByRole('tab', { name: /^\s*Sales Return Estimation\s*$/ }).locator('visible=true').first().click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(2_000);
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await pg.select('masterDataValueID_RetailSalesReturnType').waitFor({ state: 'visible', timeout: 15_000 });
  await pg.settle(2_000);
  await pg.pickUnlessSet('masterDataValueID_BusinessType', 'Retail');
  await pg.settle(1_500);
  await pg.pick('salesmanID', 'AJ10', { search: true, exact: true });
  await pg.pick('helperID', 'Chandu', { search: true }).catch(() => {});
  await pg.settle(1_000);

  const box = page.locator('input#receiptItemNo').locator('visible=true').first();
  await box.fill(bill);
  await box.press('Enter');
  await pg.waitForIdle();
  await page.waitForTimeout(6_000);
  let s = await state('1. after Enter (bill no)');
  if (!s.addItem) {
    const searchBtn = page.locator('button').filter({ hasText: /^\s*Search\s*$/ }).locator('visible=true').last();
    console.log(`Search button visible: ${await searchBtn.isVisible().catch(() => false)}`);
    if (await searchBtn.isVisible().catch(() => false)) { await searchBtn.click(); await pg.waitForIdle(); await page.waitForTimeout(6_000); s = await state('2. after Search button'); }
  }
  if (!s.addItem) {
    const host = pg.select('selectedSalesInvoiceItemID');
    if (await host.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await host.locator('.ng-clear-wrapper, .ng-clear').first().click({ timeout: 2_000 }).catch(() => {});
      await pg.settle(800);
      await pg.pick('selectedSalesInvoiceItemID', `${bill}.1`, { exact: true }).catch((e) => console.log('pick failed ' + e.message.split('\n')[0]));
      await pg.waitForIdle();
      await page.waitForTimeout(6_000);
      s = await state('3. after re-picking Item No');
    }
  }
  if (!s.addItem) {
    await box.fill(`${bill}.1`);
    await box.press('Enter');
    await pg.waitForIdle();
    await page.waitForTimeout(6_000);
    s = await state('4. after typing the receipt item no + Enter');
  }
  if (!s.addItem) {
    const searchBtn = page.locator('button').filter({ hasText: /^\s*Search\s*$/ }).locator('visible=true').last();
    if (await searchBtn.isVisible().catch(() => false)) { await searchBtn.click(); await pg.waitForIdle(); await page.waitForTimeout(6_000); s = await state('5. after Search button with the item no'); }
  }
  await page.screenshot({ path: 'test-results/screens/probe-sre-card.png', fullPage: true }).catch(() => {});
  console.log('calls ' + JSON.stringify(calls, null, 1));
});
