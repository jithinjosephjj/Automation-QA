const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef } = require('../../utils/unique');

/**
 * TC-AI-001 — Alloy Inward: add record on the single-screen form through
 * Add Item, Submit and report Preview.
 *
 * Scenario data (agreed with QA lead, 23-08-2026):
 *   Vendor:     RAJA
 *   Alloy Type: Alloy Text (Rate auto-fetches 500.00 from vendor alloy rates)
 *   Weight:     100
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
test.describe('Alloy Inward - add record', () => {
  test('TC-AI-001 add and submit an alloy inward', async ({ loginPage, alloyInward, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Procurement > Operations > Alloy Inward ----
    await alloyInward.open();
    await alloyInward.openAddWizard();

    // Alloy Type stays disabled until a vendor is chosen
    await expect(alloyInward.select('alloy')).toHaveClass(/ng-select-disabled/);

    // ---- fill the entry ----
    const invoiceNo = uniqueRef('AI-E2E');
    const picked = await alloyInward.fillEntry({
      vendor: 'RAJA',
      alloy: 'Alloy Text',
      invoiceNo,
      weight: 100,
    });
    expect(picked.vendor).toContain('RAJA');
    expect(picked.alloy).toContain('Alloy Text');

    // Credit Days auto-populates from the vendor; Due Date calculated + locked
    await expect(alloyInward.creditDays).not.toHaveValue('');
    await expect(alloyInward.dueDate).toBeDisabled();
    await expect(alloyInward.dueDate).not.toHaveValue('');

    // Money chain: Taxable = Weight x Rate, then the tax cascade.
    // The pricing fields settle only after slow tax-engine round trips, and
    // they land ONE AT A TIME - reading them piecemeal catches the form
    // mid-recalculation (Payable without Tax Collection, etc). So: read the
    // whole chain in one sweep and poll until it is self-consistent, then
    // assert. Rates/taxes are config-owned - assert relationships only.
    const readChain = async () => {
      const [rate, taxable, tax, payable, deduction, net] = await Promise.all([
        alloyInward.numberOf('Rate'),
        alloyInward.numberOf('Taxable Value'),
        alloyInward.numberOf('Tax Collection'),
        alloyInward.numberOf('Payable Value'),
        alloyInward.numberOf('Tax Deduction'),
        alloyInward.numberOf('Net Payable Value'),
      ]);
      return { rate, taxable, tax, payable, deduction, net };
    };
    await expect
      .poll(async () => {
        const c = await readChain();
        if (c.rate <= 0 || c.taxable <= 0 || c.payable <= 0) return Infinity;
        // largest violation across the three chain rules
        return Math.max(
          Math.abs(c.taxable - 100 * c.rate),
          Math.abs(c.payable - (c.taxable + c.tax)),
          Math.abs(c.net - (c.payable - c.deduction)),
        );
      }, { timeout: 60_000, message: 'pricing chain never settled into a consistent Taxable/Payable/Net Payable state' })
      .toBeLessThan(0.05);

    // ---- Add Item ----
    await alloyInward.addItemBtn.click();
    await alloyInward.waitForIdle();

    // ---- Submit ----
    await expect(alloyInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const response = await alloyInward.submit();
    expect(response).toBeTruthy();

    // Print dialog opens with the generated voucher / receipt number
    await expect(alloyInward.printDialog).toBeVisible({ timeout: 60_000 });
    const voucherNo = await alloyInward.voucherNumber();
    expect(voucherNo).not.toBe('');
    console.log(`Record created. Voucher number: ${voucherNo}, invoice no: ${invoiceNo}`);

    // ---- Preview the report ----
    const maybePopup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await alloyInward.previewBtn.click();
    const popup = await maybePopup;
    const previewPage = popup || page;
    await previewPage.waitForLoadState('domcontentloaded');
    await previewPage.waitForTimeout(5_000);
    await previewPage.screenshot({ path: 'test-results/screens/tc-ai-001-report-preview.png', fullPage: true });

    const hasReportSurface = await previewPage
      .locator('embed, iframe, object, [class*=preview], [class*=report]')
      .first()
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    expect(popup !== null || hasReportSurface).toBe(true);

    console.log(`Report preview opened for voucher ${voucherNo}`);

    // ---- the saved record shows in the list view (data table on page load) ----
    await alloyInward.verifyRowInList(voucherNo);
  });
});
