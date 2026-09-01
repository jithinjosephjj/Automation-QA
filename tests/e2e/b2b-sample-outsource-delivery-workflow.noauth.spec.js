const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-sample-delivery-state.json');

/**
 * E2E WORKFLOW — B2B SAMPLE / OUTSOURCE / RECEIPT / DELIVERY.
 *
 * Chain (QA lead recording, 31-08-2026): B2B Order Booking with a SAMPLE
 * (purpose type "Order" + the Add Sample sub-form describing the customer's
 * physical sample, manual Rate) → Sample Issue OUTSOURCE (Issue page,
 * Sample tab: vendor RAJA, submission "In Person") → Sample Receipt
 * (Repair page /prc/app-repair-setup, Sample tab: Outsource + vendor →
 * Submit Receipt) → Sample Delivery (/sls/app-sample-setup, Sample
 * Delivery tab: customer + dispatch "Our Employee" + employee → Submit).
 *
 * The order registers its sample under a SEPARATE sample no (e.g.
 * "QAF4VU") and every downstream grid keys rows by IT (delivery as
 * "<sampleNo>.1") - captured from the Sample Registration list right after
 * the order saves and persisted in e2e-b2b-sample-delivery-state.json.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  order: {
    purposeType: 'Order',
    customer: 'Luxurio',
    itemType: 'Metal',
    makingType: 'Job Work',
    supervisor: 'Abc',
    smCode: 'AJ10',
    orderGivenBy: 'JJ',
    contactNumber: '9896564523',
    deliveryNote: 'Urgent',
    referenceType: 'Combination',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.60',
    grossWeight: 54,
    sample: {
      article: 'Tendulkar',
      purity: '91.6',
      pieces: 1,
      grossWeight: 12,
      rate: 25000,
    },
  },
  issue: { vendor: 'RAJA', itemType: 'Metal', submissionMethod: 'In Person', receivedFrom: 'Raja', contactNumber: '6565455555' },
  delivery: { customer: 'Luxurio', itemType: 'Metal', dispatchType: 'Our Employee', employee: 'Sioniquser11' },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('B2B Sample - Outsource - Delivery - Workflow', () => {
  test('TC-B2B-SD-01 create the B2B order with a sample', async ({ loginPage, b2bOrderBooking, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
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

    await b2bOrderBooking.fillSampleItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
      // two DIFFERENT demo images: one on the main item's Add Files, one on
      // the Add Sample panel's own Add Files
      mainImage: DEMO_FILES.image1,
      sample: { ...DATA.order.sample, image: DEMO_FILES.image2 },
    });
    await b2bOrderBooking.addItemsAndVerify(1);

    if (!(await b2bOrderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await b2bOrderBooking.nextBtn.click();
      await b2bOrderBooking.waitForIdle();
    }
    await expect(b2bOrderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    // the sample order's Submit can raise a Yes/No confirmation - answer it
    // while the diagnostics submit is waiting for the save response
    const confirmer = b2bOrderBooking.confirmYesIfAsked();
    const { responses, diag } = await b2bOrderBooking.submitWithDiagnostics();
    await confirmer;
    const save = responses.find((r) => r.body);
    expect(save, `no save response; validation: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    const orderNo = save.body.data && save.body.data.receiptNo;
    expect(orderNo, 'generated sample order receipt no').toBeTruthy();
    state.writeState({ orderNo });
    console.log(`B2B sample order created: ${orderNo}`);

    // the sample registers under its OWN sample no (downstream grids key by
    // it, not by the order no) - capture it from the newest registration row
    const sampleNo = await sampleWorkflow.latestSampleNo();
    expect(sampleNo, 'registered sample number').toBeTruthy();
    state.writeState({ sampleNo });
    console.log(`Sample registered as: ${sampleNo}`);
  });

  test('TC-B2B-SD-02 sample issue outsource (Procurement > Issue, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SD-01 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await sampleWorkflow.createSampleIssueOutsource({
      sampleNo,
      itemType: DATA.issue.itemType,

      vendor: DATA.issue.vendor,
      submissionMethod: DATA.issue.submissionMethod,
      receivedFrom: DATA.issue.receivedFrom,
      contactNumber: DATA.issue.contactNumber,
    });
    state.writeState({ issueNo });
    console.log(`Sample issued outsource (doc: ${issueNo || 'keyed by order no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SD-03 sample receipt (Repair page, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SD-01 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await sampleWorkflow.sampleReceiptOutsource({
      sampleNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    state.writeState({ receiptNo });
    console.log(`Sample received back (doc: ${receiptNo || 'keyed by order no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SD-04 sample delivery to the customer', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SD-01 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await sampleWorkflow.sampleDelivery({
      sampleNo,
      customer: DATA.delivery.customer,
      itemType: DATA.delivery.itemType,
      dispatchType: DATA.delivery.dispatchType,
      employee: DATA.delivery.employee,
    });
    state.writeState({ deliveryNo });
    console.log(`Sample delivered (doc: ${deliveryNo || 'keyed by order no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
