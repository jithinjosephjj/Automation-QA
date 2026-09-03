const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-bullion-booking-state.json');

/**
 * E2E WORKFLOW — BULLION BOOKING / BULLION INWARD.
 *
 * Chain: Bullion Booking (default tab of /prc/app-bullion-list: booking
 * type + vendor RAJA + Gold/Ring/Tendulkar + purity + delivery/validity
 * dates + gross/rate → Add Items → Submit) → Bullion Inward with
 * Generation Type "Bullion Booking" (vendor + Booking ID pick back-fills
 * the product; item charge → Add Items → bill charge → Submit, the charge
 * order certified in TC-BUI-001 on 03-09-2026).
 *
 * Document numbers persist in e2e-bullion-booking-state.json.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const DATA = {
  booking: {
    vendor: 'RAJA',
    groupCategory: 'Gold',
    category: 'Ring',
    article: 'Tendulkar',
    purity: '91.6',
    advancePercentage: 5,
    grossWeight: 50,
    rate: 15000,
    reduceTax: true,
    reduceTaxValue: 2,
  },
  inward: { rateFixationType: 'Fix', creditDays: 20, grossWeight: 50 },
  charges: {
    item: { chargeType: 'Item wise charge bullion', chargeName: 'item wise bullion' },
    bill: { chargeType: 'Raja Bullion Charges', chargeName: 'Raja Bullion Charges' },
  },
};

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Bullion Booking - Bullion Inward - Workflow', () => {
  test('TC-BBI-01 create the bullion booking', async ({ loginPage, bullionBooking, page }) => {
    test.setTimeout(600_000);
    await login(loginPage, page);

    await bullionBooking.open();
    await bullionBooking.selectTab();
    await bullionBooking.openAddWizard();

    const bookingRefID = uniqueInvoiceNo().replace('AUT-INV', 'BKREF'); // dynamic - duplicates blocked
    await bullionBooking.fillBooking({
      vendor: DATA.booking.vendor,
      groupCategory: DATA.booking.groupCategory,
      category: DATA.booking.category,
      article: DATA.booking.article,
      purity: DATA.booking.purity,
      deliveryDate: businessDate(7).replace(/-/g, '/'),
      validityDate: businessDate(14).replace(/-/g, '/'),
      bookingRefID,
      advancePercentage: DATA.booking.advancePercentage,
      grossWeight: DATA.booking.grossWeight,
      rate: DATA.booking.rate,
      reduceTax: DATA.booking.reduceTax,
      reduceTaxValue: DATA.booking.reduceTaxValue,
    });
    console.log(`booking reference ID: ${bookingRefID}`);

    // Pure Weight = Gross x Purity%, read-only
    await expect
      .poll(async () => bullionBooking.numberOfCtl('pureWt'), { timeout: 20_000 })
      .toBeCloseTo(DATA.booking.grossWeight * 0.916, 1);

    // Add Items no-ops silently on an invalid form - verify via the summary
    await bullionBooking.addItemsAndVerify(`Gross Weight : ${DATA.booking.grossWeight}.000`);
    await expect(bullionBooking.gridRows.first()).toContainText('Tendulkar', { timeout: 30_000 });

    const response = await bullionBooking.submit();
    expect(response, 'booking save response').toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    const bookingNo = (response.data && (response.data.receiptNo || response.data.docNo)) || '';
    expect(bookingNo, 'generated booking number').toBeTruthy();
    state.writeState({ bookingNo });
    console.log(`Bullion booking saved: ${bookingNo}`);
    await page.screenshot({ path: 'test-results/screens/tc-bbi-01-after-save.png', fullPage: true });
  });

  test('TC-BBI-02 bullion inward against the booking', async ({ loginPage, bullionInward, page }) => {
    test.setTimeout(600_000);
    const { bookingNo } = state.readState();
    expect(bookingNo, 'run TC-BBI-01 first').toBeTruthy();
    await login(loginPage, page);

    await bullionInward.open();
    await bullionInward.selectTab();
    await bullionInward.openAddWizard();

    const invoiceNo = uniqueInvoiceNo(); // dynamic - duplicates blocked
    await bullionInward.fillEntryFromBooking({
      vendor: DATA.booking.vendor,
      bookingNo,
      creditDays: DATA.inward.creditDays,
      groupCategory: DATA.booking.groupCategory,
      category: DATA.booking.category,
      article: DATA.booking.article,
      rateFixationType: DATA.inward.rateFixationType,
      invoiceNo,
      invoiceDate: businessDate(0).replace(/-/g, '/'),
      grossWeight: DATA.inward.grossWeight,
    });

    // charge order certified 03-09-2026: item charge -> Add Items -> bill charge
    await bullionInward.addAdditionalCharge({ buttonIndex: 0, ...DATA.charges.item });
    await bullionInward.addItemsAndVerify(`Gross Weight : ${DATA.inward.grossWeight}.000`);
    await expect(bullionInward.gridRows.first()).toContainText('Tendulkar');
    await bullionInward.addAdditionalCharge({ buttonIndex: 1, ...DATA.charges.bill });

    const response = await bullionInward.submit();
    expect(response, 'inward save response').toBeTruthy();
    expect(response.message).toMatch(/saved successfully/i);
    const inwardNo = response.data && response.data.receiptNo;
    expect(inwardNo, 'generated inward receipt number').toBeTruthy();
    state.writeState({ inwardNo });
    console.log(`Bullion inward saved against booking ${bookingNo}: ${inwardNo} (invoice ${invoiceNo})`);

    // successful save resets the form - the summary zeroes out
    await expect
      .poll(async () => bullionInward.summaryText(), { timeout: 30_000 })
      .toContain('Gross Weight : 0.000');
    await page.screenshot({ path: 'test-results/screens/tc-bbi-02-after-save.png', fullPage: true });
  });
});
