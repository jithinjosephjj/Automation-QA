const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');

const state = makeState('e2e-retail-order-tag-estimation-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> ORDER ESTIMATION -> ADVANCE REGISTRATION (Order)
 * -> ESTIMATION (Sales Type Order) at Kakkanad. Requested 14-11-2026 ("first
 * create one barcode tag then order estimation -> registration -> estimation"):
 * the general Estimation must pick up the registered order and take the tag.
 *
 *   TC-OTE-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), "Barcode or Lot?" = No
 *   TC-OTE-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-OTE-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges,
 *              no counter)
 *   TC-OTE-04  admin (form login): Retail Operations > Estimations > OrderEstimation
 *              (customer Aneesh Maradu, Retail, Job Work, Chandu; Tendulkar 91.60 60 g)
 *              -> Submit (e.g. "TESTJun O60")
 *   TC-OTE-05  admin (form login): Registrations > Advance Registration: Advance Type
 *              Order, Registration, Retail, Entry Type Estimation + Fetch, cash 50,000,
 *              Submit (receipt e.g. "FFFF7" = the ORDER number)
 *   TC-OTE-06  admin: Estimations > Estimation: customer, Business Type Retail, Sales
 *              Type ORDER -> Order Type Order, Receipt No = the registration (Transaction
 *              Date + Order Item back-fill = the pick-up), Sales Executive Chandu, scan
 *              the tag -> Add Item -> Submit (CreateEstimation, estimation number)
 *
 * Numbers chain through e2e-retail-order-tag-estimation-state.json. The POS "+"
 * only opens its form on a session that went through the login FORM. MUST run
 * headed (Device Radar gate).
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
    stockIdentityType: 'Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: null, // the estimation takes the tag straight from stock
  },
  estimation: {
    customer: process.env.CUSTOMER || 'Aneesh Maradu',
    businessType: 'Retail',
    transactionType: 'Job Work',
    salesExecutive: 'Chandu',
    item: { referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', pieces: 1, grossWeight: 60 },
  },
  advance: { advanceType: 'Order', subType: 'Registration', businessType: 'Retail', entryType: 'Estimation', remarks: 'E2E order advance (tag estimation chain)', paymentMode: 'Cash', amount: Number(process.env.ADVANCE_AMOUNT || 50000) },
  finalEstimation: { salesType: 'Order', orderType: 'Order', salesExecutive: 'Chandu' },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Order Estimation - Advance Registration - Estimation (Sales Type Order) - Workflow', () => {
  test('TC-OTE-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
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
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, estimationNo: null, advanceNo: null, orderNo: null, finalEstimationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-OTE-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-OTE-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-OTE-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-OTE-02 first').toBeTruthy();
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
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-OTE-04 Kakkanad: order estimation (Job Work, Tendulkar 91.60)', async ({ loginPage, orderEstimation, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-OTE-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await orderEstimation.createEstimation({ ...DATA.estimation });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo });
    console.log(`Order estimation created: ${estimationNo}`);
  });

  test('TC-OTE-05 Kakkanad: advance registration (Order, Retail) against the estimation', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { estimationNo } = state.readState();
    expect(estimationNo, 'run TC-OTE-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerAgainstEstimation({ customer: DATA.estimation.customer, estimationNo, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo, orderNo: advanceNo });
    console.log(`Order advance registered: ${advanceNo} (estimation ${estimationNo})`);
  });

  test('TC-OTE-06 Kakkanad: estimation (Sales Type Order) picks up the registration and takes the tag', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { orderNo, tagNo, estimationNo } = state.readState();
    expect(orderNo && tagNo, 'run TC-OTE-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const d = DATA.finalEstimation;

    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: DATA.estimation.customer, businessType: DATA.estimation.businessType });
    expect(await estimationSalesType.pickSalesType(d.salesType)).toMatch(/Order/);
    const controls = await estimationSalesType.revealedControls();
    expect(controls.advanceTypeID && controls.advanceID, 'Order Type + Receipt No revealed by Sales Type Order').toBe(true);

    // the pick-up: the registration is offered and back-fills the date and the ordered item
    const r = await estimationSalesType.pickupOrderReference({ orderType: d.orderType, receiptNo: orderNo });
    expect(r.picked, `Receipt No ${orderNo} offered for Order Type ${d.orderType} (offered ${JSON.stringify(r.offered.slice(0, 10))}, toasts ${JSON.stringify(r.toasts)})`).toBe(true);
    expect(r.date, 'Transaction Date back-filled from the registration').toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(r.items.join(' | '), 'Order Item lists the ordered article').toContain(DATA.estimation.item.article);
    if (r.items.length) await estimationSalesType.pick('advanceItemID', DATA.estimation.item.article, { search: true }).catch(() => estimationSalesType.pickOrFirst('advanceItemID', DATA.estimation.item.article));
    await estimationSalesType.pick('salesExecutiveID', d.salesExecutive, { search: true });
    await estimationSalesType.settle(1_500);

    const summary = await estimationSalesType.scanAndAddTag(tagNo);
    expect(summary.items, 'No. of Items after Add Item').toBeGreaterThanOrEqual(1);

    const body = await estimationSalesType.submitEstimation();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const finalEstimationNo = OrderEstimationPage.numberOf(body);
    expect(finalEstimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ finalEstimationNo });
    console.log(`Estimation saved: ${finalEstimationNo} (Sales Type Order, order ${orderNo} from estimation ${estimationNo}, tag ${tagNo})`);
  });
});
