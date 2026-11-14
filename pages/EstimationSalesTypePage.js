const { OrderEstimationPage } = require('./OrderEstimationPage');
const { escapeRe } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * The "Estimation" tab of Retail Operations > Operations > Estimations
 * (/pos/app-order-estimation-setup) - the general estimation whose Sales Type
 * integrates the other retail transactions (probed 14-11-2026 at Kakkanad):
 *
 *   Customer Details: Mobile Number (input#mobileNumber narrows the customer
 *   list) / Customer Name [customerID]
 *   Estimate Configuration: Business Type [masterDataValueID_BusinessType: B2C |
 *   Retail], Making Type [masterDataValueID_EstimationMakingType: Job Work |
 *   Normal], Estimation Type [masterDataValueID_EstimationType: Locker | Normal |
 *   Part Sale], Sales Type [masterDataValueID_EstimationSalesType: EMA | Normal
 *   Sale | Order | Sales Return], Sales Executive, Sales Executive Code.
 *   Sales Type reveals:
 *     EMA          -> "EMA Members": Member Number (input#emaMemberNo, "Type or
 *                     scan") / Select Member [memberPick: "CODE · Name"]; the
 *                     member lands in the EMA Members grid (Member Number,
 *                     Customer, Plan, Plan Type, Enrollment Location, EMA
 *                     Amount, Accumulated Weight, Installments "paid / total",
 *                     Closure Type, Bonus, Deferral, Benefit) and the tiles
 *                     Estimation Amount / EMA Amount / Bonus / Deferral /
 *                     Total Benefit / Need to Pay.
 *     Order        -> Order Type [advanceTypeID: Advance | Order | Reserve],
 *                     Receipt No [advanceID: the customer's registrations of
 *                     that type, server-paginated], Transaction Date
 *                     (input#rateFixAdvanceDate, read-only), then Order Item
 *                     [advanceItemID] - the same controls as the Retail Invoice.
 *     Sales Return -> Old Bill No [oldBillNo: the customer's invoices, type to
 *                     search], Old Bill Date (input#rateFixOldBillDate,
 *                     read-only), Return Item [returnItemID: the bill's items].
 *     Normal Sale  -> nothing extra.
 *   Item Entry: Scan Type [masterDataValueID_ScanType: Tag Number | RFID], Tag
 *   Number (input#scanValue) + Scan, Clear Item / Add Item; Proceed To
 *   Payment / Submit.
 *
 * The POS "+" only opens the form on a session that went through the login
 * FORM (counter validation) - the spec clears the session cache first.
 */
class EstimationSalesTypePage extends OrderEstimationPage {
  constructor(page) {
    super(page);
    this.tabName = 'Estimation';
  }

  /** Open the page, the "Estimation" tab and its Add form. */
  async openForm() {
    await this.goto('/pos/app-order-estimation-setup');
    await this.waitForIdle();
    await this.waitForSpinner();
    const tab = this.page.getByRole('tab', { name: /^\s*Estimation\s*$/ }).locator('visible=true').first();
    await tab.click({ timeout: T(60_000) });
    await this.waitForSpinner();
    await this.settle(2_000);
    for (let i = 0; i < 4; i++) {
      await this.waitForSpinner().catch(() => {});
      await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: T(60_000) });
      if (await this.select('customerID').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) break;
      if (i === 3) throw new Error('Estimation: the Add form did not open after 4 clicks on "+" (POS counter validation? log in through the form)');
    }
    await this.settle(2_000);
  }

  /** Mobile number (narrows the list) then the customer by name. */
  async setCustomer({ name, mobile, businessType = 'Retail' }) {
    if (mobile) {
      const mob = this.page.locator('input#mobileNumber').locator('visible=true').first();
      await mob.fill(String(mobile));
      await mob.blur();
      await this.waitForIdle();
      await this.settle(2_500);
    }
    await this.pick('customerID', name, { search: true, exact: true });
    await this.settle(2_000);
    // Business Type is NOT pre-filled here (14-11-2026) and the Receipt No /
    // Old Bill lookups answer 501 "Business Type is Required." without it
    await this.pickUnlessSet('masterDataValueID_BusinessType', businessType);
    await this.settle(1_500);
    const got = await this.selectValue('customerID').catch(() => '');
    console.log(`estimation: customer "${got}" (mobile ${mobile || '-'}), business type "${await this.selectValue('masterDataValueID_BusinessType').catch(() => '')}"`);
    return got;
  }

  async pickSalesType(type) {
    await this.pickUnlessSet('masterDataValueID_EstimationSalesType', type);
    await this.waitForIdle();
    await this.settle(2_000);
    return this.selectValue('masterDataValueID_EstimationSalesType').catch(() => '');
  }

  /** Which Sales-Type-specific controls are on screen right now. */
  async revealedControls() {
    const vis = async (loc) => loc.locator('visible=true').first().isVisible({ timeout: 1_000 }).catch(() => false);
    return {
      emaMemberNo: await vis(this.page.locator('input#emaMemberNo')),
      memberPick: await vis(this.page.locator('sioniq-ng-select[controlname="memberPick"]')),
      advanceTypeID: await vis(this.page.locator('sioniq-ng-select[controlname="advanceTypeID"]')),
      advanceID: await vis(this.page.locator('sioniq-ng-select[controlname="advanceID"]')),
      oldBillNo: await vis(this.page.locator('sioniq-ng-select[controlname="oldBillNo"]')),
      returnItemID: await vis(this.page.locator('sioniq-ng-select[controlname="returnItemID"]')),
      scanValue: await vis(this.page.locator('input#scanValue')),
      scanButton: await vis(this.page.locator('button').filter({ hasText: /\bScan\b/ }).filter({ hasNotText: /Type/ })),
    };
  }

  /** Numbers of the EMA tiles ("Estimation Amount 32431.40 EMA Amount 58750.00 ... Need to Pay --"). */
  async emaTiles() {
    const text = (await this.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))) || '';
    const n = (label) => { const m = text.match(new RegExp(`${label}\\s*(--|[\\d,]+(?:\\.\\d+)?)`, 'i')); return m ? (m[1] === '--' ? null : Number(m[1].replace(/,/g, ''))) : undefined; };
    return { estimationAmount: n('Estimation Amount'), emaAmount: n('EMA Amount'), bonus: n('Bonus Amount'), deferral: n('Deferral Amount'), totalBenefit: n('Total Benefit'), needToPay: n('Need to Pay'), members: (text.match(/(\d+)\s+members\b/i) || [])[1] };
  }

  /** The EMA Members grid rows (MEMBER NUMBER / CUSTOMER / PLAN / ...). */
  async emaMemberRows() {
    const table = this.page.locator('table').filter({ has: this.page.locator('th', { hasText: /Member Number/i }) }).locator('visible=true').first();
    if (!(await table.isVisible({ timeout: 2_000 }).catch(() => false))) return [];
    return (await table.locator('tbody tr').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No (entries|data|members)/i.test(t));
  }

  /**
   * Sales Type EMA, "Select Member": the members the estimation offers this
   * customer (Estimation/GetEstimationEMAMembersDropdown - memberNo,
   * customerName, adpPlanName, accountAvailableClosureAmountTran = what the
   * member has paid in so far). Returns the entry for `memberNo` (or null) and
   * every entry listed.
   */
  async emaMembersOffered(memberNo) {
    const host = this.select('memberPick');
    await this.closeStalePanels();
    const listed = this.page.waitForResponse((r) => /GetEstimationEMAMembersDropdown/i.test(r.url()), { timeout: 20_000 }).catch(() => null);
    await host.locator('.ng-select-container').click({ timeout: T(10_000) });
    await host.locator('input[role="combobox"]').fill(String(memberNo)).catch(() => {});
    const r = await listed;
    await this.settle(1_500);
    const shown = (await this.page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    await this.page.keyboard.press('Escape');
    const body = r ? await r.json().catch(() => null) : null;
    const all = (body && body.data) || [];
    const entry = all.find((m) => m.memberNo === memberNo) || null;
    console.log(`estimation EMA: Select Member offers ${all.length} member(s) (panel ${JSON.stringify(shown.slice(0, 5))}); ${memberNo} ${entry ? `-> ${entry.customerName}, ${entry.adpPlanName}, available closure amount ${entry.accountAvailableClosureAmountTran}` : 'NOT offered'}`);
    return { entry, all, shown };
  }

  /**
   * Sales Type EMA: type the member number (Enter) - Estimation/
   * GetEstimationEMAMemberByMemberNo stages the member in the EMA Members
   * grid. The app refuses a member whose PLAN has no closure types configured
   * (501 "No closure type is configured for plan ..." - qa, 14-11-2026); that
   * refusal comes back as `setupGap` instead of a row.
   */
  async pickupEmaMember(memberNo) {
    const box = this.page.locator('input#emaMemberNo').locator('visible=true').first();
    await box.waitFor({ state: 'visible', timeout: T(15_000) });
    const fetched = this.page.waitForResponse((r) => /GetEstimationEMAMemberByMemberNo/i.test(r.url()), { timeout: 20_000 }).catch(() => null);
    await box.fill(String(memberNo));
    await box.press('Enter');
    const fr = await fetched;
    const fetchBody = fr ? await fr.json().catch(() => null) : null;
    if (fr) console.log(`estimation EMA: ${fr.status()} GetEstimationEMAMemberByMemberNo ${JSON.stringify(fetchBody).slice(0, 300)}`);
    await this.waitForIdle();
    await this.settle(3_000);
    const rows = await this.emaMemberRows();
    const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const tiles = await this.emaTiles();
    const refusal = (fetchBody && fetchBody.error) || toasts.find((t) => /Setup required|configure/i.test(t)) || '';
    const setupGap = /closure type|configure/i.test(refusal) ? refusal : '';
    console.log(`estimation EMA: member ${memberNo} -> rows ${JSON.stringify(rows)}; tiles ${JSON.stringify(tiles)}${toasts.length ? `; toasts ${JSON.stringify(toasts)}` : ''}${setupGap ? `; SETUP-GAP: ${setupGap}` : ''}`);
    return { row: rows.find((r) => r.includes(memberNo)) || '', rows, tiles, toasts, setupGap, status: fr ? fr.status() : null };
  }

  /** Options of a select, read from its opened panel (server lists included). */
  async optionsOf(controlname, { search = '' } = {}) {
    const host = this.select(controlname);
    await this.closeStalePanels();
    await host.locator('.ng-select-container').click({ timeout: T(10_000) });
    if (search) await host.locator('input[role="combobox"]').fill(search).catch(() => {});
    await this.settle(2_500);
    const opts = (await this.page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    await this.page.keyboard.press('Escape');
    await this.settle(300);
    return opts;
  }

  /**
   * Sales Type Order: Order Type (Advance | Order | Reserve) + Receipt No, then
   * the read-only Transaction Date and the Order Item options.
   */
  async pickupOrderReference({ orderType, receiptNo }) {
    await this.pick('advanceTypeID', orderType, { exact: true });
    await this.waitForIdle();
    await this.settle(2_000);
    const host = this.select('advanceID');
    const want = new RegExp(`^\\s*${escapeRe(String(receiptNo))}\\s*$`);
    let picked = false;
    let offered = [];
    for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
      await this.closeStalePanels();
      const listed = this.page.waitForResponse((r) => /Paginated|Advance|Reserve|Order/i.test(r.url()) && r.request().method() === 'POST' && !/KeepAlive|Customers/i.test(r.url()), { timeout: 15_000 }).catch(() => null);
      await host.locator('.ng-select-container').click({ timeout: T(10_000) });
      if (attempt > 1) await host.locator('input[role="combobox"]').fill(String(receiptNo)).catch(() => {}); // the search box may filter on something else - plain list first
      await listed;
      await this.settle(2_500);
      const panel = this.page.locator('.ng-dropdown-panel .ng-option');
      offered = (await panel.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
      const idx = offered.findIndex((t) => want.test(t));
      if (idx >= 0) {
        await panel.nth(idx).click({ timeout: T(10_000) });
        picked = await this.valueLanded(host, new RegExp(escapeRe(String(receiptNo))), 5_000);
      }
      if (!picked) { await this.page.keyboard.press('Escape'); console.log(`estimation Order: receipt ${receiptNo} not picked on attempt ${attempt} - offered ${JSON.stringify(offered.slice(0, 15))}`); }
    }
    await this.waitForIdle();
    await this.settle(2_500);
    const date = (await this.page.locator('input#rateFixAdvanceDate').locator('visible=true').first().inputValue().catch(() => '')) || '';
    const itemSel = this.page.locator('sioniq-ng-select[controlname="advanceItemID"]').locator('visible=true').first();
    const items = (await itemSel.isVisible({ timeout: 3_000 }).catch(() => false)) ? await this.optionsOf('advanceItemID') : [];
    const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`estimation Order: ${orderType} ${receiptNo} -> picked ${picked}, Transaction Date "${date}", items ${JSON.stringify(items)}${toasts.length ? `, toasts ${JSON.stringify(toasts)}` : ''}`);
    return { picked, date, items, offered, toasts, receipt: await this.selectValue('advanceID').catch(() => '') };
  }

  /** Toast / alert texts on screen. */
  async toasts() {
    return (await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  /** "No. of Items : n" / "No. of Pieces : n" of the Estimation Summary panel. */
  async summaryCounts() {
    return this.page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      const n = (re) => { const m = t.match(re); return m ? Number(m[1]) : 0; };
      const amt = (label) => { const m = t.match(new RegExp(`${label}\\s*:?\\s*(-?[\\d,]+(?:\\.\\d+)?)`)); return m ? Number(m[1].replace(/,/g, '')) : null; };
      return { items: n(/No\. of Items\s*:?\s*(\d+)/), pieces: n(/No\. of Pieces\s*:?\s*(\d+)/), total: amt('Total Amount'), estimationAmount: amt('Estimation Amount'), needToPay: amt('Need to Pay') };
    }).catch(() => ({ items: 0, pieces: 0 }));
  }

  /**
   * Item Entry: scan the tag (input#scanValue + Enter / Scan) - the tag's
   * details fill in - then "Add Item" moves it into Scanned Tags. Returns the
   * summary counts after the add.
   */
  async scanAndAddTag(tagNo, { rfidNo, applyOffer = false } = {}) {
    if (rfidNo) await this.pick('masterDataValueID_ScanType', 'RFID', { exact: true }).catch(() => {});
    const scan = this.page.locator('input#scanValue').locator('visible=true').first();
    await scan.waitFor({ state: 'visible', timeout: T(15_000) });
    const before = await this.summaryCounts();
    const scanned = this.page.waitForResponse((r) => /Tag|Scan/i.test(r.url()) && !/KeepAlive|GetAll|Pagination|GetMasterData|Translation|Dropdown/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 30_000 }).catch(() => null);
    await scan.fill(String(rfidNo || tagNo));
    await scan.press('Enter');
    const btn = this.page.locator('button').filter({ hasText: /\bScan\b/ }).filter({ hasNotText: /Type/ }).locator('visible=true').last();
    if (await btn.isEnabled({ timeout: 1_000 }).catch(() => false)) await btn.click({ timeout: 5_000 }).catch(() => {});
    const r = await scanned;
    const scanBody = r ? await r.json().catch(() => null) : null;
    if (r) console.log(`estimation: scan ${r.status()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} ${JSON.stringify(scanBody).slice(0, 240)}`);
    await this.waitForIdle();
    await this.settle(2_500);
    if (scanBody && scanBody.errorCode) throw new Error(`Estimation: the scan of tag ${tagNo} was refused - ${scanBody.error || scanBody.message}`);
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    if (applyOffer) {
      // Sales Type Sales Return (14-11-2026): the tag card ends in "Rate Difference -
      // Offer Amount" (Old Bill Rate / Today's Rate) with an "Apply Offer" checkbox;
      // the returned item's value shows as the Offer Value. Add Item stages nothing
      // while it is unticked.
      const offer = this.page.getByRole('checkbox', { name: /Apply Offer/i }).locator('visible=true').first();
      if (await offer.isVisible({ timeout: 3_000 }).catch(() => false)) {
        if (!(await offer.isChecked().catch(() => false))) { await offer.click({ timeout: 5_000 }).catch(async () => offer.click({ force: true })); await this.settle(1_500); }
        console.log(`estimation: Apply Offer ${await offer.isChecked().catch(() => '?')}`);
      } else console.log('estimation: no "Apply Offer" checkbox on the tag card');
    }
    const addItem = this.page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last();
    await addItem.click({ timeout: T(15_000) });
    await this.waitForIdle();
    await this.settle(2_500);
    const row = this.page.locator('table tbody tr').locator('visible=true').filter({ hasText: String(tagNo) }).first();
    const staged = async () => (await this.summaryCounts()).items > before.items || (await row.isVisible().catch(() => false));
    let deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(await staged())) await this.page.waitForTimeout(500);
    if (!(await staged())) {
      // Sales Type Sales Return (14-11-2026): the first Add Item right after the scan
      // staged nothing while the card was still pricing (tax calls, Rate Difference
      // block) and gave no toast - a second click a few seconds later stages the tag
      console.log(`estimation: "Add Item" staged nothing for ${tagNo} on the first click - clicking again`);
      await this.settle(3_000);
      await addItem.click({ timeout: T(15_000) });
      await this.waitForIdle();
      deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(await staged())) await this.page.waitForTimeout(500);
    }
    const after = await this.summaryCounts();
    if (!(await staged())) throw new Error(`Estimation: "Add Item" did not move tag ${tagNo} into Scanned Tags (summary ${JSON.stringify(after)}). Toasts: ${JSON.stringify(await this.toasts())}; invalid: ${JSON.stringify(await this.invalidControls())}`);
    console.log(`estimation: tag ${tagNo} added - summary ${JSON.stringify(after)}`);
    return after;
  }

  /** Submit the estimation (the green Submit; no payment is collected here). Returns the save body. */
  async submitEstimation() {
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /Estimation/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Dropdown|Translation|Get[A-Z]\w*$|ByMemberNo|Scan/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000);
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    const submit = this.page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last();
    await submit.click({ timeout: T(15_000) });
    const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Are you sure|Confirm|proceed/i }).getByRole('button', { name: /^Yes$|Ok|Confirm/i }).last();
    if (await confirm.isVisible({ timeout: 4_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) throw new Error(`Estimation Submit fired no save request - invalid: ${JSON.stringify(await this.invalidControls())}; alerts: ${JSON.stringify(await this.toasts())}`);
    const body = await r.json().catch(() => null);
    console.log('estimation save:', r.status(), r.url().split('/').slice(-2).join('/'), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('estimation', toast).catch(() => {});
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Estimation rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    this.lastSaveBody = body;
    return body;
  }

  /** Sales Type Sales Return: Old Bill No (the invoice) -> Old Bill Date + Return Item options. */
  async pickupSalesReturnBill(billNo) {
    const host = this.select('oldBillNo');
    const want = new RegExp(`^\\s*${escapeRe(String(billNo))}\\s*$`);
    let picked = false;
    let offered = [];
    for (let attempt = 1; attempt <= 3 && !picked; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click({ timeout: T(10_000) });
      if (attempt !== 2) await host.locator('input[role="combobox"]').fill(String(billNo)).catch(() => {}); // "Type to search"; attempt 2 reads the plain list
      await this.settle(2_500);
      const panel = this.page.locator('.ng-dropdown-panel .ng-option');
      offered = (await panel.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
      const idx = offered.findIndex((t) => want.test(t) || t.split(/\s+/).includes(String(billNo)));
      if (idx >= 0) {
        await panel.nth(idx).click({ timeout: T(10_000) });
        picked = await this.valueLanded(host, new RegExp(escapeRe(String(billNo))), 5_000);
      }
      if (!picked) { await this.page.keyboard.press('Escape'); console.log(`estimation Sales Return: bill ${billNo} not picked on attempt ${attempt} - offered ${JSON.stringify(offered.slice(0, 15))}`); }
    }
    await this.waitForIdle();
    await this.settle(2_500);
    const date = (await this.page.locator('input#rateFixOldBillDate').locator('visible=true').first().inputValue().catch(() => '')) || '';
    const items = await this.optionsOf('returnItemID').catch(() => []);
    const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`estimation Sales Return: bill ${billNo} -> picked ${picked}, Old Bill Date "${date}", items ${JSON.stringify(items)}${toasts.length ? `, toasts ${JSON.stringify(toasts)}` : ''}`);
    return { picked, date, items, offered, toasts, bill: await this.selectValue('oldBillNo').catch(() => '') };
  }
}

module.exports = { EstimationSalesTypePage };
