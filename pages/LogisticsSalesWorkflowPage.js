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
  /**
   * Cascade select by controlname: the wanted option (substring match) when
   * given, else keep a back-filled value, else the first offered option.
   * Logs the choice. Returns the picked label ('' when nothing offered).
   */
  async pickOrFirst(controlname, wanted) {
    const host = this.select(controlname);
    if (!(await host.isVisible({ timeout: 5_000 }).catch(() => false))) { console.log(`${controlname}: not on the form - skipped`); return ''; }
    const current = ((await host.locator('.ng-value-label').first().textContent({ timeout: 500 }).catch(() => '')) || '').trim();
    if (current && (!wanted || current.toLowerCase().includes(String(wanted).toLowerCase()))) { console.log(`${controlname}: keeps "${current}"`); return current; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await this.page.keyboard.press('Escape');
      await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      if (await opts.first().waitFor({ state: 'visible', timeout: attempt * 3_000 }).then(() => true).catch(() => false)) {
        const labels = (await opts.allTextContents()).map((t) => t.trim());
        let idx = wanted ? labels.findIndex((l) => l.toLowerCase() === String(wanted).toLowerCase()) : -1;
        if (idx < 0 && wanted) idx = labels.findIndex((l) => l.toLowerCase().includes(String(wanted).toLowerCase()));
        if (idx < 0) idx = 0;
        await opts.nth(idx).click();
        console.log(`${controlname} -> ${labels[idx]}${wanted && !labels[idx].toLowerCase().includes(String(wanted).toLowerCase()) ? ` (wanted "${wanted}" not offered)` : ''} (of ${JSON.stringify(labels.slice(0, 8))})`);
        await this.waitForIdle();
        await this.settle(1_200);
        return labels[idx];
      }
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    console.log(`${controlname}: offered no option`);
    return '';
  }

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
        if (ok && !/No items found/i.test((await options.first().textContent({ timeout: 2_000 }).catch(() => '')) || '')) {
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
    await this.settle(1_500);
    const close = dlg.locator('button[data-role="close-tare"]');
    if (await close.isVisible({ timeout: 3_000 }).catch(() => false)) await close.click();
    else await dlg.locator('button').filter({ hasText: /^\s*Close\s*$/ }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await this.settle(1_000);
  }

  /**
   * Logistics Inward: one flat form. Logistic/Invoice/Tracking numbers must
   * be dynamic. Metal Group/Category/Purity render after Material Type.
   */
  async logisticsInward({ logisticVendor, logisticNo, vendor, invoiceNo, trackingNo, receivedDate, materialType = 'Metal', grossWithSeal, quantity, grossAsInvoice, stoneAsInvoice, metalGroup = 'Gold', metalCategory = 'Ring', purity = '91.60', stoneGroup, stoneCategory, stoneSubCategory, invoiceAmount, receivedBy, paymentStatus = 'Paid' }) {
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
    if (materialType === 'Stone') {
      // Stone (26-09-2026 probe): Stone Group / Category / Sub Category
      // cascade + stone weights (stonegrswtseal / stoneqntwtinv /
      // stonegrswtinv) replace the metal block
      await this.waitForIdle();
      await this.settle(1_500);
      await this.pickOrFirst('stonegroup', stoneGroup);
      await this.pickOrFirst('stonecategory', stoneCategory);
      await this.pickOrFirst('stonesubcategory', stoneSubCategory);
      for (const [ctl, val] of [['stonegrswtseal', grossWithSeal], ['stoneqntwtinv', quantity], ['stonegrswtinv', grossAsInvoice]]) {
        if (val === undefined) continue;
        // plain inputs carrying formcontrolname (no app-sioniq-input wrapper)
        const input = this.page.locator(`input[formcontrolname="${ctl}"]`).or(this.inputCtl(ctl)).first();
        await input.fill(String(val));
        await input.blur();
      }
    } else {
      await this.fillByCaption('Gross Weight with Seal', grossWithSeal);
      await this.fillByCaption('Quantity as per Invoice', quantity);
      await this.fillByCaption('Gross Weight as per Invoice', grossAsInvoice);
      await this.fillByCaption('Stone Weight as per Invoice', stoneAsInvoice);

      await this.pickTolerant('Metal Group', metalGroup, { exact: true });
      await this.pickTolerant('Metal Category', metalCategory, { exact: true });
      await this.pickTolerant('Metal Purity', purity);
    }
    await this.fillByCaption('Invoice Amount', invoiceAmount);
    await this.pick('receivedBy', receivedBy);
    await this.pick('paymentStatus', paymentStatus, { exact: true });

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Goods Receipt. Generation Type "Logistic Inward" receives against a
   * logistics RC (logistic vendor + RC picks); "Direct" (user screenshot,
   * 16-09-2026) is a standalone receipt with a free-text Description and
   * manual metal picks. Tare goes in through the "+" Tare Weight dialog;
   * Gross = with-tare - tare, Net = Gross - Stone Weight, both calculated.
   */
  async goodsReceipt({ vendor, generationType = 'Logistic Inward', logisticVendor, logisticRcNo, materialType = 'Metal', description, metalGroup = 'Gold', metalCategory = 'Ring', purity = '91.60', stoneGroup, stoneCategory, stoneSubCategory, quantity, grossWithTare, tareWeight, stoneWeight }) {
    await this.goto('/prc/view-goods-receipt');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pick('vendor', vendor);
    await this.pick('generationType', generationType, { exact: true });
    if (generationType === 'Logistic Inward') {
      await this.pickTolerant('Logistic vendor', logisticVendor, { exact: true });
      await this.pickTolerant('Logistic vendor Rc No', this.docCore(logisticRcNo));
    }
    await this.pick('materialtype', materialType, { exact: true });
    if (description !== undefined) await this.fillByCaption('Description', description);
    await this.waitForIdle();
    await this.settle(2_000);

    if (materialType === 'Stone') {
      // Stone (26-09-2026 probe): Stone Group Category / Category / Sub
      // Category (may back-fill from the logistics record), Quantity, Gross
      // Weight with Tare - no purity / stone-weight fields
      await this.pickOrFirst('stoneGroupCategory', stoneGroup);
      await this.pickOrFirst('stoneCategory', stoneCategory);
      await this.pickOrFirst('stoneSubcategory', stoneSubCategory);
    } else {
      // these may back-fill from the logistics record - pick only when empty
      for (const [label, val] of [['Metal Group Category', metalGroup], ['Metal Category', metalCategory], ['Purity', purity]]) {
        await this.pickTolerant(label, val).catch((e) => console.log(`goods receipt: ${label} pick skipped -`, String(e).slice(0, 80)));
      }
    }

    await this.fillByCaption('Quantity', quantity);
    await this.fillByCaption('Gross Weight with Tare Weight', grossWithTare);
    if (tareWeight !== undefined) await this.addTareViaDialog(tareWeight);
    if (stoneWeight !== undefined) {
      const stone = this.inputCtl('stoneWeight');
      if (await stone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await stone.fill(String(stoneWeight));
        await stone.blur();
      } else {
        await this.fillByCaption('Stone Weight', stoneWeight);
      }
    }
    console.log('goods receipt weights: gross', await this.inputCtl('grossWeight').inputValue({ timeout: 2_000 }).catch(() => '?'),
      'net', await this.inputCtl('netWeight').inputValue({ timeout: 2_000 }).catch(() => '?'));

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * Counter Allocation: filters + a scan field - scan the barcode TAG,
   * Enter stages it, Add commits it, Submit saves.
   */
  /**
   * TAG NUMBERS ARE NOT UNIQUE on qa (23-09-2026): the barcode day-series
   * restarts because the app's business date is pinned (23/06/2026), so a
   * tag-number scan resolves the FIRST stock item carrying that number -
   * on 23-09 the allocation moved an older 122 g "2026-06-2300002" while
   * the chain's 10 g tag stayed in stock. With lotNo the form fetches by
   * LOT (Scan Type "Lot Number") instead, and the scan answer's RFID
   * (unique) is kept in this.lastScan for the later tag-wise screens.
   */
  /**
   * Pick an option from a VIRTUAL-SCROLLED multi select whose search box
   * filters nothing (the lotNos list of Counter Allocation: only ~12 rows
   * are rendered, typing shows one blank row): scroll the panel in steps
   * until the option containing `text` is rendered, click it, close.
   */
  async pickVirtualOption(controlname, text) {
    const host = this.select(controlname);
    if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await this.page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 5_000 });
    const panel = this.page.locator('.ng-dropdown-panel').last();
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
    const scroller = panel.locator('.ng-dropdown-panel-items');
    let lastTop = -1;
    for (let step = 0; step < 60; step++) {
      const opt = panel.locator('.ng-option').filter({ hasText: String(text) }).first();
      if (await opt.isVisible({ timeout: 400 }).catch(() => false)) {
        const label = ((await opt.textContent()) || '').replace(/\s+/g, ' ').trim();
        await opt.click();
        console.log(`${controlname} -> ${label}`);
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.settle(1_000);
        return label;
      }
      const top = await scroller.evaluate((el) => { el.scrollTop += 160; return el.scrollTop; }).catch(() => -1);
      await this.page.waitForTimeout(250);
      if (top === lastTop) break; // bottom reached
      lastTop = top;
    }
    const seen = (await panel.locator('.ng-option').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
    await this.page.keyboard.press('Escape').catch(() => {});
    throw new Error(`select "${controlname}" never rendered an option containing "${text}" (last rendered: ${JSON.stringify(seen.slice(-8))})`);
  }

  async counterAllocation({ itemType = 'Metal', groupCategory = 'Gold', tagNo, lotNo, rfidNo, vendor = 'RAJA' }) {
    await this.goto('/sls/view-counter-allocation');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    this.lastScan = null;
    this.lastScans = []; // every tag the lot fetch answered with (a 2-piece lot has 2 tags)
    const onScan = async (r) => {
      if (!/CounterAllocation\/(Scan|Fetch|Get)/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
      const body = await r.json().catch(() => null);
      const items = Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : body ? [body] : [];
      for (const i of items) {
        if (i && i.tagNo && !this.lastScans.some((t) => t.tagNo === i.tagNo)) {
          this.lastScans.push({ tagNo: i.tagNo, rfidNo: i.rfidNo || '', lotNo: i.lotNo || '', gross: Number(i.grossWeightTran || 0) });
        }
      }
      const mine = items.find((i) => i && i.tagNo === tagNo) || (items.length === 1 ? items[0] : null);
      if (mine && mine.tagNo) this.lastScan = { tagNo: mine.tagNo, rfidNo: mine.rfidNo || '', lotNo: mine.lotNo || '', gross: Number(mine.grossWeightTran || 0) };
    };
    this.page.on('response', onScan);

    await this.pick('masterDataValueID_JewelleryItemType', itemType);
    // Group Category is a Metal-item filter; other item types (Brand /
    // Stone) may render it differently or not at all - never fatal
    if (/metal/i.test(itemType)) await this.pick('groupCategoryMetalIDs', groupCategory, { closePanel: true })
      .catch((e) => console.log(`counter allocation: group category pick skipped for ${itemType} (${String(e).split('\n')[0].slice(0, 120)})`));
    if (rfidNo) {
      // stock that came BACK (approval receipt) is a new ledger item the lot
      // list no longer offers - its RFID is the unique key then
      await this.pickPreferred('masterDataValueID_ScanType', /rfid/i);
    } else if (lotNo) {
      await this.pickPreferred('masterDataValueID_ScanType', /lot/i);
    } else {
      // Scan Type: whatever the first real option is (tag scanning)
      await this.pickFirstOption('masterDataValueID_ScanType');
    }

    if (!rfidNo && lotNo) {
      // Scan Type "Lot Number" swaps the scan field for Vendor + Lot Number
      // selects and a "Fetch Items" button (23-09-2026)
      await this.settle(1_200);
      // vendorIDs / lotNos are MULTI selects ("Select at least one Lot Number")
      // typing into these multi selects filters nothing (the panel goes blank) - plain option clicks
      await this.pick('vendorIDs', vendor, { exact: true, closePanel: true });
      await this.pickVirtualOption('lotNos', lotNo); // virtual-scrolled, search filters nothing
      await this.page.getByRole('button', { name: /Fetch Items/i }).locator('visible=true').last().click();
    } else {
      const scan = this.page.getByPlaceholder('Scan / type then press Enter');
      await scan.fill(rfidNo || tagNo);
      await scan.press('Enter');
    }
    await this.waitForIdle();
    await this.settle(2_500);
    this.page.off('response', onScan);
    if (!tagNo && lotNo) {
      // the barcode step could not report the tag (e.g. the lot was already
      // tagged by an earlier run) - the lot fetch names it
      tagNo = (this.lastScan && this.lastScan.tagNo) || (this.lastScans[0] && this.lastScans[0].tagNo) || '';
      if (tagNo) console.log(`counter allocation: tag ${tagNo} taken from the lot fetch`);
    }
    const staged = this.rowMatcher(tagNo || lotNo);
    if (!(await staged.first().isVisible({ timeout: 10_000 }).catch(() => false))) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []);
      throw new Error(`counter allocation: tag ${tagNo} was not staged (${lotNo ? 'lot ' + lotNo : 'tag scan'}). Toasts: ${JSON.stringify(toasts)}`);
    }
    console.log(`counter allocation: staged ${(await staged.first().innerText()).replace(/\s+/g, ' ').slice(0, 140)}${this.lastScan ? ' | rfid ' + this.lastScan.rfidNo : ''}`);

    const add = this.page.locator('button').filter({ hasText: /^\s*Add\s*$/ }).locator('visible=true').last();
    if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await add.click();
      await this.settle(1_500);
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
      const label = ok ? ((await opt.textContent({ timeout: 2_000 }).catch(() => '')) || '').trim() : '';
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
  /** optional: true returns { skipped: true } when nothing is pending for the tag (a 'Return to Counter' transfer lands approved, with no acceptance step). */
  async counterAccept({ itemType = 'Metal', tagNo, rfidNo, tags, optional = false }) {
    await this.goto('/sls/view-counter-accept-reject');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    // Item Type: by controlname when the form carries it (as Counter
    // Allocation does), else by its "Item Type" caption. The old first try,
    // caption "Item Type *", never matched (the asterisk is a separate
    // element) and ran its four timed-out retries before the fallback
    // (26-09-2026: the reported slowness)
    const itemTypeHost = this.select('masterDataValueID_JewelleryItemType');
    if (await itemTypeHost.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    } else {
      await this.pickTolerant('Item Type', itemType, { exact: true });
    }
    await this.waitForIdle();
    await this.settle(2_500);

    // tag numbers repeat on qa - the RFID row wins when the grid shows it
    const key = rfidNo && (await this.rowMatcher(rfidNo).count()) ? rfidNo : tagNo;
    if (optional && !(await this.rowMatcher(key).first().isVisible({ timeout: 15_000 }).catch(() => false))) {
      console.log('counter accept: nothing pending for ' + key + ' - the transfer landed without an acceptance step');
      return { skipped: true };
    }
    await this.checkRow(key);
    // further tags of the same allocation (a 2-piece lot) - tick their rows too
    for (const t of (tags || []).filter((x) => x && x.tagNo !== tagNo)) {
      const k = t.rfidNo && (await this.rowMatcher(t.rfidNo).count()) ? t.rfidNo : t.tagNo;
      await this.checkRow(k);
    }
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: /Accept/ }).locator('visible=true').last());
    await this.previewAndClose();
    return body;
  }

  /**
   * Purchase Return (/prc/view-purchase-return, probed 03-09-2026): six
   * header selects (itemType/returnMode/subTransactionType/returnType/
   * vendor/stockSourceType), then the return stock - a tag scan or a grid
   * depending on the source type. Preferences target the tag-wise return
   * of a barcoded purchase; every option list is logged.
   */
  async purchaseReturn({ itemType = 'Metal', vendor, tagNo, inwardNo, sourceType }) {
    await this.goto('/prc/view-purchase-return');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pickPreferred('itemType', new RegExp(itemType, 'i'));
    await this.pickPreferred('returnMode', /confirmed/i); // [Confirmed, Provisional]
    await this.pickPreferred('subTransactionType', /invoice/i); // [GRN, Invoice]
    await this.pickPreferred('returnType', /original/i); // [Different Vendor, Original Vendor]
    await this.pick('vendor', vendor);
    // [Approval, Inward, Provisional, TagWise, Locker] - TagWise returns a
    // barcoded tag, Inward returns the metal inward directly
    const source = sourceType || (tagNo ? 'TagWise' : 'Inward');
    await this.pickPreferred('stockSourceType', new RegExp(`^${source}$`, 'i'));
    await this.waitForIdle();
    await this.settle(2_000);

    const key = tagNo || inwardNo;
    if (tagNo) {
      // Scan Type = Tag Number (QA lead) reveals the scan field
      await this.pick('scanType', 'Tag Number')
        .catch(() => this.pickTolerant('Scan Type', 'Tag Number', { exact: true }))
        .catch(() => this.pickPreferred('masterDataValueID_ScanType', /tag/i));
      await this.waitForIdle();
      await this.settle(2_500);

      const tagField = this.inputByCaption('Tag Number');
      const scanField = this.page.getByPlaceholder(/Scan/i).locator('visible=true').last();
      if (await tagField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await tagField.fill(tagNo);
        const add = this.page.locator('button').filter({ hasText: /Add/ })
          .filter({ hasNotText: /Files|Selected|Charges/ }).locator('visible=true').last();
        if (await add.isVisible({ timeout: 3_000 }).catch(() => false)) await add.click();
        else await tagField.press('Enter');
        await this.settle(2_000);
      } else if (await scanField.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await scanField.fill(tagNo);
        await scanField.press('Enter');
        await this.settle(2_000);
      } else {
        await this.checkRow(tagNo);
      }
    } else {
      // Inward source: From Transaction Type (Metal Inward) + an RC No
      // select for the inward, then the rows land in Return Items
      await this.fillEmptySelects(['Metal Inward']);
      await this.waitForIdle();
      await this.settle(1_500);
      // the RC No list is a typeahead - search the inward's number
      await this.pickByCaption('RC No', this.docCore(inwardNo), { exact: false, search: true });
      await this.waitForIdle();
      await this.settle(2_500);
      await this.checkRow(inwardNo).catch(() => {});
      const add = this.page.locator('button').filter({ hasText: /Add/ })
        .filter({ hasNotText: /Files|Selected|Charges/ }).locator('visible=true').last();
      if (await add.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await add.click();
        await this.settle(2_000);
        console.log('purchase return: inward committed via Add');
      }
    }
    // the returned stock's row must be present (staged) before Submit
    const row = this.rowMatcher(this.docCore(key)).last();
    if (await row.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const box = row.getByRole('checkbox').first();
      if (!(await box.isChecked({ timeout: 2_000 }).catch(() => true))) await box.check({ force: true, timeout: 3_000 }).catch(() => {});
      console.log('purchase return: row staged');
    } else {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []);
      throw new Error(`"${key}" never appeared on the purchase return. Toasts: ${JSON.stringify(toasts)}`);
    }

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * B2B Metal Sales Invoice: /sls/app-invoice-setup, own tab. Scan the tag,
   * Add, Submit.
   */
  /**
   * approvalRcNo switches the invoice to Issue Type "Approval RC No" (probed
   * 24-09-2026): the "Approval RC No" select lists only approvals whose tags
   * are still OUT at the customer (a received tag is gone from it), picking
   * one loads its issued tags, the tag's row is ticked and "Add Selected"
   * stages it. Straight counter sales (Tag Wise) scan the tag instead.
   */
  async b2bSalesInvoice({ customer, salesman, tagNo, rfidNo, approvalRcNo, subType = 'Invoice' }) {
    await this.goto('/sls/app-invoice-setup');
    await this.waitForIdle();
    // the B2B module lazy-loads - wait for the tab (named "Metal Invoice" since
    // Sept 2026, "B2B Metal Sales Invoice" before), then fall back to the
    // nav search route the probe used
    let tab = this.page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ })
      .or(this.page.getByRole('button', { name: /^(B2B )?Metal (Sales )?Invoice$/ })).first();
    if (!(await tab.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false))) {
      const search = this.page.getByRole('combobox', { name: 'Search' });
      await search.click();
      await search.fill('invoice');
      await this.settle(2_500);
      await search.press('ArrowDown');
      await search.press('Enter');
      await this.waitForIdle();
      tab = this.page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ })
        .or(this.page.getByRole('button', { name: /^(B2B )?Metal (Sales )?Invoice$/ })).first();
      await tab.waitFor({ state: 'visible', timeout: 30_000 });
    }
    await tab.click();
    await this.waitForIdle();
    await this.settle(1_500);
    await this.clickVisibleAdd();

    // Transaction Sub Type: Invoice (priced sale) | GRN (goods sent on GRN
    // terms, priced later) | JobWork
    await this.pickPreferred('transactionSubTypeID', new RegExp(`^${subType}$`, 'i'));
    await this.pick('b2BCustomerID', customer);
    // Customer Branch gates the tag scan - pick the customer's branch. One
    // open of the list, preferring the customer's own branch ("RAJA KOCHI
    // BRANCH"): the old exact "BRANCH" match never hit and burnt ~1 min of
    // retries before the fallback picked it (26-09-2026)
    const esc = String(customer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await this.pickFirstByCaption('Customer Branch', new RegExp(`${esc}|branch`, 'i'))
      .catch((e) => console.log(`customer branch: no option picked (${String(e).split('\n')[0]})`));
    if (salesman) await this.pick('salesmanIDs', salesman, { closePanel: true }).catch(() => {});
    await this.pickPreferred('masterDataValueID_StockSourceFrom', /counter/i).catch(() => {});
    if (approvalRcNo) {
      await this.pick('masterDataValueID_InvoiceIssueType', 'Approval RC No', { exact: true });
      await this.waitForIdle();
      await this.settle(2_000);
      await this.pickVirtualOption('approvalRCNos', approvalRcNo);
      await this.waitForIdle();
      await this.settle(3_000);
      const issued = (rfidNo ? this.rowMatcher(rfidNo).or(this.rowMatcher(tagNo)) : this.rowMatcher(tagNo)).first();
      if (!(await issued.isVisible({ timeout: 20_000 }).catch(() => false))) {
        const rows = await this.page.locator('tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
        throw new Error(`invoice: RC ${approvalRcNo} lists no issued row for tag ${tagNo} - rows: ${JSON.stringify(rows.map((t) => t.replace(/\s+/g, ' ').slice(0, 120)).slice(0, 6))}`);
      }
      const box = issued.getByRole('checkbox').first();
      if (await box.count()) await box.check({ force: true }).catch(() => issued.click());
      else await issued.click();
      await this.settle(800);
      await this.page.getByRole('button', { name: /Add Selected/i }).locator('visible=true').last().click();
      await this.waitForIdle();
      await this.settle(2_500);
      // Add Selected MOVES the row from the issued grid into the invoice grid,
      // whose "No tags transferred yet" placeholder disappears
      const bodyText = await this.page.evaluate(() => document.body.innerText);
      const staged = !/No tags transferred yet/i.test(bodyText) && (await this.rowMatcher(tagNo).count()) >= 1;
      if (!staged) {
        const toasts = await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []);
        throw new Error(`invoice: "Add Selected" staged nothing for tag ${tagNo}. Toasts: ${JSON.stringify(toasts)}`);
      }
      console.log(`sales invoice: tag ${tagNo} staged from approval RC ${approvalRcNo}`);
      await this.fillMetalRateIfEmpty(6000);
      const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
      await this.previewAndClose();
      return (body && body.data && (body.data.receiptNo || body.data.invoiceNo || body.data.docNo)) || '';
    }
    // "Approval RC No" switches the form to approval-sourced mode - a
    // straight counter sale needs a non-approval issue type
    await this.pickPreferred('masterDataValueID_InvoiceIssueType', /direct|tag|counter/i, /approval/i).catch(() => {});
    // tag numbers repeat on qa (23-09-2026) - scan the unique RFID when known
    await this.pickPreferred('masterDataValueID_ScanType', rfidNo ? /rfid/i : /tag/i).catch(() => {});
    await this.waitForIdle();
    await this.settle(1_500);

    // the scan field is captioned "Tag Number" (or "Rfid Number"). Since
    // Sept 2026 Enter (or the field's trailing icon button) commits the
    // scan - the old "+ Add" text button is gone; press it only when present
    const scanValue = rfidNo || tagNo;
    let scan = this.inputByCaption('Tag Number');
    if (!(await scan.count())) scan = this.page.locator('input[formcontrolname="scanInput"], input#scanInput, input[placeholder*="Scan" i]').locator('visible=true').first();
    await scan.fill(scanValue);
    if ((await scan.inputValue()) !== scanValue) {
      throw new Error(`tag number did not land in the scan field (holds "${await scan.inputValue()}")`);
    }
    await scan.press('Enter');
    await this.waitForIdle();
    await this.settle(2_500);
    const scanned = this.rowMatcher(tagNo).or(rfidNo ? this.rowMatcher(rfidNo) : this.rowMatcher(tagNo)).last();
    if (!(await scanned.isVisible({ timeout: 3_000 }).catch(() => false))) {
      const add = this.page.locator('button').filter({ hasText: /Add/ })
        .filter({ hasNotText: /Files|Selected|Charges/ })
        .locator('visible=true').last();
      if (await add.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await add.click();
        await this.waitForIdle();
        await this.settle(2_500);
      }
    }

    // proof the tag actually staged - surface the app's toast if it did not
    if (!(await scanned.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container')
        .allTextContents().catch(() => []);
      throw new Error(`tag "${tagNo}" never appeared in Scanned Tags. Toasts: ${JSON.stringify(toasts)}`);
    }
    console.log('sales invoice: tag scanned into the grid');
    const box = scanned.getByRole('checkbox').first();
    if ((await box.count()) && !(await box.isChecked({ timeout: 2_000 }).catch(() => true))) await box.check({ force: true, timeout: 3_000 }).catch(() => {});
    await this.fillMetalRateIfEmpty(6000); // same "Metal weight" strip as the approval forms
    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.invoiceNo || body.data.docNo)) || '';
  }

  // ---------- Counter Transfer: Default Stock Accept Counter -> counter ----------

  /**
   * Stock that comes BACK from an approval (Approval Receipt, "Receipt To"
   * Stock) lands in the location's "Default Stock Accept Counter" (probed
   * 23-09-2026): Counter Allocation refuses it ("Tag / RFID not found or
   * not eligible") and the invoice refuses it ("not in Counter stock").
   * Counter Transfer (/sls/view-counter-transfer) with Counter Category
   * "Default Stock Accept Counter" lists those tags with a "Tag Number
   * (locate in grid)" scan, a "Select" button and "Return to Counter";
   * after that the tag waits in Counter Accept. Returns the save body.
   */
  async returnToCounter({ tagNo }) {
    await this.goto('/sls/view-counter-transfer');
    await this.waitForIdle();
    await this.clickVisibleAdd();
    await this.pick('from_MasterDataValueID_CounterCategory', 'Default Stock Accept Counter', { exact: true });
    await this.waitForIdle();
    await this.settle(2_500);

    const row = this.rowMatcher(tagNo).last();
    if (!(await row.isVisible({ timeout: 15_000 }).catch(() => false))) {
      const rows = await this.page.locator('tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
      throw new Error(`counter transfer: tag ${tagNo} is not on the Default Stock Accept Counter - rows: ${JSON.stringify(rows.map((t) => t.replace(/\s+/g, ' ').slice(0, 100)).slice(0, 8))}`);
    }
    // locate + select the row: the "locate in grid" scan, then the row's
    // checkbox when it has one (else a click on the row), then "Select"
    const scan = this.page.locator('input[formcontrolname="scanInput"], input#scanInput, input[placeholder*="Scan" i]').locator('visible=true').first();
    if (await scan.count()) {
      await scan.fill(tagNo);
      await scan.press('Enter');
      await this.settle(1_500);
    }
    const box = row.getByRole('checkbox').first();
    if (await box.count()) {
      if (!(await box.isChecked({ timeout: 1_000 }).catch(() => false))) await box.check({ force: true }).catch(() => {});
    } else {
      await row.click().catch(() => {});
    }
    await this.settle(800);
    const select = this.page.getByRole('button', { name: /^Select$/ }).locator('visible=true').last();
    if (await select.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await select.click();
      await this.settle(1_500);
    }
    const stagedInfo = await this.page.evaluate((tag) => {
      const vis = (n) => !!n.offsetParent;
      return {
        headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30),
        toasts: [...document.querySelectorAll('.toast, .toast-message, [role=alert]')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)).filter((t) => t.includes(tag)).slice(0, 4),
      };
    }, tagNo);
    console.log(`counter transfer: after select ${JSON.stringify(stagedInfo)}`);

    // "Return to Counter" submits; answer a confirm dialog when one appears
    const resp = this.page.waitForResponse((r) => ['POST', 'PUT'].includes(r.request().method()) && /CounterTransfer|Return/i.test(r.url()) && !/GetCounterStockTags|Pagination|GetAll/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
    await this.page.getByRole('button', { name: /Return to Counter/i }).locator('visible=true').last().click();
    for (let i = 0; i < 10; i++) {
      await this.page.waitForTimeout(800);
      const yes = this.page.locator('.swal2-popup button, .modal.show button, ngb-modal-window button, [role="dialog"] button').locator('visible=true').filter({ hasText: /^(Yes|OK|Confirm|Proceed|Return|Submit)/i }).last();
      if (await yes.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`counter transfer: confirming with "${((await yes.textContent()) || '').trim()}"`);
        await yes.click().catch(() => {});
      }
    }
    const r = await resp;
    if (!r) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => []);
      throw new Error(`counter transfer: Return to Counter fired no save. Toasts: ${JSON.stringify(toasts)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('counter transfer save:', r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 250));
    if (r.status() >= 400 || (body && body.errorCode)) throw new Error(`counter transfer rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    await this.previewAndClose();
    return body;
  }

  // ---------- B2B Approval Issue / Approval Receipt (Sales & Distribution) ----------

  /**
   * The "Metal weight" strip under the scanned tags carries a "Rate (₹/gm)"
   * number input that stays 0 after the scan; Submit then only flashes
   * "Input required - Please enter the metal rate." for 4 s and fires no
   * save (23-09-2026). Enter the rate into every such input still at 0.
   */
  async fillMetalRateIfEmpty(rate) {
    const inputs = this.page.locator('xpath=//*[contains(normalize-space(text()), "Rate (") and contains(normalize-space(text()), "/gm")]/following::input[1]').locator('visible=true');
    const n = await inputs.count();
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      if (await input.isDisabled().catch(() => true)) continue;
      const current = Number((await input.inputValue().catch(() => '')) || 0);
      if (current > 0) continue;
      await input.fill(String(rate));
      await input.blur();
      filled++;
    }
    if (filled) {
      await this.waitForIdle();
      await this.settle(1_500);
      console.log(`metal rate: entered ${rate} into ${filled} empty Rate (₹/gm) input(s)`);
    }
    return filled;
  }

  /**
   * The ng-select right after a plain-text caption (these forms caption
   * with text nodes, not labels): pick the option matching `prefer`, else
   * the first offered. With { optional: true } an absent select is skipped.
   */
  async pickFirstByCaption(caption, prefer, { optional = false } = {}) {
    const host = this.page.locator(`xpath=//*[normalize-space(text())="${caption}"]/following::ng-select[1]`).first();
    if (!(await host.waitFor({ state: 'visible', timeout: optional ? 3_000 : 15_000 }).then(() => true).catch(() => false))) {
      if (optional) { console.log(`${caption}: no select offered - skipped`); return ''; }
      throw new Error(`select "${caption}" not found`);
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await this.page.keyboard.press('Escape');
      await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      if (await opts.first().waitFor({ state: 'visible', timeout: attempt * 3_000 }).then(() => true).catch(() => false)) {
        const labels = (await opts.allTextContents()).map((t) => t.trim());
        let idx = prefer ? labels.findIndex((l) => prefer.test(l)) : -1;
        if (idx < 0) idx = 0;
        await opts.nth(idx).click();
        console.log(`${caption} -> ${labels[idx]} (of ${JSON.stringify(labels.slice(0, 6))})`);
        await this.settle(1_000);
        return labels[idx];
      }
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    if (optional) { console.log(`${caption}: offered no option - skipped`); return ''; }
    throw new Error(`select "${caption}" never offered an option`);
  }

  /**
   * Scan a tag into the form's "Tag Number" scan field (scanInput): fill +
   * Enter stages the tag as a grid line on the approval forms; when Enter
   * stages nothing a visible "+ Add" button is pressed as well. Fails with
   * the app's toasts when the tag never lands in a grid.
   */
  async scanTag(tagNo, what, { rfidNo } = {}) {
    const scan = this.page.locator('input[formcontrolname="scanInput"], input#scanInput, input[placeholder*="Scan" i]').locator('visible=true').first();
    await scan.waitFor({ state: 'visible', timeout: 15_000 });
    await scan.fill(rfidNo || tagNo); // the RFID is unique, the tag number is not (qa, 23-09-2026)
    await scan.press('Enter');
    await this.waitForIdle();
    await this.settle(2_500);
    const row = (rfidNo ? this.rowMatcher(rfidNo).or(this.rowMatcher(tagNo)) : this.rowMatcher(tagNo)).last();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
      const add = this.page.locator('button').filter({ hasText: /^\s*\+?\s*Add\s*$/ }).locator('visible=true').last();
      if (await add.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await add.click();
        await this.settle(2_000);
      }
    }
    if (!(await row.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => []);
      throw new Error(`${what}: tag "${tagNo}" never appeared in the grid. Toasts: ${JSON.stringify(toasts)}`);
    }
    console.log(`${what}: tag ${tagNo} staged`);
  }

  /**
   * B2B Approval Issue (/sls/view-b2b-approval-issue, probed 23-09-2026) -
   * stock goes out to a customer on approval. Issue From "Stock" + Issue To
   * "Customer" reveal the Customer select; Purpose / Salesman / Helper /
   * Supervisor are mandatory; Stock Source "Counter" + Issue Type "Tag
   * Wise" reveal Scan Type and the "Tag Number" scan field (Enter stages
   * the tag - the form has no Add button). Returns the RC number.
   */
  async approvalIssue({ customer, purpose = 'Display', salesman, helper, supervisor, tagNo, rfidNo, tags, metalRate = 6000 }) {
    await this.goto('/sls/view-b2b-approval-issue');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    await this.pick('masterDataValueID_ApprovalIssueFrom', 'Stock', { exact: true });
    await this.pick('masterDataValueID_ApprovalIssueTo', 'Customer', { exact: true });
    await this.settle(1_500); // the Customer select renders after Issue To
    await this.pick('masterDataValueID_ApprovalIssuePurpose', purpose, { exact: true });
    await this.pick('b2BCustomerID', customer, { search: true });
    await this.settle(1_200); // Customer Branch (+ Credit Days / Due Date) render after the customer
    // the branch scopes the tag lookup - the same gate as the B2B invoice:
    // while it is empty the scan answers "Tag not found or not eligible for
    // the selected source document" (first run, 23-09-2026)
    await this.pickFirstByCaption('Customer Branch', /branch/i);
    await this.pick('salesmanIDs', salesman, { search: true, closePanel: true });
    await this.pick('helperID', helper, { search: true });
    await this.pick('supervisorID', supervisor, { search: true });
    await this.pick('masterDataValueID_StockSourceFrom', 'Counter', { exact: true });
    await this.pick('masterDataValueID_ApprovalIssueType', 'Tag Wise', { exact: true });
    await this.waitForIdle();
    await this.settle(1_500); // Scan Type + Tag Number render after the type
    if (rfidNo) {
      await this.pickPreferred('masterDataValueID_ScanType', /rfid/i).catch(() => {});
    } else if (!(await this.selectValue('masterDataValueID_ScanType').catch(() => ''))) {
      await this.pickPreferred('masterDataValueID_ScanType', /tag/i).catch(() => {});
    }
    await this.scanTag(tagNo, 'approval issue', { rfidNo });
    // the other tags of the piece (a 2-piece lot goes out on ONE approval)
    for (const t of (tags || []).filter((x) => x && x.tagNo !== tagNo)) {
      await this.scanTag(t.tagNo, 'approval issue', { rfidNo: t.rfidNo });
    }
    await this.fillMetalRateIfEmpty(metalRate);

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }

  /**
   * B2B Approval Receipt (/sls/view-approval-receipt, probed 23-09-2026) -
   * the approval stock comes back from the customer into stock. Receipt
   * Type "Direct", Receipt From "Customer", Receipt To "Stock"; the Customer
   * select lists only customers holding approval stock; "Against RC No(s)"
   * (a typeahead) takes the approval issue's RC number and loads its Issued
   * Tags. Our tag is received by scanning it into "Tag Number" (fallback:
   * tick its issued row + "Receive"); the Receipt Summary's "Received Tags"
   * count proves it. Returns the receipt number.
   */
  async approvalReceipt({ customer, rcNo, tagNo, rfidNo, metalRate = 6000 }) {
    await this.goto('/sls/view-approval-receipt');
    await this.waitForIdle();
    await this.clickVisibleAdd();

    if (!(await this.selectValue('masterDataValueID_ReceiptMode').catch(() => ''))) {
      await this.pickFirstOption('masterDataValueID_ReceiptMode').catch(() => {});
    }
    await this.pick('masterDataValueID_ApprovalReceiptFrom', 'Customer', { exact: true });
    if (!(await this.selectValue('masterDataValueID_ApprovalReceiptTo').catch(() => ''))) {
      await this.pick('masterDataValueID_ApprovalReceiptTo', 'Stock', { exact: true }).catch(() => {});
    }
    await this.settle(1_500);
    await this.pick('sourceB2BCustomerID', customer, { search: true });
    await this.settle(1_500);
    await this.pickFirstByCaption('Customer Branch', /branch/i, { optional: true });
    await this.pick('approvalIssueIDs', this.docCore(rcNo), { search: true, closePanel: true });
    await this.waitForIdle();
    await this.settle(2_500);

    const issued = (rfidNo ? this.rowMatcher(rfidNo).or(this.rowMatcher(tagNo)) : this.rowMatcher(tagNo)).first();
    if (!(await issued.isVisible({ timeout: 30_000 }).catch(() => false))) {
      const rows = await this.page.locator('tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
      throw new Error(`approval receipt: RC ${rcNo} loaded no issued row for tag ${tagNo} - rows: ${JSON.stringify(rows.map((t) => t.replace(/\s+/g, ' ').slice(0, 120)))}`);
    }
    const receivedCount = async () => {
      const text = await this.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const m = text.match(/Received Tags\s*:\s*(\d+)/);
      return m ? Number(m[1]) : 0;
    };
    // scan to receive (by RFID when known - "Scan By" offers Rfid Number);
    // fall back to ticking the issued row + Receive
    if (rfidNo) await this.pickPreferred('masterDataValueID_ScanType', /rfid/i).catch(() => {});
    await this.scanTag(tagNo, 'approval receipt', { rfidNo }).catch((e) => console.log(`approval receipt: scan did not stage (${String(e).split('\n')[0]})`));
    if ((await receivedCount()) < 1) {
      await this.checkRow(rfidNo && (await this.rowMatcher(rfidNo).count()) ? rfidNo : tagNo);
      const receive = this.page.getByRole('button', { name: /^Receive$/ }).locator('visible=true').last();
      if (await receive.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await receive.click();
        await this.settle(2_000);
      }
    }
    const n = await receivedCount();
    if (n < 1) {
      const toasts = await this.page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => []);
      throw new Error(`approval receipt: tag ${tagNo} was not received (Received Tags : ${n}). Toasts: ${JSON.stringify(toasts)}`);
    }
    console.log(`approval receipt: Received Tags : ${n}`);
    await this.fillMetalRateIfEmpty(metalRate);

    const body = await this.clickAndCaptureSave(this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
    await this.previewAndClose();
    return (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
  }
}

module.exports = { LogisticsSalesWorkflowPage };

