const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-order-tag-transfer-state.json');

/**
 * E2E WORKFLOW — BRANCH TO HO INHOUSE BARCODE FLOW: B2B ORDER / INHOUSE JOB
 * WORK / JOB FINALIZE BARCODE / COUNTER / TRANSFER COCHIN -> KAKKANAD.
 *
 * User flow (17-09-2026): after Job Finalize generates the barcode, the tag
 * is counter-allocated at the head office and transferred out HO -> branch.
 * Locations (qa BUs: Aluva / Kakkanad / Palakkad / Trivendrum / Cochin):
 * the business steps run at KAKKANAD; the production steps run at COCHIN -
 * the only production unit, and its pending work is invisible elsewhere.
 *
 *   Kakkanad  TC-B2B-JFT-01  B2B Order Booking (Making Type "Job Work")
 *             TC-B2B-JFT-02  Job Work from the order, INHOUSE, PU Cochin
 *   Cochin    TC-B2B-JFT-03  Job Assignment -> Casting Process / Casting Inspection
 *             TC-B2B-JFT-04  Process Movement accept
 *             TC-B2B-JFT-05  Worker Issue (Sioniquser16)
 *             TC-B2B-JFT-06  Worker Receipt (item form, Move to Job Finalize)
 *             TC-B2B-JFT-07  Job Finalize -> Generate Barcode
 *             TC-B2B-JFT-08  Generated Tags - read the tag number
 *   Cochin    TC-B2B-JFT-09  Counter Allocation (scan the tag)
 *             TC-B2B-JFT-10  Counter Accept
 *             TC-B2B-JFT-11  Transfer Out to the Kakkanad head office
 *   Kakkanad  TC-B2B-JFT-12  Transfer In from Cochin - the tag lands at the HO
 *
 * WORKFLOW FINDING (17-09-2026): the finalize tag's stock belongs to the
 * PRODUCTION UNIT (Cochin), not the ordering HO - the counter-allocation
 * scan stages it at Cochin and finds nothing at Kakkanad. A Kakkanad ->
 * Cochin transfer of this tag is therefore impossible (it is already at
 * Cochin); the transferable leg is Cochin -> Kakkanad, receiving the
 * finished piece at the head office.
 *
 * State: e2e-b2b-order-tag-transfer-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const KAKKANAD = { bu: 'Kakkanad' };
// production work for the Cochin PU is only visible under the COCHIN login
// (probed 17-09-2026: the Kakkanad Job Assignment grid never lists the job) -
// the production stages log in there, exactly like the other chains
const COCHIN = { bu: 'Cochin' };

const DATA = {
  order: {
    purposeType: 'Order',
    customer: 'Luxurio',
    itemType: 'Metal',
    makingType: 'Job Work',
    supervisor: 'Abc',
    smCode: 'AJ10',
    orderGivenBy: 'JJ',
    contactNumber: '9898989899',
    deliveryNote: 'Urgent',
    referenceType: 'Combination',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.60',
    grossWeight: 50,
  },
  // the Job Work form's Production Unit list offers ONLY Cochin (probed
  // 17-09-2026) - qa has a single production unit; the chain still runs
  // logged into Kakkanad throughout
  productionUnit: 'Cochin',
  round: { process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser16' },
  item: {
    articleSearch: 'tendu',
    article: 'Gold,Ring-Tendulkar',
    puritySearch: '91.6',
    purity: '(22 Karat Gold)',
    weight: '5.000',
    moveToJobFinalize: true,
  },
  counter: { itemType: 'Metal', groupCategory: 'Gold' },
  // the tag lives at the Cochin PU (see WORKFLOW FINDING) - the transfer
  // goes to the Kakkanad head office
  transfer: { destination: 'Kakkanad', itemType: 'Metal', groupCategory: 'Gold' },
};

async function login(loginPage, page, creds = KAKKANAD) {
  await loginPage.ensureLoggedIn(creds);
}

function rowKey() {
  // grids key rows by the job work no (P-series) OR the production no
  // (J-series, the accept-after-transfer trap of 16-09-2026) - match either
  const s = state.readState();
  return [s.jobWorkNo || s.orderNo, s.productionNo].filter(Boolean);
}

test.describe('B2B Order - Job Finalize Tag - Counter - Transfer Kakkanad to Cochin', () => {
  test('TC-B2B-JFT-01 Kakkanad: create the B2B job work order', async ({ loginPage, b2bOrderBooking, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new order starts a new chain
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

    await b2bOrderBooking.fillItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
    });
    await b2bOrderBooking.attachFileViaAddFiles(DEMO_FILES.image1);

    // KAKKANAD: the location has no metal-rate configuration, so the item's
    // Rate lands 0 and Add Items silently rejects the unpriced item (run
    // 17-09-2026, screenshot). Enter the rate manually when it reads 0.
    const rate = page.locator('div.grid, div.form-group')
      .filter({ has: page.locator('label:text-is("Rate")') }).last()
      .locator('input:not([type=checkbox]):not([disabled])').first();
    if (!Number(await rate.inputValue().catch(() => '0'))) {
      await rate.fill('6000');
      await rate.blur();
      await page.waitForTimeout(2_500);
      console.log('rate was 0 at Kakkanad - entered 6000 manually');
    }

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
    console.log(`B2B job work order created at Kakkanad: ${orderNo}`);
  });

  test('TC-B2B-JFT-02 Kakkanad: create inhouse job work from the order', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-JFT-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createInhouseJobWorkFromOrder({
      orderNo,
      productionUnit: DATA.productionUnit,
      itemType: DATA.order.itemType,
    });
    expect(jobWorkNo, 'generated job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Inhouse job work created (production unit ${DATA.productionUnit}): ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-JFT-03 Cochin: assign the job to Casting Process / Casting Inspection', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-B2B-JFT-02 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    const productionNo = await production.assignJob({
      generationType: 'Order',
      itemType: DATA.order.itemType,
      location: DATA.productionUnit,
      process: DATA.round.process,
      subProcess: DATA.round.subProcess,
      rowText: rowKey(),
    });
    if (productionNo) state.writeState({ productionNo });
    console.log(`Job assigned to ${DATA.round.process} / ${DATA.round.subProcess} (production no ${productionNo || 'n/a'})`);
  });

  test('TC-B2B-JFT-04 Cochin: process movement accept (Casting)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey().length, 'run TC-B2B-JFT-02 first').toBeGreaterThan(0);
    await login(loginPage, page, COCHIN);
    const accepted = await production.processMovementAccept({ process: DATA.round.process, rowText: rowKey() });
    expect(accepted, 'movement must be genuinely accepted').toBe('accepted');
    console.log('Process movement accepted at Casting');
  });

  test('TC-B2B-JFT-05 Cochin: worker issue (Casting, Sioniquser16)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    expect(rowKey().length, 'run TC-B2B-JFT-02 first').toBeGreaterThan(0);
    await login(loginPage, page, COCHIN);
    const issued = await production.workerIssue({ ...DATA.round, rowText: rowKey() });
    expect(issued, 'worker issue must not silently skip').not.toBe('skipped');
    console.log('Worker issue done (Casting)');
  });

  test('TC-B2B-JFT-06 Cochin: worker receipt with item (move to Job Finalize)', async ({ loginPage, production, page }) => {
    test.setTimeout(900_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-B2B-JFT-02 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    const received = await production.workerReceipt({
      ...DATA.round,
      rowText: rowKey(),
      jobNo: jobWorkNo,
      item: DATA.item,
    });
    expect(received, 'worker receipt must not silently skip').not.toBe('skipped');
    if (production.lastProductionNo) state.writeState({ productionNo: production.lastProductionNo });
    console.log('Worker receipt with item done - moved to Job Finalize');
  });

  test('TC-B2B-JFT-07 Cochin: finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    expect(rowKey().length, 'run TC-B2B-JFT-02 first').toBeGreaterThan(0);
    await login(loginPage, page, COCHIN);
    const result = await production.finalizeAndGenerateBarcode({ rowText: rowKey() });
    expect(result, 'barcode generation response').toBeTruthy();
    expect(result.message).toMatch(/saved successfully/i);
    state.writeState({ tagReceiptNo: result.data && result.data.receiptNo });
    console.log(`Barcode generated - tag receipt ${result.data && result.data.receiptNo}`);
  });

  test('TC-B2B-JFT-08 Cochin: read the tag from Generated Tags', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-B2B-JFT-02 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    // generated tags are listed on the JOB FINALIZE page's "Generated Tags"
    // view (rows: tag no / job work no / production no) - not on the Barcode
    // page, whose list is lot progress only (probed 17-09-2026)
    const tagNo = await production.readGeneratedTag(rowKey());
    expect(tagNo, 'tag number from the Generated Tags view').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Generated tag: ${tagNo}`);
  });

  test('TC-B2B-JFT-09 Cochin: counter allocation of the tag', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-B2B-JFT-08 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    const allocationNo = await logisticsSales.counterAllocation({
      itemType: DATA.counter.itemType,
      groupCategory: DATA.counter.groupCategory,
      tagNo,
    });
    state.writeState({ allocationNo });
    console.log(`Counter allocation saved (doc: ${allocationNo || 'keyed by tag'})`);
    expect(logisticsSales.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-JFT-10 Cochin: counter accept', async ({ loginPage, logisticsSales, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-B2B-JFT-09 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    const body = await logisticsSales.counterAccept({ itemType: DATA.counter.itemType, tagNo });
    expect(body, 'counter accept save response').toBeTruthy();
    state.writeState({ counterAccepted: true });
    console.log('Counter accept saved');
  });

  test('TC-B2B-JFT-11 Cochin: transfer out to the Kakkanad head office', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, counterAccepted } = state.readState();
    expect(tagNo && counterAccepted, 'run TC-B2B-JFT-10 first').toBeTruthy();
    await login(loginPage, page, COCHIN);
    // the finalize tag never sat in the Lot process, so the lot-chain
    // defaults (From Process / From Transaction Type) do not apply - both
    // picks are best-effort and skipped when the form does not offer them
    const body = await transfers.transferOut({
      destination: DATA.transfer.destination,
      itemType: DATA.transfer.itemType,
      groupCategory: DATA.transfer.groupCategory,
      fromProcess: null,
      fromTransactionType: null,
      tag: tagNo,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ transferOutNo });
    console.log(`Tag ${tagNo} transferred out Cochin -> Kakkanad (doc: ${transferOutNo})`);
  });

  test('TC-B2B-JFT-12 Kakkanad: transfer in the tag from Cochin', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferOutNo } = state.readState();
    expect(tagNo && transferOutNo, 'run TC-B2B-JFT-11 first').toBeTruthy();
    await login(loginPage, page); // Kakkanad - the receiving head office
    const body = await transfers.transferIn({
      fromBU: 'Cochin',
      transactionMode: 'Stock',
      stockSourceType: 'TagWise',
      itemType: DATA.transfer.itemType,
      groupCategory: DATA.transfer.groupCategory,
      transferOutNo,
      receiver: 'JJ',
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferInNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ transferInNo });
    console.log(`Tag ${tagNo} received at Kakkanad from Cochin (transfer in ${transferInNo}, against transfer out ${transferOutNo}) - branch to HO inhouse barcode flow complete`);
  });
});
