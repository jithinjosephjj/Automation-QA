const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Process & Sub-Process master data — HRM > Department > Process /
 * Sub-Process. Route: /hrm/department-setup (probed live 05-09-2026).
 *
 * The Department setup screen is a TAB strip: Department | Designation |
 * Level | Process | Sub-Process | Process Mapping. Each tab is its own
 * list + icon Add button; Add opens a right-side offcanvas form with a
 * Clear / Submit footer.
 *
 * Process add form (controlnames verified live):
 *   name, shortName (inputs) · department, selectedLocations (multi "Locations")
 *   · Material Issue / Material Receipt / Material Clearance / Process Type
 *   (label-only sioniq-ng-selects, no controlname) · allowSubProcess, active
 *   (checkboxes, id == formcontrolname).
 *
 * Sub-Process add form:
 *   name, shortName · department, process (parent), location, configuration
 *   · active.
 *
 * Silent-failure defence (checklist): every Submit is verified by the save
 * response; any still-empty mandatory select is filled with its first option
 * so the form can never be blocked by an untouched dropdown we didn't know
 * about; the record is then confirmed in the tab's list view.
 */
class DepartmentProcessPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Process');
    this.submitApiPattern = /CreateDepartmentProcess|CreateDepartmentSubProcess/i;
  }

  async open() {
    await this.goto('/hrm/department-setup');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await this.waitForSpinner();
  }

  /** The open add/edit offcanvas panel. */
  get panel() {
    return this.page.locator('.offcanvas.show, ngb-offcanvas-panel').last();
  }

  /** Switch to a tab by its visible name (Process / Sub-Process / ...). */
  async selectTab(tabName) {
    await this.waitForSpinner();
    await this.page.getByRole('tab', { name: new RegExp(`^${tabName}$`) }).first().click({ timeout: 20_000 });
    await this.waitForIdle();
    await this.page.waitForTimeout(1_500);
  }

  /** Open the Add offcanvas for the current tab. */
  async openAdd() {
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: 30_000 });
    await this.panel.locator('[formcontrolname="name"]').first().waitFor({ state: 'visible', timeout: 20_000 });
    await this.page.waitForTimeout(800);
  }

  input(controlname) {
    return this.panel.locator(`[formcontrolname="${controlname}"]`).first();
  }

  /**
   * Close an open ng-select dropdown WITHOUT pressing Escape. Escape dismisses
   * the whole ngb-offcanvas, so we click a neutral spot inside the panel (the
   * header / a static label) to blur the combobox instead.
   */
  async closeDropdown() {
    if (!(await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false))) return;
    const neutral = this.panel
      .locator('.offcanvas-title, .offcanvas-header, label:text-is("Name")')
      .first();
    await neutral.click({ timeout: 3_000, force: true, position: { x: 2, y: 2 } }).catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /**
   * Escape-free pick inside the offcanvas. `multi` leaves the option list open
   * after selecting (then we close it neutrally); `search` types into the
   * combobox first; `first` just takes the first real option.
   */
  async pickInPanel(controlname, optionText, { exact = false, search = false, multi = false, first = false } = {}) {
    const wrap = this.panel.locator(`sioniq-ng-select[controlname="${controlname}"] ng-select`).first();
    const pattern = exact
      ? new RegExp(String.raw`^\s*` + escapeRe(optionText) + String.raw`\s*$`)
      : new RegExp(escapeRe(optionText), 'i');
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.closeDropdown();
      await wrap.locator('.ng-select-container').click().catch(() => {});
      if (search) {
        await wrap.locator('input[role="combobox"]').fill(optionText).catch(() => {});
        await this.page.waitForTimeout(1_800);
      }
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Select all/i });
      const target = first ? opts.first() : opts.filter({ hasText: pattern }).first();
      if (await target.isVisible({ timeout: attempt * 3_000 }).catch(() => false)) {
        if (await target.click({ timeout: 8_000 }).then(() => true).catch(() => false)) {
          if (multi) await this.closeDropdown();
          await this.page.waitForTimeout(500);
          return true;
        }
      }
      await this.closeDropdown();
    }
    throw new Error(`Option "${optionText}" never appeared in offcanvas select "${controlname}"`);
  }

  /** Check / uncheck a form checkbox reached by its id (== formcontrolname). */
  async ensureCheck(id, checked = true) {
    const box = this.panel.locator(`#${id}`).first();
    if (!(await box.count())) return;
    const state = await box.isChecked().catch(() => null);
    if (state === checked) return;
    // styled checkboxes swallow clicks - try the label, then force the input
    const label = this.panel.locator(`label[for="${id}"]`).first();
    if (await label.count()) await label.click({ timeout: 4_000 }).catch(() => {});
    if ((await box.isChecked().catch(() => !checked)) !== checked) {
      await (checked ? box.check({ force: true }) : box.uncheck({ force: true })).catch(() => {});
    }
  }

  /**
   * Pick an option in the sioniq-ng-select that follows a given label. Used
   * for the Process form's label-only selects (Material Issue/Receipt/
   * Clearance, Process Type) which carry no controlname.
   */
  async pickByLabelInPanel(labelText, optionText, { first = false } = {}) {
    const wrap = this.panel
      .locator(`label:text-is("${labelText}")`)
      .locator('xpath=following::ng-select[1]');
    if (!(await wrap.count())) return false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.closeDropdown();
      await wrap.locator('.ng-select-container').click().catch(() => {});
      await this.page.waitForTimeout(600);
      const opts = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i });
      const target = first
        ? opts.first()
        : opts.filter({ hasText: new RegExp(escapeRe(optionText), 'i') }).first();
      if (await target.isVisible({ timeout: attempt * 2_500 }).catch(() => false)) {
        if (await target.click({ timeout: 6_000 }).then(() => true).catch(() => false)) {
          await this.page.waitForTimeout(500);
          return true;
        }
      }
      await this.closeDropdown();
    }
    return false;
  }

  /**
   * Fill every still-empty visible select in the offcanvas with its first
   * real option. Guards against an unknown mandatory dropdown silently
   * blocking Submit. Repeats a few rounds for selects that only render after
   * an earlier pick.
   */
  async fillRemainingSelects() {
    for (let round = 0; round < 3; round++) {
      const wraps = this.panel.locator('sioniq-ng-select').locator('visible=true');
      const n = await wraps.count();
      let pickedAny = false;
      for (let i = 0; i < n; i++) {
        const wrap = wraps.nth(i);
        const val = ((await wrap.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
        if (val) continue;
        await wrap.locator('ng-select .ng-select-container').first().click().catch(() => {});
        await this.page.waitForTimeout(1_000);
        const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found|Select all/i }).first();
        if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await opt.click().catch(() => {});
          pickedAny = true;
          await this.page.waitForTimeout(800);
          await this.closeDropdown(); // multi-selects keep the panel open
        } else {
          await this.closeDropdown();
        }
      }
      if (!pickedAny) break;
    }
  }

  /** Fill the Process add form. Locations is a multi-select (close its panel). */
  async fillProcess(d) {
    await this.input('name').fill(d.name);
    await this.input('shortName').fill(d.shortName);
    await this.pickInPanel('department', d.department, { exact: true });
    // Locations - multi-select; leave the panel open then close it neutrally.
    // The Material / Process Type selects RENDER ONLY after a location is set.
    await this.pickInPanel('selectedLocations', d.location, { multi: true });
    await this.waitForRendered('materialIssue');
    // Material Issue / Receipt / Clearance are MANDATORY - set the exact sheet
    // value (skips if already auto-populated; throws if a wanted option isn't
    // offered, surfacing a data slip).
    await this.ensureSelect('materialIssue', d.materialIssue);
    await this.ensureSelect('materialReceipt', d.materialReceipt);
    await this.ensureSelect('materialClearance', d.materialClearance);
    // Process Type is OPTIONAL (options: Concept / CAD) - set only when the
    // sheet gives one (Design And CAD -> "CAD"); leave empty otherwise.
    if (d.processType) await this.pickInPanel('processType', d.processType, { exact: true });
    // Configuration is OPTIONAL - the sheet doesn't set it, so leave it empty.
    // Allow Sub Process must be ON so sub-processes can attach to it.
    await this.ensureCheck('allowSubProcess', d.allowSubProcess !== false);
    await this.ensureCheck('active', d.active !== false);
  }

  /** Wait for a conditionally-rendered select (materials appear only after the
   *  driver fields are set). */
  async waitForRendered(controlname) {
    await this.panel.locator(`sioniq-ng-select[controlname="${controlname}"]`).first()
      .waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForTimeout(500);
  }

  /** Current selected label of an offcanvas select ('' when empty). */
  async panelValue(controlname) {
    const v = this.panel.locator(`sioniq-ng-select[controlname="${controlname}"] .ng-value`).first();
    return ((await v.textContent().catch(() => '')) || '').replace(/×/g, '').trim();
  }

  /**
   * Pick a select ONLY if it doesn't already hold the wanted value. The
   * Material fields auto-populate from the parent process (e.g. a No-Material
   * process pre-sets its sub-processes to "No Material Issued/Received/
   * Clearance"); re-opening an already-correct select would fail to find the
   * option. Skip that case.
   */
  async ensureSelect(controlname, wanted, { exact = true } = {}) {
    const cur = await this.panelValue(controlname);
    if (cur && cur.toLowerCase() === String(wanted).toLowerCase()) return;
    await this.pickInPanel(controlname, wanted, { exact });
  }

  /**
   * Fill the Sub-Process add form. process = parent process name. NOTE the
   * material controlnames here are LOWERCASE for receipt/clearance
   * (materialIssue, materialreceipt, materialclearance) - an app quirk. The
   * material selects render only after department + process + location are set,
   * and their options are filtered by the parent process's material config.
   */
  async fillSubProcess(d) {
    await this.input('name').fill(d.name);
    await this.input('shortName').fill(d.shortName);
    await this.pickInPanel('department', d.department, { exact: true });
    await this.pickInPanel('process', d.process, { search: true, exact: true });
    await this.pickInPanel('location', d.location, { multi: true });
    await this.waitForRendered('materialIssue');
    await this.ensureSelect('materialIssue', d.materialIssue);
    await this.ensureSelect('materialreceipt', d.materialReceipt);
    await this.ensureSelect('materialclearance', d.materialClearance);
    // Configuration is OPTIONAL - leave empty (the sheet doesn't set it).
    await this.ensureCheck('active', d.active !== false);
  }

  /**
   * Submit the offcanvas and return the parsed save body. Throws (with the
   * ng-invalid diagnostics) when Submit fires no save request - a silent
   * block is an app bug to surface, per the checklist.
   */
  async submitForm(label = 'record') {
    const submit = this.page.getByRole('button', { name: 'Submit' }).locator('visible=true').last();
    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && this.submitApiPattern.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation|Search|List/i.test(r.url()),
      { timeout: 60_000 },
    ).catch(() => null);
    await submit.click();
    const r = await resp;
    if (!r) {
      throw new Error(`${label}: Submit fired no save request - form silently blocked; ${JSON.stringify(await this.invalidDiag())}`);
    }
    const body = await r.json().catch(() => null);
    console.log(`${label} save:`, r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 200));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`${label} save rejected (HTTP ${r.status()}): ${body ? body.error || body.message || '' : ''}`);
    }
    await this.page.waitForTimeout(1_500);
    // the offcanvas RESETS to a blank "Add new record" form after save rather
    // than closing - close it (via the X, never Escape) so the list / tabs are
    // reachable again
    await this.closeOffcanvas();
    return body;
  }

  /** Close the add offcanvas via its X button (Escape would also close it but
   *  is reserved - clicking X is unambiguous). */
  async closeOffcanvas() {
    const x = this.page.locator('.offcanvas.show .btn-close, ngb-offcanvas-panel .btn-close').first();
    if (await x.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await x.click({ timeout: 5_000 }).catch(() => {});
    }
    await this.page.locator('.offcanvas.show, ngb-offcanvas-panel').first()
      .waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
    await this.page.waitForTimeout(800);
  }

  async invalidDiag() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const invalidNg = [...document.querySelectorAll('sioniq-ng-select')]
        .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && vis(n))
        .map((n) => n.getAttribute('controlname') || (n.querySelector('label') || {}).textContent?.trim() || '?');
      const invalidInputs = [...document.querySelectorAll('input.ng-invalid, textarea.ng-invalid')]
        .filter(vis).map((n) => n.getAttribute('formcontrolname') || n.id || '?');
      const toast = (document.querySelector('.toast-message, .toast, [role=alert]') || {}).textContent || '';
      return { invalidNg, invalidInputs, toast: toast.trim() };
    });
  }

  /**
   * Confirm a record shows in the current tab's list. Uses the grid's Search
   * box to defeat pagination, then polls the visible rows.
   */
  async verifyInGrid(name) {
    const search = this.page.locator('input[placeholder="Search"]').locator('visible=true').first();
    if (await search.count()) {
      await search.fill('');
      await search.fill(name);
      await this.page.waitForTimeout(2_000);
    }
    for (let i = 0; i < 5; i++) {
      await this.waitForIdle();
      await this.page.waitForTimeout(1_500);
      if ((await this.gridRows.filter({ hasText: name }).count()) > 0) {
        console.log(`grid shows: ${name}`);
        return true;
      }
      await this.page.waitForTimeout(1_500);
    }
    throw new Error(`Saved record "${name}" never appeared in the list`);
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { DepartmentProcessPage };
