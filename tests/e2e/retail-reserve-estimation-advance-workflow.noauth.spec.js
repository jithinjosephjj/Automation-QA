const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-reserve-state.json');

/**
 * E2E WORKFLOW — METAL INWARD (Direct) -> LOT -> BARCODE -> RESERVE ESTIMATION
 * -> ADVANCE REGISTRATION (Reserve) -> RETAIL INVOICE that sells the reserved tag
 * and adjusts the reserve advance, everything at the Kakkanad head office.
 * Requested 02-11-2026 ("reserve estimation -> advance registration", then
 * "-> invoice, Retail Operations > Operations > Invoice").
 *
 *   TC-RSV-01  Kakkanad, admin: Procurement > Stock Inward > Metal (Invoice / Stock /
 *              Direct, vendor RAJA; Tendulkar 91.60, 1 pc 100 g), "Barcode or Lot?" = No
 *   TC-RSV-02  Kakkanad, admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-RSV-03  Kakkanad, suja:  Barcode Generation for the lot (1 piece, Additional
 *              Charges, no counter)
 *   TC-RSV-04  Kakkanad, admin: Retail Operations > Operations > Estimations > "Reserve
 *              Estimation" tab: customer, Business Type Retail, Estimation Type TagWise,
 *              Sales Executive Chandu, scan the tag (Tag Details fill: rate 12880,
 *              wastage 13 %), Add Item -> Scanned Tags, "Proceed to Payment" (Payment
 *              Collection: Cash Test Mode, a ₹1,000 advance), then the form's Save
 *              (ReserveEstimation/CreateReserveEstimation, receiptNo e.g. "23")
 *   TC-RSV-05  Kakkanad, admin: Registrations > Advance Registration: Advance Type
 *              Reserve, Type Registration, Business Type Retail, Entry Type Estimation,
 *              Estimation Number + Fetch (FetchReserveEstimationForAdvance), Proceed to
 *              Payment (₹50,000 cash), Submit; the PAN dialog the estimation value trips
 *              ("PAN Number" + Update) is answered with the test PAN first
 *   TC-RSV-06  Kakkanad, admin: Retail Operations > Operations > Invoice
 *              (/pos/view-sales-invoice), Invoice Source Direct (the "Estimation"
 *              source lists no reserve estimations - GetSalesInvoiceEstimationsPaginated
 *              is empty for the customer, 02-11-2026): the customer, Sales Executive
 *              Chandu, scan the RESERVED tag -> Add Item -> Proceed To Payment: the
 *              "Advance" mode with ADVANCE TYPE Reserve + REFERENCE NUMBER = the RE
 *              receipt (GetAdvanceForAdjustment auto-fills ₹51,000 = the ₹50,000 advance
 *              + the ₹1,000 collected on the estimation), Cash Test Mode pays the rest
 *              -> Submit (CreateSalesInvoice)
 *
 * A reserve estimation can be registered once - a rerun of TC-RSV-05 alone answers
 * "Estimation Number Not Found." (02-11-2026); rerun the chain from TC-RSV-01.
 *
 * The POS "+" only opens its form on a session that went through the login
 * FORM (counter validation) - the POS steps clear the cache and the live session.
 * Numbers chain through e2e-retail-reserve-state.json.
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
    counter: null, // a direct retail reservation needs no Counter Allocation
  },
  reserve: {
    customer: process.env.CUSTOMER || 'Aneesh Maradu', // a registered retail customer
    businessType: 'Retail',
    estimationType: 'TagWise', // TagWise | Locker
    salesExecutive: 'Chandu', // Kakkanad sales executive / helper (QA lead 27-10-2026)
    helper: 'Chandu',
  },
  reservePayment: { mode: 'Cash', amount: 1000 }, // the advance collected on the estimation itself (Payment Collection, Cash Test Mode at Kakkanad)
  // a partial cash advance: the full ₹7.6 lakh balance trips the PAN rule (a PAN dialog
  // blocks the save, 02-11-2026); the page object still answers that dialog when it opens
  advance: { advanceType: 'Reserve', subType: 'Registration', businessType: 'Retail', entryType: 'Estimation', remarks: 'E2E reserve advance', paymentMode: 'Cash', amount: 50000 },
  invoice: {
    salesman: 'Chandu',
    helper: 'Chandu',
    metalRate: 6000,
    // Payment Collection entries in order: the reserve advance is adjusted first
    // ("Advance" mode, ADVANCE TYPE Reserve, REFERENCE NUMBER = the RE receipt; the
    // amount auto-fills), the remaining balance is paid in cash (first cash mode)
    advanceAdjustment: { mode: 'Advance', advanceType: 'Reserve' },
    balancePayment: { mode: 'Cash' },
  },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Reserve Estimation - Advance Registration - Invoice - Workflow', () => {
  test('TC-RSV-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
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
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, estimationNo: null, advanceNo: null, invoiceDocNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-rsv-01-print-preview.png' });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-RSV-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RSV-01 first').toBeTruthy();
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

  test('TC-RSV-03 Kakkanad: generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-RSV-02 first').toBeTruthy();
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

  test('TC-RSV-04 Kakkanad: reserve estimation for the tag (TagWise)', async ({ loginPage, orderEstimation, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-RSV-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await orderEstimation.createReserveEstimation({ ...DATA.reserve, tagNo, payment: DATA.reservePayment });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `reserve estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo });
    console.log(`Reserve estimation created: ${estimationNo} (tag ${tagNo})`);
  });

  test('TC-RSV-05 Kakkanad: advance registration (Reserve) against the estimation', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { estimationNo } = state.readState();
    expect(estimationNo, 'run TC-RSV-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerAgainstEstimation({ customer: DATA.reserve.customer, estimationNo, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo });
    console.log(`Reserve advance registered: ${advanceNo} (estimation ${estimationNo})`);
  });

  test('TC-RSV-06 Kakkanad: retail sales invoice (Direct) for the reserved tag, adjusting the reserve advance', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo, estimationNo, advanceNo } = state.readState();
    expect(tagNo && advanceNo, 'run TC-RSV-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await retailInvoice.createDirectInvoice({
      customer: DATA.reserve.customer,
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
    console.log(`Retail invoice saved: ${invoiceDocNo} (reserved tag ${tagNo}, estimation ${estimationNo}, advance ${advanceNo} adjusted)`);
    expect(retailInvoice.printPreviewError, 'print template preview').toBeFalsy();
  });
});
