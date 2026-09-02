const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-remodel-state.json');

/**
 * E2E WORKFLOW — METAL INWARD / REMODEL ISSUE / REMODEL RECEIPT.
 *
 * Chain (QA lead recording, 02-09-2026): Metal Inward (stock, vendor
 * Luxurio - the remodel screens list catalog vendors only, RAJA is absent)
 * → Remodel Issue (/inv/app-issue-list Remodel tab: Remodel Type "Bangle
 * size alteration" + vendor + Stock Source "Inward" + "Metal Inward" →
 * inward row → Add → Submit; RR## series) → Remodel Receipt
 * (/inv/app-receipt-list Remodel tab: type + vendor + RANDOM invoice no +
 * date + credit days + source Inward → issue row → Add → Submit).
 *
 * Document numbers persist in e2e-remodel-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'Luxurio',
    purchaser: 'Abc',
    item: {
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 10,
      rate: 6000,
    },
  },
  remodel: {
    type: 'Bangle size alteration',
    vendor: 'Luxurio',
    sourceType: 'Inward',
    transactionType: 'Metal Inward',
    creditDays: 20,
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Metal Inward - Remodel - Workflow', () => {
  test('TC-RMD-01 create the metal inward (stock)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      businessUnit: 'Cochin',
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItemBtn.click();
    await metalInward.waitForIdle();
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit();
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    // print template check, then prove the record reached the list
    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-rmd-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-RMD-02 remodel issue from the inward', async ({ loginPage, remodelWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RMD-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await remodelWorkflow.remodelIssue({
      remodelType: DATA.remodel.type,
      vendor: DATA.remodel.vendor,
      sourceType: DATA.remodel.sourceType,
      transactionType: DATA.remodel.transactionType,
      inwardNo: inwardVoucherNo,
    });
    expect(issueNo, 'generated remodel issue number (RR## series)').toBeTruthy();
    state.writeState({ issueNo });
    console.log(`Remodel issued: ${issueNo}`);
    expect(remodelWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-RMD-03 remodel receipt against the issue', async ({ loginPage, remodelWorkflow, page }) => {
    test.setTimeout(600_000);
    const { issueNo } = state.readState();
    expect(issueNo, 'run TC-RMD-02 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await remodelWorkflow.remodelReceipt({
      remodelType: DATA.remodel.type,
      vendor: DATA.remodel.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      creditDays: DATA.remodel.creditDays,
      issueNo,
    });
    state.writeState({ receiptNo });
    console.log(`Remodel received (doc: ${receiptNo || 'keyed by issue no'})`);
    expect(remodelWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
