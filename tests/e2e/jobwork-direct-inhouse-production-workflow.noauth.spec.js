const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');

const state = makeState('e2e-jobwork-direct-state.json');

/**
 * E2E WORKFLOW — JOB WORK (DIRECT) / INHOUSE PRODUCTION.
 *
 * Chain (same shape as the B2B inhouse job-work stream, 11-09-2026): a
 * DIRECT job work (no order behind it - Procurement > Operations > Issue,
 * JobWork Issue tab, Generation Type "Direct", 3-step wizard) is assigned
 * DIRECTLY to Casting Process / Casting Inspection, then Process Movement
 * Accept -> Worker Issue -> Worker Receipt (settlement item-form with
 * Move to Job Finalize).
 *
 * Step order:
 *   1 direct job work (wizard: General -> Items -> Review & Submit)
 *   2 job assignment (source Job Work, generation type DIRECT) -> Casting
 *   3 process movement accept (Casting)
 *   4 worker issue (Casting, Sioniquser11)
 *   5 worker receipt (settlement, Move to Job Finalize)
 *
 * Grids key rows by the JOB WORK NO. State: e2e-jobwork-direct-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  jobWork: {
    mode: 'Inhouse',
    productionUnit: 'Cochin',
    itemType: 'Metal',
    orderType: 'Stock',
    makingType: 'Regular',
    smCode: 'AJ10',
    deliveryNote: 'Urgent',
    item: { groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', grossWeight: 50 },
  },
  // single production round: assigned directly to Casting
  round: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser11' },
  // the settlement receipt: Production No auto-selects the offered pending
  // job, then item details, then Move to Job Finalize + Add Items
  receiptItem: { article: 'Tendulkar', articleSearch: 'ring', purity: '91.6', weight: 40 },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function rowKey() {
  return state.readState().jobWorkNo;
}

test.describe('Job Work Direct - Inhouse - Production - Workflow', () => {
  test('TC-JW-DIR-01 create the DIRECT inhouse job work', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const jobWorkNo = await production.createDirectInhouseJobWork({
      ...DATA.jobWork,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    expect(jobWorkNo, 'generated direct job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Direct inhouse job work created: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-JW-DIR-02 assign the job work to Casting Process / Casting Inspection', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey(), 'run TC-JW-DIR-01 first').toBeTruthy();
    await login(loginPage, page);
    await production.assignJob({
      sourceType: 'Job Work',
      generationType: 'Direct',
      itemType: 'Metal',
      process: DATA.round.process,
      subProcess: DATA.round.subProcess,
      rowText: rowKey(),
    });
    console.log(`Direct job work assigned to ${DATA.round.process} / ${DATA.round.subProcess}`);
  });

  test('TC-JW-DIR-03 process movement accept (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    await login(loginPage, page);
    const result = await production.processMovementAccept({
      process: DATA.round.process,
      sourceType: 'Job Work',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    expect(result, 'job work pending at Process Movement Accept (not skipped)').not.toBe('skipped');
    console.log('Process movement accepted (direct job work) at Casting');
  });

  test('TC-JW-DIR-04 worker issue (Casting, Sioniquser11)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const result = await production.workerIssue({
      ...DATA.round,
      productionSource: 'Job Work',
      itemType: 'Metal',
      rowText: rowKey(),
    });
    expect(result, 'job work issuable at Worker Issue (not skipped)').not.toBe('skipped');
    console.log('Worker issue (direct job work) done at Casting');
  });

  test('TC-JW-DIR-05 worker receipt - settlement (Move to Job Finalize)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);
    const result = await production.workerReceipt({
      ...DATA.round,
      productionSource: 'Job Work',
      itemType: 'Metal',
      rowText: rowKey(),
      item: {
        article: DATA.receiptItem.article,
        articleSearch: DATA.receiptItem.articleSearch,
        purity: DATA.receiptItem.purity,
        weight: DATA.receiptItem.weight,
        moveToJobFinalize: true,
      },
    });
    expect(result, 'job work receivable at Worker Receipt (not skipped)').not.toBe('skipped');
    console.log('Worker receipt (settlement) done + moved to Job Finalize');
  });
});
