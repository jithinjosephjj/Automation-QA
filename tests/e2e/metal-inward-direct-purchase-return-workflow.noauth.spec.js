const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-purchase-return-inward-state.json');

/**
 * E2E WORKFLOW — METAL INWARD / PURCHASE RETURN (INWARD-SOURCED).
 *
 * Direct variant of TC-PRT: the purchase return sources the METAL INWARD
 * itself (Stock Source Type "Inward"), no lot/barcode in between.
 *
 * Document numbers persist in e2e-purchase-return-inward-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    purchaser: 'Abc',
    item: {
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 100,
      rate: 6000,
    },
  },
  return: { itemType: 'Metal', vendor: 'RAJA', sourceType: 'Inward' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Metal Inward - Direct Purchase Return - Workflow', () => {
  test('TC-PRI-01 create the metal inward (stock)', async ({ loginPage, metalInward, page }) => {
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

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-pri-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-PRI-02 purchase return of the inward (inward-sourced)', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-PRI-01 first').toBeTruthy();
    await login(loginPage, page);

    const returnNo = await logisticsSales.purchaseReturn({
      itemType: DATA.return.itemType,
      vendor: DATA.return.vendor,
      sourceType: DATA.return.sourceType,
      inwardNo: inwardVoucherNo,
    });
    state.writeState({ returnNo });
    console.log(`Purchase return saved (doc: ${returnNo || 'keyed by inward'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
