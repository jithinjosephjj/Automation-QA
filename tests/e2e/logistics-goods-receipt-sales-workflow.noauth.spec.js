const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueRef, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-logistics-sales-state.json');

/**
 * E2E WORKFLOW — LOGISTICS INWARD / GOODS RECEIPT / METAL INWARD / LOT /
 * BARCODE / COUNTER ALLOCATION / COUNTER ACCEPT / B2B SALES INVOICE.
 *
 * Chain (QA lead screenshots, 03-09-2026): Logistics Inward (DTDC + RAJA,
 * dynamic logistic/invoice/tracking numbers, Metal Gold/Ring/91.60, 120g
 * with seal / qty 5 / 100g / 20g stone) → Goods Receipt (Generation Type
 * "Logistic Inward" against the logistics RC, tare 2g via the "+" dialog:
 * gross 118 = 120-2, net 98 = 118-20) → Metal Inward (Sub Txn Invoice +
 * Purchase Type "Goods Receipt", GR pick back-fills the item, making
 * charges 1200) → Lot Generation → Barcode (as user suja) → Counter
 * Allocation (scan the tag) → Counter Accept → B2B Metal Sales Invoice
 * (scan the tag, customer Luxurio).
 *
 * Document numbers persist in e2e-logistics-sales-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  logistics: {
    logisticVendor: 'DTDC',
    vendor: 'RAJA',
    materialType: 'Metal',
    grossWithSeal: 120,
    quantity: 5,
    grossAsInvoice: 100,
    stoneAsInvoice: 20,
    metalGroup: 'Gold',
    metalCategory: 'Ring',
    purity: '91.60',
    invoiceAmount: 250000,
    receivedBy: 'Ajin G',
    paymentStatus: 'Paid',
  },
  goodsReceipt: { quantity: 5, grossWithTare: 120, tareWeight: 2, stoneWeight: 20 },
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Goods Receipt',
    purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 5, grossWeightWithTare: 118, makingType: 'Direct', makingCharges: 1200 },
  },
  lot: { employee: 'Ubaid', businessUnit: 'Cochin' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Cochin' }, // barcode runs as a different user
    stockIdentityType: 'Stock', // options: Jobwork Stock | Stock (purchase inwards = Stock)
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
  counter: { itemType: 'Metal', groupCategory: 'Gold' },
  invoice: { customer: 'RAJA', salesman: 'Ajin G' },
};

async function login(loginPage, page) {
  await loginPage.ensureLoggedIn();
}

test.describe('Logistics - Goods Receipt - Sales - Workflow', () => {
  test('TC-LGS-01 create the logistics inward', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new logistics inward starts a new chain - no stale inward / lot / tag numbers
    await login(loginPage, page);

    const logisticNo = uniqueRef('LGN').replace(/[^A-Za-z0-9]/g, '');
    const trackingNo = uniqueRef('TRK').replace(/[^A-Za-z0-9]/g, '');
    const logisticsNo = await logisticsSales.logisticsInward({
      ...DATA.logistics,
      logisticNo, // dynamic - duplicates blocked
      invoiceNo: uniqueInvoiceNo(),
      trackingNo,
      receivedDate: businessDate(0).replace(/-/g, '/'),
    });
    expect(logisticsNo, 'generated logistics RC number').toBeTruthy();
    state.writeState({ logisticsNo });
    console.log(`Logistics inward saved: ${logisticsNo} (logistic no ${logisticNo}, tracking ${trackingNo})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LGS-02 goods receipt against the logistics inward', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { logisticsNo } = state.readState();
    expect(logisticsNo, 'run TC-LGS-01 first').toBeTruthy();
    await login(loginPage, page);

    const goodsReceiptNo = await logisticsSales.goodsReceipt({
      vendor: DATA.logistics.vendor,
      logisticVendor: DATA.logistics.logisticVendor,
      logisticRcNo: logisticsNo,
      metalGroup: DATA.logistics.metalGroup,
      metalCategory: DATA.logistics.metalCategory,
      purity: DATA.logistics.purity,
      ...DATA.goodsReceipt,
    });
    expect(goodsReceiptNo, 'generated goods receipt number').toBeTruthy();
    state.writeState({ goodsReceiptNo });
    console.log(`Goods receipt saved: ${goodsReceiptNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LGS-03 metal inward from the goods receipt', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { goodsReceiptNo } = state.readState();
    expect(goodsReceiptNo, 'run TC-LGS-02 first').toBeTruthy();
    await login(loginPage, page);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      businessUnit: 'Cochin',
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.logistics.vendor,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    await metalInward.fillItemFromGoodsReceipt({ goodsReceiptNo, ...DATA.inward.item });
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit();
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    // a new inward invalidates everything downstream - later steps must never
    // act on the previous run's lot / tag (26-09-2026)
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, rfidNo: null, allocationNo: null, counterAccepted: false, invoiceDocNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-lgs-03-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-LGS-04 generate a lot from the inward', async ({ loginPage, lotGeneration, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-LGS-03 first').toBeTruthy();
    await login(loginPage, page);

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.logistics.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
    expect(lotGeneration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LGS-05 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-LGS-04 first').toBeTruthy();

    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.logistics.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      pieces: 1, // one tag per save (the lot holds 5 pieces)
      additionalCharges: true, // QA lead 26-09-2026: Additional Charges -> add charges -> Submit
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    const tagNo = await barcodeGeneration.verifyGeneratedTag('Tendulkar');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-LGS-06 allocate the tag to a counter', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(tagNo, 'run TC-LGS-05 first').toBeTruthy();
    await login(loginPage, page);

    // fetch by LOT (tag numbers repeat on qa); the fetch answer's RFID is
    // what the later tag-wise screens key on
    const allocationNo = await logisticsSales.counterAllocation({
      itemType: DATA.counter.itemType,
      groupCategory: DATA.counter.groupCategory,
      tagNo,
      lotNo,
      vendor: DATA.logistics.vendor,
    });
    const rfidNo = (logisticsSales.lastScan && logisticsSales.lastScan.rfidNo) || '';
    state.writeState({ allocationNo, rfidNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LGS-07 accept the tag at the counter', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    expect(tagNo, 'run TC-LGS-06 first').toBeTruthy();
    await login(loginPage, page);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-LGS-08 B2B metal sales invoice for the tag', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-LGS-07 first').toBeTruthy();
    await login(loginPage, page);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({
      customer: DATA.invoice.customer,
      salesman: DATA.invoice.salesman,
      tagNo,
      rfidNo,
    });
    state.writeState({ invoiceDocNo });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
