const { OrderBookingPage } = require('./OrderBookingPage');

/**
 * B2B Order Booking — Sales & Distribution > B2B > Order, "B2B Order Booking"
 * tab of /sls/order-booking. Same 2-step shape as Order Booking with extra
 * General Order Information fields: Purpose Type, Customer (address panel
 * auto-fills from it), Customer Branch (optional), Making Type, Order Given
 * By and Contact Number (both label-reached text inputs, no ids).
 */
class B2BOrderBookingPage extends OrderBookingPage {
  constructor(page) {
    super(page);
    this.tabName = 'B2B Order Booking';
    this.tab = page.getByRole('tab', { name: 'B2B Order Booking' });
  }

  async open() {
    await this.goto('/sls/order-booking');
    await this.tab.waitFor({ state: 'visible', timeout: 30_000 });
    await this.tab.click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('purposeType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** B2B General Order Information, per the QA lead's screenshot. */
  async fillOrderDetails({ purposeType, customer, itemType, makingType, supervisor, smCode, orderGivenBy, contactNumber, deliveryNote, deliveryDate }) {
    await this.pick('purposeType', purposeType, { exact: true });
    await this.pick('customer', customer, { search: true });
    await this.pick('itemType', itemType);
    await this.pick('makingType', makingType);
    await this.pick('supervisor', supervisor, { search: true });
    await this.pick('smcode', smCode, { search: true });

    await this.fillByLabel('Order Given By', orderGivenBy);
    await this.fillByLabel('Contact Number', contactNumber);
    await this.pick('deliveryNote', deliveryNote);

    const date = this.page.locator('#deliveryDate');
    await date.fill(deliveryDate);
    await date.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
  }

  /**
   * SAMPLE-bearing item (QA lead recordings, 31-08-2026). The main block
   * skips the Article; "Add Sample" opens a sub-form describing the
   * physical sample the customer handed over. Sub-form presets verified
   * live: Sample Type "Customer Sample", Vendor = the customer, Product
   * Type, Received By, SM code, Received Type "In Person" all pre-filled -
   * only the article chain, weights and the manual Rate need entry.
   * The sub-form repeats the main block's labels/controlnames, so its
   * fields are reached via label .last() AFTER the sub-form renders.
   */
  async fillSampleItem({ referenceType, groupCategory, category, article, purity, grossWeight, mainImage, sample }) {
    await this.pick('referenceType', referenceType);
    await this.pick('groupCategory', groupCategory, { exact: true });
    await this.pick('category', category, { exact: true });
    await this.page.waitForTimeout(2_000); // let the article list refilter
    // NO typed search (the search path loses joined fields - same as fillItem)
    await this.pick('article', article);
    await this.pick('purity', purity);
    // the Gross Weight container also holds the disabled "No of Pcs" input -
    // target the enabled one explicitly (same trap as fillItem)
    const mainGross = this.page
      .locator('div.grid, div.form-group')
      .filter({ has: this.page.locator('label:text-is("Gross Weight")') })
      .last()
      .locator('input:not([type=checkbox]):not([disabled])')
      .first();
    await mainGross.fill(String(grossWeight));
    await mainGross.blur();

    // one image on the MAIN item block via its Add Files control
    if (mainImage) await this.attachFileViaAddFiles(mainImage);

    await this.page.getByRole('button', { name: 'Add Sample' }).click();
    await this.page.waitForTimeout(2_500);

    // sub-form article chain (label .last() = the sub-form's instance)
    await this.pickByLabel('Group Category', sample.groupCategory || groupCategory, { exact: true }).catch(() => {});
    await this.pickByLabel('Category', sample.category || category, { exact: true }).catch(() => {});
    await this.pickByLabel('Article', sample.article, { search: true });
    await this.pickByLabel('Purity', sample.purity || purity);

    // sub-form inputs carry ids (#grossWeight / #rate); pieces label is
    // "No. of Pcs" (the main block's is "No of Pcs" - different text)
    await this.fillByLabel('No. of Pcs', sample.pieces ?? 1).catch(() => {});
    const gross = this.page.locator('#grossWeight');
    await gross.fill(String(sample.grossWeight));
    await gross.blur();
    const rate = this.page.locator('#rate');
    await rate.fill(String(sample.rate));
    await rate.blur();
    await this.page.waitForTimeout(1_500);

    // "Used In Production" toggle inside the Add Sample panel - its own
    // control (input#useInProduction / formcontrolname "useInProduction",
    // styled checkbox, off by default; distinct from the order form's
    // hidden #active). Drive via its label when the input is not clickable.
    if (sample.usedInProduction !== undefined) {
      const box = this.page.locator('#useInProduction');
      const on = await box.isChecked().catch(() => false);
      if (on !== sample.usedInProduction) {
        await this.page.locator('label[for="useInProduction"]').click({ timeout: 5_000 })
          .catch(() => box.click({ force: true }));
        await this.page.waitForTimeout(500);
      }
      console.log(`Add Sample panel: Used In Production = ${await box.isChecked().catch(() => '?')}`);
    }

    // a DIFFERENT image on the sample itself, via the PANEL's own Add Files
    // control (the last visible one while the panel is open)
    if (sample.image) await this.attachFileViaAddFiles(sample.image, { last: true });

    // Add Sample is a FULL PANEL with its own Sample Summary, Add Items and
    // Submit (verified live 31-08-2026): Add Items moves the sample into the
    // panel's "Items Added" grid, the panel's Submit closes it back to the
    // main items step. The panel's buttons are the LAST visible instances.
    await this.page.getByRole('button', { name: 'Add Items' }).locator('visible=true').last().click();
    const added = this.page.getByRole('row').filter({ hasText: sample.article }).first();
    await added.waitFor({ state: 'visible', timeout: 20_000 });
    console.log('Add Sample panel: sample listed under Items Added');
    await this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last().click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);
  }

  /** Click Yes when the sample order's post-submit confirmation asks. */
  async confirmYesIfAsked(timeout = 15_000) {
    const yes = this.page.getByRole('button', { name: /^Yes$/ })
      .or(this.page.getByText(/^Yes$/))
      .last();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await yes.isVisible().catch(() => false)) {
        await yes.click().catch(() => {});
        console.log('confirmation dialog: clicked Yes');
        return true;
      }
      await this.page.waitForTimeout(500);
    }
    return false;
  }
}

module.exports = { B2BOrderBookingPage };
