const { test, expect } = require('../../fixtures/test-fixtures');
const { nextSioniqUser, commit } = require('../../utils/sioniquser');

/**
 * Master-data add operations for one Sioniquser<N> iteration, in dependency
 * order: Employee → User → Smith. Declaration order inside one file is the
 * only ordering both the CLI and the VS Code test runner honour (numbered
 * separate files run alphabetically in the CLI but not in VS Code).
 *
 * Each test is independent (own login/session), idempotent for the current
 * iteration (skips what already exists), and creates its own employee
 * prerequisite when run alone. The counter in sioniquser-counter.json is
 * advanced ONLY by the smith test - the chain's final step.
 *
 *   run everything : npx playwright test tests/masters --headed
 *   run one page   : npx playwright test -g "TC-USR-001" --headed
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** Create the iteration's employee - shared prerequisite step. */
async function createEmployee(employeePage, u) {
  await employeePage.open();
  await employeePage.openAddWizard();
  await employeePage.fillEmployee(u);
  const response = await employeePage.submit();
  expect(response).toBeTruthy();
  expect(response.message).toMatch(/saved successfully/i);
  console.log(`Employee saved: ${u.displayName} (code ${response.data && response.data.employeeCode})`);
  return response;
}

test.describe('Master add operations - Employee, User, Smith', () => {
  // ================= 1. EMPLOYEE =================
  test('TC-EMP-001 create employee Sioniquser<N>', async ({ loginPage, employeePage, userPage, page }) => {
    test.setTimeout(420_000);
    const u = nextSioniqUser();
    console.log(`Iteration ${u.n}: employee "${u.displayName}", sales code ${u.salesCode}`);

    await login(loginPage, page);

    // Already created? (an existing user implies the employee exists too -
    // once the user exists the employee leaves the mapping dropdown)
    const userExists = await userPage.loginExists(u.displayName);
    const employeeExists = userExists || (await userPage.employeeExists(u.displayName));
    if (employeeExists) {
      console.log(`Employee ${u.displayName} already exists - nothing to create`);
      return;
    }

    await createEmployee(employeePage, u);

    // the saved employee shows in the list view (data table on page load)
    await employeePage.verifyRowInList(u.displayName);
  });

  // ================= 2. USER =================
  test('TC-USR-001 create user Sioniquser<N> mapped to its employee', async ({ loginPage, employeePage, userPage, page }) => {
    test.setTimeout(420_000);
    const u = nextSioniqUser();
    console.log(`Iteration ${u.n}: user name "${u.nameInWords}", login "${u.displayName}"`);

    await login(loginPage, page);

    if (await userPage.loginExists(u.displayName)) {
      console.log(`User ${u.displayName} already exists - nothing to create`);
      return;
    }

    // Prerequisite: the employee must exist to be mapped.
    if (!(await userPage.employeeExists(u.displayName))) {
      console.log(`Prerequisite: employee ${u.displayName} missing - creating it first`);
      await createEmployee(employeePage, u);
    }

    await userPage.open();
    await userPage.openAddWizard();
    await userPage.fillUser(u);
    const response = await userPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`User saved: login "${u.displayName}", password 123, role Admin (default)`);

    // the saved user shows in the list view (data table on page load)
    await userPage.verifyRowInList(u.displayName);
  });

  // ================= 3. SMITH / KARIGAR =================
  test('TC-SMH-001 create smith mapped to employee Sioniquser<N>', async ({ loginPage, employeePage, userPage, smithPage, page }) => {
    test.setTimeout(420_000);
    const u = nextSioniqUser();
    console.log(`Iteration ${u.n}: smith for employee "${u.displayName}", code SM${u.n}, short name u${u.n}`);

    await login(loginPage, page);

    // Already created? (TC-CNT-001 completes the iteration, not this test.)
    await smithPage.open();
    await smithPage.waitForIdle();
    if ((await smithPage.gridRows.filter({ hasText: u.displayName }).count()) > 0) {
      console.log(`Smith for ${u.displayName} already exists - nothing to create`);
      return;
    }

    // Prerequisite: an unmapped employee. (The user account is not needed
    // for the smith mapping - TC-USR-001 owns that.)
    if (!(await userPage.loginExists(u.displayName)) && !(await userPage.employeeExists(u.displayName))) {
      console.log(`Prerequisite: employee ${u.displayName} missing - creating it first`);
      await createEmployee(employeePage, u);
    }

    await smithPage.open();
    await smithPage.openAddWizard();
    await smithPage.fillBasicInformation(u);
    expect(await smithPage.selectValue('employee')).toContain(u.displayName);

    const saved = await smithPage.walkToSubmitAndSave(u);
    expect(saved, `smith for ${u.displayName} never appeared in the Worker list`).toBe(true);
    console.log(`Smith saved and mapped to employee ${u.displayName}`);
  });

  // ================= 4. COUNTER (LOCKER) =================
  test('TC-CNT-001 create locker counter for employee Sioniquser<N>', async ({ loginPage, counterPage, page }) => {
    test.setTimeout(420_000);
    const u = nextSioniqUser();
    const counterName = `${u.displayName} Locker`;
    console.log(`Iteration ${u.n}: counter "${counterName}", short name u${u.n}`);

    await login(loginPage, page);

    // Already created? (TC-ELC-001 completes the iteration, not this test.)
    await counterPage.open();
    await counterPage.selectTab();
    if ((await counterPage.gridRows.filter({ hasText: counterName }).count()) > 0) {
      console.log(`Counter "${counterName}" already exists - nothing to create`);
      return;
    }

    await counterPage.openAddWizard();
    await counterPage.fillLockerCounter(u);
    const response = await counterPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`Counter saved: "${counterName}" (Locker, Floor 4, Production, all locker types)`);

    // the saved counter shows in the list view (data table on page load)
    await counterPage.verifyRowInList(counterName);
  });

  // ================= 5. EMPLOYEE LOCKER & COUNTER ASSIGNMENT =================
  test('TC-ELC-001 map locker counter to employee Sioniquser<N>', async ({ loginPage, counterPage, page }) => {
    test.setTimeout(420_000);
    const u = nextSioniqUser();
    const counterName = `${u.displayName} Locker`;
    console.log(`Iteration ${u.n}: assign "${counterName}" to employee "${u.displayName}"`);

    await login(loginPage, page);

    // Already mapped? Then just make sure the iteration counter moved on.
    await counterPage.open();
    await counterPage.selectAssignmentTab();
    if ((await counterPage.gridRows.filter({ hasText: u.displayName }).count()) > 0) {
      console.log(`Assignment for ${u.displayName} already exists - completing iteration ${u.n}`);
      commit(u.n);
      return;
    }

    await counterPage.openAssignmentAdd();
    await counterPage.fillAssignment(u);

    // Counter Type auto-fills Locker from the picked counter (screenshot)
    expect(await counterPage.selectValue('countertype')).toContain('Locker');

    const response = await counterPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`Assignment saved: ${u.displayName} -> "${counterName}"`);

    // the saved assignment shows in the list view (data table on page load)
    await counterPage.verifyRowInList(u.displayName, {
      prepare: async () => { await counterPage.open(); await counterPage.selectAssignmentTab(); },
    });

    // Final chain step done - advance the Sioniquser iteration.
    commit(u.n);
    console.log(`Iteration ${u.n} complete; next run will use Sioniquser${u.n + 1}`);
  });
});
