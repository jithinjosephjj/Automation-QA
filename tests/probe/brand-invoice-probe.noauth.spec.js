const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only): where does a BRAND tag get invoiced? Lists the sidebar
// links naming invoice / brand / sale, the tabs of /sls/app-invoice-setup,
// and for every invoice-like tab / route the Add form's selects and their
// options (looking for an Item Type or a brand-specific invoice).
test('PROBE brand invoice screens', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(400_000);
  const st = makeState('e2e-brand-sales-state.json').readState();
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })).filter((l) => l.href && l.href.startsWith('/')));
  console.log(`links naming invoice/brand/sale: ${JSON.stringify(links.filter((l) => /invoice|brand|sale/i.test(l.text + ' ' + l.href)))}`);

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => { const box = n.closest('.form-group, .col, [class*="col-"], div'); const lab = box && (box.querySelector('label') || box.previousElementSibling); return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
      return {
        url: location.pathname,
        tabs: [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim()),
        headings: [...document.querySelectorAll('h4, h5')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60).slice(0, 12),
        selects: [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')} [${captionOf(n)}]`).slice(0, 30),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30).slice(0, 25),
      };
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
    console.log(`  ${ctl}: ${JSON.stringify(opts.slice(0, 12))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };

  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_500);
  const list = await describe('INVOICE page');
  for (const t of list.tabs.filter((x) => /invoice/i.test(x))) {
    await page.getByRole('tab', { name: t, exact: true }).click().catch(() => {});
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(1_500);
    await logisticsSales.clickVisibleAdd().catch(() => console.log(`tab ${t}: no Add`));
    await logisticsSales.settle(2_000);
    const form = await describe(`ADD FORM of tab "${t}"`);
    for (const s of form.selects) {
      const ctl = s.split(' ')[0];
      if (/item|brand|type/i.test(ctl)) await options(ctl);
    }
    // does the header offer an Item Type? try scanning the brand tag by RFID in the default form
    if (st.rfidNo) {
      await logisticsSales.pickPreferred('transactionSubTypeID', /invoice/i).catch(() => {});
      await logisticsSales.pick('b2BCustomerID', 'RAJA').catch(() => {});
      await logisticsSales.pickFirstByCaption('Customer Branch', /branch/i, { optional: true });
      await logisticsSales.pickPreferred('masterDataValueID_StockSourceFrom', /counter/i).catch(() => {});
      await logisticsSales.pickPreferred('masterDataValueID_InvoiceIssueType', /tag/i, /approval/i).catch(() => {});
      await logisticsSales.pickPreferred('masterDataValueID_ScanType', /tag/i).catch(() => {});
      const scan = page.locator('input[formcontrolname="scanInput"], input#scanInput, input[placeholder*="Scan" i]').locator('visible=true').first();
      if (await scan.count()) {
        await scan.fill(st.tagNo);
        await scan.press('Enter');
        await page.waitForTimeout(3_000);
        console.log(`  scanning brand tag ${st.tagNo} by TAG NUMBER on "${t}": toasts ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
      }
    }
    await logisticsSales.goto('/sls/app-invoice-setup');
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(1_500);
  }
});
