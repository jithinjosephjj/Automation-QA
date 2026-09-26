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
/** The pure (per-metal) rate the inward wizards enter wherever the app asks for it (QA lead, 24-09-2026). */
const PURE_RATE = 15000;

class StockInwardBasePage extends BasePage {
  get pureRate() { return this._pureRate ?? PURE_RATE; }
  set pureRate(v) { this._pureRate = v; }

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
   * The option nodes of the panel belonging to `host` (an ng-select). Waits
   * for ANY panel to attach - fast - instead of timing out on an inline panel
   * this app almost never renders (that wait cost 1.5 s on every pick). An
   * inline panel, when present, is preferred over the page-level one.
   */
  async panelOptions(host) {
    await this.page.locator('.ng-dropdown-panel').last().waitFor({ state: 'attached', timeout: 3_000 }).catch(() => {});
    const inline = host.locator('.ng-dropdown-panel');
    return (await inline.count()) ? inline.locator('.ng-option') : this.page.locator('.ng-dropdown-panel .ng-option');
  }

  /**
   * Did the pick land? ng-select echoes the chosen label in .ng-value-label.
   * A click on an option of a panel that was re-rendering (cascade from an
   * upstream pick) can leave the control empty - the caller then retries.
   */
  async valueLanded(host, pattern, timeout = 3_000) {
    // .ng-value is what this app renders (custom label templates, so there is
    // no .ng-value-label); strip the clear glyph before matching
    const deadline = Date.now() + timeout;
    do {
      const texts = await host.locator('.ng-value').allTextContents().catch(() => []);
      if (texts.some((t) => pattern.test(t.replace(/×/g, '').trim()))) return true;
      await this.page.waitForTimeout(150);
    } while (Date.now() < deadline);
    return false;
  }

  /**
   * A pick can be undone by the form itself: an upstream select's follow-up
   * requests (article -> purity list, inward type -> vendor list) re-render
   * downstream controls and clear their value, sometimes a full second after
   * the click. Wait the cascade out - longer for server-searched picks, which
   * always cascade - then confirm the value is still there.
   */
  async survivesCascade(host, pattern, search) {
    if (search) await this.settle(3_000, { grace: 800, quiet: 1_000 });
    else await this.settle(1_000, { grace: 250, quiet: 400 });
    return this.valueLanded(host, pattern, 500);
  }

