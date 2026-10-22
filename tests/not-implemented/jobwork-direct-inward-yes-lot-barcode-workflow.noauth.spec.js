const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { jobworkInwardUpToSubmit, numbersIn } = require('../../utils/inward-yes');

const state = makeState('e2e-jwd-inward-yes-state.json');

/**
 * E2E WORKFLOW — JOB WORK (DIRECT) / OUTSOURCE / METAL INWARD "YES -> LOT" /
 * BARCODE GENERATION PAGE.
 *
 * Twin of jobwork-direct-outsource-lot-barcode-workflow with the lot created
 * BY THE INWARD'S OWN SUBMIT: "Process with Barcode or Lot?" is answered
 * Yes and the "Lot / Barcode" dialog's Lot option saves the inward and its
 * lot in one call. The tag is then generated on the Barcode Generation page
 * for that lot, exactly as in the sibling chain.
 *
 *   TC-JWD-IY-01  DIRECT outsource job work (vendor RAJA, Tendulkar 91.60, 60 g)
 *   TC-JWD-IY-02  jobwork-return Metal Inward, Yes -> Lot (Lot Employee Ubaid): inward + lot saved together
 *   TC-JWD-IY-03  Barcode Generation page: tag for that lot (as user suja)
 *
 * Numbers chain through e2e-jwd-inward-yes-state.json
 * (jobWorkNo -> inwardVoucherNo + lotNo -> tagNo).
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

// VENDOR=<name> runs the chain against another vendor (substring match)
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  jobWork: {
    vendor: VENDOR,
    itemType: 'Metal',
    orderType: 'Stock',
    makingType: 'Regular',
    smCode: 'AJ10',
    deliveryNote: 'Urgent',
    item: { referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', pieceWeight: 60 },
  },
  lotEmployee: 'Ubaid',
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Kakkanad' }, // recording switches users here
    stockIdentityType: 'Jobwork Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    // a jobwork-return lot's Counter is empty + mandatory and must be an ORDER-type counter (QA lead 06-10-2026)
    counter: 'Chain Counter KKD', // Kakkanad's Order-type counter (QA lead 22-10-2026); Cochin's was "Counter 1"
    subCounter: 'Sub Counter1',
  },
};

async function login(loginPage) {
  await loginPage.ensureLoggedIn();
}

test.describe('Job Work Direct - Metal Inward Yes to Lot - Barcode - Workflow', () => {
  test('TC-JWD-IY-01 create the DIRECT outsource job work', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    state.reset();
    await login(loginPage);

    const jobWorkNo = await production.createDirectOutsourceJobWork({
      ...DATA.jobWork,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    expect(jobWorkNo, 'generated direct outsource job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Direct outsource job work created: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-JWD-IY-02 metal inward (jobwork return), Yes -> Lot: the inward and its lot are saved together', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-JWD-IY-01 first').toBeTruthy();
    await login(loginPage);

    const article = await jobworkInwardUpToSubmit(metalInward, { vendor: DATA.jobWork.vendor, jobWorkNo });
    expect(article, 'article auto-filled from the job work item').toContain('Tendulkar');
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const result = await metalInward.submitWithPostProcess({ mode: 'Lot', lotEmployee: DATA.lotEmployee });
    expect(JSON.stringify(result.inward)).toMatch(/success/i);
    const found = numbersIn(result.all.map((x) => x.body));
    expect(found.inward, 'inward voucher number').toBeTruthy();
    console.log(`Inward ${found.inward} saved with Yes -> Lot; numbers in the saves: ${JSON.stringify(found)}`);
    expect(found.lots[0], `a lot must be generated with the inward (saves: ${JSON.stringify(result.all.map((x) => x.url))})`).toBeTruthy();
    state.writeState({ inwardVoucherNo: found.inward, lotNo: found.lots[0] });
    console.log(`Lot generated with the inward: ${found.lots[0]}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-JWD-IY-03 generate barcode for the lot on the Barcode Generation page (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-JWD-IY-02 first').toBeTruthy();

    // per the QA lead's recording this step runs as a DIFFERENT user
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.jobWork.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
      counter: DATA.barcode.counter,
      subCounter: DATA.barcode.subCounter,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    // proof: the tag is listed under Generated Tags
    const tagNo = await barcodeGeneration.verifyGeneratedTag('Tendulkar');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });
});
