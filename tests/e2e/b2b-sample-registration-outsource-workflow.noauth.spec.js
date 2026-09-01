const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-b2b-samplereg-state.json');

/**
 * E2E WORKFLOW — B2B ORDER / SAMPLE REGISTRATION / OUTSOURCE / DELIVERY.
 *
 * Variant of the B2B sample chain where the order is created WITHOUT a
 * sample; the sample is registered afterwards on the Sample Registration
 * page (/sls/app-sample-setup) AGAINST the B2B order no (Sample Ref Type
 * "B2B Order" + RC No. typeahead). Downstream is the proven outsource
 * pipeline: Sample Issue → Sample Receipt → Sample Delivery, keyed by the
 * registered sample no. State: e2e-b2b-samplereg-state.json.
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
    grossWeight: 50,
  },
  registration: {
    itemType: 'Metal',
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

test.describe('B2B Sample Registration - Outsource - Workflow', () => {
  test('TC-B2B-SR-01 create the B2B order (no sample)', async ({ loginPage, b2bOrderBooking, page }) => {
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

    await b2bOrderBooking.fillItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
    });
    await b2bOrderBooking.attachFileViaAddFiles(DEMO_FILES.image1);
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
    console.log(`B2B order created: ${orderNo}`);
  });

  test('TC-B2B-SR-02 register a sample against the order (Sample Registration)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-SR-01 first').toBeTruthy();
    await login(loginPage, page);

    const sampleNo = await sampleWorkflow.registerSample({
      orderNo,
      itemType: DATA.registration.itemType,
      sample: DATA.registration.sample,
      image: DEMO_FILES.image2, // different from the order's image1
    });
    expect(sampleNo, 'registered sample number').toBeTruthy();
    state.writeState({ sampleNo });
    console.log(`Sample registered against ${orderNo}: ${sampleNo}`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SR-03 sample issue outsource (Procurement > Issue, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SR-02 first').toBeTruthy();
    await login(loginPage, page);

    const issueNo = await sampleWorkflow.createSampleIssueOutsource({
      sampleNo,
      itemType: DATA.issue.itemType,
      vendor: DATA.issue.vendor,
      submissionMethod: DATA.issue.submissionMethod,
      receivedFrom: DATA.issue.receivedFrom,
      contactNumber: DATA.issue.contactNumber,
      image: DEMO_FILES.image3, // different from the registration's image2
    });
    state.writeState({ issueNo });
    console.log(`Sample issued outsource (doc: ${issueNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SR-04 sample receipt (Repair page, Sample tab)', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SR-02 first').toBeTruthy();
    await login(loginPage, page);

    const receiptNo = await sampleWorkflow.sampleReceiptOutsource({
      sampleNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    state.writeState({ receiptNo });
    console.log(`Sample received back (doc: ${receiptNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-SR-05 sample delivery to the customer', async ({ loginPage, sampleWorkflow, page }) => {
    test.setTimeout(600_000);
    const { sampleNo } = state.readState();
    expect(sampleNo, 'run TC-B2B-SR-02 first').toBeTruthy();
    await login(loginPage, page);

    const deliveryNo = await sampleWorkflow.sampleDelivery({
      sampleNo,
      customer: DATA.delivery.customer,
      itemType: DATA.delivery.itemType,
      dispatchType: DATA.delivery.dispatchType,
      employee: DATA.delivery.employee,
    });
    state.writeState({ deliveryNo });
    console.log(`Sample delivered (doc: ${deliveryNo || 'keyed by sample no'})`);
    expect(sampleWorkflow.printPreviewError, 'print template preview').toBeFalsy();
  });
});
