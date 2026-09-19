const { test } = require('../../fixtures/test-fixtures');

// PROBE: which workers does the Worker Receipt form offer for a process, and
// does typing into the Worker select filter or break the list? Read-only.
test('PROBE worker receipt Worker options', async ({ loginPage, production, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await production.openWorkerIR('Worker Receipt');

  const dump = async (label) => {
    await production.settle(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
    console.log(`[${label}] ${opts.length} options: ${JSON.stringify(opts).slice(0, 700)}`);
  };
  for (const process of ['Casting Process', 'Design And CAD']) {
    await production.pickByLabel('Process', process).catch((e) => console.log(`process ${process}: ${String(e).split('\n')[0]}`));
    await production.pickByLabel('Worker Type', 'Inhouse Worker', { exact: true }).catch((e) => console.log(`worker type: ${String(e).split('\n')[0]}`));
    const worker = page.locator('label:text-is("Worker")').last().locator('xpath=following::ng-select[1]');
    await production.closeStalePanels();
    await worker.locator('.ng-select-container').click();
    await dump(`${process} / Worker untyped`);
    await worker.locator('input[role="combobox"]').fill('Sioniq');
    await dump(`${process} / typed "Sioniq"`);
    await worker.locator('input[role="combobox"]').fill('Sioniquser16');
    await dump(`${process} / typed "Sioniquser16"`);
    await page.keyboard.press('Escape');
  }
});
