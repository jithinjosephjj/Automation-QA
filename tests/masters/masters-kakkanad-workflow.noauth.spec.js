const { test, expect } = require('../../fixtures/test-fixtures');
const { nextSioniqKkdUser, commitKkd, currentKkdN, setNextKkd } = require('../../utils/sioniquser');

/**
 * MASTERS at KAKKANAD, start to end, for one SioniqKkd<N> iteration:
 * Employee -> User -> Locker (a Counter of type Locker) -> the employee's
 * locker mapping. Requested 16-11-2026 ("create masters flow for kakkanad from
 * start to end employee, user, locker"). The Cochin suite
 * (master-add-operations) keeps its own Sioniquser<N> series; this one counts
 * SioniqKkd<N> in sioniqkkd-counter.json.
 *
 *   TC-KKD-01  Admin > Employee: SioniqKkd<N> (Sioniq / kkd<N>, Male, DOB 01/06/1996,
 *              Auto id, legal entity Sioniq QA, BUSINESS UNIT KAKKANAD, Production /
 *              Supervisor / L2 / KKD Process (+ its first sub-process), sales code KK<N>,
 *              Permanent, DOJ 01/06/2026)
 *   TC-KKD-02  Admin > Users: name SioniqKkd<words>, login SioniqKkd<N>, password 123,
 *              validity = business date + 5 years, LOCATION KAKKANAD, ERP User, the
 *              employee, role Admin (default)
 *   TC-KKD-03  Admin > Counter: "SioniqKkd<N> Locker", short name k<N>, LOCATION
 *              KAKKANAD, the location's first floor, Counter Type Locker, department
 *              Production, all locker types
 *   TC-KKD-04  Counter > Employee Counter Mapping: BU KAKKANAD, the employee, the locker
 *              (floor / type auto-fill) -> the iteration is complete
 *
 * Every step is idempotent for the current iteration (skips what exists) and
 * qa decides N: the last SioniqKkd on the Employee list + 1 when its mapping
 * exists, the same N when the chain was cut short. MUST run headed.
 */

const BU = 'Kakkanad';

async function createEmployee(employeePage, u) {
  await employeePage.open();
  await employeePage.openAddWizard();
  // Kakkanad offers [Concept Process | KKD Process] (16-11-2026) - the KKD one (user: 'process kkd process'); the sub-process is the first under it
  await employeePage.fillEmployee(u, { bu: BU, process: process.env.KKD_PROCESS || 'KKD Process', subprocess: process.env.KKD_SUBPROCESS || null });
  const response = await employeePage.submit();
  expect(response).toBeTruthy();
  expect(response.message).toMatch(/saved successfully/i);
  console.log(`Employee saved: ${u.displayName} at ${BU} (code ${response.data && response.data.employeeCode})`);
  return response;
}

/** qa decides N (see the Cochin suite's resolveIteration) - here on the SioniqKkd series. */
async function resolveIteration(employeePage, counterPage) {
  await employeePage.open();
  await employeePage.waitForIdle();
  await employeePage.settle(2_000);
  let highest = 0;
  for (const text of await employeePage.gridRows.allInnerTexts()) {
    for (const m of text.matchAll(/\bSioniqKkd(\d+)\b/g)) highest = Math.max(highest, Number(m[1]));
  }
  let n = currentKkdN();
  if (highest === 0) {
    console.log(`qa Employee list shows no SioniqKkd - keeping the counter's iteration ${n}`);
  } else {
    await counterPage.open();
    await counterPage.selectAssignmentTab();
    const complete = (await counterPage.gridRows.filter({ hasText: `SioniqKkd${highest}` }).count()) > 0;
    n = complete ? highest + 1 : highest;
    console.log(`qa shows SioniqKkd${highest} as the last Kakkanad employee, its iteration is ${complete ? 'complete' : 'incomplete'} - ${complete ? 'creating' : 'resuming'} SioniqKkd${n}`);
  }
  setNextKkd(n);
  const u = nextSioniqKkdUser();
  console.log(`Iteration ${u.n}: employee "${u.displayName}", sales code ${u.salesCode}`);
  return u;
}

