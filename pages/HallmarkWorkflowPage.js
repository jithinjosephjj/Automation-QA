const { RemodelWorkflowPage } = require('./RemodelWorkflowPage');

/**
 * Hallmark workflow screens (live mapping, 02-09-2026) - siblings of the
 * Remodel tabs on the same pages:
 *
 *   Hallmark Issue    /inv/app-issue-list    ("Hallmark" tab)
 *   Hallmark Receipt  /inv/app-receipt-list  ("Hallmark" tab)
 *
 * Reuses the remodel helpers: count-named "Add N" commit button matched by
 * text, generic empty-select filler, verified save capture, details-overlay
 * confirmation.
 */
class HallmarkWorkflowPage extends RemodelWorkflowPage {
  async openHallmarkTab(route) {
    await this.goto(route);
    await this.waitForIdle();
    await this.page.getByRole('tab', { name: 'Hallmark' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  /**
   * Hallmark Issue: Hallmark Vendor + Stock Source Type (a from-transaction
   * select renders after "Inward") reveal the inward grid; check the
   * inward's row, commit via the count-named Add, Submit.
   */
  async hallmarkIssue({ vendor, sourceType = 'Inward', transactionType = 'Metal Inward', inwardNo }) {
    await this.openHallmarkTab('/inv/app-issue-list');
    await this.clickVisibleAdd();

    await this.pick('hallmarkVendorID', vendor, { exact: true });
    await this.pick('masterDataValueID_StockSourceType', sourceType, { exact: true });
    await this.fillEmptySelects([transactionType]);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(inwardNo);
    // this tab's commit button is "Add Items" (remodel's is "Add <count>")
    const add = this.page.locator('button')
      .filter({ hasText: /Add/ })
      .filter({ hasNotText: /Files|Image|Charges|Certification/ })
      .locator('visible=true')
      .last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.page.waitForTimeout(2_000);
    console.log('hallmark issue: selected stock committed via Add');
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Hallmark Receipt: Vendor (only vendors with pending hallmark issues are
   * listed) + RANDOM invoice number + date, then whatever the form cascades
   * (selection-type/source selects), the issue's grid row, the item-wise
   * row (a Details overlay may pop - confirmed via its Submit), Add, Submit.
   */
  async hallmarkReceipt({ vendor, invoiceNo, invoiceDate, issueNo }) {
    await this.openHallmarkTab('/inv/app-receipt-list');
    await this.clickVisibleAdd();

    await this.pick('hallmarkVendorID', vendor, { exact: true });
    await this.page.getByPlaceholder('Enter Invoice Number').fill(invoiceNo);
    const dd = this.page.locator('#invoiceDate');
    await dd.fill(invoiceDate);
    await dd.blur();
    await this.page.keyboard.press('Escape');

    // cascade fields, when present: an RC-number selection type and an
    // Inward source (mirrors the remodel receipt; both tolerated if absent)
    const rst = this.page.locator('label:text-is("Receipt Selection Type")').last().locator('xpath=following::ng-select[1]');
    if (await rst.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await rst.locator('.ng-select-container').click();
      const rcOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /RC/i }).first();
      const anyOpt = this.page.locator('.ng-dropdown-panel .ng-option').first();
      await anyOpt.waitFor({ state: 'visible', timeout: 15_000 });
      const opt = (await rcOpt.isVisible().catch(() => false)) ? rcOpt : anyOpt;
      console.log('hallmark receipt: Receipt Selection Type ->', ((await opt.textContent()) || '').trim());
      await opt.click();
      await this.page.waitForTimeout(2_000);
    }
    await this.pickByLabel('Issue Stock Source Type', 'Inward', { exact: true })
      .catch(() => this.fillEmptySelects(['Inward']));
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
        console.log('hallmark receipt: Details overlay confirmed');
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
      console.log('hallmark receipt: item staged via Add');
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

module.exports = { HallmarkWorkflowPage };
