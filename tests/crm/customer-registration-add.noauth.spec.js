const { test, expect } = require('../../fixtures/test-fixtures');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');
// Sequential all-alpha customer names (SioniqCustomerone, ...two, ...) from
// the persisted customer-counter.json - shared with the retail invoice chain
const { nextCustomerName, uniqueMobileNumber } = require('../../utils/customer-name');

/**
 * TC-CRM-CUST-01 — Customer Registration: add an Individual customer through
 * CRM > Operations > Customer Registration (/crm/customer-list) to Submit,
 * verified by the save response and the list view.
 *
 * Per the add-spec checklist: retrying picks, unique per-run data, verified
 * save (throws with ng-invalid diagnostics on a silent block), list verify.
 * The mandatory-field set is discovered from the first run's diagnostics.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
test.describe('Customer Registration - add record', () => {
  test('TC-CRM-CUST-01 add an Individual customer', async ({ loginPage, customerRegistration, page }) => {
    test.setTimeout(420_000);

    await loginPage.ensureLoggedIn();

    await customerRegistration.open();
    await customerRegistration.openAddForm();

    // sequential all-alpha name (SioniqCustomerone, ...two, ...) + a dynamic
    // 10-digit mobile number (duplicate contacts are blocked)
    const name = nextCustomerName();
    const contactNumber = uniqueMobileNumber();

    await customerRegistration.fillCustomer({
      kind: 'Individual',
      title: 'Mr.', // options carry the dot
      name,
      contactNumber,
      gender: 'Male',
      dob: '01/12/1996',
      anniversary: businessDate(0).replace(/-/g, '/'),
      email: `qa${Date.now()}@example.com`,
      document: { type: 'Aadhar Card', number: `5${String(Date.now()).slice(-11)}`, file: DEMO_FILES.image1 }, // one demo image + a 12-digit number
      // Communication Address: zip code first (it cascades the rest);
      // remaining fields fall back to the first available option
      address: {},
    });

    const saved = await customerRegistration.submitCustomer();
    expect(saved, 'customer save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const doc = (saved.data && (saved.data.customerCode || saved.data.receiptNo || saved.data.customerID)) || name;
    console.log(`Customer registered: ${JSON.stringify(saved.data || {}).slice(0, 160)}`);

    expect(customerRegistration.printPreviewError, 'print template preview').toBeFalsy();

    // the record appears in the customer list (match by the unique name)
    await customerRegistration.verifyRowInList(name).catch(async () => {
      // some lists key by code/contact rather than name - try the contact
      await customerRegistration.verifyRowInList(contactNumber);
    });
    expect(doc, 'customer identifier').toBeTruthy();
  });
});
