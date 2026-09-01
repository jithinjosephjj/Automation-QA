const { BasePage } = require('./BasePage');

/**
 * Shared machinery for the Stock Inward wizards (Metal / Brand / Stone tabs
 * of /prc/stock-inward-setup). Everything here was harvested live from
 * qa.sioniq.com.
 *
 * DOM facts:
 * - Form dropdowns are <sioniq-ng-select controlname="..."> wrappers around
 *   ng-select; controlname is the stable hook (the inner ng-select has
 *   id="undefined"). Dropdown panels are appended to <body>.
 * - The Add button on the list view is icon-only (i.ri-add-fill).
 * - Purchaser is a MULTI-select: close its panel with Escape after picking
 *   or it swallows the next click.
 * - Checkboxes hide behind <label class="invisible-click">; click the label.
 * - Number/weight inputs mostly carry no ids - reach them via their <label>.
 * - Submitting opens a Print dialog carrying the generated voucher number
 *   with (F4) Preview / (F9) Print actions; it does NOT return to the list.
 */
class StockInwardBasePage extends BasePage {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} tabName 'Metal' | 'Brand' | 'Stone'
   */
  constructor(page, tabName) {
    super(page);
    this.tabName = tabName;

    // --- list view ---
    this.tab = page.getByRole('tab', { name: tabName });
    this.addBtn = page.locator('button:has(i.ri-add-fill)').first();

    // --- wizard chrome ---
    this.nextBtn = page.getByRole('button', { name: 'Next' });
    this.previousBtn = page.getByRole('button', { name: 'Previous' });
    this.submitBtn = page.getByRole('button', { name: 'Submit' });
    this.addItemBtn = page.getByRole('button', { name: 'Add Item' });

    // --- shared step-1 fields ---
    this.invoiceNo = page.locator('#invoiceNo');
    this.invoiceDate = page.locator('#invoiceDate');
    this.creditDays = page.locator('#creditDays');
    this.dueDate = page.locator('#dueDate');

    this.summaryPanel = page.locator('[class*=summary]').first();
    this.gridRows = page.locator('table tbody tr');

    // --- post-submit Print dialog ---
    this.printDialog = page.locator('[role="dialog"], .modal').filter({ hasText: 'Voucher Number' });
    this.previewBtn = page.getByRole('button', { name: 'Preview' });
    this.printBtn = page.getByRole('button', { name: /\(F9\) Print/ });
  }

  async open() {
    await this.goto('/prc/stock-inward-setup');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Wait out the transparent ngx-spinner overlay that swallows clicks. */
  async waitForSpinner() {
    await this.page
      .locator('.ngx-spinner-overlay')
      .last()
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => {});
  }

  /** Switch to this page's tab (Metal is the default-active one). */
  async selectTab() {
    await this.waitForSpinner();
    await this.tab.click();
    await this.waitForIdle();
  }

  async openAddWizard() {
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: 60_000 });
    // inwardType is the one dropdown all three wizards share (Stone has no
    // subTransactionType) - its visibility marks the wizard as ready.
    await this.select('inwardType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** The ng-select inside a <sioniq-ng-select controlname="..."> wrapper. */
  select(controlname) {
    return this.page
      .locator(`sioniq-ng-select[controlname="${controlname}"] ng-select`)
      .first();
  }

  /** Currently selected label of a wizard dropdown ('' when empty). */
  async selectValue(controlname) {
    const v = this.select(controlname).locator('.ng-value');
    return (await v.count()) ? (await v.first().textContent() || '').trim() : '';
  }

  /**
   * Open a wizard dropdown, pick an option, return the full option list for
   * assertions. search types into the combobox first (server-filtered lists
   * like Article). closePanel is required after multi-selects (purchaser).
   */
  async pick(controlname, optionText, { closePanel = false, search = false, exact = false } = {}) {
    const options = this.page.locator('.ng-dropdown-panel .ng-option');
    // exact avoids substring traps: "Sioniq QA" must not match "Sioniq QA1".
    const pattern = exact
      ? new RegExp(String.raw`^\s*` + escapeRe(optionText) + String.raw`\s*$`)
      : new RegExp(escapeRe(optionText), 'i');
    const wanted = options.filter({ hasText: pattern });

    // ng-select renders whatever the list held at open time - including an
    // empty panel or a stale "No items found" - and does not refresh until
    // reopened. Lists load asynchronously (vendors, server-filtered articles),
    // so close and reopen until the option is actually there.
    let all = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      // a leftover open panel (from a failed prior attempt or another
      // control) floats over the page and intercepts the container click
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await this.select(controlname).locator('.ng-select-container').click();
      if (search) {
        await this.select(controlname).locator('input[role="combobox"]').fill(optionText);
        await this.page.waitForTimeout(2_000); // server-side filter debounce
      }
      const found = await wanted.first().waitFor({ state: 'visible', timeout: attempt * 5_000 })
        .then(() => true).catch(() => false);
      all = (await options.allTextContents()).map((s) => s.trim());
      if (found) {
        // The option node can keep detaching while the list re-renders after
        // an upstream pick - a failed click just means try the loop again.
        const clicked = await wanted.first().click({ timeout: 10_000 })
          .then(() => true).catch(() => false);
        if (clicked) {
          if (closePanel) await this.page.keyboard.press('Escape');
          return all;
        }
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(
      `Option "${optionText}" never appeared in ${this.tabName} wizard dropdown "${controlname}". Last option list: ${JSON.stringify(all)}`,
    );
  }

  /**
   * pick() variant addressing the dropdown by its LABEL text instead of a
   * controlname - for screens whose sioniq-ng-selects carry no controlname
   * or duplicate ones. Same open/retry/stale-panel semantics as pick().
   */
  async pickByLabel(labelText, optionText, { closePanel = false, search = false, exact = false } = {}) {
    // the first ng-select AFTER the label in document order - precise for
    // form layouts, immune to ancestor containers matching the label too
    const wrapper = this.page
      .locator(`label:text-is("${labelText}")`)
      .last()
      .locator('xpath=following::ng-select[1]');
    const options = this.page.locator('.ng-dropdown-panel .ng-option');
    const pattern = exact
      ? new RegExp(String.raw`^\s*` + escapeRe(optionText) + String.raw`\s*$`)
      : new RegExp(escapeRe(optionText), 'i');
    const wanted = options.filter({ hasText: pattern });
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await wrapper.locator('.ng-select-container').click();
      if (search) {
        await wrapper.locator('input[role="combobox"]').fill(optionText);
        await this.page.waitForTimeout(2_000);
      }
      const found = await wanted.first().waitFor({ state: 'visible', timeout: attempt * 5_000 })
        .then(() => true).catch(() => false);
      if (found && (await wanted.first().click({ timeout: 10_000 }).then(() => true).catch(() => false))) {
        if (closePanel) await this.page.keyboard.press('Escape');
        return;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`Option "${optionText}" never appeared in dropdown labeled "${labelText}"`);
  }

  /**
   * Multi-select helper: click the panel's own "Select all" row. Option
   * lists load from slow MasterData calls and a panel opened too early stays
   * empty until reopened - so close and reopen with growing patience.
   */
  async selectAllOptions(controlname) {
    const selectAll = this.page.locator('.ng-dropdown-panel').getByText(/Select all/i).first();
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.select(controlname).locator('.ng-select-container').click();
      const found = await selectAll
        .waitFor({ state: 'visible', timeout: attempt * 10_000 })
        .then(() => true)
        .catch(() => false);
      if (found) {
        await selectAll.click();
        await this.page.keyboard.press('Escape');
        return;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`"${controlname}" panel never showed its "Select all" row`);
  }

  /**
   * Input reached through its <label> text. Exact match by default so 'Rate'
   * never grabs the 'Rate Fix' container; pass exact: false for labels that
   * embed extra markup, like "MRP (Reduce Tax)" reached via 'MRP'.
   */
  inputByLabel(labelText, { exact = true } = {}) {
    const label = exact
      ? this.page.locator(`label:text-is("${labelText}")`)
      : this.page.locator('label', { hasText: labelText });
    return this.page
      .locator('div.grid, div.form-group')
      .filter({ has: label })
      .last()
      .locator('input:not([type=checkbox])')
      .first();
  }

  /** Numeric value of a labeled field (calculated fields included). */
  async numberOf(labelText, opts) {
    const raw = await this.inputByLabel(labelText, opts).inputValue();
    return Number(String(raw).replace(/,/g, '') || 0);
  }

  async fillByLabel(labelText, value, opts) {
    const input = this.inputByLabel(labelText, opts);
    await input.fill(String(value));
    await input.blur();
  }

  /** Checkboxes hide behind label.invisible-click; the input never gets the click. */
  async setCheckbox(id, checked = true) {
    const box = this.page.locator(`#${id}`);
    if ((await box.isChecked()) !== checked) {
      await this.page.locator(`label.invisible-click[for="${id}"]`).click();
    }
  }

  /**
   * Submit the wizard and return the API response for assertion.
   * The save endpoints differ per screen (StockInwardMetal, AlloyInward, ...)
   * but all contain "Inward"; override submitApiPattern to narrow it.
   */
  async submit() {
    const pattern = this.submitApiPattern || /Inward/i;
    // Grid refreshes and keep-alives are POSTs too - never count them as the
    // save. And the QA server can take >60s on master-data saves.
    const noise = /GetAll|Pagination|KeepAlive|GetMasterData|GetLocation/i;
    const resp = this.page.waitForResponse(
      (r) => pattern.test(r.url()) && !noise.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
      { timeout: 120_000 },
    );
    await this.submitBtn.click();
    const r = await resp;
    return r.json().catch(() => null);
  }

  /** The RC / voucher number shown on the post-submit Print dialog (e.g. M137). */
  async voucherNumber() {
    const p = this.printDialog.locator('p');
    await p.first().waitFor({ state: 'visible', timeout: 30_000 });
    for (const t of await p.allTextContents()) {
      const m = t.trim().match(/^[A-Z]+\d+$/);
      if (m) return m[0];
    }
    const txt = ((await this.printDialog.innerText()) || '').replace(/\s+/g, ' ');
    const m = txt.match(/Voucher Number\s*:\s*([A-Z0-9-]+)/i);
    return m ? m[1] : '';
  }

  async summaryText() {
    return ((await this.summaryPanel.innerText()) || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Attach a file through an "Add Files" control: opens the Upload Files
   * dialog, injects the file straight into its input[type=file], commits
   * with "Add Image", then closes the dialog. Pages can render several Add
   * Files controls at once (order form + a sample/item panel) - last:true
   * targets the newest visible one.
   */
  async attachFileViaAddFiles(filePath, { last = false } = {}) {
    const btns = this.page.getByRole('button', { name: 'Add Files' }).locator('visible=true');
    const btn = last ? btns.last() : btns.first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    const dlg = this.page
      .locator('[role="dialog"], .modal, ngb-modal-window, .offcanvas')
      .filter({ hasText: 'Upload Files' })
      .last();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });

    await dlg.locator('input[type="file"]').first().setInputFiles(filePath);
    await this.page.waitForTimeout(1_500);

    const addImage = dlg.getByRole('button', { name: 'Add Image' });
    await addImage.waitFor({ state: 'visible', timeout: 15_000 });
    await addImage.click();
    await this.page.waitForTimeout(1_500);

    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    console.log('Add Files: image attached and dialog closed');
  }

  /**
   * Post-save print template check: when the Print dialog offers a Preview
   * button, open it and verify the template actually rendered - a PDF
   * viewer, iframe or report markup, inline or in a popup (both happen).
   * Closes the preview again so the caller can continue with the dialog.
   * Returns 'ok' | 'no-preview'; THROWS when Preview opens no report
   * surface (that is the broken-template signal this check exists for).
   */
  async verifyPrintPreview({ screenshot } = {}) {
    const previewBtn = this.page.getByRole('button', { name: /Preview/ }).last();
    if (!(await previewBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.log('print preview: no Preview button offered - skipping');
      return 'no-preview';
    }
    const maybePopup = this.page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
    await previewBtn.click();
    const popup = await maybePopup;
    const previewPage = popup || this.page;
    await previewPage.waitForLoadState('domcontentloaded').catch(() => {});
    await previewPage.waitForTimeout(3_000); // let the report start rendering

    // A rendered template shows as a PDF viewer / iframe / canvas / blob
    // image, OR as report HTML inside an offcanvas (the Issue page does the
    // latter - no [class*=report] anywhere). Poll: server-side template
    // builds can take a while.
    // 'visible=true' matters: pages keep hidden background iframes, and
    // .first() alone would test the hidden one forever.
    const surface = previewPage
      .locator('embed, iframe, object, canvas, img[src^="blob:"], img[src^="data:"], [class*=preview], [class*=report], [class*=pdf]')
      .locator('visible=true')
      .first();
    let rendered = popup !== null ? 'popup' : '';
    const deadline = Date.now() + 30_000;
    while (!rendered && Date.now() < deadline) {
      if (await surface.isVisible().catch(() => false)) { rendered = 'inline surface'; break; }
      // report-as-HTML inside an offcanvas or modal (the Issue page renders
      // the template in an add-custom-control-modal): substantial text that
      // is NOT the Print dialog itself (which says "Voucher Number")
      const oc = previewPage.locator('.offcanvas, .modal').locator('visible=true').last();
      if (await oc.isVisible().catch(() => false)) {
        const txt = ((await oc.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        if (txt.length > 150 && !/Voucher Number\s*:/i.test(txt)) { rendered = 'dialog html'; break; }
      }
      await previewPage.waitForTimeout(1_000);
    }
    if (screenshot) await previewPage.screenshot({ path: screenshot, fullPage: true }).catch(() => {});

    if (!rendered) {
      // capture what IS on screen before declaring the template broken
      const diag = await previewPage.evaluate(() => {
        const vis = (n) => n.offsetParent !== null;
        return {
          offcanvases: [...document.querySelectorAll('.offcanvas, [role="dialog"], .modal')].filter(vis)
            .map((n) => `${n.className.split(' ').slice(0, 3).join('.')}: ${(n.innerText || '').replace(/\s+/g, ' ').slice(0, 120)}`),
          frames: document.querySelectorAll('iframe, embed, object, canvas').length,
        };
      }).catch(() => null);
      throw new Error(`Print preview opened NO report surface - the print template looks broken. On screen: ${JSON.stringify(diag)}`);
    }
    console.log(`print preview: template rendered (${rendered})`);

    if (popup) {
      await popup.close().catch(() => {});
    } else {
      // inline preview renders in an offcanvas - close it, back to the dialog
      await this.page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
      await this.page.waitForTimeout(1_000);
    }
    return 'ok';
  }

  /**
   * Post-save proof: the record must show up in the page's list view (the
   * data table shown on load). Navigates back to the list (open + tab by
   * default, or a custom prepare()), then polls page 1 with reloads - lists
   * are newest-first but the grid can lag the save by a few seconds.
   */
  async verifyRowInList(rowText, { prepare } = {}) {
    if (prepare) {
      await prepare();
    } else {
      await this.open();
      if (this.selectTab) await this.selectTab().catch(() => {});
    }
    for (let i = 0; i < 5; i++) {
      await this.waitForIdle();
      await this.page.waitForTimeout(2_500);
      if ((await this.gridRows.filter({ hasText: rowText }).count()) > 0) {
        console.log(`list view shows the saved record: ${rowText}`);
        return true;
      }
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    throw new Error(`Saved record "${rowText}" never appeared in the list view`);
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { StockInwardBasePage };
