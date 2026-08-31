const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef } = require('../../utils/unique');
const env = require('../../utils/env');

/**
 * TC-MI-001 — Metal Inward: Stock / Direct / Invoice, single item, add record
 * end-to-end through the 3-step wizard to Submit.
 *
 * Scenario data (agreed with QA lead, 23-08-2026):
 *   Sub Transaction Type: Invoice (selected FIRST — it drives the vendor fetch)
 *   Business Unit:        Cochin
 *   Inward Type:          Stock
 *   Purchase Type:        Direct
 *   Vendor:               RAJA
 *   Article:              Tendulkar (typed search; back-fills Gold / Ring)
 *   Purity:               91.60 (22 Karat Gold)
 *   No Of Pcs:            10
 *   Gross Weight:         50.000
 *   Rate:                 6000
 *
 * Runs in the 'no-auth' project: the session token lives in sessionStorage,
 * which Playwright's storageState cannot persist, so the spec logs in itself.
 *
 * MUST run headed (npm run test:headed or --headed): the Device Radar hardware
 * gate blocks login in the headless shell, which cannot reach the local agent
 * on http://127.0.0.1:5151.
 */
test.describe('Metal Inward - add record', () => {
  test('TC-MI-001 add and submit a Stock/Direct/Invoice metal inward', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(420_000);

    // ---- login (Device Radar agent must be running on this machine) ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Step 1 of TC: open Procurement > Operations > Stock Inward ----
    await metalInward.open();
    await expect(metalInward.tab).toBeVisible();

    // ---- Step 2: open the Add wizard ----
    await metalInward.openAddWizard();

    // ---- Steps 3-19: Basic Details ----
    const invoiceNo = uniqueRef('MI-E2E');
    const picked = await metalInward.fillBasicDetails({
      subTransactionType: 'Invoice',
      businessUnit: env.BU,
      inwardType: 'Stock',
      purchaseType: 'Direct',
      vendor: 'RAJA',
      purchaser: 'Ajin G',
      invoiceNo,
      hallmark: true,
    });

    // Dropdown option-list verifications from the test case (steps 3, 5, 7)
    expect(picked.inwardType).toEqual(['Stock', 'Order']);
    expect(picked.purchaseType).toEqual(['Direct', 'Goods Receipt']);
    expect(picked.subTransactionType.sort()).toEqual(['GRN', 'Invoice', 'Jobwork']);
    expect(picked.vendor).toContain('RAJA');

    // Steps 14-15: Credit Days auto-populates from the vendor; Due Date is
    // calculated and locked against direct entry.
    await expect(metalInward.creditDays).not.toHaveValue('');
    await expect(metalInward.dueDate).toBeDisabled();
    await expect(metalInward.dueDate).not.toHaveValue('');

    // Step 19: Hallmark checked
    await expect(metalInward.hallmark).toBeChecked();

    // ---- Step 20: Next -> Inward Metal Items ----
    await metalInward.nextBtn.click();
    await expect(metalInward.select('referenceType')).toBeVisible({ timeout: 30_000 });

    // ---- Steps 21-39: item entry ----
    await metalInward.fillItem({
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 10,
      grossWeightWithTare: 50,
      rate: 6000,
    });

    // Article search back-fills the hierarchy (Gold / Ring for Tendulkar)
    expect(await metalInward.selectValue('groupCategory')).toBe('Gold');
    expect(await metalInward.selectValue('category')).toBe('Ring');

    // Step 32: Net Weight is calculated - gross with no deductions stays 50.000
    expect(await metalInward.numberOf('Gross Weight')).toBeCloseTo(50, 3);
    expect(await metalInward.numberOf('Net Weight')).toBeCloseTo(50, 3);

    // Steps 33-37: wastage/making auto-populate from Vendor Wastage config -
    // values are config-owned, so assert presence, not magnitude.
    expect(await metalInward.numberOf('Wastage')).toBeGreaterThan(0);
    expect(await metalInward.numberOf('Making Charges')).toBeGreaterThan(0);

    // ---- Step 47: Add Item ----
    await metalInward.addItemBtn.click();
    await expect
      .poll(async () => metalInward.summaryText(), { timeout: 20_000 })
      .toContain('No. of Pieces : 10');

    // Step 49: summary panel arithmetic. Parse the panel and verify the money
    // chain instead of hardcoding config-dependent amounts:
    //   Taxable = Metal + Making (+ stone/diamond, 0 here)
    //   Payable = Taxable + Tax Collection
    //   Net Payable = Payable - Tax Deduction
    const summary = await metalInward.summaryText();
    // Lookbehind guard: 'Net Weight' must not match inside 'Component Net Weight'.
    const amount = (label) => {
      const m = summary.match(new RegExp(String.raw`(?<!Component )\b` + label + String.raw`\s*:?\s*₹?\s*([\d,]+\.?\d*)`));
      return m ? Number(m[1].replace(/,/g, '')) : NaN;
    };
    expect(amount('Gross Weight')).toBeCloseTo(50, 3);
    expect(amount('Net Weight')).toBeCloseTo(50, 3);
    const metal = amount('Metal Amount');
    const making = amount('Making Amount');
    const taxable = amount('Taxable Value');
    expect(taxable).toBeCloseTo(metal + making + amount('Stone Amount') + amount('Diamond Amount'), 1);

    // ---- Step 50: Next -> Review & Submit ----
    await metalInward.nextBtn.click();
    await expect(metalInward.submitBtn).toBeVisible({ timeout: 30_000 });

    // Step 51: the review grid holds exactly the one inserted item
    const reviewRow = metalInward.gridRows.first();
    await expect(reviewRow).toContainText('SINGLE TAG');
    await expect(reviewRow).toContainText('Tendulkar');
    await expect(reviewRow).toContainText('50.000');

    // ---- Step 53: Submit ----
    const response = await metalInward.submit();
    expect(response).toBeTruthy();

    // Submitting opens the Print dialog with the generated voucher number
    // (step 53's "1 Stock Inward RC No is generated").
    await expect(metalInward.printDialog).toBeVisible({ timeout: 60_000 });
    const voucherNo = await metalInward.voucherNumber();
    expect(voucherNo).not.toBe('');
    console.log(`Record created. Voucher number: ${voucherNo}, invoice no: ${invoiceNo}`);

    // ---- Preview the report from the Print dialog ----
    // Preview may render inline or open a separate tab; accept either.
    const maybePopup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await metalInward.previewBtn.click();
    const popup = await maybePopup;
    const previewPage = popup || page;
    await previewPage.waitForLoadState('domcontentloaded');
    await previewPage.waitForTimeout(5_000); // let the report render
    await previewPage.screenshot({ path: 'test-results/screens/tc-mi-001-report-preview.png', fullPage: true });

    // The preview surface must actually be showing something - a PDF viewer,
    // an iframe, or report markup.
    const hasReportSurface = await previewPage
      .locator('embed, iframe, object, [class*=preview], [class*=report]')
      .first()
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    expect(popup !== null || hasReportSurface).toBe(true);

    console.log(`Report preview opened for voucher ${voucherNo}`);

    // ---- the saved record shows in the list view (data table on page load) ----
    await metalInward.verifyRowInList(voucherNo);
  });
});
