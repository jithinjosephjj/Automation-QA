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
  async registerAgainstEstimation({ customer, estimationNo, advanceType = 'Order', subType = 'Registration', businessType = 'Retail', entryType = 'Estimation', remarks, amount, paymentMode }) {
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
    await this.pick('businessType', businessType, { exact: true });
    await this.settle(1_500);
    await this.pick('orderEntryMode', entryType, { exact: true });
    await this.settle(2_000);

    const estInput = this.page.locator('input[formcontrolname="estimationNumber"], [controlname="estimationNumber"] input, input[placeholder="Estimation number"]').locator('visible=true').first();
    await estInput.fill(String(estimationNo));
    await estInput.blur();
    const fetched = this.page.waitForResponse((r) => /Estimation/i.test(r.url()) && !/KeepAlive/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
    await this.page.getByRole('button', { name: /Fetch/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const fr = await fetched;
    if (fr) console.log(`advance registration: fetch ${fr.status()} ${fr.url().split('/').slice(-2).join('/')}`);
    await this.waitForIdle();
    await this.settle(2_500);
    const finalAmount = await this.page.locator('xpath=//label[normalize-space(text())="Final Amount"]/following::input[1]').first().inputValue().catch(() => '');
    console.log(`advance registration: estimation ${estimationNo} fetched - Final Amount "${finalAmount}"`);
    const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (alerts.length) console.log(`advance registration: alerts after Fetch ${JSON.stringify(alerts)}`);
    if (!Number(String(finalAmount).replace(/[^0-9.]/g, ''))) throw new Error(`Advance Registration: Fetch of estimation ${estimationNo} left Final Amount "${finalAmount}" (alerts: ${JSON.stringify(alerts)})`);
    if (remarks) await this.page.locator('input[formcontrolname="description"], [controlname="description"] input, input[placeholder="Remarks"]').locator('visible=true').first().fill(remarks).catch(() => {});

    // after a successful Fetch the wizard offers "Proceed to Payment" (user 22-10-2026)
    const proceed = this.page.getByRole('button', { name: /Proceed to Payment/ }).locator('visible=true').last();
    if (await proceed.isVisible({ timeout: 5_000 }).catch(() => false)) await proceed.click({ timeout: T(15_000) });
    else await this.page.getByRole('button', { name: /Next/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(3_000);
    console.log(`advance registration payment step: ${JSON.stringify(await this.visibleFields()).slice(0, 2500)}`);
    await this.page.screenshot({ path: 'test-results/screens/advance-registration-payment.png', fullPage: true }).catch(() => {});

    // Payment Collection dialog (QA lead 22-10-2026): payment mode Cash, the
    // Balance Due amount, add the payment, then the registration's Submit.
    const dlg = this.page.locator('.modal, [role="dialog"], ngb-modal-window').filter({ hasText: /Payment Collection|PAYMENT MODES/i }).locator('visible=true').last();
    await dlg.waitFor({ state: 'visible', timeout: T(15_000) });
    const mode = paymentMode || 'Cash';
    await dlg.locator('button').filter({ hasText: new RegExp(`^\\s*${mode}\\s*(Alt\\s*\\+\\s*\\d+)?\\s*\\d*\\s*$`, 'i') }).first().click({ timeout: T(10_000) });
    await this.settle(1_500);
    const due = ((await dlg.locator('xpath=.//*[contains(normalize-space(.),"BALANCE DUE")]/following::*[contains(text(),"₹")][1]').first().textContent().catch(() => '')) || '').replace(/[^0-9.]/g, '');
    const pay = amount !== undefined ? amount : (due || finalAmount.replace(/[^0-9.]/g, ''));
    console.log(`advance registration: payment mode ${mode}, balance due "${due}" -> paying ${pay}`);
    // the mode's panel ("CASH PAYMENT") holds AMOUNT (first input after its heading), DESCRIPTION and "+ Add Cash"
    let amt = dlg.locator(`xpath=.//*[self::h5 or self::h6][contains(translate(normalize-space(.),"abcdefghijklmnopqrstuvwxyz","ABCDEFGHIJKLMNOPQRSTUVWXYZ"),"${mode.toUpperCase()} PAYMENT")]/following::input[not(@type="checkbox")][1]`).first();
    if (!(await amt.count())) amt = dlg.locator('input:not([type=checkbox]):not([readonly]):not([disabled])').locator('visible=true').first();
    await amt.fill(String(pay));
    await amt.blur();
    await this.settle(1_000);
    const addPay = dlg.locator('button').filter({ hasText: new RegExp(`Add ${mode}`, 'i') }).locator('visible=true').last();
    await addPay.click({ timeout: T(10_000) });
    await this.waitForIdle();
    await this.settle(2_000);
    const entries = (await dlg.locator('table tbody tr').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => !/No entries/i.test(t));
    console.log(`advance registration: payment entries ${JSON.stringify(entries.slice(0, 3))}; collected: ${((await dlg.innerText().catch(() => '')) || '').match(/₹[\d,.]+ collected/)?.[0] || '?'}`);
    if (!entries.length) throw new Error(`Advance Registration: the ${mode} payment of ${pay} was not added (fields: ${JSON.stringify(await this.visibleFields()).slice(0, 600)})`);
    // close the collection dialog, then the registration's own Submit
    const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) { await close.click({ timeout: 5_000 }).catch(() => {}); await this.settle(1_500); }
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /Advance|Registration|Order/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Get[A-Z]\w*$/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    await this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const late = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(`Advance Registration Submit fired no save request - invalid: ${JSON.stringify(diag)}; alerts: ${JSON.stringify(late)}; fields: ${JSON.stringify(await this.visibleFields()).slice(0, 800)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('advance registration save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('advance registration', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Advance Registration rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return body;
  }

  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.advanceReceiptNo || d.docNo || d.voucherNo || '';
  }
}

module.exports = { AdvanceRegistrationPage };
