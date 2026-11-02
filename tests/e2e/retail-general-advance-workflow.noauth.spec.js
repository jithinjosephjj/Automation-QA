const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { nextCustomerName, uniqueMobileNumber } = require('../../utils/customer-name');
const { DEMO_FILES } = require('../../utils/demo-files');
const sessionCache = require('../../utils/session-cache');
const { AdvanceRegistrationPage } = require('../../pages/AdvanceRegistrationPage');

const state = makeState('e2e-retail-general-advance-state.json');

/**
 * E2E WORKFLOW — CUSTOMER REGISTRATION -> ADVANCE REGISTRATION (General / Retail)
 * at the Kakkanad head office. Requested 02-11-2026 ("advance registration ->
 * advance type = general, business type = retail").
 *
 *   TC-ADV-01  Kakkanad, admin: CRM > Customer Registration - a new Individual RETAIL
 *              customer (SioniqCustomer<n>, dynamic mobile number) - the advance is
 *              collected from this customer (user 30-10-2026: retail customers come
 *              from customer registration)
 *   TC-ADV-02  Kakkanad, admin: Retail Operations > Operations > Registrations > Advance
 *              Registration: the customer, Advance Type General, Business Type Retail
 *              -> Advance Details: Sales Executive Chandu (code back-fills), Supervisor
 *              left empty, Advance Amount ₹5,000, Remarks -> Proceed to Payment (Payment
 *              Collection, Cash Test Mode, the full amount) -> Submit
 *              (OrderAdvanceRegistration/SaveGeneralAdvanceRegistration, receiptNo
 *              e.g. "ADV-004KK")
 *
 * A General advance has no estimation / order behind it, so the wizard is
 * "Step 1 Customer Details / Step 2 Advance Details" with no Entry Type and no
 * Fetch. Supervisor is optional on qa; an unapproved one (Abc) is rejected with
 * "Selected Supervisor is not in the approved list." (02-11-2026).
 *
 * The POS "+" only opens its form on a session that went through the login
 * FORM (counter validation) - TC-ADV-02 clears the cache and the live session.
 * Numbers chain through e2e-retail-general-advance-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const HEAD_OFFICE = 'Kakkanad';

const DATA = {
  customer: {
    kind: 'Individual',
    title: 'Mr.', // options carry the dot
    gender: 'Male',
    dob: '01/12/1996',
    document: { type: 'Aadhar Card', file: DEMO_FILES.image1 }, // one demo image + a dynamic 12-digit number
    address: {}, // zip code first (it cascades the rest); remaining fields fall back to the first option
  },
  advance: {
    businessType: 'Retail',
    salesExecutive: 'Chandu', // Kakkanad sales executive (QA lead 27-10-2026)
    supervisor: process.env.SUPERVISOR || '', // optional; only an APPROVED supervisor is accepted
    amount: Number(process.env.ADVANCE_AMOUNT || 5000),
    remarks: 'E2E general advance',
    paymentMode: 'Cash', // Payment Collection: the first cash mode ("Cash Test Mode" at Kakkanad), full amount
  },
};

/** POS steps: a FORM login (the replayed / live session lacks the POS counter binding). */
async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail General Advance Registration - Workflow', () => {
  test('TC-ADV-01 Kakkanad: register a retail customer (CRM > Customer Registration)', async ({ loginPage, customerRegistration }) => {
    test.setTimeout(600_000);
    state.reset(); // a new customer starts a new chain
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });

    await customerRegistration.open();
    await customerRegistration.openAddForm();

    const customerName = nextCustomerName();
    const customerMobile = uniqueMobileNumber();
    await customerRegistration.fillCustomer({
      ...DATA.customer,
      name: customerName,
      contactNumber: customerMobile,
      anniversary: businessDate(0).replace(/-/g, '/'),
      email: `qa${Date.now()}@example.com`,
      document: { ...DATA.customer.document, number: `5${String(Date.now()).slice(-11)}` },
    });
    const saved = await customerRegistration.submitCustomer();
    expect(saved, 'customer save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const customerCode = (saved.data && (saved.data.customerCode || saved.data.receiptNo || saved.data.customerID)) || '';
    state.writeState({ customerName, customerMobile, customerCode, advanceNo: null });
    console.log(`Retail customer registered: ${customerName} (mobile ${customerMobile}, code ${customerCode || '-'})`);
    expect(customerRegistration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-ADV-02 Kakkanad: advance registration (General, Retail) for the customer', async ({ loginPage, advanceRegistration, page }) => {
    test.setTimeout(600_000);
    const { customerName, customerMobile } = state.readState();
    expect(customerName, 'run TC-ADV-01 first').toBeTruthy();
    await freshPosLogin(loginPage, page);

    const body = await advanceRegistration.registerGeneralAdvance({ customer: customerName, ...DATA.advance });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const advanceNo = AdvanceRegistrationPage.numberOf(body);
    expect(advanceNo, `advance receipt number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ advanceNo });
    console.log(`General advance registered: ${advanceNo} (customer ${customerName}, mobile ${customerMobile}, ₹${DATA.advance.amount})`);
  });
});
