const { BasePage } = require('./BasePage');
const { getNgOptions } = require('../utils/ng-select');
const env = require('../utils/env');

/**
 * Sioniq login.
 *
 * Two things here differ from generic Playwright examples:
 *
 * 1. There are NO <label> elements. Fields carry only id + placeholder, so
 *    page.getByLabel('Username') does not work - use #username / #password.
 * 2. Business Unit is an ng-select, not a native <select>, and its list is
 *    fetched when the username field loses focus. Keep the .blur() call.
 */
class LoginPage extends BasePage {
  constructor(page) {
    super(page);

    this.username = page.locator('#username');
    this.password = page.locator('#password');
    this.businessUnit = page.locator('ng-select#location');
    this.rememberMe = page.locator('#checkbox-signin');
    this.loginBtn = page.getByRole('button', { name: 'Log In' });
    this.form = page.locator('form.login-form');

    // Client-side hardware gate, shown on submit when the Device Radar
    // desktop agent is not installed/running on this machine.
    this.deviceRadarModal = page
      .locator('[role="dialog"], .modal')
      .filter({ hasText: 'Device Radar' });
    this.deviceRadarClose = this.deviceRadarModal.getByRole('button', { name: 'Close' });
  }

  async open() {
    await this.goto('/login');
    await this.username.waitFor({ state: 'visible' });
  }

  /** Business Units offered for a given user. Verified live: Aluva, Palakkad, Trivendrum, Cochin. */
  async businessUnitOptions(user = env.USER) {
    await this.username.fill(user);
    await this.username.blur();
    return getNgOptions(this.page, 'ng-select#location');
  }

  /**
   * Fill and submit. Deliberately asserts nothing about post-login - the
   * caller decides what success means.
   *
   * SELF-HEALING (QA lead, 30-08-2026): under load the login form can
   * misplace keystrokes while it hydrates - the password lands appended in
   * the username field ("admin123"), password stays empty and the whole
   * workflow breaks at its first step. So every field is VERIFIED after
   * filling; on any mismatch the page is reloaded and the attempt restarts,
   * up to 4 times.
   * @param {{user?: string, pwd?: string, bu?: string}} [creds]
   */
  async login(creds = {}) {
    const user = creds.user ?? env.USER;
    const pwd = creds.pwd ?? env.PWD;
    const bu = creds.bu ?? env.BU;

    let lastProblem = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        console.log(`login attempt ${attempt}: retrying after "${lastProblem}" - reloading /login`);
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.username.waitFor({ state: 'visible', timeout: 30_000 });
        await this.page.waitForTimeout(1_500);
      }

      try {
        // fill + verify each field landed EXACTLY where it should
        await this.username.click();
        await this.username.fill(user);
        await this.password.click();
        await this.password.fill(pwd);

        const userVal = await this.username.inputValue();
        const pwdVal = await this.password.inputValue();
        if (userVal !== user) { lastProblem = `username field holds "${userVal}"`; continue; }
        if (pwdVal !== pwd) { lastProblem = 'password field holds the wrong value'; continue; }

        // The BU list is populated off the username field losing focus.
        // Drop this blur and the dropdown stays empty and login silently fails.
        await this.username.blur();
        await this.businessUnit.waitFor({ state: 'visible' });
        await this.selectNg('ng-select#location', bu);

        // BU must actually hold the choice (a stale list shows "No items found")
        const buVal = ((await this.businessUnit.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
        if (!buVal.includes(bu)) { lastProblem = `business unit holds "${buVal}"`; continue; }

        // fields can still be clobbered by late hydration - final re-check
        if ((await this.username.inputValue()) !== user || (await this.password.inputValue()) !== pwd) {
          lastProblem = 'a field changed after the business unit pick';
          continue;
        }

        await this.loginBtn.click();
        return;
      } catch (e) {
        lastProblem = String(e).split('\n')[0];
      }
    }
    throw new Error(`Login form never accepted the credentials cleanly after 4 attempts (last problem: ${lastProblem})`);
  }

  /** True when the Device Radar gate is on screen. */
  async isDeviceRadarBlocking() {
    return this.deviceRadarModal
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
  }

  /** Close the gate modal if present. Returns whether it was there. */
  async dismissDeviceRadar() {
    if (!(await this.isDeviceRadarBlocking())) return false;
    await this.deviceRadarClose.first().click();
    await this.deviceRadarModal.first().waitFor({ state: 'hidden' }).catch(() => {});
    return true;
  }

  /**
   * Fail loudly and usefully when the environment - not the test - is broken.
   * The gate runs before the auth request, so no credentials are ever sent.
   */
  async throwIfGated() {
    if (await this.isDeviceRadarBlocking()) {
      throw new Error(
        [
          'Login blocked by the "Device Radar Required" modal.',
          '',
          'This is an environment gate, not a test failure: the app never issues its',
          'login request, so the credentials are never checked. Closing the modal',
          'returns you to /login.',
          '',
          'To unblock automation on this machine, either:',
          '  1. Install and run the Device Radar agent (download button in the modal), or',
          '  2. Get a QA flag / build from dev that skips the Device Radar check.',
        ].join('\n'),
      );
    }
  }
}

module.exports = { LoginPage };
