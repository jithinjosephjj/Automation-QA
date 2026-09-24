const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): full visible text of /adm/app-approval, every
// Approval API answer it loads, and the "Stone Rule" record (Approval Rule
// + Approval Work Flow rows) to learn who approves stone inwards.
test('PROBE approval queue detail', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/Approval/i.test(r.url()) || /Translation|KeepAlive/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    const text = await r.text().catch(() => '');
    if (text.startsWith('<')) return;
    console.log(`API ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} req=${(r.request().postData() || '').slice(0, 150)} res=${text.slice(0, 700)}`);
  });
  await logisticsSales.goto('/adm/app-approval');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(4_000);
  const text = await page.evaluate(() => document.querySelector('.page-content, main, .container-fluid, body').innerText.replace(/\s+/g, ' ').slice(0, 2500));
  console.log(`APPROVAL PAGE TEXT: ${text}`);
  await logisticsSales.goto('/ite/Approval-Work-Flow');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_500);
  const wf = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 260));
  console.log(`WORK FLOWS: ${JSON.stringify(wf.slice(0, 20))}`);
});
