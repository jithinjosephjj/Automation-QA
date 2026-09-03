const { StoneAssortedWorkflowPage } = require('./StoneAssortedWorkflowPage');

/**
 * Logistics -> Goods Receipt -> ... -> Counter -> B2B Sales Invoice screens
 * (QA lead screenshots + live probe, 03-09-2026):
 *
 *   Logistics Inward    /prc/view-logistics          (Procurement > Operations > Logistic In / Out)
 *   Goods Receipt       /prc/view-goods-receipt
 *   Counter Allocation  /sls/view-counter-allocation
 *   Counter Accept      /sls/view-counter-accept-reject
 *   B2B Sales Invoice   /sls/app-invoice-setup       ("B2B Metal Sales Invoice" tab)
 *
 * Logistic No / Invoice No / Tracking No on the logistics form and the
 * invoice numbers downstream are DYNAMIC (duplicates blocked).
 */
class LogisticsSalesWorkflowPage extends StoneAssortedWorkflowPage {
  /** Input inside an <app-sioniq-input controlname="..."> component. */
  inputCtl(controlname) {
    return this.page.locator(`app-sioniq-input[controlname="${controlname}"] input`).first();
  }

  /** These forms caption their fields with PLAIN TEXT nodes, not <label>
   *  elements - address inputs/selects by caption text. */
  async pickTolerant(labelText, optionText, opts = {}) {
    await this.pickByCaption(labelText, optionText, { exact: !!opts.exact })
      .catch(() => this.pickByLabel(labelText, optionText, opts));
  }

  inputByCaption(caption) {
    // exclude ng-select internals: a select VALUE can equal a caption (Scan
    // Type shows "Tag Number") and its combobox input would otherwise win
    return this.page
      .locator(`xpath=//*[normalize-space(text())="${caption}"]/following::input[not(@type="checkbox") and not(@disabled) and not(ancestor::ng-select)][1]`)
      .first();
  }

  async fillByCaption(caption, value) {
    const input = this.inputByCaption(caption);
    await input.fill(String(value));
    await input.blur();
  }

