const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-stone-lot-state.json');

/**
 * E2E WORKFLOW — STONE INWARD / LOT GENERATION / BARCODE.
 *
 * Chain (QA lead, 04-09-2026): Stone Inward with the ASSORTED STOCK
 * checkbox ticked → Lot Generation → Barcode as user suja (Item Type
 * "Stone", Stock Identity "Stock").
 *
 * DOMAIN GATE: for Item Type "Stone" the lot's From Transaction Type
 * offers ONLY [CertificationReceipt, Stone Assorting Receipt] - a PLAIN
 * stone inward cannot be lotted. Ticking Assorted Stock on the inward
 * makes it lot-eligible directly (no assorting issue/receipt cycle).
 *
 * Document numbers persist in e2e-stone-lot-state.json.
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
      assortedStock: true, // lot eligibility gate (QA lead 04-09-2026)
    },
  },
  // From Transaction Type "Stone Inward" appears for ASSORTED inwards
  // (QA lead 04-09-2026); plain stone inwards only ever route via the
  // assorting/certification receipts
  lot: { itemType: 'Stone', transactionType: 'Stone Inward', employee: 'Ubaid', businessUnit: 'Cochin' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Cochin' }, // barcode runs as a different user
    itemType: 'Stone',
    stockIdentityType: 'Stock',
    grossWeight: 10, // the full 10g lot
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Stone Inward - Lot - Barcode - Workflow', () => {
  test('TC-SLB-01 create the stone inward (stock)', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await stoneInward.open();
    await stoneInward.selectTab();
    await stoneInward.openAddWizard();

    // the Stone invoice field strips separators - alphanumeric-only ref
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

    await stoneInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-slb-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await stoneInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-SLB-02 generate a lot from the assorted inward', async ({ loginPage, lotGeneration, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SLB-01 first').toBeTruthy();
    await login(loginPage, page);

    const lotNo = await lotGeneration.generateLot({
      itemType: DATA.lot.itemType,
      transactionType: DATA.lot.transactionType,
      vendor: DATA.inward.vendor,
      inwardNo: inwardVoucherNo,
      employee: DATA.lot.employee,
      businessUnit: DATA.lot.businessUnit,
    });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
    expect(lotGeneration.printPreviewError, 'print template preview').toBeFalsy();
  });

  test('TC-SLB-03 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-SLB-02 first').toBeTruthy();

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
