const { test, expect } = require('../../fixtures/test-fixtures');
const { RUN_ID } = require('../../utils/unique');

/**
 * HRM > Department > Process — Procurement department processes with
 * Allow Sub Process = FALSE (so no sub-processes), at location Cochin (the
 * logged-in BU). Separate from the Production Process/Sub-Process suite.
 *
 * Data from the QA lead's screenshot (05-09-2026): the 5 processes Transfer,
 * Lot, Certification, Remodel, Hallmark. The Procurement process form has NO
 * Material / Process Type / Configuration fields (those are Production-
 * department-specific) - it is just Name, Short Name, Department, Locations,
 * Allow Sub Process, Active. Allow Sub Process OFF (no sub-processes).
 *
 * Names carry a per-run suffix (the screenshot names already exist in QA) so
 * re-runs never collide. Save endpoint: POST CreateDepartmentProcess.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const SFX = RUN_ID.slice(-4);
let sc = 0;
const shortCode = (s) => `${s}${SFX.slice(-1)}${(++sc).toString(36)}`.toUpperCase().slice(0, 6);

const DEPARTMENT = 'Procurement';
const LOCATION = 'Cochin';

const PROCESSES = [
  { name: 'Transfer', shortName: 'TR' },
  { name: 'Lot', shortName: 'Lot' },
  { name: 'Certification', shortName: 'CRT' },
  { name: 'Remodel', shortName: 'RM' },
  { name: 'Hallmark', shortName: 'HM' },
];

test.describe('HRM Department - Procurement Processes (Allow Sub Process = false)', () => {
  for (const [i, p] of PROCESSES.entries()) {
    const tcId = `TC-HRM-PRC-${String(i + 1).padStart(2, '0')}`;
    test(`${tcId} ${p.name}`, async ({ loginPage, departmentProcess, page }) => {
      test.setTimeout(240_000);

      await loginPage.open();
      await loginPage.login();
      await loginPage.throwIfGated();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

      await departmentProcess.open();
      await departmentProcess.selectTab('Process');

      const procName = `${p.name} ${SFX}`;
      await departmentProcess.openAdd();
      await departmentProcess.fillProcess({
        name: procName,
        shortName: shortCode(p.shortName),
        department: DEPARTMENT,
        location: LOCATION,
        allowSubProcess: false, // Procurement processes have no sub-processes
      });
      const saved = await departmentProcess.submitForm(`procurement process "${p.name}"`);
      expect(JSON.stringify(saved)).toMatch(/success/i);
      await departmentProcess.verifyInGrid(procName);
    });
  }
});
