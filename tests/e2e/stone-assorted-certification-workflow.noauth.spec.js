const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-assorted-cert-state.json');

/**
 * E2E WORKFLOW — STONE INWARD / STONE ASSORTING ISSUE / STONE ASSORTING
 * RECEIPT / CERTIFICATION ISSUE / CERTIFICATION RECEIPT.
 *
 * Chain (QA lead recording, 03-09-2026): Stone Inward WITHOUT the Assorted
 * Stock tick → Stone Assorting Issue (nav search "stone as"; transaction
 * type Stone Inward + purchase vendor RAJA → inward item row → assorter
 * employee → Add → Close → Next → Submit) → Stone Assorting Receipt
 * (Receipt tab: employee → issue row → Add Items → Close → Submit) →
 * Certification Issue (Stone + Vendor Ram + Stock Source Inward + From
 * Transaction Type "Stone Assorting Receipt" → assorted-receipt row → Add
 * → Submit) → Certification Receipt (RC Number + random invoice → issue
 * rows → "Add Selected to Receipt" → Submit).
 *
 * Downstream grids render doc numbers PERMUTED (save "wJune-gg88d42026/…"
 * shows as "D42026/2027-gg88wJune-"), so rows are keyed by docCore().
 * Document numbers persist in e2e-assorted-cert-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  inward: {
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    item: {
      refType: 'Combination',
      stoneArticle: 'Jerald',
      entryMode: 'Without Tare',
      uom: 'Gram',
      noOfPcs: 14,
      grossWeight: 76,
      discountPercent: 2,
      returnPercent: 5, // mandatory per the stone-inward guide
      // NO assortedStock - this chain assorts the plain inward instead
    },
  },
  assorted: { transactionType: 'Stone Inward', vendor: 'RAJA', employee: 'Sioniquser' },
  certification: { itemType: 'Stone', vendor: 'ram', sourceType: 'Inward', transactionType: 'Stone Assorting Receipt' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Stone Assorting - Certification - Workflow', () => {
  test('TC-SAC-01 create the stone inward (stock, not assorted)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();

    const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, '');
    await stoneInward.fillBasicDetails({
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      invoiceNo,
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await stoneInward.nextBtn.click();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });

    await stoneInward.fillItem(DATA.inward.item);
    await stoneInward.addItemBtn.click();
    await expect
      .poll(async () => stoneInward.summaryText(), { timeout: 20_000 })
      .toMatch(/Vendor Name\s*:\s*RAJA/);

    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.nextBtn.click();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit();
    expect(saved, 'stone inward save response').toBeTruthy();
    const inwardVoucherNo = await stoneInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Stone inward saved: ${inwardVoucherNo} (invoice ${invoiceNo})`);

    await stoneInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-sac-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await stoneInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-SAC-02 stone assorting issue from the inward', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SAC-01 first').toBeTruthy();
    await login(loginPage, page);

    const assortedIssueNo = await stoneAssortedWorkflow.assortedIssue({
      transactionType: DATA.assorted.transactionType,
      vendor: DATA.assorted.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.assorted.employee,
    });
    expect(assortedIssueNo, 'generated assorting issue number').toBeTruthy();
    state.writeState({ assortedIssueNo });
    console.log(`Stone assorting issued: ${assortedIssueNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SAC-03 stone assorting receipt against the issue', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedIssueNo } = state.readState();
    expect(assortedIssueNo, 'run TC-SAC-02 first').toBeTruthy();
    await login(loginPage, page);

    const assortedReceiptNo = await stoneAssortedWorkflow.assortedReceipt({
      issueNo: assortedIssueNo,
      employee: DATA.assorted.employee,
    });
    expect(assortedReceiptNo, 'generated assorting receipt number').toBeTruthy();
    state.writeState({ assortedReceiptNo });
    console.log(`Stone assorting received: ${assortedReceiptNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SAC-04 certification issue from the assorting receipt', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedReceiptNo } = state.readState();
    expect(assortedReceiptNo, 'run TC-SAC-03 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await stoneAssortedWorkflow.certificationIssue({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      sourceType: DATA.certification.sourceType,
      transactionType: DATA.certification.transactionType,
      inwardNo: stoneAssortedWorkflow.docCore(assortedReceiptNo),
    });
    expect(issueNo, 'generated certification issue number').toBeTruthy();
    state.writeState({ issueNo });
    console.log(`Certification issued: ${issueNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SAC-05 certification receipt against the issue', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { issueNo } = state.readState();
    expect(issueNo, 'run TC-SAC-04 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await stoneAssortedWorkflow.certificationReceipt({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      issueNo: stoneAssortedWorkflow.docCore(issueNo),
    });
    state.writeState({ receiptNo });
    console.log(`Certification received (doc: ${receiptNo || 'keyed by issue no'})`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
