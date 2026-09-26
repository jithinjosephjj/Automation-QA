const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueRef, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-logistics-stone-sales-state.json');

/**
 * E2E WORKFLOW - STONE: LOGISTICS INWARD / GOODS RECEIPT / STONE INWARD /
 * LOT / BARCODE / COUNTER ALLOCATION / COUNTER ACCEPT / B2B SALES INVOICE.
 *
 * The stone twin of logistics-goods-receipt-sales-workflow (QA lead,
 * 26-09-2026). All at Cochin, vendor RAJA, stone Jerald:
 *
 *   TC-LSS-01  Logistics Inward     DTDC + RAJA, Material Type Stone (Stone Group Jerald), 4 pcs, 6 g (7 g with seal)
 *   TC-LSS-02  Goods Receipt        Generation Type Logistic Inward against the logistics RC, Stone, 4 pcs, 6 g
 *   TC-LSS-03  Stone Inward         Sub Txn Invoice, Stock, Purchase Type Goods Receipt -> the receipt, Jerald, Without Tare,
 *                                   Gram, return 5 %, ASSORTED STOCK ticked, Additional Charges before Add Item
 *   TC-LSS-04  Lot Generation       Item Type Stone + From Transaction Type Stone Inward (assorted inwards only)
 *   TC-LSS-05  Barcode              as the barcode employee suja (Item Type Stone, Stock, Additional Charges)
 *   TC-LSS-06  Counter Allocation   Item Type Stone, fetch the lot (the tag's RFID is kept)
 *   TC-LSS-07  Counter Accept       Item Type Stone
 *   TC-LSS-08  B2B Sales Invoice    Invoice, customer RAJA, Counter / Tag Wise, RFID scan
 *
 * 4 pcs / 6 g keeps the stone inward under the 2,000,000 "Stone Rule"
 * approval limit (a held inward never reaches Lot Generation).
 *
 * NOT IMPLEMENTED (parked 26-09-2026, QA lead): TC-LSS-01..07 are green
 * (lll5 / 1116 / SS18 / NNN34 / tag RSbbb12 / cc40 / AAA66), but the app has
 * no stone sales invoice - /sls/app-invoice-setup offers only the "Metal
 * Invoice" tab and it answers "Tag not found" for the counter-accepted stone
 * tag (scanned by RFID). Excluded from normal runs by playwright.config.js;
 * RUN_NOT_IMPLEMENTED=1 includes it.
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-logistics-stone-sales-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

const DATA = {
  logistics: {
    logisticVendor: 'DTDC',
    vendor: 'RAJA',
    materialType: 'Stone',
    stoneGroup: 'Jerald', // category / sub category: the first the cascade offers
    grossWithSeal: 7,
    quantity: 4,
    grossAsInvoice: 6,
    invoiceAmount: 150000,
    receivedBy: 'Ajin G',
    paymentStatus: 'Paid',
  },
  goodsReceipt: { materialType: 'Stone', quantity: 4, grossWithTare: 6 },
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Goods Receipt',
    item: {
      refType: 'Combination',
      stoneArticle: 'Jerald',
      entryMode: 'Without Tare',
      uom: 'Gram',
      noOfPcs: 4,
      grossWeight: 6,
      returnPercent: 5, // mandatory per the stone-inward guide
      assortedStock: true, // lot eligibility gate
    },
  },
  lot: { itemType: 'Stone', transactionType: 'Stone Inward', employee: 'Ubaid' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: BU }, // barcode runs as a different user
    itemType: 'Stone',
    stockIdentityType: 'Stock',
    grossWeight: 6, // the full 6 g lot
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
  counter: { itemType: 'Stone' },
  invoice: { subType: 'Invoice', customer: 'RAJA', salesman: 'Ajin G' },
};

async function login(loginPage, creds = {}) {
  await loginPage.ensureLoggedIn({ ...creds, bu: BU });
}

test.describe('Logistics - Stone Goods Receipt - Sales - Workflow', () => {
  test('TC-LSS-01 logistics inward (Material Type Stone)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    state.reset(); // a new logistics inward starts a new chain
    await login(loginPage);
    const logisticNo = uniqueRef('LGS').replace(/[^A-Za-z0-9]/g, '');
    const trackingNo = uniqueRef('TRS').replace(/[^A-Za-z0-9]/g, '');
    const logisticsNo = await logisticsSales.logisticsInward({
      ...DATA.logistics,
      logisticNo, // dynamic - duplicates blocked
      invoiceNo: uniqueInvoiceNo(),
      trackingNo,
      receivedDate: businessDate(0).replace(/-/g, '/'),
    });
    expect(logisticsNo, 'generated logistics RC number').toBeTruthy();
    state.writeState({ logisticsNo });
    console.log(`Stone logistics inward saved: ${logisticsNo} (logistic no ${logisticNo}, tracking ${trackingNo})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LSS-02 goods receipt (Stone) against the logistics inward', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { logisticsNo } = state.readState();
    expect(logisticsNo, 'run TC-LSS-01 first').toBeTruthy();
    await login(loginPage);
    const goodsReceiptNo = await logisticsSales.goodsReceipt({
      vendor: DATA.logistics.vendor,
      logisticVendor: DATA.logistics.logisticVendor,
      logisticRcNo: logisticsNo,
      stoneGroup: DATA.logistics.stoneGroup,
      ...DATA.goodsReceipt,
    });
    expect(goodsReceiptNo, 'generated goods receipt number').toBeTruthy();
    state.writeState({ goodsReceiptNo });
    console.log(`Stone goods receipt saved: ${goodsReceiptNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LSS-03 stone inward from the goods receipt (assorted)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    const { goodsReceiptNo } = state.readState();
    expect(goodsReceiptNo, 'run TC-LSS-02 first').toBeTruthy();
    await login(loginPage);

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();
    const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, ''); // the stone invoice field strips separators
    await stoneInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.logistics.vendor,
      invoiceNo,
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await stoneInward.nextBtn.click();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });

    await stoneInward.fillItemFromGoodsReceipt({ goodsReceiptNo, ...DATA.inward.item });
    await stoneInward.addItem(); // Additional Charges first, then Add Item (QA lead 26-09-2026)
    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.nextBtn.click();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit();
    expect(saved, 'stone inward save response').toBeTruthy();
    let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
    if (!inwardVoucherNo) inwardVoucherNo = await stoneInward.voucherNumber().catch(() => '');
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    // a new inward invalidates everything downstream
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, rfidNo: null, allocationNo: null, counterAccepted: false, invoiceDocNo: null });
    console.log(`Stone inward saved: ${inwardVoucherNo} (invoice ${invoiceNo}, goods receipt ${goodsReceiptNo})`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-LSS-04 lot generation from the assorted inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-LSS-03 first').toBeTruthy();
    await login(loginPage);
    const lotNo = await lotGeneration.generateLot({
      itemType: DATA.lot.itemType,
      transactionType: DATA.lot.transactionType,
      vendor: DATA.logistics.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: BU,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-LSS-05 barcode tag from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-LSS-04 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({
      itemType: DATA.barcode.itemType,
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.logistics.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
    });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let tagNo = (saved.data && saved.data.receiptNo) || '';
    if (!/\d{2,4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
      tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.stoneArticle);
    }
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-LSS-06 counter allocation of the lot (Item Type Stone)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(tagNo && lotNo, 'run TC-LSS-05 first').toBeTruthy();
    await login(loginPage);
    // fetch by LOT (tag numbers repeat on qa); the fetch answer's RFID is kept
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo, vendor: DATA.logistics.vendor });
    const scan = logisticsSales.lastScan || (logisticsSales.lastScans || [])[0] || {};
    const rfidNo = scan.rfidNo || '';
    state.writeState({ allocationNo, rfidNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LSS-07 counter accept of the tag (Item Type Stone)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, allocationNo } = state.readState();
    expect(tagNo && allocationNo !== null, 'run TC-LSS-06 first').toBeTruthy();
    await login(loginPage);
    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LSS-08 B2B sales invoice for the stone tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-LSS-07 first').toBeTruthy();
    await login(loginPage);
    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo, rfidNo });
    state.writeState({ invoiceDocNo });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
