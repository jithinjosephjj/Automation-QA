const { BullionInwardPage } = require('./BullionInwardPage');

/**
 * Bullion Booking — the DEFAULT tab of /prc/app-bullion-list (probed live
 * 03-09-2026). Same single-screen shell as Bullion Inward: General
 * Information + Weight & Pricing, Add Items / Clear / Submit from the start.
 *
 * Booking-specific facts:
 * - Selects: bookingType / vendor (typeahead) / groupCategory / category /
 *   article (typeahead after the hierarchy) / prefferedPaymentMethod /
 *   purity - all sioniq-ng-select controlnames.
 * - Dates: #deliveryDate and #bookingValidityDate (DD/MM/YYYY).
 * - Numbers: app-sioniq-input grossWt / pureWt (disabled) / rate, then the
 *   money chain (taxableValue…netPayableValue, all disabled).
 * - No Additional Charges buttons on this tab (inward-only requirement).
 */
class BullionBookingPage extends BullionInwardPage {
  constructor(page) {
    super(page, 'Bullion Booking');
    this.submitApiPattern = /CreateBullionBooking/i;
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('bookingType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Pick a select's first real option (for lists whose values we don't dictate). */
  async pickFirst(controlname) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await this.select(controlname).locator('.ng-select-container').click();
      const opt = this.page.locator('.ng-dropdown-panel .ng-option').first();
      const ok = await opt.waitFor({ state: 'visible', timeout: attempt * 4_000 })
        .then(() => true).catch(() => false);
      const label = ok ? ((await opt.textContent().catch(() => '')) || '').trim() : '';
      if (ok && label && !/No items found/i.test(label)) {
        await opt.click();
        console.log(`booking ${controlname} ->`, label);
        return label;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`booking select "${controlname}" never offered an option`);
  }

  /** The whole booking entry, in dependency order. Advance Percentage is
   *  MANDATORY (red-flagged; Add Items silently no-ops without it), and
   *  Booking Reference ID must be DYNAMIC (duplicates blocked). */
  async fillBooking({ bookingType, vendor, groupCategory, category, article, purity, deliveryDate, validityDate, bookingRefID, advancePercentage = 5, grossWeight, rate, reduceTax = false, reduceTaxValue = 2 }) {
    if (bookingType) await this.pick('bookingType', bookingType);
    else await this.pickFirst('bookingType');
    await this.pick('vendor', vendor, { search: true });

    await this.pick('groupCategory', groupCategory);
    await this.pick('category', category);
    await this.pick('article', article, { search: true });
    await this.pick('purity', purity);

    const dd = this.page.locator('#deliveryDate');
    await dd.fill(deliveryDate);
    await dd.blur();
    await this.page.keyboard.press('Escape');
    const vd = this.page.locator('#bookingValidityDate');
    await vd.fill(validityDate);
    await vd.blur();
    await this.page.keyboard.press('Escape');

    if (bookingRefID) await this.fillByLabel('Booking Reference ID', bookingRefID);
    await this.fillByLabel('Advance Percentage', advancePercentage);

    const gross = this.inputCtl('grossWt');
    await gross.fill(String(grossWeight));
    await gross.blur();
    const rateInput = this.inputCtl('rate');
    await rateInput.fill(String(rate));
    await rateInput.blur();

    // the checkbox beside Rate ("Reduce Tax") reveals one more number field
    if (reduceTax) {
      const box = this.page.locator('#reduceTaxOnRate');
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ timeout: 5_000 }).catch(() => {});
        if (!(await box.isChecked())) await box.evaluate((el) => el.click());
      }
      await this.page.waitForTimeout(1_000);
      // the revealed input renders right after Rate; everything else that
      // follows (the money chain) is disabled - take the first ENABLED one
      const rt = this.page
        .locator('app-sioniq-input[controlname="rate"]')
        .locator('xpath=following::input[@type="number" and not(@disabled)][1]');
      await rt.waitFor({ state: 'visible', timeout: 10_000 });
      await rt.fill(String(reduceTaxValue));
      await rt.blur();
    }
  }
}

module.exports = { BullionBookingPage };
