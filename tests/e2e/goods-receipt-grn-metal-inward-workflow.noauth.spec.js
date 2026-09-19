const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueRef } = require('../../utils/unique');

const state = makeState('e2e-goods-receipt-grn-state.json');

/**
 * E2E WORKFLOW — GOODS RECEIPT (Direct) → METAL INWARD (GRN / Goods Receipt).
 *
 * Chain (user screenshot, 16-09-2026):
 *   1. Goods Receipt /prc/view-goods-receipt, Generation Type "Direct":
 *      Vendor Luxurio, Material Metal, free-text Description,
 *      Gold / Ring / 91.60, Qty 50, Gross Weight with Tare 100.000,
 *      Stone Weight 10.000 → Net Weight 90.000 (calculated).
 *   2. Metal Inward, Sub Transaction Type GRN + Purchase Type "Goods
 *      Receipt": picking the GR number on the items step back-fills the
 *      receipt's weights; GRN receives unpriced (no Rate field).
 *
 * Document numbers persist in e2e-goods-receipt-grn-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  vendor: 'Luxurio',
  goodsReceipt: {
    generationType: 'Direct',
    materialType: 'Metal',
    description: 'E2E GRN goods receipt',
    metalGroup: 'Gold',
    metalCategory: 'Ring',
    purity: '91.60',
    quantity: 50,
    grossWithTare: 100,
    stoneWeight: 10, // Net = 100 - 10 = 90 (no tare added)
  },
  inward: {
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 50, grossWeightWithTare: 100, makingType: 'Direct', makingCharges: 1200 },
  },
};

async function login(loginPage, page) {
  await loginPage.ensureLoggedIn();
}

test.describe('Goods Receipt (Direct) - Metal Inward GRN - Workflow', () => {
  test('TC-GRGRN-01 create a direct goods receipt', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const goodsReceiptNo = await logisticsSales.goodsReceipt({
      vendor: DATA.vendor,
      ...DATA.goodsReceipt,
    });
    expect(goodsReceiptNo, 'generated goods receipt number').toBeTruthy();
    state.writeState({ goodsReceiptNo });
    console.log(`Direct goods receipt saved: ${goodsReceiptNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-GRGRN-02 metal inward (GRN) from the goods receipt', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { goodsReceiptNo } = state.readState();
    expect(goodsReceiptNo, 'run TC-GRGRN-01 first').toBeTruthy();
    await login(loginPage, page);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({
      subTransactionType: 'GRN',
      businessUnit: 'Cochin',
      inwardType: 'Stock',
      purchaseType: 'Goods Receipt',
      vendor: DATA.vendor,
      purchaser: 'Ajin G',
      invoiceNo: uniqueRef('MI-GRGRN'), // "Voucher Number" on the GRN header
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    await metalInward.fillItemFromGoodsReceipt({ goodsReceiptNo, ...DATA.inward.item });
    await metalInward.addItem();
    await metalInward.waitForIdle();

    // the receipt's weights must have landed in the summary
    await expect
      .poll(async () => metalInward.summaryText(), { timeout: 20_000 })
      .toMatch(/No\. of Pieces\s*:\s*\d+/);

    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit();
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`GRN metal inward saved: ${inwardVoucherNo} (from goods receipt ${goodsReceiptNo})`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-grgrn-02-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });
});
