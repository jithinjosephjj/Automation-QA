const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-samplereg-inhouse-state.json');

/**
 * E2E WORKFLOW — B2B ORDER / SAMPLE REGISTRATION / INHOUSE PRODUCTION.
 *
 * Reworked 10-09-2026 to the DUAL-STREAM flow (same shape as the two B2B
 * sample twins): the B2B order (sample REGISTERED separately against the
 * order no - not on the order itself) drives a JOB WORK stream (raised
 * from the order) AND a SAMPLE stream. Both are assigned DIRECTLY to
 * Casting Process / Casting Inspection (one round - no Design/CAD, no
 * process transfer) and go through Process Movement Accept -> Worker
 * Issue -> Worker Receipt each. The JOB WORK worker receipt is a
 * SETTLEMENT item-form (Production No + item details + Move to Job
 * Finalize) and MUST submit BEFORE the SAMPLE worker receipt (which
 * checks Finalize Sample). Then Sample Receipt + Sample Delivery close
 * the flow. No Used In Production toggle / Used Sample Weight here -
 * that consumption belongs to the used-in-production twin only.
 *
 * Step order (registration folded into step 1):
 *   1 order + register sample  2 job work (from order)  3 sample issue
 *   4 assign jobwork  5 assign sample                (-> Casting Inspection)
 *   6 accept jobwork  7 accept sample                (Casting)
 *   8 worker issue jobwork  9 worker issue sample    (Casting)
 *   10 worker receipt jobwork (settlement, Move to Job Finalize)
 *   11 worker receipt sample (Finalize Sample)
 *   12 sample receipt   13 sample delivery
 *
 * Grids key rows by the SAMPLE NO / JOB WORK NO captured in state.
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
  // single production round: both streams are assigned directly to Casting
  round: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
  // the JOB WORK settlement receipt: Production No auto-selects the offered
  // pending job, then item details, then Move to Job Finalize + Add Items
  receiptItem: { article: 'Tendulkar', articleSearch: 'ring', purity: '91.6', weight: 40 },
  delivery: { customer: 'Luxurio', itemType: 'Metal', dispatchType: 'Our Employee', employee: 'Sioniquser11' },
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

function jobWorkKey() {
  return state.readState().jobWorkNo;
}

test.describe('B2B Sample Registration - Inhouse - Production - Workflow', () => {
  test('TC-B2B-SRI-01 create the B2B order and register a sample against it', async ({ loginPage, b2bOrderBooking, sampleWorkflow, page }) => {
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
    // the SM Code resolves the sales executive; the app now surfaces it in the
    // B2B Order Summary panel ("Sales Executive :AJ10 / Ajin G") rather than a
    // filled form select, so assert on the summary text
    await expect(page.getByText(/Sales Executive\s*:\s*AJ10\s*\/\s*Ajin G/).first())
      .toBeVisible({ timeout: 20_000 });

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

    // this variant registers the sample SEPARATELY against the order no
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

  test('TC-B2B-SRI-02 procurement job work inhouse against the order', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-SRI-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createInhouseJobWorkFromOrder({
      orderNo,
      productionUnit: 'Cochin',
      itemType: 'Metal',
    });
    expect(jobWorkNo, 'generated job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Inhouse job work created against order ${orderNo}: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SRI-03 sample issue inhouse (Procurement > Issue, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-01 first').toBeTruthy();
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

  test('TC-B2B-SRI-04 assign the JOB WORK to Casting Process / Casting Inspection', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(jobWorkKey(), 'run TC-B2B-SRI-02 first').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      sourceType: 'Job Work',
      generationType: 'Order',
      itemType: 'Metal',
      process: DATA.round.process,
      subProcess: DATA.round.subProcess,
      rowText: jobWorkKey(),
    });
    console.log(`Job work assigned to ${DATA.round.process} / ${DATA.round.subProcess}`);
  });

  test('TC-B2B-SRI-05 assign the SAMPLE to Casting Process / Casting Inspection', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey(), 'run TC-B2B-SRI-01 first').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      sourceType: 'Sample',
      itemType: 'Metal',
      businessUnit: 'Cochin',
      process: DATA.round.process,
      subProcess: DATA.round.subProcess,
      rowText: rowKey(),
    });
    console.log(`Sample assigned to ${DATA.round.process} / ${DATA.round.subProcess}`);
  });

  test('TC-B2B-SRI-06 process movement accept - JOB WORK (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({
      process: DATA.round.process,
      sourceType: 'Job Work',
      itemType: 'Metal',
      rowText: jobWorkKey(),
    });
    console.log('Process movement accepted (job work) at Casting');
  });

  test('TC-B2B-SRI-07 process movement accept - SAMPLE (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({
      process: DATA.round.process,
      sourceType: 'Sample',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    console.log('Process movement accepted (sample) at Casting');
  });

  test('TC-B2B-SRI-08 worker issue - JOB WORK (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    await production.workerIssue({ ...DATA.round, productionSource: 'Job Work', itemType: 'Metal', rowText: jobWorkKey() });
    console.log('Worker issue (job work) done at Casting');
  });

  test('TC-B2B-SRI-09 worker issue - SAMPLE (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    await production.workerIssue({ ...DATA.round, productionSource: 'Sample', itemType: 'Metal', rowText: rowKey() });
    console.log('Worker issue (sample) done at Casting');
  });

  test('TC-B2B-SRI-10 worker receipt - JOB WORK settlement (Move to Job Finalize)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    // settlement item-form: Production No auto-selects the offered pending job,
    // then item details; Move to Job Finalize releases it. MUST be before the
    // sample receipt. NO Used Sample Weight here.
    const result = await production.workerReceipt({
      ...DATA.round,
      productionSource: 'Job Work',
      itemType: 'Metal',
      rowText: jobWorkKey(),
      item: {
        article: DATA.receiptItem.article,
        articleSearch: DATA.receiptItem.articleSearch,
        purity: DATA.receiptItem.purity,
        weight: DATA.receiptItem.weight,
        moveToJobFinalize: true,
      },
    });
    expect(result, 'job work receivable at Worker Receipt (not skipped)').not.toBe('skipped');
    console.log('Worker receipt (job work settlement) done + moved to Job Finalize');
  });

  test('TC-B2B-SRI-11 worker receipt - SAMPLE (Finalize Sample)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const result = await production.workerReceipt({
      ...DATA.round,
      productionSource: 'Sample',
      itemType: 'Metal',
      rowText: rowKey(),
      finalizeSample: true,
    });
    expect(result, 'sample receivable at Worker Receipt (not skipped)').not.toBe('skipped');
    console.log('Worker receipt (sample) done + finalized');
  });

  test('TC-B2B-SRI-12 sample receipt (Repair page, Sample tab, inhouse)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-01 first').toBeTruthy();
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

  test('TC-B2B-SRI-13 sample delivery to the customer', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SRI-01 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await sampleWorkflow.sampleDelivery({
      sampleNo,
      customer: DATA.delivery.customer,
      itemType: DATA.delivery.itemType,
      dispatchType: DATA.delivery.dispatchType,
      employee: DATA.delivery.employee,
    });
    state.writeState({ deliveryNo });
    console.log(`Sample delivered (doc: ${deliveryNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