  /** The "+"-button Tare Weight Information dialog (same shell as Stone Inward). */
  async addTareViaDialog(tareWeight) {
    await this.page.getByRole('button', { name: '+', exact: true }).first().click();
    const dlg = this.page
      .locator('.modal, .offcanvas, ngb-modal-window, [role="dialog"]')
      .filter({ hasText: /Tare Weight/ })
      .last();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });
    const selects = dlg.locator('ng-select');
    const n = Math.min(await selects.count(), 2);
    for (let i = 0; i < n; i++) {
      const sel = selects.nth(i);
      let picked = false;
      for (let attempt = 1; attempt <= 4 && !picked; attempt++) {
        if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(300);
        }
        await sel.locator('.ng-select-container').click();
        const options = this.page.locator('.ng-dropdown-panel .ng-option');
        const ok = await options.first().waitFor({ state: 'visible', timeout: attempt * 4_000 })
          .then(() => true).catch(() => false);
        if (ok && !/No items found/i.test((await options.first().textContent().catch(() => '')) || '')) {
          // "Per Pcs" tare types multiply by the piece count - prefer flat
          const flat = options.filter({ hasNotText: /Per\s*Pcs/i }).first();
          const opt = (i === 1 && (await flat.isVisible().catch(() => false))) ? flat : options.first();
          console.log('tare dialog select', i, '->', ((await opt.textContent()) || '').trim());
          picked = await opt.click().then(() => true).catch(() => false);
        }
        if (!picked) await this.page.keyboard.press('Escape');
      }
      if (!picked) throw new Error(`tare dialog: select ${i} never offered an option`);
      await this.page.waitForTimeout(800);
    }
    await dlg.locator('input[type="number"]').first().fill(String(tareWeight));
    const addBtn = dlg.locator('button').filter({ hasText: /Add/ }).last();
    await addBtn.click();
    await this.page.waitForTimeout(1_500);
    const close = dlg.locator('button[data-role="close-tare"]');
    if (await close.isVisible({ timeout: 3_000 }).catch(() => false)) await close.click();
    else await dlg.locator('button').filter({ hasText: /^\s*Close\s*$/ }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(1_000);
  }

  /**
   * Logistics Inward: one flat form. Logistic/Invoice/Tracking numbers must
   * be dynamic. Metal Group/Category/Purity render after Material Type.
   */
  async logisticsInward({ logisticVendor, logisticNo, vendor, invoiceNo, trackingNo, receivedDate, materialType = 'Metal', grossWithSeal, quantity, grossAsInvoice, stoneAsInvoice, metalGroup = 'Gold', metalCategory = 'Ring', purity = '91.60', invoiceAmount, receivedBy, paymentStatus = 'Paid' }) {
    await this.goto('/prc/view-logistics');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pick('logisticVendor', logisticVendor);
    await this.fillByCaption('Logistic No', logisticNo);
    await this.pick('vendor', vendor);
    await this.fillByCaption('Invoice No', invoiceNo);
    await this.fillByCaption('Tracking No', trackingNo);
    const rd = this.page.locator('#receivedDate');
    await rd.fill(receivedDate);
    await rd.blur();
    await this.page.keyboard.press('Escape');

    await this.pick('materialType', materialType, { exact: true });
    await this.fillByCaption('Gross Weight with Seal', grossWithSeal);
    await this.fillByCaption('Quantity as per Invoice', quantity);
    await this.fillByCaption('Gross Weight as per Invoice', grossAsInvoice);
    await this.fillByCaption('Stone Weight as per Invoice', stoneAsInvoice);

    await this.pickTolerant('Metal Group', metalGroup, { exact: true });
    await this.pickTolerant('Metal Category', metalCategory, { exact: true });
    await this.pickTolerant('Metal Purity', purity);
    await this.fillByCaption('Invoice Amount', invoiceAmount);
    await this.pick('receivedBy', receivedBy);
    await this.pick('paymentStatus', paymentStatus, { exact: true });

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Goods Receipt against the logistics inward. Tare goes in through the
   * "+" Tare Weight dialog (QA lead: 2g); Gross = with-tare - tare, Net =
   * Gross - Stone Weight, both calculated.
   */
  async goodsReceipt({ vendor, generationType = 'Logistic Inward', logisticVendor, logisticRcNo, materialType = 'Metal', metalGroup = 'Gold', metalCategory = 'Ring', purity = '91.60', quantity, grossWithTare, tareWeight, stoneWeight }) {
    await this.goto('/prc/view-goods-receipt');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pick('vendor', vendor);
    await this.pick('generationType', generationType, { exact: true });
    await this.pickTolerant('Logistic vendor', logisticVendor, { exact: true });
    await this.pickTolerant('Logistic vendor Rc No', this.docCore(logisticRcNo));
    await this.pick('materialtype', materialType, { exact: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);

    // these may back-fill from the logistics record - pick only when empty
    for (const [label, val] of [['Metal Group Category', metalGroup], ['Metal Category', metalCategory], ['Purity', purity]]) {
      await this.pickTolerant(label, val).catch((e) => console.log(`goods receipt: ${label} pick skipped -`, String(e).slice(0, 80)));
    }

    await this.fillByCaption('Quantity', quantity);
    await this.fillByCaption('Gross Weight with Tare Weight', grossWithTare);
    if (tareWeight !== undefined) await this.addTareViaDialog(tareWeight);
    const stone = this.inputCtl('stoneWeight');
    if (await stone.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await stone.fill(String(stoneWeight));
      await stone.blur();
    } else {
      await this.fillByCaption('Stone Weight', stoneWeight);
    }
    console.log('goods receipt weights: gross', await this.inputCtl('grossWeight').inputValue().catch(() => '?'),
      'net', await this.inputCtl('netWeight').inputValue().catch(() => '?'));

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Counter Allocation: filters + a scan field - scan the barcode TAG,
   * Enter stages it, Add commits it, Submit saves.
   */
  async counterAllocation({ itemType = 'Metal', groupCategory = 'Gold', tagNo }) {
    await this.goto('/sls/view-counter-allocation');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_JewelleryItemType', itemType);
    await this.pick('groupCategoryMetalIDs', groupCategory, { closePanel: true });
    // Scan Type: whatever the first real option is (tag scanning)
    await this.pickFirstOption('masterDataValueID_ScanType');

    const scan = this.page.getByPlaceholder('Scan / type then press Enter');
    await scan.fill(tagNo);
    await scan.press('Enter');
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    const add = this.page.locator('button').filter({ hasText: /^\s*Add\s*$/ }).locator('visible=true').last();
    if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await add.click();
      await this.page.waitForTimeout(1_500);
      console.log('counter allocation: tag staged via Add');
    }
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /** Open a select, log its options, pick by preference (fall back to the
   *  first option that doesn't match `avoid`, then to the first). */
  async pickPreferred(controlname, prefer, avoid) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await this.select(controlname).locator('.ng-select-container').click();
      const options = this.page.locator('.ng-dropdown-panel .ng-option');
      const ok = await options.first().waitFor({ state: 'visible', timeout: attempt * 4_000 })
        .then(() => true).catch(() => false);
      if (ok) {
        const labels = (await options.allTextContents()).map((s) => s.trim());
        if (labels.length && !/No items found/i.test(labels.join())) {
          console.log(`${controlname} options:`, JSON.stringify(labels));
          let idx = prefer ? labels.findIndex((l) => prefer.test(l)) : -1;
          if (idx < 0 && avoid) idx = labels.findIndex((l) => !avoid.test(l));
          if (idx < 0) idx = 0;
          console.log(`${controlname} ->`, labels[idx]);
          await options.nth(idx).click();
          return labels[idx];
        }
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`select "${controlname}" never offered an option`);
  }

  async pickFirstOption(controlname) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await this.select(controlname).locator('.ng-select-container').click();
      const opt = this.page.locator('.ng-dropdown-panel .ng-option').first();
      const ok = await opt.waitFor({ state: 'visible', timeout: attempt * 4_000 }).then(() => true).catch(() => false);
      const label = ok ? ((await opt.textContent().catch(() => '')) || '').trim() : '';
      if (ok && label && !/No items found/i.test(label)) {
        await opt.click();
        console.log(`${controlname} ->`, label);
        return label;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`select "${controlname}" never offered an option`);
  }

  /**
   * Counter Accept: filter by item type, find the allocated tag's row,
   * check it and Accept.
   */
  async counterAccept({ itemType = 'Metal', tagNo }) {
    await this.goto('/sls/view-counter-accept-reject');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pickTolerant('Item Type *', itemType).catch(() => this.pickTolerant('Item Type', itemType));
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    await this.checkRow(tagNo);
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: /Accept/ }).locator('visible=true').last());
    await this.previewAndClose();
    return body;
  }

  /**
   * B2B Metal Sales Invoice: /sls/app-invoice-setup, own tab. Scan the tag,
   * Add, Submit.
   */
  async b2bSalesInvoice({ customer, salesman, tagNo }) {
    await this.goto('/sls/app-invoice-setup');
    await this.waitForIdle();
    // the B2B module lazy-loads - wait for the tab, then fall back to the
    // nav search route the probe used
    let tab = this.page.getByRole('tab', { name: 'B2B Metal Sales Invoice' })
      .or(this.page.getByRole('button', { name: 'B2B Metal Sales Invoice' })).first();
    if (!(await tab.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false))) {
      const search = this.page.getByRole('combobox', { name: 'Search' });
      await search.click();
      await search.fill('invoice');
      await this.page.waitForTimeout(2_500);
      await search.press('ArrowDown');
      await search.press('Enter');
      await this.waitForIdle();
      tab = this.page.getByRole('tab', { name: 'B2B Metal Sales Invoice' })
        .or(this.page.getByRole('button', { name: 'B2B Metal Sales Invoice' })).first();
      await tab.waitFor({ state: 'visible', timeout: 30_000 });
    }
    await tab.click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
    await this.clickVisibleAdd();

    await this.pickPreferred('transactionSubTypeID', /invoice/i);
    await this.pick('b2BCustomerID', customer);
    // Customer Branch gates the tag scan - pick the customer's branch
    await this.pickByCaption('Customer Branch', 'BRANCH')
      .catch(() => this.pickTolerant('Customer Branch', customer).catch(() => console.log('customer branch: no option picked')));
    if (salesman) await this.pick('salesmanIDs', salesman, { closePanel: true }).catch(() => {});
    await this.pickPreferred('masterDataValueID_StockSourceFrom', /counter/i).catch(() => {});
    // "Approval RC No" switches the form to approval-sourced mode - a
    // straight counter sale needs a non-approval issue type
    await this.pickPreferred('masterDataValueID_InvoiceIssueType', /direct|tag|counter/i, /approval/i).catch(() => {});
    await this.pickPreferred('masterDataValueID_ScanType', /tag/i).catch(() => {});
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);

    // the scan field is captioned "Tag Number"; the "+ Add" button commits
    // the scan (Enter clears the field without staging)
    const scan = this.inputByCaption('Tag Number');
    await scan.fill(tagNo);
    if ((await scan.inputValue()) !== tagNo) {
      throw new Error(`tag number did not land in the scan field (holds "${await scan.inputValue()}")`);
    }
    const add = this.page.locator('button').filter({ hasText: /Add/ })
      .filter({ hasNotText: /Files|Selected|Charges/ })
      .locator('visible=true').last();
    await add.click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // proof the tag actually staged - surface the app's toast if it did not
    const scanned = this.rowMatcher(tagNo).last();
    if (!(await scanned.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container')
        .allTextContents().catch(() => []);
      throw new Error(`tag "${tagNo}" never appeared in Scanned Tags. Toasts: ${JSON.stringify(toasts)}`);
    }
    console.log('sales invoice: tag scanned into the grid');
    const box = scanned.getByRole('checkbox').first();
    if (!(await box.isChecked().catch(() => true))) await box.check({ force: true }).catch(() => {});
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.invoiceNo || body.data.docNo)) || '';
  }
}

module.exports = { LogisticsSalesWorkflowPage };

