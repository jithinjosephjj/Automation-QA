const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Brand Inward — Procurement > Operations > Stock Inward, Brand tab.
 * 2-step wizard: Basic Details → Brand Items & Summary (Product Details /
 * Weight Details / Pricing sections on one screen).
 *
 * Brand-specific facts (verified live 23-08-2026):
 * - Sub Transaction Type DEFAULTS to Invoice; the vendor list is available
 *   immediately (no select-sub-txn-first dance like Metal).
 * - Step 1 has Cost Center (controlname costCenter) instead of Business Unit.
 * - Unlike Metal, picking an Article does NOT back-fill the hierarchy:
 *   Group Category, Category and Brand Name are all mandatory and manual,
 *   in that order, before Article. Add Item silently no-ops (fields flagged
 *   ng-invalid, no toast) if any of them is missing.
 * - Pricing is MRP-based: "MRP (Reduce Tax)" x Pieces = Amount, then
 *   Discount % → Taxable Value → tax cascade. The MRP label embeds a
 *   checkbox, so it is reached by substring.
 */
class BrandInwardPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Brand');

    this.noOfPcs = page.locator('#noOfPcs');
    this.excludeTax = page.locator('#excludeTax');
    this.remarks = page.locator('#remarks');
  }

  /** Step 1. Sub Transaction Type is asserted, not set - Invoice is the default. */
  async fillBasicDetails({ vendor, purchaseType, costCenter, inwardType, purchaser, invoiceNo }) {
    const picked = {};
    picked.vendor = await this.pick('vendor', vendor);
    picked.purchaseType = await this.pick('purchaseType', purchaseType);
    picked.costCenter = await this.pick('costCenter', costCenter);
    picked.inwardType = await this.pick('inwardType', inwardType);
    picked.purchaser = await this.pick('purchaser', purchaser, { closePanel: true });
    if (invoiceNo) await this.invoiceNo.fill(invoiceNo);
    return picked;
  }

  /**
   * Brand item entry. Hierarchy order matters: Group Category → Category →
   * Brand → Article → Purity. All are mandatory.
   */
  async fillItem({ referenceType, groupCategory, category, brand, article, purity, noOfPcs, grossWeight, mrp, discountPercent }) {
    await this.pick('referenceType', referenceType);
    await this.pick('groupCategory', groupCategory);
    await this.pick('category', category);
    await this.pick('brand', brand);
    await this.pick('article', article, { search: true });
    await this.pick('purity', purity);

    await this.noOfPcs.fill(String(noOfPcs));
    await this.fillByLabel('Gross Weight', grossWeight);
    await this.fillByLabel('MRP', mrp, { exact: false }); // label is "MRP (Reduce Tax)"
    if (discountPercent !== undefined) await this.fillByLabel('Discount %', discountPercent);
  }
}

module.exports = { BrandInwardPage };
