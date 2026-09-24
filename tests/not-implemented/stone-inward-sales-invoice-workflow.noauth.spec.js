const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-stone-sales-state.json');

/**
 * STONE INWARD -> LOT -> BARCODE -> COUNTER -> B2B SALES INVOICE.
 *
 * The stone twin of the metal inward-to-invoice chains: an assorted stone
 * purchase is lotted, tagged, put on a counter and sold to a B2B customer -
 * all at Cochin:
 *
 *   TC-SSI-01  Stone Inward           Stock / Direct, vendor RAJA, Jerald, Without Tare, Gram, 4 pcs, 6 g, return 5 %, ASSORTED STOCK ticked
 *                                     (kept under the 2,000,000 "Stone Rule" approval limit)
 *   TC-SSI-02  Lot Generation         Item Type Stone + From Transaction Type Stone Inward (offered only for assorted inwards)
 *   TC-SSI-03  Barcode                as the barcode employee suja (Item Type Stone, Stock)
 *   TC-SSI-04  Counter Allocation     Item Type Stone, fetch the lot (the tag's RFID is kept)
 *   TC-SSI-05  Counter Accept         Item Type Stone, accept the tag
 *   TC-SSI-06  B2B Sales Invoice      Invoice, customer RAJA, Counter / Tag Wise, RFID scan
 *
 * OPEN (24-09-2026): like Brand, the app has no Stone sales invoice.
 * /sls/app-invoice-setup offers only the "Metal Invoice" tab and it answers
 * "Tag not found" for the counter-accepted stone tag (RSbbb11, by RFID).
 * TC-SSI-06 stays red until the QA lead names the screen that sells stone stock.
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-stone-sales-state.json, so the chain resumes where it
 * stopped and any step can be re-run alone.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

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
      // APPROVAL GATE (24-09-2026): the "Stone Rule" sends every Stone Inward
      // with Invoice Amount > 2,000,000 to user Prabhat, and a held ("Created")
      // inward never reaches Lot Generation. 5 pcs / 10 g came to 2,260,000;
      // 4 pcs / 6 g stays under the limit whether Jerald is priced per gram or per piece
      noOfPcs: 4,
      grossWeight: 6,
      returnPercent: 5, // mandatory per the stone-inward guide
      assortedStock: true, // lot eligibility gate (QA lead 04-09-2026)
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

test.describe('Stone Inward - Sales Invoice - Workflow', () => {
  test('TC-SSI-01 create the stone inward (stock, assorted)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
    await login(loginPage);

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
    await stoneInward.addItem();
    await expect
      .poll(async () => stoneInward.summaryText(), { timeout: 20_000 })
      .toMatch(/Vendor Name\s*:\s*RAJA/);

    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.nextBtn.click();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit(); // answers "Process with Barcode or Lot?" with No when asked
    expect(saved, 'stone inward save response').toBeTruthy();
    let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
    if (!inwardVoucherNo) inwardVoucherNo = await stoneInward.voucherNumber().catch(() => '');
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Stone inward saved: ${inwardVoucherNo} (invoice ${invoiceNo})`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-SSI-02 lot generation from the assorted inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SSI-01 first').toBeTruthy();
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

  test('TC-SSI-03 barcode tag from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-SSI-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    let saved;
    try {
      saved = await barcodeGeneration.generateTag({
        itemType: DATA.barcode.itemType,
        stockIdentityType: DATA.barcode.stockIdentityType,
        vendor: DATA.inward.vendor,
        lotNo,
        grossWeight: DATA.barcode.grossWeight,
        descriptions: DATA.barcode.descriptions,
      });
    } catch (e) {
      // the tag takes the whole lot: when a previous attempt already
      // tagged it, the counter allocation's lot fetch names the tag
      if (!/already tagged|exceeds Lot Pcs/i.test(String(e))) throw e;
      console.log(`Barcode: lot ${lotNo} is already tagged - the allocation step reads the tag from the lot`);
      state.writeState({ tagNo: '', tagFromLot: true });
      return;
    }
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let tagNo = (saved.data && saved.data.receiptNo) || '';
    if (!/\d{2,4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
      tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.stoneArticle);
    }
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-SSI-04 counter allocation of the lot (Item Type Stone)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(lotNo, 'run TC-SSI-02 first').toBeTruthy();
    await login(loginPage);

    // fetch by LOT (tag numbers repeat on qa); the fetch answer names the
    // tag (when the barcode step could not) and its RFID
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo, vendor: DATA.inward.vendor });
    const scan = logisticsSales.lastScan || logisticsSales.lastScans[0] || {};
    const rfidNo = scan.rfidNo || '';
    expect(tagNo || scan.tagNo, 'the lot fetch must name the tag').toBeTruthy();
    state.writeState({ allocationNo, rfidNo, tagNo: tagNo || scan.tagNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SSI-05 counter accept of the tag (Item Type Stone)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    expect(tagNo, 'run TC-SSI-04 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SSI-06 B2B sales invoice for the stone tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-SSI-05 first').toBeTruthy();
    await login(loginPage);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo, rfidNo });
    state.writeState({ invoiceDocNo });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
