const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): open the "Stone Rule" (Approval Rule) and the Stone
// Inward approval work flow records and dump their forms + the API bodies
// that load them: the trigger condition and the approver(s).
test('PROBE stone approval rule', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/Approval(Rule|Workflow|Committee|Category)/i.test(r.url()) || /Pagination|Translation/i.test(r.url())) return;
    const text = await r.text().catch(() => '');
    if (!text || text.startsWith('<')) return;
    console.log(`API ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} res=${text.slice(0, 1500)}`);
  });
  const formText = async (label) => {
    const t = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const sel = [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')}=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|')}`);
      const inp = [...document.querySelectorAll('input:not([type=checkbox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder}=${i.value}`);
      const text = (document.querySelector('.modal.show, ngb-modal-window, .offcanvas.show, form') || document.body).innerText.replace(/s+/g, ' ').slice(0, 2500);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 10);
      return { url: location.pathname, sel, inp: inp.slice(0, 20), rows, text };
    });
    console.log(`${label}: ${JSON.stringify(t)}`);
  };
  for (const [route, key] of [['/ite/Approval-RuleMaster', 'Stone Rule'], ['/ite/Approval-Work-Flow', 'Stone Inward']]) {
    await logisticsSales.goto(route);
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(2_500);
    const row = page.locator('tbody tr').filter({ hasText: key }).first();
    if (!(await row.count())) { console.log(`${route}: no row "${key}"`); continue; }
    const edit = row.locator('td').nth(1);
    await edit.hover().catch(() => {});
    await edit.click().catch(() => {});
    await logisticsSales.settle(1_500);
    if (await page.locator('tbody tr').filter({ hasText: key }).count()) { await row.dblclick().catch(() => {}); }
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(3_000);
    await formText(`RECORD ${key}`);
  }
});
