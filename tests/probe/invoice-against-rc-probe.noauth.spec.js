const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (SAVES): can a tag that is OUT on approval be invoiced through the
// Metal Invoice's Issue Type "Approval RC No"? Issues the chain's tag on
// approval once more (it is back on its counter), then on the invoice picks
// that RC, ticks the tag, "Add Selected", enters the metal rate and
// Submits. Logs every step; writes the invoice number into the state file.
test('PROBE invoice against an approval RC', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(600_000);
  const state = makeState('e2e-approval-sales-state.json');
  const st = state.readState();
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/B2BSalesInvoice\/(GetApprovalRC|Save|Resolve|GetApprovalIssueTags|Get.*Tags)/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 500); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} res=${body}`);
  });

  // 1. the tag goes out on approval again
  let rc = '';
  try {
    rc = await logisticsSales.approvalIssue({ customer: 'RAJA', purpose: 'Display', salesman: 'Ajin G', helper: 'Ajin G', supervisor: 'Ajin G', tagNo: st.tagNo, rfidNo: st.rfidNo, metalRate: 6000 });
    console.log(`approval issue saved again: ${rc}`);
    state.writeState({ approvalRcNo2: rc });
  } catch (e) {
    console.log(`approval issue failed: ${String(e).split('\n')[0]}`);
    return;
  }

  // 2. invoice against that RC
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  const tab = page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).or(page.getByRole('button', { name: /^(B2B )?Metal (Sales )?Invoice$/ })).first();
  await tab.waitFor({ state: 'visible', timeout: 30_000 });
  await tab.click();
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pickPreferred('transactionSubTypeID', /invoice/i);
  await logisticsSales.pick('b2BCustomerID', 'RAJA');
  await logisticsSales.pickFirstByCaption('Customer Branch', /branch/i, { optional: true });
  await logisticsSales.pick('salesmanIDs', 'Ajin G', { closePanel: true }).catch(() => {});
  await logisticsSales.pickPreferred('masterDataValueID_StockSourceFrom', /counter/i).catch(() => {});
  await logisticsSales.pick('masterDataValueID_InvoiceIssueType', 'Approval RC No', { exact: true });
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  const host = page.locator('sioniq-ng-select[controlname="approvalRCNos"] ng-select').first();
  await host.locator('.ng-select-container').click();
  await page.waitForTimeout(1_500);
  let opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`approvalRCNos options: ${JSON.stringify(opts.slice(0, 10))}`);
  if (!opts.some((o) => o.includes(rc))) {
    await host.locator('input').first().fill(rc);
    await page.waitForTimeout(2_000);
    opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    console.log(`approvalRCNos typed ${rc}: ${JSON.stringify(opts.slice(0, 10))}`);
  }
  const opt = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: rc }).first();
  if (!(await opt.count())) { console.log('RC not offered'); return; }
  await opt.click();
  await page.keyboard.press('Escape').catch(() => {});
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(3_000);
  const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
  console.log(`rows after RC pick: ${JSON.stringify(rows.slice(0, 6))}`);
  const row = logisticsSales.rowMatcher(st.tagNo).first();
  if (await row.count()) {
    const box = row.getByRole('checkbox').first();
    if (await box.count()) await box.check({ force: true }).catch(() => row.click());
    else await row.click();
    await logisticsSales.settle(800);
    await page.getByRole('button', { name: /Add Selected/i }).locator('visible=true').last().click();
    await logisticsSales.settle(2_500);
    const after = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 200));
    console.log(`rows after Add Selected: ${JSON.stringify(after.slice(0, 6))}`);
    console.log(`toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
    await logisticsSales.fillMetalRateIfEmpty(6000);
    try {
      const body = await logisticsSales.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
      console.log(`INVOICE SAVED: ${JSON.stringify(body && body.data)}`);
      state.writeState({ invoiceDocNo: (body && body.data && (body.data.receiptNo || body.data.invoiceNo)) || '', invoicedVia: `Approval RC No ${rc}` });
      await logisticsSales.previewAndClose();
    } catch (e) {
      console.log(`invoice submit failed: ${String(e).split('\n')[0]}`);
      console.log(`toasts: ${JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []))}`);
    }
  } else {
    console.log('tag row not listed for the RC');
  }
});
