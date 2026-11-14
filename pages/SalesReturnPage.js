const { EstimationSalesTypePage } = require('./EstimationSalesTypePage');
const { escapeRe } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * The retail SALES RETURN screens (probed 14-11-2026 at Kakkanad):
 *
 * 1. Estimations > "Sales Return Estimation" tab (/pos/app-order-estimation-setup):
 *    "Estimate the refund for jewellery a customer returns". Entry Details:
 *    Business Type [masterDataValueID_BusinessType: B2C | Retail] - must be
 *    picked FIRST ("Please select the Business Type before adding items."),
 *    Salesman ID [salesmanID: sales codes] -> Salesman Name (read-only), Helper
 *    [helperID], Supervisor [supervisorID], Jewellery Item Type
 *    [masterDataValueID_JewelleryItemType: Metal], Sales Return Type
 *    [masterDataValueID_RetailSalesReturnType: BillWise | Manual]; Bill Wise:
 *    input#receiptItemNo "Enter the exact Bill No or Receipt Item No" + Search
 *    -> Sales Return Entries grid (Serial No | Mode | Bill No | Bill Date |
 *    Customer | Article | Pieces | Gross Weight | Net Weight | Bill Amount |
 *    Return % | Amount); Estimation Summary (Customer Name, No. of Items, Bill
 *    Amount, ESTIMATION AMOUNT); Submit.
 * 2. Sales Return Registration (/pos/view-sales-return-registration): "Register
 *    a return against approved sr estimations and refund the customer". Entry
 *    Mode [entryMode: Direct | Estimation], SR Estimation No [estimationLookup:
 *    the approved sales return estimations, by receipt number] + Clear / Add
 *    -> Entry Details; Refund Payment ("Payment" opens the payment dialog;
 *    Total / Paid / Balance); Allocation (Allocation Type "Amount Settlement",
 *    Allocation Amount, Description); Return Summary; Submit.
 */
class SalesReturnPage extends EstimationSalesTypePage {
  constructor(page) {
    super(page);
    this.tabName = 'Sales Return';
  }

  /** Rows of the first visible grid whose header holds `headerText`. */
  async rowsOf(headerText) {
    const table = this.page.locator('table').filter({ has: this.page.locator('th', { hasText: headerText }) }).locator('visible=true').first();
    if (!(await table.isVisible({ timeout: 2_000 }).catch(() => false))) return [];
    return (await table.locator('tbody tr').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No (items|entries|refund|data)/i.test(t));
  }

