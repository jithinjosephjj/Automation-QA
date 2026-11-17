const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only, nothing saved): why Process Movement Accept at Cochin
// offers NO Production Source for "Design And CAD" (17-11-2026, five inhouse
// production chains failed at their step 4 after the Cochin-login move while
// the accept at "Casting Process" still works). Dumps the job assignment list
// row of the chain's job, the accept form's Production Source options before
// and after the Sub Process pick (and for Casting Process), every production
// API call, and the Worker Issue grid for Design And CAD / CAD Modeling. Run:
//   npx playwright test tests/probe/process-movement-accept-cochin-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE process movement accept source list at Cochin', async ({ loginPage, production, page }) => {
  test.setTimeout(600_000);
  const st = makeState('e2e-production-state.json').readState();
  const keys = [st.jobWorkNo, st.productionNo, st.conceptNo].filter(Boolean);
  console.log(`concept chain state: ${JSON.stringify(st)}`);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const pg = production;
  page.on('response', async (r) => {
    if (!/Production|Process|Worker|JobAssign/i.test(r.url()) || /KeepAlive|Translation|\.js|\.css/i.test(r.url())) return;
    let body = ''; try { body = (await r.text()).slice(0, 600); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 300)} res=${body}`);
  });
  const options = async (ctl, label) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).first();
    if (!(await host.count())) { console.log(`  ${label || ctl}: control not on the page`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${label || ctl}: ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  const selects = async (label) => {
    const info = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select, ng-select[formcontrolname]')]
      .filter((n) => n.offsetParent)
      .map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname')}=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}`));
    console.log(`${label}: ${JSON.stringify(info)}`);
  };
  const rows = async (label) => {
    const all = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim());
    const hits = all.filter((t) => keys.some((k) => t.includes(k)));
    console.log(`  ${label}: ${all.length} rows; ours: ${JSON.stringify(hits.map((t) => t.slice(0, 300)))}; first rows: ${JSON.stringify(all.slice(0, 3).map((t) => t.slice(0, 200)))}`);
  };

  // (1) job assignment list - the chain's job row
  await pg.openRoute('/prd/app-view-production-job-assignment');
  await pg.settle(3_000);
  for (const k of keys) { await pg.narrowGrid(k).catch(() => {}); await pg.settle(2_500); await rows(`job assignment list searched "${k}"`); }

  // (2) accept form: Design And CAD, before/after Sub Process; then Casting Process
  await pg.openRoute('/prd/app-process-movement-setup');
  await page.getByRole('tab', { name: 'Accept' }).click({ timeout: 10_000 }).catch(() => {});
  await pg.clickAdd();
  await selects('accept form fresh');
  await options('sourceType', 'Production Source before any pick');
  await pg.pick('process', 'Design And CAD', { search: true });
  await pg.settle(3_000);
  await options('sourceType', 'Production Source after process Design And CAD');
  await options('subProcess', 'Sub Process list');
  await pg.pick('subProcess', 'CAD Modeling', { search: true }).catch((e) => console.log(`sub process pick failed: ${String(e).split('\n')[0]}`));
  await pg.settle(3_000);
  await options('sourceType', 'Production Source after sub process CAD Modeling');
  await selects('accept form after picks');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  await rows('accept grid (Design And CAD / CAD Modeling)');

  await pg.openRoute('/prd/app-process-movement-setup');
  await page.getByRole('tab', { name: 'Accept' }).click({ timeout: 10_000 }).catch(() => {});
  await pg.clickAdd();
  await pg.pick('process', 'Casting Process', { search: true });
  await pg.settle(3_000);
  await options('sourceType', 'Production Source after process Casting Process');

  // (3) worker issue grid for Design And CAD / CAD Modeling / Prabhat
  await pg.openWorkerIR('Worker Issue');
  await options('departmentProcessID', 'Worker Issue process list');
  try {
    await pg.pick('departmentProcessID', 'Design And CAD', { search: true });
    await pg.pickByLabel('Sub Process', 'CAD Modeling', { search: true }).catch((e) => console.log(`worker issue sub process: ${String(e).split('\n')[0]}`));
    await pg.pick('masterDataValueID_WorkerType', 'Inhouse Worker', { exact: true });
    await options('vendorID', 'Worker list');
    await pg.pick('vendorID', 'Prabhat', { search: true });
    await options('masterDataValueID_ProductionSourceType', 'Worker Issue production source list');
    await pg.pick('masterDataValueID_ProductionSourceType', 'Job Work', { exact: true });
    await pg.waitForSpinner();
    await pg.settle(4_000);
    await rows('worker issue grid (Design And CAD / CAD Modeling / Prabhat / Job Work)');
  } catch (e) {
    console.log(`worker issue probe stopped: ${String(e).split('\n')[0]}`);
  }
  await selects('worker issue form');
});
