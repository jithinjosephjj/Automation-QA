const { test, expect } = require('../../fixtures/test-fixtures');
const { nextSioniqUser, commit, currentN, setNext } = require('../../utils/sioniquser');

/**
 * Master-data add operations for one Sioniquser<N> iteration, in dependency
 * order: Employee → User → Smith. Declaration order inside one file is the
 * only ordering both the CLI and the VS Code test runner honour (numbered
 * separate files run alphabetically in the CLI but not in VS Code).
 *
 * Each test is independent (own login/session), idempotent for the current
 * iteration (skips what already exists), and creates its own employee
 * prerequisite when run alone. The iteration number comes from qa: the
 * first step reads the last Sioniquser on the Employee list and writes
 * sioniquser-counter.json to match (see resolveIteration); the final step
 * advances the counter once the whole chain has saved.
 *
 *   run everything : npx playwright test tests/masters --headed
 *   run one page   : npx playwright test -g "TC-USR-001" --headed
 *   with the chain : npm run test:cadm  (this suite, then the Concept-CAD-Material
 *                    chain, which issues to the Sioniquser<N> created here)
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

async function login(loginPage, page) {
  await loginPage.ensureLoggedIn();
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

/**
 * qa decides the iteration number, not the counter file (QA lead, 07-10-2026:
 * "when you see Sioniquser45 as the last user in qa, add user 46").
 *
 * The highest Sioniquser<N> on qa's Employee list (page 1, newest first) is
 * the last iteration that was started. When its final artifact - the locker
 * assignment - exists, that iteration is complete and this run creates
 * N+1; when it is missing, the iteration was cut short and this run resumes
 * it (every step skips what already saved). The counter file is then
 * written to match, so the later steps and the production chains (which
 * issue to the Sioniquser created last) agree with qa.
 *
 * Why: the counter used to advance only in the last step, so a run killed
 * after the assignment saved left it stale and the next run skipped all
 * five steps as "already exists" and created nothing (04-10 -> 07-10-2026,
 * iteration 39). A reset qa database or a hand-made Sioniquser would have
 * confused it the same way.
 */
async function resolveIteration(employeePage, counterPage) {
  await employeePage.open();
  await employeePage.waitForIdle();
  await employeePage.settle(2_000);
  let highest = 0;
  for (const text of await employeePage.gridRows.allInnerTexts()) {
    for (const m of text.matchAll(/\bSioniquser(\d+)\b/g)) highest = Math.max(highest, Number(m[1]));
  }
  let n = currentN();
  if (highest === 0) {
    console.log(`qa Employee list shows no Sioniquser - keeping the counter's iteration ${n}`);
  } else {
    await counterPage.open();
    await counterPage.selectAssignmentTab();
    const complete = (await counterPage.gridRows.filter({ hasText: `Sioniquser${highest}` }).count()) > 0;
    n = complete ? highest + 1 : highest;
    console.log(`qa shows Sioniquser${highest} as the last employee, its iteration is ${complete ? 'complete' : 'incomplete'} - ${complete ? 'creating' : 'resuming'} Sioniquser${n}`);
  }
  setNext(n);
  const u = nextSioniqUser();
  console.log(`Iteration ${u.n}: employee "${u.displayName}", sales code ${u.salesCode}`);
  return u;
}

test.describe('Master add operations - Employee, User, Smith', () => {
  // ================= 1. EMPLOYEE =================
  test('TC-EMP-001 create employee Sioniquser<N>', async ({ loginPage, employeePage, userPage, counterPage, page }) => {
    test.setTimeout(420_000);

    await login(loginPage, page);

    // qa decides N: the last Sioniquser on qa + 1 when its chain is complete,
    // the same N when the chain was cut short (the steps resume it).
    const u = await resolveIteration(employeePage, counterPage);

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
