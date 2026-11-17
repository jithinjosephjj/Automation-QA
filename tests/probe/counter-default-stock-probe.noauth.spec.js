const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only, nothing saved): where a tag allocated with
// requiresAcceptance:false sits at Kakkanad (17-11-2026: the B2B invoice scan
// answers "This tag belongs to the default stock counter and cannot be
// added"). Dumps (1) the Counter Allocation add form - every select and its
// options, incl. any counter / sub counter target; the list row of the chain's
// allocation; (2) Counter Transfer from "Default Stock Accept Counter" and
// "General Counter" - is the chain's tag listed, what "to" selects offer;
// (3) the B2B invoice Issue Type / Stock Source options. Run:
//   npx playwright test tests/probe/counter-default-stock-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE counter allocation target + default stock counter', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(500_000);
  const st = makeState('e2e-logistics-sales-state.json').readState();
  const keys = [st.tagNo, st.rfidNo].filter(Boolean);
  console.log(`chain state: ${JSON.stringify(st)}`);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = logisticsSales;
  page.on('response', async (r) => {
    if (!/CounterAllocation|CounterTransfer|CounterAccept|Invoice\/(Scan|Get)|GetTag|TagDetails/i.test(r.url()) || /Pagination|GetAll/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 700); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 300)} res=${body}`);
  });
  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => { const box = n.closest('.form-group, .col, [class*="col-"], div'); const lab = box && (box.querySelector('label') || box.previousElementSibling); return (lab ? lab.textContent : '').replace(/[ \t\n]+/g, ' ').trim().slice(0, 40); };
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select[formcontrolname]')].filter(vis).map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname')} [${captionOf(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}`);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]="${i.value}"`);
      const checks = [...document.querySelectorAll('input[type=checkbox], [role=switch]')].filter(vis).map((c) => `${c.id || c.getAttribute('formcontrolname') || '-'} [${captionOf(c)}]=${c.checked}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => t && t.length < 30);
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/[ \t\n]+/g, ' ').trim().slice(0, 220));
      return { selects, inputs, checks, buttons, headers: headers.slice(0, 30), rowCount: rows.length, rows: rows.slice(0, 5) };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).first();
    if (!(await host.count())) return [];
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${ctl}: ${JSON.stringify(opts.slice(0, 20))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  const ours = async (label) => {
    const hits = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => keys.some((k) => t.includes(k)));
    console.log(`  ${label} - ours in grid: ${JSON.stringify(hits.map((t) => t.slice(0, 260)))}`);
  };

  // (1) Counter Allocation list row of the chain's allocation, then the add form
  await pg.goto('/sls/view-counter-allocation');
  await pg.waitForIdle();
  await pg.settle(3_000);
  if (st.allocationNo) { await pg.searchGrid(st.allocationNo).catch(() => {}); await pg.settle(2_500); }
  const listInfo = await describe('ALLOCATION LIST');
  const row = page.locator('tbody tr').filter({ hasText: st.allocationNo || '___' }).first();
  if (await row.count()) {
    console.log(`  allocation row: ${(await row.innerText()).replace(/\s+/g, ' ')}`);
    // open it (view) when the row offers a view/edit control
    const view = row.locator('button, a, i').first();
    await row.click().catch(() => {});
    await pg.settle(2_500);
    await describe('ALLOCATION ROW OPENED');
    await ours('allocation view');
    await page.screenshot({ path: 'test-results/screens/probe-allocation-view.png', fullPage: true }).catch(() => {});
  }
  await pg.goto('/sls/view-counter-allocation');
  await pg.waitForIdle();
  await pg.clickVisibleAdd();
  await pg.settle(2_000);
  await describe('ALLOCATION FORM OPEN');
  await pg.pick('masterDataValueID_JewelleryItemType', 'Metal');
  await pg.settle(1_500);
  await pg.pick('groupCategoryMetalIDs', 'Gold', { closePanel: true }).catch((e) => console.log('group pick failed ' + e.message.split('\n')[0]));
  await pg.settle(1_500);
  await pg.pickPreferred('masterDataValueID_ScanType', /lot/i);
  await pg.settle(1_500);
  const f = await describe('ALLOCATION FORM after Metal/Gold/Lot');
  for (const s of f.selects) { const ctl = s.split(' ')[0]; if (!/JewelleryItemType|groupCategory|ScanType/.test(ctl)) await options(ctl); }
  await page.screenshot({ path: 'test-results/screens/probe-allocation-form.png', fullPage: true }).catch(() => {});

  // (2) Counter Transfer: is our tag parked on the Default Stock Accept Counter?
  await pg.goto('/sls/view-counter-transfer');
  await pg.waitForIdle();
  await pg.clickVisibleAdd();
  await pg.settle(1_500);
  await describe('TRANSFER form (empty)');
  await options('from_MasterDataValueID_CounterCategory');
  for (const cat of ['Default Stock Accept Counter', 'General Counter']) {
    const ok = await pg.pick('from_MasterDataValueID_CounterCategory', cat, { exact: true }).then(() => true).catch((e) => { console.log(`from category ${cat}: ${e.message.split('\n')[0]}`); return false; });
    if (!ok) continue;
    await pg.settle(3_000);
    const info = await describe(`TRANSFER after from category "${cat}"`);
    for (const s of info.selects) { const ctl = s.split(' ')[0]; if (ctl !== 'from_MasterDataValueID_CounterCategory') await options(ctl); }
    await ours(cat);
    const scan = page.locator('input[placeholder*="Scan" i], input[formcontrolname="scanInput"]').locator('visible=true').first();
    if ((await scan.count()) && st.rfidNo) {
      await scan.fill(st.rfidNo);
      await scan.press('Enter');
      await pg.settle(3_000);
      console.log(`  after RFID scan (${cat}) toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
      await ours(`${cat} after scan`);
    }
    await page.screenshot({ path: `test-results/screens/probe-transfer-${cat.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  }

  // (3) B2B invoice: Issue Type / Stock Source options
  await pg.goto('/sls/app-invoice-setup');
  await pg.waitForIdle();
  const tab = page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).or(page.getByRole('button', { name: /^(B2B )?Metal (Sales )?Invoice$/ })).first();
  await tab.waitFor({ state: 'visible', timeout: 60_000 });
  await tab.click();
  await pg.waitForIdle();
  await pg.settle(1_500);
  await pg.clickVisibleAdd();
  await pg.settle(2_000);
  const inv = await describe('INVOICE form');
  for (const ctl of ['masterDataValueID_StockSourceFrom', 'masterDataValueID_InvoiceIssueType', 'masterDataValueID_ScanType']) await options(ctl);
});
