const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { latestSioniqUser } = require('../../utils/sioniquser');

const state = makeState('e2e-cad-material-state.json');

/**
 * The casting worker is the Sioniquser the masters suite
 * (tests/masters/master-add-operations) created LAST - read from
 * sioniquser-counter.json - so "npm run test:cadm" (masters, then this
 * chain) always issues to the newest employee. CASTING_WORKER=<name>
 * overrides it for a one-off run.
 */
const CASTING_WORKER = process.env.CASTING_WORKER || latestSioniqUser().displayName;

/**
 * PRODUCTION END-TO-END WORKFLOW WITH CAD AND MATERIAL TRANSACTIONS.
 *
 * The concept chain (production-concept-workflow) extended with the CAD
 * planning screens and the Material Transaction screens, in the order of
 * the QA lead's codegen recording of 21-09-2026:
 *
 *   01 Concept create                    Production > Planning > Concept
 *   02 Concept upload                    (Uploads tab)
 *   03 Concept approval                  (Approval tab)
 *   04 Job work from the concept         Production > Planning > Job Work
 *   05 Job assignment                    -> Design And CAD / CAD Modeling (allots the J-series production no)
 *   06 Process movement accept           Design And CAD
 *   07 Worker issue                      CAD Modeling / Prabhat
 *   08 CAD upload                        Production > Planning > CAD (Upload): while the job is WITH the CAD worker
 *   09 CAD approval                      (Approval tab, Status "Approve")
 *   10 Worker receipt                    CAD Modeling / Prabhat
 *   11 Process movement transfer         -> Casting Process / Casting Inspection, then accept
 *   12 Worker issue                      Casting / the newest Sioniquser<N> (masters suite, see CASTING_WORKER)
 *   13 Material issue                    Material Transaction > Issue: employee Asmi's locker stock
 *                                        (Metal / Stock, Gold,Ring-Tendulkar 91.60) -> 50 g to the casting
 *                                        worker, assigned to the job ("Metal - Configure" dialog: Assign
 *                                        Type Production + Production No)
 *   14 Material receipt                  Material Transaction > Receipt: 5 g back from the casting worker
 *                                        ("Metal Detail Entry" dialog -> Add to Grid)
 *   15 Worker receipt (settlement)       Casting / item 40.000 g / Move to Job Finalize
 *
 * Material moves exist ONLY at the Casting process (the concept and CAD
 * processes carry no material) - QA lead, 21-09-2026.
 *
 * One continuous business flow; each test consumes the previous test's
 * output via e2e-cad-material-state.json, so the chain resumes where it
 * stopped and any step can be re-run alone.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  concept: {
    // master data as of 21-09-2026: Concept For offers only "Imit"; the
    // setting types are "Collect" / "Design input1" / "Met Sto Sett2" /
    // "Met Stone Setting 5" / "Stonetype4" (the old "Traditional Jumka" and
    // "Met Stone Setting" are gone)
    conceptFor: 'Imit',
    settingsType: 'Met Stone Setting 5',
    assignTo: 'Worker Naveen',
    approxWeight: 10,
    description: 'E2E CAD/material chain concept',
    dimensionsBy: 'Centimetre',
    length: 2,
    height: 2,
  },
  worker: 'Worker Naveen',
  round1: { process: 'Design And CAD', subProcess: 'CAD Modeling', worker: 'Prabhat' },
  // casting worker: the employee the masters suite created last (QA lead,
  // 23-09-2026: "every run should check with the new employee")
  round2: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: CASTING_WORKER },
  cad: { worker: 'Prabhat', volume3D: 12, approxWeight: 10 },
  material: {
    // QA lead 21-09-2026: employee Asmi (her locker "Conter Ab" holds Gold,
    // Ring-Tendulkar 91.60 stock), plain metal STOCK, process Casting.
    // Material is issued ONLY at Casting; issue 50 g, receive 5 g back
    // before the worker settlement.
    employee: 'Asmi',
    stockEntityType: 'Metal',
    stockIdentityType: 'Stock',
    stockRow: 'Gold,Ring-Tendulkar', // the locker stock row to issue (preferred; see stockRowPatterns)
    stockMetalType: 'Met Stone Setting 5', // that row's Metal Type - the receipt grid keys pending material by purity + metal type
    purity: '91.60',
    issueWeight: 50,
    receiptWeight: 5,
  },
  item: {
    articleSearch: 'tendu',
    article: 'Gold,Ring-Tendulkar',
    puritySearch: '91.6',
    purity: '(22 Karat Gold)',
    weight: '40.000', // settled weight (QA lead, 23-09-2026; the recording had 45.000)
    moveToJobFinalize: true,
  },
};

async function login(loginPage) {
  await loginPage.ensureLoggedIn();
}

/**
 * Steps from the job assignment onward must NEVER run on an empty state:
 * the grid helpers fall back to "the first pending row" when no key is
 * given, which would silently act on somebody else's job in the QA env.
 */
function requireJob() {
  const s = state.readState();
  expect(s.jobWorkNo || s.productionNo, 'run the chain from TC-CADM-01 (no job work / production no in e2e-cad-material-state.json)').toBeTruthy();
}

