const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-approval-sales-state.json');

/**
 * APPROVAL ISSUE / RECEIPT / SALES END-TO-END WORKFLOW (QA lead, 23/24-09-2026).
 *
 * TWO barcoded pieces of purchased stock go out to a B2B customer on ONE
 * approval; the customer returns one piece (Approval Receipt) and keeps the
 * other, which is then invoiced against the approval - all at Cochin:
 *
 *   TC-AIR-01  Metal Inward           Stock / Direct / Invoice, vendor RAJA, 2 pcs Tendulkar 91.60, 60 g
 *   TC-AIR-02  Lot Generation         from the inward
 *   TC-AIR-03  Barcode                the lot's tags (2) as the barcode employee suja
 *   TC-AIR-04  Counter Allocation     fetch the lot -> both tags (their RFIDs are kept)
 *   TC-AIR-05  Counter Accept         accept both tags
 *   TC-AIR-06  Approval Issue         Stock -> Customer (RAJA), purpose Display, Counter / Tag Wise, both tags
 *   TC-AIR-07  Approval Receipt       Customer -> Stock against the RC number: tag A comes back
 *   TC-AIR-08  B2B Metal Sales Invoice  Issue Type "Approval RC No": tag B (still with the customer) is invoiced
 *
 * Why two pieces (QA lead 24-09-2026: "no counter transfer - approval
 * receipt, then the invoice"): the Metal Invoice sells counter stock (Tag
 * Wise) or tags STILL OUT on an approval ("Approval RC No"); a tag that
 * came back through the Approval Receipt is neither - it is parked in the
 * Default Stock Accept Counter and every invoice path refuses it. Receiving
 * one piece and invoicing the other is the flow the app supports.
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-approval-sales-state.json, so the chain resumes where it
 * stopped and any step can be re-run alone.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

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
      noOfPcs: 2, // two tags: one comes back, one is invoiced
      grossWeightWithTare: 60,
      rate: 6000, // the per-item rate (gone since 23-09; the pure rate 15000 is entered after Add Item)
    },
  },
  lot: { vendor: 'RAJA', employee: 'Ubaid' },
  barcode: {
    // barcode is USER-SCOPED: the Lot No lookup lists only for the barcode
    // employee's login (QA lead 18-09-2026: barcode user is "suja")
    user: { user: 'suja', pwd: '123', bu: BU },
    stockIdentityType: 'Stock', // purchase inwards land as plain Stock
    vendor: 'RAJA',
    grossWeight: 10, // per tag; pieces are capped to the lot's pieces by the page object
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
  counter: { itemType: 'Metal', groupCategory: 'Gold' },
  approval: {
    customer: 'RAJA',
    purpose: 'Display',
    salesman: 'Ajin G',
    helper: 'Ajin G',
    supervisor: 'Ajin G',
    metalRate: 6000, // the "Metal weight" Rate (₹/gm) - Submit refuses without it
  },
  invoice: { customer: 'RAJA', salesman: 'Ajin G' },
};

async function login(loginPage, creds = {}) {
  await loginPage.ensureLoggedIn({ ...creds, bu: BU });
}

/** The chain's tags from the state file: [tag A (received back), tag B (invoiced)]. */
function tagsFromState() {
  const s = state.readState();
  const tags = Array.isArray(s.tags) && s.tags.length ? s.tags : [{ tagNo: s.tagNo, rfidNo: s.rfidNo || '' }];
  return tags;
}

