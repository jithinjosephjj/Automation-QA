const { CertificationWorkflowPage } = require('./CertificationWorkflowPage');

/**
 * Stone Assorting screens (QA lead recording, 03-09-2026). Reached via the
 * NAV SEARCH ("stone as" + ArrowDown + Enter - the screen is not under the
 * usual Inventory menu); the landing page has Issue and Receipt tabs.
 *
 *   Issue:   transaction type "Stone Inward" + vendor (the inward's PURCHASE
 *            vendor filters the grid) -> inward item row -> assorter employee
 *            -> Add -> Close -> Next -> Submit (2-step wizard)
 *   Receipt: employee -> issue row -> Add Items -> Close -> Submit
 *
 * Downstream grids show PERMUTED series compositions (save returns
 * "wJune-gg88d42026/2027-" style, grids render "D42026/2027-gg88wJune-"),
 * so rows are keyed by docCore() - the distinctive middle segment.
 * These forms use RAW ng-selects (no sioniq-ng-select wrapper, no <label>
 * captions), hence the pickEmptyRaw helper.
 */
class StoneAssortedWorkflowPage extends CertificationWorkflowPage {
  /** Distinctive segment of a composed doc number: strips the business-month
   *  prefix (wJune-) and the financial-year suffix (d42026/2027-...). */
  docCore(docNo) {
    const s = String(docNo).trim();
    const core = s.replace(/^w?june-?/i, '').replace(/d4\d{4}\/\d{4}.*$/i, '').replace(/-+$/, '');
    return core || s;
  }

  async openAssortedPage(tab) {
    const search = this.page.getByRole('combobox', { name: 'Search' });
    await search.click();
    await search.fill('stone as');
    await this.page.waitForTimeout(2_000);
    await search.press('ArrowDown');
    await search.press('Enter');
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);
    console.log('stone assorting page:', this.page.url());
    if (tab) {
      await this.page.getByRole('tab', { name: tab }).click();
      await this.waitForIdle();
      await this.page.waitForTimeout(1_500);
    }
  }

  /**
   * Fill the first still-empty visible RAW ng-select whose panel offers the
   * option; `search` types into the combobox first (long employee lists).
   */
  async pickEmptyRaw(optionPattern, { search } = {}) {
    const pattern = optionPattern instanceof RegExp
      ? optionPattern
      : new RegExp(`^\\s*${String(optionPattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    for (let round = 0; round < 3; round++) {
      const wraps = this.page.locator('ng-select').locator('visible=true');
      const n = await wraps.count();
      for (let i = 0; i < n; i++) {
        const w = wraps.nth(i);
        const val = ((await w.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
        if (val) continue;
        if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(300);
        }
        await w.locator('.ng-select-container').click().catch(() => {});
        if (search) {
          await w.locator('input[role="combobox"]').fill(search).catch(() => {});
        }
        await this.page.waitForTimeout(2_000);
        const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: pattern }).first();
        if (await opt.isVisible().catch(() => false)) {
          await opt.click();
          await this.page.waitForTimeout(2_000);
          return;
        }
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(2_000);
    }
    throw new Error(`No empty raw ng-select offered an option matching ${pattern}`);
  }

  /** Post-commit dialogs on these wizards: a Close text-button, then Next. */
  async closeThenNext({ next = true } = {}) {
    const close = this.page.getByText('Close', { exact: true }).locator('visible=true').last();
    if (await close.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await close.click().catch(() => {});
      await this.page.waitForTimeout(1_000);
    }
    if (next) {
      const nextBtn = this.page.getByRole('button', { name: /Next/ }).locator('visible=true').last();
      if (await nextBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await nextBtn.click();
        await this.waitForIdle();
        await this.page.waitForTimeout(1_500);
      }
    }
  }

  /**
   * Stone Assorting Issue. Returns the issue doc no from the save response.
   */
  async assortedIssue({ transactionType = 'Stone Inward', vendor = 'RAJA', inwardNo, employee = 'Sioniquser', expectInRow }) {
    await this.openAssortedPage();
    await this.clickVisibleAdd();

    await this.pickEmptyRaw(transactionType);
    await this.pickEmptyRaw(vendor);
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // the inward grid pages (dozens of records, not strictly newest-first)
    // - narrow it via the form's own RC No typeahead before picking the row
    await this.pickByCaption('RC No', this.docCore(inwardNo), { exact: false, search: true })
      .catch((e) => console.log('assorting issue: RC No pick skipped -', String(e).slice(0, 100)));
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);
    await this.checkRow(inwardNo).catch(() => this.checkRow(this.docCore(inwardNo)));
    if (expectInRow) await this.verifyRowText(inwardNo, expectInRow);
    await this.pickEmptyRaw(new RegExp(employee, 'i'), { search: employee.slice(0, 4) });

    const add = this.page.locator('button')
      .filter({ hasText: /Add\s*$/ })
      .locator('visible=true')
      .last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.page.waitForTimeout(2_000);
    console.log('assorted issue: inward committed via Add');
    await this.closeThenNext({ next: true });

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Stone Assorting Receipt against the issue. Returns the receipt doc no.
   */
  async assortedReceipt({ issueNo, employee = 'Sioniquser', expectInRow }) {
    await this.openAssortedPage('Receipt');
    await this.clickVisibleAdd();

    await this.pickEmptyRaw(new RegExp(employee, 'i'), { search: employee.slice(0, 4) });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(this.docCore(issueNo));
    if (expectInRow) await this.verifyRowText(this.docCore(issueNo), expectInRow);
    const add = this.page.locator('button')
      .filter({ hasText: /Add Items\s*$/ })
      .locator('visible=true')
      .last();
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await this.page.waitForTimeout(2_000);
    console.log('assorted receipt: issue committed via Add Items');
    await this.closeThenNext({ next: false });

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { StoneAssortedWorkflowPage };
