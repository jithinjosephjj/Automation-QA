const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the admin approval queue (/adm/app-approval) - tabs,
// headers, rows naming PROBE_DOC (default SS13), its buttons, and the
// Approval Rule list for stone inwards.
test('PROBE approval queue', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(240_000);
  const doc = process.env.PROBE_DOC || 'SS13';
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/Approval/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method()) || /Translation|KeepAlive/i.test(r.url())) return;
    const text = await r.text().catch(() => '');
    if (text.includes(doc)) console.log(`API ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} req=${(r.request().postData() || '').slice(0, 200)} res=${text.slice(0, 900)}`);
  });
  const dump = async (label) => {
    const info = await page.evaluate((d) => {
      const vis = (n) => !!n.offsetParent;
      return {
        url: location.pathname,
        tabs: [...document.querySelectorAll('[role=tab], .nav-link')].filter(vis).map((t) => t.textContent.trim()).filter(Boolean).slice(0, 20),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean).slice(0, 20),
        rows: [...document.querySelectorAll('tbody tr, .card')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t.includes(d)).map((t) => t.slice(0, 300)).slice(0, 5),
        rowCount: [...document.querySelectorAll('tbody tr')].filter(vis).length,
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30).slice(0, 30),
      };
    }, doc);
    console.log(`${label}: ${JSON.stringify(info)}`);
  };
  await logisticsSales.goto('/adm/app-approval');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await dump('APPROVAL page');
  await logisticsSales.goto('/ite/Approval-RuleMaster');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_500);
  const rules = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 160));
  console.log(`APPROVAL RULES: ${JSON.stringify(rules.slice(0, 20))}`);
});
