const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { latestSioniqUser } = require('../../utils/sioniquser');

const state = makeState('e2e-masterdesign-settlement-state.json');

/**
 * The casting worker is the Sioniquser the masters suite
 * (tests/masters/master-add-operations) created LAST - read from
 * sioniquser-counter.json - so "npm run test:mds" (masters, then this
 * chain) always issues to the newest employee, exactly like the CAD chain's
 * "npm run test:cadm". CASTING_WORKER=<name> overrides it for a one-off run.
 */
const CASTING_WORKER = process.env.CASTING_WORKER || latestSioniqUser().displayName;

/**
 * PRODUCTION END-TO-END WORKFLOW - MASTER DESIGN TO SETTLEMENT.
 *
 * QA lead, 25-09-2026. The master-design job goes straight to Casting (no CAD
 * round) and is settled there with material moves:
 *
 *   01 Master Design                     Production > Planning > Master Design
 *   02 Job work                          Generation Type Master Design, ref = the design number
 *   03 Job assignment                    -> Casting Process / Casting Inspection (allots the J-series production no)
 *   04 Process movement accept           Casting Process
 *   05 Worker issue                      Casting / the newest Sioniquser<N> (see CASTING_WORKER)
 *   06 Material issue                    Material Transaction > Issue: employee Asmi's locker stock
 *                                        (Material / Stock, Gold,Ring-Tendulkar 91.60) -> 50 g to the
 *                                        casting worker, assigned to the job's production no
 *   07 Material receipt                  5 g back from the casting worker
 *   08 Worker receipt (settlement)       Casting / item 40.000 g / Move to Job Finalize
 *   09 Material receipt                  the balance still with the worker after the settlement
 *                                        (50 issued - 5 returned - 40 settled = 5 g)
 *
 * One continuous business flow; each test consumes the previous test's
 * output via e2e-masterdesign-settlement-state.json, so the chain resumes
 * where it stopped and any step can be re-run alone. Independent of the
 * plain master-design chain's state file.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  design: {
    creationType: 'Create Master Design',
    itemType: 'Metal',
    weightType: 'Net Weight',
    weight: 28,
    article: 'Tendulkar',
    description: 'Test 2', // a Description MASTER value (the field is a dropdown, not free text)
  },
  casting: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: CASTING_WORKER },
  material: {
    // same locker stock as the CAD chain (QA lead, 21-09-2026): employee
    // Asmi, plain metal STOCK, Gold,Ring-Tendulkar 91.60
    employee: 'Asmi',
    stockEntityType: 'Material', // 25-09-2026: the entity list is now Metal Stock / Stone / Material - QA lead: Material + Stock
    stockIdentityType: 'Stock',
    stockRow: 'Gold,Ring-Tendulkar',
    stockMetalType: 'Metal Stone Setting 4',
    purity: '91.60',
    issueWeight: 50,
    receiptWeight: 5,
    // step 09 takes the dialog's Balance Gross Weight (whatever is still
    // pending with the worker) unless BALANCE_RECEIPT_WEIGHT pins a figure
    balanceReceiptWeight: process.env.BALANCE_RECEIPT_WEIGHT ? Number(process.env.BALANCE_RECEIPT_WEIGHT) : undefined,
  },
  item: {
    articleSearch: 'tendu',
    article: 'Gold,Ring-Tendulkar',
    puritySearch: '91.6',
    purity: '(22 Karat Gold)',
    weight: '40.000',
    moveToJobFinalize: true,
  },
};

async function login(loginPage) {
  await loginPage.ensureLoggedIn();
}

/**
 * Steps from the process movement onward must NEVER run without this chain's
 * job work AND production number: the grid helpers otherwise fall back to
 * the first pending row and act on somebody else's job in the QA env.
 */
function requireJob() {
  const s = state.readState();
  expect(s.jobWorkNo && s.productionNo, 'run the chain from TC-MDS-01 (no job work / production no in e2e-masterdesign-settlement-state.json)').toBeTruthy();
}

