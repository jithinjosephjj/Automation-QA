const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef, businessDate } = require('../../utils/unique');

/**
 * TC-E2E-001 — Stone Inward: Stock + Direct without Tare, add record
 * end-to-end through the 2-step wizard to Submit and report Preview.
 *
 * Scenario data (dictated by QA lead, 23-08-2026):
 *   Inward Type:    Stock         Purchase Type: Direct
 *   Vendor:         RAJA          Invoice Date: any date (mandatory)
 *   Reference Type: Combination   Stone Article: Jerald (typed search;
 *                                 back-fills Jerald / Roya Stone / Red Roya Stone)
 *   Weight Entry:   Without Tare Weight    UOM: Gram
 *   Pieces:         5             Gross Weight: 50
 *   Discount %:     2             Return %: 10 (mandatory per guide)
 *   Assorted Stock: left at its default
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
test.describe('Stone Inward - add record', () => {
  test('TC-E2E-001 add and submit a Stock/Direct stone inward without tare', async ({ loginPage, stoneInward, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Step 1 of TC: Stock Inward, Stone tab ----
    await stoneInward.open();
    await stoneInward.selectTab();

    // ---- Step 2: open the Add wizard ----
    await stoneInward.openAddWizard();

    // ---- Steps 3-11: Basic Details ----
    // The Stone invoice field strips separators, so the ref is alphanumeric.
    const invoiceNo = uniqueRef('SIE2E').replace(/[^A-Za-z0-9]/g, '');
    const picked = await stoneInward.fillBasicDetails({
      inwardType: 'Stock',
      purchaseType: 'Direct',
      vendor: 'RAJA',
      invoiceNo,
      invoiceDate: businessDate().replace(/-/g, '/'), // DD/MM/YYYY
    });

    // Dropdown option-set verifications from the test case (steps 3-4)
    expect(picked.inwardType).toEqual(['Stock', 'Order']);
    expect(picked.purchaseType).toEqual(['Direct', 'Goods Receipt']);
    expect(picked.vendor).toContain('RAJA');

    // Step 10: Credit Days pre-fills from the vendor master
    await expect
      .poll(async () => stoneInward.numberOf('Credit Days'), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The invoice number survived exactly (nothing stripped from a clean ref)
    expect(await stoneInward.inputByLabel('Invoice Number').inputValue()).toBe(invoiceNo);

    // ---- Step 12: Next -> Build Items & Submit ----
    await stoneInward.nextBtn.click();
    await expect(stoneInward.select('refType')).toBeVisible({ timeout: 30_000 });

    // ---- Steps 13-30: item entry ----
    await stoneInward.fillItem({
      refType: 'Combination',
      stoneArticle: 'Jerald',
      entryMode: 'Without Tare',
      uom: 'Gram',
      noOfPcs: 5,
      grossWeight: 50,
      discountPercent: 2,
      returnPercent: 10,
    });

    // Step 14-16: article search back-filled the hierarchy
    expect(await stoneInward.selectValue('stone')).toBe('Jerald');
    expect(await stoneInward.selectValue('stoneCategory')).not.toBe('');
    expect(await stoneInward.selectValue('stoneSubCategory')).not.toBe('');

    // Step 21: without tare, Net Weight = Gross Weight, read-only
    expect(await stoneInward.numberOf('Stone Net Weight')).toBeCloseTo(50, 3);

    // Steps 22-24: rate config drives Rate UOM (auto + disabled) and Rate;
    // Stone Amount = rate weight x rate. All config-owned - assert the
    // relationship, not magnitudes.
    const rate = await stoneInward.numberOf('Rate');
    expect(rate).toBeGreaterThan(0);
    const rateUom = await stoneInward.selectValue('rateUom');
    expect(rateUom).not.toBe('');
    // When rate UOM differs from the stone UOM the converted weight shows in
    // "Rate Stone Weight" (1 carat = 0.2 g); when equal it hides and the net
    // weight is the rate weight.
    const rateWeight = (await stoneInward.numberOf('Rate Stone Weight')) || 50;
    const stoneAmount = await stoneInward.numberOf('Stone Amount');
    expect(stoneAmount).toBeCloseTo(rateWeight * rate, 1);

    // ---- Step 31: Add Items ----
    await stoneInward.addItemBtn.click();
    // (the Stone summary prints "Vendor Name :RAJA" - colon spacing varies per tab)
    await expect
      .poll(async () => stoneInward.summaryText(), { timeout: 20_000 })
      .toMatch(/Vendor Name\s*:\s*RAJA/);
    const summary = await stoneInward.summaryText();
    expect(summary).toContain('Stone Gross Weight : 50.000');
    expect(summary).toContain('Stone Net Weight : 50.000');

    // ---- Step 34: Submit ----
    if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await stoneInward.nextBtn.click();
    }
    await expect(stoneInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const response = await stoneInward.submit();
    expect(response).toBeTruthy();

    // Print dialog opens with the generated receipt / voucher number
    await expect(stoneInward.printDialog).toBeVisible({ timeout: 60_000 });
    const voucherNo = await stoneInward.voucherNumber();
    expect(voucherNo).not.toBe('');
    console.log(`Record created. Voucher number: ${voucherNo}, invoice no: ${invoiceNo}`);

    // ---- Preview the report (same as Metal / Brand) ----
    const maybePopup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await stoneInward.previewBtn.click();
    const popup = await maybePopup;
    const previewPage = popup || page;
    await previewPage.waitForLoadState('domcontentloaded');
    await previewPage.waitForTimeout(5_000);
    await previewPage.screenshot({ path: 'test-results/screens/tc-e2e-001-stone-report-preview.png', fullPage: true });

    const hasReportSurface = await previewPage
      .locator('embed, iframe, object, [class*=preview], [class*=report]')
      .first()
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    expect(popup !== null || hasReportSurface).toBe(true);

    console.log(`Report preview opened for voucher ${voucherNo}`);

    // ---- the saved record shows in the list view (data table on page load) ----
    await stoneInward.verifyRowInList(voucherNo);
  });
});
