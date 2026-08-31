const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');

const state = makeState('e2e-b2border-state.json');

/**
 * E2E WORKFLOW — B2B ORDER (JOB WORK) / INHOUSE / PRODUCTION.
 *
 * Chain: B2B Order Booking (Making Type "Job Work") → Job Work inhouse
 * (Procurement > Operations > Issue, Job Work tab: Generation Type "Order" +
 * JobWork Mode "Inhouse" + Production Unit) → Job Assignment → Process
 * Movement → Worker Issue/Receipt → Job Finalize (Generate Barcode).
 *
 * Same downstream as the stock-order chain
 * (order-inhouse-production-workflow) - only step 01 differs: the order is
 * created on the B2B Order Booking tab with customer Luxurio and Making
 * Type "Job Work" (TC-B2B-001 data). Document numbers persist in
 * e2e-b2border-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  order: {
    purposeType: 'Order',
    customer: 'Luxurio',
    itemType: 'Metal',
    makingType: 'Job Work',
    supervisor: 'Abc',
    smCode: 'AJ10',
    orderGivenBy: 'JJ',
    contactNumber: '9898989899',
    deliveryNote: 'Urgent',
    referenceType: 'Combination',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.60',
    grossWeight: 50,
  },
  round1: { process: 'Design And CAD', subProcess: 'CAD Modeling', worker: 'Prabhat' },
  round2: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
  item: {
    articleSearch: 'tendu',
    article: 'Gold,Ring-Tendulkar',
    puritySearch: '91.6',
    purity: '(22 Karat Gold)',
    weight: '5.000',
    moveToJobFinalize: true,
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function rowKey() {
  const s = state.readState();
  return s.jobWorkNo || s.orderNo;
}

test.describe('B2B Order - Inhouse - Production - Workflow', () => {
  test('TC-B2B-PRD-01 create the B2B job work order', async ({ loginPage, b2bOrderBooking, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await b2bOrderBooking.open();
    await b2bOrderBooking.openAddWizard();
    await b2bOrderBooking.fillOrderDetails({
      purposeType: DATA.order.purposeType,
      customer: DATA.order.customer,
      itemType: DATA.order.itemType,
      makingType: DATA.order.makingType,
      supervisor: DATA.order.supervisor,
      smCode: DATA.order.smCode,
      orderGivenBy: DATA.order.orderGivenBy,
      contactNumber: DATA.order.contactNumber,
      deliveryNote: DATA.order.deliveryNote,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    await expect
      .poll(async () => b2bOrderBooking.selectValue('salesExecutive'), { timeout: 20_000 })
      .toBe('Ajin G');

    await b2bOrderBooking.fillItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
    });
    await b2bOrderBooking.addItemsAndVerify(1);

    if (!(await b2bOrderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await b2bOrderBooking.nextBtn.click();
      await b2bOrderBooking.waitForIdle();
    }
    await expect(b2bOrderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    const { responses, diag } = await b2bOrderBooking.submitWithDiagnostics();
    const save = responses.find((r) => r.body);
    expect(save, `no save response; validation: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    const orderNo = save.body.data && save.body.data.receiptNo;
    expect(orderNo, 'generated B2B order receipt no').toBeTruthy();
    state.writeState({ orderNo });
    console.log(`B2B job work order created: ${orderNo}`);
  });

  test('TC-B2B-PRD-02 create inhouse job work from the order (Procurement > Issue)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-PRD-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createInhouseJobWorkFromOrder({
      orderNo,
      productionUnit: 'Cochin',
      itemType: 'Metal',
    });
    expect(jobWorkNo, 'generated job work number (PP## series)').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Inhouse job work created: ${jobWorkNo}`);
  });

  test('TC-B2B-PRD-03 assign the job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-B2B-PRD-02 first').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      generationType: 'Order',
      itemType: 'Metal',
      location: 'Cochin',
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      rowText: rowKey(),
    });
    console.log(`Job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess}`);
  });

  test('TC-B2B-PRD-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({ process: DATA.round1.process, rowText: rowKey() });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-B2B-PRD-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-B2B-PRD-06 transfer to Casting Process and accept', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    await production.processMovementTransfer({
      fromProcess: DATA.round1.process,
      fromSubProcess: DATA.round1.subProcess,
      toProcess: DATA.round2.process,
      toSubProcess: DATA.round2.subProcess,
      rowText: rowKey(),
    });
    await production.processMovementAccept({ process: DATA.round2.process, rowText: rowKey() });
    console.log('Transferred to Casting and accepted');
  });

  test('TC-B2B-PRD-07 worker issue and receipt with item (Casting, Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round2, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt({ ...header, jobNo: state.readState().jobWorkNo, item: DATA.item });
    if (production.lastProductionNo) state.writeState({ productionNo: production.lastProductionNo });
    console.log('Worker issue + receipt (Casting) with item done - moved to Job Finalize');
  });

  test('TC-B2B-PRD-08 finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    const result = await production.finalizeAndGenerateBarcode({ rowText: rowKey() });
    expect(result, 'barcode generation response').toBeTruthy();
    expect(result.message).toMatch(/saved successfully/i);
    state.writeState({ tagReceiptNo: result.data && result.data.receiptNo });
    console.log(`Barcode generated - tag receipt ${result.data && result.data.receiptNo}`);
  });
});