  /** Summary numbers ("No. of Items : 1", "ESTIMATION AMOUNT 12345.00", "Total Return Value : ..."). */
  async summaryNumbers() {
    return this.page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      const num = (re) => { const m = t.match(re); return m ? Number(String(m[1]).replace(/,/g, '')) : null; };
      return {
        items: num(/No\. of Items\s*:?\s*(\d+)/),
        pieces: num(/No\. of Pieces\s*:?\s*(\d+)/),
        billAmount: num(/Bill Amount\s*:?\s*(-?[\d,]+(?:\.\d+)?)/),
        estimationAmount: num(/ESTIMATION AMOUNT\s*(-?[\d,]+(?:\.\d+)?)/i),
        totalReturnValue: num(/Total Return Value\s*:?\s*(-?[\d,]+(?:\.\d+)?)/i),
        paid: num(/\bPaid\s*:?\s*(-?[\d,]+(?:\.\d+)?)/),
        balance: num(/\bBalance\s*:?\s*(-?[\d,]+(?:\.\d+)?)/),
        customer: (t.match(/Customer(?: Name)?\s*:\s*([^•]+?)\s+(?:No\. of|Entry Mode)/) || [])[1] || '',
      };
    }).catch(() => ({}));
  }

  /**
   * Sales Return Estimation for one old bill (BillWise). Returns the save body
   * (SalesReturnEstimation/Create..., receiptNo e.g. "17").
   */
  async createSalesReturnEstimation({ businessType = 'Retail', salesmanCode, salesman = 'Chandu', helper = 'Chandu', supervisor, itemType = 'Metal', returnType = 'BillWise', billNo, returnPct }) {
    await this.goto('/pos/app-order-estimation-setup');
    await this.waitForIdle();
    await this.waitForSpinner();
    const tab = this.page.getByRole('tab', { name: /^\s*Sales Return Estimation\s*$/ }).locator('visible=true').first();
    await tab.click({ timeout: T(60_000) });
    await this.waitForSpinner();
    await this.settle(2_000);
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('masterDataValueID_RetailSalesReturnType').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Sales Return Estimation: the Add form did not open after 4 clicks on "+" (POS counter validation? log in through the form)');
    }
    await this.settle(2_000);

    await this.pickUnlessSet('masterDataValueID_BusinessType', businessType);
    await this.settle(1_500);
    // Salesman ID lists SALES CODES; the name back-fills. Chandu's code (2) is
    // not in this list on qa (14-11-2026) - Ajin G's AJ10 is (the user's screen)
    const code = salesmanCode || 'AJ10';
    const picked = await this.pick('salesmanID', code, { search: true, exact: true }).then(() => true).catch(() => false);
    if (!picked) {
      const opts = await this.optionsOf('salesmanID').catch(() => []);
      console.log(`sales return estimation: salesman code "${code}" not offered (first options ${JSON.stringify(opts.slice(0, 10))}) - picking the first`);
      await this.pick('salesmanID', opts[0], { exact: true });
    }
    await this.settle(1_500);
    const salesmanName = (await this.page.locator('xpath=//label[normalize-space(.)="Salesman Name"]/following::input[1]').locator('visible=true').first().inputValue().catch(() => '')) || '';
    console.log(`sales return estimation: salesman code "${await this.selectValue('salesmanID').catch(() => '')}" -> name "${salesmanName}"`);
    if (helper) await this.pick('helperID', helper, { search: true }).catch((e) => console.log(`sales return estimation: helper skipped - ${String(e.message).split('\n')[0].slice(0, 100)}`));
    if (supervisor) await this.pick('supervisorID', supervisor, { search: true }).catch(() => {});
    await this.pickUnlessSet('masterDataValueID_JewelleryItemType', itemType);
    await this.pickUnlessSet('masterDataValueID_RetailSalesReturnType', returnType);
    await this.settle(1_200);

    // the old bill: exact Bill No (or Receipt Item No) + Search -> Sales Return Entries
    const box = this.page.locator('input#receiptItemNo').locator('visible=true').first();
    await box.waitFor({ state: 'visible', timeout: T(15_000) });
    const searched = this.page.waitForResponse((r) => /SalesReturn|Bill|Receipt/i.test(r.url()) && !/KeepAlive|Translation|Pagination|Lookup/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 30_000 }).catch(() => null);
    await box.fill(String(billNo));
    await box.press('Enter');
    const searchBtn = this.page.locator('button').filter({ hasText: /^\s*Search\s*$/ }).locator('visible=true').last();
    if (await searchBtn.isVisible({ timeout: 1_500 }).catch(() => false) && !(await this.rowsOf(/Bill No/).then((r) => r.length))) await searchBtn.click({ timeout: 5_000 }).catch(() => {});
    const sr = await searched;
    const srBody = sr ? await sr.json().catch(() => null) : null;
    if (sr) console.log(`sales return estimation: bill search ${sr.status()} ${sr.url().split('/sioniq/')[1]?.split('?')[0]} ${JSON.stringify(srBody).slice(0, 260)}`);
    await this.waitForIdle();
    await this.settle(3_000);
    // the search fills an item card (bill item, Weight Details, Pricing Details,
    // Return %, Estimation Amount Exclude Tax) - "Add Item" moves it into the entries
    let rows = await this.rowsOf(/Bill No/);
    if (!rows.length) {
      // a bill with several items (or a search by bill number) first offers an
      // "Item No" select (selectedSalesInvoiceItemID: "86.1" ...) - pick the line
      await this.pickBillItemIfOffered(billNo);
      const addItem = this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
      if (await addItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
        if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
        await addItem.click({ timeout: T(15_000) });
        await this.waitForIdle();
        await this.settle(2_500);
        rows = await this.rowsOf(/Bill No/);
      }
    }
    const toasts = await this.toasts();
    console.log(`sales return estimation: bill ${billNo} -> entries ${JSON.stringify(rows)}${toasts.length ? `; toasts ${JSON.stringify(toasts)}` : ''}`);
    if (!rows.length) throw new Error(`Sales Return Estimation: bill ${billNo} added no Sales Return Entries (toasts ${JSON.stringify(toasts)}; search ${JSON.stringify(srBody).slice(0, 200)})`);
    if (returnPct !== undefined) {
      const pct = this.page.locator('table tbody tr input').locator('visible=true').first();
      if (await pct.count()) { await pct.fill(String(returnPct)); await pct.blur(); await this.settle(1_500); rows = await this.rowsOf(/Bill No/); }
    }
    const summary = await this.summaryNumbers();
    console.log(`sales return estimation: summary ${JSON.stringify(summary)}`);

    const resp = this.page.waitForResponse((r) => ['POST', 'PUT'].includes(r.request().method()) && /SalesReturnEstimation/i.test(r.url()) && !/Get|Pagination|Lookup|Search/i.test(r.url().split('/sioniq/')[1] || ''), { timeout: 120_000 }).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    await this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) throw new Error(`Sales Return Estimation Submit fired no save request - invalid: ${JSON.stringify(await this.invalidControls())}; alerts: ${JSON.stringify(await this.toasts())}`);
    const body = await r.json().catch(() => null);
    console.log('sales return estimation save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('sales return estimation', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Sales Return Estimation rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return { body, rows, summary };
  }

  /**
   * Sales Return Registration against an SR estimation: Entry Mode Estimation,
   * SR Estimation No, Add, the refund (Payment dialog, `refund.mode`, the
   * balance by default), Submit. Returns the save body.
   */
  async registerSalesReturn({ estimationNo, refund = { mode: 'Cash' }, allocationAmount, description }) {
    await this.goto('/pos/view-sales-return-registration');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(2_000);
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('estimationLookup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Sales Return Registration: the Add form did not open after 4 clicks on "+"');
    }
    await this.settle(2_000);
    await this.pickUnlessSet('entryMode', 'Estimation');
    await this.settle(1_500);
    const host = this.select('estimationLookup');
    const want = new RegExp(`^\\s*${escapeRe(String(estimationNo))}\\s*$`);
    let picked = false;
    let offered = [];
    for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
      await this.closeStalePanels();
      const listed = this.page.waitForResponse((r) => /EstimationLookup/i.test(r.url()), { timeout: 15_000 }).catch(() => null);
      await host.locator('.ng-select-container').click({ timeout: T(10_000) });
      if (attempt > 1) await host.locator('input[role="combobox"]').fill(String(estimationNo)).catch(() => {});
      await listed;
      await this.settle(2_000);
      const panel = this.page.locator('.ng-dropdown-panel .ng-option');
      offered = (await panel.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
      const idx = offered.findIndex((t) => want.test(t) || t.split(/\s+/)[0] === String(estimationNo));
      if (idx >= 0) { await panel.nth(idx).click({ timeout: T(10_000) }); picked = await this.valueLanded(host, new RegExp(escapeRe(String(estimationNo))), 5_000); }
      if (!picked) { await this.page.keyboard.press('Escape'); console.log(`sales return registration: SR estimation ${estimationNo} not picked on attempt ${attempt} - offered ${JSON.stringify(offered.slice(0, 12))}`); }
    }
    if (!picked) throw new Error(`Sales Return Registration: SR estimation ${estimationNo} is not offered (approved?) - offered ${JSON.stringify(offered.slice(0, 12))}`);
    await this.waitForIdle();
    await this.settle(2_000);
    const add = this.page.locator('button').filter({ hasText: /^\s*Add\s*$/ }).locator('visible=true').last();
    if (await add.isVisible({ timeout: 2_000 }).catch(() => false)) { await add.click({ timeout: T(10_000) }); await this.waitForIdle(); await this.settle(2_500); }
    let summary = await this.summaryNumbers();
    console.log(`sales return registration: estimation ${estimationNo} added - summary ${JSON.stringify(summary)}; toasts ${JSON.stringify(await this.toasts())}`);
    if (!summary.items) throw new Error(`Sales Return Registration: estimation ${estimationNo} added no entry (summary ${JSON.stringify(summary)}; toasts ${JSON.stringify(await this.toasts())})`);

    // the refund: "Payment" opens the payment dialog (the shared component);
    // the balance is refunded in the given mode unless an allocation is wanted
    if (allocationAmount !== undefined) {
      const amt = this.page.locator('input#allocationAmount').locator('visible=true').first();
      await amt.fill(String(allocationAmount));
      await amt.blur();
      if (description) await this.page.locator('input#allocationDescription, textarea#allocationDescription').locator('visible=true').first().fill(description).catch(() => {});
      await this.settle(1_500);
    } else if (refund) {
      const payBtn = this.page.locator('button').filter({ hasText: /^\s*Payment\s*$/ }).locator('visible=true').last();
      await payBtn.click({ timeout: T(15_000) });
      await this.waitForIdle();
      await this.settle(3_000);
      const dlg = this.page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment|PAYMENT MODES|BALANCE DUE|Refund/i }).locator('visible=true').last();
      if (!(await dlg.waitFor({ state: 'visible', timeout: T(15_000) }).then(() => true).catch(() => false))) throw new Error(`Sales Return Registration: "Payment" opened no payment dialog (toasts ${JSON.stringify(await this.toasts())})`);
      const paid = await this.addPaymentEntry(dlg, { mode: refund.mode || 'Cash', amount: refund.amount, what: 'sales return refund' });
      const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click({ timeout: 5_000 }).catch(() => {});
      await this.settle(2_000);
      summary = await this.summaryNumbers();
      console.log(`sales return registration: refund ${paid} by ${refund.mode || 'Cash'} - refund rows ${JSON.stringify(await this.rowsOf(/Ref \/ No|Mode/))}; summary ${JSON.stringify(summary)}`);
    }

    const resp = this.page.waitForResponse((r) => ['POST', 'PUT'].includes(r.request().method()) && /SalesReturnRegistration/i.test(r.url()) && !/Get|Pagination|Lookup/i.test(r.url().split('/sioniq/')[1] || ''), { timeout: 120_000 }).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    await this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) throw new Error(`Sales Return Registration Submit fired no save request - invalid: ${JSON.stringify(await this.invalidControls())}; alerts: ${JSON.stringify(await this.toasts())}`);
    const body = await r.json().catch(() => null);
    console.log('sales return registration save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('sales return registration', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Sales Return Registration rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return body;
  }
  /** "Item No" select offered after a bill search (selectedSalesInvoiceItemID): pick `<bill>.1` (or the first line). */
  async pickBillItemIfOffered(billNo) {
    const host = this.page.locator('sioniq-ng-select[controlname="selectedSalesInvoiceItemID"] ng-select, ng-select[formcontrolname="selectedSalesInvoiceItemID"]').locator('visible=true').first();
    if (!(await host.isVisible({ timeout: 2_500 }).catch(() => false))) return false;
    const addItem = this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
    const current = ((await host.locator('.ng-value').first().textContent().catch(() => '')) || '').replace(/×/g, '').trim();
    if (current && (await addItem.isVisible({ timeout: 3_000 }).catch(() => false))) { console.log(`sales return: bill item already "${current}" and the item card is up`); return true; }
    // a pre-filled Item No does NOT load the item card (bill 94, 14-11-2026): clear it
    // and select the line again so the card (and Add Item) renders
    if (current) {
      await host.locator('.ng-clear-wrapper, .ng-clear').first().click({ timeout: 2_000 }).catch(() => {});
      await this.settle(800);
    }
    const opts = await this.optionsOf('selectedSalesInvoiceItemID').catch(() => []);
    const want = opts.find((o) => o.startsWith(`${billNo}.`)) || current || opts[0];
    if (!want || /No items/i.test(want)) { console.log(`sales return: Item No select offers nothing (${JSON.stringify(opts)})`); return false; }
    await this.pick('selectedSalesInvoiceItemID', want, { exact: true });
    await this.waitForIdle();
    const cardUp = await addItem.waitFor({ state: 'visible', timeout: T(15_000) }).then(() => true).catch(() => false);
    await this.settle(2_000);
    console.log(`sales return: bill item "${want}" picked (of ${JSON.stringify(opts.slice(0, 6))}) - item card ${cardUp ? 'up' : 'NOT shown'}`);
    return cardUp;
  }

  /**
   * Sales Return Registration, Entry Mode DIRECT (the flow since 14-11-2026 -
   * "direct from sales return estimation": the registration carries the
   * estimation's own form): Business Type [masterDataValueID_BusinessType]
   * first, Salesman ID [salesmanID: sales codes] -> Salesman Name, Helper
   * [helperID], Supervisor, Jewellery Item Type, Sales Return Type [BillWise],
   * Mobile Number (input#srrMobileNumber) / Customer [customerID], old bill
   * search (input#srrBillSearch "Enter the exact Bill No or Receipt Item No" +
   * Search) -> item -> Add Item -> Sales Return Entries (with a Return Type
   * column) -> Refund Payment ("Payment": the balance in `refund.mode`) ->
   * Submit (SalesReturnRegistration/CreateSalesReturnRegistration, receiptNo
   * e.g. PLKSSS26). Returns { body, rows, summary }.
   */
  async registerSalesReturnDirect({ businessType = 'Retail', salesmanCode = 'AJ10', helper = 'Chandu', supervisor, itemType = 'Metal', returnType = 'BillWise', customer, billNo, refund = { mode: 'Cash' } }) {
    await this.goto('/pos/view-sales-return-registration');
    await this.waitForIdle();
    await this.waitForSpinner();
    await this.settle(2_000);
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('entryMode').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Sales Return Registration: the Add form did not open after 4 clicks on "+"');
    }
    await this.settle(2_000);
    await this.pickUnlessSet('entryMode', 'Direct');
    await this.waitForIdle();
    await this.settle(2_000);
    await this.select('masterDataValueID_RetailSalesReturnType').waitFor({ state: 'visible', timeout: T(15_000) });

    await this.pickUnlessSet('masterDataValueID_BusinessType', businessType);
    await this.settle(1_500);
    const picked = await this.pick('salesmanID', salesmanCode, { search: true, exact: true }).then(() => true).catch(() => false);
    if (!picked) {
      const opts = await this.optionsOf('salesmanID').catch(() => []);
      console.log(`sales return registration: salesman code "${salesmanCode}" not offered (first options ${JSON.stringify(opts.slice(0, 10))}) - picking the first`);
      await this.pick('salesmanID', opts[0], { exact: true });
    }
    await this.settle(1_200);
    if (helper) await this.pick('helperID', helper, { search: true }).catch((e) => console.log(`sales return registration: helper skipped - ${String(e.message).split('\n')[0].slice(0, 100)}`));
    if (supervisor) await this.pick('supervisorID', supervisor, { search: true }).catch(() => {});
    await this.pickUnlessSet('masterDataValueID_JewelleryItemType', itemType);
    await this.pickUnlessSet('masterDataValueID_RetailSalesReturnType', returnType);
    await this.settle(1_000);
    if (customer) {
      if (customer.mobile) {
        const mob = this.page.locator('input#srrMobileNumber').locator('visible=true').first();
        await mob.fill(String(customer.mobile));
        await mob.blur();
        await this.waitForIdle();
        await this.settle(2_500);
      }
      if (customer.name && !(await this.selectValue('customerID').catch(() => ''))) await this.pick('customerID', customer.name, { search: true, exact: true });
      await this.settle(1_500);
      console.log(`sales return registration: customer "${await this.selectValue('customerID').catch(() => '')}"`);
    }

    const box = this.page.locator('input#srrBillSearch').locator('visible=true').first();
    await box.waitFor({ state: 'visible', timeout: T(15_000) });
    const searched = this.page.waitForResponse((r) => /SalesReturn.*(Bill|Search|Item)/i.test(r.url()) && !/KeepAlive|Translation|Pagination|Lookup/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 30_000 }).catch(() => null);
    await box.fill(String(billNo));
    await box.press('Enter');
    const searchBtn = this.page.locator('button').filter({ hasText: /^\s*Search\s*$/ }).locator('visible=true').last();
    if (await searchBtn.isVisible({ timeout: 1_500 }).catch(() => false) && !(await this.rowsOf(/Bill No/).then((r) => r.length))) await searchBtn.click({ timeout: 5_000 }).catch(() => {});
    const sr = await searched;
    const srBody = sr ? await sr.json().catch(() => null) : null;
    if (sr) console.log(`sales return registration: bill search ${sr.status()} ${sr.url().split('/sioniq/')[1]?.split('?')[0]} ${JSON.stringify(srBody).slice(0, 260)}`);
    await this.waitForIdle();
    await this.settle(3_000);
    let rows = await this.rowsOf(/Bill No/);
    if (!rows.length) {
      await this.pickBillItemIfOffered(billNo);
      const addItem = this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
      if (await addItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
        if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
        await addItem.click({ timeout: T(15_000) });
        await this.waitForIdle();
        await this.settle(2_500);
        rows = await this.rowsOf(/Bill No/);
      }
    }
    const toasts = await this.toasts();
    console.log(`sales return registration: bill ${billNo} -> entries ${JSON.stringify(rows)}${toasts.length ? `; toasts ${JSON.stringify(toasts)}` : ''}`);
    if (!rows.length) throw new Error(`Sales Return Registration (Direct): bill ${billNo} added no Sales Return Entries (toasts ${JSON.stringify(toasts)}; search ${JSON.stringify(srBody).slice(0, 200)})`);
    let summary = await this.summaryNumbers();
    console.log(`sales return registration: summary ${JSON.stringify(summary)}`);

    if (refund) {
      const payBtn = this.page.locator('button').filter({ hasText: /^\s*Payment\s*$/ }).locator('visible=true').last();
      await payBtn.click({ timeout: T(15_000) });
      await this.waitForIdle();
      await this.settle(3_000);
      const dlg = this.page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment|PAYMENT MODES|BALANCE DUE|Refund/i }).locator('visible=true').last();
      if (!(await dlg.waitFor({ state: 'visible', timeout: T(15_000) }).then(() => true).catch(() => false))) throw new Error(`Sales Return Registration: "Payment" opened no payment dialog (toasts ${JSON.stringify(await this.toasts())})`);
      const paid = await this.addPaymentEntry(dlg, { mode: refund.mode || 'Cash', amount: refund.amount, what: 'sales return refund' });
      const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click({ timeout: 5_000 }).catch(() => {});
      await this.settle(2_000);
      summary = await this.summaryNumbers();
      console.log(`sales return registration: refund ${paid} by ${refund.mode || 'Cash'} - summary ${JSON.stringify(summary)}`);
    }

    const resp = this.page.waitForResponse((r) => ['POST', 'PUT'].includes(r.request().method()) && /SalesReturnRegistration/i.test(r.url()) && !/Get|Pagination|Lookup|Search/i.test(r.url().split('/sioniq/')[1] || ''), { timeout: 120_000 }).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    await this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) throw new Error(`Sales Return Registration Submit fired no save request - invalid: ${JSON.stringify(await this.invalidControls())}; alerts: ${JSON.stringify(await this.toasts())}`);
    const body = await r.json().catch(() => null);
    console.log('sales return registration save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('sales return registration', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Sales Return Registration rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return { body, rows, summary };
  }
}

module.exports = { SalesReturnPage };
