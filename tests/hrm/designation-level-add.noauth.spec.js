const { test, expect } = require('../../fixtures/test-fixtures');
const { RUN_ID } = require('../../utils/unique');

/**
 * HRM > Department > Designation / Level add operations (/hrm/department-setup
 * tabs), verified live 07-09-2026.
 *
 * Designation form: name (dynamic), shortName, department, designationType
 * (multi-select master), active. Save: POST Create...Designation.
 * Level form: department, designation (filtered by department), level
 * (designationLevel, e.g. "L1"), sortOrder (number), active. A Level needs an
 * existing Designation, so the Level test creates its own designation first.
 *
 * Names carry a per-run suffix so re-runs never collide. Per the add-spec
 * checklist: Escape-free retrying picks, unique per-run data, save-response
 * asserted (throws on a silent block), list verified.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const SFX = RUN_ID.slice(-4);
let sc = 0;
const shortCode = (s) => `${s}${SFX.slice(-1)}${(++sc).toString(36)}`.toUpperCase().slice(0, 6);

const DEPARTMENT = 'Production';

test.describe('HRM Department - Designation & Level add', () => {
  test('TC-HRM-DSG-01 add a Designation', async ({ loginPage, departmentProcess, page }) => {
    test.setTimeout(240_000);
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    await departmentProcess.open();
    await departmentProcess.selectTab('Designation');

    const name = `QA Designation ${SFX}`;
    await departmentProcess.openAdd();
    await departmentProcess.fillDesignation({
      name,
      shortName: shortCode('QD'),
      department: DEPARTMENT,
      // designationType omitted -> first available option
    });
    const saved = await departmentProcess.submitForm(`designation "${name}"`, /Designation/i);
    expect(JSON.stringify(saved)).toMatch(/success/i);
    await departmentProcess.verifyInGrid(name);
  });

  test('TC-HRM-LVL-01 add a Level (with its designation prerequisite)', async ({ loginPage, departmentProcess, page }) => {
    test.setTimeout(300_000);
    await loginPage.open();
    await loginPage.login();
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    await departmentProcess.open();

    // prerequisite: a fresh designation under the department, so the Level's
    // designation dropdown has a known, unique target
    const desigName = `QA Level Desig ${SFX}`;
    await departmentProcess.selectTab('Designation');
    await departmentProcess.openAdd();
    await departmentProcess.fillDesignation({
      name: desigName,
      shortName: shortCode('QLD'),
      department: DEPARTMENT,
    });
    const savedD = await departmentProcess.submitForm(`designation "${desigName}"`, /Designation/i);
    expect(JSON.stringify(savedD)).toMatch(/success/i);
    await departmentProcess.verifyInGrid(desigName);

    // the Level itself, under that designation
    await departmentProcess.selectTab('Level');
    await departmentProcess.openAdd();
    await departmentProcess.fillLevel({
      department: DEPARTMENT,
      designation: desigName,
      level: 'L1',
      sortOrder: 1,
    });
    const savedL = await departmentProcess.submitForm(`level "L1" of "${desigName}"`, /Level/i);
    expect(JSON.stringify(savedL)).toMatch(/success/i);
    // the level grid keys by department/designation - find our unique designation
    await departmentProcess.verifyInGrid(desigName);
  });
});
