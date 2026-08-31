const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

const state = makeState('e2e-masterdesign-state.json');

/**
 * PRODUCTION END-TO-END WORKFLOW — MASTER DESIGN VARIANT.
 *
 * Same chain as the Concept flow (tests/e2e/production-concept-workflow) but seeded
 * from Production > Planning > Master Design (prd/view-master-design):
 *
 *   01 Master Design (create + uploads/approval as applicable)  <- from the
 *      QA lead's recording (PENDING - test.fixme until it arrives)
 *   02 Job Work (Generation Type = Master Design, ref = design number)
 *   03..08 identical to the Concept chain: Assignment -> Movement Accept ->
 *      Worker Issue/Receipt (CAD) -> Transfer+Accept (Casting) ->
 *      Issue/Receipt with item -> Job Finalize + barcode.
 *
 * Document numbers persist in e2e-masterdesign-state.json - independent of
 * the Concept chain's state, so both flows can run side by side.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
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
  return s.jobWorkNo || s.designNo;
}

test.describe('Production - Master Design - Workflow', () => {
  test('TC-PRD-MD-01 create master design', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const { DEMO_FILES } = require('../../utils/demo-files');
    const designNo = await production.createMasterDesign({
      creationType: 'Create Master Design',
      itemType: 'Metal',
      weightType: 'Net Weight',
      weight: 28,
      imagePath: DEMO_FILES.image1,
      article: 'Tendulkar',
      description: 'Test 2',
    });
    expect(designNo, 'generated design number').toBeTruthy();
    state.writeState({ designNo });
    console.log(`Master design created: ${designNo}`);
  });

  test('TC-PRD-MD-02 create production job work from the master design', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { designNo } = state.readState();
    expect(designNo, 'run TC-PRD-MD-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createJobWork({
      generationType: 'Master Design',
      refLabel: 'Design Number',
      refNo: designNo,
      searchRef: false, // filtering the design list breaks Submit (app bug)
      remarks: 'E2E master design job work',
    });
    state.writeState({ jobWorkNo });
    console.log(`Job work created: ${jobWorkNo || '(number not captured)'}`);
  });

  test('TC-PRD-MD-03 assign the job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { designNo } = state.readState();
    expect(designNo, 'run the chain from TC-PRD-MD-01').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      generationType: 'Master Design',
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      rowText: rowKey(),
    });
    console.log(`Job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess}`);
  });

  test('TC-PRD-MD-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({ process: DATA.round1.process, rowText: rowKey() });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-PRD-MD-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round1, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt(header);
    console.log('Worker issue + receipt (CAD) done');
  });

  test('TC-PRD-MD-06 transfer to Casting Process and accept', async ({ loginPage, production, page }) => {
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

  test('TC-PRD-MD-07 worker issue and receipt with item (Casting, Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = { ...DATA.round2, rowText: rowKey() };
    await production.workerIssue(header);
    await production.workerReceipt({ ...header, jobNo: state.readState().jobWorkNo, item: DATA.item });
    if (production.lastProductionNo) state.writeState({ productionNo: production.lastProductionNo });
    console.log('Worker issue + receipt (Casting) with item done - moved to Job Finalize');
  });

  test('TC-PRD-MD-08 finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    const result = await production.finalizeAndGenerateBarcode({ rowText: rowKey() });
    expect(result, 'barcode generation response').toBeTruthy();
    expect(result.message).toMatch(/saved successfully/i);
    state.writeState({ tagReceiptNo: result.data && result.data.receiptNo });
    console.log(`Barcode generated - tag receipt ${result.data && result.data.receiptNo}`);
  });
});