/** Grid-row keys: job work no (P-series) or production no (J-series) - grids use either. */
function rowKey() {
  const s = state.readState();
  return [s.jobWorkNo || s.conceptNo, s.productionNo].filter(Boolean);
}

test.describe('Production - Concept - CAD - Material - Workflow', () => {
  test('TC-CADM-01 create the production concept', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    state.reset(); // a new concept starts a new chain
    const conceptNo = await production.createConcept(DATA.concept);
    expect(conceptNo, 'concept no from the Print dialog').toBeTruthy();
    state.writeState({ conceptNo });
    console.log(`Concept created: ${conceptNo}`);
  });

  test('TC-CADM-02 concept upload', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { conceptNo } = state.readState();
    expect(conceptNo, 'run TC-CADM-01 first').toBeTruthy();
    await login(loginPage);
    await production.uploadConceptImage({ worker: DATA.worker, conceptNo, description: 'E2E upload' });
    state.writeState({ conceptUploaded: true });
    console.log(`Concept ${conceptNo} upload saved`);
  });

  test('TC-CADM-03 concept approval', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { conceptNo } = state.readState();
    expect(conceptNo, 'run TC-CADM-01 first').toBeTruthy();
    await login(loginPage);
    await production.approveConcept({ worker: DATA.worker, conceptNo, concept: DATA.concept.conceptFor, remarks: 'E2E approval' });
    state.writeState({ conceptApproved: true });
    console.log(`Concept ${conceptNo} approved`);
  });

  test('TC-CADM-04 create production job work from the concept', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { conceptNo } = state.readState();
    expect(conceptNo, 'run TC-CADM-01 first').toBeTruthy();
    await login(loginPage);
    const jobWorkNo = await production.createJobWork({ conceptNo, remarks: 'E2E CAD/material job work' });
    state.writeState({ jobWorkNo });
    console.log(`Job work created: ${jobWorkNo || '(number not captured - later steps fall back to the concept no)'}`);
  });

  test('TC-CADM-05 assign the job to Design And CAD / CAD Modeling', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { conceptNo } = state.readState();
    expect(conceptNo, 'run the chain from TC-CADM-01').toBeTruthy();
    await login(loginPage);
    // the assignment save allots the PRODUCTION no (J-series) - CAD Upload
    // and the later grids key on it
    const productionNo = await production.assignJob({ process: DATA.round1.process, subProcess: DATA.round1.subProcess, rowText: conceptNo });
    if (productionNo) state.writeState({ productionNo });
    console.log(`Job assigned to ${DATA.round1.process} / ${DATA.round1.subProcess} - production no ${productionNo || '(not captured)'}`);
  });

  test('TC-CADM-06 process movement accept (Design And CAD)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    await production.processMovementAccept({ process: DATA.round1.process, rowText: rowKey() });
    console.log('Process movement accepted at Design And CAD');
  });

  test('TC-CADM-07 worker issue (CAD Modeling, Prabhat)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    await production.workerIssue({ ...DATA.round1, rowText: rowKey() });
    console.log('Worker issue (CAD) submitted');
  });

  test('TC-CADM-08 CAD upload for the job (while it is with the CAD worker)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    const { productionNo } = state.readState();
    expect(productionNo, 'production no must be known (captured at job assignment)').toBeTruthy();
    const body = await production.cadUpload({ ...DATA.cad, productionNo });
    expect(body, 'CAD upload save response').toBeTruthy();
    state.writeState({ cadUploaded: true });
    console.log(`CAD uploaded for ${productionNo}`);
  });

  test('TC-CADM-09 CAD approval for the job', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    const { productionNo } = state.readState();
    expect(productionNo, 'run TC-CADM-08 first').toBeTruthy();
    const body = await production.cadApprove({ worker: DATA.cad.worker, productionNo });
    expect(body, 'CAD approval save response').toBeTruthy();
    state.writeState({ cadApproved: true });
    console.log(`CAD approved for ${productionNo}`);
  });

  test('TC-CADM-10 worker receipt (CAD Modeling, Prabhat)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    await production.workerReceipt({ ...DATA.round1, rowText: rowKey() });
    console.log('Worker receipt (CAD) submitted');
  });

  test('TC-CADM-11 process movement transfer to Casting Process and accept', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    await login(loginPage);
    requireJob();
    await production.processMovementTransfer({
      fromProcess: DATA.round1.process,
      fromSubProcess: DATA.round1.subProcess,
      toProcess: DATA.round2.process,
      toSubProcess: DATA.round2.subProcess,
      rowText: rowKey(),
    });
    console.log('Transferred to Casting Process / Casting Inspection');
    await production.processMovementAccept({ process: DATA.round2.process, rowText: rowKey() });
    console.log('Process movement accepted at Casting Process');
  });

  test('TC-CADM-12 worker issue (Casting, newest Sioniquser from the masters suite)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    console.log(`Casting worker: ${CASTING_WORKER} (${process.env.CASTING_WORKER ? 'CASTING_WORKER env' : 'last completed masters iteration in sioniquser-counter.json'})`);
    state.writeState({ castingWorker: CASTING_WORKER });
    await production.workerIssue({ ...DATA.round2, rowText: rowKey() });
    console.log('Worker issue (Casting) submitted');
  });

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Ordered stock-row patterns for the material issue: exact row, then same article, then same metal type, then any 91.60 Gold row. */
  const stockRowPatterns = () => {
    const { stockMetalType, stockRow, purity } = DATA.material;
    const p = escapeRe(purity);
    return [
      new RegExp(`${escapeRe(stockMetalType)}[\\s\\S]*${escapeRe(stockRow)}[\\s\\S]*${p}`),
      new RegExp(`${escapeRe(stockRow)} ${p}`), // the article, whatever its metal type
      new RegExp(`Gold ${escapeRe(stockMetalType)}[\\s\\S]*${p}`), // the metal type, whatever its article
      new RegExp(`^\\d+ Gold [\\s\\S]*${p} \\(`), // any Gold row of that purity
    ];
  };
  const issuedMetalType = () => state.readState().materialIssuedMetalType || DATA.material.stockMetalType;
  const issuedArticleTail = () => {
    const a = state.readState().materialIssuedArticle || DATA.material.stockRow;
    return a.split(/[,-]/).pop().trim(); // "Gold,Ring-Tendulkar" -> "Tendulkar", "Gold,Bridal Classic1" -> "Bridal Classic1"
  };

  test('TC-CADM-13 material issue (Metal / Stock) to the casting worker', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    const body = await production.materialIssue({
      employee: DATA.material.employee,
      process: DATA.round2.process,
      subProcess: DATA.round2.subProcess,
      worker: DATA.round2.worker,
      stockEntityType: DATA.material.stockEntityType,
      stockIdentityType: DATA.material.stockIdentityType,
      // locker stock rows carry article names, not job numbers; other rows
      // list "Tendulkar" among their sub-categories, so key on the metal type
      // + the exact article + the purity of OUR stock row - with fallbacks,
      // because the locker's rows drift between runs (22-09-2026: the
      // Met Stone Setting 5 / Gold,Ring-Tendulkar row was used up)
      rowText: stockRowPatterns(),
      weight: DATA.material.issueWeight,
      productionNo: state.readState().productionNo, // the Configure dialog's Assign Type "Production" asks for it
      description: 'E2E material issue',
    });
    expect(body, 'material issue save response').toBeTruthy();
    const issued = production.lastMaterialRow || {};
    state.writeState({
      materialIssueNo: (body.data && (body.data.receiptNo || body.data.docNo)) || '',
      // the receipt step returns the metal under the SAME metal type / article
      materialIssuedMetalType: issued['Metal Type'] || DATA.material.stockMetalType,
      materialIssuedArticle: issued['Article'] || DATA.material.stockRow,
    });
    console.log(`Material issued: ${JSON.stringify(body.data || body).slice(0, 160)}`);
  });

  test('TC-CADM-14 material receipt (Casting Process, 5 g back from the casting worker)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    await login(loginPage);
    requireJob();
    const body = await production.materialReceipt({
      employee: DATA.material.employee,
      process: DATA.round2.process,
      subProcess: DATA.round2.subProcess,
      worker: DATA.round2.worker,
      stockEntityType: DATA.material.stockEntityType,
      stockIdentityType: DATA.material.stockIdentityType,
      weight: DATA.material.receiptWeight,
      // the pending grid shows no document numbers and AGGREGATES the worker's
      // open issues per purity + metal type ("Gold 91.6 Met Stone Setting 5
      // 15.000 13.740" when an earlier 5 g is still pending): key our row by
      // purity + the issued stock's metal type, never by the exact weight
      rowText: [
        new RegExp(`91\\.6\\b[\\s\\S]*${escapeRe(issuedMetalType())}`),
        /91\.6\b/, // any pending 91.6 row of this worker
      ],
      prefer: {
        metalStoneSettingID: new RegExp(escapeRe(issuedMetalType()), 'i'),
        productArticleID: new RegExp(escapeRe(issuedArticleTail()), 'i'),
      },
      productionNo: state.readState().productionNo,
      description: 'E2E material receipt',
    });
    expect(body, 'material receipt save response').toBeTruthy();
    state.writeState({ materialReceiptNo: (body.data && (body.data.receiptNo || body.data.docNo)) || '' });
    console.log(`Material receipt saved: ${JSON.stringify(body.data || body).slice(0, 160)}`);
  });

  test('TC-CADM-15 worker receipt with item (Casting, newest Sioniquser, 40 g) - Move to Job Finalize', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    await login(loginPage);
    requireJob();
    await production.workerReceipt({ ...DATA.round2, rowText: rowKey(), jobNo: state.readState().jobWorkNo, item: DATA.item });
    if (production.lastProductionNo) state.writeState({ productionNo: production.lastProductionNo });
    state.writeState({ settled: true });
    console.log('Worker receipt (Casting) with item submitted - moved to Job Finalize');
  });
});
