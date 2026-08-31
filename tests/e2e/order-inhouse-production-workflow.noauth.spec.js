const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-orderbooking-state.json');

/**
 * E2E WORKFLOW — ORDER / INHOUSE / PRODUCTION.
 *
 * Chain: Order Booking → Job Work inhouse (Procurement > Operations > Issue,
 * Job Work tab: Generation Type "Order" + JobWork Mode "Inhouse" +
 * Production Unit) → Job Assignment → Process Movement → Worker
 * Issue/Receipt → Job Finalize (Generate Barcode).
 *
 * Steps 03-08 reuse ProductionWorkflowPage like the Concept and
 * Master Design chains. Document numbers persist in
 * e2e-orderbooking-state.json.
 *
 * NOTE: the CreateOrderBooking 400 bug was FIXED by dev (verified
 * 30-08-2026) - TC-OB-001 passes again, which unblocked this chain.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  order: {
    itemType: 'Metal',
    supervisor: 'Abc',
    smCode: 'AJ10',
    deliveryNote: 'Regular',
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

test.describe('Order - Inhouse - Production - Workflow', () => {
  test('TC-PRD-OB-01 create the stock order booking', async ({ loginPage, orderBooking, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await orderBooking.open();
    await orderBooking.openAddWizard();
    await orderBooking.fillOrderDetails({
      itemType: DATA.order.itemType,
      supervisor: DATA.order.supervisor,
      smCode: DATA.order.smCode,
      deliveryNote: DATA.order.deliveryNote,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    await expect
      .poll(async () => orderBooking.selectValue('salesExecutive'), { timeout: 20_000 })
      .toBe('Ajin G');

    await orderBooking.fillItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
    });
    // attach one demo image via the Add Files control
    await orderBooking.attachFileViaAddFiles(DEMO_FILES.image1);

    await orderBooking.addItemsAndVerify(1);

    if (!(await orderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await orderBooking.nextBtn.click();
      await orderBooking.waitForIdle();
    }
    await expect(orderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    const { responses, diag } = await orderBooking.submitWithDiagnostics();
    const save = responses.find((r) => r.body);
    expect(save, `no save response; validation: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    const orderNo = save.body.data && save.body.data.receiptNo;
    expect(orderNo, 'generated order receipt no').toBeTruthy();
    state.writeState({ orderNo });
    console.log(`Order booking created: ${orderNo}`);
  });

  test('TC-PRD-OB-02 create inhouse job work from the order (Procurement > Issue)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-PRD-OB-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createInhouseJobWorkFromOrder({
      orderNo,
      productionUnit: 'Cochin',
      itemType: 'Metal',
    });
    expect(jobWorkNo, 'generated job work number (PP## series)').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Inhouse job work created: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-PRD-OB-03 assign the job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-PRD-OB-02 first').toBeTruthy();
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

  test('TC-PRD-OB-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({ process: DATA.round1.process, rowText: rowKey() });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-PRD-OB-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-PRD-OB-06 transfer to Casting Process and accept', async ({ loginPage, production, page }) => {
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

  test('TC-PRD-OB-07 worker issue and receipt with item (Casting, Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round2, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt({ ...header, jobNo: state.readState().jobWorkNo, item: DATA.item });
    if (production.lastProductionNo) state.writeState({ productionNo: production.lastProductionNo });
    console.log('Worker issue + receipt (Casting) with item done - moved to Job Finalize');
  });

  test('TC-PRD-OB-08 finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    const result = await production.finalizeAndGenerateBarcode({ rowText: rowKey() });
    expect(result, 'barcode generation response').toBeTruthy();
    expect(result.message).toMatch(/saved successfully/i);
    state.writeState({ tagReceiptNo: result.data && result.data.receiptNo });
    console.log(`Barcode generated - tag receipt ${result.data && result.data.receiptNo}`);
  });
});
