const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Sample workflow screens (QA lead recording + live mapping, 31-08-2026):
 *
 *   Sample Issue     /prc/view-samplejobwork-issue  ("Sample" tab)
 *   Sample Receipt   /prc/app-repair-setup          ("Sample" tab, shared with Repair)
 *   Sample Delivery  /sls/app-sample-setup          ("Sample Delivery" tab)
 *
 * Creating a sample-bearing B2B order registers the sample under its OWN
 * SAMPLE NO (e.g. "QAF4VU") - every downstream grid keys rows by it (the
 * delivery grid as "<sampleNo>.1"), NOT by the B2B order receipt no.
 * Capture it with latestSampleNo() right after the order saves.
 */
class SampleWorkflowPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Sample');
  }

  async openTab(route, tabName) {
    await this.goto(route);
    await this.waitForIdle();
    await this.page.getByRole('tab', { name: tabName }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  /** Every tab renders its OWN add button - click the visible one. */
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

  /** Capture the save response for a submit-like button click. */
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
    console.log('sample save:', r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    return body;
  }

  /** Post-save: preview the print template when offered, then close dialogs. */
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
   * The newest sample's SAMPLE NO from the Sample Registration list
   * (newest-first). Creating a sample-bearing B2B order registers the
   * sample under its OWN number (e.g. "QAF4VU") - every downstream grid
   * (issue ledger, receipt, delivery) keys rows by it, NOT by the order no.
   */
  async latestSampleNo() {
    await this.openTab('/sls/app-sample-setup', 'Sample Registration');
    await this.page.waitForTimeout(2_500);
    const row = this.page.locator('table tbody tr').first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    const text = ((await row.innerText()) || '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^(?:Click to edit\s*)?\d+\s+(\S+)/i);
    const sampleNo = m ? m[1] : '';
    console.log(`latest sample no: ${sampleNo} (row: ${text.slice(0, 100)})`);
    return sampleNo;
  }

  /**
   * Sample Issue, OUTSOURCE mode: Item Type + JobWork Mode + Vendor +
   * Sample Submission Method (control "deilveryMode" [sic]) + received
   * from / contact number, then check the order's grid row, Add Item,
   * Add, Next, Submit.
   */
  async createSampleIssueOutsource({ sampleNo, itemType = 'Metal', vendor = 'RAJA', submissionMethod = 'In Person', receivedFrom = 'Raja', contactNumber = '6565455555' }) {
    await this.openTab('/prc/view-samplejobwork-issue', 'Sample');
    await this.clickVisibleAdd();

    await this.pick('itemType', itemType, { exact: true });
    await this.pick('jobworkMode', 'Outsource', { exact: true });
    await this.pick('vendor', vendor).catch(async () => {
      // the wrapper carries id #vendorControl when the controlname is absent
      await this.page.locator('#vendorControl .ng-select-container').click();
      await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: vendor }).first().click();
    });
    await this.pick('deilveryMode', submissionMethod, { exact: true });

    // received-from + contact: two plain textboxes on the form (no ids -
    // the QA lead's recording addresses them positionally, proven live)
    await this.page.getByRole('textbox').first().fill(receivedFrom);
    await this.page.getByRole('textbox').nth(1).fill(contactNumber);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(sampleNo);
    // "Add Item" opens an Add Item Details panel with the sample pre-listed;
    // its green commit button's accessible name starts with an ICON GLYPH
    // (private-use char, not whitespace) - match by the trailing "Add" only
    await this.page.getByRole('button', { name: 'Add Item' }).click();
    await this.page.waitForTimeout(2_000);
    await this.page.getByRole('button', { name: /Add$/ }).last().click();
    await this.page.waitForTimeout(1_500);
    await this.page.getByRole('button', { name: 'Next' }).click();
    await this.waitForIdle();

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Sample Receipt (Repair page, Sample tab): Job Work Mode Outsource ->
   * Vendor Name -> Item Type reveal the pending grid; check the sample's
   * row and Submit Receipt.
   */
  async sampleReceiptOutsource({ sampleNo, vendor = 'RAJA', itemType = 'Metal' }) {
    await this.openTab('/prc/app-repair-setup', 'Sample');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JobWorkMode', 'Outsource', { exact: true });
    await this.pick('vendorID', vendor);
    await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(sampleNo);
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit Receipt' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Sample Delivery (/sls/app-sample-setup, "Sample Delivery" tab):
   * B2B Customer -> Item Type -> Dispatch Type ("Our Employee " - option
   * text carries trailing spaces, never match exact) -> employee -> check
   * the sample's row (keyed "<sampleNo>.1") -> Submit.
   */
  async sampleDelivery({ sampleNo, customer = 'Luxurio', itemType = 'Metal', dispatchType = 'Our Employee', employee }) {
    await this.openTab('/sls/app-sample-setup', 'Sample Delivery');
    await this.clickVisibleAdd();

    await this.pick('b2bCustomerID', customer, { exact: true });
    await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    await this.pick('masterDataValueID_DispatchType', dispatchType); // NOT exact - trailing spaces
    await this.page.waitForTimeout(2_000);

    // the employee select renders after the dispatch type - it is the last
    // still-empty visible select on the form
    const wraps = this.page.locator('sioniq-ng-select').locator('visible=true');
    const n = await wraps.count();
    let picked = false;
    for (let i = n - 1; i >= 0 && !picked; i--) {
      const wrap = wraps.nth(i);
      const val = ((await wrap.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
      if (val) continue;
      await wrap.locator('ng-select .ng-select-container').first().click();
      const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: employee }).first();
      if (await opt.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await opt.click();
        picked = true;
      } else {
        await this.page.keyboard.press('Escape');
      }
    }
    if (!picked) throw new Error(`employee "${employee}" not offered in any empty delivery dropdown`);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(sampleNo);
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }));
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { SampleWorkflowPage };
