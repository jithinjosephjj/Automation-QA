const { test, expect } = require('../../fixtures/test-fixtures');
const { uniqueRef, businessDate } = require('../../utils/unique');

/**
 * TC-BUI-001 — Bullion Inward: add record on the single-screen form through
 * Add Items, Submit and report Preview.
 *
 * Scenario data (dictated by QA lead, 23-08-2026):
 *   Generation Type: Direct       Vendor: RAJA (typeahead)
 *   Invoice Date:    today        Group Category: Gold
 *   Category:        Ring         Article: Tendulkar
 *   Rate Fixation:   Fix          Purity: 91.6
 *   Gross Weight:    100 (not dictated - agreed default)
 *   Rate:            50000
 *   Additional Charges (mandatory since the app update of 29-08-2026):
 *     item-level  "Item wise charge bullion" / "item wise bullion"
 *     bill-level  "Raja Bullion Charges" (vendor-specific)
 *   Flow: both charges -> Add Items -> Submit.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 *
 * KNOWN APP BUG (confirmed by QA lead, 29-08-2026): after Add Items, clicking
 * Submit does NOTHING - no API request, no toast, no dialog - while the
 * cleared next-item form shows red required-field flags (Purity, Gross
 * Weight, Rate, both Additional Charges buttons). The item and both charges
 * are correctly registered in the summary at that point (Net Payable
 * 4,534,232.67 for this data). Submit should save the record. This spec
 * asserts the CreateBullionInward response, so it FAILS while the bug exists
 * and turns green when dev fixes it.
 */
test.describe('Bullion Inward - add record', () => {
  test('TC-BUI-001 add and submit a Direct bullion inward', async ({ loginPage, bullionInward, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Procurement > Operations > Bullion Booking, Bullion Inward tab ----
    await bullionInward.open();
    await bullionInward.selectTab();
    await bullionInward.openAddWizard();

    // ---- fill the entry ----
    const invoiceNo = uniqueRef('BUI-E2E');
    const picked = await bullionInward.fillEntry({
      generationType: 'Direct',
      vendor: 'RAJA',
      invoiceNo,
      invoiceDate: businessDate().replace(/-/g, '/'), // DD/MM/YYYY
      groupCategory: 'Gold',
      category: 'Ring',
      article: 'Tendulkar',
      rateFixationType: 'Fix',
      purity: '91.6',
      grossWeight: 100,
      rate: 50000,
    });

    expect(picked.generationType).toEqual(['Direct', 'Bullion Booking']);
    expect(picked.rateFixationType).toEqual(['Fix', 'UnFix']);
    expect(picked.groupCategory).toContain('Gold');

    // Credit Days auto-populates from the vendor (no id on this form - read
    // it by label); Due Date is calculated + locked
    await expect
      .poll(async () => bullionInward.numberOf('Credit Days'), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(bullionInward.dueDate).toBeDisabled();

    // Pure Weight = Gross x Purity%, read-only (91.6 purity on 100g -> 91.6g)
    await expect
      .poll(async () => bullionInward.numberOfCtl('pureWt'), { timeout: 20_000 })
      .toBeCloseTo(100 * 0.916, 1);
    expect(await bullionInward.inputCtl('pureWt').isDisabled()).toBe(true);

    // Money chain: Metal Value = Pure Weight x Rate, then the tax cascade.
    // The tax engine lands values one at a time - poll until the whole chain
    // is self-consistent, then it is safe to trust every number in it.
    const pureWt = await bullionInward.numberOfCtl('pureWt');
    await expect
      .poll(async () => {
        const [metal, addl, taxable, tax, payable, deduction, net] = await Promise.all([
          bullionInward.numberOf('Metal Value'),
          bullionInward.numberOf('Additional Charges Value').catch(() => 0),
          bullionInward.numberOf('Taxable Value'),
          bullionInward.numberOf('Tax Collection'),
          bullionInward.numberOf('Payable Value'),
          bullionInward.numberOf('Tax Deduction'),
          bullionInward.numberOf('Net Payable Value'),
        ]);
        if (metal <= 0 || taxable <= 0 || payable <= 0) return Infinity;
        return Math.max(
          Math.abs(metal - pureWt * 50000),
          Math.abs(payable - (taxable + tax)),
          Math.abs(net - (payable - deduction)),
        );
      }, { timeout: 60_000, message: 'pricing chain never settled into a consistent state' })
      .toBeLessThan(0.05);

    // ---- Add Items (verified - the click is a silent no-op on invalid forms) ----
    // ---- Additional Charges (mandatory since the app update of 29-08-2026):
    // BOTH the item-level and the bill-level charge must be added BEFORE
    // Add Items. The bill-level charge names are vendor-specific (RAJA). ----
    await bullionInward.addAdditionalCharge({
      buttonIndex: 0, // item-level (next to Add Items)
      chargeType: 'Item wise charge bullion',
      chargeName: 'item wise bullion',
    });
    await bullionInward.addAdditionalCharge({
      buttonIndex: 1, // bill-level (lower Remarks section)
      chargeType: 'Raja Bullion Charges',
      chargeName: 'Raja Bullion Charges',
    });

    await bullionInward.addItemsAndVerify('Gross Weight : 100.000');

    // the item-level charge (33.00) flows into the totals
    await expect
      .poll(async () => bullionInward.summaryText(), { timeout: 20_000 })
      .toContain('Additional Charges Value 33.00');
    const summary = await bullionInward.summaryText();
    expect(summary).toContain('Pure Weight : 91.600');

    // The item grid row carries the article and the agreed numbers
    await expect(bullionInward.gridRows.first()).toContainText('Tendulkar');
    await expect(bullionInward.gridRows.first()).toContainText('50000');

    // ---- Submit ----
    // Unlike Metal/Brand/Stone/Alloy, this screen shows NO Print dialog after
    // submit - the form just resets. The save response is the success signal:
    // { code: 1001, message: "Saved successfully!", data: { receiptNo } }.
    await expect(bullionInward.submitBtn).toBeVisible({ timeout: 30_000 });
    const response = await bullionInward.submit();
    expect(response).toBeTruthy();
    expect(response.message).toMatch(/saved successfully/i);
    const receiptNo = response.data && response.data.receiptNo;
    expect(receiptNo).toBeTruthy();
    console.log(`Record created. Receipt no: ${receiptNo}, invoice no: ${invoiceNo}`);

    // After a successful save the form resets to "Add new record" - the
    // summary panel zeroes out. (The list grid does NOT show inward records
    // even after a confirmed save - list behaviour, out of scope here; the
    // CreateBullionInward response above is the record-creation proof.)
    await expect
      .poll(async () => bullionInward.summaryText(), { timeout: 30_000 })
      .toContain('Gross Weight : 0.000');

    await page.screenshot({ path: 'test-results/screens/tc-bui-001-after-save.png', fullPage: true });
  });
});
