const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-brand-sales-state.json');

/**
 * BRAND INWARD -> LOT -> BARCODE -> COUNTER -> B2B SALES INVOICE.
 *
 * The brand twin of the metal inward-to-invoice chains: a branded piece is
 * purchased, lotted, tagged, put on a counter and sold to a B2B customer -
 * all at Cochin:
 *
 *   TC-BSI-01  Brand Inward           Stock / Direct / Invoice, vendor RAJA, Gold / Ring / Amraa / Tendulkar, 10 pcs, 20 g, MRP 90000, no discount
 *   TC-BSI-02  Lot Generation         Item Type Brand + From Transaction Type Brand Inward
 *   TC-BSI-03  Barcode                as the barcode employee suja (Item Type Brand, Brand Name + Pricing Amount mandatory)
 *   TC-BSI-04  Counter Allocation     Item Type Brand, fetch the lot (the tag's RFID is kept)
 *   TC-BSI-05  Counter Accept         Item Type Brand, accept the tag
 *   TC-BSI-06  B2B Metal Sales Invoice  Invoice, customer RAJA, Counter / Tag Wise, RFID scan
 *
 * OPEN (24-09-2026): the app has no Brand sales invoice. /sls/app-invoice-setup
 * offers a single "Metal Invoice" tab (no Item Type select) and it answers
 * "Tag not found" for the counter-accepted brand tag by RFID and by tag
 * number; Retail Operations has no sale screen either. TC-BSI-06 stays red
 * until the QA lead names the screen that sells Brand stock.
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-brand-sales-state.json, so the chain resumes where it
 * stopped and any step can be re-run alone.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

const DATA = {
  inward: {
    vendor: 'RAJA',
    purchaseType: 'Direct',
    costCenter: BU,
    inwardType: 'Stock',
    purchaser: 'Ajin G',
    item: {
      referenceType: 'Combination',
      groupCategory: 'Gold',
      category: 'Ring',
      brand: 'Amraa',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 10,
      grossWeight: 20,
      mrp: 90000, // inward amount caps at 950000 (Exceeds max) - keep MRP x pcs under it
      // NO discount: the LOT's amount (MRP x pcs) is capped at the inward's
      // TAXABLE value, so any inward discount blocks Add To Lot
      discountPercent: 0,
    },
  },
  lot: { itemType: 'Brand', transactionType: 'Brand Inward', employee: 'Ubaid' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: BU }, // barcode runs as a different user
    itemType: 'Brand',
    stockIdentityType: 'Stock',
    grossWeight: 10, // within the inward's 20 g
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
  counter: { itemType: 'Brand', groupCategory: 'Gold' },
  invoice: { subType: 'Invoice', customer: 'RAJA', salesman: 'Ajin G' },
};

async function login(loginPage, creds = {}) {
  await loginPage.ensureLoggedIn({ ...creds, bu: BU });
}

test.describe('Brand Inward - Sales Invoice - Workflow', () => {
  test('TC-BSI-01 create the brand inward (stock)', async ({ loginPage, brandInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
    await login(loginPage);

    await brandInward.open();
    await brandInward.selectTab();
    await brandInward.openAddWizard();
    await expect
      .poll(async () => brandInward.selectValue('subTransactionType'), { timeout: 20_000 })
      .toBe('Invoice');

    await brandInward.fillBasicDetails({
      vendor: DATA.inward.vendor,
      purchaseType: DATA.inward.purchaseType,
      costCenter: DATA.inward.costCenter,
      inwardType: DATA.inward.inwardType,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await brandInward.nextBtn.click();
    await expect(brandInward.select('referenceType')).toBeVisible({ timeout: 30_000 });

    await brandInward.fillItem(DATA.inward.item);
    await brandInward.addItem(); // the summary panel is the Add Item proof
    await expect
      .poll(async () => brandInward.summaryText(), { timeout: 20_000 })
      .toContain(`No. of Pieces : ${DATA.inward.item.noOfPcs}`);

    if (!(await brandInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await brandInward.nextBtn.click();
    }
    await expect(brandInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await brandInward.submit(); // answers "Process with Barcode or Lot?" with No when asked
    expect(saved, 'brand inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
    if (!inwardVoucherNo) inwardVoucherNo = await brandInward.voucherNumber().catch(() => '');
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Brand inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-BSI-02 lot generation from the brand inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-BSI-01 first').toBeTruthy();
    await login(loginPage);

    const lotNo = await lotGeneration.generateLot({
      itemType: DATA.lot.itemType,
      transactionType: DATA.lot.transactionType,
      vendor: DATA.inward.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: BU,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-BSI-03 barcode tag from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-BSI-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    let saved;
    try {
      saved = await barcodeGeneration.generateTag({
        itemType: DATA.barcode.itemType,
        stockIdentityType: DATA.barcode.stockIdentityType,
        vendor: DATA.inward.vendor,
        lotNo,
        brand: DATA.inward.item.brand, // Brand Name is mandatory for brand tags
        amount: DATA.inward.item.mrp, // so is the Pricing Amount
        grossWeight: DATA.barcode.grossWeight,
        descriptions: DATA.barcode.descriptions,
      });
    } catch (e) {
      // a brand tag takes the WHOLE lot (10 pcs): when a previous attempt
      // already tagged it, the tag exists - the counter allocation's lot
      // fetch names it in TC-BSI-04
      if (!/already tagged|exceeds Lot Pcs/i.test(String(e))) throw e;
      console.log(`Barcode: lot ${lotNo} is already tagged - the allocation step reads the tag from the lot`);
      state.writeState({ tagNo: '', tagFromLot: true });
      return;
    }
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

  test('TC-BSI-04 counter allocation of the lot (Item Type Brand)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(lotNo, 'run TC-BSI-02 first').toBeTruthy();
    await login(loginPage);

    // fetch by LOT (tag numbers repeat on qa); the fetch answer names the
    // tag (when the barcode step could not) and its RFID, which the later
    // tag-wise screens key on
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo, vendor: DATA.inward.vendor });
    const scan = logisticsSales.lastScan || logisticsSales.lastScans[0] || {};
    const rfidNo = scan.rfidNo || '';
    expect(tagNo || scan.tagNo, 'the lot fetch must name the tag').toBeTruthy();
    state.writeState({ allocationNo, rfidNo, tagNo: tagNo || scan.tagNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-BSI-05 counter accept of the tag (Item Type Brand)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    expect(tagNo, 'run TC-BSI-04 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-BSI-06 B2B sales invoice for the brand tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-BSI-05 first').toBeTruthy();
    await login(loginPage);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo, rfidNo });
    state.writeState({ invoiceDocNo });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