/** Grid-row keys: job work no (P-series) and production no (J-series) - grids use either. */
function rowKey() {
  const s = state.readState();
  return [s.jobWorkNo, s.productionNo].filter(Boolean);
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ordered stock-row patterns for the material issue: exact row, then same article, then same metal type, then any 91.60 Gold row. */
function stockRowPatterns() {
  const { stockMetalType, stockRow, purity } = DATA.material;
  const p = escapeRe(purity);
  return [
    new RegExp(`${escapeRe(stockMetalType)}[\\s\\S]*${escapeRe(stockRow)}[\\s\\S]*${p}`),
    new RegExp(`${escapeRe(stockRow)} ${p}`),
    new RegExp(`Gold ${escapeRe(stockMetalType)}[\\s\\S]*${p}`),
    new RegExp(`^\\d+ Gold [\\s\\S]*${p} \\(`),
  ];
}
const issuedMetalType = () => state.readState().materialIssuedMetalType || DATA.material.stockMetalType;
const issuedArticleTail = () => {
  const a = state.readState().materialIssuedArticle || DATA.material.stockRow;
  return a.split(/[,-]/).pop().trim();
};

/** Material receipt from the casting worker - the pending grid aggregates per purity + metal type. */
function materialReceiptArgs(weight, description) {
  return {
    employee: DATA.material.employee,
    process: DATA.casting.process,
    subProcess: DATA.casting.subProcess,
    worker: DATA.casting.worker,
    stockEntityType: DATA.material.stockEntityType,
    stockIdentityType: DATA.material.stockIdentityType,
    weight,
    rowText: [
      new RegExp(`91\\.6\\b[\\s\\S]*${escapeRe(issuedMetalType())}`),
      /91\.6\b/,
    ],
    prefer: {
      metalStoneSettingID: new RegExp(escapeRe(issuedMetalType()), 'i'),
      productArticleID: new RegExp(escapeRe(issuedArticleTail()), 'i'),
    },
    productionNo: state.readState().productionNo,
    description,
  };
}

const docNo = (body) => (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';

test.describe('Production - Master Design - Settlement - Workflow', () => {
  test('TC-MDS-01 create the master design', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    state.reset(); // a new design starts a new chain - no stale job / production numbers
    await login(loginPage);
    const { DEMO_FILES } = require('../../utils/demo-files');
    const designNo = await production.createMasterDesign({ ...DATA.design, imagePath: DEMO_FILES.image1 });
    expect(designNo, 'generated design number').toBeTruthy();
    state.writeState({ designNo, castingWorker: CASTING_WORKER });
    console.log(`Master design created: ${designNo}`);
  });

  test('TC-MDS-02 create the production job work from the master design', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { designNo } = state.readState();
    expect(designNo, 'run TC-MDS-01 first').toBeTruthy();
    await login(loginPage);
    const jobWorkNo = await production.createJobWork({
      generationType: 'Master Design',
      refLabel: 'Design Number',
      refNo: designNo,
      searchRef: false, // filtering the design list breaks Submit (app bug)
      remarks: 'E2E master design settlement job work',
    });
    expect(jobWorkNo, 'job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Job work created: ${jobWorkNo}`);
  });

  test('TC-MDS-03 assign the job to Casting Process / Casting Inspection', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-MDS-02 first').toBeTruthy();
    await login(loginPage);
    const productionNo = await production.assignJob({
      generationType: 'Master Design',
      process: DATA.casting.process,
      subProcess: DATA.casting.subProcess,
      rowText: rowKey(),
    });
    expect(productionNo, 'production number allotted by the assignment').toBeTruthy();
    state.writeState({ productionNo });
    console.log(`Job assigned to ${DATA.casting.process} / ${DATA.casting.subProcess} - production no ${productionNo}`);
  });

  test('TC-MDS-04 process movement accept (Casting Process)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    requireJob();
    await login(loginPage);
    await production.processMovementAccept({ process: DATA.casting.process, rowText: rowKey() });
    console.log('Process movement accepted at Casting Process');
  });

  test('TC-MDS-05 worker issue (Casting, newest Sioniquser from the masters suite)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    requireJob();
    await login(loginPage);
    console.log(`Casting worker: ${CASTING_WORKER} (${process.env.CASTING_WORKER ? 'CASTING_WORKER env' : 'last completed masters iteration in sioniquser-counter.json'})`);
    state.writeState({ castingWorker: CASTING_WORKER });
    await production.workerIssue({ ...DATA.casting, rowText: rowKey() });
    console.log('Worker issue (Casting) submitted');
  });

  test('TC-MDS-06 material issue (Material / Stock, 50 g) to the casting worker', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    requireJob();
    await login(loginPage);
    const body = await production.materialIssue({
      employee: DATA.material.employee,
      process: DATA.casting.process,
      subProcess: DATA.casting.subProcess,
      worker: DATA.casting.worker,
      stockEntityType: DATA.material.stockEntityType,
      stockIdentityType: DATA.material.stockIdentityType,
      rowText: stockRowPatterns(),
      weight: DATA.material.issueWeight,
      productionNo: state.readState().productionNo, // Configure dialog: Assign Type Production + Production No
      description: 'E2E master design material issue',
    });
    expect(body, 'material issue save response').toBeTruthy();
    const issued = production.lastMaterialRow || {};
    state.writeState({
      materialIssueNo: docNo(body),
      materialIssuedMetalType: issued['Metal Type'] || DATA.material.stockMetalType,
      materialIssuedArticle: issued['Article'] || DATA.material.stockRow,
    });
    console.log(`Material issued: ${JSON.stringify(body.data || body).slice(0, 160)}`);
  });

  test('TC-MDS-07 material receipt (5 g back from the casting worker)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    requireJob();
    await login(loginPage);
    const body = await production.materialReceipt(materialReceiptArgs(DATA.material.receiptWeight, 'E2E master design material receipt'));
    expect(body, 'material receipt save response').toBeTruthy();
    state.writeState({ materialReceiptNo: docNo(body) });
    console.log(`Material receipt saved: ${JSON.stringify(body.data || body).slice(0, 160)}`);
  });

  test('TC-MDS-08 worker receipt with item (Casting, 40 g) - settlement, Move to Job Finalize', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    requireJob();
    await login(loginPage);
    await production.workerReceipt({ ...DATA.casting, rowText: rowKey(), jobNo: state.readState().jobWorkNo, item: DATA.item });
    if (production.lastProductionNo) state.writeState({ settledProductionNo: production.lastProductionNo });
    state.writeState({ settled: true });
    console.log('Worker receipt (Casting) with item submitted - moved to Job Finalize');
  });

  test('TC-MDS-09 material receipt (the balance still with the worker after the settlement)', async ({ loginPage, production }) => {
    test.setTimeout(420_000);
    requireJob();
    expect(state.readState().settled, 'run TC-MDS-08 first').toBeTruthy();
    await login(loginPage);
    const body = await production.materialReceipt(materialReceiptArgs(DATA.material.balanceReceiptWeight, 'E2E master design balance receipt'));
    expect(body, 'balance material receipt save response').toBeTruthy();
    state.writeState({ balanceReceiptNo: docNo(body) });
    console.log(`Balance material receipt saved: ${JSON.stringify(body.data || body).slice(0, 160)}`);
  });
});
