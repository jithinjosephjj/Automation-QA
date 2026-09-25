const { ProductionWorkflowPage } = require('./ProductionWorkflowPage');

/**
 * Internal Stock Transfer - Procurement > Operations > Internal Transfer.
 * Route: /prc/internal-stock-list, tabs Transfer / Accept (mapped live on qa
 * 25-09-2026, tests/probe/internal-stock-transfer-probe).
 *
 * qa offers NO "Process" option (the qap screenshot's Process -> Process /
 * Lot FVHK flow): Issue From is Department | Locker, Issue To is Locker.
 *
 * TRANSFER cascade (controlnames):
 *   transactionSubTypeID                               - lists nothing on qa (optional)
 *   fromMasterDataValueID_InternalStockTransferType    Issue From: Department | Locker
 *   fromEmployeeID                                     (Locker only) From Employee -> From Locker (ro)
 *   toMasterDataValueID_InternalStockTransferType      Issue To: Locker
 *   toEmployeeID                                       To Employee -> To Locker (ro)
 *   masterDataValueID_StockEntityType                  Alloy | Brand | Metal Stock | Stone | Material
 *   transactionTypeID                                  (Department) Metal Inward -> grid of inward lines (Receipt No "M205.1")
 *   masterDataValueID_StockIdentityType                (Locker) Jobwork Stock | Stock -> grid of the locker's stock
 *   then tick the row, Next (Review & Submit), Submit.
 *
 * ACCEPT cascade: receivedAt (Locker) -> employeeID -> lockerID -> receivedFrom
 * (Department | Locker) -> departmentID | source employee -> stockEntityType
 * -> stockIdentityType -> "Transferred Records N" -> tick -> Accept.
 *
 * Built on ProductionWorkflowPage for its route / Add / grid-row / save helpers.
 */
class InternalStockTransferPage extends ProductionWorkflowPage {
  async openTab(tab) {
    await this.openRoute('/prc/internal-stock-list');
    await this.page.getByRole('tab', { name: tab, exact: true }).click({ timeout: 15_000 });
    await this.waitForIdle();
    await this.settle(1_500);
    await this.clickAdd();
    await this.settle(1_500);
  }

  /** Pick by controlname when the select is rendered; returns false when it is not. */
  async pickIfPresent(control, value, opts = { exact: true }) {
    if (!value) return false;
    const sel = this.select(control);
    if (!(await sel.count()) || !(await sel.first().isVisible().catch(() => false))) return false;
    await this.pick(control, value, opts);
    await this.waitForIdle();
    await this.settle(1_500);
    return true;
  }

  /** What the form shows: selects (controlname=value), read-only inputs, grid - for the log. */
  async describeForm(label) {
    const info = await this.page.evaluate(() => {
      const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside');
      const labelOf = (n) => {
        const wrap = n.closest('sioniq-ng-select, app-sioniq-input, .form-group') || n;
        return (wrap.parentElement?.querySelector('label')?.textContent || wrap.closest('div')?.parentElement?.querySelector('label')?.textContent || n.placeholder || '').trim().slice(0, 30);
      };
      return {
        selects: [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')}=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.querySelector('ng-select')?.classList.contains('ng-invalid') ? '(invalid)' : ''}`),
        inputs: [...document.querySelectorAll('input:not([role=combobox]):not([type=checkbox])')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) => `${labelOf(i)}=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}`).slice(0, 25),
        headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 60),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 8),
      };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  }

