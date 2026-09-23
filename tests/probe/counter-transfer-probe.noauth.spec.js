const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only): Counter Transfer add form - what each "from" counter
// category reveals (selects, options, grid rows) and whether the tag that
// came back from approval (RRRR11, Stock Type "Counter") is listed there.
test('PROBE counter transfer form', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(400_000);
  const st = makeState('e2e-approval-sales-state.json').readState();
  const keys = [st.tagNo, st.rfidNo].filter(Boolean);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/CounterTransfer/i.test(r.url()) || /Pagination/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 500); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 250)} res=${body}`);
  });
  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => { const box = n.closest('.form-group, .col, [class*="col-"], div'); const lab = box && (box.querySelector('label') || box.previousElementSibling); return (lab ? lab.textContent : '').replace(/[ \t\n]+/g, ' ').trim().slice(0, 40); };
      const selects = [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')} [${captionOf(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}`);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => t && t.length < 30);
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/[ \t\n]+/g, ' ').trim().slice(0, 200));
      return { selects, inputs, buttons, headers: headers.slice(0, 25), rowCount: rows.length, rows: rows.slice(0, 6) };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    if (!(await host.count())) return [];
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${ctl}: ${JSON.stringify(opts.slice(0, 15))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  await logisticsSales.goto('/sls/view-counter-transfer');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.settle(1_500);
  await describe('TRANSFER form (empty)');
  for (const cat of ['Default Stock Accept Counter', 'General Counter']) {
    await logisticsSales.pick('from_MasterDataValueID_CounterCategory', cat, { exact: true });
    await logisticsSales.settle(2_500);
    const info = await describe(`after from category "${cat}"`);
    for (const s of info.selects) { const ctl = s.split(' ')[0]; if (ctl !== 'from_MasterDataValueID_CounterCategory' && s.includes('(empty)')) await options(ctl); }
    const hits = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => keys.some((k) => t.includes(k)));
    console.log(`  ours in grid: ${JSON.stringify(hits.map((t) => t.slice(0, 200)))}`);
    const scan = page.locator('input[placeholder*="Scan" i], input[formcontrolname="scanInput"]').locator('visible=true').first();
    if (await scan.count() && st.rfidNo) {
      await scan.fill(st.rfidNo);
      await scan.press('Enter');
      await logisticsSales.settle(3_000);
      console.log(`  after RFID scan toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
      await describe(`  after RFID scan (${cat})`);
    }
  }
});
