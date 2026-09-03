const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-certification-state.json');

/**
 * E2E WORKFLOW — STONE INWARD / CERTIFICATION ISSUE / CERTIFICATION RECEIPT.
 *
 * Chain: Stone Inward (stock, vendor RAJA, article Jerald, ASSORTED STOCK
 * ticked - certification only lists assorted stone inwards; the invoice
 * field strips special characters, so references are alphanumeric-only)
 * → Certification Issue (/inv/app-issue-list Certification tab: Jewellery
 * Item Type Stone + Vendor Ram + Stock Source "Inward" + "Stone Inward" →
 * inward row → Add → Submit) → Certification Receipt (/inv/app-receipt-list
 * Certification tab: item type + Vendor Ram + RC Number + RANDOM invoice no
 * + date + Issue Stock Source "Inward" → issue rows → "Add Selected to
 * Receipt" → Submit).
 *
 * Document numbers persist in e2e-certification-state.json.
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
      noOfPcs: 8,
      grossWeight: 87,
      discountPercent: 7,
      returnPercent: 6, // mandatory per the stone-inward guide
      assortedStock: true, // certification eligibility gate
    },
  },
  certification: { itemType: 'Stone', vendor: 'ram', sourceType: 'Inward', transactionType: 'Stone Inward' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Stone Inward - Certification - Workflow', () => {
  test('TC-CRT-01 create the stone inward (stock)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();

    // the Stone invoice field strips separators - alphanumeric-only ref
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
    state.writeState({ inwardVoucherNo, inwardInvoiceNo: invoiceNo });
    console.log(`Stone inward saved: ${inwardVoucherNo} (invoice ${invoiceNo})`);

    await stoneInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-crt-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await stoneInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-CRT-02 certification issue from the inward', async ({ loginPage, certificationWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-CRT-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await certificationWorkflow.certificationIssue({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      sourceType: DATA.certification.sourceType,
      transactionType: DATA.certification.transactionType,
      inwardNo: inwardVoucherNo,
    });
    expect(issueNo, 'generated certification issue number').toBeTruthy();
    state.writeState({ issueNo });
    console.log(`Certification issued: ${issueNo}`);
    expect(certificationWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-CRT-03 certification receipt against the issue', async ({ loginPage, certificationWorkflow, page }) => {
    test.setTimeout(600_000);
    const { issueNo } = state.readState();
    expect(issueNo, 'run TC-CRT-02 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await certificationWorkflow.certificationReceipt({
      itemType: DATA.certification.itemType,
      vendor: DATA.certification.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      issueNo,
    });
    state.writeState({ receiptNo });
    console.log(`Certification received (doc: ${receiptNo || 'keyed by issue no'})`);
    expect(certificationWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
