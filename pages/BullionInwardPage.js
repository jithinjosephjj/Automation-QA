const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Bullion Inward — Procurement > Operations > Bullion Booking, "Bullion
 * Inward" tab. Route: /prc/app-bullion-list.
 *
 * Single-screen form ("General Information" + "Weight & Pricing") with
 * Add Items / Clear / Submit present from the start.
 *
 * Bullion-specific facts (verified live 23-08-2026):
 * - The page has two tabs: Bullion Booking (default) and Bullion Inward -
 *   selectTab() must run before the add button, or you get the Booking form.
 * - Vendor is a server-side typeahead ("Type to search") - always search.
 * - The article list is NOT searchable standalone: Group Category and
 *   Category must be picked first (Gold > Ring exposes Tendulkar).
 * - Invoice Date is mandatory, same as Stone.
 * - Number inputs are <app-sioniq-input controlname="..."> components:
 *   grossWt, pureWt (disabled, = gross x purity%), rate ("Rate (Reduce Tax)").
 * - Money fields (Metal Value, Taxable Value, ...) land asynchronously one at
 *   a time from the tax engine - assert via the self-consistency poll.
 */
class BullionInwardPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Bullion Inward');
    this.addItemBtn = page.getByRole('button', { name: 'Add Items' });
    // The save endpoint - narrow, because the data grid refreshes via POSTs
    // that also contain "Inward" (GetAllBullionInwardWithPagination).
    this.submitApiPattern = /CreateBullionInward/i;
  }

  async open() {
    await this.goto('/prc/app-bullion-list');
    await this.tab.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('generationType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Input inside an <app-sioniq-input controlname="..."> component. */
  inputCtl(controlname) {
    return this.page.locator(`app-sioniq-input[controlname="${controlname}"] input`).first();
  }

  async numberOfCtl(controlname) {
    const raw = await this.inputCtl(controlname).inputValue();
    return Number(String(raw).replace(/,/g, '') || 0);
  }

  /** The whole single-screen entry, in dependency order. */
  async fillEntry({ generationType, vendor, invoiceNo, invoiceDate, groupCategory, category, article, rateFixationType, purity, grossWeight, rate }) {
    const picked = {};
    picked.generationType = await this.pick('generationType', generationType);
    picked.vendor = await this.pick('vendor', vendor, { search: true });

    await this.fillByLabel('Invoice Number', invoiceNo);
    await this.invoiceDate.fill(invoiceDate);
    await this.invoiceDate.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup

    picked.groupCategory = await this.pick('groupCategory', groupCategory);
    picked.category = await this.pick('category', category);
    picked.article = await this.pick('article', article, { search: true });
    picked.rateFixationType = await this.pick('rateFixationType', rateFixationType);
    picked.purity = await this.pick('purity', purity);

    const gross = this.inputCtl('grossWt');
    await gross.fill(String(grossWeight));
    await gross.blur();

    const rateInput = this.inputCtl('rate');
    await rateInput.fill(String(rate));
    await rateInput.blur();

    return picked;
  }

  /**
   * Additional Charges (added to the app after this spec was first built).
   * The form has TWO Additional Charges buttons - item-level (index 0, next
   * to Add Items) and bill-level (index 1, in the lower Remarks section) -
   * and BOTH need a charge row before Add Items, per QA lead 29-08-2026.
   * Flow: open the dialog, pick Charge Type and Charge Name (the rest
   * auto-fills: Fixed / Item / Amount / rate), Add inserts the row, Close.
   */
  async addAdditionalCharge({ buttonIndex = 0, chargeType, chargeName }) {
    await this.page.getByRole('button', { name: 'Additional Charges' }).nth(buttonIndex).click();
    const dlg = this.page
      .locator('[role="dialog"], .modal, ngb-modal-window')
      .filter({ hasText: 'Additional Charges' })
      .first();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });

    await this.pick('additionalCharges', chargeType);
    await this.pick('template', chargeName);
    await this.page.waitForTimeout(2_000); // let Calculation Base / Rate auto-fill

    // "Add" inserts the charge row into the dialog grid
    const addBtn = dlg.locator('button').filter({ hasText: /^\s*Add\s*$/ }).last();
    await addBtn.click();
    await dlg.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 15_000 });

    await dlg.locator('button').filter({ hasText: /Close/ }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await this.waitForIdle();
  }

  /**
   * Add Items with proof: the click is a silent no-op when any control is
   * still flagged invalid, so poll the summary panel for the expected gross
   * weight and retry the click once before giving up.
   */
  async addItemsAndVerify(expectedGrossText) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.addItemBtn.click();
      const ok = await this.pollSummaryFor(expectedGrossText, 15_000);
      if (ok) return;
    }
    throw new Error(
      `Add Items never registered - summary panel does not show "${expectedGrossText}". ` +
      'A form control is likely still ng-invalid.',
    );
  }

  async pollSummaryFor(text, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await this.summaryText()).includes(text)) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }
}

module.exports = { BullionInwardPage };
