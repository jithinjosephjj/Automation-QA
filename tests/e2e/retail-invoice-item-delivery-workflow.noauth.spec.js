const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');
const { ItemDeliveryPage } = require('../../pages/ItemDeliveryPage');

const state = makeState('e2e-retail-item-delivery-state.json');

/**
 * E2E WORKFLOW — METAL INWARD (Direct) -> LOT -> METAL BARCODE TAG -> RETAIL
 * SALES INVOICE (credit: saved with the balance due) -> ITEM DELIVERY of the
 * tag against that invoice number, everything at Kakkanad. Requested
 * 16-11-2026 ("create a metal barcode tag, then do sale invoice then item
 * delivery. paste invoice no in item delivery").
 *
 *   TC-RID-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), barcode-or-lot = No
 *   TC-RID-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-RID-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges,
 *              no counter)
 *   TC-RID-04  admin: Retail Operation > Operations > Invoice (Invoice Source
 *              Direct) for an existing retail customer, scan the tag, Add Item,
 *              Proceed To Payment -> "Credit Payment Mode" for the whole balance
 *              (Amount, Credit Due Date = process date + 7 days, Description) ->
 *              Submit. A CREDIT sale keeps its balance due, so the app HOLDS the
 *              item - only such invoices are offered on Item Delivery; a fully
 *              paid cash invoice hands the item over on the spot (probed
 *              16-11-2026). Submit with no collection at all fires no save.
 *   TC-RID-05  admin: Retail Operation > Operations > Item Delivery
 *              (/pos/view-sales-credit-item-delivery): "+", the invoice number
 *              typed into Invoice No, the held tag verified + ticked
 *              ("Releasing"), Delivery Mode Counter Handover, Received By Self,
 *              both handover checkboxes (Signature captured is mandatory), OTP
 *              Verification (Send OTP -> six-digit popup; any six digits verify on
 *              qa, DELIVERY_OTP env) and "Deliver & Print Challan" -> KK## delivery
 *              (CreateSalesCreditItemDelivery); the delivery is then listed
 *              (Delivery Status Delivered). Without the OTP the Deliver click
 *              silently does nothing.
 *
 * Numbers chain through e2e-retail-item-delivery-state.json. The POS forms
 * need a session that went through the login FORM (counter validation) -
 * TC-RID-04 / 05 clear the session cache first. MUST run headed - see README.
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: VENDOR,
    purchaser: 'Abc',
    item: {
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 100,
      rate: 6000,
    },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE },
    stockIdentityType: 'Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: null, // the retail invoice sells the tag straight from stock
  },
  invoice: {
    // an existing Kakkanad retail customer (the Item Delivery list is full of this one's credit invoices)
    customer: process.env.CUSTOMER || 'Abhilash Attayam',
    mobile: process.env.MOBILE || '8778894889',
    salesman: 'Chandu',
    helper: 'Chandu',
    metalRate: 6000,
    // the whole balance on credit: the item stays HELD until Item Delivery releases it
    payment: { mode: 'Credit', creditDays: Number(process.env.CREDIT_DAYS || 7), description: 'Automation credit sale' },
  },
  delivery: {
    deliveryMode: 'Counter Handover',
    receivedBy: 'Self',
    remarks: 'Automation delivery',
  },
};

/** The POS forms need a FORM login (the replayed session cache lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Invoice -> Item Delivery - Metal Inward - Lot - Barcode - Workflow', () => {
  test('TC-RID-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({
      subTransactionType: DATA.inward.subTransactionType,
      businessUnit: HEAD_OFFICE,
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(),
    });
    await metalInward.clickNext();
    await metalInward.waitForIdle();

    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit();
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, invoiceDocNo: null, deliveryNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-rid-01-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-RID-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RID-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.inward.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      location: DATA.lot.location,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
    expect(lotGeneration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-RID-03 Kakkanad: generate the metal barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-RID-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      pieces: 1,
      additionalCharges: true,
      descriptions: DATA.barcode.descriptions,
      counter: DATA.barcode.counter,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-RID-04 Kakkanad: retail sales invoice (Direct) for the tag on credit', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-RID-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await retailInvoice.createDirectInvoice({
      customer: DATA.invoice.customer,
      mobile: DATA.invoice.mobile,
      salesman: DATA.invoice.salesman,
      helper: DATA.invoice.helper,
      tagNo,
      metalRate: DATA.invoice.metalRate,
      payment: DATA.invoice.payment,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${DATA.invoice.customer}, payment ${JSON.stringify(DATA.invoice.payment)})`);
    expect(retailInvoice.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-RID-05 Kakkanad: item delivery of the tag against the invoice number', async ({ loginPage, itemDelivery, page }) => {
    test.setTimeout(600_000);
    const { tagNo, invoiceDocNo } = state.readState();
    expect(tagNo && invoiceDocNo, 'run TC-RID-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await itemDelivery.deliver({
      invoiceNo: invoiceDocNo,
      tagNo,
      deliveryMode: DATA.delivery.deliveryMode,
      receivedBy: DATA.delivery.receivedBy,
      remarks: DATA.delivery.remarks,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const deliveryNo = ItemDeliveryPage.numberOf(body);
    state.writeState({ deliveryNo });
    console.log(`Item delivery saved: ${deliveryNo || '(number not in the save body)'} (invoice ${invoiceDocNo}, tag ${tagNo})`);
    expect(itemDelivery.printPreviewError, 'print template preview').toBeFalsy();

    const row = await itemDelivery.verifyDeliveryListed(invoiceDocNo, { deliveryNo });
    expect(row, `delivery of invoice ${invoiceDocNo} listed on Item Delivery`).toBeTruthy();
    expect(row).toMatch(/Delivered/i);
  });
});
