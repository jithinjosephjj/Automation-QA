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
    multiBarcode, // a number: tick "Multi Barcode" and generate that many tags of `pieces` / `grossWeight` each (14-11-2026)
    print, // { destination, copies, template }: drive the post-save "Barcode Print" dialog (pick the printer, set Copies, Print) instead of closing it (14-11-2026)
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
        // 03-11-2026: on a Jobwork Stock lot (JobWork Item No filled) qa now DISABLES
        // Pieces (pre-filled 10 on a 1-pc lot) - leave the app's value alone then
        if (await piecesInput.isDisabled().catch(() => false)) {
          console.log(`barcode: Pieces box is disabled (holds ${current}, lot holds ${lotPcs ?? '?'}) - left as the app set it`);
        } else {
          await piecesInput.fill(String(want));
          await piecesInput.blur();
          console.log(`barcode: pieces ${current} -> ${want} (lot holds ${lotPcs ?? '?'})`);
        }
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
    // 10-11-2026: the Stone barcode form now carries its OWN mandatory
    // description selects (Stone Description Setup labels, e.g.
    // "Stonedescription2", "Stone description3", "Stone Description
    // Category1") - empty, Submit answers "Input required. Please fill the
    // mandatory fields." Give each its first option; the Counter keeps its
    // own rules (fillCounterAndSubCounter).
    if (itemType === 'Stone') await this.fillMandatoryEmptySelects({ skip: /counter/i });

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
    if (multiBarcode !== undefined && multiBarcode !== null && multiBarcode !== false) await this.setMultiBarcode(multiBarcode);

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

    const isSave = (r) => r.request().method() === 'POST' && /create|save|generate/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation|GenerateTax|TaxRates/i.test(r.url());
    const resp = this.page.waitForResponse(isSave, { timeout: 120_000 }).catch(() => null);
    let toast = this.watchSaveToast(130_000); // armed with the click
    // An app-side refusal is a toast a second or two after the click (e.g.
    // "Please configure Wastage/Making before generating the barcode.",
    // 21-10-2026 on a lot created by the inward's "Yes -> Lot" dialog) and no
    // request at all - catch it at once instead of after the 120 s wait, by
    // which time the toast is long gone.
    const alertTexts = async () => (await this.page.getByRole('alert').allTextContents().catch(() => []))
      .map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/saved successfully/i.test(t));
    const before = new Set(await alertTexts()); // toasts still fading from the charges dialog do not count
    const refusal = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const fresh = (await alertTexts()).find((t) => !before.has(t));
        if (fresh) return fresh;
        await this.page.waitForTimeout(250);
      }
      return '';
    };
    // Was a save REQUEST sent? Once it is on the wire the outcome is the
    // response, whatever the form shows meanwhile: the Brand form paints an
    // inline "Pcs exceeds Lot Pcs" alert on Submit for ANY count (09-11-2026,
    // NNN12: 10 pcs of a 10-pc lot) while the server validates and saves.
    let requestSent = false;
    const req = this.page.waitForRequest((q) => q.method() === 'POST' && /create|save|generate/i.test(q.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation|GenerateTax|TaxRates/i.test(q.url()), { timeout: 120_000 })
      .then(() => { requestSent = true; }).catch(() => {});
    // the post-save print: the app first asks for the barcode print template -
    // 501 "No print configuration is available ..." means no Barcode Print
    // dialog (Brand tags at Kakkanad, 14-11-2026); printBarcodeLabels reads it
    this._printTemplateResp = this.page.waitForResponse((q) => /GetBarcodeTemplateByConfiguration/i.test(q.url()), { timeout: 60_000 }).catch(() => null);
    this._printTemplateResp.catch(() => {});
    // the lot's tags after the save (GetBarcodeGenerationByLotSerial): the only
    // place a STONE save names its tags - its body carries tagReferences [] and
    // a receiptNo (BDCbbb56, 14-11-2026); Metal / Brand bodies list them
    this.lastLotTags = [];
    this._lotSerialResp = this.page.waitForResponse((q) => /GetBarcodeGenerationByLotSerial\b/i.test(q.url()) && q.request().method() === 'POST', { timeout: 60_000 }).catch(() => null);
    this._lotSerialResp.catch(() => {});
    await this.submitBtn.click();
    let r = await Promise.race([resp, refusal(T(8_000)).then((t) => (t ? { refused: t } : resp))]);
    if (r && r.refused) {
      if (!requestSent) await this.page.waitForTimeout(1_500); // the request can trail the alert by a beat
      if (requestSent) {
        console.log(`barcode: alert "${r.refused}" after Submit, but the save request fired - waiting for its response`);
        r = await resp;
      } else {
        throw new Error(`Barcode Submit refused by the app: "${r.refused}" (lot ${lotNo}, ${lotPcs ?? '?'} pcs / ${lotWeight ?? '?'} g)`);
      }
    }
    req.catch(() => {});
    if (!r) {
      // Silent block with NO ng-invalid control (21-10-2026, TC-B2B-OIY-04): a
      // lot created by the inward's own "Yes -> Lot" dialog carries none of
      // the env-configured attribute selects the Lot Generation page fills
      // (Designer / Muhurath Set / Size / Making Type ...), so the tag form
      // opens with them empty and Submit does nothing. Give every still-empty
      // visible select its first option and submit once more.
      console.log(`barcode: Submit fired nothing - empty fields before the fallback: ${JSON.stringify(await this.emptyVisibleFields())}`);
      const filled = await this.fillEmptyVisibleSelects();
      if (filled.length) {
        console.log(`barcode: Submit fired nothing - filled the empty selects ${JSON.stringify(filled)} and retrying`);
        const resp2 = this.page.waitForResponse(isSave, { timeout: 120_000 }).catch(() => null);
        toast = this.watchSaveToast(130_000);
        await this.submitBtn.click();
        r = await resp2;
      }
    }
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
    // 30-10-2026: at Kakkanad the save opens a "Barcode Print" modal (label
    // template "Barcode siva") ~0.3 s after the response - wait for it
    if (print) {
      this.lastPrint = await this.printBarcodeLabels(print);
    } else if (await this.closePostSaveDialog()) {
      console.log('barcode: post-save print dialog closed');
    }
    const lr = this._lotSerialResp ? await Promise.race([this._lotSerialResp, new Promise((res) => setTimeout(() => res(null), 15_000))]) : null;
    if (lr) {
      const list = await lr.json().catch(() => null);
      this.lastLotTags = (Array.isArray(list) ? list : (list && list.data) || []).map((t) => t && t.tagNo).filter(Boolean);
      console.log(`barcode: the lot now holds ${this.lastLotTags.length} tag(s) ${JSON.stringify(this.lastLotTags.slice(0, 12))}`);
    }
    return body;
  }

  /**
   * The post-save "Barcode Print" dialog (Kakkanad, 14-11-2026): Label
   * Template (e.g. "Barcode siva"), Destination (the printers, e.g.
   * "\\\\192.168.1.142\\ZDesignerZD230"), Copies, and a Print button. Picks the
   * destination (substring; the first offered printer when none is given),
   * sets Copies, prints and records the print request's answer - a printer
   * the qa server cannot reach fails the print, not the barcode save - then
   * closes the dialog. Returns { shown, template, destination, copies,
   * printStatus, printBody, toasts }.
   */
  async printBarcodeLabels({ destination, copies = 1, template } = {}) {
    const dlg = this.page.locator('ngb-modal-window, .modal, [role="dialog"]').filter({ hasText: /Barcode Print/i }).locator('visible=true').last();
    if (!(await dlg.waitFor({ state: 'visible', timeout: T(10_000) }).then(() => true).catch(() => false))) {
      const tr = this._printTemplateResp ? await Promise.race([this._printTemplateResp, new Promise((res) => setTimeout(() => res(null), 5_000))]) : null;
      const tb = tr ? await tr.json().catch(() => null) : null;
      const setupGap = tr && tr.status() >= 400 && tb && tb.error ? tb.error : '';
      console.log(`barcode: no "Barcode Print" dialog after the save${tr ? ` - template lookup ${tr.status()} ${JSON.stringify(tb).slice(0, 160)}` : ''}`);
      return { shown: false, setupGap, templateStatus: tr ? tr.status() : null };
    }
    await this.settle(1_500);
    const selectAfter = (label) => dlg.locator(`xpath=.//label[normalize-space(.)="${label}"]/following::ng-select[1]`).first();
    const pickIn = async (label, want) => {
      const host = selectAfter(label);
      await host.locator('.ng-select-container').click({ timeout: T(10_000) });
      await this.settle(1_200);
      const panel = this.page.locator('.ng-dropdown-panel .ng-option');
      const opts = (await panel.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No items/i.test(t));
      const idx = want ? opts.findIndex((o) => o.toLowerCase().includes(String(want).toLowerCase())) : 0;
      if (idx < 0 || !opts.length) { await this.page.keyboard.press('Escape'); throw new Error(`Barcode Print: ${label} "${want || '(first)'}" is not offered - options ${JSON.stringify(opts)}`); }
      await panel.nth(idx).click({ timeout: T(10_000) });
      await this.settle(800);
      const got = ((await host.locator('.ng-value').first().textContent().catch(() => '')) || '').replace(/×/g, '').trim();
      console.log(`barcode print: ${label} -> "${got}" (of ${JSON.stringify(opts.slice(0, 6))})`);
      return got;
    };
    const current = async (label) => ((await selectAfter(label).locator('.ng-value').first().textContent().catch(() => '')) || '').replace(/×/g, '').trim();
    const tpl = template ? await pickIn('Label Template', template) : await current('Label Template');
    const dest = await pickIn('Destination', destination);
    const copiesBox = dlg.locator('xpath=.//label[normalize-space(.)="Copies"]/following::input[1]').first();
    await copiesBox.fill(String(copies));
    await copiesBox.blur();
    await this.settle(500);
    const copiesSet = await copiesBox.inputValue().catch(() => '');

    const printResp = this.page.waitForResponse((r) => /Print|Label/i.test(r.url()) && !/GetPrintTemplate|KeepAlive|Translation/i.test(r.url()) && ['POST', 'GET'].includes(r.request().method()), { timeout: 20_000 }).catch(() => null);
    const btn = dlg.locator('button').filter({ hasText: /Print/ }).filter({ hasNotText: /Close|Cancel/ }).locator('visible=true').last();
    await btn.click({ timeout: T(10_000) });
    const r = await printResp;
    await this.settle(2_000);
    const printBody = r ? await r.json().catch(async () => (await r.text().catch(() => '')).slice(0, 200)) : null;
    const toasts = (await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`barcode print: template "${tpl}", destination "${dest}", copies ${copiesSet} -> ${r ? `${r.status()} ${r.url().split('/sioniq/')[1]?.split('?')[0]} ${JSON.stringify(printBody).slice(0, 200)}` : 'no print request seen'}${toasts.length ? `; toasts ${JSON.stringify(toasts)}` : ''}`);
    if (await dlg.isVisible().catch(() => false)) {
      await dlg.locator('.btn-close, button:has-text("Close")').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
      await dlg.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
    }
    return { shown: true, template: tpl, destination: dest, copies: Number(copiesSet) || copiesSet, printStatus: r ? r.status() : null, printBody, toasts };
  }

  /**
   * "Multi Barcode": a checkbox beside a count box (14-11-2026). Ticked, the
   * save generates `count` tags of the entered pieces / gross weight each
   * (10 x 10 pcs / 100 g consume a 100 pcs / 1000 g lot). The checkbox sits
   * behind the usual invisible-click label; the count box is enabled once it
   * is ticked.
   */
  async setMultiBarcode(count) {
    // the control has no <label>: a checkbox and a spinbutton both named
    // "Multi Barcode" (aria snapshot 14-11-2026); the spinbutton is disabled
    // until the box is ticked
    const box = this.page.getByRole('checkbox', { name: /^\s*Multi Barcode\s*$/ }).locator('visible=true').first();
    await box.waitFor({ state: 'visible', timeout: T(10_000) });
    for (let attempt = 1; attempt <= 3 && !(await box.isChecked().catch(() => false)); attempt++) {
      await box.click({ timeout: 5_000, force: attempt > 1 }).catch(() => {});
      await this.page.waitForTimeout(400);
    }
    if (!(await box.isChecked().catch(() => false))) throw new Error('barcode: the "Multi Barcode" checkbox did not tick');
    // the count box sits beside the checkbox; its accessible name is "Multi Barcode"
    // on the Metal / Brand forms but "Count (>= 2)" on the Stone form once ticked
    const countBox = this.page.locator('xpath=//*[normalize-space(text())="Multi Barcode"]/following::input[@type="number" or @role="spinbutton"][1]').locator('visible=true').first();
    await countBox.waitFor({ state: 'visible', timeout: T(5_000) });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !(await countBox.isEnabled().catch(() => false))) await this.page.waitForTimeout(200);
    await countBox.fill(String(count));
    await countBox.blur();
    await this.settle(1_200);
    console.log(`barcode: Multi Barcode ticked, count ${await countBox.inputValue().catch(() => '?')}`);
  }


  /**
   * The tag number a save response carries (receiptNo, else the first
   * tagReferences entry) when it looks like a tag - '' otherwise, so the
   * caller falls back to the Generated Tags view.
   */
  tagNoFromSave(saved) {
    const d = (saved && saved.data) || {};
    const ref = Array.isArray(d.tagReferences) && d.tagReferences[0] ? d.tagReferences[0].tagNo : '';
    const tagNo = String(d.receiptNo || ref || '');
    return /\d{4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo) ? tagNo : '';
  }

  /** The visible ng-select of a wrapper controlname / raw formcontrolname ('' when the form has none). */
  /**
   * Every visible, enabled select on the form that still shows no value gets
   * its first offered option (skipping "No items found"). Returns
   * "controlname -> option" for the log. Used only after a silent Submit.
   */
  /** Diagnostics: label/controlname of every visible, enabled select and input that is still empty. */
  async emptyVisibleFields() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const labelOf = (el) => {
        const wrap = el.closest('[controlname]');
        const col = el.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-lg-2, .col-lg-3, .form-group, div');
        const lbl = col && col.querySelector('label');
        return (wrap && wrap.getAttribute('controlname')) || el.getAttribute('formcontrolname') || (lbl && lbl.textContent.trim()) || el.id || el.placeholder || '?';
      };
      const selects = [...document.querySelectorAll('ng-select')]
        .filter((n) => vis(n) && !n.classList.contains('ng-select-disabled') && !n.querySelector('.ng-value'))
        .map(labelOf);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([role=combobox]), textarea')]
        .filter((n) => vis(n) && !n.disabled && !n.readOnly && !String(n.value || '').trim())
        .map(labelOf);
      return { selects: [...new Set(selects)], inputs: [...new Set(inputs)] };
    }).catch(() => ({ selects: [], inputs: [] }));
  }

  async fillEmptyVisibleSelects() {
    const filled = [];
    for (let round = 0; round < 25; round++) {
      const hosts = this.page.locator('sioniq-ng-select ng-select, ng-select[formcontrolname]').locator('visible=true');
      const n = await hosts.count();
      let picked = false;
      for (let i = 0; i < n && !picked; i++) {
        const host = hosts.nth(i);
        if (await host.evaluate((el) => el.classList.contains('ng-select-disabled')).catch(() => true)) continue;
        if (await host.locator('.ng-value').count()) continue;
        const name = await host.evaluate((el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || '').catch(() => '');
        if (filled.some((f) => f.startsWith(name + ' ->'))) continue; // offered nothing last time
        await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
        await this.settle(900);
        const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i }).first();
        if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
          const label = ((await opt.textContent()) || '').trim();
          await opt.click({ timeout: 3_000 }).catch(() => {});
          filled.push(`${name} -> ${label}`);
          picked = true;
          await this.settle(800);
        } else {
          filled.push(`${name} -> (nothing offered)`);
          await this.page.keyboard.press('Escape').catch(() => {});
          picked = true;
        }
      }
      if (!picked) break;
    }
    return filled.filter((f) => !/\(nothing offered\)$/.test(f));
  }

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
    // counter: null = leave the Counter EMPTY on purpose. Counter Allocation
    // (Sales & Distribution > Transfer In & Out) only offers lots whose tags
    // are not in a counter yet (GetEligibleLotsByPagination, 23-10-2026), so
    // the chains that allocate afterwards must not pre-assign one here.
    if (wantCounter === null) { console.log('barcode: Counter left empty on purpose (the chain allocates it later)'); return; }
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
      // 22-10-2026: Kakkanad's only counter ("Gold Counter") has no sub
      // counter configured - submit anyway; the app's own refusal (if the
      // sub counter is mandatory there too) is reported by generateTag.
      if (!(await pickSub(wantSub, labels[i]))) console.log(`barcode: Counter "${labels[i]}" offers no Sub Counter - submitting without one`);
      return;
    }

    // no name given: a known Order-type counter when offered ("Chain Counter
    // KKD" at Kakkanad, "Counter 1" at Cochin), else the first one. The Sub
    // Counter is NOT mandatory (QA lead 23-10-2026) - it is picked only when
    // the chosen counter offers one.
    const preferred = labels.findIndex((l) => /Chain Counter KKD|^Counter 1$/i.test(l.trim()));
    const i = preferred >= 0 ? preferred : 0;
    await options.nth(i).click();
    await this.settle(1_500);
    console.log(`barcode: Counter was empty - picked "${labels[i]}"`);
    if (!(await pickSub(null, labels[i]))) console.log(`barcode: counter "${labels[i]}" offers no Sub Counter (not mandatory) - continuing`);
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
    await this.closeVisibleDialog(); // a lingering post-save print dialog would swallow the click
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