  /**
   * Open a wizard dropdown, pick an option, return the full option list for
   * assertions. search types into the combobox first (server-filtered lists
   * like Article). closePanel is required after multi-selects (purchaser).
   */
  async pick(controlname, optionText, { closePanel = false, search = false, exact = false } = {}) {
    const host = this.select(controlname);
    // exact avoids substring traps: "Sioniq QA" must not match "Sioniq QA1".
    const pattern = exact
      ? new RegExp(String.raw`^\s*` + escapeRe(optionText) + String.raw`\s*$`)
      : new RegExp(escapeRe(optionText), 'i');

    // ng-select renders whatever the list held at open time - including an
    // empty panel or a stale "No items found" - and does not refresh until
    // reopened. Lists load asynchronously (vendors, server-filtered articles),
    // so close and reopen until the option is actually there.
    let all = [];
    let clickedButEmpty = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.closeStalePanels();
      await host.locator('.ng-select-container').click();
      if (search || attempt >= 2) {
        // attempt >= 2: the list may be virtual-scrolled past the option -
        // typing filters it into the rendered window
        await host.locator('input[role="combobox"]').fill(optionText).catch(() => {});
        await this.settle(2_000); // server-side filter debounce
      }
      // scope to THIS control's own panel: the reworked B2B order form keeps
      // other dropdowns' panels in the DOM, so a page-global .first() can land
      // on a hidden stale panel's option and never see it become visible.
      // Fall back to the page-level panel for appendTo-body selects.
      const options = await this.panelOptions(host);
      const wanted = options.filter({ hasText: pattern });
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
          if (await this.valueLanded(host, pattern)) {
            if (await this.survivesCascade(host, pattern, search)) return all;
            console.log(`pick ${controlname}: "${optionText}" was cleared by a cascade (attempt ${attempt}) - picking again`);
            continue;
          }
          clickedButEmpty++;
          console.log(`pick ${controlname}: "${optionText}" clicked but the value did not land (attempt ${attempt}) - retrying`);
        }
      }
      await this.page.keyboard.press('Escape');
    }
    if (clickedButEmpty === 4) {
      // every attempt clicked the option; the control just never echoed the
      // label - keep the old (unverified) behaviour rather than fail here
      console.log(`pick ${controlname}: value echo never confirmed for "${optionText}" - continuing`);
      return all;
    }
    throw new Error(
      `Option "${optionText}" never appeared in ${this.tabName} wizard dropdown "${controlname}". Last option list: ${JSON.stringify(all)}`,
    );
  }

  /**
   * Close every ng-select panel left open on the page. The reworked B2B order
   * form (Sept 2026) no longer closes a dropdown's panel after selection or on
   * outside click, so stale panels pile up, float over other controls and
   * hijack page-global option lookups. Escape only closes the focused select;
   * clicking a stuck panel's own container toggles it shut regardless of focus.
   */
  async closeStalePanels() {
    const open = this.page.locator('ng-select.ng-select-opened');
    for (let i = 0; i < 6; i++) {
      if (!(await open.count())) break;
      await open.first().locator('.ng-select-container').click({ timeout: 2_000 }).catch(() => {});
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(200);
    }
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
    const pattern = exact
      ? new RegExp(String.raw`^\s*` + escapeRe(optionText) + String.raw`\s*$`)
      : new RegExp(escapeRe(optionText), 'i');
    let clickedButEmpty = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.closeStalePanels();
      await wrapper.locator('.ng-select-container').click();
      if (search || attempt >= 2) {
        // attempt >= 2: virtual-scrolled list - type to bring the option in
        await wrapper.locator('input[role="combobox"]').fill(optionText).catch(() => {});
        await this.settle(2_000);
      }
      // same stale-panel trap as pick(): scope to this select's own panel
      const options = await this.panelOptions(wrapper);
      const wanted = options.filter({ hasText: pattern });
      const found = await wanted.first().waitFor({ state: 'visible', timeout: attempt * 5_000 })
        .then(() => true).catch(() => false);
      if (found && (await wanted.first().click({ timeout: 10_000 }).then(() => true).catch(() => false))) {
        if (closePanel) await this.page.keyboard.press('Escape');
        if (await this.valueLanded(wrapper, pattern)) {
          if (await this.survivesCascade(wrapper, pattern, search)) return;
          console.log(`pickByLabel ${labelText}: "${optionText}" was cleared by a cascade (attempt ${attempt}) - picking again`);
          continue;
        }
        clickedButEmpty++;
        console.log(`pickByLabel ${labelText}: "${optionText}" clicked but the value did not land (attempt ${attempt}) - retrying`);
      }
      await this.page.keyboard.press('Escape');
    }
    if (clickedButEmpty === 4) {
      console.log(`pickByLabel ${labelText}: value echo never confirmed for "${optionText}" - continuing`);
      return;
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
  /**
   * Arm a watcher for the post-save SUCCESS TOAST ("Saved successfully!").
   * Must be armed BEFORE the save click - toasts auto-dismiss within seconds,
   * so checking after long post-save waits produces false misses.
   */
  watchSaveToast(timeout = 15_000) {
    const toast = this.page.getByText(/saved successfully/i).first()
      .or(this.page.locator('.toast-success, .p-toast-message-success, ngb-toast.bg-success').first());
    return toast.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  }

  /**
   * Await an armed toast watcher and REPORT a miss: the API save succeeded
   * but the UI showed no success validation - that is a UI DEFECT (QA lead,
   * 16-09-2026). Logged with a TOAST-BUG prefix and appended to
   * toast-misses.jsonl for the run report. Never fails the flow - the record
   * IS saved.
   */
  async reportSaveToast(what, watcher, grace = 8_000) {
    // the watcher was armed at click time; give it a bounded grace window
    // after the save instead of waiting out its full timeout on a miss
    const shown = await Promise.race([
      watcher,
      new Promise((res) => setTimeout(() => res(false), grace)),
    ]);
    if (shown) {
      console.log(`toast: success validation shown after ${what}`);
      return true;
    }
    console.log(`TOAST-BUG: NO success-validation toast after "${what}" - the record SAVED (API success) but the UI gave no confirmation. Raise as a defect.`);
    try {
      const fs = require('fs');
      const path = require('path');
      fs.appendFileSync(path.join(process.cwd(), 'toast-misses.jsonl'),
        `${JSON.stringify({ when: new Date().toISOString(), action: what, url: this.page.url() })}\n`);
    } catch (e) { /* reporting must never break the flow */ }
    return false;
  }

  /**
   * Env-configured MANDATORY custom dropdowns (Kakkanad shows description
   * selects on the item step, 18-09-2026) block Add Item silently while
   * empty. Fill every still-empty select the form marks invalid with its
   * first offered option - locations without such fields are a no-op.
   */
  async fillMandatoryEmptySelects() {
    // the invalid list SHRINKS as selects get filled, so always take the
    // first still-invalid one instead of indexing a snapshot
    const invalid = this.page
      .locator('sioniq-ng-select')
      .filter({ has: this.page.locator('ng-select.ng-invalid') })
      .locator('visible=true');
    for (let round = 0; round < 8; round++) {
      const n = await invalid.count();
      let picked = false;
      for (let i = 0; i < n && !picked; i++) {
        const wrap = invalid.nth(i);
        if ((await invalid.count()) <= i) break;
        // an empty select has NO .ng-value node - never call textContent() on
        // it blind, that auto-waits the full action timeout (15 s) for nothing
        const value = wrap.locator('.ng-value');
        const val = (await value.count()) ? ((await value.first().textContent({ timeout: 2_000 }).catch(() => '')) || '').trim() : '';
        if (val) continue;
        const name = (await wrap.getAttribute('controlname', { timeout: 2_000 }).catch(() => '')) || '(unnamed)';
        await wrap.locator('ng-select .ng-select-container').first().click({ timeout: 3_000 }).catch(() => {});
        await this.settle(900);
        const opt = this.page.locator('.ng-dropdown-panel .ng-option')
          .filter({ hasNotText: /No items found|Type to search/i }).first();
        if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
          console.log(`mandatory custom select "${name}" -> ${((await opt.textContent()) || '').trim()}`);
          await opt.click({ timeout: 3_000 }).catch(() => {});
          picked = true;
          await this.settle(800);
        } else {
          await this.page.keyboard.press('Escape').catch(() => {});
        }
      }
      if (!picked) break;
    }
  }

  /** "No. of Pieces : N" from the wizard's summary panel, or null when absent. */
  async summaryPieces() {
    const body = await this.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
    const m = body.match(/No\. of Pieces\s*:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /**
   * Add Item, VERIFIED. The click is a silent no-op while the pricing/tax
   * recompute is still in flight or a control is invalid (seen 18/19-09-2026),
   * so the summary's piece count must actually grow; otherwise fill whatever
   * turned invalid and click again. Falls back to a plain click on wizards
   * without the summary panel.
   */
  /**
   * App change 23-09-2026 (evening): the item form lost its per-item "Rate"
   * input; after Add Item a per-metal strip renders instead ("Pure Weight",
   * "Rate", "Metal Amount") and Next / Submit stay silent while that Rate
   * is empty. That Rate is the PURE rate - 15000 per the QA lead
   * (24-09-2026), see PURE_RATE - entered into every empty "Rate" input.
   */
  /**
   * "Additional Charges" button -> dialog (Barcode, Stone Inward - QA lead
   * 26-09-2026): every select the dialog leaves empty gets the wanted option
   * (chargeType / chargeName, matched by substring) or its first offered one
   * ("Barcode charge" / "Test charge"), an empty amount input gets `amount`,
   * Add inserts the row when the dialog has one, then Submit / Close / Save
   * / Done shuts it. `index` picks the button when a form carries two
   * (item-level first, bill-level second). Logs what the dialog offered.
   */
  async addAdditionalCharges({ chargeType, chargeName, amount, index = 0 } = {}) {
    const tag = `${this.tabName} charges`;
    await this.page.getByRole('button', { name: /Additional Charges/ }).locator('visible=true').nth(index).click({ timeout: 15_000 });
    const dlg = this.page.locator('[role="dialog"], .modal, ngb-modal-window, .offcanvas').filter({ hasText: /Additional Charges/ }).locator('visible=true').last();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });
    await this.settle(1_500);
    const wanted = [chargeType, chargeName];
    const hosts = dlg.locator('ng-select').locator('visible=true');
    const n = await hosts.count();
    for (let i = 0; i < n; i++) {
      const host = hosts.nth(i);
      const ctl = await host.evaluate((el) => (el.closest('[controlname]') || el).getAttribute('controlname') || '').catch(() => '');
      if (((await host.locator('.ng-value-label').first().textContent({ timeout: 500 }).catch(() => '')) || '').trim()) continue;
      if (await host.evaluate((el) => el.classList.contains('ng-select-disabled')).catch(() => false)) continue;
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await this.page.keyboard.press('Escape');
      await host.locator('.ng-select-container').click().catch(() => {});
      await this.page.waitForTimeout(900);
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i });
      const labels = (await opts.allTextContents()).map((t) => t.trim());
      const want = wanted[i];
      let idx = want ? labels.findIndex((l) => l.toLowerCase().includes(String(want).toLowerCase())) : -1;
      if (idx < 0) idx = 0;
      console.log(`${tag}: "${ctl}" offers ${JSON.stringify(labels.slice(0, 10))} -> ${labels[idx] ?? '(nothing)'}`);
      if (labels.length) await opts.nth(idx).click();
      else await this.page.keyboard.press('Escape');
      await this.settle(1_500); // Calculation Base / Rate auto-fill
    }
    if (amount !== undefined) {
      const amt = dlg.locator('input[type="number"]:not([disabled]):not([readonly]), input[formcontrolname*="mount" i]:not([disabled])').locator('visible=true');
      for (let i = 0; i < await amt.count(); i++) {
        if (!Number((await amt.nth(i).inputValue().catch(() => '')) || 0)) { await amt.nth(i).fill(String(amount)); await amt.nth(i).blur(); }
      }
    }
    const inputs = await dlg.locator('input:not([type=checkbox])').locator('visible=true').evaluateAll((els) => els.map((e) => `${e.getAttribute('formcontrolname') || e.id || e.placeholder}=${e.value}${e.disabled || e.readOnly ? '(ro)' : ''}`)).catch(() => []);
    const buttons = (await dlg.locator('button').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`${tag}: dialog inputs ${JSON.stringify(inputs)}; buttons ${JSON.stringify(buttons)}`);
    const add = dlg.locator('button').filter({ hasText: /^\s*\+?\s*Add\s*$/ }).last();
    if (await add.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await add.click();
      await this.settle(1_000);
    }
    const rows = dlg.locator('table tbody tr').filter({ hasNotText: /No (Data|records)/i });
    await rows.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    console.log(`${tag}: ${await rows.count()} charge row(s) -> ${(await rows.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 300)}`);
    await dlg.locator('button').filter({ hasText: /Submit|Close|Save|Done|Ok/i }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    await this.waitForIdle();
    await this.settle(1_500);
  }

  async fillRateAfterAdd(rate = this.pureRate) {
    if (rate === undefined || rate === null) return 0;
    await this.settle(1_200);
    const inputs = this.page.locator('xpath=//label[normalize-space(text())="Rate"]/following::input[not(@type="checkbox")][1]').locator('visible=true');
    const n = await inputs.count();
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      if (await input.isDisabled().catch(() => true)) continue;
      if ((await input.inputValue().catch(() => '')).trim()) continue;
      await input.fill(String(rate));
      await input.blur();
      filled++;
    }
    if (filled) {
      await this.waitForIdle();
      await this.settle(1_200);
      console.log(`${this.tabName}: entered rate ${rate} into ${filled} empty Rate input(s) after Add Item`);
    }
    return filled;
  }

  async addItem() {
    const before = await this.summaryPieces();
    if (before === null) {
      await this.addItemBtn.click();
      return;
    }
    // a successful Add Item also RESETS the item form (the article select
    // empties): on the Goods Receipt path the summary's piece count does not
    // move (26-09-2026), and retrying on a reset form filled it with junk
    // (first-option article / purity) - so a cleared article counts as added
    const articleBefore = await this.selectValue('article').catch(() => '');
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitForIdle();
      await this.settle(1_500);
      await this.addItemBtn.click({ timeout: 3_000 }).catch(() => {});
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const now = await this.summaryPieces();
        const articleNow = articleBefore ? await this.selectValue('article').catch(() => articleBefore) : articleBefore;
        if ((now !== null && now > before) || (articleBefore && !articleNow)) {
          if (!(now !== null && now > before)) console.log(`${this.tabName} Add Item: form reset (article "${articleBefore}" cleared) - item added; summary count ${now}`);
          await this.fillRateAfterAdd();
          return;
        }
        await this.page.waitForTimeout(500);
      }
      const invalid = await this.invalidControls();
      console.log(`${this.tabName} Add Item: piece count still ${before} after attempt ${attempt} - invalid: ${JSON.stringify(invalid)}`);
      if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
    }
    throw new Error(`${this.tabName} Add Item never registered the piece (summary count stayed at ${before})`);
  }

  /**
   * The review step renders a "Pure Rate" input per metal (Gold ...) that
   * stays EMPTY when the location has no metal-rate config, and Submit
   * silently never fires while it is blank (Kakkanad 18-09-2026, Cochin
   * 19-09-2026). Enter the item rate when offered.
   */
  async fillPureRateIfEmpty(rate) {
    const section = this.page.locator('h6:has-text("Pure Rate")').last().locator('xpath=..');
    if (!(await section.isVisible({ timeout: 1_500 }).catch(() => false))) return;
    const inputs = section.locator('input');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      if ((await input.inputValue({ timeout: 2_000 }).catch(() => 'x')) !== '') continue;
      const value = rate ?? this.pureRate;
      await input.fill(String(value));
      await input.blur();
      await this.settle(1_500);
      console.log(`${this.tabName} review step: Pure Rate was empty - entered ${value}`);
    }
  }

  /**
   * UI change 24-09-2026: Submit on Metal Inward first asks "Process with
   * Barcode or Lot? Do you want to proceed with Barcode or Lot?" (No / Yes).
   * The QA lead's answer for the inward chains is "No" - the lot and barcode
   * are separate steps. Waits up to 10 s for the dialog; absent = nothing.
   */
  async answerBarcodeOrLotDialog(answer = 'No') {
    const dialog = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Barcode or Lot/i }).last();
    if (!(await dialog.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) return false;
    const button = dialog.getByRole('button', { name: new RegExp(`^${answer}$`, 'i') }).last();
    await button.click({ timeout: 5_000 });
    console.log(`${this.tabName} submit: "Process with Barcode or Lot?" answered ${answer}`);
    await this.settle(1_000);
    return true;
  }

  /**
   * Submit answering "Process with Barcode or Lot?" with YES (UI change
   * 24-09-2026): a "Lot / Barcode" dialog follows with one select, "Lot or
   * Barcode" (postInwardProcessType: Barcode | Lot).
   *   Lot      -> a "Lot Employee" select (employeeID) appears; Submit saves
   *               the inward AND generates its lot.
   *   Barcode  -> a tag card per piece renders (Employee = the login user,
   *               Gross Weight prefilled, optional OMS / Certificate / RFID /
   *               HUID / Remarks); Submit saves the inward AND its tags.
   * Every POST/PUT the dialog's Submit fires is collected for ~30 s and
   * returned: { inward, others, all } with the bodies parsed.
   */
  async submitWithPostProcess({ mode = 'Lot', lotEmployee, grossWeight, remarks } = {}) {
    await this.fillPureRateIfEmpty();
    const saves = [];
    const onResponse = async (r) => {
      const url = r.url();
      if (!['POST', 'PUT'].includes(r.request().method())) return;
      if (/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Dropdown|Translation|GetB2B|Get[A-Z]\w*$/i.test(url)) return;
      if (!/Inward|Lot|Barcode|Tag/i.test(url)) return;
      const body = await r.json().catch(() => null);
      saves.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), status: r.status(), body });
      console.log(`${this.tabName} post-process save: ${r.status()} ${url.split('/').slice(-2).join('/')} ${JSON.stringify(body).slice(0, 200)}`);
    };
    this.page.on('response', onResponse);
    try {
      await this.submitBtn.click();
      const confirm = this.page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Barcode or Lot/i }).last();
      await confirm.waitFor({ state: 'visible', timeout: 15_000 });
      await confirm.getByRole('button', { name: /^Yes$/i }).click();
      console.log(`${this.tabName} submit: "Process with Barcode or Lot?" answered Yes`);

      const dlg = this.page.locator('.modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Lot \/ Barcode|Lot or Barcode/i }).last();
      await dlg.waitFor({ state: 'visible', timeout: 15_000 });
      await this.pick('postInwardProcessType', mode, { exact: true });
      await this.waitForIdle();
      await this.settle(1_500);
      if (/lot/i.test(mode)) {
        if (lotEmployee) await this.pick('employeeID', lotEmployee, { search: true });
        else await this.pickFirstOption('employeeID');
      } else {
        // the tag card(s): Gross Weight is prefilled from the inward; the
        // first number input of each card is that weight
        if (grossWeight !== undefined) {
          const weights = dlg.locator('input[type="number"]:not([disabled])').locator('visible=true');
          const n = await weights.count();
          for (let i = 0; i < n; i++) { await weights.nth(i).fill(String(grossWeight)); await weights.nth(i).blur(); }
        }
        if (remarks) {
          const remarksBox = dlg.locator('xpath=.//*[normalize-space(text())="Remarks"]/following::input[1] | .//*[normalize-space(text())="Remarks"]/following::textarea[1]').first();
          if (await remarksBox.count()) await remarksBox.fill(remarks).catch(() => {});
        }
      }
      const cards = await dlg.locator('xpath=.//*[contains(normalize-space(text()), "Card ")]').count().catch(() => 0);
      console.log(`${this.tabName} Lot / Barcode dialog: mode ${mode}${cards ? `, ${cards} tag card(s)` : ''}`);

      // the dialog's own Submit (its accessible name carries an icon glyph)
      const toast = this.watchSaveToast(130_000);
      const dialogSubmit = dlg.getByRole('button', { name: /Submit\s*$/ }).last();
      await dialogSubmit.click();
      // wait for the inward save, then give the follow-up (lot / tags) time
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !saves.some((x) => /Inward/i.test(x.url) && x.status === 200)) await this.page.waitForTimeout(500);
      await this.page.waitForTimeout(6_000);
      await this.reportSaveToast(`${this.tabName} submit (${mode})`, toast).catch(() => {});
    } finally {
      this.page.off('response', onResponse);
    }
    const inward = saves.find((x) => /Inward/i.test(x.url) && x.status === 200);
    if (!inward) throw new Error(`${this.tabName}: the Lot / Barcode dialog's Submit saved no inward - saves: ${JSON.stringify(saves.map((x) => x.url + ' ' + x.status))}`);
    const failed = saves.filter((x) => x.status >= 400 || (x.body && x.body.errorCode));
    if (failed.length) throw new Error(`${this.tabName}: post-process save rejected: ${JSON.stringify(failed.map((x) => x.url + ' ' + x.status + ' ' + (x.body && x.body.error)))}`);
    return { inward: inward.body, others: saves.filter((x) => x !== inward).map((x) => x.body), all: saves };
  }

  async submit() {
    const pattern = this.submitApiPattern || /Inward/i;
    // Grid refreshes and keep-alives are POSTs too - never count them as the
    // save. And the QA server can take >60s on master-data saves.
    const noise = /GetAll|Pagination|KeepAlive|GetMasterData|GetLocation/i;
    await this.fillPureRateIfEmpty();
    const resp = this.page.waitForResponse(
      (r) => pattern.test(r.url()) && !noise.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
      { timeout: 120_000 },
    );
    resp.catch(() => {}); // observed below; never an unhandled rejection
    const toast = this.watchSaveToast(130_000); // armed with the click; the save itself can take >60s
    await this.submitBtn.click();
    await this.answerBarcodeOrLotDialog();
    // A Submit that fires no request within 25 s is a silently invalid form:
    // say which controls, fill what can be filled, and click once more.
    let r = await Promise.race([resp, this.page.waitForTimeout(25_000).then(() => null)]);
    if (!r) {
      const invalid = await this.invalidControls();
      console.log(`${this.tabName} submit: no save request after 25 s - invalid controls: ${JSON.stringify(invalid)} - retrying Submit`);
      await this.fillPureRateIfEmpty();
      if (this.fillMandatoryEmptySelects) await this.fillMandatoryEmptySelects();
      await this.submitBtn.click({ timeout: 3_000 }).catch(() => {});
      await this.answerBarcodeOrLotDialog();
      r = await resp;
    }
    await this.reportSaveToast(`${this.tabName} submit`, toast);
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
    await this.settle(1_500);

    const addImage = dlg.getByRole('button', { name: 'Add Image' });
    await addImage.waitFor({ state: 'visible', timeout: 15_000 });
    await addImage.click();
    await this.settle(1_500);

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
    // The preview opens EITHER a popup window OR an inline surface - race the
    // two instead of waiting a fixed 15 s for a popup that rarely comes.
    let popup = null;
    this.page.waitForEvent('popup', { timeout: 30_000 }).then((p) => { popup = p; }).catch(() => {});
    await previewBtn.click();

    // A rendered template shows as a PDF viewer / iframe / canvas / blob
    // image, OR as report HTML inside an offcanvas (the Issue page does the
    // latter - no [class*=report] anywhere). Poll: server-side template
    // builds can take a while.
    // 'visible=true' matters: pages keep hidden background iframes, and
    // .first() alone would test the hidden one forever.
    const surface = this.page
      .locator('embed, iframe, object, canvas, img[src^="blob:"], img[src^="data:"], [class*=preview], [class*=report], [class*=pdf]')
      .locator('visible=true')
      .first();
    let rendered = '';
    let previewPage = this.page;
    const deadline = Date.now() + 30_000;
    while (!rendered && Date.now() < deadline) {
      if (popup) {
        previewPage = popup;
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        rendered = 'popup';
        break;
      }
      if (await surface.isVisible().catch(() => false)) { rendered = 'inline surface'; break; }
      // report-as-HTML inside an offcanvas or modal (the Issue page renders
      // the template in an add-custom-control-modal): substantial text that
      // is NOT the Print dialog itself (which says "Voucher Number")
      const oc = this.page.locator('.offcanvas, .modal').locator('visible=true').last();
      if (await oc.isVisible().catch(() => false)) {
        const txt = ((await oc.innerText({ timeout: 2_000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        if (txt.length > 150 && !/Voucher Number\s*:/i.test(txt)) { rendered = 'dialog html'; break; }
      }
      await this.page.waitForTimeout(500);
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
      // (only when a close button is actually on screen: a blind click used
      // to burn its whole 10 s timeout)
      await this.closeVisibleDialog();
      await this.settle(1_000);
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
      await this.settle(2_500);
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
