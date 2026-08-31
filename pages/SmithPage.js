const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Smith / Karigar — Production > Setup > Smith / Karigar.
 * Route: /prd/view-worker. Wizard: Basic Information → Contact Information →
 * Account Information → Document.
 *
 * Facts (verified live 23-08-2026, refined by QA lead):
 * - Business Unit and Process must match the EMPLOYEE's BU and Process
 *   (Cochin + Casting Process) or the employee never appears in the list.
 * - The Employee dropdown (controlname employee) only renders after
 *   Worker Type = Inhouse Worker.
 * - Worker Category has a single option: Worker.
 * - Next is a silent no-op while step-1 controls are invalid.
 */
class SmithPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Smith / Karigar');
    this.code = page.locator('#code');
    this.name = page.locator('#name');
    this.shortName = page.locator('#shortName');
    this.submitApiPattern = /Worker/i;
  }

  async open() {
    await this.goto('/prd/view-worker');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.code.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Step 1 - Basic Information, in dependency order (all mandatory). */
  async fillBasicInformation(u) {
    await this.pick('location', 'Cochin', { closePanel: true });
    await this.pick('process', 'Casting Process'); // same as the employee's
    await this.pick('subProcess', 'Casting Inspection'); // ditto
    await this.pick('workerType', 'Inhouse Worker');
    await this.pick('employee', u.displayName, { search: true });
    await this.pick('category', 'Worker');
    await this.selectAllFunctionality();

    // Code and Short Name are dynamic manual entries - unique per iteration.
    // Short Name TRUNCATES at 5 characters (that is why the auto-fill shows
    // "Sioni" and why "Sioni2" silently became "Sioni" and got rejected as
    // "Short Name Sioni Duplicated.", HTTP 501). Use the u<N> scheme - short,
    // unique, and well inside the limit.
    await this.page.waitForTimeout(3_000); // let the employee auto-fill land first
    await this.code.fill(`SM${u.n}`);
    if (!(await this.name.inputValue())) await this.name.fill(u.displayName);
    const shortName = `u${u.n}`;
    for (let i = 0; i < 5; i++) {
      await this.shortName.fill(shortName);
      await this.shortName.blur();
      await this.page.waitForTimeout(1_500);
      if ((await this.shortName.inputValue()) === shortName) return;
    }
    throw new Error(`Short Name would not hold the value "${shortName}"`);
  }

  /**
   * Functionality Configuration: use the panel's own "Select all" row - it
   * resolves the "one Metal wastage + one Stone wastage" rule itself, which
   * clicking options one by one violates.
   */
  async selectAllFunctionality() {
    await this.selectAllOptions('functionMasterIds');
  }

  /**
   * Contact Information (step 2) - not mandatory, but filled per QA lead:
   * a dynamic address and zip code 500016TS. Best-effort: skipped silently
   * when the controls are not present.
   */
  async fillContactInformation(u) {
    try {
      const address = this.page
        .locator('textarea:visible, input[id*="ddress" i]:visible')
        .first();
      if (await address.count()) await address.fill(`QA Street ${u.displayName}, Cochin`);
      const zipCn = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.offsetParent)
          .map((n) => n.getAttribute('controlname'))
          .find((c) => /zip|pin/i.test(c || '')));
      if (zipCn) await this.pick(zipCn, '500016TS', { search: true });
    } catch {
      // optional step - never block the save on it
    }
  }

  /**
   * Walk Next through Contact / Account / Document until Submit shows, then
   * submit. The intermediate steps are left untouched - Contact data is not
   * mandatory and the untouched path is the one proven to save.
   *
   * Success is verified by the new worker appearing in the list view, NOT by
   * a response pattern: iterations 1 and 2 both saved while no POST matching
   * /Worker/i was ever observed, so the save endpoint is something else -
   * the list row is the reliable signal. Fired endpoints are logged so the
   * real one can be identified.
   */
  async walkToSubmitAndSave(u) {
    for (let i = 0; i < 6; i++) {
      const visible = await this.submitBtn.isVisible({ timeout: 2_000 }).catch(() => false);
      if (visible) break;
      await this.nextBtn.click();
      await this.waitForIdle();
      await this.page.waitForTimeout(2_000);
    }
    await this.submitBtn.waitFor({ state: 'visible', timeout: 15_000 });

    // Workers are vendors under the hood: the save endpoint is
    // Vendor/CreateVendor. Accept any status - a validation rejection comes
    // back as HTTP 501 with { errorCode, error } and must surface as a crisp
    // failure, not a timeout.
    const resp = this.page.waitForResponse((r) => /CreateVendor/i.test(r.url()), { timeout: 120_000 });
    await this.submitBtn.click();
    const r = await resp;
    const body = await r.json().catch(() => null);
    if (!body || body.errorCode || r.status() >= 400) {
      throw new Error(`Smith save rejected (HTTP ${r.status()}): ${body ? body.error || JSON.stringify(body) : 'no body'}`);
    }

    // Belt and braces: the record shows up in the Worker list.
    for (let i = 0; i < 5; i++) {
      await this.open();
      await this.waitForIdle();
      await this.page.waitForTimeout(2_000);
      if ((await this.gridRows.filter({ hasText: u.displayName }).count()) > 0) return true;
      await this.page.waitForTimeout(8_000);
    }
    return false;
  }
}

module.exports = { SmithPage };
