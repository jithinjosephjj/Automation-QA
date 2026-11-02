const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Remodel workflow screens (QA lead recording + live mapping, 02-09-2026):
 *
 *   Remodel Issue    /inv/app-issue-list    ("Remodel" tab)
 *   Remodel Receipt  /inv/app-receipt-list  ("Remodel" tab)
 *
 * Issues draw the RR## series; downstream grids key rows by it.
 */
class RemodelWorkflowPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Remodel');
  }

  async openTab(route) {
    await this.goto(route);
    await this.waitForIdle();
    // tabs were renamed "Remodel Issue" / "Remodel Receipt" (19-09-2026)
    await this.page.getByRole('tab', { name: /^Remodel( Issue| Receipt)?$/ }).click();
    await this.waitForIdle();
    await this.settle(1_500);
  }

  async clickVisibleAdd() {
    await this.waitForSpinner();
    await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
    await this.waitForIdle();
    await this.settle(2_000);
  }

  rowMatcher(rowText) {
    const esc = String(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  // checkRow: the verified, retrying version in BasePage (30-09-2026)

  /** Fill still-empty visible selects generically: each wanted text goes into
   *  the first empty select whose panel offers it (retry rounds for selects
   *  that render only after earlier picks). */
  async fillEmptySelects(wanted) {
    for (let round = 0; round < 3; round++) {
      const wraps = this.page.locator('sioniq-ng-select').locator('visible=true');
      const n = await wraps.count();
      let pickedAny = false;
      for (let i = 0; i < n; i++) {
        const wrap = wraps.nth(i);
        // an empty select has NO .ng-value node - a blind textContent() on it
        // auto-waits the whole action timeout (15 s) for nothing
        const value = wrap.locator('.ng-value');
        const val = (await value.count()) ? ((await value.first().textContent({ timeout: 2_000 }).catch(() => '')) || '').trim() : '';
        if (val) continue;
        await wrap.locator('ng-select .ng-select-container').first().click({ timeout: 3_000 }).catch(() => {});
        await this.settle(1_500);
        let hit = false;
        for (const want of wanted) {
          const re = new RegExp(`^\\s*${String(want).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
          const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: re }).first();
          if (await opt.isVisible().catch(() => false)) {
            await opt.click();
            hit = true;
            pickedAny = true;
            await this.settle(2_000);
            break;
          }
        }
        if (!hit) await this.page.keyboard.press('Escape');
      }
      if (!pickedAny) break;
    }
  }

  /**
   * "Dispatch Details" on the Issue tabs (Hallmark since 02-11-2026, the
   * Approval Issue since 27-10): Dispatch Type is mandatory and Submit fires
   * nothing while it is empty. The option lists differ per screen (Hallmark
   * Issue: "Our Employee" | "Vendor Representative"; Approval Issue: "In
   * Person"), so the wanted type is picked when offered, else the FIRST
   * offered one. Whatever the choice reveals is filled: Person Name /
   * Contact Number inputs, and any still-empty mandatory select (an
   * employee / representative pick) gets its first option. The list can be
   * slow to load (empty on the first open, 02-11-2026) - reopened up to 4
   * times. A form without the section is a no-op.
   */
  async fillDispatchIfOffered({ dispatchType = 'Our Employee', dispatchPerson = 'JJ', dispatchContact = '9898989899', what = 'issue' } = {}) {
    return this.fillTypeSelectIfOffered({ label: 'Dispatch Type', controlname: 'masterDataValueID_DispatchType', dispatchType, dispatchPerson, dispatchContact, what });
  }

  /**
   * The RECEIPT forms' twin (Hallmark Receipt since 02-11-2026): "Receipt
   * Details > Receipt Type" (Our Employee | Vendor Representative), mandatory,
   * Submit silent while empty.
   */
  async fillReceiptTypeIfOffered({ receiptType = 'Our Employee', what = 'receipt' } = {}) {
    return this.fillTypeSelectIfOffered({ label: 'Receipt Type', controlname: 'masterDataValueID_ReceiptType', dispatchType: receiptType, what });
  }

  async fillTypeSelectIfOffered({ label, controlname, dispatchType = 'Our Employee', dispatchPerson = 'JJ', dispatchContact = '9898989899', what = 'issue' }) {
    let host = this.select(controlname);
    if (!(await host.isVisible({ timeout: 2_000 }).catch(() => false))) {
      host = this.page.locator(`xpath=//label[normalize-space(text())="${label}"]/following::ng-select[1]`).locator('visible=true').first();
      if (!(await host.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
    }
    let picked = '';
    for (let attempt = 1; attempt <= 4 && !picked; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      if (await opts.first().waitFor({ state: 'visible', timeout: attempt * 4_000 }).then(() => true).catch(() => false)) {
        const labels = (await opts.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
        let idx = labels.findIndex((l) => l.toLowerCase() === String(dispatchType).toLowerCase());
        if (idx < 0) idx = labels.findIndex((l) => l.toLowerCase().includes(String(dispatchType).toLowerCase()));
        if (idx < 0) idx = 0;
        await opts.nth(idx).click({ timeout: 5_000 });
        picked = labels[idx];
        console.log(`${what}: ${label} -> ${picked}${picked !== dispatchType ? ` (wanted "${dispatchType}")` : ''} (of ${JSON.stringify(labels)})`);
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
        console.log(`${what}: ${label} list empty on open ${attempt} - reopening`);
      }
    }
    if (!picked) {
      // a mandatory select with nothing to pick is a qa master-data gap, not
      // something to work around with made-up data
      throw new Error(`${what}: ${label} is mandatory but the dropdown offers no options on qa ("No items found") - configure its master data before this form can be submitted`);
    }
    await this.waitForIdle();
    await this.settle(1_500); // the choice reveals its own fields
    for (const [caption, value] of [['Person Name', dispatchPerson], ['Contact Number', dispatchContact]]) {
      if (!value) continue;
      // these forms caption with plain text nodes or labels - take the first enabled input after either
      const input = this.page
        .locator(`xpath=//*[normalize-space(text())="${caption}"]/following::input[not(@type="checkbox") and not(@disabled) and not(ancestor::ng-select)][1]`)
        .locator('visible=true').first();
      if (await input.isVisible({ timeout: 1_500 }).catch(() => false)) { await input.fill(String(value)); await input.blur(); console.log(`${what}: ${caption} -> ${value}`); }
    }
    if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects(); // e.g. the employee / representative select
    const invalid = await this.invalidControls();
    if (invalid.selects.length || invalid.inputs.length) console.log(`${what}: still invalid after ${label} ${JSON.stringify(invalid)}`);
    return true;
  }

  async clickAndCaptureSave(button, { pattern = /create|save|submit/i } = {}) {
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && pattern.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    let saved = false;
    resp.then(() => { saved = true; });
    await button.click();
    // post-Submit dialogs: an Add commit and/or a confirming second Submit -
    // only while the save has NOT fired yet (the page's own Submit stays on
    // screen during the save; clicking it again used to wait out 15 s)
    await this.settle(2_500);
    if (!saved) {
      const midAdd = this.page.locator('button').filter({ hasText: /Add\s*\d+/ }).locator('visible=true').last();
      if (await midAdd.isVisible().catch(() => false)) {
        await midAdd.click({ timeout: 3_000 }).catch(() => {});
        console.log('remodel: post-submit Add pressed');
        await this.settle(1_500);
      }
    }
    if (!saved) {
      const again = this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last();
      if (await again.isVisible().catch(() => false)) await again.click({ timeout: 3_000 }).catch(() => {});
    }
    const r = await resp;
    if (!r) throw new Error('Submit fired no save request - form silently blocked');
    const body = await r.json().catch(() => null);
    console.log('remodel save:', r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    return body;
  }

  async previewAndClose() {
    this.printPreviewError = null;
    const dialogVisible = await this.printDialog.waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true).catch(() => false);
    if (dialogVisible) {
      await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    }
    await this.closeVisibleDialog();
    await this.settle(1_000);
  }

  /**
   * Remodel Issue: Remodel Type + Vendor + Stock Source Type (a transaction
   * type select renders after "Inward") reveal the inward grid; check the
   * inward's row, commit via Add and Submit. Returns the RR## number.
   */
  async remodelIssue({ remodelType, vendor, sourceType = 'Inward', transactionType = 'Metal Inward', inwardNo }) {
    await this.openTab('/inv/app-issue-list');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_RemodelType', remodelType, { exact: true });
    await this.pick('vendorCatalogID', vendor, { exact: true });
    await this.pick('masterDataValueID_StockSourceType', sourceType, { exact: true });
    await this.fillEmptySelects([transactionType]);
    await this.waitForIdle();
    await this.settle(2_500);

    await this.checkRow(inwardNo);
    // the commit button sits below the grid and its NAME CARRIES THE
    // SELECTED-ROW COUNT ("Add 1") - scroll to it and click before Submit
    const add = this.page.locator('button').filter({ hasText: /Add\s*\d+/ }).locator('visible=true').last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.settle(2_000);
    console.log('remodel issue: selected stock committed via Add');
    await this.fillDispatchIfOffered({ what: 'remodel issue' });
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Remodel Receipt: Vendor FIRST, then Remodel Type (10-10-2026, QA lead:
   * the Remodel Type list stays "No items found" until a vendor is picked -
   * the form now renders Vendor before Remodel Type), Sub Transaction Type
   * preset Invoice, RANDOM invoice number, invoice date, credit days; then
   * Stock Source "Inward", the issue's grid row, Add (stages it), re-check
   * the staged row, Submit.
   */
  async remodelReceipt({ remodelType, vendor, invoiceNo, invoiceDate, creditDays = 20, issueNo }) {
    await this.openTab('/inv/app-receipt-list');
    await this.clickVisibleAdd();

    // vendor by its controlname (same control as the Issue form), by its
    // label when the receipt form names it differently
    await this.pick('vendorCatalogID', vendor, { exact: true })
      .catch(() => this.pickByLabel('Vendor', vendor, { exact: true }));
    await this.settle(2_000); // the vendor pick loads the Remodel Type list
    await this.pick('masterDataValueID_RemodelType', remodelType, { exact: true });
    await this.page.getByPlaceholder('Enter Invoice Number').fill(invoiceNo);
    const dd = this.page.locator('#invoiceDate');
    await dd.fill(invoiceDate);
    await dd.blur();
    await this.page.keyboard.press('Escape');
    if (creditDays !== undefined) {
      await this.fillByLabel('Credit Days', creditDays).catch(() => console.log('credit days fill skipped'));
    }
    // "Receipt Selection Type" gates the rest of the form - pick "RC Number"
    // (QA lead), falling back to the first offered option
    const rst = this.page.locator('label:text-is("Receipt Selection Type")').last().locator('xpath=following::ng-select[1]');
    await rst.locator('.ng-select-container').click();
    const rcOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /RC/i }).first();
    const anyOpt = this.page.locator('.ng-dropdown-panel .ng-option').first();
    await anyOpt.waitFor({ state: 'visible', timeout: 15_000 });
    const rstOpt = (await rcOpt.isVisible().catch(() => false)) ? rcOpt : anyOpt;
    console.log('remodel receipt: Receipt Selection Type ->', ((await rstOpt.textContent()) || '').trim());
    await rstOpt.click();
    await this.settle(2_000);
    // Issue Stock Source Type = Inward (QA lead)
    await this.pickByLabel('Issue Stock Source Type', 'Inward', { exact: true })
      .catch(() => this.fillEmptySelects(['Inward']));
    await this.waitForIdle();
    await this.settle(2_500);

    await this.checkRow(issueNo); // Issued Details grid
    // the "Selected Record Item Wise Data" grid renders below with the
    // ITEM rows - check the item row there too (QA lead), then "+ Add"
    const itemRow = this.rowMatcher(issueNo).nth(1);
    await itemRow.waitFor({ state: 'visible', timeout: 20_000 });
    await itemRow.scrollIntoViewIfNeeded();
    const itemBox = itemRow.getByRole('checkbox').first();
    if (!(await itemBox.isChecked({ timeout: 2_000 }).catch(() => false))) await itemBox.check({ force: true });
    await this.settle(1_500);

    // checking the item row pops a "Remodel Details" overlay with the full
    // pre-filled item (weights, making charges, wastage config) - confirm it
    // with ITS Submit
    const details = this.page
      .locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]')
      .filter({ hasText: 'Remodel Details' })
      .last();
    if (await details.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await details.getByRole('button', { name: 'Submit' }).last().click();
      await details.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      console.log('remodel receipt: Remodel Details overlay confirmed');
      await this.settle(1_500);
    }

    // a "+ Add" stages the item when the page offers it
    const add = this.page.locator('button')
      .filter({ hasText: /Add/ })
      .filter({ hasNotText: /Files|Image|Certification|Item/ })
      .locator('visible=true')
      .last();
    if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await add.scrollIntoViewIfNeeded();
      await add.click();
      await this.settle(2_000);
      console.log('remodel receipt: item staged via Add');
    }
    // select the staged row (LAST matching) when an added grid renders one
    const stagedRow = this.rowMatcher(issueNo).last();
    if (await stagedRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await stagedRow.scrollIntoViewIfNeeded();
      const stagedBox = stagedRow.getByRole('checkbox').first();
      if (!(await stagedBox.isChecked({ timeout: 2_000 }).catch(() => false))) await stagedBox.check({ force: true, timeout: 3_000 }).catch(() => {});
      await this.settle(1_000);
    }
    await this.fillReceiptTypeIfOffered({ what: 'remodel receipt' }); // Receipt Details, when the tab carries it (Hallmark does since 02-11-2026)

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { RemodelWorkflowPage };
