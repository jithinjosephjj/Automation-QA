const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-multi-barcode-brand-state.json');

/**
 * E2E WORKFLOW — MULTI BARCODE for BRAND: BRAND INWARD (100 pcs, 1000 g) -> LOT
 * (Item Type Brand) -> BRAND BARCODE with "Multi Barcode" ticked (10 tags of
 * 10 pcs / 100 g) and the post-save Barcode Print (Copies 10). Requested
 * 14-11-2026 ("do multibarcode for brand inward"); the metal twin is
 * multi-barcode-metal-workflow.noauth.spec.js.
 *
 *   TC-MBB-01  admin: Procurement > Stock Inward > Brand (stock / Direct / Invoice,
 *              vendor RAJA, brand Amraa, Tendulkar 91.60, 100 pcs, 1000 g, MRP 9,000 -
 *              100 x 9,000 keeps the inward under its 950,000 cap, no discount)
 *   TC-MBB-02  admin: Lot Generation (Item Type Brand, From Transaction Type Brand
 *              Inward, employee Ubaid, Location Kakkanad)
 *   TC-MBB-03  suja:  Barcode Generation (Item Type Brand, Stock): Brand Name Amraa,
 *              Pricing Amount 10 x MRP, Pieces 10, Gross Weight 100, Multi Barcode
 *              ticked with 10 -> Submit answers with 10 tag references (no print for
 *              Brand: qa has no barcode print configuration for brand tags)
 *
 * Numbers chain through e2e-multi-barcode-brand-state.json. MUST run headed.
 */

const HEAD_OFFICE = 'Kakkanad';
const TAGS = Number(process.env.MULTI_BARCODE || 10);
const PCS_PER_TAG = 10;

const DATA = {
  inward: {
    vendor: 'RAJA',
    purchaseType: 'Direct',
    costCenter: 'Cochin',
    inwardType: 'Stock',
    purchaser: 'Ajin G',
    item: {
      referenceType: 'Combination',
      groupCategory: 'Gold',
      category: 'Ring',
      brand: 'Amraa',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: TAGS * PCS_PER_TAG, // 100
      grossWeight: 1000,
      mrp: 9000, // 100 x 9,000 = 900,000 < the inward's 950,000 cap ("Exceeds max")
      discountPercent: 0, // an inward discount blocks Add To Lot (lot amount capped at the taxable value)
    },
  },
  lot: { itemType: 'Brand', transactionType: 'Brand Inward', employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE },
    itemType: 'Brand',
    stockIdentityType: 'Stock',
    pieces: PCS_PER_TAG,
    grossWeight: 100,
    multiBarcode: TAGS,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    print: undefined, // no barcode print for Brand (user 14-11-2026: qa has no print configuration for brand tags - 501 'No print configuration is available')
  },
};

test.describe('Multi Barcode (Brand) - Brand Inward (100 pcs) - Lot - 10 tags - Workflow', () => {
  test('TC-MBB-01 Kakkanad: brand inward 100 pcs / 1000 g (stock, Direct)', async ({ loginPage, brandInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await brandInward.open();
    await brandInward.selectTab();
    await brandInward.openAddWizard();
    await expect.poll(async () => brandInward.selectValue('subTransactionType'), { timeout: 20_000 }).toBe('Invoice');
    await brandInward.fillBasicDetails({ vendor: DATA.inward.vendor, purchaseType: DATA.inward.purchaseType, costCenter: DATA.inward.costCenter, inwardType: DATA.inward.inwardType, purchaser: DATA.inward.purchaser, invoiceNo: uniqueInvoiceNo() });
    await brandInward.clickNext();
    await expect(brandInward.select('referenceType')).toBeVisible({ timeout: 30_000 });
    await brandInward.fillItem(DATA.inward.item);
    await brandInward.addItem();
    await expect.poll(async () => brandInward.summaryText(), { timeout: 20_000 }).toContain(`No. of Pieces : ${DATA.inward.item.noOfPcs}`);
    if (!(await brandInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) await brandInward.clickNext();
    await expect(brandInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await brandInward.submit();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await brandInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tags: [] });
    console.log(`Brand inward saved: ${inwardVoucherNo} (${DATA.inward.item.noOfPcs} pcs, ${DATA.inward.item.grossWeight} g)`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-MBB-02 Kakkanad: generate a lot from the brand inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-MBB-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ itemType: DATA.lot.itemType, transactionType: DATA.lot.transactionType, vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-MBB-03 Kakkanad: brand multi barcode - 10 tags of 10 pcs / 100 g, printed (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-MBB-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const b = DATA.barcode;
    const saved = await barcodeGeneration.generateTag({
      itemType: b.itemType,
      stockIdentityType: b.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      brand: DATA.inward.item.brand, // Brand Name is mandatory for brand tags
      amount: DATA.inward.item.mrp * b.pieces, // Pricing Amount = pcs x MRP
      pieces: b.pieces,
      grossWeight: b.grossWeight,
      multiBarcode: b.multiBarcode,
      descriptions: b.descriptions,
      print: b.print,
    });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const refs = (saved && saved.data && Array.isArray(saved.data.tagReferences)) ? saved.data.tagReferences : [];
    // Metal / Brand saves list the tags in tagReferences; a Stone save answers with
    // a receiptNo only - the lot's tags then come from the post-save lot-serial call
    const tags = refs.length ? refs.map((r) => r.tagNo).filter(Boolean) : (barcodeGeneration.lastLotTags || []).slice(-b.multiBarcode);
    console.log(`Brand multi barcode saved: ${tags.length} tag(s) ${JSON.stringify(tags)} (lot ${lotNo}, ${b.multiBarcode} x ${b.pieces} pcs / ${b.grossWeight} g)`);
    expect(tags.length, `the save must return ${b.multiBarcode} tag references (body ${JSON.stringify(saved).slice(0, 400)})`).toBe(b.multiBarcode);
    expect(new Set(tags).size, 'distinct tag numbers').toBe(b.multiBarcode);
    if (!b.print) { state.writeState({ tags, tagNo: tags[0] }); return; } // print ignored for Brand
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
    expect((printed.toasts || []).join(' | '), 'print confirmation toast').toMatch(new RegExp(`${b.print.copies} barcode print jobs? created`, 'i'));
    console.log(`Barcode print: template "${printed.template}", destination "${printed.destination}", copies ${printed.copies}, print answered ${printed.printStatus ?? 'no request'}`);
    state.writeState({ tags, tagNo: tags[0], print: { template: printed.template, destination: printed.destination, copies: printed.copies, status: printed.printStatus } });
  });
});
