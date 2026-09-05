const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-sample-usedinprod-state.json');

/**
 * E2E WORKFLOW — B2B SAMPLE (ON THE ORDER) / INHOUSE / USED IN PRODUCTION.
 *
 * Variant of b2b-sample-inhouse-workflow with "Used In Production" ENABLED
 * in TWO places: the Add Sample panel on the B2B order (input#useInProduction)
 * AND the Sample Issue form (input#active in the section header) - both off
 * by default. The rest of the inhouse chain is identical; the effect is
 * verified at the Worker Receipt page - the used-in-production sample is
 * receivable and finalized there. After the sample issue, a Procurement
 * Job Work (Inhouse) is also raised against the B2B order no (SUP-02B).
 *
 * State: e2e-b2b-sample-usedinprod-state.json.
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
    grossWeight: 54,
    sample: { article: 'Tendulkar', purity: '91.6', pieces: 1, grossWeight: 12, rate: 25000, usedInProduction: true },
  },
  issue: { itemType: 'Metal', productionUnit: 'Cochin', submissionMethod: 'In Person', receivedFrom: 'Raja', contactNumber: '6565455555' },
  round1: { process: 'Design And CAD', subProcess: 'CAD Modeling', worker: 'Prabhat' },
  round2: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
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

test.describe('B2B Sample - Inhouse - Used In Production - Workflow', () => {
  test('TC-B2B-SUP-01 create the B2B order with a sample', async ({ loginPage, b2bOrderBooking, sampleWorkflow, page }) => {
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

    await b2bOrderBooking.fillSampleItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
      mainImage: DEMO_FILES.image1,
      sample: { ...DATA.order.sample, image: DEMO_FILES.image2 },
    });
    await b2bOrderBooking.addItemsAndVerify(1);

    if (!(await b2bOrderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await b2bOrderBooking.nextBtn.click();
      await b2bOrderBooking.waitForIdle();
    }
    await expect(b2bOrderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    const confirmer = b2bOrderBooking.confirmYesIfAsked();
    const { responses, diag } = await b2bOrderBooking.submitWithDiagnostics();
    await confirmer;
    const save = responses.find((r) => r.body);
    expect(save, `no save response; validation: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    const orderNo = save.body.data && save.body.data.receiptNo;
    expect(orderNo, 'generated sample order receipt no').toBeTruthy();
    state.writeState({ orderNo });
    console.log(`B2B sample order created: ${orderNo}`);

    const sampleNo = await sampleWorkflow.latestSampleNo();
    expect(sampleNo, 'registered sample number').toBeTruthy();
    state.writeState({ sampleNo });
    console.log(`Sample registered as: ${sampleNo}`);
  });

  test('TC-B2B-SUP-02 sample issue inhouse with Used In Production enabled', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SUP-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await sampleWorkflow.createSampleIssueInhouse({
      sampleNo,
      itemType: DATA.issue.itemType,
      productionUnit: DATA.issue.productionUnit,
      submissionMethod: DATA.issue.submissionMethod,
      receivedFrom: DATA.issue.receivedFrom,
      contactNumber: DATA.issue.contactNumber,
      usedInProduction: true, // the toggle under test
      image: DEMO_FILES.image3,
    });
    state.writeState({ issueNo });
    console.log(`Sample issued inhouse, Used In Production ON (doc: ${issueNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SUP-02B procurement job work inhouse against the order', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-SUP-01 first').toBeTruthy();
    await login(loginPage, page);

    // Procurement > Issue > Job Work tab: Generation Type Order + JobWork
    // Mode Inhouse + Production Unit Cochin + Item Type Metal, select the
    // B2B order's row, Submit (PP## job work). Inhouse needs no Vendor
    // Making Type (that is the outsource-only field).
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

  test('TC-B2B-SUP-03 assign the sample job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey(), 'run TC-B2B-SUP-01 first').toBeTruthy();
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

  test('TC-B2B-SUP-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
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

  test('TC-B2B-SUP-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, productionSource: 'Sample', itemType: 'Metal', rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-B2B-SUP-06 transfer to Casting, accept, worker issue and receipt (Sioniquser11)', async ({ loginPage, production, page }) => {
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
    // the FINAL receipt checks "Finalize Sample" (same as the toggle-off
    // chain). The verification that the toggle carried through is that the
    // Used-In-Production sample is present and receivable at Worker Receipt:
    // the receipt save fires (submitWorkerForm verifies it) rather than the
    // process reporting nothing pending.
    const result = await production.workerReceipt({ ...header, finalizeSample: true });
    expect(result, 'Used-In-Production sample was receivable at Worker Receipt (not skipped)').not.toBe('skipped');
    console.log('Worker Receipt verified: Used-In-Production sample received + finalized');
  });

  test('TC-B2B-SUP-07 sample receipt (Repair page, Sample tab, inhouse)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SUP-01 first').toBeTruthy();
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

  test('TC-B2B-SUP-08 sample delivery to the customer', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SUP-01 first').toBeTruthy();
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
