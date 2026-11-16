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
    // Since 11-11-2026 the form wraps its inputs in <app-sioniq-input id="X">
    // around an <input id="X"> (Mobile Number first: type="contact" with a
    // country-code select) - the same id twice, a strict-mode violation for a
    // bare '#X'. field() scopes to the input itself, with or without wrapper.
    this.name = this.field('Name');
    this.loginName = this.field('LoginName');
    this.mobile = this.field('MobileNumber');
    this.email = this.field('Email');
    this.password = this.field('password');
    this.confirmPassword = this.field('ConfirmPassword');
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
    await this.settle(2_000);
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
  /**
   * Submit the Users form. qa's gateway answers User/CreateUser with 504 after
   * 30 s while the backend still saves (11-11 and 16-11-2026: Sioniquser52 was
   * in the list, once). A 5xx therefore passes when the app showed its success
   * popup, or when the login is listed afterwards; only then is the record
   * missing and the error stands. Never resubmits (duplicates).
   */
  async submit() {
    const login = this.lastLogin;
    const toast = this.watchSaveToast(45_000);
    try {
      return await super.submit();
    } catch (e) {
      const msg = String(e && e.message || e);
      if (!/answered 5\d\d/.test(msg)) throw e;
      const shown = await Promise.race([toast, new Promise((res) => setTimeout(() => res(false), 5_000))]);
      if (shown) {
        console.log(`GATEWAY-5XX: ${msg.split(' - ')[0]} - the success popup was shown, the user is saved`);
        return { code: 1001, message: 'Saved successfully! (gateway 5xx; success popup shown)', gateway: msg.split(' - ')[0] };
      }
      if (login && (await this.loginExists(login).catch(() => false))) {
        console.log(`GATEWAY-5XX: ${msg.split(' - ')[0]} - no popup, but "${login}" is in the Users list, the user is saved`);
        return { code: 1001, message: 'Saved successfully! (gateway 5xx; user listed)', gateway: msg.split(' - ')[0] };
      }
      throw e;
    }
  }

  async fillUser(u) {
    this.lastLogin = u.displayName; // for submit(): the login to look for after a gateway 5xx
    await this.name.fill(u.nameInWords); // FIRST - clears its own validation
    await this.mobile.fill(u.mobile);
    await this.email.fill(u.email);
    await this.loginName.fill(u.displayName);
    await this.password.fill(u.password);
    await this.confirmPassword.fill(u.password);

    // Validity Period (user, 11-11-2026): Active From = the app's business
    // date, Active Until = 5 years from Active From.
    const activeFrom = await this.appDate();
    await this.setDate('ActiveFrom', activeFrom);
    await this.setDate('ActiveUntil', UserPage.plusYears(activeFrom, 5));
    console.log(`Users: validity ${activeFrom} -> ${UserPage.plusYears(activeFrom, 5)}`);

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
  /**
   * The app's business date as the topbar shows it (DD/MM/YYYY, e.g.
   * 29/06/2026 on qa, pinned); today's date when the topbar is unreadable.
   */
  async appDate() {
    const t = (await this.page.locator('.nav-user h6').first().innerText({ timeout: 3_000 }).catch(() => '')).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  static plusYears(ddmmyyyy, years) {
    const [d, m, y] = ddmmyyyy.split('/');
    return `${d}/${m}/${Number(y) + years}`;
  }

  /**
   * Validity Period dates (#ActiveFrom / #ActiveUntil) are READONLY flatpickr
   * inputs inside sioniq-date-picker, so fill() is refused. Set the date
   * through the picker instance (fires its change hooks, which is what the
   * calendar click does), falling back to a plain fill with readonly removed.
   */
  async setDate(id, value) {
    const input = this.page.locator(`input#${id}`).first();
    const viaPicker = await input.evaluate((el, v) => {
      const fp = el._flatpickr;
      if (!fp) return false;
      fp.setDate(v, true, 'd/m/Y');
      return el.value === v;
    }, value).catch(() => false);
    if (!viaPicker) {
      await input.evaluate((el) => el.removeAttribute('readonly'));
      await input.fill(value);
      await input.blur();
    }
    await this.page.keyboard.press('Escape'); // close any calendar popup
    const got = (await input.inputValue()).trim();
    if (got !== value) throw new Error(`Users: ${id} shows "${got}" after setting "${value}"`);
  }
}

module.exports = { UserPage };
