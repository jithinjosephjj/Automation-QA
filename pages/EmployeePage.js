const { StockInwardBasePage } = require('./StockInwardBasePage');
const { DEMO_FILES } = require('../utils/demo-files');

/**
 * Employee — HRMS > Setup > Employee. Route: /hrm/employee-setup.
 * Single-screen form with Submit at the bottom.
 *
 * Facts (verified live 23-08-2026):
 * - Legal Entity options include "Sioniq QA", "Sioniq QA1", "Sioniq QA2" -
 *   ALWAYS pick exact, or QA1 wins by substring and its BU list has no Cochin.
 * - Business Unit is a server-side typeahead, and it depends on Legal Entity.
 * - Designation / Level / Process / Sub Process are disabled until Department
 *   (then Designation) is picked - fill strictly in order.
 * - Employee ID generation: Auto. Sales Code Generation: Manual + a dynamic
 *   RT<N> code per iteration.
 * - Save endpoint: POST Employee/CreateEmployee -> { code: 1001,
 *   message: "Saved successfully!", data: { employeeID, employeeCode, ... } }.
 */
class EmployeePage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Employee');
    this.firstName = page.locator('#fName');
    this.lastName = page.locator('#lName');
    this.displayName = page.locator('#dName');
    this.dob = page.locator('#dob');
    this.doj = page.locator('#doj');
    this.submitApiPattern = /CreateEmployee/i;
  }

  async open() {
    await this.goto('/hrm/employee-setup');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.firstName.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async fillDate(locator, value) {
    await locator.fill(value);
    await locator.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
  }

  /**
   * Profile picture (mapped live 18-09-2026): the avatar tile
   * (.profile-image-wrapper) hides an input[type=file] accepting image/*.
   * Selecting a file pops a "Profile Preview" dialog (max 2MB) whose Save
   * uploads the image immediately (files.sioniqerp.com) and paints the
   * avatar - verify both, or the picture silently never attaches.
   */
  async uploadProfilePicture(filePath = DEMO_FILES.profile) {
    await this.page.locator('.profile-image-wrapper input[type="file"]').setInputFiles(filePath);
    const dlg = this.page.locator('.modal, [role="dialog"]').filter({ hasText: 'Profile Preview' }).last();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 });
    const avatar = this.page.locator('.profile-image-wrapper img');
    await avatar.waitFor({ state: 'visible', timeout: 15_000 });
    console.log('employee: profile picture uploaded and applied to the avatar');
  }

  /** Fill the whole employee form in dependency order. */
  async fillEmployee(u) {
    // profile picture first - from the demo folder's profile image
    await this.uploadProfilePicture(u.profileImage);

    await this.firstName.fill(u.firstName);
    await this.lastName.fill(u.lastName);
    await this.displayName.fill(u.displayName);
    await this.pick('gender', 'Male');
    await this.fillDate(this.dob, '01/06/1996');

    await this.pick('empIdGeneration', 'Auto');
    await this.pick('legalEntity', 'Sioniq QA', { exact: true });
    await this.pick('bUnit', 'Cochin', { search: true, closePanel: true });
    await this.pick('department', 'Production', { exact: true });
    await this.pick('designation', 'Supervisor');
    await this.pick('designationlevel', 'L2');
    await this.pick('process', 'Casting Process');
    await this.pick('subprocess', 'Casting Inspection');

    await this.pick('salesCodeGeneration', 'Manual');
    const salesCode = this.page
      .locator('div.grid, div.form-group')
      .filter({ has: this.page.locator('label', { hasText: 'Sales Code' }) })
      .last()
      .locator('input:not([type=checkbox]):not([disabled])')
      .first();
    await salesCode.fill(u.salesCode);

    await this.pick('employmentType', 'Permanent');
    await this.fillDate(this.doj, '01/06/2026');
  }
}

module.exports = { EmployeePage };
