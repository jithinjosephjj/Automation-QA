const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only, nothing saved): the Process Movement Accept form with the
// "Repair" production source at Cochin never renders its pending grid
// (17-11-2026: waitForPendingGrid timed out after 120 s for GG50 / J695) and
// the Item Type pick warns on every repair step. Dumps the form's selects
// after each pick, the Item Type candidates and their options, the grid once
// an item type is set, the Job Assignment / Job Finalize list rows for the
// chain keys, and every production API call. Run:
//   npx playwright test tests/probe/repair-accept-cochin-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE repair accept form + job finalize queue at Cochin', async ({ loginPage, production, page }) => {
  test.setTimeout(600_000);
  const rep = makeState('e2e-b2b-repair-inhouse-state.json').readState();
  const b2b = makeState('e2e-b2border-state.json').readState();
  const repairKeys = [rep.repairNo, rep.productionNo].filter(Boolean);
  const b2bKeys = [b2b.jobWorkNo, b2b.productionNo].filter(Boolean);
  console.log(`repair state: ${JSON.stringify(rep)}; b2b order state: ${JSON.stringify(b2b)}`);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const pg = production;
  page.on('response', async (r) => {
    if (!/Production|Process|Worker|JobAssign|Repair|Finalize/i.test(r.url()) || /KeepAlive|Translation|\.js|\.css/i.test(r.url())) return;
    let body = ''; try { body = (await r.text()).slice(0, 400); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 200)} res=${body}`);
  });
  const selects = async (label) => {
    const info = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select, ng-select')]
      .filter((n) => n.offsetParent && !n.closest('sioniq-ng-select') === (n.tagName.toLowerCase() === 'sioniq-ng-select') || (n.tagName.toLowerCase() === 'sioniq-ng-select' && n.offsetParent))
      .map((n) => {
        const ctl = n.getAttribute('controlname') || n.getAttribute('formcontrolname') || n.querySelector('ng-select') && n.querySelector('ng-select').getAttribute('formcontrolname') || '';
        const lab = (n.closest('.form-group, .col, .mb-3, div') || n).querySelector('label');
        const ph = n.querySelector('.ng-placeholder');
        const val = [...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|');
        return `${ctl || '(no ctl)'} label="${lab ? lab.textContent.trim() : ''}" ph="${ph ? ph.textContent.trim() : ''}" = ${val || '(empty)'}`;
      }));
    console.log(`${label}: ${JSON.stringify(info)}`);
  };
  const labels = async (label) => {
    const info = await page.evaluate(() => [...document.querySelectorAll('label')].filter((n) => n.offsetParent).map((n) => n.textContent.trim()).filter(Boolean));
    console.log(`${label} visible labels: ${JSON.stringify(info.slice(0, 40))}`);
  };
  const rows = async (label, keys) => {
    const all = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim());
    const hits = all.filter((t) => keys.some((k) => t.includes(k)));
    console.log(`  ${label}: ${all.length} rows; ours: ${JSON.stringify(hits.map((t) => t.slice(0, 300)))}; first rows: ${JSON.stringify(all.slice(0, 3).map((t) => t.slice(0, 200)))}`);
  };
  const optionsOf = async (host, label) => {
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch((e) => console.log(`  ${label}: click failed ${String(e).split('\n')[0]}`));
    await page.waitForTimeout(2_000);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${label}: ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };

  // (1) job finalize queue - is the B2B order job still there?
  await pg.openRoute('/prd/app-job-finalize-list');
  await pg.waitForSpinner();
  await pg.settle(4_000);
  await rows('job finalize list (unfiltered)', b2bKeys);
  for (const k of b2bKeys) { await pg.narrowGrid(k).catch(() => {}); await pg.settle(2_000); await rows(`job finalize list searched "${k}"`, b2bKeys); }

  // (2) job assignment list - the repair job row
  await pg.openRoute('/prd/app-view-production-job-assignment');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  for (const k of repairKeys) { await pg.narrowGrid(k).catch(() => {}); await pg.settle(2_500); await rows(`job assignment list searched "${k}"`, repairKeys); }

  // (3) accept form with the Repair source
  await pg.openRoute('/prd/app-process-movement-setup');
  await pg.waitForSpinner();
  await page.getByRole('tab', { name: 'Accept' }).click({ timeout: 60_000 }).catch(() => {});
  await pg.clickAdd();
  await selects('accept form fresh');
  await pg.pick('process', 'Design And CAD', { search: true });
  await pg.settle(2_000);
  await pg.pick('subProcess', 'CAD Modeling', { search: true }).catch((e) => console.log(`sub process pick failed: ${String(e).split('\n')[0]}`));
  await pg.settle(2_000);
  await pg.pick('sourceType', 'Repair', { exact: true }).catch((e) => console.log(`source pick failed: ${String(e).split('\n')[0]}`));
  await pg.settle(3_000);
  await pg.waitForSpinner();
  await selects('accept form after Design And CAD / CAD Modeling / Repair');
  await labels('accept form');
  await rows('accept grid right after the source pick', repairKeys);
  // every visible ng-select that is still empty: list its options
  const hosts = page.locator('sioniq-ng-select, ng-select[formcontrolname]').locator('visible=true');
  const n = await hosts.count();
  for (let i = 0; i < n; i++) {
    const h = hosts.nth(i);
    const ctl = (await h.getAttribute('controlname').catch(() => null)) || (await h.getAttribute('formcontrolname').catch(() => null)) || `#${i}`;
    const val = (await h.locator('.ng-value').allTextContents().catch(() => [])).join('|').replace(/×/g, '').trim();
    if (val) continue;
    const host = (await h.locator('ng-select').count()) ? h.locator('ng-select').first() : h;
    const opts = await optionsOf(host, `empty select ${ctl} options`);
    if (opts.some((o) => /^Metal$/i.test(o))) {
      await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /^\s*Metal\s*$/ }).first().click({ timeout: 5_000 }).catch((e) => console.log(`  Metal pick failed: ${String(e).split('\n')[0]}`));
      console.log(`  picked Metal on ${ctl}`);
      await pg.settle(3_000);
      const outcome = await pg.waitForPendingGrid(repairKeys, 'accept Design And CAD / Repair / Metal', 90_000);
      console.log(`  grid outcome: ${outcome}`);
      await rows('accept grid after Metal', repairKeys);
      await selects('accept form after Metal');
    }
  }
  // Casting Process / Repair for comparison
  await pg.openRoute('/prd/app-process-movement-setup');
  await pg.waitForSpinner();
  await page.getByRole('tab', { name: 'Accept' }).click({ timeout: 60_000 }).catch(() => {});
  await pg.clickAdd();
  await pg.pick('process', 'Casting Process', { search: true });
  await pg.settle(2_000);
  await pg.pick('sourceType', 'Repair', { exact: true }).catch((e) => console.log(`source pick failed: ${String(e).split('\n')[0]}`));
  await pg.settle(3_000);
  await selects('accept form Casting / Repair');
  await pg.waitForPendingGrid(repairKeys, 'accept Casting / Repair', 60_000);
  await rows('accept grid Casting / Repair', repairKeys);
});
