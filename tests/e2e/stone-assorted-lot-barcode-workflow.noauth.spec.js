const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-stone-assorted-lot-state.json');

/**
 * E2E WORKFLOW — STONE INWARD (not assorted) / STONE ASSORTING ISSUE /
 * STONE ASSORTING RECEIPT / LOT GENERATION / BARCODE.
 *
 * Chain: plain Stone Inward (WITHOUT the Assorted Stock tick) → Stone
 * Assorting Issue → Stone Assorting Receipt → Lot Generation (Item Type
 * "Stone" + From Transaction Type "Stone Assorting Receipt") → Barcode as
 * user suja. This is the assorting-cycle route to a lot; the direct route
 * (tick Assorted Stock on the inward) is TC-SLB.
 *
 * Document numbers persist in e2e-stone-assorted-lot-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  inward: {
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    item: {
      refType: 'Combination',
      stoneArticle: 'Jerald',
      entryMode: 'Without Tare',
      uom: 'Gram',
      noOfPcs: 5,
      grossWeight: 10,
      returnPercent: 5, // mandatory per the stone-inward guide
      // NO assortedStock - this chain assorts via the issue/receipt cycle
    },
  },
  assorted: { transactionType: 'Stone Inward', vendor: 'RAJA', employee: 'Sioniquser' },
  lot: { itemType: 'Stone', transactionType: 'Stone Assorting Receipt', employee: 'Ubaid', businessUnit: 'Cochin' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Cochin' }, // barcode runs as a different user
    itemType: 'Stone',
    stockIdentityType: 'Stock',
    grossWeight: 10,
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Stone Assorting - Lot - Barcode - Workflow', () => {
  test('TC-SAL-01 create the stone inward (stock, not assorted)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();

    const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, '');
    await stoneInward.fillBasicDetails({
      inwardType: DATA.inward.inwardType,
      purchaseType: DATA.inward.purchaseType,
      vendor: DATA.inward.vendor,
      invoiceNo,
      invoiceDate: businessDate(0).replace(/-/g, '/'),
    });
    await stoneInward.nextBtn.click();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });

    await stoneInward.fillItem(DATA.inward.item);
    await stoneInward.addItemBtn.click();
    await expect
      .poll(async () => stoneInward.summaryText(), { timeout: 20_000 })
      .toMatch(/Vendor Name\s*:\s*RAJA/);

    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.nextBtn.click();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await stoneInward.submit();
    expect(saved, 'stone inward save response').toBeTruthy();
    const inwardVoucherNo = await stoneInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Stone inward saved: ${inwardVoucherNo} (invoice ${invoiceNo})`);

    await stoneInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-sal-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await stoneInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-SAL-02 stone assorting issue from the inward', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SAL-01 first').toBeTruthy();
    await login(loginPage, page);

    const assortedIssueNo = await stoneAssortedWorkflow.assortedIssue({
      transactionType: DATA.assorted.transactionType,
      vendor: DATA.assorted.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.assorted.employee,
    });
    expect(assortedIssueNo, 'generated assorting issue number').toBeTruthy();
    state.writeState({ assortedIssueNo });
    console.log(`Stone assorting issued: ${assortedIssueNo}`);
  });

  test('TC-SAL-03 stone assorting receipt against the issue', async ({ loginPage, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedIssueNo } = state.readState();
    expect(assortedIssueNo, 'run TC-SAL-02 first').toBeTruthy();
    await login(loginPage, page);

    const assortedReceiptNo = await stoneAssortedWorkflow.assortedReceipt({
      issueNo: assortedIssueNo,
      employee: DATA.assorted.employee,
    });
    expect(assortedReceiptNo, 'generated assorting receipt number').toBeTruthy();
    state.writeState({ assortedReceiptNo });
    console.log(`Stone assorting received: ${assortedReceiptNo}`);
  });

  test('TC-SAL-04 generate a lot from the assorting receipt', async ({ loginPage, lotGeneration, stoneAssortedWorkflow, page }) => {
    test.setTimeout(600_000);
    const { assortedReceiptNo } = state.readState();
    expect(assortedReceiptNo, 'run TC-SAL-03 first').toBeTruthy();
    await login(loginPage, page);

    const lotNo = await lotGeneration.generateLot({
      itemType: DATA.lot.itemType,
      transactionType: DATA.lot.transactionType,
      vendor: DATA.inward.vendor,
      inwardNo: stoneAssortedWorkflow.docCore(assortedReceiptNo),
      employee: DATA.lot.employee,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
    expect(lotGeneration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SAL-05 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-SAL-04 first').toBeTruthy();

    await loginPage.open();
    await loginPage.login(DATA.barcode.user);
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    const saved = await barcodeGeneration.generateTag({
      itemType: DATA.barcode.itemType,
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    const tagNo = await barcodeGeneration.verifyGeneratedTag('Jerald');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });
});
