const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Transfers — Sales & Distribution > Transfer In & Out > Transfers.
 * Route: /sls/view-transfer. qap "process wise" client (mapped live 11-09-2026).
 *
 * "Business Unit to Business Unit Transfer" with two tabs: Transfer Out (issue
 * stock to another BU) and Transfer In (receive it). The form's selects are
 * plain <ng-select> without controlname, so they are targeted by their label.
 *
 * Transfer Out cascade: Transfer Mode (Confirmed) -> Destination Business Unit
 * (Aluva) -> Transaction Mode (Stock) -> Item Type (Metal) -> Group Category
 * (Gold) -> From Process (Lot FVHK) -> From Transaction Type (Internal Stock
 * Transfer) -> Scan Type (Tag Number, default) -> enter tag -> Add -> Add
 * Selected to Transfer -> Submit.
 */
class TransfersPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Transfers');
    this.addBtn = page.locator('button:has(i.ri-add-fill), .btn.border-0').locator('visible=true').first();
  }

  async open() {
    await this.goto('/sls/view-transfer');
    await this.waitForIdle();
    await this.waitForSpinner();
  }

  async openTab(name) {
    await this.page.getByRole('tab', { name: new RegExp(name, 'i') }).first().click({ timeout: 20_000 });
    await this.waitForIdle();
    await this.page.waitForTimeout(1_000);
  }

  async closePanel() {
    if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(300); }
  }

  /** The <ng-select> immediately following the label whose text contains `label`. */
  selectByLabel(label) {
    return this.page.locator(`xpath=//label[contains(normalize-space(.),"${label}")]/following::ng-select[1]`).first();
  }

  async pickByLabelText(label, re, { timeout = 6_000 } = {}) {
    await this.closePanel();
    const cont = this.selectByLabel(label);
    await cont.locator('.ng-select-container').first().click({ timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(700);
    const ok = await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: re }).first().click({ timeout }).then(() => true).catch(() => false);
    await this.page.waitForTimeout(1_500);
    // On a miss, close the panel so a caught (best-effort) pick doesn't leave an
    // open dropdown that blocks the next field.
    if (!ok) { await this.closePanel(); throw new Error(`Transfers: option ${re} not found for "${label}"`); }
  }

  /** Transfer Out a tag to another BU. Returns the save-response body. */
  async transferOut({
    destination = 'Aluva', transactionMode = 'Stock', itemType = 'Metal', groupCategory = 'Gold',
    fromProcess = 'Lot FVHK', fromTransactionType = 'Internal Stock Transfer', tag,
  }) {
    await this.open();
    await this.openTab('Transfer Out');
    await this.addBtn.click({ timeout: 30_000 });
    await this.page.waitForTimeout(2_000);

    await this.pickByLabelText('Transfer Mode', /^\s*Confirmed\s*$/);
    await this.pickByLabelText('Destination Business Unit', new RegExp(destination));
    await this.pickByLabelText('Transaction Mode', new RegExp(`^\\s*${transactionMode}\\s*$`));
    await this.pickByLabelText('Item Type', new RegExp(`^\\s*${itemType}\\s*$`));
    // Group Category is a metal-only filter (Gold/Silver/...) with no Stone
    // groups. For stone it must be CLEARED (it auto-defaults to a metal group,
    // e.g. Gold, which then excludes the stone tag from the scan lookup).
    if (groupCategory) {
      await this.pickByLabelText('Group Category', new RegExp(`^\\s*${groupCategory}\\s*$`)).catch(() => {});
    } else {
      // Stone: the app auto-defaults Group Category to a metal group (Gold)
      // AFTER Item Type is chosen; wait for it, then clear it so the stone tag
      // is not filtered out. Retry - the clear button can render late.
      await this.closePanel();
      await this.page.waitForTimeout(1_200);
      const gc = this.selectByLabel('Group Category');
      for (let i = 0; i < 3; i++) {
        const has = await gc.locator('.ng-value').first().isVisible({ timeout: 800 }).catch(() => false);
        if (!has) break;
        await gc.locator('.ng-clear-wrapper, span.ng-clear').first().click({ force: true, timeout: 2_000 }).catch(() => {});
        await this.page.waitForTimeout(600);
      }
    }
    // From Process / From Transaction Type only exist when the source stock is in
    // a process (e.g. an HO issuing Lot-process stock). A branch transferring
    // plain received stock has neither - pass them only when applicable.
    if (fromProcess) await this.pickByLabelText('From Process', new RegExp(fromProcess)).catch(() => {});
    if (fromTransactionType) await this.pickByLabelText('From Transaction Type', new RegExp(fromTransactionType)).catch(() => {});
    // Scan Type defaults to Tag Number; enforce it if a picker is present
    await this.pickByLabelText('Scan Type', /Tag Number/).catch(() => {});
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);

    // enter the tag and Add it to the selection list
    const box = this.page.locator('app-sioniq-input input, input[placeholder*="tag" i]').locator('visible=true').first();
    await box.click({ timeout: 10_000 });
    await box.fill(String(tag));
    // the "Add" button beside Scan Value (glyph + text; distinct from "Add
    // Selected to Transfer"). Match by exact trimmed text, force past overlays.
    const addBtn = this.page.locator('button').filter({ hasText: /^\s*Add\s*$/ }).locator('visible=true').first();
    await addBtn.scrollIntoViewIfNeeded().catch(() => {});
    if (!(await addBtn.click({ timeout: 8_000, force: true }).then(() => true).catch(() => false))) {
      await box.press('Enter').catch(() => {}); // some builds add the tag on Enter
    }
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);

    // move the added tag(s) into the transfer
    const addSel = this.page.getByRole('button', { name: /Add Selected to Transfer/i }).locator('visible=true').last();
    if (await addSel.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await addSel.click();
      await this.waitForIdle();
      await this.page.waitForTimeout(2_000);
    }

    // Submit
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /transfer|create|save/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation|List|Search/i.test(r.url()),
      { timeout: 60_000 },
    ).catch(() => null);
    const submit = this.page.locator('button').filter({ hasText: /^\s*Submit\s*$/ }).locator('visible=true').last();
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    await submit.click({ timeout: 15_000, force: true });
    await this.page.waitForTimeout(1_500);
    const confirm = this.page.locator('[role="dialog"], .modal, ngb-modal-window').filter({ hasText: /Are you sure|Confirm/i }).getByRole('button', { name: /Yes|Ok|Confirm|Submit/i }).locator('visible=true').last();
    if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click().catch(() => {});
    const r = await resp;
    if (!r) throw new Error('Transfer Out Submit fired no save request - form silently blocked');
    const body = await r.json().catch(() => null);
    console.log('transfer out save:', r.status(), r.url().split('/').slice(-1)[0], JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Transfer Out rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    await this.page.locator('.btn-light, .btn-close').last().click({ timeout: 6_000 }).catch(() => {});
    return body;
  }

  /**
   * Transfer In (receive) the stock sent from another BU. Cascade: From Business
   * Unit -> Transaction Mode (Stock) -> Stock Source Type (TagWise) -> Item Type
   * (Metal) -> Group Category (Gold) -> a grid of incoming items; check the item,
   * enter the Receiver name, Accept. Returns the save-response body.
   */
  /** Select the Transfer Out ID (a server typeahead). Picks the matching receipt
   * number if given, else the first offered option. */
  async pickTransferOutId(receiptNo) {
    await this.closePanel();
    const cont = this.selectByLabel('Transfer Out ID');
    await cont.locator('.ng-select-container').first().click({ timeout: 10_000 }).catch(() => {});
    if (receiptNo) await cont.locator('input[role="combobox"]').fill(String(receiptNo)).catch(() => {});
    await this.page.waitForTimeout(1_800);
    const opt = receiptNo
      ? this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(String(receiptNo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
      : this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i }).first();
    await opt.click({ timeout: 10_000 });
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Rows of the list grid on a tab ("Transfer In" / "Transfer Out"), each as
   * one whitespace-normalised string, top row first. Optional `search` is
   * typed into the grid's search box first.
   */
  async listRowsText(tab, search) {
    await this.open();
    await this.openTab(tab);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
    if (search) {
      const box = this.page.getByRole('textbox', { name: /search/i }).locator('visible=true').first();
      if (await box.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await box.fill(String(search));
        await box.press('Enter').catch(() => {});
        await this.waitForIdle();
        await this.page.waitForTimeout(2_000);
      }
    }
    return (await this.page.locator('table tbody tr').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());
  }

  /**
   * Transfer In - RETURN the incoming items to the sender instead of
   * accepting them (the "Return" button beside "Accept" on the same form).
   */
  transferInReturn(opts) {
    return this.transferIn({ ...opts, action: 'Return' });
  }

  async transferIn({ fromBU = 'Kakkanad', transactionMode = 'Stock', stockSourceType = 'TagWise', itemType = 'Metal', groupCategory = 'Gold', transferOutNo, receiver = 'JJ', remarks, action = 'Accept' }) {
    await this.open();
    await this.openTab('Transfer In');
    await this.addBtn.click({ timeout: 30_000 });
    await this.page.waitForTimeout(2_000);

    await this.pickByLabelText('From Business Unit', new RegExp(fromBU));
    await this.pickByLabelText('Transaction Mode', new RegExp(`^\\s*${transactionMode}\\s*$`));
    await this.pickByLabelText('Stock Source Type', new RegExp(stockSourceType));
    await this.pickByLabelText('Item Type', new RegExp(`^\\s*${itemType}\\s*$`));
    await this.pickByLabelText('Group Category', new RegExp(`^\\s*${groupCategory}\\s*$`)).catch(() => {});
    // Transfer Out ID (the incoming receipt, e.g. OOO17) drives the item grid -
    // pick ours by receipt no, else take the first offered
    await this.pickTransferOutId(transferOutNo);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // load the incoming-items grid if a Search is required
    if (!(await this.page.locator('[id^="item-"], table tbody tr input[type="checkbox"]').first().isVisible({ timeout: 3_000 }).catch(() => false))) {
      await this.page.getByRole('button', { name: /^\s*Search\s*$/ }).locator('visible=true').last().click({ timeout: 6_000 }).catch(() => {});
      await this.waitForIdle();
      await this.page.waitForTimeout(2_500);
    }

    // check the incoming item (first row / #item-0)
    const box = this.page.locator('[id^="item-"], table tbody tr input[type="checkbox"]').locator('visible=true').first();
    await box.waitFor({ state: 'visible', timeout: 30_000 });
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
    await this.page.waitForTimeout(1_500);

    // receiver name
    const rec = this.page.getByRole('textbox', { name: /Enter receiver name/i }).locator('visible=true').first();
    if (await rec.isVisible({ timeout: 8_000 }).catch(() => false)) { await rec.click(); await rec.fill(String(receiver)); }
    if (remarks) {
      const rem = this.page.locator('//label[contains(.,"Remarks")]/following::textarea[1] | //label[contains(.,"Remarks")]/following::input[1]').locator('visible=true').first();
      if (await rem.isVisible({ timeout: 3_000 }).catch(() => false)) await rem.fill(String(remarks)).catch(() => {});
    }
    await this.page.waitForTimeout(800);

    // Accept (or Return - same form, the button beside Accept)
    const actionRe = new RegExp(`^\\s*${action}\\s*$`, 'i');
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /transfer|accept|create|save|return|reject/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation|List|Search/i.test(r.url()),
      { timeout: 60_000 },
    ).catch(() => null);
    const actionBtn = this.page.locator('button').filter({ hasText: actionRe }).locator('visible=true').last();
    await actionBtn.scrollIntoViewIfNeeded().catch(() => {});
    await actionBtn.click({ timeout: 15_000, force: true });
    await this.page.waitForTimeout(1_500);
    // confirmation (and, for Return, a possible reason box) in a dialog
    const dialog = this.page.locator('[role="dialog"], .modal, ngb-modal-window').filter({ hasText: /Are you sure|Confirm|Return|Reason|Remark/i }).locator('visible=true').last();
    if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const reason = dialog.locator('textarea, input[type="text"]').locator('visible=true').first();
      if (await reason.isVisible({ timeout: 1_000 }).catch(() => false) && !(await reason.inputValue().catch(() => ''))) {
        await reason.fill(remarks || `${action} by automation`).catch(() => {});
      }
      const confirm = dialog.getByRole('button', { name: /Yes|Ok|Confirm|Accept|Return|Submit/i }).locator('visible=true').last();
      if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click().catch(() => {});
    }
    const r = await resp;
    if (!r) throw new Error(`Transfer In ${action} fired no save request - form silently blocked`);
    const body = await r.json().catch(() => null);
    console.log(`transfer in ${action.toLowerCase()} save:`, r.status(), r.url().split('/').slice(-1)[0], JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`Transfer In ${action} rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    await this.page.locator('.btn-light, .btn-close').last().click({ timeout: 6_000 }).catch(() => {});
    return body;
  }
}

module.exports = { TransfersPage };
