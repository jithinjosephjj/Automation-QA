const { HallmarkWorkflowPage } = require('./HallmarkWorkflowPage');

/**
 * Certification workflow screens (probed live 03-09-2026) - the third
 * sibling tab next to Remodel and Hallmark on the same pages:
 *
 *   Certification Issue    /inv/app-issue-list    ("Certification" tab)
 *   Certification Receipt  /inv/app-receipt-list  ("Certification" tab)
 *
 * Same shape as Hallmark with one extra select up front:
 *   Issue:   masterDataValueID_JewelleryItemType ("Jewellery Item Type") +
 *            certificationVendorID + masterDataValueID_StockSourceType
 *   Receipt: the same item-type + vendor pair, then Receipt Selection Type
 *            (RC Number), invoice no/date and Issue Stock Source "Inward";
 *            its commit button is "Add Selected to Receipt".
 *
 * ELIGIBILITY (QA lead recording, 03-09-2026): the issue's "Select Inward
 * Stock" grid lists ONLY stone inwards saved with the ASSORTED STOCK
 * checkbox ticked - a plain stone inward never appears, whatever the stone
 * group or vendor. The certification vendor does not filter the grid.
 */
class CertificationWorkflowPage extends HallmarkWorkflowPage {
  /**
   * pick() variant for selects whose caption is NOT a <label> element and
   * that lack the sioniq-ng-select wrapper (the RC Wise Selection section):
   * the first ng-select after any element carrying exactly the caption text.
   */
  async pickByCaption(caption, optionText, { exact = true } = {}) {
    const sel = this.page
      .locator(`xpath=//*[normalize-space(text())="${caption}"]/following::ng-select[1]`)
      .last();
    const esc = String(optionText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = exact ? new RegExp(`^\\s*${esc}\\s*$`) : new RegExp(esc, 'i');
    const wanted = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: pattern });
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      // an open flatpickr calendar floats over this section and intercepts
      // clicks - close it via its own input before touching the select
      if (await this.page.locator('.flatpickr-calendar.open').isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.locator('.flatpickr-calendar.open').waitFor({ state: 'hidden', timeout: 3_000 })
          .catch(() => this.page.mouse.click(10, 300));
        await this.page.waitForTimeout(500);
      }
      await sel.locator('.ng-select-container').click();
      const found = await wanted.first().waitFor({ state: 'visible', timeout: attempt * 5_000 })
        .then(() => true).catch(() => false);
      if (found && (await wanted.first().click({ timeout: 10_000 }).then(() => true).catch(() => false))) {
        await this.page.waitForTimeout(1_500);
        return;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`Option "${optionText}" never appeared in the select captioned "${caption}"`);
  }

  async openCertificationTab(route) {
    await this.goto(route);
    await this.waitForIdle();
    const tab = this.page.getByRole('tab', { name: 'Certification' });
    await tab.waitFor({ state: 'visible', timeout: 60_000 });
    await tab.click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Certification Issue: Jewellery Item Type + Certification Vendor + Stock
   * Source Type (a from-transaction select renders after "Inward") reveal
   * the inward grid; check the inward's row, commit via Add, Submit.
   */
  async certificationIssue({ itemType = 'Stone', vendor, sourceType = 'Inward', transactionType = 'Stone Inward', inwardNo }) {
    await this.openCertificationTab('/inv/app-issue-list');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JewelleryItemType', itemType);
    await this.pick('certificationVendorID', vendor);
    await this.pick('masterDataValueID_StockSourceType', sourceType, { exact: true });
    await this.fillEmptySelects([transactionType]);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(inwardNo);
    const add = this.page.locator('button')
      .filter({ hasText: /Add/ })
      .filter({ hasNotText: /Files|Image|Charges|Certification/ })
      .locator('visible=true')
      .last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.page.waitForTimeout(2_000);
    console.log('certification issue: selected stock committed via Add');
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Certification Receipt: Item Type + Vendor (only vendors with pending
   * certification issues are listed) + RANDOM invoice number + date, then
   * whatever cascades render (RC-number selection type / Inward source),
   * the issue's grid row, the item-wise row (Details overlay tolerated),
   * Add, Submit.
   */
  async certificationReceipt({ itemType = 'Stone', vendor, invoiceNo, invoiceDate, issueNo }) {
    await this.openCertificationTab('/inv/app-receipt-list');
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JewelleryItemType', itemType);
    await this.pick('certificationVendorID', vendor);

    // recording order: Receipt Selection Type (RC Number) comes right after
    // the vendor, before the invoice fields
    const rst = this.page.locator('label:text-is("Receipt Selection Type")').last().locator('xpath=following::ng-select[1]');
    if (await rst.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await rst.locator('.ng-select-container').click();
      const rcOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /RC/i }).first();
      const anyOpt = this.page.locator('.ng-dropdown-panel .ng-option').first();
      await anyOpt.waitFor({ state: 'visible', timeout: 15_000 });
      const opt = (await rcOpt.isVisible().catch(() => false)) ? rcOpt : anyOpt;
      console.log('certification receipt: Receipt Selection Type ->', ((await opt.textContent()) || '').trim());
      await opt.click();
      await this.page.waitForTimeout(2_000);
    }

    await this.page.getByPlaceholder('Enter Invoice Number').fill(invoiceNo);
    const dd = this.page.locator('#invoiceDate');
    await dd.fill(invoiceDate);
    await dd.blur();
    await this.page.keyboard.press('Escape');
    // filling reopens the flatpickr calendar over the section below - click
    // a neutral heading to dismiss it before the next pick
    await this.page.getByRole('heading', { name: 'Receipt Configuration' }).click({ timeout: 3_000 }).catch(() => {});
    await this.page.waitForTimeout(500);

    // the caption is a plain div (no <label>) and the select has no
    // sioniq-ng-select wrapper - address it structurally by caption text
    await this.pickByCaption('Issue Stock Source Type', 'Inward');
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(issueNo);
    // item-wise grid row (when rendered) - may pop a Details overlay
    const itemRow = this.rowMatcher(issueNo).nth(1);
    if (await itemRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await itemRow.scrollIntoViewIfNeeded();
      const itemBox = itemRow.getByRole('checkbox').first();
      if (!(await itemBox.isChecked().catch(() => false))) await itemBox.check({ force: true });
      await this.page.waitForTimeout(1_500);
      const details = this.page
        .locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]')
        .filter({ hasText: /Details/ })
        .last();
      if (await details.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await details.getByRole('button', { name: 'Submit' }).last().click();
        await details.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
        console.log('certification receipt: Details overlay confirmed');
        await this.page.waitForTimeout(1_500);
      }
    }
    const add = this.page.locator('button')
      .filter({ hasText: /Add/ })
      .filter({ hasNotText: /Files|Image|Certification|Item|Charges/ })
      .locator('visible=true')
      .last();
    if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await add.scrollIntoViewIfNeeded();
      await add.click();
      await this.page.waitForTimeout(2_000);
      console.log('certification receipt: item staged via Add');
    }
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

module.exports = { CertificationWorkflowPage };
