const { StockInwardBasePage } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Advance Registration — Retail Operations > Operations > Registrations.
 * Route: /pos/view-order-advance-registration (mapped live 22-10-2026 at the
 * Cochin login). "Collect an advance against an approved estimation."
 *
 * Step 1 Order Details: Mobile Number / Customer, Advance Type (Order |
 * Reserve | General), Type [advanceSubType] (Registration), Business Type
 * (Retail - offered only after the customer), Entry Type [orderEntryMode]
 * (Direct | Estimation) -> Estimation Details: Estimation Number + Fetch ->
 * Final Amount, Remarks -> Next -> Step 2 Build Order Items -> Submit.
 * Advance Type General (02-11-2026) is a different wizard - see
 * registerGeneralAdvance.
 *
 * The POS "+" only opens the form on a session that went through the login
 * FORM - a replayed session cache lacks the POS counter binding (user
 * 22-10-2026: "login again and check - counter validation issue"), so the
 * spec clears the session cache before this step.
 */
class AdvanceRegistrationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Advance Registration');
    this.submitApiPattern = /Advance|Registration/i;
  }

  /** The POS list pages keep hidden filter selects with the form's controlnames - only the visible one counts. */
  select(controlname) {
    return this.page
      .locator(`sioniq-ng-select[controlname="${controlname}"] ng-select, ng-select[formcontrolname="${controlname}"]`)
      .locator('visible=true').first();
  }

  async open() {
    await this.goto('/pos/view-order-advance-registration');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(2_000);
  }

  async openAddForm() {
    for (let i = 0; i < 3; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('customerID').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) return;
      const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      console.log(`advance registration: Add form not open after click ${i + 1}${alerts.length ? ` - alerts ${JSON.stringify(alerts)}` : ''}`);
    }
    throw new Error('Advance Registration: the Add form did not open (POS counter validation? log in through the form, not the session cache)');
  }

  async visibleFields() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.trim() : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    }).catch(() => ({}));
  }

  /**
   * Register an advance against an estimation. Returns the save body.
   * `amount` (optional) is typed into the first enabled amount-like input of
   * step 2 when the form asks for a payment.
   */
  async registerAgainstEstimation({ customer, estimationNo, advanceType = 'Order', subType = 'Registration', businessType = 'Retail', entryType = 'Estimation', remarks, amount, paymentMode, panNo = 'ABCDE1234F' }) {
    await this.open();
    await this.openAddForm();
    await this.settle(2_000);

    await this.pick('customerID', customer, { search: true });
    await this.settle(2_000);
    await this.pick('advanceType', advanceType, { exact: true });
    await this.settle(1_500);
    if (subType && (await this.select('advanceSubType').count())) {
      const current = await this.selectValue('advanceSubType').catch(() => '');
      if (current !== subType) await this.pick('advanceSubType', subType, { exact: true }).catch(() => {});
    }
    // Business Type can be pre-filled from the customer (seen on the estimation form 23-10-2026)
    const currentBt = (await this.selectValue('businessType').catch(() => '')) || '';
    if (currentBt.toLowerCase().includes(businessType.toLowerCase())) console.log(`advance registration: businessType already "${currentBt}" - pick skipped`);
    else await this.pick('businessType', businessType, { exact: true });
    await this.settle(1_500);
    await this.pick('orderEntryMode', entryType, { exact: true });
    await this.settle(2_000);

    // Estimation Details: an "Estimation Number" box + Fetch (Order), or - the
    // Reserve variant (02-11-2026, "Reserve Estimation Details") - whatever the
    // section renders: the same box, or a select listing the open reserve
    // estimations. Either way the estimation's amount must land in the form.
    const estInput = this.page.locator('input[formcontrolname="estimationNumber"], [controlname="estimationNumber"] input, input[placeholder*="stimation" i]').locator('visible=true').first();
    let finalAmount = '';
    if (await estInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await estInput.fill(String(estimationNo));
      await estInput.blur();
      const fetched = this.page.waitForResponse((r) => /Estimation/i.test(r.url()) && !/KeepAlive/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
      const fetch = this.page.getByRole('button', { name: /Fetch/ }).locator('visible=true').last();
      if (await fetch.isVisible({ timeout: 2_000 }).catch(() => false)) await fetch.click({ timeout: T(15_000) });
      else await estInput.press('Enter');
      const fr = await fetched;
      if (fr) console.log(`advance registration: fetch ${fr.status()} ${fr.url().split('/').slice(-2).join('/')}`);
    } else {
      // a select in the estimation-details section: the first still-empty
      // select below the configuration ones, picked by the estimation number
      const known = new Set(['customerID', 'advanceType', 'advanceSubType', 'businessType', 'orderEntryMode']);
      const names = await this.page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent).map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname')));
      const ctl = names.find((n) => !known.has(n) && !/dialCode|country|phone/i.test(n));
      console.log(`advance registration: no Estimation Number box - selects on the form ${JSON.stringify(names)} -> estimation select "${ctl || '(none)'}"`);
      if (!ctl) throw new Error(`Advance Registration: neither an Estimation Number box nor an estimation select is offered for ${advanceType} - fields: ${JSON.stringify(await this.visibleFields()).slice(0, 900)}`);
      await this.pick(ctl, String(estimationNo), { search: true });
    }
    await this.waitForIdle();
    await this.settle(2_500);
    finalAmount = await this.page.locator('xpath=//label[normalize-space(text())="Final Amount"]/following::input[1]').locator('visible=true').first().inputValue().catch(() => '');
    const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (alerts.length) console.log(`advance registration: alerts after the estimation fetch ${JSON.stringify(alerts)}`);
    if (!Number(String(finalAmount).replace(/[^0-9.]/g, ''))) {
      // no Final Amount box (Reserve): the summary's item count / payable value is the proof the estimation loaded
      const summary = await this.page.evaluate(() => { const t = document.body.innerText.replace(/\s+/g, ' '); const items = (t.match(/No\. of Items\s*:\s*(\d+)/) || [])[1]; const payable = (t.match(/Net Payable(?: Value)?\s*:?\s*[₹]?\s*([\d,]+\.?\d*)/i) || [])[1]; return { items: Number(items || 0), payable: payable || '' }; }).catch(() => ({ items: 0, payable: '' }));
      console.log(`advance registration: estimation ${estimationNo} loaded - no Final Amount box; summary ${JSON.stringify(summary)}`);
      if (!summary.items && !Number(String(summary.payable).replace(/[^0-9.]/g, ''))) {
        throw new Error(`Advance Registration: estimation ${estimationNo} did not load (Final Amount "${finalAmount}", summary ${JSON.stringify(summary)}, alerts: ${JSON.stringify(alerts)}); fields: ${JSON.stringify(await this.visibleFields()).slice(0, 900)}`);
      }
      finalAmount = String(summary.payable || '');
    } else {
      console.log(`advance registration: estimation ${estimationNo} fetched - Final Amount "${finalAmount}"`);
    }
    if (remarks) await this.page.locator('input[formcontrolname="description"], [controlname="description"] input, input[placeholder="Remarks"]').locator('visible=true').first().fill(remarks).catch(() => {});

    // after a successful Fetch the wizard offers "Proceed to Payment" (user 22-10-2026)
    const proceed = this.page.getByRole('button', { name: /Proceed to Payment/ }).locator('visible=true').last();
    if (await proceed.isVisible({ timeout: 5_000 }).catch(() => false)) await proceed.click({ timeout: T(15_000) });
    else await this.page.getByRole('button', { name: /Next/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(3_000);
    console.log(`advance registration payment step: ${JSON.stringify(await this.visibleFields()).slice(0, 2500)}`);
    await this.page.screenshot({ path: 'test-results/screens/advance-registration-payment.png', fullPage: true }).catch(() => {});

    // Payment Collection dialog (QA lead 22-10-2026): the shared helper in
    // StockInwardBasePage - the mode is matched by substring because Kakkanad
    // offers "Cash Test Mode" / "Cash Test Mode 2" and no plain "Cash"
    // (02-11-2026); the balance due is paid unless `amount` says otherwise.
    const dlgOpen = this.page.locator('.modal, [role="dialog"], ngb-modal-window').filter({ hasText: /Payment Collection|PAYMENT MODES/i }).locator('visible=true').last();
    if (await dlgOpen.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // "Proceed to Payment" was already pressed above - close and let the helper reopen it
      await dlgOpen.getByRole('button', { name: /^Close$/i }).locator('visible=true').last().click({ timeout: 5_000 }).catch(() => {});
      await this.settle(1_000);
    }
    const paid = await this.collectPayment({ mode: paymentMode || 'Cash', amount: amount !== undefined ? amount : undefined, what: 'advance registration' });
    if (!paid) throw new Error(`Advance Registration: no payment was collected (fields: ${JSON.stringify(await this.visibleFields()).slice(0, 600)})`);
    return this.submitAdvance({ panNo, what: 'advance registration' });
  }

  /**
   * Register a GENERAL advance (no estimation / order behind it) - Advance Type
   * General, Business Type Retail. Mapped 02-11-2026 at Kakkanad: the wizard
   * becomes "Step 1 Customer Details / Step 2 Advance Details" - Customer,
   * Advance Type General, Business Type -> Advance Details block: Sales
   * Executive (Sales Executive Code back-fills), Supervisor (optional - and
   * "Selected Supervisor is not in the approved list." rejects an unapproved
   * one, e.g. Abc), Advance Amount, Remarks. Once the amount is in, the footer
   * is Proceed to Payment / Previous / Submit (no Next); the Payment section
   * shows Invoice Total / Total Received / Balance Due. Submit posts
   * OrderAdvanceRegistration/SaveGeneralAdvanceRegistration (receiptNo "ADV-004KK").
   * Returns the save body.
   */
  async registerGeneralAdvance({ customer, businessType = 'Retail', salesExecutive = 'Chandu', supervisor, amount, remarks, paymentMode = 'Cash', paymentAmount, panNo = 'ABCDE1234F' }) {
    if (!amount) throw new Error('registerGeneralAdvance: amount is required');
    await this.open();
    await this.openAddForm();
    await this.settle(2_000);

    await this.pick('customerID', customer, { search: true });
    await this.settle(2_000);
    await this.pick('advanceType', 'General', { exact: true });
    await this.settle(1_500);
    const currentBt = (await this.selectValue('businessType').catch(() => '')) || '';
    if (currentBt.toLowerCase().includes(businessType.toLowerCase())) console.log(`general advance: businessType already "${currentBt}" - pick skipped`);
    else await this.pick('businessType', businessType, { exact: true });
    await this.settle(1_500);

    // Advance Details
    await this.select('salesExecutiveID').waitFor({ state: 'visible', timeout: T(15_000) });
    await this.pick('salesExecutiveID', salesExecutive, { search: true });
    await this.settle(1_500);
    const salesCode = await this.page.locator('input#salesCode, input[formcontrolname="salesCode"], [controlname="salesCode"] input').locator('visible=true').first().inputValue().catch(() => '');
    console.log(`general advance: sales executive "${salesExecutive}" -> Sales Executive Code "${salesCode}"`);
    if (supervisor) { await this.pick('supervisorID', supervisor, { search: true }); await this.settle(1_000); }
    const adv = this.page.locator('input#advanceAmount, input[formcontrolname="advanceAmount"], [controlname="advanceAmount"] input, input[placeholder="Advance Amount"]').locator('visible=true').first();
    await adv.fill(String(amount));
    await adv.blur();
    if (remarks) await this.page.locator('input[formcontrolname="description"], [controlname="description"] input, input[placeholder="Remarks"]').locator('visible=true').first().fill(remarks).catch(() => {});
    await this.waitForIdle();
    await this.settle(2_000);
    const summary = await this.page.evaluate(() => { const t = document.body.innerText.replace(/\s+/g, ' '); return { total: (t.match(/Invoice Total\s*([\d,]+\.?\d*)/i) || [])[1] || '', due: (t.match(/Balance Due\s*([\d,]+\.?\d*)/i) || [])[1] || '' }; }).catch(() => ({}));
    console.log(`general advance: amount ${amount} -> Invoice Total "${summary.total}", Balance Due "${summary.due}"; fields ${JSON.stringify(await this.visibleFields()).slice(0, 700)}`);
    if (!Number(String(summary.total).replace(/[^0-9.]/g, ''))) throw new Error(`General advance: the Advance Amount ${amount} did not land in the Payment section (summary ${JSON.stringify(summary)})`);

    const paid = await this.collectPayment({ mode: paymentMode, amount: paymentAmount !== undefined ? paymentAmount : amount, what: 'general advance' });
    if (!paid) throw new Error(`General advance: no payment was collected (fields: ${JSON.stringify(await this.visibleFields()).slice(0, 600)})`);
    return this.submitAdvance({ panNo, what: 'general advance' });
  }

  /**
   * Submit the open advance form (after the payment is collected), answer the
   * PAN dialog when it opens, and return the save body.
   */
  async submitAdvance({ panNo = 'ABCDE1234F', what = 'advance registration' } = {}) {
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();

    const resp = this.page.waitForResponse(
      // UpdateCustomerPAN (the PAN dialog's Update) also sits under the Advance
      // Registration controller - it is NOT the save (02-11-2026)
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /Advance|Registration|Order/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|PAN|Get[A-Z]\w*$/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    await this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    // a cash advance over the PAN threshold opens a PAN dialog (input panNo,
    // Cancel / Update) instead of saving (02-11-2026, ₹7.6 lakh): enter the
    // customer's PAN and Update, then the save fires
    // the dialog: heading "PAN", caption "PAN Number", the textbox inside a
    // [controlname="panNo"] wrapper, buttons " Cancel" / " Update" (icon glyphs)
    const panDlg = this.page.locator('.modal, ngb-modal-window, [role="dialog"]').filter({ hasText: /PAN Number/i }).locator('visible=true').last();
    const pan = panDlg.locator('[controlname="panNo"] input, input[formcontrolname="panNo"], input#panNo, input').locator('visible=true').first();
    if (await pan.isVisible({ timeout: 8_000 }).catch(() => false)) {
      console.log(`${what}: PAN dialog opened (holds "${await pan.inputValue().catch(() => '')}") - entering ${panNo}`);
      await pan.fill(String(panNo));
      await pan.blur();
      await panDlg.getByRole('button', { name: /Update\s*$/ }).locator('visible=true').last().click({ timeout: T(10_000) });
      await this.settle(1_500);
      const again = this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last();
      if (!(await Promise.race([resp.then((x) => !!x), this.page.waitForTimeout(5_000).then(() => false)])) && (await again.isVisible().catch(() => false))) {
        await again.click({ timeout: T(15_000) }).catch(() => {});
      }
    }
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const late = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(`${what}: Submit fired no save request - invalid: ${JSON.stringify(diag)}; alerts: ${JSON.stringify(late)}; fields: ${JSON.stringify(await this.visibleFields()).slice(0, 800)}`);
    }
    const body = await r.json().catch(() => null);
    console.log(`${what} save:`, r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast(what, toast).catch(() => {});
    // e.g. 501 {"errorCode":1003,"error":"Selected Supervisor is not in the approved list."} (02-11-2026)
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`${what} rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return body;
  }

  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.advanceReceiptNo || d.docNo || d.voucherNo || '';
  }
}

module.exports = { AdvanceRegistrationPage };
