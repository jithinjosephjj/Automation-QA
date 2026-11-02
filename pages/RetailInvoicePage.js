const { StockInwardBasePage, escapeRe } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Retail Sales Invoice — Retail Operation > Operations > Invoice.
 * Route: /pos/view-sales-invoice (mapped live 30-10-2026 at the Kakkanad
 * login). The "+" opens the Add form INLINE on the list page (no wizard):
 *
 *   Configuration & Customer: Mobile Number (+91 dial code, mobileNumber) +
 *     Customer Name (customerID, retail customers), Invoice Type [Invoice],
 *     Business Type [Retail, locked], Making Type [Normal], Invoice Source
 *     [Direct | ...] - "Direct" is the DEFAULT (no estimation, no order),
 *     Estimation Type [Normal], Sales Type [Normal Sale], Sales Executive
 *     Code (salesExecutiveCode: a list of employee CODES; the read-only
 *     "Sales Executive" box echoes the name), Supervisor, Helper.
 *   Item Entry: Scan Type [Tag Number], "Tag Number*" (scanValue) + Scan
 *     button -> the tag lands in the "Scanned Tags" grid; Clear Item /
 *     Add Item serve the manual item entry.
 *   Summary & Payment: Value Summary, Additional Charges (bill wise), Payment
 *     Mode (Paid / Balance), "Proceed To Payment" (Payment Collection
 *     dialog, same as Advance Registration) and Submit.
 *
 * POS forms open their "+" only on a session that went through the login
 * FORM (counter validation, 22-10-2026) - the chain clears the session
 * cache before this step.
 */
