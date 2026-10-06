const { StockInwardBasePage } = require('./StockInwardBasePage');
const { T } = require('../utils/timeouts');

/**
 * Barcode Generation — Inventory > Operations > Barcode.
 * Route: /inv/view-barcode-generation.
 *
 * Add form (mapped live, 31-08-2026): Source From is preset to "Vendor".
 * Item Type → Stock Identity Type → Vendor → Lot No cascade; picking the
 * Lot No auto-fills Lot Serial No (e.g. NNN86-1), Business Unit, Barcode
 * Type "Normal", Entry Mode "SINGLE TAG" and the whole article chain from
 * the lot. The three custom "Description Fields" dropdowns
 * (Descriptionttest / Decsription2 / Testdoc) are MANDATORY - the QA lead's
 * recording shows Submit silently failing until "Test 2" was picked.
 * Gross Weight is the manual entry (tag weight out of the lot).
 */
class BarcodeGenerationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Barcode');
  }

  async open() {
    await this.goto('/inv/view-barcode-generation');
    await this.addBtn.waitFor({ state: 'visible', timeout: T(30_000) });
  }

  /** Generate one tag from a lot. Returns the save-response body. */
  async generateTag({
    itemType = 'Metal',
    stockIdentityType = 'Jobwork Stock',
    vendor = 'RAJA',
    lotNo,
    brand, // Brand item type only: the Brand Name select (QA lead 04-09-2026)
    amount, // Brand item type only: the Pricing Amount input is mandatory
    grossWeight,
    pieces, // defaults to the form's value, capped to the lot's piece count
    descriptions = { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    additionalCharges, // true | { chargeType, chargeName, amount } - see addAdditionalCharges
    counter, // jobwork-return lots: the Counter is empty + mandatory and must be an ORDER-type counter (QA lead 06-10-2026: "Counter 1")
    subCounter, // its Sub Counter (QA lead: "Sub Counter 1"); first offered when omitted
  }) {
    await this.open();
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: T(60_000) });
    await this.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: T(30_000) });

    await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    await this.pick('masterDataValueID_StockIdentityType', stockIdentityType, { exact: true });
    await this.pick('vendorID', vendor);
    await this.pick('lotGenerationID', lotNo, { exact: true });
    await this.waitForIdle();
    await this.settle(2_500);

    // the lot pick auto-fills Lot Serial No / BU / barcode type / entry mode /
    // article chain; make sure the serial actually landed before moving on
    if (!(await this.selectValue('lotGenerationMetalID'))) {
      await this.pickFirstOption('lotGenerationMetalID');
      await this.settle(2_000);
    }
    console.log(
      `barcode form: serial=${await this.selectValue('lotGenerationMetalID')}, ` +
      `article=${await this.selectValue('productArticleID')}, entry=${await this.selectValue('masterDataValueID_ItemTaggingMode')}`,
    );

    // The summary panel shows what the lot holds ("Lot Weight : 350.000",
    // "Lot Pcs : 1"). A tag heavier than the lot makes Submit fail SILENTLY
    // (no request, no invalid control - QA lead 21-09-2026), so never ask
    // for more than the lot has, and fail loudly on an exhausted lot.
    const lotWeight = await this.lotSummaryNumber('Lot Weight');
    const lotPcs = await this.lotSummaryNumber('Lot Pcs');
    console.log(`barcode form: lot ${lotNo} holds weight=${lotWeight ?? '?'} pcs=${lotPcs ?? '?'}`);
    if (lotWeight !== null && lotWeight <= 0) {
      throw new Error(`lot ${lotNo} has no weight left to tag (Lot Weight ${lotWeight}) - the chain is reusing a consumed lot`);
    }
    if (lotWeight !== null && grossWeight !== undefined && Number(grossWeight) > lotWeight) {
      console.log(`barcode: requested gross weight ${grossWeight} exceeds the lot's ${lotWeight} - capped to the lot weight`);
      grossWeight = lotWeight;
    }
    // Pieces: the form pre-fills 10; more pieces than the lot holds shows the
    // inline alert "Pcs exceeds Lot Pcs" and Submit fires nothing
    const piecesInput = this.inputByLabel('Pieces');
    if (await piecesInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const current = Number((await piecesInput.inputValue().catch(() => '')) || 0);
      let want = pieces !== undefined ? Number(pieces) : current;
      if (lotPcs !== null && lotPcs > 0 && want > lotPcs) want = lotPcs;
      if (want > 0 && want !== current) {
        await piecesInput.fill(String(want));
        await piecesInput.blur();
        console.log(`barcode: pieces ${current} -> ${want} (lot holds ${lotPcs ?? '?'})`);
      }
      await this.settle(1_000);
      const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => []))
        .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (alerts.some((a) => /exceeds Lot/i.test(a))) {
        throw new Error(
          `lot ${lotNo} rejects even ${want} pc(s) ("${alerts.join('; ')}") - its balance is below its total of `
          + `${lotPcs ?? '?'} pcs / ${lotWeight ?? '?'} g, so it was already tagged in an earlier run. Run the lot step first.`,
        );
      }
    }

    // Brand tags carry a mandatory Brand Name select (controlname
    // productBrandID - named by the silent-submit diagnostics)
    if (brand) {
      await this.pick('productBrandID', brand);
    }

    // mandatory custom description dropdowns (labels are env-configured;
    // present on Metal/Brand, ABSENT on the Stone barcode form) - skip any
    // label that is not on this form
    for (const [label, option] of Object.entries(descriptions)) {
      const lbl = this.page.locator(`label:text-is("${label}")`).first();
      if (await lbl.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await this.pickByLabel(label, option, { exact: true });
      } else {
        console.log(`description "${label}" not on this form - skipped`);
      }
    }

    // Brand lots do not auto-fill the entry mode - set it when blank
    if (!(await this.selectValue('masterDataValueID_ItemTaggingMode').catch(() => 'skip'))) {
      await this.pick('masterDataValueID_ItemTaggingMode', 'SINGLE TAG', { exact: true }).catch(() => {});
    }
    // Gross weight label differs by tab: Metal/Brand "Gross Weight",
    // Stone "Stone Gross Weight With Tare" (the plain Gross Weight there is
    // a disabled computed field)
    if (grossWeight !== undefined) {
      const stoneGross = this.inputByLabel('Stone Gross Weight With Tare');
      if (await stoneGross.isVisible({ timeout: 2_000 }).catch(() => false) && await stoneGross.isEnabled().catch(() => false)) {
        await this.fillByLabel('Stone Gross Weight With Tare', grossWeight);
      } else {
        await this.fillByLabel('Gross Weight', grossWeight);
      }
    }
    if (amount !== undefined) await this.fillByLabel('Amount', amount);
    await this.settle(1_500);

    // Counter + Sub Counter: prefilled on stock / B2B lots, but EMPTY and
    // mandatory on a jobwork-return lot (TC-JW-DOL-04, TC-OLG-05: Submit
    // silently blocked, invalid select "counterID"). Picking a Counter then
    // renders a dependent SUB COUNTER that is mandatory too (06-10-2026).
    // visible=true: a hidden counterID select earlier in the DOM (the list
    // view's filter) made a plain .first() look invisible and skip this.
    await this.fillCounterAndSubCounter({ counter, subCounter });

    // Additional Charges (QA lead 26-09-2026: "click on additional charges,
    // add charges, then submit"): without them Submit fires nothing and flags
    // no invalid control - seen on goods-receipt AND GRN lots, so they are
    // added whenever the form offers the button; additionalCharges: false
    // opts out, an object picks the charge
    const chargesBtn = this.page.getByRole('button', { name: /Additional Charges/ }).locator('visible=true').first();
    if (additionalCharges !== false && (await chargesBtn.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await this.addAdditionalCharges(additionalCharges && typeof additionalCharges === 'object' ? additionalCharges : {});
    }

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save|generate/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation|GenerateTax|TaxRates/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000); // armed with the click
    await this.submitBtn.click();
    const r = await resp;
    if (!r) {
      const diag = await this.invalidControls();
      const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => []))
        .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      throw new Error(
        `Barcode Submit fired no save request - form silently blocked; invalid: ${JSON.stringify(diag)}; `
        + `gross weight ${grossWeight ?? '-'} vs lot weight ${lotWeight ?? '?'} (lot pcs ${lotPcs ?? '?'}); alerts: ${JSON.stringify(alerts)}`,
      );
    }
    const body = await r.json().catch(() => null);
    console.log('barcode tag save:', r.status(), JSON.stringify(body).slice(0, 300));
    await this.reportSaveToast('barcode tag generation', toast);
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Barcode save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.closeVisibleDialog();
    return body;
  }

  /** The visible ng-select of a wrapper controlname / raw formcontrolname ('' when the form has none). */
  visibleSelect(controlname) {
    return this.page
      .locator(`sioniq-ng-select[controlname="${controlname}"] ng-select, ng-select[formcontrolname="${controlname}"]`)
      .locator('visible=true').first();
  }

  /**
   * Open a select and return its option labels - the ng-select panel opened
   * too early shows nothing / "No items found" until reopened (stale-panel
   * behaviour seen on TC-OLG-05: the Counter list stayed empty for 20 s), so
   * each attempt closes and reopens it and waits a little longer.
   */
  async optionsOf(sel, { attempts = 3 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await sel.locator('.ng-select-container').click({ timeout: T(10_000) });
      const options = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i });
      const found = await options.first().waitFor({ state: 'visible', timeout: T(attempt * 4_000) }).then(() => true).catch(() => false);
      if (found) return { options, labels: (await options.allTextContents()).map((t) => t.trim()) };
      console.log(`barcode: select offered no options (attempt ${attempt}) - reopening`);
      await this.settle(1_500);
    }
    await this.page.keyboard.press('Escape').catch(() => {});
    return { options: null, labels: [] };
  }

  /**
   * Counter + Sub Counter of a jobwork-return lot. The app validates the
   * counter's TYPE ("Invalid Counter: the selected counter is not an Order
   * counter. Please select a counter with Counter Type = Order", 06-10-2026)
   * and the dropdown labels do not show the type, so the caller names the
   * counter (QA lead: "Counter 1", the only Order-type counter on qa) and
   * its sub counter ("Sub Counter 1"). Without names: the first counter that
   * offers a sub counter (kept for forms that do not validate the type).
   */
  async fillCounterAndSubCounter({ counter: wantCounter, subCounter: wantSub } = {}) {
    const counter = this.visibleSelect('counterID');
    if (!(await counter.count())) { console.log('barcode: no Counter select on this form'); return; }
    const valueOf = async (sel) => ((await sel.locator('.ng-value').first().textContent({ timeout: 1_000 }).catch(() => '')) || '').trim();
    if (await valueOf(counter)) return; // prefilled (stock / B2B lots)

    const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase(); // "Sub Counter 1" == "Sub Counter1" (the app's spelling)
    const indexOf = (labels, want) => {
      let i = labels.findIndex((l) => norm(l) === norm(want));
      if (i < 0) i = labels.findIndex((l) => norm(l).includes(norm(want)));
      return i;
    };
    const pickSub = async (want, underLabel) => {
      const sub = this.visibleSelect('subCounterID');
      if (!(await sub.count()) || (await valueOf(sub))) return true; // no sub counter needed, or prefilled
      const subOpts = await this.optionsOf(sub, { attempts: 2 });
      if (!subOpts.options) return false;
      let i = want ? indexOf(subOpts.labels, want) : 0;
      if (i < 0) {
        console.log(`barcode: Sub Counter "${want}" not offered under "${underLabel}" (${JSON.stringify(subOpts.labels.slice(0, 8))}) - taking the first`);
        i = 0;
      }
      await subOpts.options.nth(i).click();
      await this.settle(1_000);
      console.log(`barcode: Sub Counter picked "${subOpts.labels[i]}" under "${underLabel}"`);
      return true;
    };

    const { options, labels } = await this.optionsOf(counter);
    if (!options) throw new Error('barcode: the Counter select is mandatory here but offered no option (3 attempts)');

    if (wantCounter) {
      const i = indexOf(labels, wantCounter);
      if (i < 0) {
        await this.page.keyboard.press('Escape').catch(() => {});
        throw new Error(`barcode: Counter "${wantCounter}" is not offered - the list has ${labels.length} counters: ${JSON.stringify(labels.slice(0, 12))}`);
      }
      await options.nth(i).click();
      await this.settle(1_500);
      console.log(`barcode: Counter picked "${labels[i]}"`);
      if (!(await pickSub(wantSub, labels[i]))) throw new Error(`barcode: Counter "${labels[i]}" offers no Sub Counter and the form needs one`);
      return;
    }

    // no name given: the first counter that offers a sub counter
    for (let i = 0; i < Math.min(labels.length, 4); i++) {
      if (i > 0) {
        const again = await this.optionsOf(counter);
        if (!again.options) break;
        await again.options.nth(i).click();
      } else {
        await options.nth(i).click();
      }
      await this.settle(1_500);
      console.log(`barcode: Counter was empty - picked "${labels[i]}"`);
      if (await pickSub(null, labels[i])) return;
      console.log(`barcode: counter "${labels[i]}" offers no sub counter - trying the next counter`);
    }
    throw new Error(`barcode: no Counter with a selectable Sub Counter among ${JSON.stringify(labels.slice(0, 4))}`);
  }

  /** A number from the lot summary panel, e.g. "Lot Weight : 350.000" -> 350; null when absent. */
  async lotSummaryNumber(label) {
    const text = (await this.page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
    const at = text.indexOf(label + ' :');
    if (at < 0) return null;
    const m = text.slice(at + label.length + 2).match(/^\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }

  /** Fallback: open a select and take its first offered option. */
  async pickFirstOption(controlname) {
    await this.select(controlname).locator('.ng-select-container').click();
    const opt = this.page.locator('.ng-dropdown-panel .ng-option').first();
    await opt.waitFor({ state: 'visible', timeout: T(20_000) });
    await opt.click();
  }

  /**
   * Proof via the Generated Tags view: the new tag row (matched by text,
   * e.g. the article) must be listed. Returns the tag number - first
   * date-serial token of the newest matching row.
   */
  async verifyGeneratedTag(rowText) {
    // "Generated Tags" is no longer a role=button (Sept-2026 UI) - accept a
    // button, a tab or the plain clickable text
    const view = this.page.getByRole('button', { name: 'Generated Tags' })
      .or(this.page.getByRole('tab', { name: 'Generated Tags' }))
      .or(this.page.getByText(/^\s*Generated Tags\s*$/))
      .locator('visible=true').first();
    await view.click();
    await this.waitForIdle();
    for (let i = 0; i < 5; i++) {
      await this.settle(2_500);
      const row = this.gridRows.filter({ hasText: rowText }).first();
      if (await row.isVisible().catch(() => false)) {
        const text = ((await row.innerText()) || '').replace(/\s+/g, ' ').trim();
        console.log(`Generated Tags row: ${text}`);
        const m = text.match(/\d{4}-\d{2}-\d{2}\d+/);
        return m ? m[0] : text.split(' ')[1];
      }
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await view.click({ timeout: 3_000 }).catch(() => {});
    }
    throw new Error(`Generated Tags never listed a row matching "${rowText}"`);
  }
}

module.exports = { BarcodeGenerationPage };
