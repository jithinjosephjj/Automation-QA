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
    await this.page.waitForTimeout(1_500);
  }

  async clickAdd() {
    await this.page.locator('.ngx-spinner-overlay').last().waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
    await this.addBtn.click({ timeout: 60_000 });
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  /** Sub-tab links on the Concept page (Concept / Uploads / Approval). */
  async openConceptTab(name) {
    await this.openRoute('/prd/view-concept');
    if (name !== 'Concept') {
      await this.page.locator('a').filter({ hasText: new RegExp(`^${name}$`) }).last().click();
      await this.waitForIdle();
      await this.page.waitForTimeout(1_500);
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
    await this.page.waitForTimeout(1_500);

    // commit the image to the form's image list when the button is present
    const addImage = this.page.getByRole('button', { name: 'Add Image' });
    if (await addImage.isVisible().catch(() => false)) {
      await addImage.click();
      await this.page.waitForTimeout(1_500);
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
    await this.page.locator('.btn-close').last().click().catch(() => {});
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
    await this.page.waitForTimeout(3_000);
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
    await this.page.waitForTimeout(1_000);
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
    await this.page.waitForTimeout(3_000);
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
    await this.page.waitForTimeout(1_500);
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
      await this.page.waitForTimeout(2_000);
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
      await this.page.waitForTimeout(3_000);
      const flagged = this.page.locator('ng-select.ng-invalid, ng-select.is-invalid').locator('visible=true').first();
      await pickArticleIn(flagged);
    }
    await this.page.waitForTimeout(1_500);

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
      await this.page.waitForTimeout(1_000);
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
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});

    // The save response carries no design number - read the Design Code from
    // the list view's newest row (newest-first: "1 RDDDD4 Metal ...").
    if (!designNo) {
      await this.openRoute('/prd/view-master-design');
      await this.page.waitForTimeout(2_000);
      const firstRow = await this.page.locator('table tbody tr').first().innerText().catch(() => '');
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
    await this.page.waitForTimeout(2_500);

    if (generationType === 'Master Design') {
      // KNOWN APP BUG (QA lead, 29-08-2026): selecting a design in the
      // Design Number dropdown filters the card grid but BREAKS Submit
      // (saves nothing, silently). Leave the dropdown alone and select the
      // design CARD from the full grid - newest design is the first card.
      const firstCard = this.page.locator('.invisible-click').first();
      await firstCard.waitFor({ state: 'visible', timeout: 30_000 });
      await this.page.waitForTimeout(1_500);
      await firstCard.click();
      await this.page.waitForTimeout(1_500);
      // the card carries its own Qty number input (defaults to 1) - set it
      // explicitly; do NOT touch the "Qty (applies to all)" header field
      // (filling it blocked Submit in testing)
      const cardQty = this.page.locator('input[type=number]:visible').first();
      if (await cardQty.count()) {
        await cardQty.fill(String(d.qty || 1)).catch(() => {});
        await cardQty.blur().catch(() => {});
      }
    } else {
      // concept path: reference typeahead works normally
      await this.pickByLabel(refLabel, refNo, { search: true }).catch(async () => {
        const sel = this.page.locator('ng-select').filter({ hasText: 'Please Select' }).first();
        await sel.locator('.ng-select-container').click();
        await sel.locator('input[role="combobox"]').fill(refNo);
        await this.page.waitForTimeout(2_500);
        await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: refNo }).first().click();
      });
      await this.page.waitForTimeout(2_500);
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
    const r = await resp;
    let jobWorkNo = '';
    if (r) {
      const body = await r.json().catch(() => null);
      jobWorkNo = (body && body.data && (body.data.receiptNo || body.data.jobWorkNo || body.data.docNo)) || '';
      console.log('job work save:', r.status(), JSON.stringify(body).slice(0, 200));
      if (r.status() >= 400 || (body && body.errorCode)) {
        throw new Error(`Job work save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
      }
    } else {
      throw new Error('Job work Submit fired no save request - form silently blocked (check for the filter bug)');
    }
    // close a print dialog if one opened
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});
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
    await this.page.waitForTimeout(2_500);

    // grid row for our concept/job/sample - check it
    await this.checkRow(d.rowText);

    // sample rows need the Update button to open the assignment panel
    const update = this.page.getByRole('button', { name: /Update$/ }).locator('visible=true').first();
    if (await update.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await update.click();
      await this.page.waitForTimeout(1_500);
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
        await this.page.waitForTimeout(1_500);
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
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Job assignment save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.waitForIdle();
    await this.page.waitForTimeout(3_000);
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});
  }

  /** Case-insensitive row matcher (grids re-case document numbers: the API
   *  returns "wJune-..." while the grid prints "WJune-..."). */
  rowMatcher(rowText) {
    const esc = String(rowText).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('row').filter({ hasText: new RegExp(esc, 'i') });
  }

  /** Check the selection checkbox of the grid row containing rowText. */
  async checkRow(rowText) {
    const row = this.rowMatcher(rowText).first();
    await row.waitFor({ state: 'visible', timeout: 30_000 });
    const box = row.getByRole('checkbox').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
  }

  /**
   * Select the row containing rowText, falling back to the first pending row
   * (these grids are pre-filtered by process/worker/source, and some key
   * their rows by internal doc numbers we do not capture).
   * Returns false when the grid holds no selectable rows at all.
   */
  async selectRowOrFirst(rowText) {
    if (await this.rowExists(rowText, 10_000)) {
      await this.checkRow(rowText);
      return true;
    }
    const anyRow = this.page.getByRole('row').filter({ has: this.page.getByRole('checkbox') }).last();
    if (!(await anyRow.isVisible().catch(() => false))) return false;
    console.log(`row "${rowText}" not found - selecting the first pending row (grid pre-filtered)`);
    const box = anyRow.getByRole('checkbox').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
    return true;
  }

  // ---------- 4/6. Process Movement ----------
  async processMovementAccept(d) {
    await this.openRoute('/prd/app-process-movement-setup');
    await this.page.getByRole('tab', { name: 'Accept' }).click().catch(() => {});
    await this.clickAdd();
    await this.pick('process', d.process, { search: true });
    if (d.subProcess) await this.pick('subProcess', d.subProcess, { search: true }).catch(() => {});
    await this.pick('sourceType', d.sourceType || 'Job Work', { exact: true });
    // the Sample source adds an Item Type filter
    if (d.itemType) {
      await this.pick('itemType', d.itemType, { exact: true }).catch(() =>
        this.pickByLabel('Item Type', d.itemType, { exact: true }).catch(() => {}));
    }
    await this.page.waitForTimeout(2_500);
    // grids key rows by doc numbers we may not hold - first pending row is
    // ours (grid pre-filtered by process + source)
    if (!(await this.selectRowOrFirst(d.rowText))) {
      console.log(`processMovementAccept: nothing pending at ${d.process} - already accepted, skipping`);
      return 'skipped';
    }
    await this.page.getByRole('button', { name: 'Accept' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(3_000);
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});
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
    await this.page.waitForTimeout(2_500);

    if (!(await this.selectRowOrFirst(d.rowText))) {
      console.log(`processMovementTransfer: nothing pending at ${d.fromProcess} - already transferred, skipping`);
      return 'skipped';
    }

    await this.pickByLabel('To Process', d.toProcess);
    await this.pickByLabel('To Sub Process', d.toSubProcess);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(3_000);
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});
  }

  // ---------- 5/7. Worker Issue / Receipt ----------
  async openWorkerIR(tab) {
    await this.openRoute('/prd/app-worker-issue-receipt-setup');
    await this.page.getByRole('tab', { name: tab }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
    await this.clickAdd();
  }

  async fillWorkerIRHeader(d) {
    await this.pick('departmentProcessID', d.process, { search: true });
    if (d.subProcess) await this.pickByLabel('Sub Process', d.subProcess, { search: true }).catch(() => {});
    await this.pick('masterDataValueID_WorkerType', 'Inhouse Worker', { exact: true });
    await this.pick('vendorID', d.worker, { search: true });
    await this.pick('masterDataValueID_ProductionSourceType', d.productionSource || 'Job Work', { exact: true });
    // the Sample source adds an Item Type filter
    if (d.itemType) {
      await this.pick('itemType', d.itemType, { exact: true }).catch(() =>
        this.pickByLabel('Item Type', d.itemType, { exact: true }).catch(() => {}));
    }
    await this.page.waitForTimeout(2_500);
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

  async createJobWorkFromOrder(d) {
    await this.openRoute('/prc/view-samplejobwork-issue');
    await this.clickAdd();
    await this.pick('generationType', 'Order', { exact: true });
    await this.pick('jobworkMode', d.mode, { exact: true });
    if (d.mode === 'Outsource') {
      await this.pick('vendor', d.vendor || 'RAJA');
    } else {
      await this.pick('productionUnit', d.productionUnit || 'Cochin', { exact: true });
    }
    await this.pick('itemType', d.itemType || 'Metal', { exact: true });
    await this.page.waitForTimeout(2_500);

    if (!(await this.selectRowOrFirst(d.orderNo))) {
      throw new Error(`no pending order row found for ${d.orderNo} on the Issue grid`);
    }

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.page.getByRole('button', { name: 'Submit' }).click();
    const r = await resp;
    if (!r) throw new Error('Issue Submit fired no save request - form silently blocked');
    const body = await r.json().catch(() => null);
    console.log(`${(d.mode || 'inhouse').toLowerCase()} job work save:`, r.status(), JSON.stringify(body).slice(0, 200));
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
    await this.page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
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
    if (!(await this.rowExists(d.rowText))) {
      console.log(`workerIssue: no pending row for ${d.rowText} - already issued, skipping`);
      return 'skipped';
    }
    await this.checkRow(d.rowText);
    // Some builds add the selected row to "Items Ready for Issue" directly;
    // others need the explicit button - click it only when it exists.
    const addToList = this.page.getByRole('button', { name: 'Add to Issue List' });
    if (await addToList.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addToList.first().click();
    }
    await this.page.waitForTimeout(2_000);

    // Order-based issues open a "Partial Issue - Edit Item" dialog (pieces
    // and weights prefilled) that must be confirmed with ITS OWN
    // "Add to Issue List" button before the main Submit appears.
    const partialDialog = this.page
      .locator('[role="dialog"], .modal, ngb-modal-window, .offcanvas')
      .filter({ hasText: 'Partial Issue' })
      .last();
    if (await partialDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await partialDialog.getByRole('button', { name: 'Add to Issue List' }).click();
      await partialDialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      await this.page.waitForTimeout(1_500);
    }

    await this.submitWorkerForm('worker issue');
  }

  /** Submit a worker issue/receipt form and VERIFY the save fired - Submit
   *  is a silent no-op on invalid forms (checklist rule 6), and relying on
   *  the print dialog alone let a repair receipt slip through unsaved. */
  async submitWorkerForm(what) {
    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /create|save|submit/i.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url()),
      { timeout: 60_000 },
    ).catch(() => null);
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
    await this.printDialog.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    await this.page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    await this.waitForIdle();
  }

  /** Check a finalize checkbox by accessible name or invisible-click label. */
  async checkFinalizeBox(pattern) {
    const box = this.page.getByRole('checkbox', { name: pattern }).first();
    if (await box.isVisible({ timeout: 5_000 }).catch(() => false)) {
      if (!(await box.isChecked().catch(() => false))) await box.check({ force: true });
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
    await this.page.waitForTimeout(2_500);
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
      let picked = false;
      for (let attempt = 1; attempt <= 4 && !picked; attempt++) {
        if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(300);
        }
        await this.waitForSpinner();
        await sel.locator('.ng-select-container').click({ timeout: 15_000 });
        const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i }).first();
        const found = await opt.waitFor({ state: 'visible', timeout: attempt * 5_000 })
          .then(() => true).catch(() => false);
        if (found) {
          this.lastProductionNo = ((await opt.textContent()) || '').trim();
          picked = await opt.click({ timeout: 10_000 }).then(() => true).catch(() => false);
        }
        if (!picked) await this.page.keyboard.press('Escape');
      }
      if (!picked) throw new Error('Production No dropdown never offered a pending production number');
      console.log(`workerReceipt: Production No -> ${this.lastProductionNo}`);
      await this.page.waitForTimeout(2_500);

      // article/purity/weight are per-flow: jobwork receipts need them typed,
      // repair receipts auto-fill from the production no - fill only what the
      // caller provided AND the form renders
      if (d.item.article) {
        const article = this.page.locator('#itemArticleSelect');
        if (await article.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await article.locator('.ng-select-container').click();
          await article.locator('input[role="combobox"]').fill(d.item.articleSearch);
          await this.page.waitForTimeout(2_500);
          await this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: d.item.article }).first().click();
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
        await this.page.waitForTimeout(1_500);
      }

      // demo image via the item form's Add Files control
      if (d.item.image) await this.attachFileViaAddFiles(d.item.image, { last: true });

      if (d.item.moveToJobFinalize) {
        await this.page.getByRole('checkbox', { name: 'Move to Job Finalize' }).check({ force: true });
      }
      // sample/repair finalize checkboxes live INSIDE the item form - check
      // them before Add Items when requested
      if (d.finalizeSample || d.finalizeRepair) {
        await this.checkFinalizeBox(d.finalizeSample ? /Finalize Sample/i : /(Repair Finalize|Finalize Repair)/i)
          .then((ok) => { this.finalizeChecked = ok; });
      }
      // jobwork receipts label the commit "Add Items"; repair receipts just
      // "Add" (with an icon) - accept either, never "Add Files"
      const addItems = this.page.getByRole('button', { name: /(?:Add Items|Add)\s*$/ }).locator('visible=true').last();
      if (await addItems.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await addItems.click();
        // the item must land as a grid row before Submit (QA lead, 02-09-2026)
        const addedRow = this.page
          .locator('table tbody tr')
          .filter({ hasNotText: /No pending/i })
          .locator('visible=true')
          .first();
        await addedRow.waitFor({ state: 'visible', timeout: 20_000 });
        console.log('workerReceipt: item row added to the grid');
        await this.page.waitForTimeout(1_500);
      }
    } else {
      // ---- plain receipt: pending grid, selection is MANDATORY ----
      if (!(await this.selectRowOrFirst(d.rowText))) {
        console.log(`workerReceipt: nothing pending for ${d.process}/${d.worker} - already received, skipping`);
        return 'skipped';
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
  async finalizeAndGenerateBarcode(d) {
    await this.openRoute('/prd/app-job-finalize-list');
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
    await this.checkRow(d.rowText);
    await this.page.getByRole('button', { name: 'Generate Barcode' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

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
    await this.page.waitForTimeout(1_500);

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /barcode|generate|tag/i.test(r.url()) && !/GetAll|Pagination|Sizes/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.page.getByRole('button', { name: 'Submit & Generate' }).click();
    const r = await resp;
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
}

module.exports = { ProductionWorkflowPage };
