const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');

const state = makeState('e2e-retail-ema-estimation-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> ESTIMATION with Sales Type EMA at Kakkanad: an
 * enrolled EMA member buys a tag and the member's EMA amount is set against the
 * estimate. Requested 14-11-2026 ("create estimation ema flow").
 *
 *   TC-EMAE-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *               vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), "Barcode or Lot?" = No
 *   TC-EMAE-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-EMAE-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges)
 *   TC-EMAE-04  admin (form login): Estimations > Estimation: the member's customer,
 *               Retail, Sales Type EMA -> Member Number (EMA Members row: plan, EMA
 *               Amount, Accumulated Weight, Installments; Closure Type when the plan
 *               offers one), Sales Executive Chandu, scan the tag -> Add Item
 *               (Estimation Amount / EMA Amount / Need to Pay tiles) -> Submit
 *               (Estimation/CreateEstimation, EST-nnnn)
 *
 * The member must be on a plan WITH closure types configured: the 2LAKH PLAN
 * members of the EMA chain are refused ("No closure type is configured for plan
 * 2LAKH PLAN", qa 14-11-2026). Default: Aneesh Maradu's EM002KKD (Customer Deposit
 * Plan, 1 / 1, 2,500); EMA_MEMBER / EMA_CUSTOMER / EMA_MOBILE / EMA_CLOSURE override
 * (e.g. V002 / Ginu / 1477533698 on the 5 Lakh Plan, Closure Type "Value Based").
 * An estimation is a quote - the member's EMA is not consumed, so reruns are fine.
 * Numbers chain through e2e-retail-ema-estimation-state.json. MUST run headed.
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  inward: {
    subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: VENDOR, purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 100, rate: 6000 },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: { user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, stockIdentityType: 'Stock', grossWeight: 50, descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' }, counter: null },
  ema: {
    memberNo: process.env.EMA_MEMBER || 'EM002KKD',
    customer: { name: process.env.EMA_CUSTOMER || 'Aneesh Maradu', mobile: process.env.EMA_MOBILE || '8547963321' },
    closureType: process.env.EMA_CLOSURE || undefined, // picked only when the member row offers the select
    businessType: 'Retail',
    salesExecutive: 'Chandu',
  },
};

async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Estimation (Sales Type EMA) - Workflow', () => {
  test('TC-EMAE-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({ subTransactionType: DATA.inward.subTransactionType, businessUnit: HEAD_OFFICE, inwardType: DATA.inward.inwardType, purchaseType: DATA.inward.purchaseType, vendor: DATA.inward.vendor, purchaser: DATA.inward.purchaser, invoiceNo: uniqueInvoiceNo() });
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
    const saved = await metalInward.submit();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, estimationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-EMAE-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-EMAE-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-EMAE-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-EMAE-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({ stockIdentityType: DATA.barcode.stockIdentityType, vendor: DATA.inward.vendor, lotNo, grossWeight: DATA.barcode.grossWeight, pieces: 1, additionalCharges: true, descriptions: DATA.barcode.descriptions, counter: DATA.barcode.counter });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-EMAE-04 Kakkanad: estimation (Sales Type EMA) for the member, the tag added - Submit', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-EMAE-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const d = DATA.ema;

    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: d.customer.name, mobile: d.customer.mobile, businessType: d.businessType });
    expect(await estimationSalesType.pickSalesType('EMA')).toMatch(/EMA/);
    const controls = await estimationSalesType.revealedControls();
    expect(controls.emaMemberNo, 'Member Number box revealed by Sales Type EMA').toBe(true);

    // the member: offered in Select Member, then fetched into the EMA Members row
    const { entry } = await estimationSalesType.emaMembersOffered(d.memberNo);
    expect(entry, `member ${d.memberNo} offered in Select Member`).toBeTruthy();
    const member = await estimationSalesType.pickupEmaMember(d.memberNo);
    expect(member.setupGap, `the plan must have closure types configured (${member.setupGap})`).toBeFalsy();
    expect(member.row, `EMA Members row for ${d.memberNo} (toasts ${JSON.stringify(member.toasts)})`).toBeTruthy();
    expect(member.row).toContain(entry.adpPlanName);
    expect(member.tiles.emaAmount, 'EMA Amount tile = the member\'s available closure amount').toBeCloseTo(Number(entry.accountAvailableClosureAmountTran), 2);
    const closure = await estimationSalesType.pickMemberClosureTypeIfOffered(d.closureType);

    await estimationSalesType.pick('salesExecutiveID', d.salesExecutive, { search: true });
    await estimationSalesType.settle(1_500);
    const summary = await estimationSalesType.scanAndAddTag(tagNo);
    expect(summary.items, 'No. of Items after Add Item').toBeGreaterThanOrEqual(1);
    const tiles = await estimationSalesType.emaTiles();
    console.log(`EMA estimation: tiles after Add Item ${JSON.stringify(tiles)}; closure type "${closure}"`);
    expect(tiles.emaAmount, 'EMA Amount tile').toBeGreaterThan(0);
    if (tiles.estimationAmount && tiles.needToPay !== null && tiles.needToPay !== undefined) {
      expect(tiles.needToPay, 'Need to Pay = Estimation Amount - EMA Amount (- benefits)').toBeLessThanOrEqual(tiles.estimationAmount - tiles.emaAmount + 0.01);
    }

    const body = await estimationSalesType.submitEstimation();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo, memberNo: d.memberNo, plan: entry.adpPlanName, emaAmount: tiles.emaAmount, estimationAmount: tiles.estimationAmount, needToPay: tiles.needToPay, closureType: closure });
    console.log(`Estimation saved: ${estimationNo} (Sales Type EMA, member ${d.memberNo} ${entry.adpPlanName}, EMA ${tiles.emaAmount}, tag ${tagNo})`);
  });
});
