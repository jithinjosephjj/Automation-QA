const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Users — Admin > Access Control > Users. Route: /adm/user-setup.
 * Single-screen form (Basic Details / Credentials / Access / User Roles).
 *
 * Facts (verified live 23-08-2026, refined by QA lead):
 * - Enter the Name FIRST - its mandatory-field validation only clears when
 *   the field is typed before the rest of the form is touched.
 * - Picking the Employee (controlname selectedEmployee, appears after User
 *   Type) auto-fills Name; Application auto-selects sioniq-ui.
 * - User Roles: ONE role card exists by default. Pick the role in it and
 *   enable its Default toggle. Do NOT click "+ Add" - that appends a second
 *   empty card whose empty role select then blocks Submit.
 * - The Default toggle is the only id-less checkbox on the form.
 */
class UserPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Users');
    this.name = page.locator('#Name');
    this.loginName = page.locator('#LoginName');
    this.mobile = page.locator('#MobileNumber');
    this.email = page.locator('#Email');
    this.password = page.locator('#password');
    this.confirmPassword = page.locator('#ConfirmPassword');
    // The single role card's Default toggle (only checkbox without an id).
    this.defaultToggle = page
      .locator('div')
      .filter({ has: page.getByText('Default', { exact: true }) })
      .last()
      .locator('input[type=checkbox]')
      .first();
    this.submitApiPattern = /User/i;
  }

  async open() {
    await this.goto('/adm/user-setup');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.name.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Resume helpers: a mid-chain failure must not recreate what already
   * saved (duplicate logins hard-fail; duplicate employees silently fork).
   */

  /** Does a user with this login already exist? (newest-first list, page 1) */
  async loginExists(login) {
    await this.open();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
    return (await this.gridRows.filter({ hasText: login }).count()) > 0;
  }

  /**
   * Does the employee exist? The add-form Employee dropdown lists employees
   * available for user-mapping, so finding it there proves the employee step
   * already ran. Reloads the page afterwards to discard the probe state.
   */
  async employeeExists(displayName) {
    await this.openAddWizard();
    await this.pick('selectedUser', 'ERP User');
    let found = true;
    try {
      await this.pick('selectedEmployee', displayName, { search: true });
    } catch {
      found = false;
    }
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForIdle();
    return found;
  }

  /**
   * Fill the user form; Name goes first, one role card, Default enabled.
   * The Name field REJECTS digits, so it takes the number-in-words variant
   * (Sioniquserone) while Login Name keeps the numeric one (Sioniquser1).
   */
  async fillUser(u) {
    await this.name.fill(u.nameInWords); // FIRST - clears its own validation
    await this.mobile.fill(u.mobile);
    await this.email.fill(u.email);
    await this.loginName.fill(u.displayName);
    await this.password.fill(u.password);
    await this.confirmPassword.fill(u.password);

    await this.pick('selectedLocation', 'Cochin', { closePanel: true });
    await this.pick('selectedUser', 'ERP User');
    await this.pick('selectedEmployee', u.displayName, { search: true });

    // The employee pick auto-fills Name with the employee's display name,
    // which contains a digit the field rejects - restore the words variant.
    if ((await this.name.inputValue()) !== u.nameInWords) {
      await this.name.fill(u.nameInWords);
    }

    // One role card only: pick Admin in it and switch Default on.
    await this.pick('roleID', 'Admin', { exact: true });
    if (!(await this.defaultToggle.isChecked())) {
      await this.defaultToggle.click({ force: true });
    }
  }
}

module.exports = { UserPage };
