const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-repair-outsource-state.json');

/**
 * E2E WORKFLOW — REPAIR REGISTRATION / OUTSOURCE / RECEIPT / DELIVERY.
 *
 * Chain (QA lead recording, 02-09-2026): Repair Registration (customer
 * Luxurio, Ring soldering, item with Expec Add/Loss weights per the repair
 * wastage config) → Repair Issue OUTSOURCE (Issue page Repair tab, vendor
 * Sulthana Jewells, grid keyed "<repairNo>.1") → Repair Receipt (Repair
 * page, Outsource + Invoice + vendor, repair-no item picks + Add) →
 * Repair Delivery (customer Luxurio, row keyed "<repairNo>.1").
 *
 * The REP-... repair number is the chain's thread, persisted in
 * e2e-b2b-repair-outsource-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  registration: {
    customer: 'Luxurio',
    smCode: 'AJ10',
    referrer: 'Abc',
    itemSource: 'Customer Item',
    repairType: 'Ring soldering',
    description: 'repair automation',
    item: {
      groupCategory: 'Gold',
      category: 'Ring',
      article: 'Tendulkar',
      purity: '91.6',
      expectedAddWeight: 5,
      expectedLossWeight: 5,
      pieces: 1,
      grossWeight: 20,
    },
  },
  issue: { vendor: 'Sulthana Jewells', submissionMethod: 'In Person', givenBy: 'JJ', contactNumber: '5545654587' },
  receipt: { subTransactionType: 'Invoice' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('B2B Repair - Outsource - Delivery - Workflow', () => {
  test('TC-B2B-RPO-01 register the repair for the customer', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const repairNo = await repairWorkflow.registerRepair({
      customer: DATA.registration.customer,
      smCode: DATA.registration.smCode,
      referrer: DATA.registration.referrer,
      itemSource: DATA.registration.itemSource,
      repairType: DATA.registration.repairType,
      deliveryDate: businessDate(15).replace(/-/g, '/'),
      description: DATA.registration.description,
      item: DATA.registration.item,
      image: DEMO_FILES.image1, // Add Files on the registration item step
    });
    expect(repairNo, 'registered repair number (REP-... series)').toBeTruthy();
    state.writeState({ repairNo });
    console.log(`Repair registered: ${repairNo}`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPO-02 repair issue outsource (Procurement > Issue, Repair tab)', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPO-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await repairWorkflow.repairIssueOutsource({
      repairNo,
      vendor: DATA.issue.vendor,
      submissionMethod: DATA.issue.submissionMethod,
      givenBy: DATA.issue.givenBy,
      contactNumber: DATA.issue.contactNumber,
    });
    state.writeState({ issueNo });
    console.log(`Repair issued outsource (doc: ${issueNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPO-03 repair receipt (Repair page, Outsource + Invoice)', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPO-01 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await repairWorkflow.repairReceiptOutsource({
      repairNo,
      vendor: DATA.issue.vendor,
      subTransactionType: DATA.receipt.subTransactionType,
    });
    state.writeState({ receiptNo });
    console.log(`Repair received back (doc: ${receiptNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-RPO-04 repair delivery to the customer', async ({ loginPage, repairWorkflow, page }) => {
    test.setTimeout(600_000);
    const { repairNo } = state.readState();
    expect(repairNo, 'run TC-B2B-RPO-01 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await repairWorkflow.repairDelivery({
      customer: DATA.registration.customer,
      repairNo,
    });
    state.writeState({ deliveryNo });
    console.log(`Repair delivered (doc: ${deliveryNo || 'keyed by repair no'})`);
    expect(repairWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
