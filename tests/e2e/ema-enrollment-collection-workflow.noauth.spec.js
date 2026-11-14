const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { EmaEnrollmentPage } = require('../../pages/EmaEnrollmentPage');

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
 *
 * Numbers chain through e2e-ema-enrollment-state.json.
 */

const HEAD_OFFICE = 'Kakkanad';

const DATA = {
  enrollment: {
    mobile: process.env.EMA_MOBILE || '1234567890',
    customer: { name: process.env.EMA_CUSTOMER || 'Anu', code: process.env.EMA_CUSTOMER_CODE || 'aa11' }, // option "Anu aa11"
    planType: 'Weight-Based Plan',
    plan: '2LAKH PLAN',
    groupAmount: 100000,
    salesman: 'Chandu',
    expectedSalesmanCode: '2',
    discountPct: 2, // "Auto - 2% plan discount"
    payment: { mode: 'Cash' }, // Kakkanad offers "Cash Test Mode" / "Cash Test Mode 2", no plain Cash
  },
  collection: {
    payment: { mode: 'Cash' },
  },
};

test.describe('EMA Enrollment - EMA Collection - Workflow', () => {
  test('TC-EMA-01 Kakkanad: EMA enrollment (Weight-Based 2LAKH PLAN, 100000, Cash) - Submit', async ({ loginPage, emaEnrollment, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const d = DATA.enrollment;

    await emaEnrollment.open();
    await emaEnrollment.openTab('Enrollment');
    await emaEnrollment.openAddForm(emaEnrollment.select('customerID'));

    const { salesmanCode, financials } = await emaEnrollment.fillEnrollment(d);
    expect(salesmanCode, 'Salesman ID back-filled from Salesman Name').toBe(d.expectedSalesmanCode);
    expect(financials.amount, 'Amount = Group Amount').toBe(d.groupAmount);
    expect(financials.discount, `Discount = ${d.discountPct}% of Amount`).toBeCloseTo(d.groupAmount * d.discountPct / 100, 2);
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
    state.writeState({ memberNo, mobile: d.mobile, customer: `${d.customer.name} ${d.customer.code}`, enrollmentPaid: paid, installments: before.installments, collectionReceiptNo: null });
    console.log(`EMA enrollment saved: member ${memberNo} (customer ${d.customer.name} ${d.customer.code}, ${d.plan} ${d.groupAmount}, paid ${paid})`);
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
});