  /**
   * Tick the grid row matching `rowText` (string key, or an ordered list of
   * RegExps tried in turn). Never falls back to another row: returns the
   * ticked row's text.
   */
  async tickRow(rowText) {
    const body = this.page.locator('tbody tr').locator('visible=true').filter({ has: this.page.locator('input[type="checkbox"]:not([disabled])') });
    await body.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const patterns = (Array.isArray(rowText) ? rowText : [rowText]).map((k) => (k instanceof RegExp ? k : new RegExp(String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')));
    // the grid pages (42 inward lines over 3 pages of 15, 25-09-2026): show
    // the most rows per page the pager offers, then walk the pages
    const perPage = this.page.locator('xpath=//*[normalize-space(text())="Records Per Page:"]/following::select[1]').locator('visible=true').first();
    if (await perPage.count()) {
      const values = await perPage.locator('option').evaluateAll((os) => os.map((o) => o.value));
      const max = values.sort((a, b) => Number(b) - Number(a))[0];
      if (max) {
        await perPage.selectOption(max).catch(() => {});
        await this.waitForIdle();
        await this.settle(2_000);
      }
    }
    const nextPage = this.page.locator('xpath=//*[contains(normalize-space(text()),"pages")]/preceding-sibling::button[1]').locator('visible=true').first();
    let texts = [];
    let idx = -1;
    const seen = [];
    for (let pageNo = 1; pageNo <= 20; pageNo++) {
      texts = (await body.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      seen.push(...texts);
      for (const re of patterns) {
        idx = texts.findIndex((t) => re.test(t));
        if (idx >= 0) break;
      }
      if (idx >= 0) break;
      if (!(await nextPage.count()) || (await nextPage.isDisabled().catch(() => true))) break;
      await nextPage.click();
      await this.waitForIdle();
      await this.settle(1_500);
    }
    if (idx < 0) throw new Error(`internal transfer: no grid row matches ${patterns.map(String).join(' / ')} - ${seen.length} rows offered: ${JSON.stringify(seen.map((t) => t.slice(0, 60)).slice(0, 60))}`);
    const row = body.nth(idx);
    const box = row.locator('input[type="checkbox"]:not([disabled])').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true }).catch(() => box.click({ force: true }));
    await this.settle(1_500);
    this.lastRow = await this.describeRow(row);
    console.log(`internal transfer: row ticked -> ${texts[idx].slice(0, 180)}`);
    return texts[idx];
  }

  /** Enter the transfer weight in the ticked row / its dialog when the screen asks for one. */
  async fillTransferWeight(weight) {
    if (weight === undefined) return;
    const dlg = this.page.locator('.modal, ngb-modal-window, [role="dialog"], .offcanvas').locator('visible=true').last();
    const scope = (await dlg.count()) ? dlg : this.page;
    const input = scope.locator('xpath=.//*[contains(normalize-space(text()),"Gross Weight")]/following::input[not(@disabled) and not(@readonly)][1]').first();
    if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await input.fill(String(weight));
      await input.blur();
      await this.settle(1_500);
      console.log(`internal transfer: transfer gross weight -> ${weight}`);
    }
    if (await dlg.count()) {
      const add = dlg.locator('button').filter({ hasText: /^\s*(Add|Add to Grid|Save|Ok)\s*$/i }).last();
      if (await add.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await add.click();
        await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
        await this.settle(1_000);
      }
    }
  }

  /**
   * Transfer stock: Department -> Locker (metal inward lines, keyed by the
   * inward no) or Locker -> Locker (the source locker's stock rows).
   * Returns the save body (receiptNo = the transfer no, e.g. "t171").
   */
  async transfer(d) {
    await this.openTab('Transfer');
    await this.pickIfPresent('transactionSubTypeID', d.transactionSubType);
    await this.pick('fromMasterDataValueID_InternalStockTransferType', d.issueFrom, { exact: true });
    await this.waitForIdle();
    await this.settle(1_500);
    if (d.issueFrom === 'Locker') await this.pick('fromEmployeeID', d.fromEmployee, { search: true });
    await this.settle(1_000);
    await this.pick('toMasterDataValueID_InternalStockTransferType', d.issueTo || 'Locker', { exact: true });
    await this.settle(1_000);
    await this.pick('toEmployeeID', d.toEmployee, { search: true });
    await this.settle(1_500);
    await this.pick('masterDataValueID_StockEntityType', d.stockEntityType || 'Material', { exact: true });
    await this.waitForIdle();
    await this.settle(1_500);
    await this.pickIfPresent('transactionTypeID', d.transactionType);
    await this.pickIfPresent('masterDataValueID_StockIdentityType', d.stockIdentityType);
    await this.waitForIdle();
    await this.settle(2_500);
    await this.describeForm('internal transfer header');
    if (d.search) await this.narrowGrid(d.search).catch(() => {});
    await this.tickRow(d.rowText);
    await this.fillTransferWeight(d.weight);
    await this.describeForm('internal transfer after selection');
    // Stock Transfer Details -> Review & Submit
    const next = this.page.getByRole('button', { name: /^\s*Next/ }).locator('visible=true').last();
    if (await next.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await next.click();
      await this.waitForIdle();
      await this.settle(2_500);
    }
    await this.describeForm('internal transfer review');
    return this.submitAndCapture('internal stock transfer', /internal|stock|transfer/i);
  }

  /**
   * Accept a transfer at the receiving locker: Received At Locker -> the
   * receiving employee (locker auto-fills) -> Received From (Department |
   * Locker) + its source -> entity / identity type -> tick the transfer ->
   * Accept. Returns the save body.
   */
  async accept(d) {
    await this.openTab('Accept');
    await this.pick('receivedAt', d.receivedAt || 'Locker', { exact: true });
    await this.settle(1_000);
    await this.pick('employeeID', d.employee, { search: true });
    await this.waitForIdle();
    await this.settle(1_500);
    if (d.locker) await this.pickIfPresent('lockerID', d.locker, { search: true });
    else await this.fillFirstIfEmpty('lockerID');
    await this.pick('receivedFrom', d.receivedFrom, { exact: true });
    await this.waitForIdle();
    await this.settle(1_500);
    if (d.receivedFrom === 'Department') {
      if (d.department) await this.pickIfPresent('departmentID', d.department, { search: true });
      else await this.fillFirstIfEmpty('departmentID');
    } else {
      // Locker source: the sending employee / their locker
      for (const ctl of ['sourceEmployeeID', 'fromEmployeeID', 'receivedFromEmployeeID']) {
        if (await this.pickIfPresent(ctl, d.sourceEmployee, { search: true })) break;
      }
      for (const ctl of ['sourceLockerID', 'fromLockerID']) await this.fillFirstIfEmpty(ctl);
    }
    await this.pickIfPresent('stockEntityType', d.stockEntityType || 'Material');
    await this.pickIfPresent('stockIdentityType', d.stockIdentityType || 'Stock');
    await this.waitForIdle();
    await this.settle(2_500);
    const info = await this.describeForm('internal accept header');
    if (info.selects.some((s) => /\(invalid\)/.test(s))) console.log(`internal accept: still invalid -> ${info.selects.filter((s) => /\(invalid\)/.test(s)).join(', ')}`);
    await this.tickRow(d.rowText);
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /accept|internal|transfer/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Get[A-Z]/.test(r.url()),
      { timeout: 60_000 },
    );
    resp.catch(() => {});
    await this.page.getByRole('button', { name: /^\s*Accept\s*$/ }).locator('visible=true').last().click();
    // a confirmation may ask "are you sure"
    const confirm = this.page.locator('.swal2-confirm, .modal-footer button').filter({ hasText: /^\s*(Yes|Ok|Confirm|Accept)\s*$/i }).locator('visible=true').first();
    if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click();
    const r = await resp;
    const body = await r.json().catch(() => null);
    console.log(`internal stock accept save: ${r.status()} ${r.url().split('/sioniq/')[1]} ${JSON.stringify(body).slice(0, 220)}`);
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`internal stock accept rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    await this.waitForIdle();
    await this.settle(2_000);
    await this.closeVisibleDialog();
    return body;
  }

  /** Select the first offered option of a still-empty select (auto-fill fields that sometimes stay blank). */
  async fillFirstIfEmpty(control) {
    const host = this.select(control);
    if (!(await host.count()) || !(await host.first().isVisible().catch(() => false))) return;
    const value = ((await host.first().locator('.ng-value-label').first().textContent({ timeout: 500 }).catch(() => '')) || '').trim();
    if (value) return;
    await this.closeStalePanels();
    await host.first().locator('.ng-select-container').click().catch(() => {});
    const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i }).first();
    if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
      console.log(`internal accept: ${control} -> ${((await opt.textContent()) || '').trim()}`);
      await opt.click();
      await this.waitForIdle();
      await this.settle(1_500);
    } else {
      await this.page.keyboard.press('Escape').catch(() => {});
      console.log(`internal accept: ${control} offers nothing`);
    }
  }
}

module.exports = { InternalStockTransferPage };
