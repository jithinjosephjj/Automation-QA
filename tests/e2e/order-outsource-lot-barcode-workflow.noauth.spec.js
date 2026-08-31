const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

const state = makeState('e2e-order-lot-state.json');

/**
 * E2E WORKFLOW — ORDER / OUTSOURCE / LOT / BARCODE.
 *
 * Chain: Stock Order Booking → Procurement Issue (OUTSOURCE job work from
 * the order, vendor RAJA) → Metal Inward (jobwork return: Sub Transaction
 * Type "Jobwork" + Inward Type "Order") → Lot Generation → Barcode
 * (runs as user "suja" per the QA lead's recording of 31-08-2026).
 *
 * Document numbers chain through e2e-order-lot-state.json
 * (orderNo → jobWorkNo → inwardVoucherNo → lotNo → tagNo).
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  order: {
    itemType: 'Metal',
    supervisor: 'Abc',
    smCode: 'AJ10',
    deliveryNote: 'Regular',
    referenceType: 'Combination',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.60',
    grossWeight: 350,
  },
  issue: { mode: 'Outsource', vendor: 'RAJA', itemType: 'Metal' },
  lot: { employee: 'Ubaid', businessUnit: 'Cochin' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Cochin' }, // recording switches users here
    stockIdentityType: 'Jobwork Stock',
    grossWeight: 50,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Order - Outsource - Lot - Barcode - Workflow', () => {
  test('TC-OLG-01 create the stock order booking', async ({ loginPage, orderBooking, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await orderBooking.open();
    await orderBooking.openAddWizard();
    await orderBooking.fillOrderDetails({
      itemType: DATA.order.itemType,
      supervisor: DATA.order.supervisor,
      smCode: DATA.order.smCode,
      deliveryNote: DATA.order.deliveryNote,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    await expect
      .poll(async () => orderBooking.selectValue('salesExecutive'), { timeout: 20_000 })
      .toBe('Ajin G');

    await orderBooking.fillItem({
      referenceType: DATA.order.referenceType,
      groupCategory: DATA.order.groupCategory,
      category: DATA.order.category,
      article: DATA.order.article,
      purity: DATA.order.purity,
      grossWeight: DATA.order.grossWeight,
    });
    await orderBooking.attachFileViaAddFiles(DEMO_FILES.image1);
    await orderBooking.addItemsAndVerify(1);

    if (!(await orderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await orderBooking.nextBtn.click();
      await orderBooking.waitForIdle();
    }
    await expect(orderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    const { responses, diag } = await orderBooking.submitWithDiagnostics();
    const save = responses.find((r) => r.body);
    expect(save, `no save response; validation: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    const orderNo = save.body.data && save.body.data.receiptNo;
    expect(orderNo, 'generated order receipt no').toBeTruthy();
    state.writeState({ orderNo });
    console.log(`Order booking created: ${orderNo}`);
  });

  test('TC-OLG-02 issue the order as outsource job work (Procurement > Issue)', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    const { orderNo } = state.readState();
    expect(orderNo, 'run TC-OLG-01 first').toBeTruthy();
    await login(loginPage, page);

    const jobWorkNo = await production.createOutsourceJobWorkFromOrder({
      orderNo,
      vendor: DATA.issue.vendor,
      itemType: DATA.issue.itemType,
    });
    expect(jobWorkNo, 'generated job work number (PP## series)').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Outsource job work created: ${jobWorkNo}`);
  });

  test('TC-OLG-03 metal inward receives the goods back (jobwork return)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-OLG-02 first').toBeTruthy();
    await login(loginPage, page);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillJobworkBasicDetails({
      businessUnit: 'Cochin',
      vendor: DATA.issue.vendor,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    // one pick fills the whole item form from the issued order
    const article = await metalInward.addJobworkItem(`${jobWorkNo}.001`);
    expect(article, 'article auto-filled from the job work item').toContain('Tendulkar');

    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: 'Tendulkar' })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit();
    expect(saved, 'metal inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);

    // close the post-save Print dialog, then prove the record reached the list
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-OLG-04 generate a lot from the inward', async ({ loginPage, lotGeneration, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-OLG-03 first').toBeTruthy();
    await login(loginPage, page);

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.issue.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-OLG-05 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-OLG-04 first').toBeTruthy();

    // per the QA lead's recording this step runs as a DIFFERENT user
    await loginPage.open();
    await loginPage.login(DATA.barcode.user);
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

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
