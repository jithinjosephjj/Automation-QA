const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-brand-lot-state.json');

/**
 * E2E WORKFLOW — BRAND INWARD / LOT GENERATION / BARCODE.
 *
 * Chain: Brand Inward (stock/Direct/Invoice, vendor RAJA, brand Amraa -
 * the TC-BRIN-001 recipe) → Lot Generation (Item Type "Brand" + From
 * Transaction Type "Brand Inward") → Barcode as user suja (Item Type
 * "Brand", Stock Identity "Stock").
 *
 * Document numbers persist in e2e-brand-lot-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  inward: {
    vendor: 'RAJA',
    purchaseType: 'Direct',
    costCenter: 'Cochin',
    inwardType: 'Stock',
    purchaser: 'Ajin G',
    item: {
      referenceType: 'Combination',
      groupCategory: 'Gold',
      category: 'Ring',
      brand: 'Amraa',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 10,
      grossWeight: 20,
      mrp: 90000, // inward amount caps at 950000 (Exceeds max) - keep MRP x pcs under it
      // NO discount: the LOT's amount (MRP x pcs) is capped at the inward's
      // TAXABLE value, so any inward discount blocks Add To Lot
      // ("Exceeds max" flag on the lot panel)
      discountPercent: 0,
    },
  },
  lot: { itemType: 'Brand', transactionType: 'Brand Inward', employee: 'Ubaid', businessUnit: 'Cochin' },
  barcode: {
    user: { user: 'suja', pwd: '123', bu: 'Cochin' }, // barcode runs as a different user
    itemType: 'Brand',
    stockIdentityType: 'Stock',
    grossWeight: 10, // within the inward's 20g
    descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Brand Inward - Lot - Barcode - Workflow', () => {
  test('TC-BLB-01 create the brand inward (stock)', async ({ loginPage, brandInward, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await brandInward.open();
    await brandInward.selectTab();
    await brandInward.openAddWizard();

    // Sub Transaction Type defaults to Invoice on the Brand wizard
    await expect
      .poll(async () => brandInward.selectValue('subTransactionType'), { timeout: 20_000 })
      .toBe('Invoice');

    await brandInward.fillBasicDetails({
      vendor: DATA.inward.vendor,
      purchaseType: DATA.inward.purchaseType,
      costCenter: DATA.inward.costCenter,
      inwardType: DATA.inward.inwardType,
      purchaser: DATA.inward.purchaser,
      invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    });
    await brandInward.nextBtn.click();
    await expect(brandInward.select('referenceType')).toBeVisible({ timeout: 30_000 });

    await brandInward.fillItem(DATA.inward.item);
    // the summary panel is the Add Item proof (a rejected Add Item just
    // flags fields ng-invalid with no toast)
    await brandInward.addItemBtn.click();
    await expect
      .poll(async () => brandInward.summaryText(), { timeout: 20_000 })
      .toContain(`No. of Pieces : ${DATA.inward.item.noOfPcs}`);

    // Submit lives on the summary step - advance manually when the wizard
    // stays on the cleared item form
    if (!(await brandInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await brandInward.nextBtn.click();
    }
    await expect(brandInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const saved = await brandInward.submit();
    expect(saved, 'brand inward save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await brandInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo });
    console.log(`Brand inward saved: ${inwardVoucherNo}`);

    await brandInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-blb-01-print-preview.png' });
    await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await brandInward.verifyRowInList(inwardVoucherNo);
  });

  test('TC-BLB-02 generate a lot from the brand inward', async ({ loginPage, lotGeneration, page }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-BLB-01 first').toBeTruthy();
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

  test('TC-BLB-03 generate barcode for the lot (as suja)', async ({ loginPage, barcodeGeneration, page }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-BLB-02 first').toBeTruthy();

    await loginPage.open();
    await loginPage.login(DATA.barcode.user);
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    const saved = await barcodeGeneration.generateTag({
      itemType: DATA.barcode.itemType,
      stockIdentityType: DATA.barcode.stockIdentityType,
      vendor: DATA.inward.vendor,
      lotNo,
      brand: DATA.inward.item.brand, // Brand Name is mandatory for brand tags
      amount: DATA.inward.item.mrp, // so is the Pricing Amount (1 pc x MRP)
      grossWeight: DATA.barcode.grossWeight,
      descriptions: DATA.barcode.descriptions,
    });
    expect(saved, 'barcode save response').toBeTruthy();
    expect(JSON.stringify(saved)).toMatch(/success/i);

    const tagNo = await barcodeGeneration.verifyGeneratedTag('Tendulkar');
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });
});
