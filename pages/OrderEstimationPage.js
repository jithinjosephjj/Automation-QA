const { StockInwardBasePage } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Order Estimation — Retail Operations > Operations > Estimations, "Order"
 * tab. Route: /pos/app-order-estimation-setup (mapped live 22-10-2026 at the
 * Cochin login).
 *
 * One scrolling form: Order Configuration (Mobile Number / Customer,
 * Business Type, Transaction Type [controlname orderMakingType: Regular |
 * Job Work], Sales Executive -> auto-fills Sales Executive Code, Supervisor,
 * Helper) -> Item Entry (Reference Type -> Group Category [metalID] ->
 * Category -> Article -> Purity, Pieces, Gross Weight; the "+" beside the
 * weights open the component / stone dialogs - NOT used, metal only) ->
 * "Add Item" stages the row in Order Items -> Submit (green, bottom right;
 * "Proceed to Payment" is the alternative that collects money on the spot -
 * the chain registers the advance on its own page instead).
 */
class OrderEstimationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Order Estimation');
    this.submitApiPattern = /Estimation|Order/i;
  }

  /** The POS list pages keep hidden filter selects with the form's controlnames - only the visible one counts. */
  select(controlname) {
    return this.page
      .locator(`sioniq-ng-select[controlname="${controlname}"] ng-select, ng-select[formcontrolname="${controlname}"]`)
      .locator('visible=true').first();
  }

  /** Pick `want` unless the select already shows it (the app pre-fills some selects and then offers no options). */
  async pickUnlessSet(controlname, want, opts = { exact: true }) {
    const current = (await this.selectValue(controlname).catch(() => '')) || '';
    if (current && current.toLowerCase().includes(String(want).toLowerCase())) {
      console.log(`${this.tabName}: ${controlname} already "${current}" - pick skipped`);
      return;
    }
    await this.pick(controlname, want, opts);
  }

  async open() {
    await this.goto('/pos/app-order-estimation-setup');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.page.getByRole('tab', { name: /^Order$/ }).first().click({ timeout: T(60_000) }).catch(() => {});
    await this.waitForIdle();
    await this.settle(1_500);
  }

  /** Fill the configuration, one metal item (Add Item) and Submit. Returns the save body. */
  async createEstimation({
    customer, businessType = 'Retail', transactionType = 'Job Work', itemType = 'Metal', salesExecutive = 'Abc',
    supervisor, helper, deliveryNote,
    item: { referenceType = 'Combination', groupCategory = 'Gold', category = 'Ring', article = 'Tendulkar', purity = '91.60', pieces = 1, grossWeight = 60 } = {},
    additionalCharges,
  }) {
    await this.open();
    // the "+" is swallowed while the list is still loading (22-10-2026) - click until the form shows
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('customerID').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Order Estimation: the Add form did not open after 4 clicks on "+"');
    }
    await this.settle(2_000);

    await this.pick('customerID', customer, { search: true });
    await this.settle(2_000);
    // Business Type is PRE-FILLED from the customer (23-10-2026: "Retail" set,
    // dropdown then offers nothing) - pick only when it holds something else
    await this.pickUnlessSet('businessType', businessType);
    await this.settle(1_500);
    await this.pickUnlessSet('orderMakingType', transactionType);
    await this.settle(1_500);
    if (await this.select('itemType').count()) {
      await this.pick('itemType', itemType, { exact: true }).catch(() => {});
      await this.settle(1_000);
    }
    await this.pick('salesExecutiveID', salesExecutive, { search: true });
    await this.settle(1_500);
    if (supervisor) await this.pick('supervisorID', supervisor, { search: true });
    if (helper) await this.pick('helperID', helper, { search: true });
    if (deliveryNote) await this.fillByLabel('Order Delivery Note', deliveryNote).catch(() => {});

    // item entry (metal only)
    await this.pick('referenceType', referenceType, { exact: true });
    await this.settle(1_500);
    await this.pick('metalID', groupCategory, { exact: true });
    await this.settle(1_500);
    await this.pick('productCategoryID', category, { exact: true });
    await this.settle(1_500);
    await this.pick('productArticleID', article, { search: true });
    await this.settle(1_500);
    await this.pick('purityID', purity);
    await this.settle(1_500);
    const pcs = this.page.locator('input[formcontrolname="noOfPcs"], [controlname="noOfPcs"] input').locator('visible=true').first();
    if (await pcs.count()) { await pcs.fill(String(pieces)); await pcs.blur(); }
    const gw = this.page.locator('input[formcontrolname="grossWeightTran"], [controlname="grossWeightTran"] input').locator('visible=true').first();
    await gw.fill(String(grossWeight));
    await gw.blur();
    await this.settle(2_000); // pricing (wastage %, making, rate) auto-fills
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();

    const addItem = this.page.getByRole('button', { name: /^\s*Add Item\s*$/ }).locator('visible=true').last();
    await addItem.click({ timeout: T(15_000) });
    await this.settle(2_500);
    const rows = this.page.locator('table tbody tr').locator('visible=true').filter({ hasText: article });
    await rows.first().waitFor({ state: 'visible', timeout: T(15_000) });
    console.log(`estimation: item staged - ${((await rows.first().innerText()) || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`);

    // Additional Charges (mandatory on most forms since 26-09-2026) - added
    // when the button is offered unless opted out
    const chargesBtn = this.page.getByRole('button', { name: /Additional Charges/ }).locator('visible=true').last();
    if (additionalCharges !== false && (await chargesBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await this.addAdditionalCharges({ ...(additionalCharges && typeof additionalCharges === 'object' ? additionalCharges : {}), index: await chargesBtn.count() - 1 }).catch((e) => console.log(`estimation: additional charges skipped - ${String(e).slice(0, 120)}`));
    }

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /Estimation|Order/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Get[A-Z]\w*$/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    // the green Submit's accessible name carries an icon glyph (" Submit")
    const submit = this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last();
    await submit.click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(`Order Estimation Submit fired no save request - invalid: ${JSON.stringify(diag)}; alerts: ${JSON.stringify(alerts)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('estimation save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('order estimation', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Order Estimation rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return body;
  }

  /** The estimation number from a save body (receiptNo / docNo / estimationNo). */
  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.docNo || d.estimationNo || d.orderEstimationNo || d.voucherNo || '';
  }
}

module.exports = { OrderEstimationPage };
