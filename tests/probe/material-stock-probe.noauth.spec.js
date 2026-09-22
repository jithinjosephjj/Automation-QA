const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE (read-only): Material Issue with Metal / Stock lists the EMPLOYEE's
// locker stock - which employees have any? And does Metal / Jobwork Stock
// list our job (ZZZ58 / J427, issued to Sioniquser16 at Casting)?
test('PROBE material issue stock grids', async ({ loginPage, production, page }) => {
  test.setTimeout(500_000);
  const st = makeState('e2e-cad-material-state.json').readState();
  console.log(`chain: ${JSON.stringify(st)}`);
  await loginPage.ensureLoggedIn();

  const gridRows = async () => {
    await production.waitForIdle();
    await production.settle(2_000);
    return page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 140)).filter((t) => t && !/No Data/.test(t)));
  };
  const employees = async () => {
    const host = production.select('employeeID');
    await host.locator('.ng-select-container').click();
    await page.waitForTimeout(900);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    await page.keyboard.press('Escape');
    return opts;
  };

  await production.openMaterialTabAdd('Issue');
  const emps = await employees();
  console.log(`employees offered (${emps.length}): ${JSON.stringify(emps)}`);

  // A) Metal / Jobwork Stock for Ubaid -> the job grid
  await production.fillMaterialHeader({ employee: 'Ubaid', process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser16', stockEntityType: 'Metal', stockIdentityType: 'Jobwork Stock' });
  const jobRows = await gridRows();
  console.log(`[Metal / Jobwork Stock, Ubaid, Casting, Sioniquser16] ${jobRows.length} rows: ${JSON.stringify(jobRows.slice(0, 5))}`);
  const locker = await page.locator('#lockerName, input[formcontrolname="lockerName"]').first().inputValue().catch(() => '?');
  console.log(`  locker for Ubaid: ${locker}`);

  // B) Metal / Stock for a handful of employees -> who has locker stock?
  for (const emp of emps.slice(0, 12)) {
    await production.openMaterialTabAdd('Issue');
    try {
      await production.fillMaterialHeader({ employee: emp, process: 'Casting Process', subProcess: 'Casting Inspection', worker: 'Sioniquser16', stockEntityType: 'Metal', stockIdentityType: 'Stock' });
    } catch (e) { console.log(`  ${emp}: header failed (${String(e).split('\n')[0].slice(0, 100)})`); continue; }
    const lk = await page.locator('#lockerName, input[formcontrolname="lockerName"]').first().inputValue().catch(() => '?');
    const rows = await gridRows();
    console.log(`[Metal / Stock] ${emp} (locker "${lk}"): ${rows.length} rows ${rows.length ? JSON.stringify(rows.slice(0, 2)) : ''}`);
  }
});
