const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-order-estimation-state.json');

/**
 * E2E WORKFLOW — RETAIL ORDER ESTIMATION -> ADVANCE REGISTRATION (Order / Retail) ->
 * OUTSOURCE JOB WORK from the order -> METAL INWARD (jobwork return, No) -> LOT ->
 * BARCODE -> RETAIL INVOICE (Direct) that sells the job-work tag and adjusts the order
 * advance in its payment, everything at the Kakkanad head office.
 * Requested 02-11-2026 ("retail estimation -> advance registration, advance type =
 * order, business type = retail, then invoice"; "after advance registration goto job
 * work (outsource), then metal inward, lot, barcode").
 *
 *   TC-ROE-01  Kakkanad, admin: Retail Operations > Operations > Estimations > Order
 *              (customer Aneesh Maradu, Business Type Retail, Transaction Type Job Work,
 *              Sales Executive Chandu; Tendulkar 91.60, 1 pc 60 g, Additional Charges)
 *              -> Submit (CreateOrderEstimation, receiptNo e.g. "TESTJun O46")
 *   TC-ROE-02  Kakkanad, admin: Registrations > Advance Registration: Advance Type
 *              Order, Type Registration, Business Type Retail, Entry Type Estimation,
 *              Estimation Number + Fetch (FetchEstimationForAdvance -> Final Amount),
 *              Proceed to Payment (₹50,000 cash), Submit (SaveOrderAdvanceRegistration,
 *              receiptNo e.g. "iiii5" - this receipt is the ORDER number from here on)
 *   TC-ROE-03  Kakkanad, admin: Procurement > Issue - outsource job work from the order
 *              (vendor RAJA, item type Metal)
 *   TC-ROE-04  Kakkanad, admin: Metal Inward jobwork return (<jobwork>.001), "Process
 *              with Barcode or Lot?" = No
 *   TC-ROE-05  Kakkanad, admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-ROE-06  Kakkanad, suja:  Barcode Generation for the lot (Jobwork Stock, Chain
 *              Counter KKD / Sub Counter1)
 *   TC-ROE-07  Kakkanad, admin: Retail Operations > Operations > Invoice
 *              (/pos/view-sales-invoice), Invoice Source Direct, Sales Type Normal Sale:
 *              the customer, Sales Executive Chandu, scan the job-work tag -> Add Item
 *              -> Proceed To Payment: the "Advance" mode with ADVANCE TYPE Order +
 *              REFERENCE NUMBER = the order (GetAdvanceForAdjustment auto-fills the
 *              ₹50,000 advance), Cash Test Mode pays the rest -> Submit (CreateSalesInvoice)
 *
 * Why a plain Direct invoice (02-11-2026 probes):
 *  - Invoice Source "Estimation" lists only plain "Estimation"-tab estimations
 *    (GetSalesInvoiceEstimationsPaginated), never order estimations.
 *  - Sales Type "Order" (Order Type + Receipt No + Order Item, see
 *    RetailInvoicePage.createDirectInvoice `salesType`/`order`) lists Order advances
 *    with a balance across branches, but an order drops out of that list once it has
 *    been issued to job work - so the produced tag is sold on a normal invoice and the
 *    advance is adjusted in the Payment Collection dialog instead.
 *
 * The POS "+" only opens its form on a session that went through the login
 * FORM (counter validation) - the POS steps clear the cache and the live session.
 * Numbers chain through e2e-retail-order-estimation-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  estimation: {
    customer: process.env.CUSTOMER || 'Aneesh Maradu', // a registered retail customer
    businessType: 'Retail',
    transactionType: 'Job Work', // Transaction Type [Regular | Job Work] - the order is made by outsource job work
    salesExecutive: 'Chandu', // Kakkanad sales executive (QA lead 27-10-2026)
    item: { referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', pieces: 1, grossWeight: 60 },
  },
  // a partial cash advance (the full balance would trip the PAN rule - the page object
  // answers the PAN dialog with the test PAN when it opens, 02-11-2026)
  advance: { advanceType: 'Order', subType: 'Registration', businessType: 'Retail', entryType: 'Estimation', remarks: 'E2E order advance', paymentMode: 'Cash', amount: Number(process.env.ADVANCE_AMOUNT || 50000) },
  issue: { mode: 'Outsource', vendor: VENDOR, itemType: 'Metal' },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, // QA lead 23-10-2026: barcode login suja @ Kakkanad
    stockIdentityType: 'Jobwork Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: 'Chain Counter KKD', // Kakkanad's Order-type counter
    subCounter: 'Sub Counter1',
  },
  invoice: {
    salesman: 'Chandu',
    helper: 'Chandu',
    metalRate: 6000,
    // Payment Collection entries in order: the order advance is adjusted first
    // ("Advance" mode, ADVANCE TYPE Order, REFERENCE NUMBER = the order; the amount
    // auto-fills), the remaining balance is paid in cash (first cash mode)
    advanceAdjustment: { mode: 'Advance', advanceType: 'Order' },
    balancePayment: { mode: 'Cash' },
  },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Order Estimation - Advance (Order) - Job Work - Inward - Lot - Barcode - Invoice - Workflow', () => {
  test('TC-ROE-01 Kakkanad: order estimation (Job Work, Tendulkar 91.60)', async ({ loginPage, orderEstimation, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new estimation starts a new chain
    await freshPosLogin(loginPage, page);

    const body = await orderEstimation.createEstimation({ ...DATA.estimation });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo, advanceNo: null, orderNo: null, jobWorkNo: null, inwardVoucherNo: null, lotNo: null, tagNo: null, invoiceDocNo: null });
    console.log(`Order estimation created: ${estimationNo}`);
  });

  test('TC-ROE-02 Kakkanad: advance registration (Order, Retail) against the estimation', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { estimationNo } = state.readState();
    expect(estimationNo, 'run TC-ROE-01 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerAgainstEstimation({ customer: DATA.estimation.customer, estimationNo, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo, orderNo: advanceNo });
    console.log(`Order advance registered: ${advanceNo} (estimation ${estimationNo})`);
  });

  test('TC-ROE-03 Kakkanad: issue the order as outsource job work (Procurement > Issue)', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-ROE-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const jobWorkNo = await production.createOutsourceJobWorkFromOrder({
      orderNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    expect(jobWorkNo, 'generated job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Outsource job work created at ${HEAD_OFFICE}: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-ROE-04 Kakkanad: metal inward receives the goods back (jobwork return, No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-ROE-03 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillJobworkBasicDetails({
      businessUnit: HEAD_OFFICE,
      vendor: DATA.issue.vendor,
      invoiceNo: uniqueInvoiceNo(),
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    const article = await metalInward.addJobworkItem(`${jobWorkNo}.001`);
    expect(article, 'article auto-filled from the job work item').toContain(DATA.estimation.item.article);
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.estimation.item.article })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit(); // answers "Process with Barcode or Lot?" with No
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-ROE-05 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-ROE-04 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.issue.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      location: DATA.lot.location,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-ROE-06 Kakkanad: generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-ROE-05 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.issue.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
      counter: DATA.barcode.counter,
      subCounter: DATA.barcode.subCounter,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.estimation.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-ROE-07 Kakkanad: retail sales invoice (Direct) for the job-work tag, adjusting the order advance', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo, estimationNo, orderNo } = state.readState();
    expect(tagNo && orderNo, 'run TC-ROE-06 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await retailInvoice.createDirectInvoice({
      customer: DATA.estimation.customer,
      salesman: DATA.invoice.salesman,
      helper: DATA.invoice.helper,
      tagNo,
      metalRate: DATA.invoice.metalRate,
      payment: { entries: [{ ...DATA.invoice.advanceAdjustment, reference: orderNo }, DATA.invoice.balancePayment] },
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, order ${orderNo} from estimation ${estimationNo} adjusted)`);
    expect(retailInvoice.printPreviewError, 'print template preview').toBeFalsy();
  });
});
