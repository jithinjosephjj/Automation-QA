const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-hallmark-state.json');

/**
 * E2E WORKFLOW — METAL INWARD / HALLMARK ISSUE / HALLMARK RECEIPT.
 *
 * Chain: Metal Inward (stock, vendor Luxurio - the hallmark screens list
 * catalog vendors, and the receipt lists only vendors with pending
 * hallmark issues) → Hallmark Issue (/inv/app-issue-list Hallmark tab:
 * vendor + Stock Source "Inward" + "Metal Inward" → inward row → count-
 * named Add → Submit) → Hallmark Receipt (/inv/app-receipt-list Hallmark
 * tab: vendor + RANDOM invoice no + date → issue row → Add → Submit).
 *
 * Document numbers persist in e2e-hallmark-state.json.
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
  hallmark: { vendor: 'Luxurio', sourceType: 'Inward', transactionType: 'Metal Inward' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Metal Inward - Hallmark - Workflow', () => {
  test('TC-HLM-01 create the metal inward (stock)', async ({ loginPage, metalInward, page }) => {
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

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-hlm-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-HLM-02 hallmark issue from the inward', async ({ loginPage, hallmarkWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-HLM-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await hallmarkWorkflow.hallmarkIssue({
      vendor: DATA.hallmark.vendor,
      sourceType: DATA.hallmark.sourceType,
      transactionType: DATA.hallmark.transactionType,
      inwardNo: inwardVoucherNo,
    });
    expect(issueNo, 'generated hallmark issue number').toBeTruthy();
    state.writeState({ issueNo });
    console.log(`Hallmark issued: ${issueNo}`);
    expect(hallmarkWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-HLM-03 hallmark receipt against the issue', async ({ loginPage, hallmarkWorkflow, page }) => {
    test.setTimeout(600_000);
    const { issueNo } = state.readState();
    expect(issueNo, 'run TC-HLM-02 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await hallmarkWorkflow.hallmarkReceipt({
      vendor: DATA.hallmark.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      issueNo,
    });
    state.writeState({ receiptNo });
    console.log(`Hallmark received (doc: ${receiptNo || 'keyed by issue no'})`);
    expect(hallmarkWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
