const { test, expect } = require('../../fixtures/test-fixtures');
const { RUN_ID } = require('../../utils/unique');
const { PROCESSES, SUB_PROCESSES, DEPARTMENT, LOCATION } = require('./department-process-data');

/**
 * HRM > Department > Process / Sub-Process — create the jewellery production
 * process hierarchy from the QA lead's Excel exports (see
 * department-process-data.js) through /hrm/department-setup.
 *
 * One test per production process (10): it adds the Process on the Process tab
 * (with the sheet's Material Issue/Receipt/Clearance and, only for Design And
 * CAD, Process Type "CAD"), then adds each of its Sub-Processes on the
 * Sub-Process tab, linked to that parent.
 *
 * Names carry a per-run suffix (QA lead: "append unique suffix") so re-runs
 * never collide on the name / short-name uniqueness constraint. Sub-processes
 * whose parent process is not in the sheet (only "Burnout" -> "Casting") are
 * SKIPPED (QA lead: "for mismatching sub processes skip those").
 *
 * Save endpoints: POST CreateDepartmentProcess / CreateDepartmentSubProcess ->
 * { code: 1001, "Saved successfully!" }. Per the add-spec checklist: Escape-free
 * retrying picks, unique per-run data, save-response asserted (throws on a
 * silent block), list verified.
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const SFX = RUN_ID.slice(-4); // unique per run
let sc = 0;
// compact, unique-per-run short code: sheet short + 1 run char + base36 counter
const shortCode = (sheetShort) => `${sheetShort}${SFX.slice(-1)}${(++sc).toString(36)}`.toUpperCase().slice(0, 6);

// group sub-processes under their parent process; skip parents not in the sheet
const procNames = new Set(PROCESSES.map((p) => p.name));
const subsByProcess = {};
const skipped = [];
for (const s of SUB_PROCESSES) {
  if (procNames.has(s.process)) {
    (subsByProcess[s.process] = subsByProcess[s.process] || []).push(s);
  } else {
    skipped.push(`${s.name} (parent "${s.process}")`);
  }
}
if (skipped.length) console.log(`sub-processes skipped (parent not in process sheet): ${skipped.join(', ')}`);

test.describe('HRM Department - Process & Sub-Process (from Excel)', () => {
  for (const [i, p] of PROCESSES.entries()) {
    const tcId = `TC-HRM-PROC-${String(i + 1).padStart(2, '0')}`;
    const subs = subsByProcess[p.name] || [];
    test(`${tcId} ${p.name} + ${subs.length} sub-processes`, async ({ loginPage, departmentProcess, page }) => {
      test.setTimeout(900_000);

      await loginPage.open();
      await loginPage.login();
      await loginPage.throwIfGated();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

      await departmentProcess.open();

      // ---- Process ----
      const procName = `${p.name} ${SFX}`;
      await departmentProcess.selectTab('Process');
      await departmentProcess.openAdd();
      await departmentProcess.fillProcess({
        name: procName,
        shortName: shortCode(p.shortName),
        department: DEPARTMENT,
        location: LOCATION,
        materialIssue: p.materialIssue,
        materialReceipt: p.materialReceipt,
        materialClearance: p.materialClearance,
        processType: p.processType, // only Design And CAD -> "CAD"
        allowSubProcess: true,
      });
      const savedP = await departmentProcess.submitForm(`process "${p.name}"`);
      expect(JSON.stringify(savedP)).toMatch(/success/i);
      await departmentProcess.verifyInGrid(procName);

      // ---- Sub-Processes under that process ----
      await departmentProcess.selectTab('Sub-Process');
      for (const s of subs) {
        const subName = `${s.name} ${SFX}`;
        await departmentProcess.openAdd();
        await departmentProcess.fillSubProcess({
          name: subName,
          shortName: shortCode(s.shortName),
          department: DEPARTMENT,
          location: LOCATION,
          process: procName, // the suffixed parent we just created
          materialIssue: s.materialIssue,
          materialReceipt: s.materialReceipt,
          materialClearance: s.materialClearance,
        });
        const savedS = await departmentProcess.submitForm(`sub-process "${s.name}"`);
        expect(JSON.stringify(savedS)).toMatch(/success/i);
        await departmentProcess.verifyInGrid(subName);
      }
    });
  }
});
