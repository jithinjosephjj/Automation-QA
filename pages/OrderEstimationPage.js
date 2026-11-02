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
    // the Order tab is named "OrderEstimation" (was "Order"; siblings: Reserve
    // Estimation, Unregistered Purchase Estimation, Estimation, Sales Return
    // Estimation) and is the default-active one. A blind click on a missing
    // tab waited out its whole 60 s timeout on every open (02-11-2026) - click
    // only a tab that is there and not already selected.
    const tab = this.page.getByRole('tab', { name: /^Order\s*(Estimation)?$/i }).locator('visible=true').first();
    if (await tab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const selected = (await tab.getAttribute('aria-selected').catch(() => '')) === 'true' || /\bactive\b/.test((await tab.getAttribute('class').catch(() => '')) || '');
      if (!selected) {
        await tab.click({ timeout: T(15_000) }).catch(() => {});
        await this.waitForIdle();
      }
    } else {
      console.log(`${this.tabName}: no "Order" / "OrderEstimation" tab on the page - using the default view`);
    }
    await this.settle(1_500);
  }

  /** Fill the configuration, one metal item (Add Item) and Submit. Returns the save body. */
  async createEstimation({
    customer, businessType = 'Retail', transactionType = 'Job Work', itemType = 'Metal', salesExecutive = 'Abc',
    supervisor, helper, deliveryNote, deliveryDate,
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
    // a Regular (non job-work) order asks for a Delivery Date (DD/MM/YYYY) in the
    // item entry (02-11-2026: Add Item staged nothing while it was empty)
    const delivery = this.page.getByRole('textbox', { name: /Delivery Date/i }).locator('visible=true').first();
    if (deliveryDate === undefined) {
      // a week after the app's PROCESS date (the header chip; qa pins it, so the system clock is wrong here)
      const pd = (await this.processDate().catch(() => '')) || '';
      const m = pd.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]) + 7);
        const pad = (n) => String(n).padStart(2, '0');
        deliveryDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      }
    }
    if (deliveryDate && (await delivery.isVisible({ timeout: 1_500 }).catch(() => false)) && !(await delivery.inputValue().catch(() => ''))) {
      await delivery.fill(String(deliveryDate));
      await delivery.press('Escape').catch(() => {});
      await delivery.blur().catch(() => {});
      await this.settle(800);
      console.log(`estimation: delivery date "${await delivery.inputValue().catch(() => '')}"`);
    }
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();

    const addItem = this.page.getByRole('button', { name: /^\s*Add Item\s*$/ }).locator('visible=true').last();
    await addItem.click({ timeout: T(15_000) });
    await this.settle(2_500);
    const rows = this.page.locator('table tbody tr').locator('visible=true').filter({ hasText: article });
    if (!(await rows.first().isVisible({ timeout: 8_000 }).catch(() => false))) {
      // the item did not stage: report what the form flags, fill the empty mandatory selects and try once more
      const invalid = await this.invalidControls().catch(() => []);
      const alerts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      console.log(`estimation: Add Item staged nothing - invalid ${JSON.stringify(invalid).slice(0, 400)}; alerts ${JSON.stringify(alerts)}`);
      if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
      await addItem.click({ timeout: T(15_000) });
      await this.settle(2_500);
    }
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

  /**
   * RESERVE ESTIMATION - the "Reserve Estimation" tab of the same page (probed
   * 02-11-2026 at Kakkanad): Customer / Member (mobile back-fills, read-only),
   * Business Type [B2C | Retail], Estimation Type [masterDataValueID_StockSourceType:
   * TagWise | Locker], Sales Executive (names; Sales Code back-fills), Supervisor,
   * Helper, Scan Type [Tag Number] -> after the type picks a "Scan Tag / RFID"
   * box (input#scanValue) appears; the scan fills Tag Details / Add Weight
   * Details / Add Pricing Details (Wastage % 13, Metal Rate 12880 editable,
   * optional Rate Cut + delivery date / note) and "Add Item" moves the tag into
   * "Scanned Tags Information". Next leads to the Payment step; the estimation
   * is saved there (the advance itself is collected on the Advance Registration
   * page). Returns the save body.
   */
  async createReserveEstimation({
    customer, businessType = 'Retail', estimationType = 'TagWise', salesExecutive = 'Chandu', supervisor, helper,
    tagNo, rfidNo, metalRate, remarks, additionalCharges = false,
    payment = { mode: 'Cash', amount: 1000 }, // the advance collected with the estimation; { amount: undefined } pays the full balance
  }) {
    await this.open();
    const tab = this.page.getByRole('tab', { name: /Reserve Estimation/i }).locator('visible=true').first();
    await tab.click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(1_500);
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('customerID').waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Reserve Estimation: the Add form did not open after 4 clicks on "+" (POS counter validation? log in through the form)');
    }
    await this.settle(2_000);

    await this.pick('customerID', customer, { search: true });
    await this.settle(2_000);
    await this.pickUnlessSet('masterDataValueID_BusinessType', businessType);
    await this.settle(1_200);
    await this.pickUnlessSet('masterDataValueID_StockSourceType', estimationType);
    await this.settle(1_500);
    await this.pick('salesExecutiveID', salesExecutive, { search: true });
    await this.settle(1_500);
    if (supervisor) await this.pick('supervisorID', supervisor, { search: true }).catch(() => {});
    if (helper) await this.pick('helperID', helper, { search: true }).catch((e) => console.log(`reserve estimation: helper skipped - ${String(e).slice(0, 100)}`));
    await this.closeStalePanels();
    if (remarks) await this.page.locator('input#remarks, textarea#remarks, [formcontrolname="remarks"]').locator('visible=true').first().fill(remarks).catch(() => {});

    // scan the tag (RFID when known - tag numbers repeat on qa)
    if (rfidNo) await this.pick('masterDataValueID_ScanType', 'Rfid', { exact: false }).catch(() => {});
    const scan = this.page.locator('input#scanValue, input[placeholder*="tag number" i], input[placeholder*="Scan" i]').locator('visible=true').first();
    await scan.waitFor({ state: 'visible', timeout: T(15_000) });
    const value = rfidNo || tagNo;
    await scan.fill(String(value));
    const scanned = this.page.waitForResponse((r) => /Tag|Scan|Estimation/i.test(r.url()) && !/KeepAlive|GetAll|Pagination|GetMasterData|Translation/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 30_000 }).catch(() => null);
    await scan.press('Enter');
    const tagField = this.page.locator('xpath=//label[normalize-space(text())="Tag No"]/following::input[1]').locator('visible=true').first();
    if (!(await tagField.isVisible({ timeout: 4_000 }).catch(() => false))) {
      const btn = this.page.getByRole('button', { name: /^\s*Scan\s*$/ }).locator('visible=true').last();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) await btn.click({ timeout: 5_000 }).catch(() => {});
    }
    const r = await scanned;
    if (r) console.log(`reserve estimation: scan ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 200)}`);
    await this.waitForIdle();
    await this.settle(2_000);
    const toasts = async () => (await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!(await tagField.isVisible({ timeout: 15_000 }).catch(() => false)) || (await tagField.inputValue().catch(() => '')) !== String(tagNo)) {
      throw new Error(`Reserve Estimation: the scan of tag "${tagNo}" filled no Tag Details (Tag No field "${await tagField.inputValue().catch(() => '-')}"). Toasts: ${JSON.stringify(await toasts())}`);
    }
    const detail = async (lbl) => this.page.locator(`xpath=//label[normalize-space(text())="${lbl}"]/following::input[1]`).locator('visible=true').first().inputValue().catch(() => '');
    console.log(`reserve estimation: tag ${tagNo} -> ${await detail('Article')} | ${await detail('Purity')} | gross ${await detail('Gross Weight')} | metal rate ${await detail('Metal Rate')} | amount ${await detail('Amount')}`);
    if (metalRate !== undefined) {
      const rate = this.page.locator('xpath=//label[normalize-space(text())="Metal Rate"]/following::input[1]').locator('visible=true').first();
      if (await rate.isEnabled().catch(() => false)) { await rate.fill(String(metalRate)); await rate.blur(); await this.settle(1_500); }
    }
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();

    // Add Item -> Scanned Tags Information
    const itemsCount = async () => this.page.evaluate(() => { const m = document.body.innerText.replace(/\s+/g, ' ').match(/No\. of Items\s*:\s*(\d+)/); return m ? Number(m[1]) : 0; }).catch(() => 0);
    const before = await itemsCount();
    await this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(2_500);
    const row = this.page.locator('table tbody tr').locator('visible=true').filter({ hasText: String(tagNo) }).first();
    const staged = async () => (await itemsCount()) > before || (await row.isVisible().catch(() => false));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(await staged())) await this.page.waitForTimeout(500);
    if (!(await staged())) throw new Error(`Reserve Estimation: "Add Item" did not move tag ${tagNo} into Scanned Tags (No. of Items ${await itemsCount()}). Toasts: ${JSON.stringify(await toasts())}; invalid: ${JSON.stringify(await this.invalidControls())}`);
    console.log(`reserve estimation: tag ${tagNo} added to Scanned Tags (No. of Items ${await itemsCount()})`);

    const chargesBtn = this.page.getByRole('button', { name: /Additional Charges/ }).locator('visible=true').last();
    if (additionalCharges && (await chargesBtn.isVisible({ timeout: 1_500 }).catch(() => false))) {
      await this.addAdditionalCharges({ ...(typeof additionalCharges === 'object' ? additionalCharges : {}), index: (await chargesBtn.count()) - 1 }).catch((e) => console.log(`reserve estimation: additional charges skipped - ${String(e).slice(0, 120)}`));
    }

    // The reserve estimation collects money itself: "Proceed to Payment" opens
    // the Payment Collection dialog (Cash Test Mode at Kakkanad); the paid
    // amount is the customer's advance (a partial amount by default - the
    // Advance Registration step adds to it), then Submit saves the estimation.
    if (payment) await this.collectPayment({ ...payment, what: 'reserve estimation' });
    const fields = await this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}${n.classList.contains('ng-invalid') ? '*' : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? '*' : ''}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15),
      };
    }).catch(() => ({}));
    console.log(`reserve estimation: after the payment - ${JSON.stringify(fields).slice(0, 1800)}`);
    await this.page.screenshot({ path: 'test-results/screens/reserve-estimation-after-payment.png', fullPage: true }).catch(() => {});
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    // the forward button turns into "Save" once a payment entry exists (the
    // Next of the empty form); accept Save or Submit
    let submitBtn = this.page.getByRole('button', { name: /(Save|Submit)\s*$/ }).locator('visible=true').last();
    if (!(await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      const next = this.page.getByRole('button', { name: /Next\s*$/ }).locator('visible=true').last();
      if (await next.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await next.click({ timeout: T(15_000) });
        await this.waitForIdle();
        await this.settle(2_500);
        submitBtn = this.page.getByRole('button', { name: /(Save|Submit)\s*$/ }).locator('visible=true').last();
      }
    }

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /Estimation|Reserve/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Scan|Get[A-Z]\w*$/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    if (!(await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      const now = (await this.page.locator('button').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(`Reserve Estimation: no Save / Submit button after the payment - buttons ${JSON.stringify(now)}`);
    }
    await submitBtn.click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const res = await resp;
    if (!res) {
      throw new Error(`Reserve Estimation Submit fired no save request - invalid: ${JSON.stringify(await this.invalidControls())}; alerts: ${JSON.stringify(await toasts())}`);
    }
    const body = await res.json().catch(() => null);
    console.log('reserve estimation save:', res.status(), res.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('reserve estimation', toast).catch(() => {});
    if (res.status() >= 400 || (body && body.errorCode)) throw new Error(`Reserve Estimation rejected (HTTP ${res.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    await this.closePostSaveDialog(4_000).catch(() => {});
    return body;
  }

  /** The estimation number from a save body (receiptNo / docNo / estimationNo). */
  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.docNo || d.estimationNo || d.orderEstimationNo || d.voucherNo || '';
  }
}

module.exports = { OrderEstimationPage };
