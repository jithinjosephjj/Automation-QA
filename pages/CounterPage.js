const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Counter — Inventory > Setup > Counter (Counter tab of /inv/counter-setup;
 * sibling tabs: Floor / Sub-Counter / Employee Counter Mapping (was "Employee
 * Locker & Counter Assignment" until Sept 2026) /
 * Counter Mapping). Single-screen form with Submit.
 *
 * Facts (verified live 23-08-2026):
 * - Dropdowns: location (BU, multi + Select all), floor, and Counter Type is
 *   controlname "masterDataValueID_CounterType" (Order / Reserve / Repair /
 *   Sample / Locker).
 * - Picking Counter Type = Locker reveals the Locker Details section:
 *   department + lockerType (multi: Metal / Stone / Alloy, has Select all)
 *   and the Clearance Locker checkbox.
 * - Name and Short Name inputs carry no ids - reach by label.
 */
class CounterPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Counter');
    this.submitApiPattern = /Counter/i;
  }

  async open() {
    await this.goto('/inv/counter-setup');
    await this.page.getByRole('tab', { name: 'Counter', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  }

  async selectTab() {
    await this.page.getByRole('tab', { name: 'Counter', exact: true }).click();
    await this.waitForIdle();
    await this.settle(2_000);
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.inputByLabel('Name').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Locker counter for the iteration's employee:
   * Name "<employee> Locker", Short Name u<N> (dynamic), BU Cochin, Floor 4,
   * Counter Type Locker, Department Production, all Locker Types selected.
   */
  async fillLockerCounter(u, { location = 'Cochin', floor = 'Floor 4', shortName } = {}) {
    await this.fillByLabel('Name', `${u.displayName} Locker`);
    await this.fillByLabel('Short Name', shortName || `u${u.n}`);
    await this.pick('location', location, { exact: true, closePanel: true });
    // floor: the named one, or - floor null - the first floor the location offers
    if (floor) await this.pick('floor', floor, { exact: true });
    else await this.pickFirstFloor();
    await this.pick('masterDataValueID_CounterType', 'Locker', { exact: true });

    // Locker Details renders after the type pick, behind a transparent
    // ngx-spinner overlay that swallows clicks - wait for it to clear.
    await this.select('department').waitFor({ state: 'visible', timeout: 15_000 });
    await this.page
      .locator('.ngx-spinner-overlay')
      .last()
      .waitFor({ state: 'hidden', timeout: 60_000 })
      .catch(() => {});
    await this.waitForIdle();
    // department is a MULTI select with a long, virtual-scrolled list -
    // type to filter so "Production" is actually rendered, and close the
    // panel afterwards.
    await this.pick('department', 'Production', { exact: true, search: true, closePanel: true });
    await this.selectAllOptions('lockerType');
  }

  // ---------- Employee Counter Mapping (sibling tab; renamed from "Employee Locker & Counter Assignment", 22-09-2026) ----------

  async selectAssignmentTab() {
    await this.page.getByRole('tab', { name: /^Employee (Counter Mapping|Locker & Counter Assignment)$/ }).click();
    await this.waitForIdle();
    await this.settle(2_000);
  }

  async openAssignmentAdd() {
    await this.addBtn.click();
    await this.select('employees').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Map the iteration's employee to their locker counter, per the agreed
   * screenshot: BU Cochin → Employee → Counter "<employee> Locker"; Floor and
   * Counter Type auto-fill from the counter (picked manually only if empty);
   * Sub Counter stays empty.
   */
  /** The first floor the Floor select offers (Kakkanad's floors are not named like Cochin's). Returns its label. */
  async pickFirstFloor() {
    const host = this.select('floor');
    await this.closeStalePanels();
    await host.locator('.ng-select-container').click({ timeout: 10_000 });
    await this.settle(1_200);
    const options = await this.panelOptions(host);
    const labels = (await options.allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/No items/i.test(t));
    if (!labels.length) { await this.page.keyboard.press('Escape'); throw new Error('Counter: the Floor select offers nothing for this location'); }
    await options.first().click({ timeout: 10_000 });
    await this.settle(800);
    console.log(`counter: floor -> "${labels[0]}" (of ${JSON.stringify(labels.slice(0, 6))})`);
    return labels[0];
  }

  async fillAssignment(u, { location = 'Cochin', floor = 'Floor 4' } = {}) {
    await this.pick('locations', location, { exact: true, closePanel: true });
    await this.pick('employees', u.displayName, { search: true });
    await this.pick('counters', `${u.displayName} Locker`, { search: true });
    await this.settle(2_000); // let floor/type auto-fill

    if (!(await this.selectValue('floors')) && floor) {
      await this.pick('floors', floor, { exact: true });
    }
    if (!(await this.selectValue('countertype'))) {
      await this.pick('countertype', 'Locker', { exact: true });
    }
  }
}

module.exports = { CounterPage };
