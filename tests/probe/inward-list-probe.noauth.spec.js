const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): what does the Metal Inward list show for the two
// jobwork-return inwards of 21-09-2026 - M291 (lot-eligible) vs M293 (missing
// from the Lot Generation grid)?
test('PROBE metal inward list rows for M291 and M293', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(240_000);
  await loginPage.ensureLoggedIn();
  await metalInward.open();
  const headers = (await page.getByRole('columnheader').allTextContents()).map((t) => t.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
  console.log('columns: ' + JSON.stringify(headers));
  for (const no of ['M291', 'M293', 'M292']) {
    const search = page.getByRole('textbox', { name: 'Search' }).last();
    await search.fill(no);
    await metalInward.waitForIdle();
    await metalInward.settle(2500);
    const rows = (await page.getByRole('row').allTextContents()).map((t) => t.replace(/[ ]+/g, ' ').trim()).filter((t) => t.includes(no));
    console.log('[' + no + '] ' + (rows.length ? rows.map((r) => r.slice(0, 260)).join(' || ') : 'NOT IN THE LIST'));
  }
});
