const { test } = require('../../fixtures/test-fixtures');
const { readState } = require('../../utils/e2e-state');

// PROBE (read-only, never submits): walk the CAD Upload / CAD Approval and
// Material Issue / Receipt add forms, listing each select's options and what
// the form reveals after each pick.
test('PROBE CAD and Material Transaction forms in depth', async ({ loginPage, production, page }) => {
  test.setTimeout(500_000);
  await loginPage.ensureLoggedIn();
  const st = readState();
  console.log(`concept chain state: ${JSON.stringify(st)}`);

  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    if (!(await host.count())) { console.log(`  ${ctl}: (no such select)`); return []; }
    await production.closeStalePanels();
    await host.locator('.ng-select-container').click();
    await page.waitForTimeout(900);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    await page.keyboard.press('Escape');
    console.log(`  ${ctl} options (${opts.length}): ${JSON.stringify(opts.slice(0, 25))}`);
    return opts;
  };
  const dump = async (label) => {
    await production.waitForIdle();
    await production.settle(1_500);
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const controls = [];
      for (const w of [...document.querySelectorAll('sioniq-ng-select')].filter(vis)) {
        const host = w.querySelector('ng-select');
        const box = w.closest('div.grid, div.form-group, div.col, div[class*=col-]') || w.parentElement;
        const lbl = (box?.querySelector('label')?.textContent || '').replace(/\s+/g, ' ').trim();
        const val = host?.querySelector('.ng-value')?.textContent.replace(/\s+/g, ' ').trim() || '';
        controls.push(`SELECT ${lbl || '(no label)'} [${w.getAttribute('controlname')}]${val ? ' = ' + val : ''}${host?.classList.contains('ng-invalid') ? ' *req' : ''}`);
      }
      for (const i of [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis)) {
        if (i.closest('ng-select') || i.closest('header, .topbar, .navbar')) continue;
        const box = i.closest('div.grid, div.form-group, div.col, div[class*=col-]') || i.parentElement;
        const lbl = (box?.querySelector('label')?.textContent || i.placeholder || '').replace(/\s+/g, ' ').trim();
        controls.push(`INPUT ${lbl} [${i.id || i.getAttribute('formcontrolname') || i.type}]${i.value ? ' = ' + i.value : ''}${i.disabled ? ' (disabled)' : ''}${i.classList.contains('ng-invalid') ? ' *req' : ''}`);
      }
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const rows = [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)).slice(0, 4);
      const buttons = [...new Set([...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30))];
      const headings = [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60);
      const alerts = [...document.querySelectorAll('[role=alert], .alert, .text-danger')].filter(vis).map((a) => a.textContent.trim()).filter(Boolean).slice(0, 5);
      return { controls, headers, rows, buttons, headings, alerts };
    });
    console.log(`\n##### ${label}\nheadings: ${JSON.stringify(info.headings)}\nbuttons: ${JSON.stringify(info.buttons)}\ncontrols:\n  ${info.controls.join('\n  ')}\ngrid: ${JSON.stringify(info.headers)}\nrows: ${JSON.stringify(info.rows)}\nalerts: ${JSON.stringify(info.alerts)}`);
  };
  const openTabAdd = async (route, tab) => {
    await production.openRoute(route);
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await production.settle(1_500);
    await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click();
    await production.settle(1_500);
  };

  // ---------- CAD Upload ----------
  await openTabAdd('/prd/app-cad-setup', 'Upload');
  await dump('CAD Upload ADD - empty');
  const workers = await options('workerID');
  await production.pick('workerID', 'Prabhat', { search: true }).catch((e) => console.log('worker pick:', String(e).split('\n')[0]));
  const prodNos = await options('productionID');
  await dump('CAD Upload ADD - after Worker Prabhat');

  // ---------- CAD Approval ----------
  await openTabAdd('/prd/app-cad-setup', 'Approval');
  await dump('CAD Approval ADD - empty');
  await options('worker');
  await production.pick('worker', 'Prabhat', { search: true }).catch((e) => console.log('worker pick:', String(e).split('\n')[0]));
  await options('productionNo');
  await dump('CAD Approval ADD - after Worker Prabhat');

  // ---------- Material Issue ----------
  await openTabAdd('/prd/production-material-transaction-list', 'Issue');
  await dump('Material Issue ADD - empty');
  await options('employeeID');
  await production.pick('employeeID', 'Ubaid', { search: true }).catch((e) => console.log('employee pick:', String(e).split('\n')[0]));
  await options('departmentProcessID');
  await production.pick('departmentProcessID', 'Casting Process', { search: true }).catch((e) => console.log('process pick:', String(e).split('\n')[0]));
  await options('masterDataValueID_ProductionWorkerType');
  await production.pick('masterDataValueID_ProductionWorkerType', 'Inhouse Worker', { exact: true }).catch((e) => console.log('worker type pick:', String(e).split('\n')[0]));
  await options('vendorID');
  await production.pick('vendorID', 'Sioniquser16', { search: true }).catch((e) => console.log('worker pick:', String(e).split('\n')[0]));
  const entity = await options('masterDataValueID_StockEntityType');
  if (entity.length) await production.pick('masterDataValueID_StockEntityType', entity[0], { exact: true }).catch(() => {});
  const identity = await options('masterDataValueID_StockIdentityType');
  if (identity.length) await production.pick('masterDataValueID_StockIdentityType', identity[0], { exact: true }).catch(() => {});
  await dump('Material Issue ADD - after header picks');
  await page.screenshot({ path: 'bug-reports/shots/material-issue-filled.png', fullPage: true });

  // ---------- Material Receipt ----------
  await openTabAdd('/prd/production-material-transaction-list', 'Receipt');
  await dump('Material Receipt ADD - empty');
  const rsel = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent).map((n) => n.getAttribute('controlname')));
  for (const ctl of rsel.slice(0, 4)) await options(ctl);
  await page.screenshot({ path: 'bug-reports/shots/material-receipt-empty.png', fullPage: true });
  console.log(`(cad workers: ${workers.length}, production nos: ${JSON.stringify(prodNos.slice(0, 10))})`);
});
