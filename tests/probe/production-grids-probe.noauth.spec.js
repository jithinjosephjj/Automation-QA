const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only, saves nothing): what do the production grids show for the
// job the order-inhouse chain just created? Evidence for the QA lead on the
// 19-09-2026 grid behaviour: search matches nothing, unfiltered grid has no
// row for the new P## job, sample row checkbox does not take the check.
test('PROBE production grids vs the chain job', async ({ loginPage, production, page }) => {
  test.setTimeout(400_000);
  const st = makeState('e2e-orderbooking-state.json').readState();
  const job = st.jobWorkNo || 'P210';
  const prodNo = (st.productionNo || '').split('.')[0];
  console.log(`chain job: ${job}, production no: ${st.productionNo}`);
  await loginPage.ensureLoggedIn();

  const dumpGrid = async (label) => {
    await production.waitForIdle();
    await production.settle(2_000);
    const headers = (await page.getByRole('columnheader').allTextContents()).map((t) => t.trim()).filter(Boolean);
    const rows = (await page.getByRole('row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t && !/Actions/.test(t));
    console.log(`[${label}] headers: ${JSON.stringify(headers).slice(0, 400)}`);
    console.log(`[${label}] ${rows.length} rows; first 6: ${JSON.stringify(rows.slice(0, 6)).slice(0, 900)}`);
    console.log(`[${label}] mentions ${job}: ${rows.some((r) => r.includes(job))} | mentions ${prodNo}: ${prodNo ? rows.some((r) => r.includes(prodNo)) : 'n/a'}`);
    const empty = await page.getByText(/No pending items|No data|No records/i).first().textContent().catch(() => '');
    if (empty) console.log(`[${label}] empty-state text: ${empty.trim()}`);
  };

  // 1. Worker Issue, Casting Process / Sioniquser16 / Job Work
  await production.openWorkerIR('Worker Issue');
  await production.fillWorkerIRHeader({ process: 'Casting Process', worker: 'Sioniquser16' }).catch((e) => console.log('worker issue header:', String(e).split('\n')[0]));
  await dumpGrid('Worker Issue / Casting / Sioniquser16 / unfiltered');
  const search = page.locator('input[placeholder*="earch" i]').locator('visible=true').last();
  if (await search.count()) {
    await search.fill(job);
    await dumpGrid(`Worker Issue / search "${job}"`);
    await search.fill('');
  }

  // 2. Job Finalize queue
  await production.openRoute('/prd/app-job-finalize-list');
  await dumpGrid('Job Finalize / unfiltered');
  const s2 = page.locator('input[placeholder*="earch" i]').locator('visible=true').last();
  if (await s2.count()) { await s2.fill(job); await dumpGrid(`Job Finalize / search "${job}"`); await s2.fill(''); }

  // 3. Job Assignment, source Sample: what does ticking a row do?
  await production.openRoute('/prd/app-view-production-job-assignment');
  await production.clickAdd();
  await production.pick('sourceType', 'Sample', { exact: true }).catch((e) => console.log('sourceType pick:', String(e).split('\n')[0]));
  await production.settle(2_500);
  await dumpGrid('Job Assignment / source Sample / unfiltered');
  const firstBox = page.getByRole('row').filter({ has: page.getByRole('checkbox') }).first().getByRole('checkbox').first();
  if (await firstBox.count()) {
    const before = await firstBox.isChecked({ timeout: 2_000 }).catch(() => 'n/a');
    await firstBox.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2_000);
    const after = await page.getByRole('row').filter({ has: page.getByRole('checkbox') }).first().getByRole('checkbox').first().isChecked({ timeout: 2_000 }).catch(() => 'n/a');
    const dialogs = await page.locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]').locator('visible=true').allTextContents();
    console.log(`[Job Assignment] first sample row checkbox: before=${before} after=${after}; overlays now visible: ${JSON.stringify(dialogs.map((d) => d.replace(/\s+/g, ' ').trim().slice(0, 120)))}`);
  } else {
    console.log('[Job Assignment] no row with a checkbox rendered');
  }
});