test.describe('Masters at Kakkanad - Employee, User, Locker, Mapping', () => {
  test('TC-KKD-01 create employee SioniqKkd<N> at Kakkanad', async ({ loginPage, employeePage, userPage, counterPage }) => {
    test.setTimeout(420_000);
    await loginPage.ensureLoggedIn({ bu: BU });
    const u = await resolveIteration(employeePage, counterPage);
    const userExists = await userPage.loginExists(u.displayName);
    const employeeExists = userExists || (await userPage.employeeExists(u.displayName));
    if (employeeExists) { console.log(`Employee ${u.displayName} already exists - nothing to create`); return; }
    await createEmployee(employeePage, u);
    await employeePage.verifyRowInList(u.displayName);
  });

  test('TC-KKD-02 create user SioniqKkd<N> at Kakkanad mapped to its employee', async ({ loginPage, employeePage, userPage }) => {
    test.setTimeout(420_000);
    const u = nextSioniqKkdUser();
    console.log(`Iteration ${u.n}: user name "${u.nameInWords}", login "${u.displayName}"`);
    await loginPage.ensureLoggedIn({ bu: BU });
    if (await userPage.loginExists(u.displayName)) { console.log(`User ${u.displayName} already exists - nothing to create`); return; }
    if (!(await userPage.employeeExists(u.displayName))) { console.log(`Prerequisite: employee ${u.displayName} missing - creating it first`); await createEmployee(employeePage, u); }
    await userPage.open();
    await userPage.openAddWizard();
    await userPage.fillUser(u, { location: BU });
    const response = await userPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`User saved: login "${u.displayName}" at ${BU}, password 123, role Admin (default)`);
    await userPage.verifyRowInList(u.displayName);
  });

  test('TC-KKD-03 create locker counter "SioniqKkd<N> Locker" at Kakkanad', async ({ loginPage, counterPage }) => {
    test.setTimeout(420_000);
    const u = nextSioniqKkdUser();
    const counterName = `${u.displayName} Locker`;
    console.log(`Iteration ${u.n}: counter "${counterName}", short name k${u.n}`);
    await loginPage.ensureLoggedIn({ bu: BU });
    await counterPage.open();
    await counterPage.selectTab();
    if ((await counterPage.gridRows.filter({ hasText: counterName }).count()) > 0) { console.log(`Counter "${counterName}" already exists - nothing to create`); return; }
    await counterPage.openAddWizard();
    await counterPage.fillLockerCounter(u, { location: BU, floor: process.env.KKD_FLOOR || null, shortName: `k${u.n}` });
    const response = await counterPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`Counter saved: "${counterName}" (Locker at ${BU}, Production, all locker types)`);
    await counterPage.verifyRowInList(counterName);
  });

  test('TC-KKD-04 map the locker to employee SioniqKkd<N> at Kakkanad', async ({ loginPage, counterPage }) => {
    test.setTimeout(420_000);
    const u = nextSioniqKkdUser();
    const counterName = `${u.displayName} Locker`;
    console.log(`Iteration ${u.n}: assign "${counterName}" to employee "${u.displayName}"`);
    await loginPage.ensureLoggedIn({ bu: BU });
    await counterPage.open();
    await counterPage.selectAssignmentTab();
    if ((await counterPage.gridRows.filter({ hasText: u.displayName }).count()) > 0) { console.log(`Assignment for ${u.displayName} already exists - completing iteration ${u.n}`); commitKkd(u.n); return; }
    await counterPage.openAssignmentAdd();
    await counterPage.fillAssignment(u, { location: BU, floor: process.env.KKD_FLOOR || null });
    expect(await counterPage.selectValue('countertype')).toContain('Locker');
    const response = await counterPage.submit();
    expect(response).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/success/i);
    console.log(`Assignment saved: ${u.displayName} -> "${counterName}" at ${BU}`);
    await counterPage.verifyRowInList(u.displayName, { prepare: async () => { await counterPage.open(); await counterPage.selectAssignmentTab(); } });
    commitKkd(u.n);
    console.log(`Iteration ${u.n} complete; next run will use SioniqKkd${u.n + 1}`);
  });
});
