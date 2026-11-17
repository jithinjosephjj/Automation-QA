const { RetailInvoicePage } = require('./RetailInvoicePage');
const { escapeRe } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Item Delivery — Retail Operation > Operations > Item Delivery
 * (/pos/view-sales-credit-item-delivery, "Release of billed items against
 * due clearance"; probed 16-11-2026 at Kakkanad). The list (Delivery No KK##,
 * Date, Invoice No, Customer, Items, Pcs, Release Value, Due Amount, Waiver,
 * Delivery Mode, Receiver, Delivery Status, Status) opens its Add form inline
 * on "+":
 *
 *   Customer & Credit Position: Customer Mobile / Name / KYC Status - all
 *     read-only, filled from the invoice.
 *   Delivery Document: "Pending Delivery N" (a lookup grid of the invoices
 *     that still hold items: Invoice No, Customer, Invoice Value, Paid, Due,
 *     Items Pend, Load), Invoice No [salesInvoiceID: the same invoices;
 *     typing the number filters the list], Invoice Date / Value / Sales
 *     Person (read-only). Only an invoice saved with a BALANCE DUE holds its
 *     items - a fully paid cash invoice is delivered on the spot and is never
 *     offered here.
 *   Item Details: "Scan / Enter Tag No" + Verify, the held tags grid (# | Tag
 *     No | Item / Design | Category | HUID | Purity | Gross Wt | Stone Wt |
 *     Net Wt | Pure Wt | Qty | Item Value | Verified | Status | Detail); the
 *     row tick turns Status "Not Delivered" -> "Releasing" and feeds the
 *     "Releasing Now" totals.
 *   Waiver / Write-off (optional), Handover & Receiver Details: Delivery Mode
 *     [Courier | Home Delivery | Counter Handover], Received By [Self |
 *     Authorised Person | Guardian | Courier Agent], Receiver Name / Mobile
 *     (prefilled from the customer), OTP Verification (Send OTP), two
 *     checkboxes (signature captured, certificate & box handed over),
 *     Delivery Remarks; Delivery Summary; "Preview Challan" and
 *     "Deliver & Print Challan".
 */
class ItemDeliveryPage extends RetailInvoicePage {
  constructor(page) {
    super(page);
    this.tabName = 'Item Delivery';
    this.submitApiPattern = /SalesCreditItemDelivery/i;
  }

  async open() {
    await this.goto('/pos/view-sales-credit-item-delivery');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(2_000);
  }

