const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-repair-inhouse-state.json');

/**
 * E2E WORKFLOW — REPAIR REGISTRATION / INHOUSE PRODUCTION / DELIVERY.
 *
 * Chain (QA lead, 02-09-2026 - built without a recording): Repair
 * Registration → Repair Issue INHOUSE (mode Inhouse, Submit) → Job
 * Assignment (source type "Repair") → Process Movement → Worker
 * Issue/Receipt ×2 with the production source "Repair" (the FINAL Casting
 * receipt checks the REPAIR FINALIZE option) → Repair Receipt (Repair
 * page, Inhouse mode) → Repair Delivery. Repairs never reach Job
 * Finalize/barcode - the finalize checkbox releases them to Repair Receipt.
 *
 * Grids key repair rows by the repair-number CORE (save returns
 * "wJune-GGGG#..." while grids display "REP-GGGG#....1").
 * State: e2e-b2b-repair-inhouse-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  registration: {
    customer: 'Luxurio',
    smCode: 'AJ10',
    referrer: 'Abc',
    itemSource: 'Customer Item',
    repairType: 'Bangle repair',
    description: 'repair inhouse automation',
    item: {
      groupCategory: 'Gold',
      category: 'Ring',
      article: 'Tendulkar',
      purity: '91.6',
      expectedAddWeight: 5,
      expectedLossWeight: 5,
      pieces: 1,
      grossWeight: 20,
    },
  },
  issue: { productionUnit: 'Cochin', submissionMethod: 'In Person', givenBy: 'JJ', contactNumber: '5545654587' },
  round1: { process: 'Design And CAD', subProcess: 'CAD Modeling', worker: 'Prabhat' },
  round2: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
  receipt: { subTransactionType: 'Invoice', productionUnit: 'Cochin' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function rowKey() {
  const { repairNo } = state.readState();
  return repairNo ? String(repairNo).replace(/^[A-Za-z]+-/, '') : '';
}

test.describe('B2B Repair - Inhouse - Production - Workflow', () => {
  test('TC-B2B-RPI-01 register the repair for the customer', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const repairNo = await repairWorkflow.registerRepair({
      customer: DATA.registration.customer,
      smCode: DATA.registration.smCode,
      referrer: DATA.registration.referrer,
      itemSource: DATA.registration.itemSource,
      repairType: DATA.registration.repairType,
      deliveryDate: businessDate(15).replace(/-/g, '/'),
      description: DATA.registration.description,
      item: DATA.registration.item,
      image: DEMO_FILES.image1, // Add Files on the registration item step
    });
    expect(repairNo, 'registered repair number').toBeTruthy();
    state.writeState({ repairNo });
    console.log(`Repair registered: ${repairNo}`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPI-02 repair issue inhouse (Procurement > Issue, Repair tab)', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPI-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await repairWorkflow.repairIssueInhouse({
      repairNo,
      productionUnit: DATA.issue.productionUnit,
      submissionMethod: DATA.issue.submissionMethod,
      givenBy: DATA.issue.givenBy,
      contactNumber: DATA.issue.contactNumber,
    });
    state.writeState({ issueNo });
    console.log(`Repair issued inhouse (doc: ${issueNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPI-03 assign the repair job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey(), 'run TC-B2B-RPI-01 first').toBeTruthy();
    await login(loginPage, page);
    // the Repair assignment form has NO Item Type select (filters are
    // Business Type / Repair Type / Business Unit / Repair No - all optional
    // except Business Type per the QA lead)
    await production.assignJob({
      sourceType: 'Repair',
      businessType: 'B2B',
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      rowText: rowKey(),
    });
    console.log(`Repair job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess}`);
  });

  test('TC-B2B-RPI-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({
      process: DATA.round1.process,
      sourceType: 'Repair',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-B2B-RPI-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, productionSource: 'Repair', itemType: 'Metal', rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-B2B-RPI-06 transfer to Casting, accept, worker issue and receipt with Repair Finalize (Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(900_000);
    await login(loginPage, page);
    await production.processMovementTransfer({
      fromProcess: DATA.round1.process,
      fromSubProcess: DATA.round1.subProcess,
      toProcess: DATA.round2.process,
      toSubProcess: DATA.round2.subProcess,
      productionSource: 'Repair',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    await production.processMovementAccept({
      process: DATA.round2.process,
      sourceType: 'Repair',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    const header = { ...DATA.round2, productionSource: 'Repair', itemType: 'Metal', rowText: rowKey() };
    await production.workerIssue(header);
    // the FINAL receipt is the settlement-wise ITEM FORM: select the offered
    // Production No (item auto-fills from it), check the Repair Finalize
    // option and Add Items - releases the repair to Repair Receipt
    // NO image here (QA lead, 02-09-2026): attaching one to the worker
    // receipt has an open app issue (CreateRepairReceiptMode2 HTTP 500) -
    // flow is Finalize Repair -> Add -> Submit
    await production.workerReceipt({ ...header, finalizeRepair: true, item: {} });
    console.log('Transferred to Casting, accepted, worker issue + receipt (repair finalized) done');
  });

  test('TC-B2B-RPI-07 repair receipt (Repair page, Inhouse)', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPI-01 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await repairWorkflow.repairReceiptInhouse({
      repairNo,
      productionUnit: DATA.receipt.productionUnit,
      subTransactionType: DATA.receipt.subTransactionType,
    });
    state.writeState({ receiptNo });
    console.log(`Repair received back (doc: ${receiptNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPI-08 repair delivery to the customer', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPI-01 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await repairWorkflow.repairDelivery({
      customer: DATA.registration.customer,
      repairNo,
    });
    state.writeState({ deliveryNo });
    console.log(`Repair delivered (doc: ${deliveryNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