class RetailInvoicePage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Retail Invoice');
    this.submitApiPattern = /Invoice|Sales/i;
  }

  /** The POS list pages keep hidden filter selects with the form's controlnames - only the visible one counts. */
  select(controlname) {
    return this.page
      .locator(`sioniq-ng-select[controlname="${controlname}"] ng-select, ng-select[formcontrolname="${controlname}"]`)
      .locator('visible=true').first();
  }

  /** The form's inputs carry an id (scanValue, mobileNumber, salesExecutiveName) rather than a formcontrolname. */
  input(controlname) {
    return this.page.locator(`input#${controlname}, input[formcontrolname="${controlname}"], [controlname="${controlname}"] input, input[name="${controlname}"]`).locator('visible=true').first();
  }

  rowMatcher(rowText) {
    const esc = String(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  /** Pick `want` unless the select already shows it (the app pre-fills some selects and then offers no options). */
  async pickUnlessSet(controlname, want, opts = { exact: true }) {
    const current = (await this.selectValue(controlname).catch(() => '')) || '';
    if (current && current.toLowerCase().includes(String(want).toLowerCase())) {
      console.log(`${this.tabName}: ${controlname} already "${current}" - pick skipped`);
      return current;
    }
    await this.pick(controlname, want, opts);
    return want;
  }

  /** The wanted option (substring) when offered, else the first offered. Returns the label picked. */
  async pickOrFirst(controlname, wanted) {
    const host = this.select(controlname);
    if (!(await host.isVisible({ timeout: 5_000 }).catch(() => false))) { console.log(`${this.tabName}: ${controlname} not on the form - skipped`); return ''; }
    const current = (await this.selectValue(controlname).catch(() => '')) || '';
    if (current && (!wanted || current.toLowerCase().includes(String(wanted).toLowerCase()))) { console.log(`${this.tabName}: ${controlname} keeps "${current}"`); return current; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
      if (wanted) { await host.locator('input[role="combobox"]').fill(String(wanted)).catch(() => {}); await this.settle(1_500); }
      let opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      if (!(await opts.first().isVisible({ timeout: 2_000 }).catch(() => false)) && wanted) {
        await host.locator('input[role="combobox"]').fill('').catch(() => {});
        await this.settle(1_500);
        opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      }
      if (await opts.first().waitFor({ state: 'visible', timeout: attempt * 3_000 }).then(() => true).catch(() => false)) {
        const labels = (await opts.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
        let idx = wanted ? labels.findIndex((l) => l.toLowerCase() === String(wanted).toLowerCase()) : -1;
        if (idx < 0 && wanted) idx = labels.findIndex((l) => l.toLowerCase().includes(String(wanted).toLowerCase()));
        if (idx < 0) idx = 0;
        await opts.nth(idx).click();
        console.log(`${this.tabName}: ${controlname} -> ${labels[idx]}${wanted && !labels[idx].toLowerCase().includes(String(wanted).toLowerCase()) ? ` (wanted "${wanted}" not offered)` : ''} (of ${JSON.stringify(labels.slice(0, 8))})`);
        await this.waitForIdle();
        await this.settle(1_200);
        return labels[idx];
      }
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    console.log(`${this.tabName}: ${controlname} offered no option`);
    return '';
  }

  async visibleFields() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}${n.classList.contains('ng-invalid') ? '*' : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? '*' : ''}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        alerts: [...document.querySelectorAll('.toast, .toast-message, [role="alert"], .swal2-container, .invalid-feedback, .text-danger')].filter(vis).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10),
      };
    }).catch(() => ({}));
  }

  async toasts() {
    return (await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => []))
      .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  async open() {
    await this.goto('/pos/view-sales-invoice');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(2_000);
  }

  /** The "+" is swallowed while the list is still loading - click until the form shows. */
  async openAddForm() {
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('customerID').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)) { await this.settle(2_000); return; }
      const alerts = await this.toasts();
      console.log(`${this.tabName}: Add form not open after click ${i + 1}${alerts.length ? ` - alerts ${JSON.stringify(alerts)}` : ''}`);
    }
    throw new Error('Retail Invoice: the Add form did not open after 4 clicks on "+" (POS counter validation? log in through the form, not the session cache)');
  }

  /**
   * Sales Executive Code lists employee CODES, the read-only "Sales
   * Executive" box echoes the chosen NAME. Type the name into the search
   * (the list filters on it when the server searches by name); when the
   * echoed name is not the wanted one, walk the offered codes until one
   * echoes it; else keep the first offered and say so.
   */
  async pickSalesExecutive(name) {
    const echoed = async () => ((await this.input('salesExecutiveName').inputValue({ timeout: 2_000 }).catch(() => '')) || '').trim();
    const picked = await this.pickOrFirst('salesExecutiveCode', name);
    await this.settle(1_500);
    let who = await echoed();
    if (!name || who.toLowerCase().includes(String(name).toLowerCase())) { console.log(`${this.tabName}: sales executive ${picked} -> "${who}"`); return who; }
    const host = this.select('salesExecutiveCode');
    for (let i = 0; i < 25; i++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      if (!(await opts.first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false))) break;
      if (i >= await opts.count()) { await this.page.keyboard.press('Escape').catch(() => {}); break; }
      const label = ((await opts.nth(i).textContent()) || '').trim();
      await opts.nth(i).click();
      await this.settle(1_200);
      who = await echoed();
      if (who.toLowerCase().includes(String(name).toLowerCase())) { console.log(`${this.tabName}: sales executive code ${label} -> "${who}"`); return who; }
    }
    console.log(`${this.tabName}: no Sales Executive Code echoes "${name}" - keeping "${who}"`);
    return who;
  }

  /**
   * Scan a tag: Scan Type stays "Tag Number" (or "Rfid Number" when an RFID
   * is passed), the number goes into scanValue, Enter / the Scan button
   * commits it, and the tag must land in the Scanned Tags grid. Throws with
   * the app's own toast when it does not (a rate / charge / counter
   * configuration refusal is reported verbatim, never worked around).
   */
  async scanTag(tagNo, { rfidNo } = {}) {
    if (rfidNo) await this.pick('masterDataValueID_ScanType', 'Rfid', { exact: false }).catch(() => {});
    const value = rfidNo || tagNo;
    // "Tag Number*" box (placeholder "TG-000123"); the Scan button stays disabled until it holds a value
    const scan = this.input('scanValue').or(this.page.locator('input[placeholder^="TG-"], input[placeholder*="Tag" i]').locator('visible=true').first()).first();
    await scan.waitFor({ state: 'visible', timeout: T(15_000) });
    await scan.fill(String(value));
    if ((await scan.inputValue()) !== String(value)) throw new Error(`tag number did not land in the scan field (holds "${await scan.inputValue()}")`);
    const scanned = this.page.waitForResponse((r) => /Scan|Tag|Invoice/i.test(r.url()) && !/KeepAlive|GetAll|Pagination|GetMasterData|Translation/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 30_000 }).catch(() => null);
    await scan.press('Enter');
    const row = this.rowMatcher(tagNo).or(rfidNo ? this.rowMatcher(rfidNo) : this.rowMatcher(tagNo)).last();
    if (!(await row.isVisible({ timeout: 4_000 }).catch(() => false))) {
      const btn = this.page.getByRole('button', { name: /^\s*Scan\s*$/ }).locator('visible=true').last();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) await btn.click({ timeout: 5_000 }).catch(() => {});
    }
    const r = await scanned;
    if (r) {
      const body = await r.json().catch(() => null);
      console.log(`${this.tabName}: scan ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(body).slice(0, 300)}`);
      this.lastScan = body;
    }
    await this.waitForIdle();
    await this.settle(2_500);
    // a good scan fills the Item Details / Weight Details / Pricing blocks
    // (Tag Number, Item Name, Purity, Pieces, Gross Weight, Wastage %, Making,
    // Rate ...) under the scan box; "Add Item" then moves the item into the
    // Scanned Tags list (30-10-2026). A refused scan leaves them empty and
    // shows the app's toast.
    const detailsFilled = async () => this.page.evaluate((t) => {
      const vis = (el) => !!el.offsetParent;
      const withTag = [...document.querySelectorAll('input')].filter((i) => vis(i) && i.value === t).length;
      const itemName = [...document.querySelectorAll('input')].find((i) => vis(i) && /Tendulkar|,/.test(i.value) && i.readOnly !== undefined);
      return withTag >= 2 || !!itemName;
    }, String(tagNo)).catch(() => false);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await detailsFilled())) await this.page.waitForTimeout(500);
    if (!(await detailsFilled())) {
      const toasts = await this.toasts();
      const body = this.lastScan ? JSON.stringify(this.lastScan).slice(0, 300) : '(no scan response)';
      throw new Error(`Retail Invoice: the scan of tag "${tagNo}" filled no Item Details. Toasts: ${JSON.stringify(toasts)}; scan answer: ${body}`);
    }
    const toastsAfterScan = await this.toasts();
    if (toastsAfterScan.length) console.log(`${this.tabName}: toasts after the scan ${JSON.stringify(toastsAfterScan)}`);
    const item = await this.page.evaluate(() => {
      const vis = (el) => !!el.offsetParent;
      const byLabel = (lbl) => { const l = [...document.querySelectorAll('label')].find((x) => vis(x) && x.textContent.trim() === lbl); const inp = l && (l.parentElement.querySelector('input') || l.closest('div')?.querySelector('input')); return inp ? inp.value : ''; };
      return { itemName: byLabel('Item Name'), purity: byLabel('Purity'), pieces: byLabel('Pieces'), gross: byLabel('Gross Weight'), wastage: byLabel('Wastage %'), making: byLabel('Making'), rate: byLabel('Rate'), metalAmount: byLabel('Metal Amount') };
    }).catch(() => ({}));
    console.log(`${this.tabName}: scanned item ${JSON.stringify(item)}`);
    this.lastItem = item;

    // Add Item -> Scanned Tags ("N items" badge / "No. of Items : N")
    const itemsCount = async () => this.page.evaluate(() => {
      const txt = document.body.innerText.replace(/\s+/g, ' ');
      const m = txt.match(/No\. of Items\s*:\s*(\d+)/);
      return m ? Number(m[1]) : 0;
    }).catch(() => 0);
    const before = await itemsCount();
    const addItem = this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
    await addItem.click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(2_500);
    const staged = async () => (await itemsCount()) > before || (await this.page.getByText(String(tagNo)).locator('visible=true').count().catch(() => 0)) >= 1 && !(await this.page.getByText(/No items added yet/).first().isVisible().catch(() => false));
    const deadline2 = Date.now() + 15_000;
    while (Date.now() < deadline2 && !(await staged())) await this.page.waitForTimeout(500);
    if (!(await staged())) {
      const toasts = await this.toasts();
      const diag = await this.invalidControls();
      throw new Error(`Retail Invoice: "Add Item" did not move tag ${tagNo} into Scanned Tags (No. of Items still ${await itemsCount()}). Toasts: ${JSON.stringify(toasts)}; invalid: ${JSON.stringify(diag)}`);
    }
    console.log(`${this.tabName}: tag ${tagNo} added to Scanned Tags (No. of Items ${await itemsCount()})`);
  }

  /** The "Rate (₹/gm)" inputs that stay 0 after a scan block Submit - enter the rate into each. */
  async fillMetalRateIfEmpty(rate) {
    const inputs = this.page.locator('xpath=//*[contains(normalize-space(text()), "Rate (") and contains(normalize-space(text()), "/gm")]/following::input[1]').locator('visible=true');
    const n = await inputs.count();
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      if (await input.isDisabled().catch(() => true)) continue;
      if (Number((await input.inputValue().catch(() => '')) || 0) > 0) continue;
      await input.fill(String(rate));
      await input.blur();
      filled++;
    }
    if (filled) { await this.waitForIdle(); await this.settle(1_500); console.log(`${this.tabName}: entered rate ${rate} into ${filled} empty Rate (₹/gm) input(s)`); }
    return filled;
  }

  /**
   * One direct retail sale: customer (by mobile number when given, else by
   * name), the staff, one scanned tag, payment, Submit. Returns the save body.
   */
  async createDirectInvoice({
    customer, mobile, salesman, helper, supervisor, tagNo, rfidNo, metalRate = 6000,
    invoiceSource = 'Direct', additionalCharges = false, payment = { mode: 'Cash' },
    salesType, order,
  }) {
    await this.open();
    await this.openAddForm();

    // customer: the mobile number drives the lookup; the name select is the fallback
    if (mobile) {
      const mob = this.input('mobileNumber').or(this.page.locator('input[placeholder="Mobile number"]').locator('visible=true').first()).first();
      await mob.fill(String(mobile));
      await mob.blur();
      await this.waitForIdle();
      await this.settle(2_500);
    }
    if (!(await this.selectValue('customerID').catch(() => ''))) await this.pick('customerID', customer, { search: true });
    await this.settle(2_000);
    console.log(`${this.tabName}: customer "${await this.selectValue('customerID').catch(() => '')}" mobile "${await this.page.locator('input[placeholder="Mobile number"]').locator('visible=true').first().inputValue().catch(() => '')}"`);

    await this.pickUnlessSet('masterDataValueID_InvoiceSource', invoiceSource);
    await this.settle(1_500);
    if (salesType) {
      // Sales Type [Normal Sale | Order | Sales Return] (02-11-2026): "Order" reveals
      // Order Type [advanceTypeID: Advance | Order | Reserve] (mandatory first - the
      // Receipt No lookup GetSalesInvoiceRateFixAdvancesPaginated answers "Order Type is
      // Required." otherwise), Receipt No [advanceID: the customer's registered orders,
      // e.g. iiii4], the read-only Transaction Date, then Order Item [advanceItemID: the
      // estimation's items, e.g. Gold,Ring-Tendulkar]; the tag scanned afterwards is
      // sold against that order item.
      await this.pickUnlessSet('masterDataValueID_InvoiceSalesType', salesType);
      await this.waitForIdle();
      await this.settle(2_000);
      if (order) {
        await this.pick('advanceTypeID', order.orderType || 'Order', { exact: true });
        await this.waitForIdle();
        await this.settle(2_000);
        // the Receipt No list is server-paginated and its search box filters on
        // something other than the receipt number ("iiii5" typed -> "No items found",
        // 02-11-2026) - pick from the opened list without typing
        const listed = this.page.waitForResponse((r) => /RateFixAdvancesPaginated/i.test(r.url()), { timeout: 30_000 }).catch(() => null);
        const host = this.select('advanceID');
        await this.closeStalePanels();
        await host.locator('.ng-select-container').click({ timeout: T(10_000) });
        await listed;
        await this.settle(2_000);
        const wanted = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(`^\\s*${escapeRe(String(order.receiptNo))}\\s*$`) }).first();
        if (!(await wanted.isVisible({ timeout: 10_000 }).catch(() => false))) {
          const opts = (await this.page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.trim());
          await this.page.keyboard.press('Escape');
          throw new Error(`${this.tabName}: order ${order.receiptNo} is not in the Receipt No list for Order Type ${order.orderType || 'Order'} - offered ${JSON.stringify(opts.slice(0, 20))}`);
        }
        await wanted.click({ timeout: T(10_000) });
        await this.waitForIdle();
        await this.settle(2_500);
        const date = await this.page.locator('input[formcontrolname="rateFixAdvanceDate"], [controlname="rateFixAdvanceDate"] input, input#rateFixAdvanceDate').locator('visible=true').first().inputValue().catch(() => '');
        console.log(`${this.tabName}: order ${order.receiptNo} (${order.orderType || 'Order'}) picked - transaction date "${date}"`);
        const itemSel = this.select('advanceItemID');
        if (await itemSel.isVisible({ timeout: 5_000 }).catch(() => false)) {
          if (order.item) await this.pick('advanceItemID', order.item, { search: true }).catch(async (e) => { console.log(`${this.tabName}: order item "${order.item}" not matched (${String(e.message).slice(0, 80)}) - first item`); await this.pickOrFirst('advanceItemID', order.item); });
          else await this.pickOrFirst('advanceItemID', '');
          await this.settle(1_500);
          console.log(`${this.tabName}: order item "${await this.selectValue('advanceItemID').catch(() => '')}"`);
        } else console.log(`${this.tabName}: no Order Item select after picking order ${order.receiptNo}`);
      }
    }
    await this.pickSalesExecutive(salesman);
    if (supervisor) await this.pickOrFirst('supervisorID', supervisor);
    if (helper) await this.pickOrFirst('helperID', helper);
    await this.closeStalePanels();

    await this.scanTag(tagNo, { rfidNo });
    await this.fillMetalRateIfEmpty(metalRate);

    const chargesBtn = this.page.getByRole('button', { name: /Additional Charges/ }).locator('visible=true').last();
    if (additionalCharges && (await chargesBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await this.addAdditionalCharges({ ...(typeof additionalCharges === 'object' ? additionalCharges : {}), index: (await chargesBtn.count()) - 1 })
        .catch((e) => console.log(`${this.tabName}: additional charges skipped - ${String(e).slice(0, 160)}`));
    }
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    console.log(`${this.tabName}: before payment - ${JSON.stringify(await this.visibleFields()).slice(0, 1500)}`);
    await this.page.screenshot({ path: 'test-results/screens/retail-invoice-before-payment.png', fullPage: true }).catch(() => {});

    if (payment) await this.collectPayment(payment);

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && this.submitApiPattern.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Scan|Get[A-Z]\w*$/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    const submit = this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last();
    await submit.click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const late = await this.toasts();
      throw new Error(`Retail Invoice Submit fired no save request - invalid: ${JSON.stringify(diag)}; alerts: ${JSON.stringify(late)}; fields: ${JSON.stringify(await this.visibleFields()).slice(0, 800)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('retail invoice save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('retail invoice', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Retail Invoice rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    await this.previewAndClose();
    return body;
  }

  /** Post-save Print dialog (when the location has a template): verify the preview, close. */
  async previewAndClose() {
    this.printPreviewError = null;
    const dialogVisible = await this.printDialog.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false);
    if (dialogVisible) await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    await this.closePostSaveDialog(4_000);
    await this.settle(1_000);
  }

  /** The invoice number from a save body. */
  static numberOf(body) {
    const d = (body && body.data) || {};
    return d.receiptNo || d.invoiceNo || d.invoiceNumber || d.docNo || d.voucherNo || (typeof body?.data === 'string' ? body.data : '') || '';
  }
}

module.exports = { RetailInvoicePage };
