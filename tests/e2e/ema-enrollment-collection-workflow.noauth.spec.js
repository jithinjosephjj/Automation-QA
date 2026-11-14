const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { EmaEnrollmentPage } = require('../../pages/EmaEnrollmentPage');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');

const state = makeState('e2e-ema-enrollment-state.json');

/**
 * E2E WORKFLOW — LAYAWAY / EMA PLANS: EMA ENROLLMENT -> EMA COLLECTION at
 * Kakkanad (admin). Requested 11-11-2026; values dictated by the user from
 * the live form.
 *
 *   TC-EMA-01  Layaway / EMA Plans > Operations > Enrollment & Collections >
 *              EMA Enrollment > Add: Mobile 1234567890, Customer / Member
 *              "Anu aa11", Plan Type Weight-Based Plan, EMA Plan 2LAKH PLAN,
 *              Group Amount 100000, Salesman Name Chandu (Salesman ID back-
 *              fills "2"); Financial Entry auto-computes Amount / Discount
 *              (2 % plan discount) / Final Amount / Gold Rate / Weight;
 *              Make Payment -> Cash (the first cash mode, "Cash Test Mode")
 *              for the balance due -> Submit (not Save as Draft). The member
 *              number (e.g. WB003KKD) comes with the save and the list.
 *   TC-EMA-02  EMA Collection > Add: the member number pasted into Member
 *              Number fetches the enrollment (Receipt Details: plan, member,
 *              installment no, amount); Make Payment -> Cash -> Submit;
 *              the enrollment's summary then counts the installment as paid.
 *   TC-EMA-03  Metal inward (Direct / Stock, RAJA, Tendulkar 91.60, 1 pc, 100 g)
 *   TC-EMA-04  Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-EMA-05  Barcode tag for the lot (as suja, 1 pc, Additional Charges)
 *   TC-EMA-06  Retail Operations > Estimations > Estimation: the member's customer,
 *              Retail, Sales Type EMA -> Member Number = the new member (EMA Members
 *              row: 2LAKH PLAN, EMA Amount, installments paid / total; Closure Type
 *              when offered), Sales Executive Chandu, scan the tag -> Add Item ->
 *              Submit (Estimation/CreateEstimation, EST-nnnn). Requested 14-11-2026
 *              ("create one member enrolment against 2 lakh plan and collection then
 *              estimation page"). On qa the plan needs its closure types configured -
 *              the step fails with the app's message otherwise.
 *
 * Numbers chain through e2e-ema-enrollment-state.json.
 */

const HEAD_OFFICE = 'Kakkanad';

