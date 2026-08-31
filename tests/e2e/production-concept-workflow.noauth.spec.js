const { test, expect } = require('../../fixtures/test-fixtures');
const { readState, writeState } = require('../../utils/e2e-state');

/**
 * PRODUCTION END-TO-END WORKFLOW (integration testing).
 *
 * Converted from the QA lead's codegen recording of 29-08-2026. One
 * continuous business flow; each test consumes the previous test's output
 * via e2e-production-state.json (utils/e2e-state.js), so the chain resumes
 * where it stopped and any step can be re-run alone.
 *
 *   01 Concept: create (Traditional Jumka / Met Stone Setting / Worker
 *      Naveen / 10g / Centimetre 2x2 / image) -> concept no from the Print
 *      dialog, then Uploads (image vs concept) and Approval (Concept Approved).
 *   02 Job Work from the concept (Generation Type = Production Concept).
 *   03 Job Assignment -> department Design And CAD / process CAD Modeling.
 *   04 Process Movement Accept (Design And CAD).
 *   05 Worker Issue + Receipt round 1 (CAD Modeling, worker Prabhat).
 *   06 Process Movement Transfer (-> Casting Process / Casting Inspection)
 *      then Accept (Casting Process).
 *   07 Worker Issue + Receipt round 2 (Casting, worker Sioniquser11; item
 *      Gold,Ring-Tendulkar / 91.60 / 5.000g / Move to Job Finalize).
 *   08 Job Finalize: select the job and Generate Barcode.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  concept: {
    conceptFor: 'Traditional Jumka',
    settingsType: 'Met Stone Setting',
    assignTo: 'Worker Naveen',
    approxWeight: 10,
    description: 'E2E automation concept',
    dimensionsBy: 'Centimetre',
    length: 2,
    height: 2,
  },
  worker: 'Worker Naveen',
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

/** The grid-row key: job work no when we have it, else the concept no. */
function rowKey() {
  const s = readState();
  return s.jobWorkNo || s.conceptNo;
}

test.describe('Production - Concept - Workflow', () => {
  test('TC-PRD-E2E-01 create, upload and approve a production concept', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const conceptNo = await production.createConcept(DATA.concept);
    expect(conceptNo, 'concept no from the Print dialog').toBeTruthy();
    writeState({ conceptNo });
    console.log(`Concept created: ${conceptNo}`);

    await production.uploadConceptImage({
      worker: DATA.worker,
      conceptNo,
      description: 'E2E upload',
    });
    console.log('Concept upload saved');

    await production.approveConcept({
      worker: DATA.worker,
      conceptNo,
      concept: DATA.concept.conceptFor,
      remarks: 'E2E approval',
    });
    console.log(`Concept ${conceptNo} approved`);
  });

  test('TC-PRD-E2E-02 create production job work from the concept', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { conceptNo } = readState();
    expect(conceptNo, 'run TC-PRD-E2E-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createJobWork({ conceptNo, remarks: 'E2E job work' });
    writeState({ jobWorkNo });
    console.log(`Job work created: ${jobWorkNo || '(number not captured - later steps fall back to concept no)'}`);
  });

  test('TC-PRD-E2E-03 assign the job to Design And CAD / CAD Modeling', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { conceptNo } = readState();
    expect(conceptNo, 'run the chain from TC-PRD-E2E-01').toBeTruthy();
    await login(loginPage, page);

    await production.assignJob({
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      rowText: conceptNo, // assignment grid rows carry the concept no
    });
    console.log(`Job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess}`);
  });

  test('TC-PRD-E2E-04 process movement accept (Design And CAD)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    await production.processMovementAccept({
      process: DATA.round1.process,
      rowText: rowKey(),
    });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-PRD-E2E-05 worker issue and receipt (CAD Modeling, Prabhat)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = {
      process: DATA.round1.process,
      subProcess: DATA.round1.subProcess,
      worker: DATA.round1.worker,
      rowText: rowKey(),
    };
    await production.workerIssue(header);
    console.log('Worker issue (CAD) submitted');
    await production.workerReceipt(header);
    console.log('Worker receipt (CAD) submitted');
  });

  test('TC-PRD-E2E-06 transfer to Casting Process and accept', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    await production.processMovementTransfer({
      fromProcess: DATA.round1.process,
      fromSubProcess: DATA.round1.subProcess,
      toProcess: DATA.round2.process,
      toSubProcess: DATA.round2.subProcess,
      rowText: rowKey(),
    });
    console.log('Transferred to Casting Process / Casting Inspection');
    await production.processMovementAccept({
      process: DATA.round2.process,
      rowText: rowKey(),
    });
    console.log('Process movement accepted at Casting Process');
  });

  test('TC-PRD-E2E-07 worker issue and receipt with item (Casting, Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const header = {
      process: DATA.round2.process,
      subProcess: DATA.round2.subProcess,
      worker: DATA.round2.worker,
      rowText: rowKey(),
    };
    await production.workerIssue(header);
    console.log('Worker issue (Casting) submitted');
    await production.workerReceipt({
      ...header,
      jobNo: readState().jobWorkNo,
      item: DATA.item,
    });
    if (production.lastProductionNo) writeState({ productionNo: production.lastProductionNo });
    console.log('Worker receipt (Casting) with item submitted - moved to Job Finalize');
  });

  test('TC-PRD-E2E-08 finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    const result = await production.finalizeAndGenerateBarcode({ rowText: rowKey() });
    expect(result, 'barcode generation response').toBeTruthy();
    expect(result.message).toMatch(/saved successfully/i);
    writeState({ tagReceiptNo: result.data && result.data.receiptNo });
    await page.screenshot({ path: 'test-results/screens/tc-prd-e2e-08-barcode.png', fullPage: true }).catch(() => {});
    console.log(`Barcode generated - tag receipt ${result.data && result.data.receiptNo}`);
  });
});
