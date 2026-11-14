const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');

const state = makeState('e2e-retail-reserve-tag-estimation-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> RESERVE ESTIMATION -> ADVANCE REGISTRATION (Reserve)
 * -> ESTIMATION (Sales Type Order / Order Type Reserve) at Kakkanad. Requested
 * 14-11-2026 ("now do the same for reserve estimation -> registration -> estimation"):
 * the general Estimation must pick up the reserve registration and take the
 * reserved tag.
 *
 *   TC-RTE-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), "Barcode or Lot?" = No
 *   TC-RTE-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-RTE-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges,
 *              no counter)
 *   TC-RTE-04  admin (form login): Estimations > Reserve Estimation: customer Aneesh
 *              Maradu, Retail, TagWise, Chandu, scan the tag, Add Item, Proceed to
 *              Payment (cash 1,000), Save (e.g. "28")
 *   TC-RTE-05  admin (form login): Registrations > Advance Registration: Advance Type
 *              Reserve, Registration, Retail, Entry Type Estimation, the reserve
 *              estimation, cash 50,000, Submit (receipt e.g. "RE-15")
 *   TC-RTE-06  admin: Estimations > Estimation: customer, Business Type Retail, Sales
 *              Type ORDER -> Order Type Reserve, Receipt No = the registration (Transaction
 *              Date + Order Item back-fill = the pick-up), Sales Executive Chandu, scan
 *              the reserved tag -> Add Item -> Submit (CreateEstimation, EST-nnnn)
 *
 * Numbers chain through e2e-retail-reserve-tag-estimation-state.json. The POS "+"
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
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE },
    stockIdentityType: 'Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: null, // a direct retail reservation needs no Counter Allocation
  },
  reserve: {
    customer: process.env.CUSTOMER || 'Aneesh Maradu',
    businessType: 'Retail',
    estimationType: 'TagWise',
    salesExecutive: 'Chandu',
    helper: 'Chandu',
  },
  reservePayment: { mode: 'Cash', amount: 1000 }, // the advance collected on the reserve estimation itself
  advance: { advanceType: 'Reserve', subType: 'Registration', businessType: 'Retail', entryType: 'Estimation', remarks: 'E2E reserve advance (tag estimation chain)', paymentMode: 'Cash', amount: Number(process.env.ADVANCE_AMOUNT || 50000) },
  finalEstimation: { salesType: 'Order', orderType: 'Reserve', salesExecutive: 'Chandu' },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Reserve Estimation - Advance Registration - Estimation (Order Type Reserve) - Workflow', () => {
  test('TC-RTE-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
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
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, estimationNo: null, advanceNo: null, finalEstimationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-RTE-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RTE-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-RTE-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-RTE-02 first').toBeTruthy();
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

  test('TC-RTE-04 Kakkanad: reserve estimation for the tag (TagWise)', async ({ loginPage, orderEstimation, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-RTE-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await orderEstimation.createReserveEstimation({ ...DATA.reserve, tagNo, payment: DATA.reservePayment });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `reserve estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo });
    console.log(`Reserve estimation created: ${estimationNo} (tag ${tagNo})`);
  });

  test('TC-RTE-05 Kakkanad: advance registration (Reserve, Retail) against the estimation', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { estimationNo } = state.readState();
    expect(estimationNo, 'run TC-RTE-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerAgainstEstimation({ customer: DATA.reserve.customer, estimationNo, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo });
    console.log(`Reserve advance registered: ${advanceNo} (estimation ${estimationNo})`);
  });

  test('TC-RTE-06 Kakkanad: estimation (Order Type Reserve) picks up the registration and takes the reserved tag', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { advanceNo, tagNo, estimationNo } = state.readState();
    expect(advanceNo && tagNo, 'run TC-RTE-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const d = DATA.finalEstimation;

    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: DATA.reserve.customer, businessType: DATA.reserve.businessType });
    expect(await estimationSalesType.pickSalesType(d.salesType)).toMatch(/Order/);
    const controls = await estimationSalesType.revealedControls();
    expect(controls.advanceTypeID && controls.advanceID, 'Order Type + Receipt No revealed by Sales Type Order').toBe(true);

    // the pick-up: the reserve registration is offered and back-fills the date and the reserved item
    const r = await estimationSalesType.pickupOrderReference({ orderType: d.orderType, receiptNo: advanceNo });
    expect(r.picked, `Receipt No ${advanceNo} offered for Order Type ${d.orderType} (offered ${JSON.stringify(r.offered.slice(0, 10))}, toasts ${JSON.stringify(r.toasts)})`).toBe(true);
    expect(r.date, 'Transaction Date back-filled from the registration').toMatch(/\d{2}\/\d{2}\/\d{4}/);
    console.log(`reserve pick-up: items ${JSON.stringify(r.items)}`);
    if (r.items.length && !/No items/i.test(r.items[0])) await estimationSalesType.pick('advanceItemID', DATA.inward.item.article, { search: true }).catch(() => estimationSalesType.pickOrFirst('advanceItemID', DATA.inward.item.article));
    await estimationSalesType.pick('salesExecutiveID', d.salesExecutive, { search: true });
    await estimationSalesType.settle(1_500);

    const summary = await estimationSalesType.scanAndAddTag(tagNo);
    expect(summary.items, 'No. of Items after Add Item').toBeGreaterThanOrEqual(1);

    const body = await estimationSalesType.submitEstimation();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const finalEstimationNo = OrderEstimationPage.numberOf(body);
    expect(finalEstimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ finalEstimationNo });
    console.log(`Estimation saved: ${finalEstimationNo} (Order Type Reserve, registration ${advanceNo} from reserve estimation ${estimationNo}, tag ${tagNo})`);
  });
});
