const { StockInwardBasePage } = require('./StockInwardBasePage');
const { DEMO_FILES } = require('../utils/demo-files');

/**
 * Production end-to-end workflow — all screens of the chain, converted from
 * the QA lead's codegen recording of 29-08-2026 into the suite's robust
 * patterns (retrying picks, spinner waits, state capture).
 *
 * Screens:
 *   Concept + Uploads + Approval  prd/view-concept   (page tabs)
 *   Job Work                      prd/view-job-work
 *   Job Assignment                prd/app-view-production-job-assignment
 *   Process Movement              prd/app-process-movement-setup (Accept/Transfer)
 *   Worker Issue / Receipt        prd/app-worker-issue-receipt-setup
 *   Job Finalize                  prd/app-job-finalize-list
 */
class ProductionWorkflowPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Production');
  }

  async openRoute(route, readyLocator) {
    await this.goto(route);
    await this.waitForIdle();
    if (readyLocator) await readyLocator.waitFor({ state: 'visible', timeout: 30_000 });
    await this.settle(1_500);
  }

  async clickAdd() {
    await this.page.locator('.ngx-spinner-overlay').last().waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
    await this.addBtn.click({ timeout: 60_000 });
    await this.waitForIdle();
    await this.settle(1_500);
  }

  /** Sub-tab links on the Concept page (Concept / Uploads / Approval). */
  async openConceptTab(name) {
    await this.openRoute('/prd/view-concept');
    if (name !== 'Concept') {
      await this.page.locator('a').filter({ hasText: new RegExp(`^${name}$`) }).last().click();
      await this.waitForIdle();
      await this.settle(1_500);
    }
  }

  /**
   * Attach an image from the demo folder WITHOUT the Browse popup: the form
   * carries a real <input type="file"> in its DOM, so the file is injected
   * directly (no dialog ever opens, nothing to close). Verified live: the
   * preview renders immediately and the dialog count stays at zero.
   */
  async attachImage(filePath) {
    const fileInput = this.page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    await this.settle(1_500);

    // commit the image to the form's image list when the button is present
    const addImage = this.page.getByRole('button', { name: 'Add Image' });
    if (await addImage.isVisible().catch(() => false)) {
      await addImage.click();
      await this.settle(1_500);
    }

    const preview = this.page.locator('.image-card, img[src^="blob:"], img[src^="data:"]').last();
    if (!(await preview.isVisible().catch(() => false))) {
      console.log('attachImage: no visible preview detected - check the upload');
    }
  }

  /** Submit and harvest the generated document no from the Print dialog. */
  async submitAndReadDocNo() {
    await this.page.getByRole('button', { name: 'Submit' }).click();
    await this.printDialog.waitFor({ state: 'visible', timeout: 120_000 });
    const docNo = await this.voucherNumber();
    await this.closeVisibleDialog();
    await this.printDialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    return docNo;
  }

  // ---------- 1. Concept ----------
  async createConcept(d) {
    await this.openConceptTab('Concept');
    await this.clickAdd();
    await this.pick('conceptFor', d.conceptFor, { exact: true });
    await this.page.locator('#appWeight').fill(String(d.approxWeight));
    await this.pick('settingType', d.settingsType);
    await this.pick('assignTo', d.assignTo, { search: true });
    await this.page.locator('textarea').first().fill(d.description);
    await this.pick('dimension', d.dimensionsBy, { exact: true });
    await this.page.locator('#length').fill(String(d.length));
    await this.page.locator('#height').fill(String(d.height));
    await this.attachImage(DEMO_FILES.image1);
    return this.submitAndReadDocNo(); // concept no, e.g. AA41
  }

  // ---------- 1b. Concept Uploads ----------
  async uploadConceptImage(d) {
    await this.openConceptTab('Uploads');
    await this.clickAdd();
    await this.pick('worker', d.worker, { search: true });
    await this.pick('conceptno', d.conceptNo, { search: true });
    await this.page.locator('textarea').first().fill(d.description);
    await this.attachImage(DEMO_FILES.image2);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    await this.waitForIdle();
    await this.settle(3_000);
  }

  // ---------- 1c. Concept Approval ----------
  async approveConcept(d) {
    await this.openConceptTab('Approval');
    await this.clickAdd();
    await this.pick('worker', d.worker, { search: true });
    await this.pick('conceptNo', d.conceptNo, { search: true });
    await this.pick('concept', d.concept, { exact: true });
    // select the uploaded image card
    await this.page.locator('.image-card > .invisible-click').first().click();
    await this.settle(1_000);
    // approval status dropdown appears with the remaining empty select
    await this.pickByLabel('Status', 'Concept Approved').catch(async () => {
      // fallback: the last still-empty ng-select on the form
      const empty = this.page.locator('ng-select').filter({ hasText: 'Please Select' }).last();
      await empty.locator('.ng-select-container').click();
      await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: 'Concept Approved' }).first().click();
    });
    await this.page.getByRole('textbox', { name: 'Enter Remarks' }).fill(d.remarks);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    await this.waitForIdle();
    await this.settle(3_000);
  }

  // ---------- 1 (Master Design variant) ----------
  /**
   * Production > Planning > Master Design. Minimal creation per the QA
   * lead's recording: Creation Type "Create Master Design" (Item Type
   * defaults to Metal), Weight Type + weight value, one image from the demo
   * folder, Submit. Returns the generated design number.
   */
  async createMasterDesign(d) {
    await this.openRoute('/prd/view-master-design');
    await this.clickAdd();
    await this.pick('creationType', d.creationType || 'Create Master Design', { exact: true });
    await this.settle(1_500);
    if (d.itemType) await this.pick('itemType', d.itemType, { exact: true });
    await this.pick('weightRangeType', d.weightType || 'Net Weight', { exact: true });

    const weight = this.page.locator('input[type=number]:visible').first();
    await weight.fill(String(d.weight));
    await weight.blur();

    // Article: catalog entries like "Gold,Ring-Tendulkar". Its sioniq-ng-select
    // carries NO controlname - pick the article by searching in the first
    // controlname-less select; fall back to whatever select validation flags.
    const articleText = d.article || 'Tendulkar';
    const pickArticleIn = async (sel) => {
      await sel.locator('.ng-select-container').click();
      await sel.locator('input[role="combobox"]').fill(articleText).catch(() => {});
      await this.settle(2_000);
      const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: articleText }).first();
      await opt.waitFor({ state: 'visible', timeout: 15_000 });
      await opt.click();
    };
    const bare = this.page.locator('sioniq-ng-select:not([controlname])').locator('visible=true').first().locator('ng-select');
    try {
      await pickArticleIn(bare);
    } catch {
      // trigger validation to expose the mandatory article select, then fix it
      await this.page.getByRole('button', { name: 'Submit' }).click();
      await this.settle(3_000);
      const flagged = this.page.locator('ng-select.ng-invalid, ng-select.is-invalid').locator('visible=true').first();
      await pickArticleIn(flagged);
    }
    await this.settle(1_500);

    // "Description Fields" section: a mandatory preset dropdown (label is a
    // configured custom field, e.g. "Descriptionttest") - option "Test 2".
    if (d.description) {
      const descSel = this.page
        .locator('label')
        .filter({ hasText: /Description/i })
        .last()
        .locator('xpath=following::ng-select[1]');
      await descSel.locator('.ng-select-container').click();
      const dOpt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: d.description }).first();
      await dOpt.waitFor({ state: 'visible', timeout: 15_000 });
      await dOpt.click();
      await this.settle(1_000);
    }

    await this.attachImage(d.imagePath);

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && /design/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    let designNo = '';
    if (r) {
      const body = await r.json().catch(() => null);
      console.log('master design save:', r.status(), JSON.stringify(body).slice(0, 250));
      if (r.status() >= 400 || (body && body.errorCode)) {
        const diag = await this.page.evaluate(() => {
          return [...document.querySelectorAll('sioniq-ng-select, input')].filter((n) => {
            const el = n.tagName === 'INPUT' ? n : n.querySelector('ng-select');
            return n.offsetParent && el && (el.classList.contains('ng-invalid') || el.classList.contains('is-invalid'));
          }).map((n) => n.getAttribute('controlname') || n.id || 'unnamed');
        });
        throw new Error(`Master design save rejected: ${body ? body.error || '' : ''}; invalid fields: ${JSON.stringify(diag)}`);
      }
      designNo = (body && body.data && (body.data.designNumber || body.data.receiptNo || body.data.docNo)) || '';
    }
    // close a print dialog if one opened
    if (!designNo && (await this.printDialog.isVisible({ timeout: 5_000 }).catch(() => false))) {
      designNo = await this.voucherNumber();
    }
    await this.closeVisibleDialog();

    // The save response carries no design number - read the Design Code from
    // the list view's newest row (newest-first: "1 RDDDD4 Metal ...").
    if (!designNo) {
      await this.openRoute('/prd/view-master-design');
      await this.settle(2_000);
      const firstRow = await this.page.locator('table tbody tr').first().innerText({ timeout: 2_000 }).catch(() => '');
      designNo = (firstRow.trim().split(/\s+/)[1] || '').trim();
      console.log(`design number from list top row: ${designNo}`);
    }
    return designNo;
  }

  // ---------- 2. Job Work ----------
  /**
   * Works for both chains: Generation Type "Production Concept" (ref = the
   * concept no) and "Master Design" (ref = the design number). refLabel is
   * the label of the reference typeahead that renders after the type pick.
   */
  async createJobWork(d) {
    const generationType = d.generationType || 'Production Concept';
    const refLabel = d.refLabel || 'Concept No';
    const refNo = d.refNo || d.conceptNo;

    await this.openRoute('/prd/view-job-work');
    await this.clickAdd();
    await this.pick('generationType', generationType, { exact: true });
    await this.settle(2_500);

    let masterDesignCard = null;
    const qty = String(d.qty || 1);
    if (generationType === 'Master Design') {
      // KNOWN APP BUG (QA lead, 29-08-2026): selecting a design in the
      // Design Number dropdown filters the card grid but BREAKS Submit
      // (saves nothing, silently). Leave the dropdown alone and select the
      // design CARD from the full grid (newest first, so ours is on page 1).
      await this.page.locator('.invisible-click').first().waitFor({ state: 'visible', timeout: 30_000 });
      await this.settle(1_500);
      // OUR design's card, keyed by its design number (the innermost element
      // holding both the number and the card's click target) - not blindly
      // the first card
      masterDesignCard = refNo
        ? this.page.locator('div')
          .filter({ has: this.page.locator('p', { hasText: new RegExp(`^\\s*${refNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }) })
          .filter({ has: this.page.locator('.invisible-click') })
          .last()
        : this.page.locator('.invisible-click').first().locator('xpath=ancestor::div[.//p][1]');
      if (!(await masterDesignCard.isVisible({ timeout: 10_000 }).catch(() => false))) {
        const shown = await this.page.locator('p').filter({ hasText: /^\s*[A-Z0-9]{5,}\s*$/ }).allTextContents().catch(() => []);
        throw new Error(`job work: design ${refNo} is not among the cards on page 1 (${JSON.stringify(shown.slice(0, 15))})`);
      }
      const selectedCount = async () => {
        const t = await this.page.getByText(/\d+ Records? selected/).first().textContent({ timeout: 1_000 }).catch(() => '');
        const m = (t || '').match(/(\d+) Records? selected/);
        return m ? Number(m[1]) : 0;
      };
      if ((await selectedCount()) < 1) {
        await masterDesignCard.locator('.invisible-click').first().click();
        await this.settle(1_500);
      }
      if ((await selectedCount()) < 1) throw new Error(`job work: ticking the card of design ${refNo} registered no selection`);
      // UI change (24-09-2026): the card's Qty is now a TEXT box that starts
      // EMPTY (it was a number input defaulting to 1), and Submit stays
      // silent while it is blank. Fill the SELECTED card's own Qty; never the
      // "Qty (applies to all)" header field (filling it blocked Submit) and
      // never the grid's page-number box (the old number-input locator
      // landed there)
      const cardQty = masterDesignCard.locator('xpath=.//*[normalize-space(text())="Qty"]/following::input[1]').first();
      await cardQty.fill(qty);
      await cardQty.blur();
      await this.settle(800);
      const qtyNow = await cardQty.inputValue().catch(() => '');
      if (qtyNow !== qty) throw new Error(`job work: the Qty of design ${refNo} did not take "${qty}" (holds "${qtyNow}")`);
      if (d.remarks) {
        const remarks = this.page.locator('xpath=//*[normalize-space(text())="Remarks"]/following::input[1]').first();
        await remarks.fill(d.remarks).catch(() => {});
      }
      console.log(`job work: design ${refNo} card selected, Qty ${qty}`);
    } else {
      // concept path: reference typeahead works normally
      await this.pickByLabel(refLabel, refNo, { search: true }).catch(async () => {
        const sel = this.page.locator('ng-select').filter({ hasText: 'Please Select' }).first();
        await sel.locator('.ng-select-container').click();
        await sel.locator('input[role="combobox"]').fill(refNo);
        await this.settle(2_500);
        await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: refNo }).first().click();
      });
      await this.settle(2_500);
      const selector = this.page.locator('label.invisible-click, .image-card > .invisible-click');
      if (await selector.count()) await selector.first().click();
      const remarks = this.page.locator('input[type="text"]:visible, textarea:visible').filter({ hasNot: this.page.locator('[role="combobox"]') }).last();
      await remarks.fill(d.remarks).catch(() => {});
    }

    // capture the job work number from the save response (broad matcher -
    // the endpoint is CreateJobWork; grid refreshes are excluded)
    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && !/GetAll|Pagination|KeepAlive/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    // a Submit that fires nothing within 25 s is a silently invalid form:
    // say which controls, top the card's Qty up again, and press once more
    let r = await Promise.race([resp, this.page.waitForTimeout(25_000).then(() => null)]);
    if (!r) {
      console.log(`job work submit: no save request after 25 s - invalid controls: ${JSON.stringify(await this.invalidControls())} - retrying Submit`);
      if (masterDesignCard) {
        const cardQty = masterDesignCard.locator('xpath=.//*[normalize-space(text())="Qty"]/following::input[1]').first();
        if (!(await cardQty.inputValue().catch(() => ''))) await cardQty.fill(qty).catch(() => {});
      }
      await this.page.getByRole('button', { name: 'Submit' }).click().catch(() => {});
      r = await resp;
    }
    let jobWorkNo = '';
    if (r) {
      const body = await r.json().catch(() => null);
      jobWorkNo = (body && body.data && (body.data.receiptNo || body.data.jobWorkNo || body.data.docNo)) || '';
      console.log('job work save:', r.status(), JSON.stringify(body).slice(0, 200));
      if (r.status() >= 400 || (body && body.errorCode)) {
        throw new Error(`Job work save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
      }
    } else {
      throw new Error(`Job work Submit fired no save request - form silently blocked; invalid controls: ${JSON.stringify(await this.invalidControls())}`);
    }
    // close a print dialog if one opened
    await this.closeVisibleDialog();
    return jobWorkNo;
  }

  // ---------- 3. Job Assignment ----------
  async assignJob(d) {
    const sourceType = d.sourceType || 'Job Work';
    await this.openRoute('/prd/app-view-production-job-assignment');
    await this.clickAdd();
    await this.pick('sourceType', sourceType, { exact: true });
    if (sourceType === 'Job Work') {
      await this.pick('generationType', d.generationType || 'Production Concept', { exact: true });
    }
    // the Repair source adds a Business Type filter (QA lead: B2B)
    if (d.businessType) {
      await this.pick('businessType', d.businessType, { exact: true }).catch(() =>
        this.pickByLabel('Business Type', d.businessType, { exact: true }));
    }
    // the Order generation type / Sample source additionally filter by item
    // type. The Sample form's Item Type select carries NO itemType
    // controlname and its caption is NOT a <label> element - reach it
    // structurally as the first ng-select after the Production Source.
    if (d.itemType) {
      await this.pick('itemType', d.itemType, { exact: true }).catch(async () => {
        const sel = this.page
          .locator('sioniq-ng-select[controlname="sourceType"]')
          .locator('xpath=following::ng-select[1]');
        await sel.locator('.ng-select-container').click();
        const opt = this.page
          .locator('.ng-dropdown-panel .ng-option')
          .filter({ hasText: new RegExp(`^\\s*${d.itemType}\\s*$`) })
          .first();
        await opt.waitFor({ state: 'visible', timeout: 15_000 });
        await opt.click();
      });
    }
    if (d.location) await this.pick('locations', d.location, { closePanel: true });
    // the Sample form adds a Business Unit filter (QA lead: Cochin) - like
    // Item Type it carries no controlname; structurally the second ng-select
    // after Production Source
    if (d.businessUnit) {
      // BEST-EFFORT: the BU select defaults correctly on some builds (the
      // registration chain passed without it) - log rather than fail
      await this.pick('businessUnit', d.businessUnit, { exact: true }).catch(async () => {
        const sel = this.page
          .locator('sioniq-ng-select[controlname="sourceType"]')
          .locator('xpath=following::ng-select[2]');
        await sel.locator('.ng-select-container').click();
        const opt = this.page
          .locator('.ng-dropdown-panel .ng-option')
          .filter({ hasText: new RegExp(`^\\s*${d.businessUnit}\\s*$`) })
          .first();
        await opt.waitFor({ state: 'visible', timeout: 15_000 });
        await opt.click();
      }).catch((e) => console.log(`assignJob: business unit pick skipped (${String(e).split('\n')[0]})`));
    }
    // Sample source: the grid pages (25 pending samples over 3 pages), so
    // the target row is often not on page 1. Narrow it via the form's own
    // "Sample No" filter (4th ng-select after Production Source: Item Type,
    // Business Unit, Sample No) - its caption is plain text, not a <label>.
    const sampleNo = d.sampleNo || (sourceType === 'Sample' ? d.rowText : null);
    if (sampleNo) {
      await this.pick('sampleNo', sampleNo, { search: true }).catch(async () => {
        const sel = this.page
          .locator('sioniq-ng-select[controlname="sourceType"]')
          .locator('xpath=following::ng-select[3]');
        await sel.locator('.ng-select-container').click();
        await sel.locator('input[role="combobox"]').fill(sampleNo).catch(() => {});
        await this.settle(1_500);
        const opt = this.page
          .locator('.ng-dropdown-panel .ng-option')
          .filter({ hasText: new RegExp(sampleNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
          .first();
        await opt.waitFor({ state: 'visible', timeout: 15_000 });
        await opt.click();
      }).catch((e) => console.log(`assignJob: sample no filter skipped (${String(e).split('\n')[0]})`));
    }
    await this.settle(2_500);

    // grid row for our concept/job/sample - check it
    await this.checkRow(d.rowText);

    // sample rows need the Update button to open the assignment panel
    const update = this.page.getByRole('button', { name: /Update$/ }).locator('visible=true').first();
    if (await update.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await update.click();
      await this.settle(1_500);
      // samples created ON the order pop an "Edit Item Details" overlay that
      // must be confirmed with its own footer Update before the process
      // picks are reachable
      const editPanel = this.page
        .locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]')
        .filter({ hasText: 'Edit Item Details' })
        .last();
      if (await editPanel.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await editPanel.getByRole('button', { name: /Update$/ }).last().click();
        await editPanel.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
        console.log('assignJob: Edit Item Details panel confirmed');
        await this.settle(1_500);
      }
    }

    // Right panel: Department is preset to "Production"; assignment happens
    // via Process ("Design And CAD") + Sub Process ("CAD Modeling").
    await this.pick('process', d.process);
    await this.pick('subProcess', d.subProcess);

    // verify the SAVE actually fires - Submit is a silent no-op on invalid
    // forms (checklist rule 6)
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /create|save|assign/i.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 30_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(40_000); // armed with the click
    await this.page.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    if (!r) {
      const diag = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && n.offsetParent)
          .map((n) => n.getAttribute('controlname')));
      throw new Error(`Job assignment Submit fired no save request - form silently blocked; invalid: ${JSON.stringify(diag)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('job assignment save:', r.status(), JSON.stringify(body).slice(0, 200));
    await this.reportSaveToast('job assignment', toast);
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Job assignment save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.waitForIdle();
    await this.settle(3_000);
    await this.closeVisibleDialog();
    // the allotted PRODUCTION number (J-series): downstream grids - the
    // accept-after-transfer one especially - key rows by IT, not the job no
    const prodNo = body && body.data && body.data[0] && body.data[0].receiptNo;
    if (prodNo) this.lastAssignedProductionNo = prodNo;
    return prodNo || null;
  }

  /** Case-insensitive row matcher (grids re-case document numbers: the API
   *  returns "wJune-..." while the grid prints "WJune-..."). Accepts a single
   *  key or an ARRAY of alternative keys (job work no + production no): grids
   *  key rows differently per screen - the accept-after-transfer grid shows
   *  ONLY the J-number, most others show the P-number. */
  rowMatcher(rowText) {
    const keys = (Array.isArray(rowText) ? rowText : [rowText]).filter(Boolean);
    const esc = keys.map((k) => String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  /** Narrow a pending grid via its own Search box (rows can sit on page 2+).
   *  Searches the FIRST key only - grid search is a single text match.
   *  ONLY the grid's box qualifies - the GLOBAL top-nav search also carries a
   *  "Search" placeholder and matched first (17-09-2026: P190 typed into the
   *  nav bar), so anything inside the header/topbar/navbar is excluded. */
  async narrowGrid(rowText) {
    const key = Array.isArray(rowText) ? rowText.find(Boolean) : rowText;
    if (!key) return;
    const search = this.page.locator(
      'xpath=//input[contains(translate(@placeholder, "SEARCH", "search"), "search")'
      + ' and not(ancestor::header)'
      + ' and not(ancestor::*[contains(@class, "topbar") or contains(@class, "navbar") or contains(@id, "topbar")])]',
    ).locator('visible=true').first();
    if (await search.count().catch(() => 0)) {
      // fill ONLY - NEVER press Enter here: on the Process Movement grids
      // Enter resets/reloads the whole panel and the rows never come back
      // (17-09-2026, "screen loading" then empty grid). Typing alone filters
      // where the grid supports it.
      await search.fill(String(key)).catch(() => {});
      // the filter fires behind the ngx-spinner and the grid RE-RENDERS -
      // wait the loader out fully or the next click races it
      await this.settle(1_000);
      await this.waitForSpinner();
      await this.waitForIdle();
      await this.settle(1_500);
      // NOT every grid indexes the doc number (Worker Issue does not, QA
      // 17-09-2026) - there the search filters our row OUT. If no matching
      // row survived, CLEAR the search and fall back to the unfiltered grid.
      if (!(await this.rowExists(rowText, 3_000))) {
        console.log(`narrowGrid: search "${key}" matched nothing - clearing (this grid may not index the doc number)`);
        await search.fill('').catch(() => {});
        await this.settle(1_000);
        await this.waitForSpinner();
        await this.waitForIdle();
        await this.settle(1_500);
      }
    }
  }

  /** Check the selection checkbox of the grid row containing rowText.
   *  RETRIES until the check actually sticks: after a grid search the rows
   *  re-render behind the spinner and a click landing mid-render is silently
   *  swallowed ("Clicking the checkbox did not change its state", 17-09-2026). */
  async checkRow(rowText) {
    await this.rowMatcher(rowText).first().waitFor({ state: 'visible', timeout: 30_000 });
    const selectedCount = async () => {
      const t = await this.page.getByText(/\d+ Records? selected/).first().textContent({ timeout: 1_000 }).catch(() => '');
      const m = (t || '').match(/(\d+) Records? selected/);
      return m ? Number(m[1]) : 0; // no "selected" text = nothing selected
    };
    const isOn = async (box) => {
      if (await box.isChecked({ timeout: 1_500 }).catch(() => false)) return true;
      const aria = await box.getAttribute('aria-checked', { timeout: 1_000 }).catch(() => null);
      if (aria === 'true') return true;
      return box.evaluate((el) => {
        if (el.matches('input')) return el.checked;
        if (el.getAttribute('aria-checked') === 'true') return true;
        const inner = el.querySelector('input[type="checkbox"]');
        return (inner && inner.checked) || el.classList.contains('checked') || el.classList.contains('p-highlight');
      }).catch(() => false);
    };
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.waitForSpinner();
      // re-resolve the row each attempt - the node may have been replaced
      const box = this.rowMatcher(rowText).first().getByRole('checkbox').first();
      if (await isOn(box)) return;
      const before = await selectedCount();
      await box.click({ force: true, timeout: 10_000 }).catch(() => {});
      await this.page.waitForTimeout(800);
      if (await isOn(box)) return;
      const after = await selectedCount();
      if (after > before) {
        console.log(`checkRow: selection counted by the grid (${before} -> ${after} selected) although the checkbox does not report checked`);
        return;
      }
      console.log(`checkRow: check did not stick (attempt ${attempt}) - grid likely re-rendered, retrying`);
    }
    throw new Error(`row checkbox for "${Array.isArray(rowText) ? rowText.join('|') : rowText}" never took the check after 4 attempts`);
  }

  /**
   * Select the row matching rowText (a key or array of alternative keys).
   * The old "fall back to the first pending row" behaviour is GONE: on
   * 16-09-2026 it silently received, transferred and accepted the WRONG
   * documents (P179/P178 chains) whenever the target sat on page 2 or the
   * grid keyed rows by a number we did not pass. Now the grid is narrowed
   * via its Search box and ONLY the matching row is selected; no match
   * returns false so the caller can skip/fail explicitly.
   */
  async selectRowOrFirst(rowText) {
    await this.narrowGrid(rowText);
    if (await this.rowExists(rowText, 10_000)) {
      await this.checkRow(rowText);
      return true;
    }
    console.log(`row "${Array.isArray(rowText) ? rowText.join('|') : rowText}" not found in the grid - NOT selecting any other row`);
    return false;
  }

  // ---------- 4/6. Process Movement ----------
  async processMovementAccept(d) {
    await this.openRoute('/prd/app-process-movement-setup');
    await this.page.getByRole('tab', { name: 'Accept' }).click({ timeout: 3_000 }).catch(() => {});
    await this.clickAdd();
    await this.pick('process', d.process, { search: true });
    if (d.subProcess) await this.pick('subProcess', d.subProcess, { search: true }).catch(() => {});
    await this.pick('sourceType', d.sourceType || 'Job Work', { exact: true });
    // the Sample source adds an Item Type filter - the grid loads ONLY after
    // it is picked, so a silently-failed pick here means an empty grid and a
    // FALSE "already accepted" skip. Log loudly when it fails.
    if (d.itemType) {
      await this.pick('itemType', d.itemType, { exact: true }).catch((e1) =>
        this.pickByLabel('Item Type', d.itemType, { exact: true }).catch(() =>
          console.log(`processMovementAccept: WARNING - Item Type pick failed, grid may stay empty (${String(e1).split('\n')[0]})`)));
    }
    // The pending grid loads AFTER the filters via a slow XHR behind the
    // ngx-spinner. NEVER decide "nothing pending" while the loader is still
    // up (QA lead 15-09-2026: a mid-load check false-skipped the sample
    // accept and the workflow continued unaccepted) - wait the loader out,
    // then give the grid a bounded window to render its rows.
    await this.waitForSpinner();
    const gridDeadline = Date.now() + 25_000;
    while (Date.now() < gridDeadline) {
      if (await this.rowExists(d.rowText, 1_500)) break;
      const anyRow = await this.page.getByRole('row').filter({ has: this.page.getByRole('checkbox') }).last()
        .isVisible().catch(() => false);
      if (anyRow) break;
      await this.waitForSpinner();
      await this.settle(1_000);
    }
    // grids key rows by doc numbers we may not hold - first pending row is
    // ours (grid pre-filtered by process + source)
    if (!(await this.selectRowOrFirst(d.rowText))) {
      console.log(`processMovementAccept: nothing pending at ${d.process} - already accepted, skipping`);
      return 'skipped';
    }
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /accept|save|create/i.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|Translation/i.test(r.url()),
      { timeout: 30_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(40_000); // armed with the click
    await this.page.getByRole('button', { name: 'Accept' }).click();
    const r = await resp;
    if (r) console.log(`processMovementAccept: accept save ${r.status()} ${r.url().split('/').pop()}`);
    else console.log('processMovementAccept: WARNING - no accept save response captured');
    await this.reportSaveToast(`movement accept ${d.process}/${d.sourceType || 'Job Work'}`, toast);
    await this.waitForIdle();
    await this.settle(3_000);
    await this.closeVisibleDialog();
    return 'accepted';
  }

  async processMovementTransfer(d) {
    await this.openRoute('/prd/app-process-movement-setup');
    await this.page.getByRole('tab', { name: 'Transfer' }).click();
    await this.clickAdd();

    // Transfer-tab fields carry their own controlnames - address by label:
    // From Process / From Sub Process / Production Source /
    // Production No With Sub No, then the To Process panel on the right.
    await this.pickByLabel('From Process', d.fromProcess);
    if (d.fromSubProcess) await this.pickByLabel('From Sub Process', d.fromSubProcess).catch(() => {});
    await this.pickByLabel('Production Source', d.productionSource || 'Job Work', { exact: true });
    if (d.itemType) {
      await this.pickByLabel('Item Type', d.itemType, { exact: true }).catch(() =>
        this.pick('itemType', d.itemType, { exact: true }).catch(() => {}));
    }
    // "Production No With Sub No" filters by the PRODUCTION number
    // (D42026/...), which we may not hold - use it only when we have it,
    // never with the job work number (wrong value = grid filtered to nothing).
    if (d.productionNo) {
      await this.pickByLabel('Production No With Sub No', d.productionNo, { search: true, closePanel: true }).catch(() => {});
    }
    await this.settle(2_500);

    if (!(await this.selectRowOrFirst(d.rowText))) {
      console.log(`processMovementTransfer: nothing pending at ${d.fromProcess} - already transferred, skipping`);
      return 'skipped';
    }

    await this.pickByLabel('To Process', d.toProcess);
    await this.pickByLabel('To Sub Process', d.toSubProcess);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    await this.waitForIdle();
    await this.settle(3_000);
    await this.closeVisibleDialog();
  }

  // ---------- 5/7. Worker Issue / Receipt ----------
  async openWorkerIR(tab) {
    await this.openRoute('/prd/app-worker-issue-receipt-setup');
    await this.page.getByRole('tab', { name: tab }).click();
    await this.waitForIdle();
    await this.settle(1_500);
    await this.clickAdd();
  }

  async fillWorkerIRHeader(d) {
    await this.pick('departmentProcessID', d.process, { search: true });
    if (d.subProcess) await this.pickByLabel('Sub Process', d.subProcess, { search: true }).catch(() => {});
    await this.pick('masterDataValueID_WorkerType', 'Inhouse Worker', { exact: true });
    await this.pick('vendorID', d.worker, { search: true });
    await this.pick('masterDataValueID_ProductionSourceType', d.productionSource || 'Job Work', { exact: true });
    // the Sample source adds an Item Type filter and the grid loads ONLY after
    // it is picked ("Select Process, Worker, Production Source Type and Item
    // Type to load items"). On THIS form its controlname is
    // masterDataValueID_JewelleryItemType (not itemType) - resolve whichever
    // control actually exists, and log loudly when the pick still fails,
    // because a silent failure produces an empty grid and a FALSE
    // "already issued" skip.
    if (d.itemType) {
      await this.settle(1_500); // the select renders after the source pick
      const itCtl = (await this.page.locator('sioniq-ng-select[controlname="masterDataValueID_JewelleryItemType"]').count())
        ? 'masterDataValueID_JewelleryItemType' : 'itemType';
      await this.pick(itCtl, d.itemType, { exact: true })
        .catch(() => this.pickByLabel('Item Type', d.itemType, { exact: true }))
        .catch((e1) => console.log(`workerIssue/Receipt: WARNING - Item Type pick failed, grid may stay empty (${String(e1).split('\n')[0]})`));
    }
    // the pending grid loads noticeably after the last filter, behind the
    // ngx-spinner - wait the loader out before anyone judges the grid
    await this.waitForSpinner();
    await this.settle(4_000);
    await this.waitForSpinner();
  }

  /** Does a grid row containing rowText exist? (short wait, case-insensitive) */
  async rowExists(rowText, timeout = 15_000) {
    return this.rowMatcher(rowText).first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);
  }

  // ---------- 2 (Order Booking variant): inhouse Job Work via Issue ----------
  /**
   * Procurement > Operations > Issue, Job Work tab. Per the QA lead's
   * recording (30-08-2026): Generation Type "Order" + JobWork Mode "Inhouse"
   * + Production Unit + Item Type reveal the pending-orders grid ON THE SAME
   * step - check the order's row and Submit directly (no wizard walking).
   * Produces a PP## job work number; a Print dialog opens after save.
   */
  async createInhouseJobWorkFromOrder(d) {
    return this.createJobWorkFromOrder({ ...d, mode: 'Inhouse' });
  }

  /**
   * Outsource variant (QA lead recording 31-08-2026, Order-to-Lot chain):
   * JobWork Mode "Outsource" swaps Production Unit for a Vendor pick.
   */
  async createOutsourceJobWorkFromOrder(d) {
    return this.createJobWorkFromOrder({ ...d, mode: 'Outsource' });
  }

  /**
   * DIRECT inhouse job work (verified in the app 11-09-2026): Generation
   * Type "Direct" turns the Issue > JobWork Issue tab into a 3-step wizard
   * (General Job Work Details -> Items / Order Details -> Review & Submit).
   * General step: Direct + Inhouse + Production Unit + Item Type + Order
   * Type "Stock" + Making Type + SM Code (resolves the Sales Executive into
   * the Total Item Summary panel) + Delivery Note; Delivery Date prefills.
   * Items step: article chain + gross weight + Add Items, then Next to the
   * review step and Submit (save verified; a Print dialog follows).
   */
  async createDirectInhouseJobWork(d) {
    return this.createDirectJobWork({ ...d, mode: 'Inhouse' });
  }

  /** Outsource variant: JobWork Mode "Outsource" swaps Production Unit for a
   *  Vendor pick + the mandatory Vendor Making Type (same as the Order flow). */
  async createDirectOutsourceJobWork(d) {
    return this.createDirectJobWork({ ...d, mode: 'Outsource' });
  }

  async createDirectJobWork(d) {
    await this.openRoute('/prc/view-samplejobwork-issue');
    await this.clickAdd();
    await this.pick('generationType', 'Direct', { exact: true });
    await this.pick('jobworkMode', d.mode || 'Inhouse', { exact: true });
    if (d.mode === 'Outsource') {
      await this.pick('vendor', d.vendor || 'RAJA');
      const vmt = d.vendorMakingType || 'Job work';
      await this.pick('vendorMakingType', vmt)
        .catch(() => this.pickByLabel('Vendor Making Type', vmt))
        .catch(() => this.pickByLabel('Vendor Making Type:', vmt))
        .catch(() => this.pickByLabel('Vendor Making Type', 'Jobwork'));
    } else {
      await this.pick('productionUnit', d.productionUnit || 'Cochin', { exact: true });
    }
    await this.pick('itemType', d.itemType || 'Metal', { exact: true });
    // Order Type / Making Type may default (Stock / Regular) - set only when
    // empty or different. Wizard labels carry TRAILING COLONS ("SM Code:"),
    // so try controlnames (checking existence first - no wasted timeouts) and
    // both label spellings.
    const ensure = async (controls, label, value, opts = {}) => {
      for (const control of controls) {
        if (!(await this.page.locator(`sioniq-ng-select[controlname="${control}"]`).count())) continue;
        const cur = await this.selectValue(control).catch(() => '');
        if (cur.trim() === value) return;
        try { await this.pick(control, value, { exact: true, ...opts }); return; } catch (e) { /* try next */ }
      }
      for (const txt of [label, `${label}:`]) {
        if (!(await this.page.locator(`label:text-is("${txt}")`).count())) continue;
        try { await this.pickByLabel(txt, value, { exact: true, ...opts }); return; } catch (e) { /* try next */ }
      }
      console.log(`direct jobwork: ${label} pick failed - no matching control/label took "${value}"`);
    };
    await ensure(['orderType'], 'Order Type', d.orderType || 'Stock');
    await ensure(['makingType'], 'Making Type', d.makingType || 'Regular');
    await ensure(['smcode', 'smCode'], 'SM Code', d.smCode || 'AJ10', { search: true });
    await ensure(['deliveryNote'], 'Delivery Note', d.deliveryNote || 'Urgent');

    // Delivery Date does NOT prefill - fill it like the order wizards do
    const date = this.page.locator('#deliveryDate');
    if (await date.count()) {
      await date.fill(d.deliveryDate);
      await date.blur();
      await this.page.keyboard.press('Escape'); // close the date-picker popup
    } else {
      await this.fillByLabel('Delivery Date', d.deliveryDate).catch(() =>
        console.log('direct jobwork: delivery date input not found'));
    }

    // the SM Code resolves the sales executive into the summary panel
    await this.page.getByText(/Sales Executive\s*:\s*AJ10\s*\/\s*Ajin G/).first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => console.log('direct jobwork: sales executive summary not confirmed (continuing)'));

    await this.nextBtn.click();
    await this.waitForIdle();
    await this.settle(2_500);
    // verify the wizard actually advanced - Next is a silent no-op on invalid
    // forms; surface the invalid controls instead of timing out downstream
    const onItems = await this.page.locator('label').filter({ hasText: /^Article:?$/ }).first()
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!onItems) {
      const diag = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select, input.ng-invalid')]
          .filter((n) => (n.querySelector('ng-select')?.classList.contains('ng-invalid') || n.classList?.contains('ng-invalid')) && n.offsetParent)
          .map((n) => n.getAttribute('controlname') || n.id || n.name));
      throw new Error(`direct jobwork: wizard did not advance to Items step; invalid: ${JSON.stringify(diag)}`);
    }

    // ---- Items / Order Details step (verified 11-09-2026): "Add Item
    // Details" (Reference type is REQUIRED and drives the article chain; all
    // labels carry trailing colons) + "Add Weight Details" (No. of Pieces +
    // PIECE Weight - there is no Gross Weight input) + Add Items.
    const pickLbl = async (label, value, opts) => {
      const txt = (await this.page.locator(`label:text-is("${label}")`).count()) ? label : `${label}:`;
      return this.pickByLabel(txt, value, opts);
    };
    await pickLbl('Reference type', d.item.referenceType || 'Combination', { exact: true });
    if (d.item.groupCategory) await pickLbl('Group Category', d.item.groupCategory, { exact: true }).catch(() => {});
    if (d.item.category) await pickLbl('Category', d.item.category, { exact: true }).catch(() => {});
    await this.settle(2_000); // let the article list refilter
    await pickLbl('Article', d.item.article, { search: true });
    await pickLbl('Purity', d.item.purity);
    const pieceWeight = this.inputByLabel('Piece Weight', { exact: false });
    await pieceWeight.fill(String(d.item.pieceWeight ?? d.item.grossWeight));
    await pieceWeight.blur();
    await this.settle(1_500);
    const addItems = this.page.locator('button').filter({ hasText: /^\s*Add Items?\s*$/ })
      .locator('visible=true').last();
    await addItems.waitFor({ state: 'visible', timeout: 15_000 });
    await addItems.click();
    // the item must land before moving on - the summary panel's No. of Items
    // is the reliable signal
    await this.settle(2_000);
    const items = await this.page.getByText(/No\.?\s*of\s*Items/i).locator('xpath=ancestor::*[1]')
      .textContent({ timeout: 2_000 }).catch(() => '');
    console.log(`direct jobwork: items summary after Add -> ${String(items).replace(/\s+/g, ' ').trim()}`);

    // Review & Submit
    if (!(await this.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await this.nextBtn.click();
      await this.waitForIdle();
    }
    await this.submitBtn.waitFor({ state: 'visible', timeout: 30_000 });
    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000); // armed with the click
    await this.submitBtn.click();
    const r = await resp;
    if (!r) {
      const diag = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && n.offsetParent)
          .map((n) => n.getAttribute('controlname')));
      throw new Error(`direct jobwork Submit fired no save request - form silently blocked; invalid: ${JSON.stringify(diag)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('direct jobwork save:', r.status(), JSON.stringify(body).slice(0, 200));
    await this.reportSaveToast('direct job work', toast);
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`direct jobwork save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    const jobWorkNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    this.printPreviewError = null;
    await this.printDialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    await this.closeVisibleDialog();
    return jobWorkNo;
  }

  async createJobWorkFromOrder(d) {
    await this.openRoute('/prc/view-samplejobwork-issue');
    await this.clickAdd();
    await this.pick('generationType', 'Order', { exact: true });
    await this.pick('jobworkMode', d.mode, { exact: true });
    if (d.mode === 'Outsource') {
      await this.pick('vendor', d.vendor || 'RAJA');
      // Vendor Making Type - new mandatory dropdown (QA lead 04-09-2026):
      // without it Submit silently no-ops. Select "Job work".
      const vmt = d.vendorMakingType || 'Job work';
      await this.pick('vendorMakingType', vmt)
        .catch(() => this.pickByLabel('Vendor Making Type', vmt))
        .catch(() => this.pickByLabel('Vendor Making Type', 'Jobwork'));
    } else {
      await this.pick('productionUnit', d.productionUnit || 'Cochin', { exact: true });
    }
    await this.pick('itemType', d.itemType || 'Metal', { exact: true });
    await this.settle(2_500);

    if (!(await this.selectRowOrFirst(d.orderNo))) {
      throw new Error(`no pending order row found for ${d.orderNo} on the Issue grid`);
    }

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000); // armed with the click
    await this.page.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    if (!r) throw new Error('Issue Submit fired no save request - form silently blocked');
    const body = await r.json().catch(() => null);
    console.log(`${(d.mode || 'inhouse').toLowerCase()} job work save:`, r.status(), JSON.stringify(body).slice(0, 200));
    await this.reportSaveToast('job work issue', toast);
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Issue save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    const jobWorkNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    // the Print dialog offers Preview here - verify the template renders.
    // A broken template must NOT swallow the job work number (the caller
    // still has to persist it), so record the failure for the spec to
    // assert AFTER writing state instead of throwing here.
    this.printPreviewError = null;
    await this.printDialog.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    // close the post-save Print dialog
    await this.closeVisibleDialog();
    return jobWorkNo;
  }

  async workerIssue(d) {
    await this.openWorkerIR('Worker Issue');
    // The Issue tab's Process list only offers processes that still have
    // pending items - a missing option means this round was already issued.
    try {
      await this.fillWorkerIRHeader(d);
    } catch (e) {
      if (/No items found/.test(String(e))) {
        console.log(`workerIssue: process "${d.process}" has nothing pending - already issued, skipping`);
        return 'skipped';
      }
      throw e;
    }
    await this.narrowGrid(d.rowText);
    if (!(await this.rowExists(d.rowText))) {
      console.log(`workerIssue: no pending row for ${Array.isArray(d.rowText) ? d.rowText.join('|') : d.rowText} - already issued, skipping`);
      return 'skipped';
    }
    await this.checkRow(d.rowText);
    // Checking the row runs a spinner and then opens the edit-item /
    // partial-issue dialog (pieces and weights prefilled). Newer builds render
    // it with an EMPTY title (the old "Partial Issue" text is gone), so match
    // it STRUCTURALLY by its own "Add to Issue List" footer button - and give
    // it time to appear (it opens after a load spinner). While this aria-modal
    // dialog is open it intercepts every click, so it MUST be confirmed before
    // Submit.
    await this.waitForSpinner();
    const issueDialog = this.page
      .locator('[role="dialog"], .modal.show, ngb-modal-window, .offcanvas.show')
      .filter({ has: this.page.getByRole('button', { name: 'Add to Issue List' }) })
      .last();
    if (await issueDialog.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await issueDialog.getByRole('button', { name: 'Add to Issue List' }).last().click();
      await issueDialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      console.log('workerIssue: edit-item dialog confirmed (Add to Issue List)');
      await this.settle(1_500);
    } else {
      // older builds: a page-level "Add to Issue List" button instead
      const addToList = this.page.getByRole('button', { name: 'Add to Issue List' }).first();
      if (await addToList.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await addToList.click();
        await this.settle(2_000);
      }
    }
    // a still-open modal means the confirm click missed - fail loudly rather
    // than let Submit spin against the overlay
    const straggler = this.page.locator('ngb-modal-window').locator('visible=true').last();
    if (await straggler.isVisible().catch(() => false)) {
      throw new Error('workerIssue: the edit-item dialog is still open - Add to Issue List did not register');
    }

    await this.submitWorkerForm('worker issue');
  }

  /** Submit a worker issue/receipt form and VERIFY the save fired - Submit
   *  is a silent no-op on invalid forms (checklist rule 6), and relying on
   *  the print dialog alone let a repair receipt slip through unsaved. */
  async submitWorkerForm(what) {
    await this.waitForSpinner(); // the transparent ngx-spinner intercepts clicks
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /create|save|submit/i.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 60_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(70_000); // armed with the click
    await this.page.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    if (!r) {
      const diag = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && n.offsetParent)
          .map((n) => n.getAttribute('controlname')));
      throw new Error(`${what} Submit fired no save request - form silently blocked; invalid: ${JSON.stringify(diag)}`);
    }
    const body = await r.json().catch(() => null);
    console.log(`${what} save:`, r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 150));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`${what} save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.reportSaveToast(what, toast);
    await this.printDialog.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await this.closeVisibleDialog();
    await this.waitForIdle();
  }

  /** Check a finalize checkbox by accessible name or invisible-click label. */
  async checkFinalizeBox(pattern) {
    const box = this.page.getByRole('checkbox', { name: pattern }).first();
    if (await box.isVisible({ timeout: 5_000 }).catch(() => false)) {
      if (!(await box.isChecked({ timeout: 2_000 }).catch(() => false))) await box.check({ force: true });
      console.log(`workerReceipt: finalize checkbox checked (${pattern})`);
      return true;
    }
    const lbl = this.page.locator('label').filter({ hasText: pattern }).first();
    if (await lbl.isVisible().catch(() => false)) {
      await lbl.click();
      console.log(`workerReceipt: finalize checkbox checked via label (${pattern})`);
      return true;
    }
    return false;
  }

  /**
   * Set the "Used Gross Weight" (use-sample-weight consume amount) on the
   * SAMPLE receipt grid. The grid is a PrimeNG frozen-column table where the
   * cell renders as display text until clicked, so click the cell by the
   * header column's x-range at the selected row's y, then type. Best-effort:
   * returns true on success, false if the field can't be reached.
   */
  async setUsedGrossWeight(rowText, value) {
    const th = this.page.locator('table thead th').filter({ hasText: /Used Gross Weight/i }).first();
    if (!(await th.count())) return false;
    const thBox = await th.boundingBox();
    const row = this.rowMatcher(rowText).first();
    const rowBox = await row.boundingBox().catch(() => null);
    const bodyBox = rowBox || (await this.page.locator('table tbody tr').first().boundingBox().catch(() => null));
    if (!thBox || !bodyBox) return false;
    const x = thBox.x + thBox.width / 2;
    const y = bodyBox.y + bodyBox.height / 2;
    await this.page.mouse.click(x, y);
    await this.page.waitForTimeout(600);
    // an inline input should now be focused (or present) at that cell
    const filled = await this.page.evaluate((val) => {
      const a = document.activeElement;
      if (a && a.tagName === 'INPUT' && a.type !== 'checkbox') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(a, String(val));
        a.dispatchEvent(new Event('input', { bubbles: true }));
        a.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, value).catch(() => false);
    if (filled) {
      await this.page.keyboard.press('Tab').catch(() => {});
      await this.page.waitForTimeout(500);
      return true;
    }
    return false;
  }

  /**
   * "Use Sample Weight" on the SETTLEMENT (job work) worker receipt item form
   * (B2B used-in-production flow, QA walkthrough 10-09-2026): the field has its
   * own Add button which opens a grid of the worker's issued samples. Select
   * the record (by rowText when given, else the first data row), enter the
   * consume amount - half the issued sample weight - and confirm back to the
   * item form.
   */
  async useSampleWeight(value, rowText) {
    // the field renders as a stat tile "Used Sample Weight  0.000 Gram" with a
    // small "+" button as its Add control
    const anchor = this.page.getByText(/Used? Sample Weight/i).locator('visible=true').last();
    await anchor.waitFor({ state: 'visible', timeout: 15_000 });
    // the tile's Add control: the nearest following button, falling back to a
    // button inside the tile's own container
    const addBtn = anchor.locator('xpath=following::button[1]');
    await addBtn.click({ timeout: 10_000 }).catch(() =>
      anchor.locator('xpath=ancestor::div[2]//button').first().click({ timeout: 10_000 }));
    await this.settle(1_500);

    // the "+" opens the CUSTOMER SAMPLE picker (verified 10-09-2026): a dialog
    // with Stone Sample and Metal Sample grids, a Used Sample Weight Summary
    // strip, and its own Submit. The metal row's checkbox enables its PCS and
    // Gross Weight inputs (per the dialog's own notes); rows list by article,
    // NOT by sample number, so rowText is only a best-effort filter.
    const dialog = this.page.locator('.modal.show, .offcanvas.show, [role="dialog"]').locator('visible=true').last();
    const scope = (await dialog.count().catch(() => 0)) ? dialog : this.page;

    const rows = scope.locator('table tbody tr')
      .filter({ hasNotText: /No .*(records?|items?|data).* found|No (pending|records|items|data)/i })
      .filter({ has: this.page.locator('input[type=checkbox]') });
    let row = rows.filter({ hasText: rowText || '' }).first();
    if (!rowText || !(await row.count().catch(() => 0))) row = rows.first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    const box = row.locator('input[type=checkbox]').first();
    await box.check({ force: true, timeout: 3_000 }).catch(() => box.click({ force: true }));
    await this.page.waitForTimeout(800);

    // consume amount goes into the row's Gross Weight input - the 2nd text
    // input on the metal row (the 1st is PCS). The consumed amount MUST
    // register (summary must not stay 0), so retry the edit and verify the
    // Used Sample Weight Summary before submitting the picker.
    const inputs = row.locator('input:not([type=checkbox])');
    const gross = (await inputs.count()) > 1 ? inputs.nth(1) : inputs.first();
    const summaryText = async () =>
      ((await scope.getByText(/Total Used Sample Wt/i).locator('xpath=ancestor::*[1]').textContent({ timeout: 2_000 }).catch(() => '')) || '');
    let consumed = 0;
    for (let attempt = 1; attempt <= 3 && !consumed; attempt++) {
      await gross.click({ timeout: 3_000 }).catch(() => {});
      await gross.fill(String(value)).catch(() => {});
      await gross.press('Tab').catch(() => gross.blur().catch(() => {}));
      await this.settle(1_000);
      const m = (await summaryText()).match(/Total Used Sample Wt\s*:?\s*([\d.]+)/i);
      consumed = m ? parseFloat(m[1]) : 0;
      if (!consumed) {
        // some grids only enable the input after the checkbox change settles
        await box.check({ force: true, timeout: 3_000 }).catch(() => {});
        await this.page.waitForTimeout(700);
      }
    }
    console.log(`workerReceipt: Use Sample Weight -> entered ${value}, summary consumed = ${consumed}`);
    if (!consumed) {
      throw new Error(`Use Sample Weight: consumed amount stayed 0 after entering ${value} - must not be 0`);
    }

    // the picker's own Submit commits the consumption back to the item form.
    // Its accessible name carries an icon glyph, so role-based lookup misses
    // it - match by text. The modal is aria-modal: while it stays open it both
    // intercepts clicks AND hides the rest of the page from the a11y tree, so
    // hard-verify it actually closes.
    const confirm = scope.locator('button').filter({ hasText: /Submit|^\s*(Add|Ok|OK|Select|Save)\s*$/i })
      .locator('visible=true').last();
    await confirm.waitFor({ state: 'visible', timeout: 10_000 });
    await confirm.click();
    const openModal = this.page.locator('ngb-modal-window, .modal.show').locator('visible=true').first();
    const closed = await openModal.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!closed) throw new Error('Use Sample Weight: the Customer Sample picker did not close after Submit');
    console.log('workerReceipt: Customer Sample picker submitted and closed');
    await this.settle(1_000);
  }

  async workerReceipt(d) {
    await this.openWorkerIR('Worker Receipt');
    // The Receipt form's selects carry different controlnames than Issue -
    // address them by label (Process / Worker Type / Worker / Production
    // Source Type; Sub Process renders after Process is picked).
    try {
      await this.pickByLabel('Process', d.process);
    } catch (e) {
      if (/never appeared/.test(String(e))) {
        console.log(`workerReceipt: process "${d.process}" has nothing pending - already received, skipping`);
        return 'skipped';
      }
      throw e;
    }
    if (d.subProcess) await this.pickByLabel('Sub Process', d.subProcess).catch(() => {});
    await this.pickByLabel('Worker Type', 'Inhouse Worker', { exact: true });
    await this.pickByLabel('Worker', d.worker, { search: true });
    await this.pickByLabel('Production Source Type', d.productionSource || 'Job Work', { exact: true });
    if (d.itemType) {
      await this.pickByLabel('Item Type', d.itemType, { exact: true }).catch(() =>
        this.pick('itemType', d.itemType, { exact: true }).catch(() => {}));
    }
    await this.settle(2_500);
    if (d.item) {
      // ---- Settlement Wise receipt (Casting): an ITEM FORM, not a grid ----
      // "Add Item Details" section: Production No -> article/purity/weight,
      // Move to Job Finalize, Add Items.
      // Production No populates with this worker's pending jobs - select the
      // one offered (QA lead: "will populate in the dropdown, just select it").
      // Production No: harden against ng-select's stale-panel behaviour (a
      // panel opened too early shows nothing / "No items found" until
      // reopened - flagged by the QA lead as a click issue in VS Code runs)
      const sel = this.page.locator('label:text-is("Production No")').last().locator('xpath=following::ng-select[1]');
      // the dropdown lists EVERY pending production of this worker: prefer
      // the chain's own (a J-series key "J454" matches "J454.1", never
      // "J4541"); when the chain knows its J-number and it is not offered,
      // stop - receiving a stranger's job moved someone else's production to
      // Job Finalize (24-09-2026). Chains without a J-number keep the old
      // first-option behaviour.
      const keys = (Array.isArray(d.rowText) ? d.rowText : [d.rowText]).filter(Boolean).map(String);
      const jKeys = keys.filter((k) => /^J\d+(\.\d+)?$/i.test(k)).map((k) => k.replace(/\.\d+$/, ''));
      const keyRe = keys.length
        ? new RegExp(keys.map((k) => k.replace(/\.\d+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)').join('|'), 'i')
        : null;
      let picked = false;
      for (let attempt = 1; attempt <= 4 && !picked; attempt++) {
        if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(300);
        }
        await this.waitForSpinner();
        await sel.locator('.ng-select-container').click({ timeout: 15_000 });
        const options = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i });
        const found = await options.first().waitFor({ state: 'visible', timeout: attempt * 5_000 })
          .then(() => true).catch(() => false);
        if (found) {
          const labels = (await options.allTextContents()).map((t) => t.trim());
          let idx = keyRe ? labels.findIndex((l) => keyRe.test(l)) : -1;
          if (idx < 0 && jKeys.length) {
            await this.page.keyboard.press('Escape').catch(() => {});
            throw new Error(`workerReceipt: Production No does not offer the chain's ${jKeys.join('/')} - pending for this worker: ${JSON.stringify(labels.slice(0, 12))}`);
          }
          if (idx < 0) {
            if (keys.length) console.log(`workerReceipt: no Production No matches ${keys.join('|')} - taking the first offered (${labels[0]})`);
            idx = 0;
          }
          this.lastProductionNo = labels[idx];
          picked = await options.nth(idx).click({ timeout: 10_000 }).then(() => true).catch(() => false);
        }
        if (!picked) await this.page.keyboard.press('Escape');
      }
      if (!picked) throw new Error('Production No dropdown never offered a pending production number');
      console.log(`workerReceipt: Production No -> ${this.lastProductionNo}`);
      await this.settle(2_500);

      // article/purity/weight are per-flow: jobwork receipts need them typed,
      // repair receipts auto-fill from the production no - fill only what the
      // caller provided AND the form renders
      if (d.item.article) {
        // the article select carries id itemArticleSelect on most builds; fall
        // back to its label. Log what the list offers when the wanted article
        // is missing (material transactions can narrow it to the received
        // articles - CADM chain, 21-09-2026).
        let article = this.page.locator('#itemArticleSelect');
        if (!(await article.isVisible({ timeout: 5_000 }).catch(() => false))) {
          article = this.page.locator('label:text-is("Article")').last().locator('xpath=following::ng-select[1]');
        }
        if (await article.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await this.closeStalePanels();
          await article.locator('.ng-select-container').click();
          await article.locator('input[role="combobox"]').fill(d.item.articleSearch).catch(() => {});
          await this.settle(2_500);
          const opts = this.page.locator('.ng-dropdown-panel .ng-option');
          const wanted = opts.filter({ hasText: d.item.article }).first();
          if (await wanted.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await wanted.click();
          } else {
            const offered = (await opts.allTextContents()).map((t) => t.trim());
            // retry without the search text: the list may be pre-filtered already
            await article.locator('input[role="combobox"]').fill('').catch(() => {});
            await this.settle(1_500);
            const plain = (await opts.allTextContents()).map((t) => t.trim());
            const fallback = opts.filter({ hasNotText: /No items found|Type to search/i }).first();
            if (await fallback.isVisible({ timeout: 2_000 }).catch(() => false)) {
              console.log(`workerReceipt: article "${d.item.article}" not offered (search gave ${JSON.stringify(offered)}, list is ${JSON.stringify(plain.slice(0, 8))}) - taking "${((await fallback.textContent()) || '').trim()}"`);
              await fallback.click();
            } else {
              throw new Error(`workerReceipt: article "${d.item.article}" not offered and the list is empty (search: ${JSON.stringify(offered)})`);
            }
          }
          await this.settle(1_500);
        } else {
          console.log('workerReceipt: no Article select on this item form');
        }
      }
      if (d.item.purity) await this.pickByLabel('Purity', d.item.purity, { search: false }).catch(() => {});
      if (d.item.weight !== undefined) {
        const weight = this.page
          .locator('label:text-is("Gross Weight")')
          .last()
          .locator('xpath=following::input[1]');
        await weight.fill(String(d.item.weight)).catch(() => {});
        await weight.blur().catch(() => {});
        await this.settle(1_500);
      }

      // demo image via the item form's Add Files control
      if (d.item.image) await this.attachFileViaAddFiles(d.item.image, { last: true });

      // "Use Sample Weight": click its Add button, pick the issued-sample
      // record from the grid, enter the consume amount, then continue
      if (d.item.useSampleWeight !== undefined) {
        await this.useSampleWeight(d.item.useSampleWeight, d.item.sampleRowText);
      }

      // "Move to Job Finalize" toggle: its checkbox gets its accessible name
      // LATE (a11y attrs attach after async renders), so role lookups are
      // unreliable - address it positionally from the label text. Click ONCE
      // and read back the state; never blind-double-click (that re-toggles).
      const finalizeState = async () => {
        const holder = this.page.getByText(/^\s*Move to Job Finalize\s*$/).locator('visible=true').last()
          .locator('xpath=..');
        const cb = holder.locator('input[type=checkbox], [role="checkbox"], .p-checkbox').first();
        if (!(await cb.count())) return null;
        const c = await cb.isChecked({ timeout: 2_000 }).catch(() => null);
        if (c !== null) return c;
        const aria = await cb.getAttribute('aria-checked', { timeout: 2_000 }).catch(() => null);
        return aria === null ? null : aria === 'true';
      };
      const clickFinalize = async () => {
        const label = this.page.getByText(/^\s*Move to Job Finalize\s*$/).locator('visible=true').last();
        const cb = label.locator('xpath=..')
          .locator('input[type=checkbox], [role="checkbox"], .p-checkbox').first();
        if (await cb.count()) await cb.click({ force: true }).catch(() => label.click({ force: true }));
        else await label.locator('xpath=following-sibling::*[1]').click({ force: true }).catch(() => label.click({ force: true }));
        await this.page.waitForTimeout(600);
      };
      if (d.item.moveToJobFinalize && (await finalizeState()) !== true) {
        await clickFinalize();
        console.log(`workerReceipt: Move to Job Finalize (pre-add) checked = ${await finalizeState()}`);
      }
      // sample/repair finalize checkboxes live INSIDE the item form - check
      // them before Add Items when requested
      if (d.finalizeSample || d.finalizeRepair) {
        await this.checkFinalizeBox(d.finalizeSample ? /Finalize Sample/i : /(Repair Finalize|Finalize Repair)/i)
          .then((ok) => { this.finalizeChecked = ok; });
      }
      // jobwork receipts label the commit "Add Items"; repair receipts just
      // "Add" (with an icon) - accept either, never "Add Files". Role-based
      // lookup misses this toolbar (a11y names attach late) - use text
      // matching, with the role locator as fallback.
      let addItems = this.page.locator('button').filter({ hasText: /^\s*(Add Items|Add)\s*$/ })
        .filter({ hasNotText: /Add Files/i }).locator('visible=true').last();
      if (!(await addItems.isVisible({ timeout: 10_000 }).catch(() => false))) {
        const roleBtn = this.page.getByRole('button', { name: /(?:Add Items|Add)\s*$/ }).locator('visible=true').last();
        if (await roleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) addItems = roleBtn;
        else {
          const names = await this.page.locator('button').locator('visible=true').allTextContents().catch(() => []);
          console.log(`workerReceipt: Add Items button not found; visible buttons: ${JSON.stringify(names.map((s) => s.trim()).filter(Boolean))}`);
        }
      }
      if (await addItems.isVisible({ timeout: 1_000 }).catch(() => false)) {
        // the reliable "item landed" signal is the Worker Receipt Summary
        // panel's "No. of Items" counter - a page-wide tbody-tr check can hit
        // an unrelated table and false-pass. Retry the click until the counter
        // moves; fall back to the row check on pages without the counter.
        const itemsCount = async () => {
          const t = await this.page.getByText(/No\.?\s*of\s*Items/i).locator('xpath=ancestor::*[1]')
            .textContent({ timeout: 2_000 }).catch(() => '');
          const m = String(t).replace(/No\.?\s*of\s*Items/i, '').match(/(\d+)/);
          return m ? parseInt(m[1], 10) : null;
        };
        const before = await itemsCount();
        let added = false;
        for (let attempt = 1; attempt <= 3 && !added; attempt++) {
          await addItems.click();
          await this.settle(2_500);
          const now = await itemsCount();
          if (before === null || now === null) break; // no counter on this page
          added = now > before;
        }
        if (!added && before !== null && (await itemsCount()) !== null) {
          throw new Error(`Add Items never moved the item into the receipt - "No. of Items" stayed at ${before}`);
        }
        // the item must land as a grid row before Submit (QA lead, 02-09-2026)
        const addedRow = this.page
          .locator('table tbody tr')
          .filter({ hasNotText: /No pending/i })
          .locator('visible=true')
          .first();
        await addedRow.waitFor({ state: 'visible', timeout: 20_000 });
        console.log(`workerReceipt: item added to the grid (summary count: ${await itemsCount() ?? 'n/a'})`);
        await this.settle(1_500);
        // some builds enable the finalize toggle only once an item exists -
        // set it after the add when it did not stick before
        if (d.item.moveToJobFinalize && (await finalizeState()) !== true) {
          await clickFinalize();
          console.log(`workerReceipt: Move to Job Finalize (post-add) checked = ${await finalizeState()}`);
        }
        // saving a settlement WITHOUT the flag silently drops the job from
        // the Job Finalize queue and only the barcode step fails, 30 minutes
        // later (P178, 16-09-2026) - fail HERE instead
        if (d.item.moveToJobFinalize && (await finalizeState()) !== true) {
          throw new Error('workerReceipt: Move to Job Finalize did not stick (checkbox not checked) - saving would drop the job from the Job Finalize queue');
        }
      }
    } else {
      // ---- plain receipt: pending grid, selection is MANDATORY ----
      if (!(await this.selectRowOrFirst(d.rowText))) {
        console.log(`workerReceipt: nothing pending for ${d.process}/${d.worker} - already received, skipping`);
        return 'skipped';
      }
      // "Use Sample Weight": the SAMPLE receipt grid has an editable
      // "Used Gross Weight" input (a PrimeNG FROZEN-RIGHT column - the grid
      // splits rows across frozen sections, so a header-index -> td-index map
      // fails). Frozen cells carry the `pfrozencolumn` attribute; frozen-LEFT
      // cells (checkbox / Sl No) hold no text input, so the first text input in
      // any frozen cell is the Used Gross Weight of the (single) pending row.
      if (d.usedSampleWeight !== undefined) {
        // Best-effort: click the "Used Gross Weight" cell of the selected row to
        // enter inline edit, then type the consume amount. The grid is a
        // PrimeNG frozen-column table (rows split across sections), so target
        // the cell by matching the header column's x-range, then click+type.
        const done = await this.setUsedGrossWeight(d.rowText, d.usedSampleWeight).catch(() => false);
        if (done) {
          console.log(`workerReceipt: Used Gross Weight (use sample weight) = ${d.usedSampleWeight}`);
        } else {
          console.log('workerReceipt: could not set Used Gross Weight - proceeding with default (best-effort)');
        }
      }
    }

    // SAMPLE/REPAIR flows: the final receipt carries a finalize checkbox
    // instead of jobwork's "Move to Job Finalize" - checking it releases the
    // piece to Sample Receipt / Repair Receipt respectively. (Item-form
    // receipts already checked it before Add Items.)
    const finalizePattern = d.finalizeSample
      ? /Finalize Sample/i
      : d.finalizeRepair
        ? /(Repair Finalize|Finalize Repair)/i
        : null;
    if (finalizePattern && !this.finalizeChecked) {
      const ok = await this.checkFinalizeBox(finalizePattern);
      if (!ok) throw new Error(`finalize checkbox matching ${finalizePattern} never appeared on the receipt`);
    }
    this.finalizeChecked = false;

    await this.submitWorkerForm('worker receipt');
  }

  // ---------- 8. Job Finalize ----------
  /**
   * The Job Finalize page's "Generated Tags" view (this is where generated
   * tags are listed - the Barcode page's own list is lot progress only).
   * Returns the newest matching row's tag number - the YYYY-MM-DDserial
   * token (e.g. "2026-06-2300017" for P183/J393.1).
   */
  async readGeneratedTag(rowText) {
    await this.openRoute('/prd/app-job-finalize-list');
    await this.waitForIdle();
    const view = this.page.getByText(/^\s*Generated Tags\s*$/).locator('visible=true').first();
    await view.click({ timeout: 20_000 });
    await this.waitForIdle();
    for (let i = 0; i < 5; i++) {
      await this.settle(2_500);
      const row = this.rowMatcher(rowText).first();
      if (await row.isVisible().catch(() => false)) {
        const text = ((await row.innerText()) || '').replace(/\s+/g, ' ').trim();
        console.log(`Generated Tags row: ${text}`);
        const m = text.match(/\d{4}-\d{2}-\d{2}\d+/);
        return m ? m[0] : text.split(' ')[1];
      }
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await view.click({ timeout: 3_000 }).catch(() => {});
    }
    throw new Error(`Generated Tags (Job Finalize page) never listed a row matching ${JSON.stringify(rowText)}`);
  }

  async finalizeAndGenerateBarcode(d) {
    await this.openRoute('/prd/app-job-finalize-list');
    await this.waitForIdle();
    await this.settle(2_000);
    // the Finalize Queue pages (15/page over 2+ pages, newest first) - narrow
    // it by the queue's own Search box (nav-search-safe) so the row is found
    // regardless of page
    await this.narrowGrid(d.rowText);
    if (!(await this.rowExists(d.rowText, 15_000))) {
      throw new Error(`finalize: job "${d.rowText}" is NOT in the Job Finalize queue - the settlement receipt likely saved without "Move to Job Finalize" checked`);
    }
    await this.checkRow(d.rowText);
    await this.page.getByRole('button', { name: 'Generate Barcode' }).click();
    await this.waitForIdle();
    await this.settle(2_500);

    // Generate Barcode panel: Generate Type (SET TAG / SINGLE TAG) is
    // mandatory, then Submit & Generate creates the tag.
    const typeSel = this.page
      .locator('label')
      .filter({ hasText: 'Generate Type' })
      .last()
      .locator('xpath=following::ng-select[1]');
    await typeSel.locator('.ng-select-container').click();
    const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: d.generateType || 'SINGLE TAG' }).first();
    await opt.waitFor({ state: 'visible', timeout: 15_000 });
    await opt.click();
    await this.settle(1_500);

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /barcode|generate|tag/i.test(r.url()) && !/GetAll|Pagination|Sizes/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    const toast = this.watchSaveToast(130_000); // armed with the click
    await this.page.getByRole('button', { name: 'Submit & Generate' }).click();
    const r = await resp;
    await this.reportSaveToast('finalize barcode generation', toast);
    if (r) {
      const body = await r.json().catch(() => null);
      console.log('barcode generation:', r.status(), JSON.stringify(body).slice(0, 250));
      if (r.status() >= 400 || (body && body.errorCode)) {
        throw new Error(`Barcode generation rejected (HTTP ${r.status()}): ${body ? body.error || JSON.stringify(body).slice(0, 200) : ''}`);
      }
      return body;
    }
    console.log('barcode generation: no matching response captured - verify via Generated Tags');
    return null;
  }
  // ---------- CAD (Production > Planning > CAD, /prd/app-cad-setup) ----------
  /** Open the CAD page on the given tab ("Upload" | "Approval") and click Add. */
  async openCadTabAdd(tab) {
    await this.openRoute('/prd/app-cad-setup');
    await this.page.getByRole('tab', { name: tab, exact: true }).click();
    await this.waitForIdle();
    await this.settle(1_500);
    await this.clickAdd();
  }

  /**
   * CAD Upload: Worker + Production No (the job's J-series production no,
   * server-searched) + 3D Volume + Approx Weight (the two unlabeled number
   * inputs, in grid-column order) + optional 3D file path / description +
   * a reference image. Returns the save-response body.
   */
  async cadUpload({ worker, productionNo, volume3D = 12, approxWeight = 10, filePath3D = 'E2E/cad-model.stl', description = 'E2E CAD upload' }) {
    await this.openCadTabAdd('Upload');
    await this.pick('workerID', worker, { search: true });
    await this.pick('productionID', productionNo, { search: true });
    await this.settle(1_500);
    const numbers = this.page.locator('input[type="number"]:not([disabled])').locator('visible=true');
    await numbers.nth(0).fill(String(volume3D));
    await numbers.nth(1).fill(String(approxWeight));
    const filePath = this.page.locator('#filePath3D, input[formcontrolname="filePath3D"]').first();
    if (await filePath.isVisible({ timeout: 1_000 }).catch(() => false)) await filePath.fill(filePath3D);
    const desc = this.page.locator('#description, input[formcontrolname="description"], textarea').first();
    if (await desc.isVisible({ timeout: 1_000 }).catch(() => false)) await desc.fill(description);
    await this.attachImage(DEMO_FILES.image1);
    const invalidBefore = await this.invalidControls();
    if (invalidBefore.selects.length || invalidBefore.inputs.length) console.log(`cadUpload: still invalid before Submit: ${JSON.stringify(invalidBefore)}`);
    return this.submitAndCapture('CAD upload', /cad/i);
  }

  /**
   * CAD Approval: Worker + Production No (only jobs with an upload are
   * offered) -> the uploaded image card(s) render with a checkbox each;
   * tick the first, pick the approval Status (first option matching
   * /approv/i, logged), remarks when a remarks box exists, Submit.
   */
  async cadApprove({ worker, productionNo, status = /approv/i, remarks = 'E2E CAD approval' }) {
    await this.openCadTabAdd('Approval');
    await this.pick('worker', worker, { search: true });
    await this.pick('productionNo', productionNo, { search: true });
    await this.settle(2_000);
    // image card checkbox(es)
    const boxes = this.page.locator('input[type="checkbox"][id^="checkbox-"]');
    if (await boxes.count()) {
      const box = boxes.first();
      if (!(await box.isChecked({ timeout: 2_000 }).catch(() => false))) {
        await box.check({ force: true, timeout: 3_000 }).catch(() => this.page.locator('label[for="checkbox-0"]').click({ force: true }).catch(() => {}));
      }
      console.log(`cadApprove: image card checkbox checked = ${await box.isChecked({ timeout: 2_000 }).catch(() => '?')}`);
    } else {
      console.log('cadApprove: no image card checkbox rendered');
    }
    await this.settle(1_000);
    // approval status: the "status" select (controlname status, rendered after
    // the production no is picked) - take the option matching `status`
    const statusHost = this.select('status');
    await statusHost.waitFor({ state: 'visible', timeout: 15_000 });
    await this.closeStalePanels();
    await statusHost.locator('.ng-select-container').click();
    const opts = this.page.locator('.ng-dropdown-panel .ng-option');
    await opts.first().waitFor({ state: 'visible', timeout: 10_000 });
    const labels = (await opts.allTextContents()).map((t) => t.trim());
    const idx = labels.findIndex((l) => (status instanceof RegExp ? status.test(l) : l === status));
    if (idx < 0) throw new Error(`cadApprove: no status option matches ${status} - offered: ${JSON.stringify(labels)}`);
    console.log(`cadApprove: status options ${JSON.stringify(labels)} -> "${labels[idx]}"`);
    await opts.nth(idx).click();
    await this.settle(1_000);
    const remarksBox = this.page.getByRole('textbox', { name: /remarks/i }).first();
    if (await remarksBox.isVisible({ timeout: 1_000 }).catch(() => false)) await remarksBox.fill(remarks);
    return this.submitAndCapture('CAD approval', /cad/i);
  }

  // ---------- Material Transaction (Production > Operations, /prd/production-material-transaction-list) ----------
  async openMaterialTabAdd(tab) {
    await this.openRoute('/prd/production-material-transaction-list');
    await this.page.getByRole('tab', { name: tab, exact: true }).click();
    await this.waitForIdle();
    await this.settle(1_500);
    await this.clickAdd();
  }

  /** Header shared by Material Issue / Receipt / Clearance. */
  async fillMaterialHeader(d) {
    await this.pick('employeeID', d.employee, { search: true });
    await this.pick('departmentProcessID', d.process, { search: true });
    if (d.subProcess) {
      await this.pick('departmentSubProcessID', d.subProcess, { search: true })
        .catch((e) => console.log(`material: sub process pick skipped (${String(e).split('\n')[0]})`));
    }
    await this.pick('masterDataValueID_ProductionWorkerType', d.workerType || 'Inhouse Worker', { exact: true });
    await this.pick('vendorID', d.worker, { search: true });
    await this.pick('masterDataValueID_StockEntityType', d.stockEntityType || 'Material', { exact: true });
    if (d.stockIdentityType && (await this.select('masterDataValueID_StockIdentityType').count())) {
      await this.pick('masterDataValueID_StockIdentityType', d.stockIdentityType, { exact: true });
    }
    if (d.description) {
      const desc = this.page.locator('#description, input[formcontrolname="description"]').first();
      if (await desc.isVisible({ timeout: 1_000 }).catch(() => false)) await desc.fill(d.description);
    }
    await this.waitForIdle();
    await this.settle(2_500);
  }

  /** What the material form shows below the header - for the log and for the first live runs. */
  async describeMaterialGrid(label) {
    const info = await this.page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 6);
      const headings = [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${(i.closest('div')?.querySelector('label')?.textContent || i.placeholder || i.id || '').trim()}=${i.value}${i.disabled ? '(ro)' : ''}`);
      return { headings, headers, rows, inputs: inputs.slice(0, 25) };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  }

  /**
   * Material Issue: header (employee / process / sub process / worker type /
   * worker / stock entity / stock identity; the Locker auto-fills from the
   * employee), then the stock grid: tick the row matching rowText (or the
   * first row when no key is given), enter the issue weight when the row
   * exposes an editable weight cell, Submit. Returns the save body.
   */
  async materialIssue(d) {
    await this.openMaterialTabAdd('Issue');
    await this.fillMaterialHeader(d);
    await this.describeMaterialGrid('materialIssue grid');
    await this.selectMaterialRow(d.rowText, { weight: d.weight, assignType: d.assignType || /^Production$/i, productionNo: d.productionNo });
    return this.submitAndCapture('material issue', /material/i);
  }

  /** Material Receipt: same header (plus Access Locker when offered) -> tick the issued row -> Submit. */
  async materialReceipt(d) {
    await this.openMaterialTabAdd('Receipt');
    await this.fillMaterialHeader(d);
    if (d.locker && (await this.select('lockerID').count())) {
      await this.pick('lockerID', d.locker, { search: true }).catch((e) => console.log(`material receipt: locker pick skipped (${String(e).split('\n')[0]})`));
    }
    await this.describeMaterialGrid('materialReceipt grid');
    await this.selectMaterialRow(d.rowText, { weight: d.weight, assignType: d.assignType, productionNo: d.productionNo, prefer: d.prefer });
    return this.submitAndCapture('material receipt', /material/i);
  }

  /**
   * Tick the stock/job row keyed by rowText (string, regex or array of
   * keys) in the form's grid - body rows only (the header carries a disabled
   * "All items" checkbox) - then commit it with the grid's Add button when
   * one is offered ("Added Metal Entries" fills from it). First row when no
   * key is given.
   */
  async selectMaterialRow(rowText, { weight, assignType, productionNo, prefer } = {}) {
    const body = this.page.locator('tbody tr').locator('visible=true').filter({ has: this.page.locator('input[type="checkbox"]:not([disabled])') });
    if (!(await body.count())) {
      const empty = await this.page.getByText(/No Data|No records/i).first().textContent().catch(() => '');
      throw new Error(`material: the grid offers no selectable row (${(empty || 'no empty-state text').trim()})`);
    }
    let row = body.first();
    if (rowText) {
      const keys = (Array.isArray(rowText) ? rowText : [rowText]).filter(Boolean);
      // an array of RegExps is an ORDERED list of fallbacks (the locker's
      // stock rows drift between runs: an article gets used up, returned
      // metal lands under another metal type); an array of strings is "any
      // of these" as before
      const patterns = keys.every((k) => k instanceof RegExp)
        ? keys
        : [new RegExp(keys.map((k) => String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')];
      // match on the normalised row text in JS (cells are newline-separated
      // in the DOM text, which defeats a locator-level regex)
      const rows = (await body.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      const grossOf = (t) => { const m = t.match(/\)\s+([0-9]+\.[0-9]{3})/) || t.match(/\b([0-9]+\.[0-9]{3})\b/); return m ? Number(m[1]) : 0; };
      let candidates = [];
      for (const [n, re] of patterns.entries()) {
        candidates = rows.map((t, i) => ({ t, i, gross: grossOf(t) })).filter((c) => re.test(c.t));
        if (candidates.some((c) => c.gross > 0)) candidates = candidates.filter((c) => c.gross > 0); // skip used-up rows when a live one exists
        if (candidates.length) {
          if (n > 0) console.log(`material: no row for ${String(patterns[0])} - fell back to pattern ${n + 1} (${String(re)})`);
          break;
        }
      }
      if (!candidates.length) {
        throw new Error(`material: no grid row matches ${patterns.map(String).join(' / ')} - rows offered: ${JSON.stringify(rows.map((t) => t.slice(0, 120)))}`);
      }
      candidates.sort((a, b) => b.gross - a.gross);
      row = body.nth(candidates[0].i);
      this.lastMaterialRow = await this.describeRow(row);
      if (weight !== undefined && candidates[0].gross > 0 && Number(weight) > candidates[0].gross) {
        console.log(`material: requested ${weight} exceeds the row's ${candidates[0].gross} - capped to the available weight`);
        weight = candidates[0].gross;
      }
    }
    const box = row.locator('input[type="checkbox"]:not([disabled])').first();
    if (!(await box.isChecked({ timeout: 2_000 }).catch(() => false))) {
      await box.check({ force: true, timeout: 5_000 }).catch(() => box.click({ force: true }));
    }
    await this.settle(1_500);
    console.log(`material: row selected -> ${(await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`);
    // commit the selection into the "Added ... Entries" grid when an Add
    // button (not Add Files / Add Image) is offered
    const add = this.page.locator('button').filter({ hasText: /^\s*\+?\s*Add(\s+\d+|\s+Items?|\s+to\s+\w+)?\s*$/i }).locator('visible=true').last();
    if (await add.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await add.click();
      await this.settle(2_000);
      console.log('material: grid Add pressed');
      const handled = await this.completeConfigureDialog({ weight, assignType, productionNo });
      if (!handled) await this.completeDetailEntryDialog({ weight, prefer });
    }
    await this.describeMaterialGrid('material grid after selection');
  }

  /**
   * The visible cells of a grid row keyed by their column headers, e.g.
   * { "Metal Type": "Met Stone Setting 5", "Article": "Gold,Ring-Tendulkar",
   *   "Purity": "91.60 (22 Karat Gold)", "Gross Weight": "5.000" }.
   */
  async describeRow(row) {
    const cells = await row.locator('td').locator('visible=true').allInnerTexts().catch(() => []);
    const headers = await row.locator('xpath=ancestor::table[1]//th').locator('visible=true').allInnerTexts().catch(() => []);
    const clean = (t) => t.replace(/ Sort Ascending.*$/, '').replace(/\s+/g, ' ').trim();
    const out = {};
    headers.forEach((h, i) => { if (clean(h) && cells[i] !== undefined) out[clean(h)] = clean(cells[i]); });
    return out;
  }

  /**
   * The "Metal Detail Entry - Gold / 91.6" dialog the Material RECEIPT grid's
   * Add opens: Item Details (read-only), Classification (production category
   * and the env-configured description dropdowns), Weight Details (Balance
   * Gross Weight read-only + the RECEIVED gross weight input), Wastage &
   * Making (optional), then "Add to Grid". Mandatory selects get their first
   * offered option; the received weight defaults to the full balance.
   */
  async completeDetailEntryDialog({ weight, prefer } = {}) {
    const dlg = this.page.locator('.modal, ngb-modal-window, [role="dialog"], .offcanvas').filter({ hasText: /Detail Entry/i }).last();
    if (!(await dlg.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.log('material: no Detail Entry dialog opened');
      return false;
    }
    const balanceInput = dlg.locator('xpath=.//*[normalize-space(text())="Balance Gross Weight"]/following::input[1]').first();
    const balance = Number((await balanceInput.inputValue().catch(() => '')) || 0);
    const received = weight !== undefined ? Number(weight) : balance;
    // the received gross weight is the editable input right after the
    // read-only Balance Gross Weight
    const receivedInput = dlg.locator('xpath=.//*[normalize-space(text())="Balance Gross Weight"]/following::input[not(@disabled)][1]').first();
    for (let round = 0; round < 3; round++) {
      const filled = await this.fillDialogMandatorySelects(dlg, {
        receiptPurityID: /91\.6/, // the item's purity, not the first purity in the master
        metalStoneSettingID: /Metal Stone Setting 4/i, // the issued stock row's metal type ...
        productArticleID: /Tendulkar/i, // ... and article, so the metal returns to the SAME stock row
        ...(prefer || {}), // the caller knows which row was actually issued
      });
      if (await receivedInput.count()) {
        await receivedInput.fill(String(received));
        await receivedInput.blur();
        await this.settle(1_500);
      }
      if (!filled) break;
    }
    const net = await dlg.locator('xpath=.//*[normalize-space(text())="Net Weight (Gram)"]/following::input[1]').first().inputValue().catch(() => '?');
    const pure = await dlg.locator('xpath=.//*[normalize-space(text())="Pure Weight (Gram)"]/following::input[1]').first().inputValue().catch(() => '?');
    const enteredWeight = await receivedInput.inputValue().catch(() => '?');
    console.log(`material detail entry: balance ${balance} -> received ${received} (input now "${enteredWeight}"), net ${net}, pure ${pure}`);
    const addToGrid = dlg.locator('button').filter({ hasText: /Add to Grid/i }).last();
    await addToGrid.click();
    let closed = await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!closed) {
      const invalid = await dlg.evaluate((d) => ({
        selects: [...d.querySelectorAll('sioniq-ng-select, ng-select')].filter((n) => (n.matches('ng-select') ? n : n.querySelector('ng-select'))?.classList.contains('ng-invalid') && n.offsetParent).map((n) => n.getAttribute('controlname') || n.closest('div')?.textContent.trim().slice(0, 30)),
        inputs: [...d.querySelectorAll('input.ng-invalid')].filter((i) => i.offsetParent).map((i) => (i.closest('div')?.parentElement?.querySelector('label, span')?.textContent || i.id || i.placeholder || i.type).trim().slice(0, 40) + '=' + i.value),
        messages: [...d.querySelectorAll('[role=alert], .text-danger, .invalid-feedback')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 5),
      })).catch(() => null);
      console.log(`material detail entry: dialog still open after Add to Grid - ${JSON.stringify(invalid)}`);
      await this.fillDialogMandatorySelects(dlg);
      await addToGrid.click().catch(() => {});
      closed = await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false);
    }
    await this.settle(1_500);
    return closed;
  }

  /** First offered option into every still-invalid select INSIDE a dialog. Returns how many were filled. */
  async fillDialogMandatorySelects(dlg, prefer = {}) {
    let filled = 0;
    for (let i = 0; i < 12; i++) {
      const invalid = dlg.locator('ng-select.ng-invalid').locator('visible=true').first();
      if (!(await invalid.count())) break;
      const label = await invalid.evaluate((n) => (n.closest('[controlname]')?.getAttribute('controlname') || n.closest('div')?.parentElement?.querySelector('label, .form-label, span')?.textContent || '').trim().slice(0, 40)).catch(() => '');
      await this.closeStalePanels();
      await invalid.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
      await this.settle(900);
      const all = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Type to search/i });
      const want = Object.entries(prefer).find(([ctl]) => label === ctl || label.includes(ctl));
      let preferred = want ? all.filter({ hasText: want[1] }).first() : null;
      if (preferred && !(await preferred.count())) {
        // long lists are virtual-scrolled: only the first screen of options is
        // rendered, so type the wanted text to filter the panel (22-09-2026:
        // the article "Tendulkar" sat below the fold and the first option won)
        const typed = (want[1] instanceof RegExp ? want[1].source : String(want[1])).replace(/\\(.)/g, '$1').replace(/[^\w .,-]/g, ' ').trim();
        if (typed) {
          await invalid.locator('input[type="text"], input[role="combobox"]').first().fill(typed).catch(() => {});
          await this.settle(900);
          preferred = all.filter({ hasText: want[1] }).first();
          console.log(`dialog mandatory select "${label}": typed "${typed}" to reach the preferred option (${await preferred.count()} match)`);
        }
      }
      const opt = preferred && (await preferred.count()) ? preferred : all.first();
      if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
        console.log(`dialog mandatory select "${label}" -> ${((await opt.textContent()) || '').trim()}`);
        await opt.click().catch(() => {});
        filled++;
        await this.settle(800);
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
        console.log(`dialog mandatory select "${label}" offered nothing`);
        break;
      }
    }
    return filled;
  }

  /**
   * The "Metal - Configure" dialog the material grid's Add opens: Item
   * Details (read-only), Assign Details (Assign Type select, mandatory),
   * Weight Details (Gross Weight editable - the quantity to issue; net /
   * pure recompute), Alloy Details (Add Alloy checkbox), then the dialog's
   * own Add moves the entry into "Added Metal Entries".
   */
  async completeConfigureDialog({ weight, assignType, productionNo } = {}) {
    const dlg = this.page.locator('.modal, ngb-modal-window, [role="dialog"], .offcanvas').filter({ hasText: /Configure/i }).last();
    if (!(await dlg.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.log('material: no Configure dialog opened');
      return false;
    }
    const assign = dlg.locator('ng-select').first();
    if (await assign.count()) {
      await assign.locator('.ng-select-container').click();
      const opts = this.page.locator('.ng-dropdown-panel .ng-option');
      await opts.first().waitFor({ state: 'visible', timeout: 10_000 });
      const labels = (await opts.allTextContents()).map((t) => t.trim());
      let idx = assignType ? labels.findIndex((l) => (assignType instanceof RegExp ? assignType.test(l) : l === assignType)) : -1;
      if (idx < 0) idx = 0;
      console.log(`material configure: Assign Type options ${JSON.stringify(labels)} -> "${labels[idx]}"`);
      await opts.nth(idx).click();
      await this.settle(1_000);
    }
    // "Production" reveals a Production No select - pick the chain's job
    const prodSel = dlg.locator('xpath=.//*[normalize-space(text())="Production No"]/following::ng-select[1]').first();
    if (await prodSel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      if (!productionNo) throw new Error('material configure: the dialog asks for a Production No but the chain has none');
      const core = String(productionNo).split('.')[0];
      let done = false;
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        await this.closeStalePanels();
        await prodSel.locator('.ng-select-container').click();
        await prodSel.locator('input[role="combobox"]').fill(core).catch(() => {});
        await this.settle(2_000);
        const popts = this.page.locator('.ng-dropdown-panel .ng-option');
        const plabels = (await popts.allTextContents()).map((t) => t.trim());
        const pidx = plabels.findIndex((l) => l.startsWith(core));
        if (pidx >= 0) {
          await popts.nth(pidx).click();
          done = true;
          console.log(`material configure: Production No -> "${plabels[pidx]}"`);
        } else {
          console.log(`material configure: Production No attempt ${attempt} offered ${JSON.stringify(plabels.slice(0, 8))}`);
          await this.page.keyboard.press('Escape');
        }
      }
      if (!done) throw new Error(`material configure: production no ${productionNo} not offered in the dialog`);
      await this.settle(1_000);
    }
    if (weight !== undefined) {
      const gross = dlg.locator('xpath=.//*[normalize-space(text())="Gross Weight"]/following::input[1]').first();
      if (await gross.count()) {
        await gross.fill(String(weight));
        await gross.blur();
        await this.settle(1_500);
        const net = await dlg.locator('xpath=.//*[normalize-space(text())="Net Weight"]/following::input[1]').first().inputValue().catch(() => '?');
        const pure = await dlg.locator('xpath=.//*[normalize-space(text())="Pure Weight"]/following::input[1]').first().inputValue().catch(() => '?');
        console.log(`material configure: gross ${weight} -> net ${net}, pure ${pure}`);
      } else {
        console.log('material configure: no Gross Weight input found in the dialog');
      }
    }
    const dlgAdd = dlg.locator('button').filter({ hasText: /\bAdd\s*$/ }).filter({ hasNotText: /Alloy|Files|Image/ }).last();
    await dlgAdd.click();
    const closed = await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).then(() => true).catch(() => false);
    if (!closed) {
      const alerts = (await dlg.locator('[role=alert], .text-danger, .invalid-feedback').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
      console.log(`material configure: dialog still open after Add - invalid: ${JSON.stringify(await this.invalidControls())}; messages: ${JSON.stringify(alerts)}`);
      await dlgAdd.click().catch(() => {});
      await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    }
    await this.settle(1_500);
    return true;
  }

  /** Enter a weight into the first editable weight input of the selected row / item panel. */
  async fillMaterialWeight(weight, row) {
    const scoped = row ? row.locator('input[type="number"]:not([disabled]), input[type="text"]:not([disabled]):not([role="combobox"])') : this.page.locator('nothing-here');
    const input = (await scoped.count())
      ? scoped.first()
      : this.page.locator('tbody tr input[type="number"]:not([disabled]), input[type="number"]:not([disabled])').locator('visible=true').first();
    if (await input.count()) {
      await input.fill(String(weight));
      await input.blur();
      await this.settle(1_000);
      console.log(`material: weight ${weight} entered`);
    } else {
      console.log('material: no editable weight input found - leaving the row weight as offered');
    }
  }

  /**
   * Submit the current form and capture its save response (POST matching
   * urlPattern, not a grid/pagination call). Logs invalid controls and the
   * toast when nothing fires within 25 s, then clicks once more.
   */
  async submitAndCapture(what, urlPattern) {
    const noise = /GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation|Get[A-Z]/;
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && urlPattern.test(r.url()) && !noise.test(r.url()),
      { timeout: 120_000 },
    );
    resp.catch(() => {});
    const submit = this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last();
    await submit.click();
    let r = await Promise.race([resp, this.page.waitForTimeout(25_000).then(() => null)]);
    if (!r) {
      const invalid = await this.invalidControls();
      const alerts = (await this.page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
      console.log(`${what}: no save request after 25 s - invalid: ${JSON.stringify(invalid)}; alerts: ${JSON.stringify(alerts)} - retrying Submit`);
      await submit.click().catch(() => {});
      r = await resp;
    }
    const body = await r.json().catch(() => null);
    console.log(`${what} save: ${r.status()} ${r.url().split('/sioniq/')[1]} ${JSON.stringify(body).slice(0, 220)}`);
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`${what} rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    }
    await this.waitForIdle();
    await this.settle(2_000);
    await this.closeVisibleDialog();
    return body;
  }

}

module.exports = { ProductionWorkflowPage };