const DATA = {
  enrollment: {
    mobile: process.env.EMA_MOBILE || '1234567890',
    customer: { name: process.env.EMA_CUSTOMER || 'Anu', code: process.env.EMA_CUSTOMER_CODE || 'aa11' }, // option "Anu aa11"
    planType: 'Weight-Based Plan',
    plan: process.env.EMA_PLAN || '2LAKH PLAN', // e.g. EMA_PLAN="5 Lakh Plan" (closure types configured on qa)
    groupAmount: Number(process.env.EMA_GROUP_AMOUNT || 100000), // falls back to the plan's first offered group
    salesman: 'Chandu',
    expectedSalesmanCode: '2',
    discountPct: 2, // "Auto - 2% plan discount"
    payment: { mode: 'Cash' }, // Kakkanad offers "Cash Test Mode" / "Cash Test Mode 2", no plain Cash
  },
  collection: {
    payment: { mode: 'Cash' },
  },
  inward: {
    subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: process.env.VENDOR || 'RAJA', purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 100, rate: 6000 },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: { user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, stockIdentityType: 'Stock', grossWeight: 50, descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' }, counter: null },
  estimation: { businessType: 'Retail', salesExecutive: 'Chandu', closureType: process.env.EMA_CLOSURE || undefined },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('EMA Enrollment - EMA Collection - Workflow', () => {
  test('TC-EMA-01 Kakkanad: EMA enrollment (Weight-Based 2LAKH PLAN, 100000, Cash) - Submit', async ({ loginPage, emaEnrollment, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const d = DATA.enrollment;

    await emaEnrollment.open();
    await emaEnrollment.openTab('Enrollment');
    await emaEnrollment.openAddForm(emaEnrollment.select('customerID'));

    const { salesmanCode, financials, groupAmountPicked } = await emaEnrollment.fillEnrollment(d);
    expect(salesmanCode, 'Salesman ID back-filled from Salesman Name').toBe(d.expectedSalesmanCode);
    expect(financials.amount, 'Amount = Group Amount').toBe(groupAmountPicked);
    // the plan's automatic discount: 2 % on the 2LAKH PLAN, 5 % on the 5 Lakh Plan
    // (14-11-2026) - a whole percentage of the amount; EMA_DISCOUNT_PCT pins it
    const discountPct = financials.amount ? (financials.discount / financials.amount) * 100 : 0;
    console.log(`EMA enrollment: ${d.plan} discount ${financials.discount} = ${discountPct.toFixed(2)} % of ${financials.amount}`);
    expect(Math.abs(discountPct - Math.round(discountPct)), 'Discount is a whole percentage of the Amount').toBeLessThan(0.01);
    if (process.env.EMA_DISCOUNT_PCT) expect(discountPct, `Discount = ${process.env.EMA_DISCOUNT_PCT}% of Amount`).toBeCloseTo(Number(process.env.EMA_DISCOUNT_PCT), 2);
    expect(financials.finalAmount, 'Final Amount = Amount - Discount').toBeCloseTo(financials.amount - financials.discount, 2);
    expect(financials.goldRate, 'Gold Rate').toBeGreaterThan(0);
    expect(financials.weight, 'Weight = Amount / Gold Rate').toBeCloseTo(financials.amount / financials.goldRate, 2);
    const before = await emaEnrollment.summaryCounts();
    expect(before.installments, 'INSTALLMENTS in the EMA Summary').toBeGreaterThan(0);
    expect(before.paid, 'PAID before the first collection').toBe(0);

    const { paid, rows } = await emaEnrollment.makePayment({ ...d.payment, what: 'EMA enrollment' });
    expect(paid, 'amount paid by Cash').toBeGreaterThan(0);
    expect(rows, 'Payment Modes grid').toHaveLength(1);
    expect(rows[0]).toMatch(/cash/i);

    const body = await emaEnrollment.submit(); // the Submit button (Save as Draft is a different button)
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    let memberNo = EmaEnrollmentPage.numberOf(body);
    console.log(`EMA enrollment saved - save body ${JSON.stringify(body).slice(0, 400)}`);
    if (!memberNo || !/[A-Z]/i.test(memberNo)) {
      // the save body carries only the id: the list's newest row names the member
      await emaEnrollment.open();
      await emaEnrollment.openTab('Enrollment');
      const row = emaEnrollment.gridRows.filter({ hasText: d.mobile }).filter({ hasText: d.customer.name }).first();
      await expect(row, 'enrollment row in the list').toBeVisible({ timeout: 60_000 });
      const cells = (await row.locator('td').allInnerTexts()).map((t) => t.trim());
      memberNo = cells.find((c) => /^[A-Z]{1,4}\d{2,}[A-Z]*$/.test(c)) || cells[1];
    }
    expect(memberNo, 'enrollment member number').toBeTruthy();
    state.writeState({ memberNo, plan: d.plan, groupAmount: groupAmountPicked, mobile: d.mobile, customer: `${d.customer.name} ${d.customer.code}`, enrollmentPaid: paid, installments: before.installments, collectionReceiptNo: null });
    console.log(`EMA enrollment saved: member ${memberNo} (customer ${d.customer.name} ${d.customer.code}, ${d.plan} ${groupAmountPicked}, paid ${paid})`);
    await emaEnrollment.verifyRowInList(memberNo, { which: 'Enrollment' });
  });

  test('TC-EMA-02 Kakkanad: EMA collection for the member (next installment, Cash) - Submit', async ({ loginPage, emaEnrollment }) => {
    test.setTimeout(600_000);
    const { memberNo, installments } = state.readState();
    expect(memberNo, 'run TC-EMA-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await emaEnrollment.open();
    await emaEnrollment.openTab('Collection');
    await emaEnrollment.openAddForm(emaEnrollment.memberNumberInput());

    const details = await emaEnrollment.fetchMember(memberNo);
    expect(details.memberName, 'Member Name fetched from the member number').toBeTruthy();
    expect(details.amount, 'installment Amount').toBeGreaterThan(0);
    const before = { ...(await emaEnrollment.summaryCounts()), paidSoFar: (await emaEnrollment.installmentHistory()).length };
    await emaEnrollment.openPaymentModesTab(); // back from EMA Details to the Payment Modes sub-tab

    const { paid, rows } = await emaEnrollment.makePayment({ ...DATA.collection.payment, what: 'EMA collection' });
    expect(paid, 'amount collected by Cash').toBeGreaterThan(0);
    expect(rows, 'Payment Modes grid').toHaveLength(1);
    expect(rows[0]).toMatch(/cash/i);

    const body = await emaEnrollment.submit();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const collectionReceiptNo = EmaEnrollmentPage.numberOf(body, ['receiptNo', 'collectionNo', 'docNo', 'voucherNo', 'voucherNumber']);
    state.writeState({ collectionReceiptNo, collectionPaid: paid, installmentNo: details.installmentNo });
    console.log(`EMA collection saved: member ${memberNo}, installment ${details.installmentNo || '?'} paid ${paid}${collectionReceiptNo ? ` (receipt ${collectionReceiptNo})` : ''}; summary before ${JSON.stringify(before)}`);

    // the installment is now Paid: the enrollment's summary / list counts it
    const after = await emaEnrollment.paidInstallments(memberNo, { installments });
    console.log(`EMA enrollment ${memberNo} after the collection: ${JSON.stringify(after)}`);
    expect(after.history.map((h) => h.receiptNo), 'collection receipt in the EMA Details history').toContain(collectionReceiptNo || after.history[after.history.length - 1].receiptNo);
    expect(after.paid, 'paid installments after the collection (enrollment payment + this collection)').toBe(before.paidSoFar + 1);
    expect(after.nextInstallmentNo, 'next due installment moved on').toBe(details.installmentNo + 1);
    if (installments) expect(after.remaining, 'REMAINING installments').toBe(installments - after.paid);
  });

  test('TC-EMA-03 Kakkanad: metal inward for the tag the member will buy', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { memberNo } = state.readState();
    expect(memberNo, 'run TC-EMA-01 first').toBeTruthy();
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

  test('TC-EMA-04 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-EMA-03 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-EMA-05 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-EMA-04 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({ stockIdentityType: DATA.barcode.stockIdentityType, vendor: DATA.inward.vendor, lotNo, grossWeight: DATA.barcode.grossWeight, pieces: 1, additionalCharges: true, descriptions: DATA.barcode.descriptions, counter: DATA.barcode.counter });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-EMA-06 Kakkanad: estimation (Sales Type EMA) for the new member, the tag added - Submit', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { memberNo, tagNo, mobile, installmentNo, installments } = state.readState();
    expect(memberNo && tagNo, 'run TC-EMA-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const d = DATA.enrollment;
    const e = DATA.estimation;

    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: d.customer.name, mobile: mobile || d.mobile, businessType: e.businessType });
    expect(await estimationSalesType.pickSalesType('EMA')).toMatch(/EMA/);
    const { entry } = await estimationSalesType.emaMembersOffered(memberNo);
    expect(entry, `member ${memberNo} offered in Select Member`).toBeTruthy();
    expect(entry.adpPlanName).toBe(d.plan);
    const member = await estimationSalesType.pickupEmaMember(memberNo);
    expect(member.setupGap, `qa must have closure types configured for ${d.plan}: ${member.setupGap}`).toBeFalsy();
    expect(member.row, `EMA Members row for ${memberNo} (toasts ${JSON.stringify(member.toasts)})`).toBeTruthy();
    expect(member.row).toContain(d.plan);
    if (installmentNo && installments) expect(member.row, `installments ${installmentNo} / ${installments}`).toMatch(new RegExp(`\\b${installmentNo}\\s*/\\s*${installments}\\b`));
    expect(member.tiles.emaAmount, 'EMA Amount tile = the member\'s available closure amount').toBeCloseTo(Number(entry.accountAvailableClosureAmountTran), 2);
    const closure = await estimationSalesType.pickMemberClosureTypeIfOffered(e.closureType);

    await estimationSalesType.pick('salesExecutiveID', e.salesExecutive, { search: true });
    await estimationSalesType.settle(1_500);
    const summary = await estimationSalesType.scanAndAddTag(tagNo);
    expect(summary.items, 'No. of Items after Add Item').toBeGreaterThanOrEqual(1);
    const tiles = await estimationSalesType.emaTiles();
    console.log(`EMA estimation: tiles after Add Item ${JSON.stringify(tiles)}; closure type "${closure}"`);

    const body = await estimationSalesType.submitEstimation();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo, emaAmount: tiles.emaAmount, estimationAmount: tiles.estimationAmount, needToPay: tiles.needToPay, closureType: closure });
    console.log(`Estimation saved: ${estimationNo} (Sales Type EMA, member ${memberNo} ${d.plan}, EMA ${tiles.emaAmount}, tag ${tagNo})`);
  });
});
