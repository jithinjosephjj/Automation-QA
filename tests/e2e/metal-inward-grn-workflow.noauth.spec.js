const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef } = require('../../utils/unique');
const env = require('../../utils/env');

/**
 * TC-MI-GRN-01 — Metal Inward: GRN / Stock / Direct, single item, add record
 * end-to-end through the 3-step wizard to Submit.
 *
 * Scenario data (user screenshot, 16-09-2026):
 *   Sub Transaction Type: GRN (selected FIRST — it drives the vendor fetch)
 *   Business Unit:        Cochin
 *   Inward Type:          Stock
 *   Purchase Type:        Direct
 *   Vendor:               Luxurio (Credit Days auto 89 → Due Date auto)
 *   Article:              Tendulkar (typed search; back-fills Gold / Ring)
 *   Purity:               91.60      No Of Pcs: 1
 *   Gross Weight:         60.000 (60 g keeps the value-approval gate green)
 *   Rate:                 (none - the GRN item form has no Rate field)
 *
 * GRN form facts (mapped live, 16-09-2026):
 * - The GRN header REUSES the Invoice control ids: #invoiceNo is relabelled
 *   "Voucher Number" and #invoiceDate "Voucher Date" — fillBasicDetails works
 *   unchanged.
 * - Hallmark stays unchecked (screenshot shows it off for GRN).
 * - The items step is the standard manual Metal item form (entry mode /
 *   reference type / article / purity / pcs / gross-with-tare / rate).
 *
 * MUST run headed (Device Radar gate + Local Network Access) — see README.
 */
test.describe('Metal Inward - GRN workflow', () => {
  test('TC-MI-GRN-01 add and submit a GRN/Stock/Direct metal inward', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.ensureLoggedIn();

    // ---- Procurement > Operations > Stock Inward, Metal tab ----
    await metalInward.open();
    await expect(metalInward.tab).toBeVisible();
    await metalInward.openAddWizard();

    // ---- Basic Details: GRN / Cochin / Stock / Direct / Luxurio ----
    const voucherNo = uniqueRef('MI-GRN');
    const picked = await metalInward.fillBasicDetails({
      subTransactionType: 'GRN',
      businessUnit: env.BU,
      inwardType: 'Stock',
      purchaseType: 'Direct',
      vendor: 'Luxurio',
      purchaser: 'Ajin G',
      invoiceNo: voucherNo, // #invoiceNo carries the "Voucher Number" label on GRN
    });

    expect(picked.subTransactionType).toContain('GRN');
    expect(picked.inwardType).toEqual(['Stock', 'Order']);
    expect(picked.purchaseType).toEqual(['Direct', 'Goods Receipt']);
    expect(picked.vendor).toContain('Luxurio');

    // Credit Days auto-populates from the vendor; Due Date is calculated and
    // locked (89 days for Luxurio at the time of mapping - config-owned, so
    // assert presence, not the exact number).
    await expect(metalInward.creditDays).not.toHaveValue('');
    await expect(metalInward.dueDate).toBeDisabled();
    await expect(metalInward.dueDate).not.toHaveValue('');

    // GRN keeps Hallmark unchecked
    await expect(metalInward.hallmark).not.toBeChecked();

    // ---- Next -> Inward Metal Items ----
    await metalInward.nextBtn.click();
    await expect(metalInward.select('referenceType')).toBeVisible({ timeout: 30_000 });

    await metalInward.fillItem({
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 60,
      // no rate: the GRN item form carries NO Rate field (mapped 16-09-2026)
    });

    // Article search back-fills the hierarchy (Gold / Ring for Tendulkar)
    expect(await metalInward.selectValue('groupCategory')).toBe('Gold');
    expect(await metalInward.selectValue('category')).toBe('Ring');

    // Net Weight is calculated - gross with no deductions stays 60.000
    expect(await metalInward.numberOf('Gross Weight')).toBeCloseTo(60, 3);
    expect(await metalInward.numberOf('Net Weight')).toBeCloseTo(60, 3);

    // Wastage / making auto-populate from the VENDOR's config - Luxurio's
    // values are config-owned, so log them and only assert they parsed.
    const wastage = await metalInward.numberOf('Wastage');
    const makingCharges = await metalInward.numberOf('Making Charges');
    console.log(`Luxurio vendor config: wastage=${wastage}, making charges=${makingCharges}`);
    expect(Number.isNaN(wastage)).toBe(false);
    expect(Number.isNaN(makingCharges)).toBe(false);

    // ---- Add Item (proof via the summary panel) ----
    await metalInward.addItem();
    await expect
      .poll(async () => metalInward.summaryText(), { timeout: 20_000 })
      .toContain('No. of Pieces : 1');

    // GRN summary arithmetic. The GRN panel carries NO Taxable Value line
    // (goods come in unpriced): Metal Amount stays 0.00 and Making Amount is
    // the per-gram making charge x net weight.
    const summary = await metalInward.summaryText();
    const amount = (label) => {
      const m = summary.match(new RegExp(String.raw`(?<!Component )\b` + label + String.raw`\s*:?\s*₹?\s*([\d,]+\.?\d*)`));
      return m ? Number(m[1].replace(/,/g, '')) : NaN;
    };
    expect(amount('Gross Weight')).toBeCloseTo(60, 3);
    expect(amount('Net Weight')).toBeCloseTo(60, 3);
    expect(amount('Metal Amount')).toBe(0);
    expect(amount('Making Amount')).toBeCloseTo(makingCharges * 60, 1);

    // ---- Next -> Review & Submit ----
    await metalInward.nextBtn.click();
    await expect(metalInward.submitBtn).toBeVisible({ timeout: 30_000 });

    const reviewRow = metalInward.gridRows.first();
    await expect(reviewRow).toContainText('SINGLE TAG');
    await expect(reviewRow).toContainText('Tendulkar');
    await expect(reviewRow).toContainText('60.000');

    // ---- Submit (save response + success toast asserted in submit()) ----
    const response = await metalInward.submit();
    expect(response).toBeTruthy();

    // Print dialog carries the generated voucher/RC number
    await expect(metalInward.printDialog).toBeVisible({ timeout: 60_000 });
    const rcNo = await metalInward.voucherNumber();
    expect(rcNo).not.toBe('');
    console.log(`GRN inward created. Voucher number: ${rcNo}, entered voucher no: ${voucherNo}`);

    // the Print dialog's report template must render
    const preview = await metalInward.verifyPrintPreview({ screenshot: 'test-results/screens/tc-mi-grn-01-report-preview.png' });
    console.log(`print preview: ${preview}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});

    // ---- the saved record shows in the list view ----
    await metalInward.verifyRowInList(rcNo);
  });
});
