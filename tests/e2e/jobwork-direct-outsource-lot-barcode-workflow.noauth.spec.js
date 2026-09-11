const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-jwd-outsource-lot-state.json');

/**
 * E2E WORKFLOW — JOB WORK (DIRECT) / OUTSOURCE / METAL INWARD / LOT /
 * BARCODE.
 *
 * Chain: a DIRECT OUTSOURCE job work (no order behind it - Issue > JobWork
 * Issue wizard, Generation Type "Direct" + Mode "Outsource" + vendor RAJA)
 * → Metal Inward receives the goods back (Sub Transaction Type "Jobwork" +
 * Inward Type "Direct") → Lot Generation from the inward → Barcode
 * Generation for the lot (as user "suja", like the order-based chain).
 *
 * Document numbers chain through e2e-jwd-outsource-lot-state.json
 * (jobWorkNo → inwardVoucherNo → lotNo → tagNo). Twin of
 * order-outsource-lot-barcode-workflow - only the job work's origin
 * differs (Direct wizard vs pending-order grid).
 *
 * APPROVAL NOTE (QA lead, 11-09-2026): the Jobwork+Stock inward and its lot
 * are subject to a VALUE-BASED approval workflow - above the threshold they
 * save in "Created" status and must be approved from the MOBILE APPLICATION
 * before the next step sees them (observed at 350g / taxable 208050). At
 * this spec's 60g the approval condition auto-passes, so the chain runs
 * unattended. Keep the weight below the approval threshold, or run staged
 * with mobile approvals after TC-02 and TC-03.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  jobWork: {
    vendor: 'RAJA',
    itemType: 'Metal',
    orderType: 'Stock',
    makingType: 'Regular',
    smCode: 'AJ10',
    deliveryNote: 'Urgent',
    item: { referenceType: 'Combination', groupCategory: 'Gold', category: 'Ring', article: 'Tendulkar', purity: '91.60', pieceWeight: 60 },
  },
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

test.describe('Job Work Direct - Outsource - Lot - Barcode - Workflow', () => {
  test('TC-JW-DOL-01 create the DIRECT outsource job work', async ({ loginPage, production, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    const jobWorkNo = await production.createDirectOutsourceJobWork({
      ...DATA.jobWork,
      deliveryDate: businessDate(30).replace(/-/g, '/'),
    });
    expect(jobWorkNo, 'generated direct outsource job work number').toBeTruthy();
    state.writeState({ jobWorkNo });
    console.log(`Direct outsource job work created: ${jobWorkNo}`);
    expect(production.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-JW-DOL-02 metal inward receives the goods back (jobwork return, Direct)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    const { jobWorkNo } = state.readState();
    expect(jobWorkNo, 'run TC-JW-DOL-01 first').toBeTruthy();
    await login(loginPage, page);

    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillJobworkBasicDetails({
      businessUnit: 'Cochin',
      vendor: DATA.jobWork.vendor,
      inwardType: 'Order', // QA lead 11-09-2026: direct jobwork returns under "Order"
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();

    // Inward Type "Order" shows the jobwork item picker: one pick fills the
    // whole item form from the issued job work
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

    await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-jw-dol-02-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await metalInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-JW-DOL-03 generate a lot from the inward', async ({ loginPage, lotGeneration, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-JW-DOL-02 first').toBeTruthy();
    await login(loginPage, page);

    const lotNo = await lotGeneration.generateLot({
      vendor: DATA.jobWork.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
    expect(lotGeneration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-JW-DOL-04 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-JW-DOL-03 first').toBeTruthy();

    // per the QA lead's recording this step runs as a DIFFERENT user
    await loginPage.open();
    await loginPage.login(DATA.barcode.user);
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    const saved = await barcodeGeneration.generateTag({
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.jobWork.vendor,
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
