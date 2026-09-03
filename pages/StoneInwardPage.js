const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Stone Inward — Procurement > Operations > Stock Inward, Stone tab.
 * 2-step wizard: Basic Details → Build Items & Submit (Inward Details /
 * Weight Details / Pricing sections).
 *
 * Stone-specific facts (verified live 23-08-2026):
 * - Step 1 is lean: Inward Type / Purchase Type / Vendor dropdowns only.
 *   Invoice Number and Credit Days have NO ids on this tab - reach by label.
 * - The Invoice Number field STRIPS special characters ("SI-PROBE-1" becomes
 *   "SIPROBE1") - generate alphanumeric-only references.
 * - Invoice Date is MANDATORY: Next silently stays on step 1 without it.
 * - Item dropdowns: refType, stone / stoneCategory / stoneSubCategory / value
 *   (hierarchy), stoneArticle, entryMode, uom, rateUom.
 * - Searching stoneArticle back-fills the whole hierarchy (like Metal).
 * - rateUom AUTO-SETS from the article's rate configuration and is DISABLED
 *   (e.g. Jerald rates are per Carat). When it differs from the stone UOM,
 *   "Rate Stone Weight" shows the converted weight (1 carat = 0.2 g).
 * - Discount % / Return % share containers with their calculated amount
 *   fields: the percent input is the first ENABLED input in the "Discount
 *   Amount" / "Return Weight" containers.
 */
class StoneInwardPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Stone');
    this.remarks = page.locator('#remarks');
  }

  /** First enabled input in a labeled container - the % half of a %/amount pair. */
  percentInputOf(labelText) {
    return this.page
      .locator('div.grid, div.form-group')
      .filter({ has: this.page.locator('label', { hasText: labelText }) })
      .last()
      .locator('input:not([disabled]):not([type=checkbox])')
      .first();
  }

  /** Step 1. Invoice date is mandatory; the value can be any valid date. */
  async fillBasicDetails({ inwardType, purchaseType, vendor, invoiceNo, invoiceDate }) {
    const picked = {};
    picked.inwardType = await this.pick('inwardType', inwardType);
    picked.purchaseType = await this.pick('purchaseType', purchaseType);
    picked.vendor = await this.pick('vendor', vendor);

    // The field silently strips non-alphanumerics - feed it a clean value so
    // what we assert later is what the app actually stored.
    await this.fillByLabel('Invoice Number', String(invoiceNo).replace(/[^A-Za-z0-9]/g, ''));

    await this.invoiceDate.fill(invoiceDate);
    await this.invoiceDate.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
    return picked;
  }

  /**
   * Item entry on Build Items & Submit. Searching the article back-fills the
   * stone hierarchy; rateUom sets itself from the rate config (disabled).
   */
  async fillItem({ refType, stoneArticle, entryMode, uom, noOfPcs, grossWeight, tareWeight, discountPercent, returnPercent, assortedStock }) {
    await this.pick('refType', refType);
    await this.pick('stoneArticle', stoneArticle, { search: true });
    await this.pick('entryMode', entryMode);
    // With Tare mode AUTO-SETS the UOM (Gram) and disables the select - only
    // pick when it is still open for choosing
    const uomValue = await this.selectValue('uom').catch(() => '');
    if (uomValue.trim() !== String(uom)) {
      const uomDisabled = await this.select('uom').locator('input[role="combobox"]')
        .isDisabled().catch(() => false);
      if (uomDisabled) console.log(`uom auto-set to "${uomValue.trim()}" (disabled) - pick skipped`);
      else await this.pick('uom', uom);
    }

    await this.fillByLabel('Stone No Of Pcs', noOfPcs, { exact: false });
    await this.fillByLabel('Gross Weight', grossWeight);
    // With Tare mode shows tare as a read-only total next to a "+" button
    // that opens the "Tare Weight Information" dialog: pick Item + Tare
    // Weight Type, enter the weight, Add Item, Close. Net = Gross - Tare.
    if (tareWeight !== undefined) {
      await this.page.getByRole('button', { name: '+', exact: true }).first().click();
      const dlg = this.page
        .locator('.modal, .offcanvas, ngb-modal-window, [role="dialog"]')
        .filter({ hasText: 'Tare Weight Information' })
        .last();
      await dlg.waitFor({ state: 'visible', timeout: 15_000 });
      for (let i = 0; i < 2; i++) { // Item, then Tare Weight Type
        const sel = dlg.locator('ng-select').nth(i);
        let picked = false;
        for (let attempt = 1; attempt <= 4 && !picked; attempt++) {
          if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);
          }
          await sel.locator('.ng-select-container').click();
          const options = this.page.locator('.ng-dropdown-panel .ng-option');
          const ok = await options.first().waitFor({ state: 'visible', timeout: attempt * 4_000 })
            .then(() => true).catch(() => false);
          if (ok && !/No items found/i.test((await options.first().textContent().catch(() => '')) || '')) {
            // "Per Pcs" tare type MULTIPLIES the entered weight by the piece
            // count - prefer an absolute-weight type so tare = what we enter
            const flat = options.filter({ hasNotText: /Per\s*Pcs/i }).first();
            const opt = (i === 1 && (await flat.isVisible().catch(() => false))) ? flat : options.first();
            console.log('tare dialog select', i, '->', ((await opt.textContent()) || '').trim());
            picked = await opt.click().then(() => true).catch(() => false);
          }
          if (!picked) await this.page.keyboard.press('Escape');
        }
        if (!picked) throw new Error(`tare dialog: select ${i} never offered an option`);
        await this.page.waitForTimeout(800);
      }
      await dlg.locator('input[type="number"]').first().fill(String(tareWeight));
      await dlg.getByRole('button', { name: 'Add Item' }).click();
      await this.page.waitForTimeout(1_500);
      await dlg.locator('button[data-role="close-tare"]').click();
      await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
      await this.page.waitForTimeout(1_000);
    }

    if (discountPercent !== undefined) {
      const pct = this.percentInputOf('Discount Amount');
      await pct.fill(String(discountPercent));
      await pct.blur();
    }
    if (returnPercent !== undefined) {
      const pct = this.percentInputOf('Return Weight');
      await pct.fill(String(returnPercent));
      await pct.blur();
    }
    // Assorted Stock gates downstream eligibility: ONLY assorted stone
    // inwards appear in the Certification Issue "Select Inward Stock" grid.
    if (assortedStock) {
      // the styled checkbox swallows forced clicks on the input - fall back
      // through the label and a DOM click until the state actually flips
      const box = this.page.locator('#assortedStock');
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ timeout: 5_000 }).catch(() => {});
        if (!(await box.isChecked())) {
          await this.page.locator('label[for="assortedStock"]').click({ timeout: 5_000 }).catch(() => {});
        }
        if (!(await box.isChecked())) await box.evaluate((el) => el.click());
        if (!(await box.isChecked())) throw new Error('Assorted Stock checkbox did not toggle');
      }
    }
  }
}

module.exports = { StoneInwardPage };
