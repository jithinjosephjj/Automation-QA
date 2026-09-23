const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only, nothing saved): what the Approval Issue form reveals
// after Issue From "Stock" / Issue To "Customer" / Stock Source "Counter" /
// Issue Type "Tag Wise", what the Approval Receipt form reveals after
// Receipt From "Customer", and which Issue Types the B2B invoice offers.
// PROBE_TAG=<tag> scans that tag on the issue form to see the staging grid.
test('PROBE approval issue / receipt cascades', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(500_000);
  await loginPage.ensureLoggedIn();
  const tag = process.env.PROBE_TAG || '';

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => {
        const box = n.closest('.form-group, .col, [class*="col-"], .mb-2, .mb-3, div');
        const lab = box && (box.querySelector('label') || box.previousElementSibling);
        return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40);
      };
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select'))
        .map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${captionOf(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|')}${(n.matches('ng-select') ? n : n.querySelector('ng-select'))?.classList.contains('ng-invalid') ? ' *' : ''}`);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar'))
        .map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 40);
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)).slice(0, 5);
      const headings = [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60);
      const toasts = [...document.querySelectorAll('.toast, .toast-message, [role=alert], .swal2-container')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5);
      return { headings, selects, inputs, buttons, headers: headers.slice(0, 30), rows, toasts };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).first();
    if (!(await host.count())) { console.log(`  select ${ctl}: (absent)`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  select ${ctl}: ${JSON.stringify(opts.slice(0, 15))}${opts.length > 15 ? ` (+${opts.length - 15})` : ''}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };

  // ---- Approval Issue ----
  await logisticsSales.goto('/sls/view-b2b-approval-issue');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  await logisticsSales.pick('masterDataValueID_ApprovalIssueFrom', 'Stock', { exact: true });
  await logisticsSales.settle(1_200);
  await logisticsSales.pick('masterDataValueID_ApprovalIssueTo', 'Customer', { exact: true });
  await logisticsSales.settle(1_500);
  await describe('ISSUE after From=Stock / To=Customer');
  await logisticsSales.pick('masterDataValueID_ApprovalIssuePurpose', 'Display', { exact: true });
  await logisticsSales.pick('masterDataValueID_StockSourceFrom', 'Counter', { exact: true });
  await logisticsSales.settle(1_200);
  await logisticsSales.pick('masterDataValueID_ApprovalIssueType', 'Tag Wise', { exact: true });
  await logisticsSales.settle(2_000);
  const issue = await describe('ISSUE after Purpose/Source=Counter/Type=Tag Wise');
  for (const s of issue.selects) {
    const ctl = s.split(' ')[0];
    if (!/ApprovalIssueFrom|ApprovalIssueTo|ApprovalIssuePurpose|StockSourceFrom|ApprovalIssueType|salesmanIDs|helperID|supervisorID|ReferralType/.test(ctl)) await options(ctl);
  }
  if (tag) {
    const scan = page.locator('input[placeholder*="Scan" i], input[formcontrolname="scanInput"], input#scanInput').locator('visible=true').first();
    if (await scan.count()) {
      await scan.fill(tag);
      await scan.press('Enter');
      await logisticsSales.settle(2_500);
      await describe(`ISSUE after scanning ${tag} (Enter)`);
      const add = page.locator('button').filter({ hasText: /^\s*\+?\s*Add\s*$/ }).locator('visible=true').last();
      if (await add.count()) { await add.click(); await logisticsSales.settle(2_000); await describe('ISSUE after Add'); }
    } else {
      console.log('ISSUE: no scan input found');
    }
  }
  await page.screenshot({ path: 'test-results/screens/probe-approval-issue-cascade.png', fullPage: true }).catch(() => {});

  // ---- Approval Receipt ----
  await logisticsSales.goto('/sls/view-approval-receipt');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  await logisticsSales.pick('masterDataValueID_ApprovalReceiptFrom', 'Customer', { exact: true });
  await logisticsSales.settle(1_500);
  await logisticsSales.pick('masterDataValueID_ApprovalReceiptTo', 'Stock', { exact: true }).catch(() => {});
  await logisticsSales.settle(1_500);
  const rc = await describe('RECEIPT after From=Customer / To=Stock');
  for (const s of rc.selects) {
    const ctl = s.split(' ')[0];
    if (!/ApprovalReceiptFrom|ApprovalReceiptTo|ReceiptMode|ScanType|ApprovalReceiptType/.test(ctl)) {
      const opts = await options(ctl);
      if (ctl === 'approvalIssueIDs' && opts.join().includes('Type to search')) {
        const host = page.locator('sioniq-ng-select[controlname="approvalIssueIDs"] ng-select').first();
        await host.locator('.ng-select-container').click().catch(() => {});
        await host.locator('input').first().fill('A').catch(() => {});
        await page.waitForTimeout(2_000);
        console.log(`  approvalIssueIDs typed "A": ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).slice(0, 10))}`);
        await page.keyboard.press('Escape');
      }
    }
  }
  await page.screenshot({ path: 'test-results/screens/probe-approval-receipt-cascade.png', fullPage: true }).catch(() => {});

  // ---- B2B invoice: issue types ----
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  const tab = page.getByRole('tab', { name: 'B2B Metal Sales Invoice' }).or(page.getByRole('button', { name: 'B2B Metal Sales Invoice' })).first();
  if (await tab.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)) {
    await tab.click();
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(1_500);
    await logisticsSales.clickVisibleAdd();
    await logisticsSales.settle(2_000);
    await options('transactionSubTypeID');
    await options('masterDataValueID_StockSourceFrom');
    await options('masterDataValueID_InvoiceIssueType');
  } else {
    console.log('INVOICE: B2B tab not found');
  }
});
