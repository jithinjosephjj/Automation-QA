const { test, expect } = require('../../fixtures/test-fixtures');
const env = require('../../utils/env');

/**
 * Login screen. Runs in the 'no-auth' project - no saved session, no dependency
 * on global.setup, so it works even while authentication is blocked.
 *
 * Every assertion here was verified against qa.sioniq.com.
 */
test.describe('Login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.open();
  });

  test('TC-LOGIN-001 login form renders its three inputs', async ({ loginPage }) => {
    await expect(loginPage.username).toBeVisible();
    await expect(loginPage.password).toBeVisible();
    await expect(loginPage.businessUnit).toBeVisible();
    await expect(loginPage.loginBtn).toBeEnabled();
  });

  test('TC-LOGIN-002 password field masks input', async ({ loginPage }) => {
    await expect(loginPage.password).toHaveAttribute('type', 'password');
  });

  test('TC-LOGIN-003 Business Unit list populates on username blur', async ({ loginPage }) => {
    // The list is fetched by GetLocationByLoginUser, triggered by the blur.
    const options = await loginPage.businessUnitOptions(env.USER);
    expect(options).toContain(env.BU);
    expect(options.length).toBeGreaterThan(1);
  });

  test('TC-LOGIN-004 valid credentials log in successfully', async ({ loginPage }) => {
    // Requires the Device Radar agent running + the LNA launch flag (see
    // README); with both in place, submit proceeds past /login.
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(loginPage.page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  });

  test('TC-LOGIN-005 wrong password is rejected and stays on the login form', async ({
    loginPage,
  }) => {
    await loginPage.login({ pwd: 'wrong-password-123' });
    // no navigation happens for bad credentials
    await loginPage.page.waitForTimeout(5_000);
    await expect(loginPage.page).toHaveURL(/\/login/);
    await expect(loginPage.username).toBeVisible();
  });
});
