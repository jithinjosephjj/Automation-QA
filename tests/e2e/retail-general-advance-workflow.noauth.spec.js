const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo, businessDate } = require('../../utils/unique');
const { nextCustomerName, uniqueMobileNumber } = require('../../utils/customer-name');
const { DEMO_FILES } = require('../../utils/demo-files');
const sessionCache = require('../../utils/session-cache');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-general-advance-state.json');

/**
 * E2E WORKFLOW — METAL INWARD (Direct) -> LOT -> BARCODE -> CUSTOMER REGISTRATION
 * -> ADVANCE REGISTRATION (General / Retail) -> RETAIL INVOICE (Direct) that
 * adjusts the advance, everything at the Kakkanad head office.
 * Requested 02-11-2026 ("advance type = general, business type = retail",
 * then "-> invoice, Retail Operations > Operations > Invoice").
 *
 *   TC-ADV-01  Kakkanad, admin: Procurement > Stock Inward > Metal (Invoice / Stock /
 *              Direct, vendor RAJA; Tendulkar 91.60, 1 pc 100 g), "Barcode or Lot?" = No
 *   TC-ADV-02  Kakkanad, admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-ADV-03  Kakkanad, suja:  Barcode Generation for the lot (1 piece, Additional
 *              Charges, no counter - the invoice sells the tag straight from stock)
 *   TC-ADV-04  Kakkanad, admin: CRM > Customer Registration - a new Individual RETAIL
 *              customer (SioniqCustomer<n>, dynamic mobile number)
 *   TC-ADV-05  Kakkanad, admin: Retail Operations > Operations > Registrations > Advance
 *              Registration: the customer, Advance Type General, Business Type Retail
 *              -> Advance Details: Sales Executive Chandu (code back-fills), Supervisor
 *              left empty, Advance Amount ₹5,000, Remarks -> Proceed to Payment (Payment
 *              Collection, Cash Test Mode, the full amount) -> Submit
 *              (OrderAdvanceRegistration/SaveGeneralAdvanceRegistration, receiptNo
 *              e.g. "ADV-005KK")
 *   TC-ADV-06  Kakkanad, admin: Retail Operations > Operations > Invoice
 *              (/pos/view-sales-invoice), Invoice Source Direct: the customer (by mobile
 *              number), Sales Executive Chandu + Helper Chandu, scan the tag -> Add Item
 *              -> Proceed To Payment: the "Advance" mode adjusts the general advance,
 *              Cash Test Mode pays the rest -> Submit (CreateSalesInvoice)
 *
 * A General advance has no estimation / order behind it, so its wizard is
 * "Step 1 Customer Details / Step 2 Advance Details" with no Entry Type and no
 * Fetch. Supervisor is optional on qa; an unapproved one (Abc) is rejected with
 * "Selected Supervisor is not in the approved list." (02-11-2026).
 *
 * Known qa toast on the invoice: "Setup required - No active tax template is configured
 * for this transaction at the selected location" - informational, the save goes through.
 *
 * The POS "+" only opens its form on a session that went through the login
 * FORM (counter validation) - the POS steps clear the cache and the live session.
 * Numbers chain through e2e-retail-general-advance-state.json.
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
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 100, rate: 6000 },
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
  advance: {
    businessType: 'Retail',
    salesExecutive: 'Chandu', // Kakkanad sales executive (QA lead 27-10-2026)
    supervisor: process.env.SUPERVISOR || '', // optional; only an APPROVED supervisor is accepted
    amount: Number(process.env.ADVANCE_AMOUNT || 5000),
    remarks: 'E2E general advance',
    paymentMode: 'Cash', // Payment Collection: the first cash mode ("Cash Test Mode" at Kakkanad), full amount
  },
  invoice: {
    salesman: 'Chandu',
    helper: 'Chandu',
    metalRate: 6000,
    // Payment Collection entries in order: the general advance is adjusted first
    // ("Advance" mode: ADVANCE TYPE General + REFERENCE NUMBER = the advance receipt,
    // the amount auto-fills), the remaining balance is paid in cash (first cash mode)
    advanceAdjustment: { mode: 'Advance', advanceType: 'General' },
    balancePayment: { mode: 'Cash' },
  },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail General Advance - Invoice - Workflow', () => {
  test('TC-ADV-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
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
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, customerName: null, customerMobile: null, advanceNo: null, invoiceDocNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-adv-01-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-ADV-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-ADV-01 first').toBeTruthy();
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

  test('TC-ADV-03 Kakkanad: generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-ADV-02 first').toBeTruthy();
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
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-ADV-04 Kakkanad: register a retail customer (CRM > Customer Registration)', async ({ loginPage, customerRegistration }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-ADV-03 first').toBeTruthy();
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

  test('TC-ADV-05 Kakkanad: advance registration (General, Retail) for the customer', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { customerName, customerMobile } = state.readState();
    expect(customerName, 'run TC-ADV-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerGeneralAdvance({ customer: customerName, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo });
    console.log(`General advance registered: ${advanceNo} (customer ${customerName}, mobile ${customerMobile}, ₹${DATA.advance.amount})`);
  });

  test('TC-ADV-06 Kakkanad: retail sales invoice (Direct) for the tag, adjusting the advance', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo, customerName, customerMobile, advanceNo } = state.readState();
    expect(tagNo && customerName && advanceNo, 'run TC-ADV-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await retailInvoice.createDirectInvoice({
      customer: customerName,
      mobile: customerMobile,
      salesman: DATA.invoice.salesman,
      helper: DATA.invoice.helper,
      tagNo,
      metalRate: DATA.invoice.metalRate,
      payment: { entries: [{ ...DATA.invoice.advanceAdjustment, reference: advanceNo }, DATA.invoice.balancePayment] },
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${customerName}, advance ${advanceNo} adjusted)`);
    expect(retailInvoice.printPreviewError, 'print template preview').toBeFalsy();
  });
});
