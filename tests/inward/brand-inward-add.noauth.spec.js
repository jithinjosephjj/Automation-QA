const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef } = require('../../utils/unique');

/**
 * TC-BRIN-001 — Brand Inward: add record end-to-end through the 2-step wizard
 * to Submit and report Preview.
 *
 * Scenario data (dictated by QA lead, 23-08-2026):
 *   Vendor:          RAJA          Purchase Type: Direct
 *   Cost Center:     Cochin        Sub Transaction Type: Invoice (default)
 *   Inward Type:     Stock         Reference Type: Combination
 *   Group Category:  Gold          Category: Ring
 *   Brand:           Amraa         Article: Tendulkar
 *   Purity:          91.60         Pieces: 10
 *   Gross Weight:    20            MRP: 100000
 *   Discount %:      5
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
test.describe('Brand Inward - add record', () => {
  test('TC-BRIN-001 add and submit a Stock/Direct/Invoice brand inward', async ({ loginPage, brandInward, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Procurement > Operations > Stock Inward, Brand tab ----
    await brandInward.open();
    await brandInward.selectTab();

    // ---- open the Add wizard ----
    await brandInward.openAddWizard();

    // Sub Transaction Type defaults to Invoice on the Brand wizard
    // (the default renders a beat after the wizard opens - poll for it)
    await expect
      .poll(async () => brandInward.selectValue('subTransactionType'), { timeout: 20_000 })
      .toBe('Invoice');

    // ---- step 1: Basic Details ----
    const invoiceNo = uniqueRef('BI-E2E');
    const picked = await brandInward.fillBasicDetails({
      vendor: 'RAJA',
      purchaseType: 'Direct',
      costCenter: 'Cochin',
      inwardType: 'Stock',
      purchaser: 'Ajin G',
      invoiceNo,
    });

    expect(picked.vendor).toContain('RAJA');
    expect(picked.purchaseType).toEqual(['Direct', 'Goods Receipt']);
    expect(picked.inwardType).toEqual(['Stock', 'Order']);
    expect(picked.costCenter).toContain('Cochin');

    // Credit Days auto-populates from the vendor; Due Date calculated + locked
    await expect(brandInward.creditDays).not.toHaveValue('');
    await expect(brandInward.dueDate).toBeDisabled();
    await expect(brandInward.dueDate).not.toHaveValue('');

    // ---- step 2: Brand Items & Summary ----
    await brandInward.nextBtn.click();
    await expect(brandInward.select('referenceType')).toBeVisible({ timeout: 30_000 });

    // Hierarchy is manual and mandatory on Brand (article does not back-fill)
    await brandInward.fillItem({
      referenceType: 'Combination',
      groupCategory: 'Gold',
      category: 'Ring',
      brand: 'Amraa',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 10,
      grossWeight: 20,
      mrp: 100000,
      discountPercent: 5,
    });

    // Pricing cascade: Amount = MRP x Pieces, then the discount and tax chain.
    // Rates are config-owned, so assert the relationships, not magnitudes.
    const amount = await brandInward.numberOf('Amount');
    expect(amount).toBeCloseTo(100000 * 10, 1);
    const discountAmount = await brandInward.numberOf('Discount Amount');
    expect(discountAmount).toBeCloseTo(amount * 0.05, 1);
    const taxable = await brandInward.numberOf('Taxable Value');
    expect(taxable).toBeCloseTo(amount - discountAmount, 1);
    const payable = await brandInward.numberOf('Payable Value');
    expect(payable).toBeCloseTo(taxable + (await brandInward.numberOf('Tax Collection')) + (await brandInward.numberOf('Additional Charges Value')), 1);
    expect(await brandInward.numberOf('Net Payable Value')).toBeCloseTo(payable - (await brandInward.numberOf('Tax Deduction')), 1);

    // ---- Add Item: the summary panel is the proof it was accepted ----
    // (a rejected Add Item just flags fields ng-invalid with no toast)
    await brandInward.addItemBtn.click();
    await expect
      .poll(async () => brandInward.summaryText(), { timeout: 20_000 })
      .toContain('No. of Pieces : 10');
    const summary = await brandInward.summaryText();
    expect(summary).toContain('Gross Weight : 20.000');
    expect(summary).toContain('Vendor Name : RAJA');

    // ---- Submit ----
    // Add Item clears the form for the next item; Submit lives on the
    // "Brand Items & Summary" step. Sometimes the wizard advances there on
    // its own, sometimes it stays on the form - advance manually if needed.
    if (!(await brandInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await brandInward.nextBtn.click();
    }
    await expect(brandInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const response = await brandInward.submit();
    expect(response).toBeTruthy();

    // Print dialog opens with the generated voucher number
    await expect(brandInward.printDialog).toBeVisible({ timeout: 60_000 });
    const voucherNo = await brandInward.voucherNumber();
    expect(voucherNo).not.toBe('');
    console.log(`Record created. Voucher number: ${voucherNo}, invoice no: ${invoiceNo}`);

    // ---- Preview the report (same as Metal Inward) ----
    const maybePopup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await brandInward.previewBtn.click();
    const popup = await maybePopup;
    const previewPage = popup || page;
    await previewPage.waitForLoadState('domcontentloaded');
    await previewPage.waitForTimeout(5_000);
    await previewPage.screenshot({ path: 'test-results/screens/tc-brin-001-report-preview.png', fullPage: true });

    const hasReportSurface = await previewPage
      .locator('embed, iframe, object, [class*=preview], [class*=report]')
      .first()
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    expect(popup !== null || hasReportSurface).toBe(true);

    console.log(`Report preview opened for voucher ${voucherNo}`);

    // ---- the saved record shows in the list view (data table on page load) ----
    await brandInward.verifyRowInList(voucherNo);
  });
});
