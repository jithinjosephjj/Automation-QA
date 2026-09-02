const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Repair workflow screens (QA lead recording + live mapping, 02-09-2026):
 *
 *   Repair Registration  /sls/view-repair-registration   (2-step wizard)
 *   Repair Issue         /prc/view-samplejobwork-issue   ("Repair" tab)
 *   Repair Receipt       /prc/app-repair-setup           ("Repair" tab)
 *   Repair Delivery      /sls/view-repair-delivery
 *
 * Repairs register under a REP-... number; downstream grids key rows by it
 * (issue/delivery grids as "<repairNo>.1").
 */
class RepairWorkflowPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Repair');
  }

  async openTab(route, tabName) {
    await this.goto(route);
    await this.waitForIdle();
    if (tabName) {
      await this.page.getByRole('tab', { name: tabName }).click();
      await this.waitForIdle();
      await this.page.waitForTimeout(1_500);
    }
  }

  async clickVisibleAdd() {
    await this.waitForSpinner();
    await this.page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
  }

  /**
   * The save response numbers repairs with the series prefix (e.g.
   * "wJune-GGGG2d42026/2027-") while grids display them as
   * "REP-GGGG2d42026/2027-.1" - match on the common core after the first
   * prefix segment.
   */
  repairKey(no) {
    return String(no).replace(/^[A-Za-z]+-/, '');
  }

  rowMatcher(rowText) {
    const esc = this.repairKey(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  async checkRow(rowText) {
    const row = this.rowMatcher(rowText).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    const box = row.getByRole('checkbox').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
    await this.page.waitForTimeout(1_500);
  }

  async clickAndCaptureSave(button, { pattern = /create|save|submit/i } = {}) {
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && pattern.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await button.click();
    const r = await resp;
    if (!r) throw new Error('Submit fired no save request - form silently blocked');
    const body = await r.json().catch(() => null);
    console.log('repair save:', r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 250));
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
   * Repair Registration: step 1 header (Customer / SM code / Referrer /
   * Repair Item Source / Repair Type / delivery date), step 2 item form
   * (article chain + Expec Add/Loss Weight [the repair wastage config] +
   * pcs + gross weight) -> Add Item -> Submit. Returns the REP-... number.
   */
  async registerRepair({ customer, smCode, referrer, itemSource = 'Customer Item', repairType, deliveryDate, description, item, image }) {
    await this.openTab('/sls/view-repair-registration');
    await this.clickVisibleAdd();

    await this.pick('vendorID', customer, { exact: true });
    await this.pick('salesCode', smCode, { exact: true });
    if (referrer) await this.pick('supervisorID', referrer, { exact: true }).catch(() => console.log('referrer pick skipped'));
    await this.pick('masterDataValueID_RepairItemSource', itemSource, { exact: true });
    await this.pick('masterDataValueID_RepairType', repairType, { exact: true });
    const dd = this.page.locator('#deliveryDate');
    await dd.fill(deliveryDate);
    await dd.blur();
    await this.page.keyboard.press('Escape');
    if (description) await this.page.locator('#description').fill(description);

    await this.page.getByRole('button', { name: 'Next' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);

    // step 2 - item form
    await this.pick('groupCategory', item.groupCategory, { exact: true });
    await this.pick('category', item.category, { exact: true });
    await this.page.waitForTimeout(2_000);
    await this.pick('article', item.article);
    await this.pick('purity', item.purity);
    await this.fillByLabel('Expec Add Weight', item.expectedAddWeight);
    await this.fillByLabel('Expec Loss Weight', item.expectedLossWeight);
    await this.fillByLabel('No Of Pcs', item.pieces ?? 1).catch(() => {});
    await this.fillByLabel('Gross Weight', item.grossWeight);
    await this.page.waitForTimeout(1_500);

    // demo image via the item step's Add Files control
    if (image) await this.attachFileViaAddFiles(image);

    // Add Item resets the form - the reset is the acceptance proof
    await this.page.getByRole('button', { name: 'Add Item' }).click();
    const deadline = Date.now() + 15_000;
    let registered = false;
    while (Date.now() < deadline) {
      if (!(await this.selectValue('groupCategory'))) { registered = true; break; }
      await this.page.waitForTimeout(500);
    }
    if (!registered) throw new Error('Add Item never registered - the item form did not reset');
    console.log('repair item added (form reset)');

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    let repairNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    if (!repairNo) repairNo = await this.voucherNumber().catch(() => '');
    return (repairNo || '').trim();
  }

  /**
   * Repair Issue, OUTSOURCE mode: mode + vendor + submission method +
   * given-by/contact, then check the registered repair's grid row
   * (keyed "<repairNo>.1") and Submit. The type/BU/repair-no selects on the
   * form are optional FILTERS - the recording leaves them alone.
   */
  async repairIssueOutsource(d) {
    return this.repairIssue({ ...d, mode: 'Outsource' });
  }

  /** Inhouse variant: no vendor; a production-unit select renders on some builds. */
  async repairIssueInhouse(d) {
    return this.repairIssue({ ...d, mode: 'Inhouse' });
  }

  async repairIssue({ repairNo, mode = 'Outsource', vendor, productionUnit = 'Cochin', submissionMethod = 'In Person', givenBy = 'JJ', contactNumber = '5545654587' }) {
    await this.openTab('/prc/view-samplejobwork-issue', 'Repair');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JobWorkMode', mode, { exact: true });
    if (mode === 'Outsource') {
      await this.pick('vendorID', vendor, { search: true });
    } else {
      // Inhouse: a production-unit select may replace the vendor - pick it
      // when offered, otherwise proceed (best-effort)
      await this.pick('productionUnit', productionUnit, { exact: true })
        .catch(() => this.pick('productionUnitID', productionUnit, { exact: true }))
        .catch(() => console.log('repair issue inhouse: no production-unit select offered'));
    }
    await this.pick('masterDataValueID_DeliveryMode', submissionMethod, { exact: true });
    await this.page.getByRole('textbox').first().fill(givenBy);
    await this.page.getByRole('textbox').nth(1).fill(contactNumber);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(repairNo);
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Repair Receipt, OUTSOURCE: mode + Sub Transaction Type + vendor reveal
   * an item section whose selects take the repair number (repair no and,
   * on some builds, serial-level picks). The selects carry no controlnames -
   * every still-empty select offering the repair number gets it. "Add"
   * commits the item, Submit saves.
   */
  async repairReceiptOutsource(d) {
    return this.repairReceipt({ ...d, mode: 'Outsource' });
  }

  /** Inhouse variant: a production-unit select replaces the vendor. */
  async repairReceiptInhouse(d) {
    return this.repairReceipt({ ...d, mode: 'Inhouse' });
  }

  async repairReceipt({ repairNo, mode = 'Outsource', vendor, productionUnit = 'Cochin', subTransactionType = 'Invoice' }) {
    await this.openTab('/prc/app-repair-setup', 'Repair');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JobWorkMode', mode, { exact: true });
    await this.pick('transactionSubTypeID', subTransactionType, { exact: true });
    if (mode === 'Outsource') {
      await this.pick('vendorID', vendor, { search: true });
    }
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // fill the remaining empty selects generically (retry rounds - later
    // selects render only after earlier picks): the production unit (Inhouse
    // mode, controlname-less) takes `productionUnit`, the item selects take
    // the repair number
    const escRe = new RegExp(this.repairKey(repairNo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const unitRe = new RegExp(`^\\s*${String(productionUnit).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
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
        const repairOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: escRe }).first();
        const unitOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: unitRe }).first();
        if (await repairOpt.isVisible().catch(() => false)) {
          await repairOpt.click();
          pickedAny = true;
          await this.page.waitForTimeout(2_000);
        } else if (mode === 'Inhouse' && (await unitOpt.isVisible().catch(() => false))) {
          await unitOpt.click();
          pickedAny = true;
          await this.page.waitForTimeout(2_000);
        } else {
          await this.page.keyboard.press('Escape');
        }
      }
      if (!pickedAny) break;
    }

    // INHOUSE builds present a pending GRID instead of the item dropdowns -
    // select the repair's row before committing (QA lead, 02-09-2026)
    if (await this.rowMatcher(repairNo).first().isVisible({ timeout: 8_000 }).catch(() => false)) {
      await this.checkRow(repairNo);
      console.log('repair receipt: grid row selected');
    }

    const addBtn = this.page.getByRole('button', { name: /Add$/ }).locator('visible=true').last();
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await this.page.waitForTimeout(2_000);
      console.log('repair receipt: item committed via Add');
    }

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Repair Delivery: pick the B2B customer, check the repair's row
   * (keyed "<repairNo>.1"), Submit.
   */
  async repairDelivery({ customer, repairNo }) {
    await this.openTab('/sls/view-repair-delivery');
    await this.clickVisibleAdd();

    await this.pick('vendorID', customer, { exact: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(repairNo);
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { RepairWorkflowPage };
