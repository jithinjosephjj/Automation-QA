const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Counter — Inventory > Setup > Counter (Counter tab of /inv/counter-setup;
 * sibling tabs: Floor / Sub-Counter / Employee Locker & Counter Assignment /
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
    await this.page.waitForTimeout(2_000);
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
  async fillLockerCounter(u) {
    await this.fillByLabel('Name', `${u.displayName} Locker`);
    await this.fillByLabel('Short Name', `u${u.n}`);
    await this.pick('location', 'Cochin', { closePanel: true });
    await this.pick('floor', 'Floor 4', { exact: true });
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

  // ---------- Employee Locker & Counter Assignment (sibling tab) ----------

  async selectAssignmentTab() {
    await this.page.getByRole('tab', { name: 'Employee Locker & Counter Assignment' }).click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
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
  async fillAssignment(u) {
    await this.pick('locations', 'Cochin', { closePanel: true });
    await this.pick('employees', u.displayName, { search: true });
    await this.pick('counters', `${u.displayName} Locker`, { search: true });
    await this.page.waitForTimeout(2_000); // let floor/type auto-fill

    if (!(await this.selectValue('floors'))) {
      await this.pick('floors', 'Floor 4', { exact: true });
    }
    if (!(await this.selectValue('countertype'))) {
      await this.pick('countertype', 'Locker', { exact: true });
    }
  }
}

module.exports = { CounterPage };
