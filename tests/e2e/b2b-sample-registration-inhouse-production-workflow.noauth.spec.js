const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-samplereg-inhouse-state.json');

/**
 * E2E WORKFLOW — B2B ORDER / SAMPLE REGISTRATION / INHOUSE PRODUCTION.
 *
 * Chain: B2B order WITHOUT a sample → Sample Registration against the
 * order no → Sample Issue INHOUSE (production unit Cochin) → Job
 * Assignment (source type "Sample") → Process Movement → Worker
 * Issue/Receipt (production source "Sample"; the FINAL receipt checks
 * "Finalize Sample") → Sample Receipt (Repair page, Inhouse mode) →
 * Sample Delivery. Samples have NO Job Finalize/barcode step (QA lead,
 * 01-09-2026); grids key rows by the SAMPLE NO.
 *
 * State: e2e-b2b-samplereg-inhouse-state.json.
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
    contactNumber: '9896564523',
    deliveryNote: 'Urgent',
    referenceType: 'Combination',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.60',
    grossWeight: 50,
  },
  registration: {
    itemType: 'Metal',
    sample: { article: 'Tendulkar', purity: '91.6', pieces: 1, grossWeight: 12, rate: 25000 },
  },
  issue: { itemType: 'Metal', productionUnit: 'Cochin', submissionMethod: 'In Person', receivedFrom: 'Raja', contactNumber: '6565455555' },
  round1: { process: 'Design And CAD', subProcess: 'CAD Modeling', worker: 'Prabhat' },
  round2: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function rowKey() {
  return state.readState().sampleNo;
}

test.describe('B2B Sample Registration - Inhouse - Production - Workflow', () => {
  test('TC-B2B-SRI-01 create the B2B order (no sample)', async ({ loginPage, b2bOrderBooking, page }) => {
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
    await b2bOrderBooking.attachFileViaAddFiles(DEMO_FILES.image1);
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
    console.log(`B2B order created: ${orderNo}`);
  });

  test('TC-B2B-SRI-02 register a sample against the order', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-SRI-01 first').toBeTruthy();
    await login(loginPage, page);

    const sampleNo = await sampleWorkflow.registerSample({
      orderNo,
      itemType: DATA.registration.itemType,
      sample: DATA.registration.sample,
      image: DEMO_FILES.image2,
    });
    expect(sampleNo, 'registered sample number').toBeTruthy();
    state.writeState({ sampleNo });
    console.log(`Sample registered against ${orderNo}: ${sampleNo}`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SRI-03 sample issue inhouse (Procurement > Issue, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-02 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await sampleWorkflow.createSampleIssueInhouse({
      sampleNo,
      itemType: DATA.issue.itemType,
      productionUnit: DATA.issue.productionUnit,
      submissionMethod: DATA.issue.submissionMethod,
      receivedFrom: DATA.issue.receivedFrom,
      contactNumber: DATA.issue.contactNumber,
      image: DEMO_FILES.image3,
    });
    state.writeState({ issueNo });
    console.log(`Sample issued inhouse (doc: ${issueNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SRI-04 assign the sample job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey(), 'run TC-B2B-SRI-02 first').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      sourceType: 'Sample',
      itemType: 'Metal',
      businessUnit: 'Cochin',
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      rowText: rowKey(),
    });
    console.log(`Sample job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess}`);
  });

  test('TC-B2B-SRI-05 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({
      process: DATA.round1.process,
      sourceType: 'Sample',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-B2B-SRI-06 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, productionSource: 'Sample', itemType: 'Metal', rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-B2B-SRI-07 transfer to Casting, accept, worker issue and receipt (Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(900_000);
    await login(loginPage, page);
    await production.processMovementTransfer({
      fromProcess: DATA.round1.process,
      fromSubProcess: DATA.round1.subProcess,
      toProcess: DATA.round2.process,
      toSubProcess: DATA.round2.subProcess,
      productionSource: 'Sample',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    await production.processMovementAccept({
      process: DATA.round2.process,
      sourceType: 'Sample',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    const header = { ...DATA.round2, productionSource: 'Sample', itemType: 'Metal', rowText: rowKey() };
    await production.workerIssue(header);
    // sample receipts use the pending GRID (no settlement item form); the
    // FINAL receipt checks "Finalize Sample" to release it to Sample Receipt
    await production.workerReceipt({ ...header, finalizeSample: true });
    console.log('Transferred to Casting, accepted, worker issue + receipt (finalized) done');
  });

  test('TC-B2B-SRI-08 sample receipt (Repair page, Sample tab, inhouse)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-02 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await sampleWorkflow.sampleReceiptInhouse({
      sampleNo,
      productionUnit: 'Cochin',
      itemType: 'Metal',
    });
    state.writeState({ receiptNo });
    console.log(`Sample received back (doc: ${receiptNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SRI-09 sample delivery to the customer', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-02 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await sampleWorkflow.sampleDelivery({
      sampleNo,
      customer: DATA.order.customer,
      itemType: 'Metal',
      dispatchType: 'Our Employee',
      employee: 'Sioniquser11',
    });
    state.writeState({ deliveryNo });
    console.log(`Sample delivered (doc: ${deliveryNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
