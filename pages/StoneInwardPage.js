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
  async fillItem({ refType, stoneArticle, entryMode, uom, noOfPcs, grossWeight, discountPercent, returnPercent }) {
    await this.pick('refType', refType);
    await this.pick('stoneArticle', stoneArticle, { search: true });
    await this.pick('entryMode', entryMode);
    await this.pick('uom', uom);

    await this.fillByLabel('Stone No Of Pcs', noOfPcs, { exact: false });
    await this.fillByLabel('Gross Weight', grossWeight);

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
  }
}

module.exports = { StoneInwardPage };
