const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo, businessDate } = require('../../utils/unique');
const { nextCustomerName, uniqueMobileNumber } = require('../../utils/customer-name');
const { DEMO_FILES } = require('../../utils/demo-files');
const sessionCache = require('../../utils/session-cache');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-direct-invoice-state.json');

/**
 * E2E WORKFLOW — METAL INWARD (Direct) -> LOT -> BARCODE -> RETAIL CUSTOMER
 * -> RETAIL SALES INVOICE (Invoice Source "Direct"), everything at the
 * Kakkanad head office. Requested 30-10-2026.
 *
 *   TC-RDI-01  Kakkanad, admin: Procurement > Stock Inward > Metal (Invoice /
 *              Stock / Direct, vendor RAJA; Tendulkar 91.60, 1 pc, 100 g),
 *              "Process with Barcode or Lot?" = No
 *   TC-RDI-02  Kakkanad, admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-RDI-03  Kakkanad, suja:  Barcode Generation for the lot (1 piece, Additional
 *              Charges, no counter - a direct retail sale needs no Counter Allocation)
 *   TC-RDI-04  Kakkanad, admin: CRM > Customer Registration - a new Individual
 *              RETAIL customer (SioniqCustomer<n>, dynamic mobile number); the
 *              invoice sells to this customer (user 30-10-2026: "retail customer
 *              from customer registration")
 *   TC-RDI-05  Kakkanad, admin: Retail Operation > Operations > Invoice (/pos/view-sales-invoice),
 *              Invoice Source "Direct": the registered customer (by mobile number), Sales
 *              Executive code echoing "Chandu" + Helper Chandu, scan the tag (Item Details
 *              fill from the tag) -> Add Item -> Proceed To Payment (Cash Test Mode, full
 *              balance) -> Submit (CreateSalesInvoice, receiptNo e.g. "26")
 *
 * Known qa toast on the invoice: "Setup required - No active tax template is configured
 * for this transaction at the selected location" - informational, the save goes through
 * (the same toast was seen on the B2B invoice, 24-09-2026).
 *
 * Numbers chain through e2e-retail-direct-invoice-state.json. The POS "+"
 * only opens its form on a session that went through the login FORM
 * (counter validation, 22-10-2026) - TC-RDI-05 clears the session cache.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
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
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, // QA lead 23-10-2026: barcode login suja @ Kakkanad
    stockIdentityType: 'Stock', // purchase inwards = Stock
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: null, // no counter: the retail invoice sells the tag straight from stock (Invoice Source Direct)
  },
  customer: {
    kind: 'Individual',
    title: 'Mr.', // options carry the dot
    gender: 'Male',
    dob: '01/12/1996',
    document: { type: 'Aadhar Card', file: DEMO_FILES.image1 }, // one demo image + a dynamic 12-digit number
    address: {}, // zip code first (it cascades the rest); remaining fields fall back to the first option
  },
  invoice: {
    salesman: 'Chandu', // Kakkanad sales executive / helper (QA lead 27-10-2026)
    helper: 'Chandu',
    metalRate: 6000,
    payment: { mode: 'Cash' }, // Proceed To Payment -> Payment Collection: the first cash mode ("Cash Test Mode" at Kakkanad), full balance due (user 30-10-2026: "payment type - cash")
  },
};

// Approval rule on qa (Intelligence Engine > Approvals > Approval Rule "Anson Approval",
// read 30-10-2026): a Metal Inward with Invoice Amount > 2500 is saved as "Created" and
// waits for user Prabhat in /adm/app-approval; Lot Generation lists only APPROVED
// inwards. The rule was relaxed on 30-10-2026 (the inward auto-approves again) - if
// TC-RDI-02 cannot find the inward, check the inward's Status column first.

/** The POS Invoice form needs a FORM login (the replayed session cache lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null; // forget the live session too, so ensureLoggedIn goes through the form
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Direct Invoice - Metal Inward - Lot - Barcode - Customer - Workflow', () => {
  test('TC-RDI-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain - no stale lot / tag / customer / invoice numbers
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
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await metalInward.clickNext();
    await metalInward.waitForIdle();

    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.clickNext(); // no-op since 01-10-2026 (the item step ends in Submit)
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit(); // answers "Process with Barcode or Lot?" with No
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, customerName: null, customerMobile: null, invoiceDocNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-rdi-01-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-RDI-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RDI-01 first').toBeTruthy();
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

  test('TC-RDI-03 Kakkanad: generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-RDI-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      pieces: 1,
      additionalCharges: true, // every barcode needs Additional Charges (QA lead 26-09-2026)
      descriptions: DATA.barcode.descriptions,
      counter: DATA.barcode.counter,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    // the tag number comes with the save (receiptNo / tagReferences); the Generated
    // Tags view is the fallback - a post-save print dialog can sit over it (30-10-2026)
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-RDI-04 Kakkanad: register a retail customer (CRM > Customer Registration)', async ({ loginPage, customerRegistration }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-RDI-03 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await customerRegistration.open();
    await customerRegistration.openAddForm();

    const customerName = nextCustomerName();
    const customerMobile = uniqueMobileNumber();
    await customerRegistration.fillCustomer({
      ...DATA.customer,
      name: customerName,
      contactNumber: customerMobile,
      anniversary: businessDate(0).replace(/-/g, '/'),
      email: `qa${Date.now()}@example.com`,
      document: { ...DATA.customer.document, number: `5${String(Date.now()).slice(-11)}` },
    });
    const saved = await customerRegistration.submitCustomer();
    expect(saved, 'customer save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const customerCode = (saved.data && (saved.data.customerCode || saved.data.receiptNo || saved.data.customerID)) || '';
    state.writeState({ customerName, customerMobile, customerCode });
    console.log(`Retail customer registered: ${customerName} (mobile ${customerMobile}, code ${customerCode || '-'})`);
    expect(customerRegistration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-RDI-05 Kakkanad: retail sales invoice (Invoice Source Direct) for the tag', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo, customerName, customerMobile } = state.readState();
    expect(tagNo && customerName, 'run TC-RDI-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await retailInvoice.createDirectInvoice({
      customer: customerName,
      mobile: customerMobile,
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
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${customerName})`);
    expect(retailInvoice.printPreviewError, 'print template preview').toBeFalsy();
  });
});