  /** "+" opens the form inline; the Invoice No select marks it open. */
  async openAddForm() {
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('salesInvoiceID').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) { await this.settle(2_000); return; }
      console.log(`${this.tabName}: Add form not open after click ${i + 1} - alerts ${JSON.stringify(await this.toasts())}`);
    }
    throw new Error('Item Delivery: the Add form did not open after 4 clicks on "+"');
  }

  /** The held-item rows (text), excluding the empty-state row. */
  async itemRows() {
    return (await this.page.locator('table').filter({ has: this.page.locator('th', { hasText: /^Tag No$/ }) }).locator('visible=true').first()
      .locator('tbody tr').allInnerTexts().catch(() => []))
      .map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No items/i.test(t) && !/^(Invoice Total|Releasing Now)/i.test(t));
  }

  /** "INVOICE VALUE 308950.00 RECEIVED EARLIER 0.00 WAIVER 0.00 DUE AFTER DELIVERY 308950.00 ... Releasing Now (1) ..." */
  async summary() {
    return this.page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      const num = (re) => { const m = t.match(re); return m ? Number(String(m[1]).replace(/,/g, '')) : null; };
      return {
        invoiceValue: num(/INVOICE VALUE\s*(-?[\d,]+(?:\.\d+)?)/i),
        receivedEarlier: num(/RECEIVED EARLIER\s*(-?[\d,]+(?:\.\d+)?)/i),
        dueAfterDelivery: num(/DUE AFTER DELIVERY\s*(-?[\d,]+(?:\.\d+)?)/i),
        selected: num(/(\d+) selected/),
        releasingNow: num(/Releasing Now \((\d+)\)/),
      };
    }).catch(() => ({}));
  }

  /**
   * Type the invoice number into the Invoice No select (the user's "paste the
   * invoice no") and pick the exact match; the held items load with it.
   */
  async loadInvoice(invoiceNo) {
    const host = this.select('salesInvoiceID');
    await host.waitFor({ state: 'visible', timeout: T(15_000) });
    const details = this.page.waitForResponse((r) => /GetSalesCreditItemDeliveryInvoiceDetails/i.test(r.url()), { timeout: 30_000 }).catch(() => null);
    let offered = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click({ timeout: T(10_000) });
      await host.locator('input[role="combobox"]').fill(String(invoiceNo));
      await this.settle(2_000);
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      offered = (await opts.allTextContents().catch(() => [])).map((t) => t.trim());
      const exact = opts.filter({ hasText: new RegExp(`^\\s*${escapeRe(String(invoiceNo))}\\s*$`) }).first();
      if (await exact.isVisible({ timeout: attempt * 3_000 }).catch(() => false)) {
        await exact.click({ timeout: T(10_000) });
        break;
      }
      await this.page.keyboard.press('Escape').catch(() => {});
      if (attempt === 4) throw new Error(`Item Delivery: invoice ${invoiceNo} is not in the Invoice No list (it lists only invoices that still hold items - was the invoice saved with a balance due?). Offered for "${invoiceNo}": ${JSON.stringify(offered.slice(0, 20))}`);
      await this.settle(2_000);
    }
    const r = await details;
    const body = r ? await r.json().catch(() => null) : null;
    if (body) console.log(`${this.tabName}: invoice ${invoiceNo} details ${JSON.stringify(body).slice(0, 300)}`);
    await this.waitForIdle();
    await this.settle(2_500);
    const rows = await this.itemRows();
    console.log(`${this.tabName}: invoice ${invoiceNo} holds ${rows.length} item(s): ${JSON.stringify(rows)}; summary ${JSON.stringify(await this.summary())}`);
    if (!rows.length) throw new Error(`Item Delivery: invoice ${invoiceNo} loaded but lists no held items`);
    this.invoiceDetails = body;
    return rows;
  }

  /** "Scan / Enter Tag No" + Verify, then make sure the tag's row is ticked ("Releasing"). */
  async verifyAndSelectTag(tagNo) {
    const row = this.page.locator('tbody tr').filter({ hasText: String(tagNo) }).locator('visible=true').first();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) throw new Error(`Item Delivery: tag ${tagNo} is not among the held items: ${JSON.stringify(await this.itemRows())}`);
    const tagIn = this.page.locator('input#tagNo, input[formcontrolname="tagNo"], input[placeholder*="Tag" i]').locator('visible=true').first();
    await tagIn.waitFor({ state: 'visible', timeout: T(10_000) });
    await tagIn.fill(String(tagNo));
    const verify = this.page.getByRole('button', { name: /^\s*Verify\s*$/ }).locator('visible=true').first();
    if (await verify.isEnabled({ timeout: 2_000 }).catch(() => false)) await verify.click({ timeout: T(10_000) }).catch((e) => console.log(`${this.tabName}: Verify click - ${String(e).slice(0, 100)}`));
    else await tagIn.press('Enter').catch(() => {});
    await this.waitForIdle();
    await this.settle(2_000);
    const toasts = await this.toasts();
    if (toasts.length) console.log(`${this.tabName}: after Verify - toasts ${JSON.stringify(toasts)}`);
    const cb = row.locator('input[type=checkbox]').first();
    if (await cb.isVisible({ timeout: 2_000 }).catch(() => false) && !(await cb.isChecked().catch(() => false))) {
      await cb.click({ timeout: T(10_000) });
      await this.settle(1_500);
    }
    const rowText = ((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const sum = await this.summary();
    console.log(`${this.tabName}: tag ${tagNo} row "${rowText}"; ${JSON.stringify(sum)}`);
    if (!/Releasing/i.test(rowText) && !(sum.selected > 0)) throw new Error(`Item Delivery: tag ${tagNo} is not selected for release - row "${rowText}", summary ${JSON.stringify(sum)}, toasts ${JSON.stringify(toasts)}`);
    return rowText;
  }

  /**
   * OTP Verification (mandatory, 17-11-2026): "Send OTP" opens the
   * app-otp-verification-popup ("Receiver verification for item delivery",
   * "Enter the 6-digit OTP sent to +91 XXXXXX4889", six "Digit N" boxes,
   * Cancel / Verify, Resend in 30 s). No request is fired on qa - any six
   * digits verify (user 17-11-2026: "you can give any 6 digit"). While the
   * popup is up its backdrop swallows every click, and without the
   * verification "Deliver & Print Challan" silently does nothing.
   */
  async verifyOtp(code = process.env.DELIVERY_OTP || '123456') {
    const send = this.page.locator('button').filter({ hasText: /Send OTP/i }).locator('visible=true').first();
    if (!(await send.isVisible({ timeout: 3_000 }).catch(() => false))) { console.log(`${this.tabName}: no "Send OTP" button - OTP step skipped`); return false; }
    await send.click({ timeout: T(10_000) });
    const popup = this.page.locator('app-otp-verification-popup, .otp-backdrop').locator('visible=true').first();
    if (!(await popup.waitFor({ state: 'visible', timeout: T(10_000) }).then(() => true).catch(() => false))) {
      console.log(`${this.tabName}: "Send OTP" opened no OTP popup - toasts ${JSON.stringify(await this.toasts())}`);
      return false;
    }
    console.log(`${this.tabName}: OTP popup "${((await popup.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 160)}"`);
    const digits = String(code).replace(/\D/g, '').padEnd(6, '0').slice(0, 6).split('');
    for (let i = 0; i < 6; i++) {
      const box = popup.getByRole('textbox', { name: new RegExp(`^Digit ${i + 1}$`) }).first();
      await box.click({ timeout: 5_000 }).catch(() => {});
      await box.fill(digits[i]).catch(async () => { await this.page.keyboard.type(digits[i]); });
    }
    await this.settle(800);
    const verify = popup.getByRole('button', { name: /^\s*Verify\s*$/ }).first();
    const otpResp = this.page.waitForResponse((r) => /otp/i.test(r.url()), { timeout: 8_000 }).catch(() => null);
    await verify.click({ timeout: T(10_000) });
    const r = await otpResp;
    if (r) console.log(`${this.tabName}: OTP verify ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 200)}`);
    await this.waitForIdle();
    await this.settle(1_500);
    const stillUp = await popup.isVisible().catch(() => false);
    const toasts = await this.toasts();
    console.log(`${this.tabName}: OTP ${digits.join('')} -> popup ${stillUp ? 'STILL open' : 'closed'}${toasts.length ? `, toasts ${JSON.stringify(toasts)}` : ''}`);
    if (stillUp) throw new Error(`Item Delivery: the OTP ${digits.join('')} was not accepted - popup "${((await popup.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 300)}"; toasts ${JSON.stringify(toasts)}`);
    return true;
  }

  /**
   * One delivery: load the invoice by number, verify + select the tag, the
   * handover details, "Deliver & Print Challan". Returns the save body.
   */
  async deliver({ invoiceNo, tagNo, deliveryMode = 'Counter Handover', receivedBy = 'Self', receiverName, receiverMobile, remarks, handedOver = true, otp }) {
    await this.open();
    await this.openAddForm();
    await this.loadInvoice(invoiceNo);
    await this.verifyAndSelectTag(tagNo);

    if (deliveryMode) await this.pickUnlessSet('masterDataValueID_DeliveryMode', deliveryMode);
    if (receivedBy) await this.pickUnlessSet('masterDataValueID_ReceivedByType', receivedBy);
    await this.closeStalePanels();
    const name = this.input('receiverName');
    if (receiverName) { await name.fill(String(receiverName)); await name.blur(); }
    else if (!(await name.inputValue().catch(() => ''))) console.log(`${this.tabName}: Receiver Name is empty and none was given`);
    if (receiverMobile) { const m = this.input('receiverMobileNo'); await m.fill(String(receiverMobile)); await m.blur(); }
    if (handedOver) {
      // the two acknowledgement checkboxes carry their caption as accessible name;
      // "Signature / thumb impression captured" (isAcknowledgementCaptured) is MANDATORY -
      // without it "Deliver & Print Challan" fires no save (16-11-2026)
      for (const name of [/Signature|thumb impression/i, /Certificate & box/i]) {
        const box = this.page.getByRole('checkbox', { name }).locator('visible=true').first();
        if (!(await box.isVisible({ timeout: 2_000 }).catch(() => false))) { console.log(`${this.tabName}: checkbox ${name} not on the form`); continue; }
        if (!(await box.isChecked().catch(() => false))) await box.check({ timeout: T(10_000) }).catch(async () => { await box.click({ timeout: 5_000, force: true }).catch(() => {}); });
        console.log(`${this.tabName}: checkbox ${name} -> ${await box.isChecked().catch(() => '?')}`);
      }
    }
    if (remarks) { // Delivery Remarks is a textarea
      const r = this.page.getByRole('textbox', { name: /Delivery Remarks/i }).or(this.page.locator('textarea#remarks, textarea[formcontrolname="remarks"]')).locator('visible=true').first();
      if (await r.isVisible({ timeout: 3_000 }).catch(() => false)) { await r.fill(String(remarks)); await r.blur().catch(() => {}); }
    }
    if (otp !== false) await this.verifyOtp(otp === true || otp === undefined ? undefined : otp);
    console.log(`${this.tabName}: before Deliver - ${JSON.stringify(await this.visibleFields()).slice(0, 1500)}`);
    await this.page.screenshot({ path: 'test-results/screens/item-delivery-before-deliver.png', fullPage: true }).catch(() => {});

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && this.submitApiPattern.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Get[A-Z]\w*/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    const deliverBtn = this.page.getByRole('button', { name: /Deliver & Print Challan/ }).locator('visible=true').last();
    await deliverBtn.waitFor({ state: 'visible', timeout: T(15_000) });
    if (!(await deliverBtn.isEnabled().catch(() => false))) throw new Error(`Item Delivery: "Deliver & Print Challan" is disabled - fields ${JSON.stringify(await this.visibleFields()).slice(0, 800)}`);
    await deliverBtn.click({ timeout: T(15_000) });
    // an "Are you sure?" style confirmation, when the app asks one
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed|deliver/i }).getByRole('button', { name: /^Yes$|Ok|Confirm|Deliver/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) { console.log(`${this.tabName}: confirming "${(await confirm.innerText().catch(() => '')).trim()}"`); await confirm.click().catch(() => {}); }
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const late = await this.toasts();
      throw new Error(`Item Delivery "Deliver & Print Challan" fired no save request - invalid: ${JSON.stringify(diag)}; alerts: ${JSON.stringify(late)}; fields: ${JSON.stringify(await this.visibleFields()).slice(0, 800)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('item delivery save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('item delivery', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Item Delivery rejected (HTTP ${r.status()}): ${body ? body.error || body.message || JSON.stringify(body).slice(0, 200) : ''}`);
    this.lastSaveBody = body;
    await this.previewAndClose();
    return body;
  }

  /** The delivery list row of `invoiceNo` (Delivery No, Delivery Status ...). */
  async verifyDeliveryListed(invoiceNo, { deliveryNo } = {}) {
    await this.open();
    const search = this.page.locator('input[placeholder="Search"], input[type="search"]').locator('visible=true').first();
    if (await search.isVisible({ timeout: 3_000 }).catch(() => false)) { await search.fill(String(deliveryNo || invoiceNo)); await search.press('Enter').catch(() => {}); await this.waitForIdle(); await this.settle(2_500); }
    const rows = (await this.page.locator('tbody tr').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    const row = rows.find((t) => (deliveryNo && t.includes(String(deliveryNo))) || new RegExp(`\\b${escapeRe(String(invoiceNo))}\\b`).test(t));
    console.log(`${this.tabName}: list row for invoice ${invoiceNo}${deliveryNo ? ` / ${deliveryNo}` : ''}: ${row || '(not found)'}; rows ${JSON.stringify(rows.slice(0, 5))}`);
    return row || '';
  }

  /** The delivery number from a save body (KK## series at Kakkanad). */
  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.deliveryNo || d.docNo || d.voucherNo || (typeof body?.data === 'string' ? body.data : '') || '';
  }
}

module.exports = { ItemDeliveryPage };
