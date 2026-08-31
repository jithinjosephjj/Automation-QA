const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Lot Generation — Inventory > Operations > Lot Generation.
 * Route: /inv/view-lot-generation.
 *
 * Add form (mapped live, 31-08-2026): filter cascade Item Type → Stock
 * Source Type → From Transaction Type → Vendor (multi) reveals a grid of
 * inward records keyed by Inward Number (e.g. "M161"). Checking a row opens
 * the item panel with Reference Type / Category / Article pre-filled from
 * the inward; Employee and Business Unit are the manual mandatory picks.
 * "Add To Lot" stages the item, Submit saves the lot.
 */
class LotGenerationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Lot Generation');
    this.submitApiPattern = /Lot/i;
  }

  async open() {
    await this.goto('/inv/view-lot-generation');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  rowMatcher(rowText) {
    const esc = String(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  /**
   * Generate one lot from an inward record. Returns the lot number from the
   * save response (falls back to the Print dialog's voucher number).
   */
  async generateLot({ itemType = 'Metal', sourceType = 'Inward', transactionType = 'Metal Inward', vendor = 'RAJA', inwardNo, employee, businessUnit = 'Cochin' }) {
    await this.open();
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: 60_000 });
    await this.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });

    await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    await this.pick('masterDataValueID_StockSourceType', sourceType, { exact: true });
    await this.pick('fromTransactionTypeID', transactionType, { exact: true });
    // Vendor is a MULTI-select - close its panel or it swallows the next click
    await this.pick('vendorFilter', vendor, { closePanel: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // check the inward's grid row - this opens the item panel
    const row = this.rowMatcher(inwardNo).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    await row.getByRole('checkbox').first().check({ force: true });
    await this.page.waitForTimeout(2_500);

    // panel pre-fills the article chain from the inward; Employee and
    // Business Unit are the manual mandatory picks
    await this.pick('employeeID', employee, { search: true });
    await this.pick('businessUnitID', businessUnit, { exact: true });

    await this.page.getByRole('button', { name: 'Add To Lot' }).click();
    await this.page.waitForTimeout(2_500);

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && /lot/i.test(r.url()) && !/GetAll|Pagination|KeepAlive/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.submitBtn.click();
    const r = await resp;
    if (!r) throw new Error('Lot Submit fired no save request - form silently blocked (check Add To Lot registered the item)');
    const body = await r.json().catch(() => null);
    console.log('lot save:', r.status(), JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Lot save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    let lotNo = (body && body.data && (body.data.receiptNo || body.data.lotNo || body.data.docNo)) || '';
    if (!lotNo && (await this.printDialog.isVisible({ timeout: 10_000 }).catch(() => false))) {
      lotNo = await this.voucherNumber();
    }
    // the Print dialog offers Preview here - verify the template renders.
    // Recorded (not thrown) so a broken template cannot swallow the lot
    // number - the spec asserts printPreviewError after persisting state.
    this.printPreviewError = null;
    await this.printDialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    await this.page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    return lotNo;
  }
}

module.exports = { LotGenerationPage };
