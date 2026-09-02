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
    await this.page.getByRole('tab', { name: 'Remodel', exact: true }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  async clickVisibleAdd() {
    await this.waitForSpinner();
    await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
  }

  rowMatcher(rowText) {
    const esc = String(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  async checkRow(rowText) {
    const row = this.rowMatcher(rowText).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    const box = row.getByRole('checkbox').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
    await this.page.waitForTimeout(1_500);
  }

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
        const val = ((await wrap.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
        if (val) continue;
        await wrap.locator('ng-select .ng-select-container').first().click().catch(() => {});
        await this.page.waitForTimeout(1_500);
        let hit = false;
        for (const want of wanted) {
          const re = new RegExp(`^\\s*${String(want).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
          const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: re }).first();
          if (await opt.isVisible().catch(() => false)) {
            await opt.click();
            hit = true;
            pickedAny = true;
            await this.page.waitForTimeout(2_000);
            break;
          }
        }
        if (!hit) await this.page.keyboard.press('Escape');
      }
      if (!pickedAny) break;
    }
  }

  async clickAndCaptureSave(button, { pattern = /create|save|submit/i } = {}) {
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && pattern.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await button.click();
    // post-Submit dialogs: an Add commit and/or a confirming second Submit
    await this.page.waitForTimeout(2_500);
    const midAdd = this.page.locator('button').filter({ hasText: /Add\s*\d+/ }).locator('visible=true').last();
    if (await midAdd.isVisible().catch(() => false)) {
      await midAdd.click().catch(() => {});
      console.log('remodel: post-submit Add pressed');
      await this.page.waitForTimeout(1_500);
    }
    const again = this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last();
    if (await again.isVisible().catch(() => false)) await again.click().catch(() => {});
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
    const dialogVisible = await this.printDialog.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true).catch(() => false);
    if (dialogVisible) {
      await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    }
    await this.page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(1_000);
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
    await this.page.waitForTimeout(2_500);

    await this.checkRow(inwardNo);
    // the commit button sits below the grid and its NAME CARRIES THE
    // SELECTED-ROW COUNT ("Add 1") - scroll to it and click before Submit
    const add = this.page.locator('button').filter({ hasText: /Add\s*\d+/ }).locator('visible=true').last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.page.waitForTimeout(2_000);
    console.log('remodel issue: selected stock committed via Add');
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Remodel Receipt: Remodel Type (+ vendor select that renders after it),
   * Sub Transaction Type preset Invoice, RANDOM invoice number, invoice
   * date, credit days; then Stock Source "Inward", the issue's grid row,
   * Add (stages it), re-check the staged row, Submit.
   */
  async remodelReceipt({ remodelType, vendor, invoiceNo, invoiceDate, creditDays = 20, issueNo }) {
    await this.openTab('/inv/app-receipt-list');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_RemodelType', remodelType, { exact: true });
    await this.fillEmptySelects([vendor]);
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
    await this.page.waitForTimeout(2_000);
    // Issue Stock Source Type = Inward (QA lead)
    await this.pickByLabel('Issue Stock Source Type', 'Inward', { exact: true })
      .catch(() => this.fillEmptySelects(['Inward']));
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(issueNo); // Issued Details grid
    // the "Selected Record Item Wise Data" grid renders below with the
    // ITEM rows - check the item row there too (QA lead), then "+ Add"
    const itemRow = this.rowMatcher(issueNo).nth(1);
    await itemRow.waitFor({ state: 'visible', timeout: 20_000 });
    await itemRow.scrollIntoViewIfNeeded();
    const itemBox = itemRow.getByRole('checkbox').first();
    if (!(await itemBox.isChecked().catch(() => false))) await itemBox.check({ force: true });
    await this.page.waitForTimeout(1_500);

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
      await this.page.waitForTimeout(1_500);
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
      await this.page.waitForTimeout(2_000);
      console.log('remodel receipt: item staged via Add');
    }
    // select the staged row (LAST matching) when an added grid renders one
    const stagedRow = this.rowMatcher(issueNo).last();
    if (await stagedRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await stagedRow.scrollIntoViewIfNeeded();
      const stagedBox = stagedRow.getByRole('checkbox').first();
      if (!(await stagedBox.isChecked().catch(() => false))) await stagedBox.check({ force: true }).catch(() => {});
      await this.page.waitForTimeout(1_000);
    }

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { RemodelWorkflowPage };
