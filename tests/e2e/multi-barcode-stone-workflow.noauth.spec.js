const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');
const { STONE_ARTICLE } = require('../../utils/stone-article');

const state = makeState('e2e-multi-barcode-stone-state.json');

/**
 * E2E WORKFLOW — MULTI BARCODE for STONE: STONE INWARD (assorted stock, 100 pcs,
 * 1000 g) -> LOT (Item Type Stone, From Transaction Type Stone Inward) -> STONE
 * BARCODE with "Multi Barcode" ticked (10 tags of 10 pcs / 100 g). Requested
 * 14-11-2026 ("do multibarcode for stone inward"); the metal and brand twins are
 * multi-barcode-metal-workflow / multi-barcode-brand-workflow.
 *
 *   TC-MBS-01  admin: Procurement > Stock Inward > Stone (Stock / Direct, vendor RAJA,
 *              stone article per utils/stone-article, Without Tare, Gram, 100 pcs,
 *              1000 g, return 5 %, ASSORTED STOCK ticked = lot eligibility)
 *   TC-MBS-02  admin: Lot Generation (Item Type Stone, From Transaction Type Stone
 *              Inward, employee Ubaid, Location Kakkanad)
 *   TC-MBS-03  suja:  Barcode Generation (Item Type Stone, Stock): Pieces 10, Stone
 *              Gross Weight 100, Multi Barcode ticked with 10 -> Submit answers with 10
 *              tag references; the post-save Barcode Print (Copies 10) when qa has a
 *              print configuration for stone tags, else recorded as a setup gap
 *
 * Numbers chain through e2e-multi-barcode-stone-state.json. MUST run headed.
 */

const HEAD_OFFICE = 'Kakkanad';
const TAGS = Number(process.env.MULTI_BARCODE || 10);
const PCS_PER_TAG = 10;

const DATA = {
  inward: {
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    item: {
      refType: 'Combination',
      stoneArticle: STONE_ARTICLE,
      entryMode: 'Without Tare',
      uom: 'Gram',
      noOfPcs: TAGS * PCS_PER_TAG, // 100
      grossWeight: 1000,
      returnPercent: 5,
      assortedStock: true, // lot eligibility gate (QA lead 04-09-2026)
    },
  },
  lot: { itemType: 'Stone', transactionType: 'Stone Inward', employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE },
    itemType: 'Stone',
    stockIdentityType: 'Stock',
    pieces: PCS_PER_TAG,
    grossWeight: 100,
    multiBarcode: TAGS,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    print: { destination: process.env.PRINTER || undefined, copies: Number(process.env.PRINT_COPIES || 10) },
  },
};

test.describe('Multi Barcode (Stone) - Stone Inward (100 pcs) - Lot - 10 tags - Workflow', () => {
  test('TC-MBS-01 Kakkanad: stone inward 100 pcs / 1000 g (stock, Direct, assorted)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();
    const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, ''); // the Stone invoice field strips separators
    await stoneInward.fillBasicDetails({ inwardType: DATA.inward.inwardType, purchaseType: DATA.inward.purchaseType, vendor: DATA.inward.vendor, invoiceNo, invoiceDate: businessDate(0).replace(/-/g, '/') });
    await stoneInward.clickNext();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });
    await stoneInward.fillItem(DATA.inward.item);
    await stoneInward.addItem();
    await expect.poll(async () => stoneInward.summaryText(), { timeout: 20_000 }).toMatch(/Vendor Name\s*:\s*RAJA/);
    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) await stoneInward.clickNext();
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit();
    expect(saved, 'stone inward save response').toBeTruthy();
    const inwardVoucherNo = await stoneInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tags: [] });
    console.log(`Stone inward saved: ${inwardVoucherNo} (${DATA.inward.item.noOfPcs} pcs, ${DATA.inward.item.grossWeight} g, invoice ${invoiceNo})`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-MBS-02 Kakkanad: generate a lot from the assorted stone inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-MBS-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ itemType: DATA.lot.itemType, transactionType: DATA.lot.transactionType, vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-MBS-03 Kakkanad: stone multi barcode - 10 tags of 10 pcs / 100 g (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-MBS-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const b = DATA.barcode;
    const saved = await barcodeGeneration.generateTag({
      itemType: b.itemType,
      stockIdentityType: b.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
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
    console.log(`Stone multi barcode saved: ${tags.length} tag(s) ${JSON.stringify(tags)} (lot ${lotNo}, ${b.multiBarcode} x ${b.pieces} pcs / ${b.grossWeight} g)`);
    expect(tags.length, `the save must return ${b.multiBarcode} tag references (body ${JSON.stringify(saved).slice(0, 400)})`).toBe(b.multiBarcode);
    expect(new Set(tags).size, 'distinct tag numbers').toBe(b.multiBarcode);
    const printed = barcodeGeneration.lastPrint || {};
    if (!printed.shown && printed.setupGap) {
      test.info().annotations.push({ type: 'setup-gap', description: `Barcode Print: ${printed.setupGap}` });
      console.log(`SETUP-GAP (qa): no Barcode Print dialog - ${printed.setupGap}`);
      state.writeState({ tags, tagNo: tags[0], print: { setupGap: printed.setupGap } });
      return;
    }
    expect(printed.shown, 'the Barcode Print dialog opened after the save').toBe(true);
    expect(Number(printed.copies), 'Copies').toBe(b.print.copies);
    console.log(`Barcode print: template "${printed.template}", destination "${printed.destination}", copies ${printed.copies}, print answered ${printed.printStatus ?? 'no request'}`);
    state.writeState({ tags, tagNo: tags[0], print: { template: printed.template, destination: printed.destination, copies: printed.copies, status: printed.printStatus } });
  });
});
