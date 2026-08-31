const { test, expect } = require('../../fixtures/test-fixtures');
const { businessDate } = require('../../utils/unique');
const { DEMO_FILES } = require('../../utils/demo-files');

/**
 * TC-OB-001 — Order Booking: add a stock order through Order Details →
 * Build Order Items → Add Items → Next → Submit.
 *
 * Scenario data (QA lead screenshot, 23-08-2026):
 *   Item Type: Metal        Supervisor: Abc
 *   SM Code:   AJ10         Sales Executive: Ajin G (auto from SM code)
 *   Delivery Note: Regular  Reference Type: Combination
 *   Article:   Tendulkar (auto-fills Gold / Ring + every sub-category)
 *   Purity:    91.60        No of Pcs: 1 (preset)   Gross Weight: 50
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 *
 * KNOWN APP BUG (confirmed by QA lead, 28-08-2026): Submit currently fails -
 * POST OrderBooking/CreateOrderBooking returns HTTP 400 "One or more
 * validation errors occurred" listing fields the app should populate itself
 * (OrderBookingVRL.BaseUOM, ClientCurrencyName, and per-item HSNCode,
 * GroupCategory/Category + their ShortNames). The UI form is fully valid at
 * that point; the payload the app builds is just missing those fields.
 * Reproduced identically with manual hierarchy picks, searched article picks
 * and list article picks. This spec intentionally asserts the save response,
 * so it FAILS while the bug exists and turns green when dev fixes it.
 */
test.describe('Order Booking - add record', () => {
  test('TC-OB-001 add and submit a metal stock order', async ({ loginPage, orderBooking, page }) => {
    test.setTimeout(420_000);

    // ---- login ----
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // ---- Sales & Distribution > B2B > Order, Order Booking tab ----
    await orderBooking.open();
    await orderBooking.openAddWizard();

    // ---- General Order Information ----
    await orderBooking.fillOrderDetails({
      itemType: 'Metal',
      supervisor: 'Abc',
      smCode: 'AJ10',
      deliveryNote: 'Regular',
      deliveryDate: businessDate(30).replace(/-/g, '/'), // 30 days out, DD/MM/YYYY
    });

    // Sales Executive auto-fills from the SM Executive Code
    await expect
      .poll(async () => orderBooking.selectValue('salesExecutive'), { timeout: 20_000 })
      .toBe('Ajin G');

    // ---- Build Order Items ----
    await orderBooking.fillItem({
      referenceType: 'Combination',
      groupCategory: 'Gold',
      category: 'Ring',
      article: 'Tendulkar',
      purity: '91.60',
      grossWeight: 50,
    });

    // The article back-fills the whole hierarchy
    expect(await orderBooking.selectValue('groupCategory')).toBe('Gold');
    expect(await orderBooking.selectValue('category')).toBe('Ring');

    // ---- attach one demo image via the Add Files control ----
    await orderBooking.attachFileViaAddFiles(DEMO_FILES.image1);

    // ---- Add Items (verified via the Stock Order Summary panel) ----
    await orderBooking.addItemsAndVerify(1);
    const summary = await orderBooking.summaryText();
    expect(summary).toContain('Gross Weight : 50.000');
    expect(summary).toContain('Net Weight : 50.000');
    expect(summary).toMatch(/Sales Executive\s*:\s*AJ10 \/ Ajin G/);

    // ---- Next -> Submit ----
    if (!(await orderBooking.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await orderBooking.nextBtn.click();
      await orderBooking.waitForIdle();
    }
    await expect(orderBooking.submitBtn).toBeVisible({ timeout: 30_000 });
    const { responses, diag } = await orderBooking.submitWithDiagnostics();
    const save = responses.find((r) => r.body);
    expect(save, `no save response captured; validation state: ${JSON.stringify(diag)}`).toBeTruthy();
    expect(save.status, `save rejected: ${JSON.stringify(save && save.body)}`).toBeLessThan(400);
    expect(JSON.stringify(save.body)).toMatch(/success/i);
    console.log(`Order saved: ${JSON.stringify(save.body.data || save.body).slice(0, 150)}`);

    await page.screenshot({ path: 'test-results/screens/tc-ob-001-after-save.png', fullPage: true });
  });
});