test.describe('Approval Issue - Approval Receipt - B2B Sales - Workflow', () => {
  test('TC-AIR-01 metal inward (stock, direct purchase, 2 pieces)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
    await login(loginPage);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      businessUnit: BU,
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem(); // verified Add Item: mandatory description selects, the pure rate after the add
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
    await metalInward.fillPureRateIfEmpty();

    const saved = await metalInward.submit(); // answers "Process with Barcode or Lot?" with No
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
    if (!inwardVoucherNo) inwardVoucherNo = await metalInward.voucherNumber().catch(() => '');
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-AIR-02 lot generation from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-AIR-01 first').toBeTruthy();
    await login(loginPage);

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.lot.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: BU,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-AIR-03 barcode tags from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-AIR-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    // ONE save with pieces = 2 makes ONE tag carrying 2 pieces (24-09-2026),
    // so generate the lot's pieces one save at a time: each save is a tag
    const tags = [];
    for (let i = 0; i < DATA.inward.item.noOfPcs; i++) {
      const saved = await barcodeGeneration.generateTag({
        stockIdentityType: DATA.barcode.stockIdentityType,
        vendor: DATA.barcode.vendor,
        lotNo,
        grossWeight: DATA.barcode.grossWeight,
        pieces: 1,
        descriptions: DATA.barcode.descriptions,
      });
      expect(saved, `barcode save response (tag ${i + 1})`).toBeTruthy();
      expect(JSON.stringify(saved)).toMatch(/success/i);
      // the TAG NUMBER: the save's receiptNo when it looks like a tag, else
      // read it from the Generated Tags view
      let tagNo = (saved.data && saved.data.receiptNo) || '';
      if (!/\d{4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
        tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
      }
      expect(tagNo, `generated tag number (tag ${i + 1})`).toBeTruthy();
      tags.push({ tagNo, rfidNo: '' }); // the RFIDs come from the allocation's lot fetch (TC-AIR-04)
      console.log(`Barcode tag ${i + 1}/${DATA.inward.item.noOfPcs} generated for lot ${lotNo}: ${tagNo}`);
    }
    state.writeState({ tagNo: tags[0].tagNo, tags });
  });

  test('TC-AIR-04 counter allocation of the lot (both tags)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(tagNo, 'run TC-AIR-03 first').toBeTruthy();
    await login(loginPage);

    // fetch by LOT, not by tag number: tag numbers repeat on qa (the day
    // series restarts under the pinned business date); the fetch answer's
    // RFIDs are what the later tag-wise screens key on
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo });
    const fetched = logisticsSales.lastScans || [];
    // keep the barcode step's tag order (tag A first), add the RFIDs the fetch answered with
    const known = tagsFromState();
    const tags = (known.length > 1 ? known : fetched).map((t) => ({ tagNo: t.tagNo, rfidNo: t.rfidNo || (fetched.find((f) => f.tagNo === t.tagNo) || {}).rfidNo || '' }));
    expect(tags.length, `the chain needs ${DATA.inward.item.noOfPcs} tags (got ${JSON.stringify(tags)})`).toBeGreaterThanOrEqual(DATA.inward.item.noOfPcs);
    expect(fetched.length, `the lot fetch must stage ${DATA.inward.item.noOfPcs} tags (got ${JSON.stringify(fetched)})`).toBeGreaterThanOrEqual(DATA.inward.item.noOfPcs);
    state.writeState({ allocationNo, tags, rfidNo: (tags.find((t) => t.tagNo === tagNo) || tags[0]).rfidNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by lot'}, tags ${JSON.stringify(tags)})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-05 counter accept of both tags', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    const tags = tagsFromState();
    expect(tagNo, 'run TC-AIR-04 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo, tags });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-06 approval issue of both tags (Stock to customer RAJA)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    const tags = tagsFromState();
    expect(tagNo && counterAccepted, 'run TC-AIR-05 first').toBeTruthy();
    await login(loginPage);

    const approvalRcNo = await logisticsSales.approvalIssue({ ...DATA.approval, tagNo, rfidNo, tags });
    expect(approvalRcNo, 'approval issue RC number').toBeTruthy();
    state.writeState({ approvalRcNo });
    console.log(`Approval issue saved: ${approvalRcNo} (${tags.length} tag(s))`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-07 approval receipt: tag A comes back from customer RAJA', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { approvalRcNo } = state.readState();
    const [tagA] = tagsFromState();
    expect(tagA && tagA.tagNo && approvalRcNo, 'run TC-AIR-06 first').toBeTruthy();
    await login(loginPage);

    const approvalReceiptNo = await logisticsSales.approvalReceipt({ customer: DATA.approval.customer, rcNo: approvalRcNo, tagNo: tagA.tagNo, rfidNo: tagA.rfidNo, metalRate: DATA.approval.metalRate });
    state.writeState({ approvalReceiptNo, approvalReceived: true, receivedTag: tagA });
    console.log(`Approval receipt saved: ${approvalReceiptNo || 'keyed by tag'} (tag ${tagA.tagNo} back in stock)`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-08 B2B metal sales invoice for tag B against the approval RC', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { approvalRcNo, approvalReceived } = state.readState();
    const tags = tagsFromState();
    const tagB = tags[1] || tags[0];
    expect(tagB && tagB.tagNo && approvalRcNo && approvalReceived, 'run TC-AIR-07 first').toBeTruthy();
    if (tags.length < 2) console.log('WARNING: only one tag in the chain - the received tag cannot be invoiced; expect the RC to list nothing');
    await login(loginPage);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo: tagB.tagNo, rfidNo: tagB.rfidNo, approvalRcNo });
    state.writeState({ invoiceDocNo, invoicedTag: tagB });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'}) for tag ${tagB.tagNo} against RC ${approvalRcNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
