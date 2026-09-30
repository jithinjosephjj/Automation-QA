const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing, scans nothing): the three sales-side
 * screens of the approval chain - Approval Issue, Approval Receipt, B2B
 * Metal Sales Invoice - for the test-case workbook. Dumps each LIST (columns,
 * a few rows) and each ADD form (every select with its options, every input,
 * grid columns, summary) after the header picks the chain makes. A fresh
 * scan is deliberately NOT attempted: Cochin's tag counter is currently
 * re-issuing numbers (duplicate-tag bug), so a scan would answer "Tag Not
 * Found" and teach nothing about the form.
 */
async function dump(page, label) {
  const info = await page.evaluate(() => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside, app-sidebar');
    const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
    return {
      selects: [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${ng?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}${ng?.classList.contains('ng-invalid') ? ' (invalid)' : ''}`; }),
      inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}`).slice(0, 40),
      checks: [...document.querySelectorAll('input[type=checkbox], .form-switch input, [role=switch]')].filter((c) => c.offsetParent && !c.closest('table')).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`),
      headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 260)).slice(0, 4),
      summary: [...document.querySelectorAll('app-summary, .summary, [class*="summary"]')].filter(vis).map((s) => s.innerText.replace(/\s+/g, ' ').trim().slice(0, 1200)).slice(0, 1).join(''),
      headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 60),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 32),
      tabs: [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim()),
    };
  });
  console.log(`${label}: ${JSON.stringify(info)}`);
  return info;
}
async function options(page, base, ctl) {
  const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
  if (!(await host.count())) { console.log(`  OPTIONS ${ctl}: (absent)`); return []; }
  if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
  console.log(`  OPTIONS ${ctl}: ${opts.length} -> ${JSON.stringify(opts.slice(0, 25))}`);
  await page.keyboard.press('Escape').catch(() => {});
  return opts;
}
async function allOptions(page, base, info, skip) {
  for (const s of info.selects) { const c = s.split(' ')[0]; if (c && c !== '?' && !skip.test(c)) await options(page, base, c); }
}

test('approval issue screen', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-b2b-approval-issue');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await dump(page, 'APPROVAL ISSUE list');
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.settle(2_500);
  const empty = await dump(page, 'APPROVAL ISSUE form (empty)');
  await allOptions(page, logisticsSales, empty, /^$/);
  await logisticsSales.pick('masterDataValueID_ApprovalIssueFrom', 'Stock', { exact: true });
  await logisticsSales.pick('masterDataValueID_ApprovalIssueTo', 'Customer', { exact: true });
  await logisticsSales.settle(2_000);
  const afterTo = await dump(page, 'APPROVAL ISSUE after Issue From Stock / Issue To Customer');
  await allOptions(page, logisticsSales, afterTo, /ApprovalIssueFrom|ApprovalIssueTo/);
  await logisticsSales.pick('b2BCustomerID', 'RAJA').catch(() => logisticsSales.pickByLabel('Customer', 'RAJA').catch(() => {}));
  await logisticsSales.settle(2_500);
  const afterCust = await dump(page, 'APPROVAL ISSUE after Customer');
  await allOptions(page, logisticsSales, afterCust, /ApprovalIssueFrom|ApprovalIssueTo|b2BCustomerID/);
  await page.screenshot({ path: 'test-results/adhoc/probe-approval-issue.png', fullPage: true });
  // the other Issue From / Issue To combinations - what renders for each
  for (const [from, to] of [['Stock', 'Line'], ['Line', 'Customer'], ['Line', 'Line']]) {
    await logisticsSales.pick('masterDataValueID_ApprovalIssueFrom', from, { exact: true }).catch((e) => console.log(`Issue From ${from}: ${String(e).split('\n')[0]}`));
    await logisticsSales.settle(1_000);
    await logisticsSales.pick('masterDataValueID_ApprovalIssueTo', to, { exact: true }).catch((e) => console.log(`Issue To ${to}: ${String(e).split('\n')[0]}`));
    await logisticsSales.settle(2_000);
    await dump(page, `APPROVAL ISSUE variant ${from} -> ${to}`);
  }
});

test('approval receipt screen', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/view-approval-receipt');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await dump(page, 'APPROVAL RECEIPT list');
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.settle(2_500);
  const empty = await dump(page, 'APPROVAL RECEIPT form (empty)');
  await allOptions(page, logisticsSales, empty, /^$/);
  for (const s of empty.selects) {
    const c = s.split(' ')[0];
    if (/ReceiptFrom|ReceivedFrom|ApprovalReceipt/i.test(c)) { await logisticsSales.pick(c, 'Customer', { exact: true }).catch(() => {}); }
  }
  await logisticsSales.pick('b2BCustomerID', 'RAJA').catch(() => logisticsSales.pickByLabel('Customer', 'RAJA').catch(() => {}));
  await logisticsSales.settle(2_500);
  const afterCust = await dump(page, 'APPROVAL RECEIPT after Customer');
  await allOptions(page, logisticsSales, afterCust, /b2BCustomerID/);
  await page.screenshot({ path: 'test-results/adhoc/probe-approval-receipt.png', fullPage: true });
});

test('metal invoice screen (Approval RC No)', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  await page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).first().click({ timeout: 30_000 }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  await dump(page, 'INVOICE list');
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.settle(2_500);
  const empty = await dump(page, 'INVOICE form (empty)');
  await allOptions(page, logisticsSales, empty, /^$/);
  await logisticsSales.pick('transactionSubTypeID', 'Invoice', { exact: true });
  await logisticsSales.pick('b2BCustomerID', 'RAJA');
  await logisticsSales.settle(2_000);
  const afterCust = await dump(page, 'INVOICE after Sub Type Invoice + Customer');
  await allOptions(page, logisticsSales, afterCust, /transactionSubTypeID|b2BCustomerID/);
  await logisticsSales.pickFirstByCaption('Customer Branch', /branch/i).catch(() => {});
  await logisticsSales.pick('masterDataValueID_StockSourceFrom', 'Counter', { exact: true }).catch(() => {});
  await logisticsSales.pick('masterDataValueID_InvoiceIssueType', 'Approval RC No', { exact: true }).catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const rc = await dump(page, 'INVOICE after Issue Type Approval RC No');
  await options(page, logisticsSales, 'approvalRCNos');
  await page.screenshot({ path: 'test-results/adhoc/probe-invoice-rc.png', fullPage: true });
  await logisticsSales.pick('masterDataValueID_InvoiceIssueType', 'Tag Wise', { exact: true }).catch(() => {});
  await logisticsSales.settle(2_000);
  await dump(page, 'INVOICE after Issue Type Tag Wise');
  await options(page, logisticsSales, 'masterDataValueID_ScanType');
});
