const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Alloy Inward — Procurement > Operations > Alloy Inward.
 * Route: /prc/view-alloy-inward (its own page, NOT a Stock Inward tab).
 *
 * Unlike the Stock Inward wizards this is a SINGLE-SCREEN form ("General
 * Information" + "Weight and Pricing" sections) with Add Item / Clear /
 * Submit all present from the start.
 *
 * Alloy-specific facts (verified live 23-08-2026):
 * - Only two dropdowns: vendor and alloy. Alloy Type is disabled until a
 *   vendor is picked; picking an alloy auto-fetches Rate from the vendor's
 *   alloy rate config and enables Weight.
 * - The Invoice No input id is "#invoceNo" - the app misspells it.
 * - The vendor list here is the alloy-vendor set, which differs from the
 *   Stock Inward vendor list (RAJA is in both).
 */
class AlloyInwardPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Alloy');
    this.invoiceNo = page.locator('#invoceNo'); // sic - app typo
    this.remarks = page.locator('#remarks');
  }

  async open() {
    await this.goto('/prc/view-alloy-inward');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** No tabs on this page. */
  async selectTab() {}

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('vendor').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * The whole entry in one go: vendor → alloy (enables weight, fetches rate)
   * → weight. Rate is left to the auto-fetched value unless overridden.
   */
  async fillEntry({ vendor, alloy, invoiceNo, weight, rate }) {
    const picked = {};
    picked.vendor = await this.pick('vendor', vendor);
    picked.alloy = await this.pick('alloy', alloy);
    if (invoiceNo) await this.invoiceNo.fill(invoiceNo);

    // The alloy pick triggers an async rate fetch that rewrites the pricing
    // fields when it lands - entering Weight before it arrives gets wiped and
    // Taxable Value stays 0. Wait for Rate before touching Weight.
    const rateInput = this.inputByLabel('Rate');
    for (let i = 0; i < 30; i++) {
      if (Number(await rateInput.inputValue()) > 0) break;
      await this.page.waitForTimeout(500);
    }

    await this.fillByLabel('Weight', weight);
    if (rate !== undefined) await this.fillByLabel('Rate', rate);
    return picked;
  }
}

module.exports = { AlloyInwardPage };
