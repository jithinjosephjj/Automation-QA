const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');
const { jobworkInwardUpToSubmit, numbersIn } = require('../../utils/inward-yes');

const state = makeState('e2e-b2b-order-inward-yes-state.json');

/**
 * E2E WORKFLOW — B2B ORDER / OUTSOURCE ISSUE / METAL INWARD "YES -> LOT" /
 * BARCODE GENERATION PAGE.
 *
 * Twin of b2b-order-outsource-lot-barcode-workflow with the lot created BY
 * THE INWARD'S OWN SUBMIT: "Process with Barcode or Lot?" is answered Yes
 * and the "Lot / Barcode" dialog's Lot option saves the inward and its lot
 * in one call. The tag is then generated on the Barcode Generation page
 * for that lot, exactly as in the sibling chain.
 *
 *   TC-B2B-OIY-01  B2B Order Booking (Making Type "Job Work", customer Luxurio, Tendulkar 91.60, 350 g)
 *   TC-B2B-OIY-02  Procurement Issue: the order as outsource job work (vendor RAJA)
 *   TC-B2B-OIY-03  jobwork-return Metal Inward, Yes -> Lot (Lot Employee Ubaid): inward + lot saved together
 *   TC-B2B-OIY-04  Barcode Generation page: tag for that lot (as user suja)
 *
 * Numbers chain through e2e-b2b-order-inward-yes-state.json
 * (orderNo -> jobWorkNo -> inwardVoucherNo + lotNo -> tagNo).
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

// VENDOR=<name> runs the chain against another vendor (substring match)
const VENDOR = process.env.VENDOR || 'RAJA';
// CUSTOMER=<name> overrides the B2B order's customer the same way (default Luxurio)
const CUSTOMER = process.env.CUSTOMER || 'Luxurio';

const DATA = {
  order: {
    purposeType: 'Order',
    customer: CUSTOMER,
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
    grossWeight: 350,
  },
  issue: { mode: 'Outsource', vendor: VENDOR, itemType: 'Metal' },
  lotEmployee: 'Ubaid',
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Kakkanad' }, // recording switches users here
    stockIdentityType: 'Jobwork Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
};

async function login(loginPage) {
  await loginPage.ensureLoggedIn();
}

test.describe('B2B Order - Outsource - Metal Inward Yes to Lot - Barcode - Workflow', () => {
  test('TC-B2B-OIY-01 create the B2B job work order', async ({ loginPage, b2bOrderBooking }) => {
    test.setTimeout(600_000);
    state.reset();
    await login(loginPage);

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
    // attach one demo image via the Add Files control
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
    console.log(`B2B job work order created: ${orderNo}`);
  });

  test('TC-B2B-OIY-02 issue the order as outsource job work (Procurement > Issue)', async ({ loginPage, production }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-B2B-OIY-01 first').toBeTruthy();
    await login(loginPage);

    const jobWorkNo = await production.createOutsourceJobWorkFromOrder({
      orderNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    expect(jobWorkNo, 'generated job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Outsource job work created: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-B2B-OIY-03 metal inward (jobwork return), Yes -> Lot: the inward and its lot are saved together', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-B2B-OIY-02 first').toBeTruthy();
    await login(loginPage);

    const article = await jobworkInwardUpToSubmit(metalInward, { vendor: DATA.issue.vendor, jobWorkNo });
    expect(article, 'article auto-filled from the job work item').toContain('Tendulkar');
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const result = await metalInward.submitWithPostProcess({ mode: 'Lot', lotEmployee: DATA.lotEmployee });
    expect(JSON.stringify(result.inward)).toMatch(/success/i);
    const found = numbersIn(result.all.map((x) => x.body));
    expect(found.inward, 'inward voucher number').toBeTruthy();
    console.log(`Inward ${found.inward} saved with Yes -> Lot; numbers in the saves: ${JSON.stringify(found)}`);
    expect(found.lots[0], `a lot must be generated with the inward (saves: ${JSON.stringify(result.all.map((x) => x.url))})`).toBeTruthy();
    state.writeState({ inwardVoucherNo: found.inward, lotNo: found.lots[0] });
    console.log(`Lot generated with the inward: ${found.lots[0]}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-B2B-OIY-04 generate barcode for the lot on the Barcode Generation page (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-B2B-OIY-03 first').toBeTruthy();

    // per the QA lead's recording this step runs as a DIFFERENT user
    await loginPage.ensureLoggedIn(DATA.barcode.user);

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.issue.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    // proof: the tag is listed under Generated Tags
    const tagNo = await barcodeGeneration.verifyGeneratedTag('Tendulkar');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });
});
