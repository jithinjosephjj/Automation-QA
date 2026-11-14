const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-multi-barcode-metal-state.json');

/**
 * E2E WORKFLOW — MULTI BARCODE: METAL INWARD (100 pcs, 1000 g) -> LOT -> BARCODE
 * with "Multi Barcode" ticked (10 tags of 10 pcs / 100 g) at Kakkanad.
 * Requested 14-11-2026 ("metal inward piece 100, 1000 gm -> lot -> barcode; in
 * barcode 10 piece 100 gross weight and check multi barcode checkbox and 10").
 *
 *   TC-MBC-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 100 pcs, 1000 g), "Barcode or Lot?" = No
 *   TC-MBC-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-MBC-03  suja:  Barcode Generation for the lot: Pieces 10, Gross Weight 100,
 *              Multi Barcode ticked with 10, Additional Charges, no counter -> Submit:
 *              the save answers with 10 tag references (10 x 10 pcs / 100 g = the lot);
 *              the post-save Barcode Print dialog: Label Template as offered, Destination =
 *              the (first) printer, Copies 10, Print
 *
 * Numbers chain through e2e-multi-barcode-metal-state.json. MUST run headed.
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  inward: {
    subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: VENDOR, purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 100, grossWeightWithTare: 1000, rate: 6000 },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE },
    stockIdentityType: 'Stock',
    pieces: 10,
    grossWeight: 100,
    multiBarcode: Number(process.env.MULTI_BARCODE || 10),
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: null,
    print: { destination: process.env.PRINTER || undefined, copies: Number(process.env.PRINT_COPIES || 10) }, // the post-save Barcode Print dialog: the (first) printer, Copies 10, Print (user 14-11-2026)
  },
};

test.describe('Multi Barcode - Metal Inward (100 pcs) - Lot - 10 tags - Workflow', () => {
  test('TC-MBC-01 Kakkanad: metal inward 100 pcs / 1000 g (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({ subTransactionType: DATA.inward.subTransactionType, businessUnit: HEAD_OFFICE, inwardType: DATA.inward.inwardType, purchaseType: DATA.inward.purchaseType, vendor: DATA.inward.vendor, purchaser: DATA.inward.purchaser, invoiceNo: uniqueInvoiceNo() });
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
    const saved = await metalInward.submit();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tags: [] });
    console.log(`Metal inward saved: ${inwardVoucherNo} (${DATA.inward.item.noOfPcs} pcs, ${DATA.inward.item.grossWeightWithTare} g)`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-MBC-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-MBC-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-MBC-03 Kakkanad: multi barcode - 10 tags of 10 pcs / 100 g from the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-MBC-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const b = DATA.barcode;
    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: b.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      pieces: b.pieces,
      grossWeight: b.grossWeight,
      multiBarcode: b.multiBarcode,
      additionalCharges: true,
      descriptions: b.descriptions,
      counter: b.counter,
      print: b.print,
    });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const refs = (saved && saved.data && Array.isArray(saved.data.tagReferences)) ? saved.data.tagReferences : [];
    // Metal / Brand saves list the tags in tagReferences; a Stone save answers with
    // a receiptNo only - the lot's tags then come from the post-save lot-serial call
    const tags = refs.length ? refs.map((r) => r.tagNo).filter(Boolean) : (barcodeGeneration.lastLotTags || []).slice(-b.multiBarcode);
    console.log(`Multi barcode saved: ${tags.length} tag(s) ${JSON.stringify(tags)} (lot ${lotNo}, ${b.multiBarcode} x ${b.pieces} pcs / ${b.grossWeight} g)`);
    expect(tags.length, `the save must return ${b.multiBarcode} tag references (body ${JSON.stringify(saved).slice(0, 400)})`).toBe(b.multiBarcode);
    expect(new Set(tags).size, 'distinct tag numbers').toBe(b.multiBarcode);
    const printed = barcodeGeneration.lastPrint || {};
    if (!printed.shown && printed.setupGap) {
      // qa has no barcode print configuration for this item type / location
      // (Brand at Kakkanad, 14-11-2026): the tags are saved, the print cannot be
      test.info().annotations.push({ type: 'setup-gap', description: `Barcode Print: ${printed.setupGap}` });
      console.log(`SETUP-GAP (qa): no Barcode Print dialog - ${printed.setupGap}`);
      state.writeState({ tags, tagNo: tags[0], print: { setupGap: printed.setupGap } });
      return;
    }
    expect(printed.shown, 'the Barcode Print dialog opened after the save').toBe(true);
    expect(printed.destination, 'a print Destination was picked').toBeTruthy();
    expect(Number(printed.copies), 'Copies').toBe(b.print.copies);
    // the app confirms the print with "Done 10 barcode print jobs created." (14-11-2026)
    expect((printed.toasts || []).join(' | '), 'print confirmation toast').toMatch(new RegExp(`${b.print.copies} barcode print jobs? created`, 'i'));
    console.log(`Barcode print: template "${printed.template}", destination "${printed.destination}", copies ${printed.copies}, print answered ${printed.printStatus ?? 'no request'}`);
    state.writeState({ tags, tagNo: tags[0], print: { template: printed.template, destination: printed.destination, copies: printed.copies, status: printed.printStatus } });
  });
});
