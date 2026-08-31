const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-sample-state.json');

/**
 * E2E WORKFLOW — B2B SAMPLE ORDER / INHOUSE.
 *
 * Chain: B2B Order Booking (Sample) → Sample Issue inhouse (Procurement >
 * Operations > Issue, "Sample" tab) → Job Assignment (sample) → Worker
 * Issue/Receipt (sample) → Job Finalize (Generate Barcode).
 *
 * Steps come from the QA lead's recording (received 31-08-2026).
 *
 * BLOCKED (QA lead, 31-08-2026): an app bug in Worker Issue / Receipt for
 * the sample flow - implementation resumes once dev fixes it. Until then
 * every step stays fixme. Document numbers persist in
 * e2e-b2b-sample-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  order: {
    // TENTATIVE until the recording arrives: TC-B2B-001 data with the
    // Sample purpose type.
    purposeType: 'Sample',
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
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function rowKey() {
  const s = state.readState();
  return s.sampleIssueNo || s.orderNo;
}

test.describe('B2B Sample - Inhouse - Workflow', () => {
  test('TC-B2B-SMP-01 create the B2B sample order', async ({ loginPage, b2bOrderBooking, page }) => {
    test.setTimeout(600_000);
    test.fixme(true, 'Awaiting the QA lead recording (B2B order with Sample)');
    // Will reuse the proven B2B create flow with the Sample purpose type and
    // write state.orderNo.
  });

  test('TC-B2B-SMP-02 sample issue inhouse (Procurement > Issue, Sample tab)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    test.fixme(true, 'Awaiting the QA lead recording (Sample tab of the Issue page)');
    // Will consume state.orderNo -> write state.sampleIssueNo.
  });

  test('TC-B2B-SMP-03 job assignment (sample)', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    test.fixme(true, 'Awaiting the QA lead recording (assignment source/generation type for samples)');
  });

  test('TC-B2B-SMP-04 worker issue and receipt (sample)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    test.fixme(true, 'Awaiting the QA lead recording (worker issue/receipt with the sample production source)');
  });

  test('TC-B2B-SMP-05 finalize job and generate barcode', async ({ loginPage, production, page }) => {
    test.setTimeout(420_000);
    test.fixme(true, 'Awaiting the QA lead recording (finalize + barcode for the sample job)');
  });
});
