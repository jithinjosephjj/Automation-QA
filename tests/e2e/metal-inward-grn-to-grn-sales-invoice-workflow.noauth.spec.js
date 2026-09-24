const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueRef } = require('../../utils/unique');

const state = makeState('e2e-grn-sales-state.json');

/**
 * METAL INWARD (GRN) -> ... -> B2B METAL SALES INVOICE (GRN) - "GRN to GRN".
 *
 * Goods come in UNPRICED on a GRN inward and go out to a B2B customer on a
 * GRN-type sales invoice (Transaction Sub Type "GRN" - priced later), with
 * the usual stock steps in between - all at Cochin:
 *
 *   TC-GRN-01  Metal Inward (GRN)     Sub Transaction Type GRN / Stock / Direct, vendor Luxurio, 1 pc Tendulkar 91.60, 60 g
 *   TC-GRN-02  Lot Generation         from the inward
 *   TC-GRN-03  Barcode                one tag from the lot (as the barcode employee suja)
 *   TC-GRN-04  Counter Allocation     fetch the lot (the tag's RFID is kept)
 *   TC-GRN-05  Counter Accept         accept the tag
 *   TC-GRN-06  B2B Metal Sales Invoice  Transaction Sub Type GRN, customer RAJA, Counter / Tag Wise, RFID scan
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-grn-sales-state.json, so the chain resumes where it stopped
 * and any step can be re-run alone.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

const DATA = {
  inward: {
    subTransactionType: 'GRN', // selected FIRST - it drives the vendor fetch; #invoiceNo is relabelled "Voucher Number"
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'Luxurio',
    purchaser: 'Ajin G',
    item: {
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 60,
      // no rate: GRN goods come in unpriced (the item form has no Rate field)
    },
  },
  lot: { employee: 'Ubaid' },
  barcode: {
    // barcode is USER-SCOPED: the Lot No lookup lists only for the barcode
    // employee's login (QA lead 18-09-2026: barcode user is "suja")
    user: { user: 'suja', pwd: '123', bu: BU },
    stockIdentityType: 'Stock', // purchase inwards land as plain Stock
    grossWeight: 10, // capped to the lot weight by the page object
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
  counter: { itemType: 'Metal', groupCategory: 'Gold' },
  invoice: { subType: 'GRN', customer: 'RAJA', salesman: 'Ajin G' },
};

async function login(loginPage, creds = {}) {
  await loginPage.ensureLoggedIn({ ...creds, bu: BU });
}

test.describe('Metal Inward GRN - GRN Sales Invoice - Workflow', () => {
  test('TC-GRN-01 metal inward (GRN / Stock / Direct, Luxurio)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
    await login(loginPage);

    await metalInward.open();
    await metalInward.openAddWizard();
    const picked = await metalInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      businessUnit: BU,
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueRef('MI-GRN'), // the "Voucher Number" on a GRN
    });
    expect(picked.subTransactionType).toContain('GRN');
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem(); // verified Add Item (mandatory description selects; pure rate strip when offered)
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit(); // answers "Process with Barcode or Lot?" with No
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
    if (!inwardVoucherNo) inwardVoucherNo = await metalInward.voucherNumber().catch(() => '');
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`GRN metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-GRN-02 lot generation from the GRN inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-GRN-01 first').toBeTruthy();
    await login(loginPage);

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.inward.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: BU,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-GRN-03 barcode tag from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-GRN-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      pieces: 1,
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let tagNo = (saved.data && saved.data.receiptNo) || '';
    if (!/\d{4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
      tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    }
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-GRN-04 counter allocation of the lot', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(tagNo, 'run TC-GRN-03 first').toBeTruthy();
    await login(loginPage);

    // fetch by LOT (tag numbers repeat on qa); the fetch answer's RFID is
    // what the later tag-wise screens key on
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo, vendor: DATA.inward.vendor });
    const rfidNo = (logisticsSales.lastScan && logisticsSales.lastScan.rfidNo) || '';
    state.writeState({ allocationNo, rfidNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-GRN-05 counter accept of the tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    expect(tagNo, 'run TC-GRN-04 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-GRN-06 B2B metal sales invoice (GRN) for the tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-GRN-05 first').toBeTruthy();
    await login(loginPage);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo, rfidNo });
    state.writeState({ invoiceDocNo });
    console.log(`B2B GRN sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
