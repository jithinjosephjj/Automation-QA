const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-assorted-cert-tare-state.json');

/**
 * E2E WORKFLOW — STONE INWARD WITH TARE / STONE ASSORTING ISSUE / STONE
 * ASSORTING RECEIPT / CERTIFICATION ISSUE / CERTIFICATION RECEIPT.
 *
 * Tare-weight variant of TC-SAC: the inward is entered "With Tare" (gross
 * gross / tare / net per WEIGHTS - 8 g / 2 g / 6 g, 4 pcs since 29-09-2026) and the weights are verified through the chain.
 *
 * VERIFIED DOMAIN BEHAVIOR: the tare lives up to the ASSORTING ISSUE
 * (gross 76 / tare 10 / net 66 in its Add Stone Details panel). Assorting
 * CONSUMES the tare - from the assorting receipt onward the stock carries
 * the NET weight as its gross (66.000, tare 0.000, 14 pcs), which is what
 * the certification issue/receipt grids must show.
 *
 * Document numbers persist in e2e-assorted-cert-tare-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const WEIGHTS = { gross: 8, tare: 2, net: 6, pcs: 4 }; // under the 2,000,000 Stone Rule approval limit (29-09-2026)
// grid cells print "76.000" style; \b keeps 10 from matching inside 2026 etc.
const ISSUE_WEIGHTS = [
  new RegExp(`\\b${WEIGHTS.gross}(\\.\\d+)?\\b`),
  new RegExp(`\\b${WEIGHTS.tare}(\\.\\d+)?\\b`),
  new RegExp(`\\b${WEIGHTS.net}(\\.\\d+)?\\b`),
];
// after assorting the tare is consumed: net becomes the stock's gross
const POST_ASSORT_WEIGHTS = [
  new RegExp(`\\b${WEIGHTS.net}(\\.\\d+)?\\b`),
  new RegExp(`\\b${WEIGHTS.pcs}\\b`),
];

const DATA = {
  inward: {
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    item: {
      refType: 'Combination',
      stoneArticle: 'Jerald',
      entryMode: 'With Tare',
      uom: 'Gram',
      noOfPcs: WEIGHTS.pcs,
      grossWeight: WEIGHTS.gross,
      tareWeight: WEIGHTS.tare,
      discountPercent: 2,
      returnPercent: 5, // mandatory per the stone-inward guide
    },
  },
  assorted: { transactionType: 'Stone Inward', vendor: 'RAJA', employee: 'Sioniquser' },
  certification: { itemType: 'Stone', vendor: 'ram', sourceType: 'Inward', transactionType: 'Stone Assorting Receipt' },
};

async function login(loginPage, page) {
  await loginPage.ensureLoggedIn();
}

test.describe('Stone Assorting - Certification - Tare Weight Workflow', () => {
  test('TC-SACT-01 create the stone inward with tare weight', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain - no stale lot / tag numbers (26-09-2026: stale lots made barcode exceed the lot weight)
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
    await stoneInward.clickNext();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });

    await stoneInward.fillItem(DATA.inward.item);

    // TARE VERIFICATION on the form itself: Net = Gross - Tare
    expect(await stoneInward.numberOf('Stone Net Weight')).toBeCloseTo(WEIGHTS.net, 3);

    await stoneInward.addItem();
    await expect
      .poll(async () => stoneInward.summaryText(), { timeout: 20_000 })
      .toMatch(/Vendor Name\s*:\s*RAJA/);

    // TARE VERIFICATION in the item summary: all three weights print
    const summary = await stoneInward.summaryText();
    expect(summary).toContain(`Stone Gross Weight : ${WEIGHTS.gross}.000`);
    expect(summary).toContain(`Stone Net Weight : ${WEIGHTS.net}.000`);
    expect(summary, 'tare weight shown in the item summary').toContain(`Stone Tare Weight : ${WEIGHTS.tare}.000`);

    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.clickNext();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit();
    expect(saved, 'stone inward save response').toBeTruthy();
    const inwardVoucherNo = await stoneInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Stone inward saved (tare ${WEIGHTS.tare} g): ${inwardVoucherNo} (invoice ${invoiceNo})`);

    await stoneInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-sact-01-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await stoneInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-SACT-02 assorting issue shows the tare weight', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SACT-01 first').toBeTruthy();
    await login(loginPage, page);

    const assortedIssueNo = await stoneAssortedWorkflow.assortedIssue({
      transactionType: DATA.assorted.transactionType,
      vendor: DATA.assorted.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.assorted.employee,
      expectInRow: ISSUE_WEIGHTS, // gross / tare / net (WEIGHTS) in the panel
    });
    expect(assortedIssueNo, 'generated assorting issue number').toBeTruthy();
    state.writeState({ assortedIssueNo });
    console.log(`Stone assorting issued: ${assortedIssueNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SACT-03 assorting receipt shows the tare weight', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedIssueNo } = state.readState();
    expect(assortedIssueNo, 'run TC-SACT-02 first').toBeTruthy();
    await login(loginPage, page);

    const assortedReceiptNo = await stoneAssortedWorkflow.assortedReceipt({
      issueNo: assortedIssueNo,
      employee: DATA.assorted.employee,
      // tare consumed by assorting: the net weight is now the gross, tare 0.000
      expectInRow: [...POST_ASSORT_WEIGHTS, /Tare Weight 0\.000/],
    });
    expect(assortedReceiptNo, 'generated assorting receipt number').toBeTruthy();
    state.writeState({ assortedReceiptNo });
    console.log(`Stone assorting received: ${assortedReceiptNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SACT-04 certification issue shows the tare weight', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedReceiptNo } = state.readState();
    expect(assortedReceiptNo, 'run TC-SACT-03 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await stoneAssortedWorkflow.certificationIssue({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      sourceType: DATA.certification.sourceType,
      transactionType: DATA.certification.transactionType,
      inwardNo: stoneAssortedWorkflow.docCore(assortedReceiptNo),
      expectInRow: POST_ASSORT_WEIGHTS, // net weight / pcs (WEIGHTS) post-assorting
    });
    expect(issueNo, 'generated certification issue number').toBeTruthy();
    state.writeState({ issueNo });
    console.log(`Certification issued: ${issueNo}`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SACT-05 certification receipt shows the tare weight', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { issueNo } = state.readState();
    expect(issueNo, 'run TC-SACT-04 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await stoneAssortedWorkflow.certificationReceipt({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      issueNo: stoneAssortedWorkflow.docCore(issueNo),
      expectInRow: POST_ASSORT_WEIGHTS,
    });
    state.writeState({ receiptNo });
    console.log(`Certification received (doc: ${receiptNo || 'keyed by issue no'})`);
    expect(stoneAssortedWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
