const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-approval-sales-state.json');

/**
 * APPROVAL ISSUE / RECEIPT / SALES END-TO-END WORKFLOW (QA lead, 23-09-2026).
 *
 * One barcoded piece of purchased stock goes out to a B2B customer on
 * approval, comes back into stock, and is then sold - all at Cochin:
 *
 *   TC-AIR-01  Metal Inward           Stock / Direct / Invoice, vendor RAJA, 1 pc Tendulkar 91.60, 60 g
 *   TC-AIR-02  Lot Generation         from the inward
 *   TC-AIR-03  Barcode                one tag from the lot (as the barcode employee suja)
 *   TC-AIR-04  Counter Allocation     scan the tag
 *   TC-AIR-05  Counter Accept         accept the allocated tag
 *   TC-AIR-06  Approval Issue         Stock -> Customer (RAJA), purpose Display, Counter / Tag Wise, scan the tag
 *   TC-AIR-07  Approval Receipt       Customer -> Stock against the RC number, receive the tag
 *   TC-AIR-08  Counter Transfer       the returned tag sits in the Default Stock Accept Counter - "Return to Counter"
 *   TC-AIR-09  Counter Accept         accept it at the counter again
 *   TC-AIR-10  B2B Metal Sales Invoice for the tag (Tag Wise from the counter)
 *
 * Why 08/09: the Metal Invoice sells from "Counter" only (its Stock Source
 * offers nothing else, 23-09-2026) and the Approval Receipt parks the
 * returned tag in the location's Default Stock Accept Counter, where
 * neither Counter Allocation ("Tag / RFID not found or not eligible") nor
 * the invoice ("This tag is not in Counter stock.") can reach it; Counter
 * Transfer's "Return to Counter" + Counter Accept bring it back on sale.
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
      noOfPcs: 1,
      grossWeightWithTare: 60,
      rate: 6000,
    },
  },
  lot: { vendor: 'RAJA', employee: 'Ubaid' },
  barcode: {
    // barcode is USER-SCOPED: the Lot No lookup lists only for the barcode
    // employee's login (QA lead 18-09-2026: barcode user is "suja")
    user: { user: 'suja', pwd: '123', bu: BU },
    stockIdentityType: 'Stock', // purchase inwards land as plain Stock
    vendor: 'RAJA',
    grossWeight: 10, // capped to the lot weight by the page object
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

test.describe('Approval Issue - Approval Receipt - B2B Sales - Workflow', () => {
  test('TC-AIR-01 metal inward (stock, direct purchase)', async ({ loginPage, metalInward, page }) => {
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
    await metalInward.addItem(); // verified Add Item (mandatory description selects, retries)
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
    await metalInward.fillPureRateIfEmpty(DATA.inward.item.rate);

    const saved = await metalInward.submit();
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

  test('TC-AIR-03 barcode tag from the lot (as the barcode employee)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-AIR-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.barcode.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    // the TAG NUMBER: the save's receiptNo when it looks like a tag, else
    // read it from the Generated Tags view
    let tagNo = (saved.data && saved.data.receiptNo) || '';
    if (!/\d{4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
      tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    }
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-AIR-04 counter allocation of the tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, lotNo } = state.readState();
    expect(tagNo, 'run TC-AIR-03 first').toBeTruthy();
    await login(loginPage);

    // fetch by LOT, not by tag number: tag numbers repeat on qa (the day
    // series restarts under the pinned business date), and the RFID the
    // scan answers with is what the later tag-wise screens key on
    const allocationNo = await logisticsSales.counterAllocation({ ...DATA.counter, tagNo, lotNo });
    const rfidNo = (logisticsSales.lastScan && logisticsSales.lastScan.rfidNo) || '';
    state.writeState({ allocationNo, rfidNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by tag'}, rfid ${rfidNo || 'not captured'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-05 counter accept of the tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo } = state.readState();
    expect(tagNo, 'run TC-AIR-04 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-06 approval issue of the tag (Stock to customer RAJA)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-AIR-05 first').toBeTruthy();
    await login(loginPage);

    const approvalRcNo = await logisticsSales.approvalIssue({ ...DATA.approval, tagNo, rfidNo });
    expect(approvalRcNo, 'approval issue RC number').toBeTruthy();
    state.writeState({ approvalRcNo });
    console.log(`Approval issue saved: ${approvalRcNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-07 approval receipt of the tag (customer RAJA back to stock)', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, approvalRcNo } = state.readState();
    expect(tagNo && approvalRcNo, 'run TC-AIR-06 first').toBeTruthy();
    await login(loginPage);

    const approvalReceiptNo = await logisticsSales.approvalReceipt({ customer: DATA.approval.customer, rcNo: approvalRcNo, tagNo, rfidNo, metalRate: DATA.approval.metalRate });
    state.writeState({ approvalReceiptNo, approvalReceived: true });
    console.log(`Approval receipt saved: ${approvalReceiptNo || 'keyed by tag'}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-08 counter transfer: return the received tag from the Default Stock Accept Counter', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, approvalReceived } = state.readState();
    expect(tagNo && approvalReceived, 'run TC-AIR-07 first').toBeTruthy();
    await login(loginPage);

    const body = await logisticsSales.returnToCounter({ tagNo });
    expect(body, 'counter transfer save response').toBeTruthy();
    const reallocationNo = (body.data && (body.data.receiptNo || body.data.docNo)) || 'returned';
    state.writeState({ reallocationNo });
    console.log(`Counter transfer (Return to Counter) saved: ${reallocationNo}`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-09 counter accept of the returned tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, reallocationNo } = state.readState();
    expect(tagNo && reallocationNo, 'run TC-AIR-08 first').toBeTruthy();
    await login(loginPage);

    // a 'Return to Counter' transfer lands approved - accept only when the grid offers the tag
    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo, rfidNo, optional: true });
    expect(body, 'counter accept response').toBeTruthy();
    state.writeState({ reaccepted: true });
    console.log(body.skipped ? 'Counter re-accept: nothing pending - the returned tag is already on the counter' : 'Counter re-accept saved');
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-AIR-10 B2B metal sales invoice for the tag', async ({ loginPage, logisticsSales }) => {
    test.setTimeout(600_000);
    const { tagNo, rfidNo, reaccepted } = state.readState();
    expect(tagNo && reaccepted, 'run TC-AIR-09 first').toBeTruthy();
    await login(loginPage);

    const invoiceDocNo = await logisticsSales.b2bSalesInvoice({ ...DATA.invoice, tagNo, rfidNo });
    state.writeState({ invoiceDocNo });
    console.log(`B2B sales invoice saved (doc: ${invoiceDocNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });
});
