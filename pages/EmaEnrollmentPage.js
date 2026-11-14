const { StockInwardBasePage, escapeRe } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Layaway / EMA Plans > Operations > Enrollment & Collections
 * (/ema/app-enrollment-collection-setup) - mapped live 11-11-2026 at Kakkanad.
 * The page holds two sub-tabs rendered as buttons: "ADP Enrollment" and
 * "ADP Collection" (the headings read EMA ENROLLMENT / EMA COLLECTION; the
 * backend calls the module ADP - endpoints /ADPEnrollment/* and
 * /ADPCollection/*).
 *
 * EMA Enrollment form (Add new record), top to bottom:
 *   Plan & Assignment: Mobile Number (sioniq-ng-select controlname
 *   "mobileNumber" = the +91 dial-code select, plus input#mobileNumber),
 *   Customer / Member [customerID] (server-searched; typing the mobile first
 *   narrows the list to that mobile's customers; the option shows name and
 *   code on two lines, e.g. "Anu" / "aa11"), Plan Type
 *   [masterDataValueID_ADPPlanType] (Customer Deposit Plan | Value-Based Plan
 *   | Weight-Based Plan), EMA Plan [adpPlanID] (filtered by the plan type),
 *   Group Amount [adpPlanGroupID] (appears after the plan), Salesman ID
 *   (input#salesmanCode, back-filled from) Salesman Name [salesmanEmployeeID].
 *   Financial Entry (read-only, from the group amount): Amount, Discount
 *   (auto 2 % plan discount), Final Amount (Amount - Discount), Gold Rate
 *   (the business-date rate), Weight (Amount / Rate).
 *   Payment Modes: "Make Payment" opens the shared Payment Collection dialog
 *   (the one Retail Invoice / Advance Registration use - PAYMENT MODES CARD /
 *   Cheque / Online Test Mode / UPI Test Mode / Cash Test Mode / Cash Test
 *   Mode 2; no plain "Cash"); entries land in the MODE / AMOUNT grid.
 *   Installment Schedule (# / Due Date / Amount / Status) and the EMA Summary
 *   panel (INSTALLMENTS / PAID / REMAINING, Plan, Installment Amount, ...).
 *   Footer: Save as Draft | Submit.
 *
 * EMA Collection form: Type [masterDataValueID_BusinessUnitType] (Same
 * Business Unit), Business Unit [collectionLocationID], Member Number
 * (input#memberNo, placeholder "Enter" - the enrollment's member number, e.g.
 * WB002KKD; Enter fetches GetMemberByMemberNo + ValidateADPCollectionEligibility
 * + GetADPCollectionReceiptDetails), Mobile Number -> Receipt Details: EMA
 * Plan [adpPlanID], Member [adpEnrollmentID] ("WB002KKD Angel"), Member Name,
 * Installment No (= the next due installment), No. of Installments Paying
 * (1), Gold Rate, Amount (input#installmentAmountTran), Weight, Discount,
 * Final Amount, Balance -> Payment Collection (sub-tabs Payment Modes | EMA
 * Details - the member's paid-installment history: Date / Term / Rc No / EMA
 * Plan / Amount / ... / Status; Make Payment) -> Submit. The enrollment's own
 * payment is installment 1 of the schedule, so the first collection is
 * installment 2.
 */
const ROUTE = '/ema/app-enrollment-collection-setup';

class EmaEnrollmentPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'EMA');
    // the save POSTs: /ADPEnrollment/<Create|Save...>, /ADPCollection/<...> -
    // never the Get*/Validate* POSTs the form fires while it loads
    this.submitApiPattern = /ADP(Enrollment|Collection)\/(?!Get|Validate)/i;
  }

  /** A visible input directly after a label (the form's number boxes mostly carry no ids). */
  labelInput(label) {
    return this.page.locator(`xpath=//label[normalize-space(.)="${label}"]/following::input[not(@type="checkbox")][1]`).locator('visible=true').first();
  }

  memberNumberInput() {
    return this.page.locator('input#memberNo, input[formcontrolname="memberNo"]').locator('visible=true').first();
  }

  async open() {
    await this.goto(ROUTE);
    await this.waitForSpinner();
    await this.settle(2_000);
  }

  /** @param {'Enrollment'|'Collection'} which */
  async openTab(which) {
    const tab = this.page.locator('button, a, [role="tab"]').filter({ hasText: new RegExp(`^\\s*(EMA|ADP)\\s+${which}\\s*$`, 'i') }).locator('visible=true').first();
    await tab.click({ timeout: T(60_000) }); // the list can sit behind the spinner for a while
    await this.waitForSpinner();
    await this.settle(2_000);
  }

  /** The "+" of the current tab's list; `ready` is the form control that marks the form open. */
  async openAddForm(ready) {
    for (let i = 0; i < 3; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await ready.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) { await this.settle(1_500); return; }
      console.log(`${this.tabName}: Add form not open after click ${i + 1}`);
    }
    throw new Error(`${this.tabName}: the Add form did not open`);
  }

  /** "12 INSTALLMENTS 0 PAID 12 REMAINING" of the EMA Summary panel (nulls where the panel has no such tile). */
  async summaryCounts() {
    const text = (await this.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))) || '';
    const n = (label) => { const m = text.match(new RegExp(`(\\d+)\\s+${label}\\b`, 'i')); return m ? Number(m[1]) : null; };
    return { installments: n('INSTALLMENTS'), paid: n('PAID'), remaining: n('REMAINING') };
  }

  /** The Financial Entry numbers of the enrollment form. */
  async financials() {
    const num = async (label) => Number(((await this.labelInput(label).inputValue().catch(() => '')) || '').replace(/[^0-9.]/g, '') || 0);
    return { amount: await num('Amount'), discount: await num('Discount'), finalAmount: await num('Final Amount'), goldRate: await num('Gold Rate'), weight: await num('Weight') };
  }

  /** Rows of the Payment Modes grid (MODE / GR WT / ... / AMOUNT) on the form. */
  async paymentRows() {
    const rows = await this.page.locator('table').filter({ has: this.page.locator('th', { hasText: /^MODE$/ }) }).locator('visible=true').first().locator('tbody tr').allInnerTexts().catch(() => []);
    return rows.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No entries/i.test(t));
  }

  /**
   * Pick the option of `controlname` whose (whitespace-normalised) label
   * satisfies `matches`; `search` is typed into the combobox first (server-
   * searched lists). Returns the option labels seen.
   */
  async pickWhere(controlname, matches, { search = '', what = controlname } = {}) {
    const host = this.select(controlname);
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click();
      if (search) { await host.locator('input[role="combobox"]').fill(search); await this.settle(2_500); } // server search debounce
      else await this.settle(1_200);
      const options = await this.panelOptions(host);
      await options.first().waitFor({ state: 'visible', timeout: attempt * 4_000 }).catch(() => {});
      const texts = (await options.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
      const idx = texts.findIndex(matches);
      if (idx >= 0) {
        const label = texts[idx];
        await options.nth(idx).click({ timeout: 10_000 }).catch(() => {});
        const first = label.split(' ')[0];
        if (await this.valueLanded(host, new RegExp(escapeRe(first), 'i'))) { await this.settle(1_500); return texts; }
      }
      console.log(`EMA: ${what} not picked on attempt ${attempt} - options ${JSON.stringify(texts)}`);
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`EMA: no option for ${what} in "${controlname}"`);
  }

  /**
   * Fill the EMA Enrollment form (Add new record must already be open).
   * Returns { salesmanCode, financials } for the spec's assertions.
   */
  async fillEnrollment({ mobile, customer, planType, plan, groupAmount, salesman }) {
    const mobileInput = this.page.locator('input#mobileNumber').locator('visible=true').first();
    await mobileInput.fill(String(mobile));
    await mobileInput.blur();
    await this.settle(2_000); // the customer list re-filters on the mobile
    // Customer / Member: name and code on two lines - search by the name, match both
    const want = new RegExp('^' + escapeRe(customer.name) + (customer.code ? `\\s+${escapeRe(customer.code)}` : '') + '\\s*$', 'i');
    await this.pickWhere('customerID', (t) => want.test(t), { search: customer.name, what: `customer "${customer.name} ${customer.code || ''}"` });
    await this.pick('masterDataValueID_ADPPlanType', planType, { exact: true });
    await this.settle(1_500);
    await this.pick('adpPlanID', plan, { exact: true });
    await this.settle(2_000);
    await this.select('adpPlanGroupID').waitFor({ state: 'visible', timeout: T(15_000) });
    const digits = String(groupAmount).replace(/[^0-9]/g, '');
    await this.pickWhere('adpPlanGroupID', (t) => t.replace(/[^0-9.]/g, '').replace(/\.0+$/, '') === digits || t.replace(/[^0-9]/g, '').startsWith(digits), { what: `group amount ${groupAmount}` });
    await this.settle(2_000);
    await this.pick('salesmanEmployeeID', salesman, { search: true });
    await this.settle(2_000);
    const salesmanCode = (await this.page.locator('input#salesmanCode').locator('visible=true').first().inputValue().catch(() => '')) || '';
    await this.waitForIdle();
    await this.settle(2_000);
    const financials = await this.financials();
    console.log(`EMA enrollment: salesman "${salesman}" -> Salesman ID "${salesmanCode}"; financials ${JSON.stringify(financials)}; summary ${JSON.stringify(await this.summaryCounts())}`);
    return { salesmanCode, financials };
  }

  /**
   * "Make Payment" -> the Payment Collection dialog -> one entry of `mode`
   * (substring; "Cash" = the first cash mode, "Cash Test Mode" at Kakkanad)
   * for `amount` (default: the balance due) -> Close. Returns the amount paid
   * and the Payment Modes grid rows on the form.
   */
  async makePayment({ mode = 'Cash', amount, what = this.tabName } = {}) {
    const btn = this.page.getByRole('button', { name: /Make Payment/i }).locator('visible=true').last();
    await btn.click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(3_000);
    const dlg = this.page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
    if (!(await dlg.waitFor({ state: 'visible', timeout: T(15_000) }).then(() => true).catch(() => false))) {
      const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(`${what}: "Make Payment" opened no Payment Collection dialog. Toasts: ${JSON.stringify(toasts)}`);
    }
    const paid = await this.addPaymentEntry(dlg, { mode, amount, what });
    const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) { await close.click({ timeout: 5_000 }).catch(() => {}); }
    await this.settle(2_000);
    const rows = await this.paymentRows();
    console.log(`${what}: paid ${paid} by ${mode} - Payment Modes rows ${JSON.stringify(rows)}`);
    return { paid: Number(paid) || 0, rows };
  }

  /** Member number / receipt number out of a save body (memberNo e.g. WB003KKD) - searched at any depth. */
  static numberOf(body, keys = ['memberNo', 'memberNumber', 'receiptNo', 'docNo', 'voucherNo', 'voucherNumber']) {
    const seen = new Set();
    const walk = (o) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return '';
      seen.add(o);
      for (const k of keys) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
      for (const v of Object.values(o)) { const r = walk(v); if (r) return r; }
      return '';
    };
    return walk(body) || (typeof body?.data === 'string' ? body.data : '');
  }

  /** The list row (of `which` tab) holding `text`. */
  async verifyRowInList(text, { which = 'Enrollment' } = {}) {
    return super.verifyRowInList(text, { prepare: async () => { await this.open(); await this.openTab(which); } });
  }

  /**
   * EMA Collection (Add new record must be open): type the Member Number,
   * Enter fetches the member and the next due installment. Returns the
   * Receipt Details for the spec's assertions.
   */
  async fetchMember(memberNo) {
    const input = this.memberNumberInput();
    await input.waitFor({ state: 'visible', timeout: T(15_000) });
    const fetched = this.page.waitForResponse((r) => /GetADPCollectionReceiptDetails|GetMemberByMemberNo/i.test(r.url()), { timeout: 30_000 }).catch(() => null);
    await input.fill(String(memberNo));
    await input.press('Enter');
    const fr = await fetched;
    if (fr) console.log(`EMA collection: member fetch ${fr.status()} ${fr.url().split('/').slice(-1)[0].split('?')[0]}`);
    await this.waitForIdle();
    await this.settle(3_000);
    const val = async (label) => (await this.labelInput(label).inputValue().catch(() => '')) || '';
    const num = (s) => Number(String(s).replace(/[^0-9.]/g, '') || 0);
    const details = {
      plan: await this.selectValue('adpPlanID').catch(() => ''),
      member: await this.selectValue('adpEnrollmentID').catch(() => ''),
      memberName: await val('Member Name'),
      installmentNo: num(await val('Installment No')),
      installmentsPaying: num(await val('No. of Installments Paying')),
      goldRate: num(await val('Gold Rate')),
      amount: num((await this.page.locator('input#installmentAmountTran').locator('visible=true').first().inputValue().catch(() => '')) || await val('Amount')),
      weight: num(await val('Weight')),
      discount: num(await val('Discount')),
      finalAmount: num(await val('Final Amount')),
    };
    const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`EMA collection: member ${memberNo} -> ${JSON.stringify(details)}${toasts.length ? `; toasts ${JSON.stringify(toasts)}` : ''}`);
    if (!details.memberName) throw new Error(`EMA collection: member ${memberNo} did not load (toasts ${JSON.stringify(toasts)})`);
    return details;
  }

  /** The "EMA Details" sub-tab of Payment Collection: the member's paid installments (Date / Term / Rc No / ... / Status). */
  async installmentHistory() {
    const tab = this.page.locator('button, a, li, div').filter({ hasText: /^\s*(EMA|ADP) Details\s*$/ }).locator('visible=true').first();
    await tab.click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(2_000);
    const table = this.page.locator('table').filter({ has: this.page.locator('th', { hasText: /Rc No/i }) }).locator('visible=true').first();
    await table.waitFor({ state: 'visible', timeout: T(15_000) }).catch(() => {});
    const rows = (await table.locator('tbody tr').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No (entries|data|records)/i.test(t));
    return rows.map((r) => { const m = r.match(/^(\S+)\s+(\d+)\s+(\S+)\s+(.*?)\s+(\S+)$/); return m ? { date: m[1], term: Number(m[2]), receiptNo: m[3], rest: m[4], status: m[5], raw: r } : { raw: r }; });
  }

  /** Back to the "Payment Modes" sub-tab of Payment Collection (where Make Payment lives). */
  async openPaymentModesTab() {
    const tab = this.page.locator('button, a, li, div').filter({ hasText: /^\s*Payment Modes\s*$/ }).locator('visible=true').first();
    await tab.click({ timeout: T(15_000) });
    await this.settle(1_500);
  }

  /**
   * What the member has paid so far, read through a fresh Collection form
   * (Member Number fetch): the next due installment and the paid history.
   */
  async paidInstallments(memberNo, { installments } = {}) {
    await this.open();
    await this.openTab('Collection');
    await this.openAddForm(this.memberNumberInput());
    const details = await this.fetchMember(memberNo);
    const history = await this.installmentHistory();
    const paid = history.length;
    return { nextInstallmentNo: details.installmentNo, paid, remaining: installments ? installments - paid : null, history };
  }
}

module.exports = { EmaEnrollmentPage };
