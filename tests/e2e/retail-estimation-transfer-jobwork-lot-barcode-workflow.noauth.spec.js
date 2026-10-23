const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');

const state = makeState('e2e-retail-estimation-state.json');

/**
 * E2E WORKFLOW — RETAIL ORDER ESTIMATION (branch) -> ADVANCE REGISTRATION ->
 * TRANSFER OUT (order) -> JOB WORK (head office) -> METAL INWARD (No) -> LOT
 * -> BARCODE. Requested 22-10-2026.
 *
 *   TC-RET-01  Cochin, admin: Retail Operations > Operations > Estimations > Order
 *              (customer Aneesh Maradu, Business Type Retail, Transaction Type
 *              Job Work, Sales Executive Abc; Tendulkar 91.60, 60 g, metal only)
 *   TC-RET-02  Cochin, admin: Registrations > Advance Registration (Advance Type
 *              Order / Registration, Entry Type Estimation, Fetch the estimation)
 *   TC-RET-03  Cochin, admin: Sales & Distribution > Transfer In & Out > Transfers >
 *              Transfer Out, Transaction Mode Order, destination Kakkanad
 *   TC-RET-04  Kakkanad, admin: Transfers > Transfer In (From Business Unit Cochin, Transaction Mode Order) - Accept
 *   TC-RET-05  Kakkanad, admin: Procurement > Issue - outsource job work from the order (vendor RAJA)
 *   TC-RET-06  Kakkanad, admin: Metal Inward jobwork return, "Process with Barcode or Lot?" = No
 *   TC-RET-07  Kakkanad, admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-RET-08  Kakkanad, suja:  Barcode Generation for the lot (Chain Counter KKD) - the lot panel says
 *              "Location locked to Cochin" for a branch order, but the lot is offered at Kakkanad
 *
 * POS pages only open their Add form on a session that went through the
 * login FORM (counter validation) - the Cochin steps clear the session cache
 * first. Numbers chain through e2e-retail-estimation-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BRANCH = 'Cochin';
const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  estimation: {
    customer: 'Aneesh Maradu',
    businessType: 'Retail',
    transactionType: 'Job Work',
    salesExecutive: 'Abc',
    item: { referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', pieces: 1, grossWeight: 60 },
  },
  advance: { advanceType: 'Order', subType: 'Registration', businessType: 'Retail', entryType: 'Estimation', remarks: 'E2E advance registration' },
  transferIn: { receiver: 'JJ' },
  issue: { mode: 'Outsource', vendor: VENDOR, itemType: 'Metal' },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE },
  barcode: {
    // the lot panel says 'Location locked to Cochin' for a branch order, yet the lot is offered to suja at
    // KAKKANAD (Barcode > Jobwork Stock > RAJA listed NN321 on 23-10-2026); suja has no Cochin login any more
    user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, // QA lead 23-10-2026: 'for barcode login suja - kakkanad'
    stockIdentityType: 'Jobwork Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    counter: 'Chain Counter KKD', // Kakkanad's Order-type counter
    subCounter: 'Sub Counter1',
  },
};

/** Branch steps: a FORM login (the replayed session lacks the POS counter binding). */
async function freshBranchLogin(loginPage) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', BRANCH);
  await loginPage.ensureLoggedIn({ bu: BRANCH });
}

test.describe('Retail Estimation - Advance - Transfer Out - Job Work - Lot - Barcode - Workflow', () => {
  test('TC-RET-01 Cochin: order estimation (Job Work, Tendulkar 91.60)', async ({ loginPage, orderEstimation }) => {
    test.setTimeout(600_000);
    state.reset();
    await freshBranchLogin(loginPage);

    const body = await orderEstimation.createEstimation({ ...DATA.estimation });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo });
    console.log(`Order estimation created: ${estimationNo}`);
  });

  test('TC-RET-02 Cochin: advance registration against the estimation', async ({ loginPage, advanceRegistration }) => {
    test.setTimeout(600_000);
    const { estimationNo } = state.readState();
    expect(estimationNo, 'run TC-RET-01 first').toBeTruthy();
    await freshBranchLogin(loginPage);

    const body = await advanceRegistration.registerAgainstEstimation({ customer: DATA.estimation.customer, estimationNo, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    state.writeState({ advanceNo, orderNo: advanceNo });
    console.log(`Advance registered: ${advanceNo || '(number not in the save body)'}`);
  });

  test('TC-RET-03 Cochin: transfer the order out to Kakkanad', async ({ loginPage, transfers }) => {
    test.setTimeout(600_000);
    const { estimationNo, advanceNo } = state.readState();
    expect(estimationNo, 'run TC-RET-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: BRANCH });

    const body = await transfers.transferOutOrder({ destination: HEAD_OFFICE, orderNo: advanceNo || estimationNo });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ transferOutNo });
    console.log(`Order ${advanceNo || estimationNo} transferred out ${BRANCH} -> ${HEAD_OFFICE} (doc: ${transferOutNo})`);
  });

  test('TC-RET-04 Kakkanad: transfer in the order from Cochin', async ({ loginPage, transfers }) => {
    test.setTimeout(600_000);
    const { transferOutNo, orderNo } = state.readState();
    expect(transferOutNo, 'run TC-RET-03 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const body = await transfers.transferInOrder({ fromBU: BRANCH, transferOutNo, orderNo, receiver: DATA.transferIn.receiver });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferInNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ transferInNo });
    console.log(`Order ${orderNo} transferred in at ${HEAD_OFFICE} (doc: ${transferInNo})`);
  });

  test('TC-RET-05 Kakkanad: issue the order as outsource job work (Procurement > Issue)', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    const { orderNo, estimationNo } = state.readState();
    expect(orderNo || estimationNo, 'run TC-RET-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    const jobWorkNo = await production.createOutsourceJobWorkFromOrder({
      orderNo: orderNo || estimationNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    expect(jobWorkNo, 'generated job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Outsource job work created at ${HEAD_OFFICE}: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-RET-06 Kakkanad: metal inward receives the goods back (jobwork return, No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-RET-05 first').toBeTruthy();
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
    expect(article, 'article auto-filled from the job work item').toContain('Tendulkar');
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

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

  test('TC-RET-07 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-RET-06 first').toBeTruthy();
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

  test('TC-RET-08 Kakkanad: generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-RET-07 first').toBeTruthy();
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
    const tagNo = await barcodeGeneration.verifyGeneratedTag('Tendulkar');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });
});
