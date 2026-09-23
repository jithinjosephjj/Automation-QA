const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): who is a "line employee"? Lists the Employee Counter
// Mapping grid (Inventory > Setup > Counter) and the Counter list with
// their types, so the approval / invoice chain can log in as an employee
// whose counter actually holds the allocated stock.
test('PROBE employee counter mapping', async ({ loginPage, counterPage, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const dump = async (label, max = 60) => {
    const per = page.locator('select').filter({ has: page.locator('option[value="50"]') }).locator('visible=true').first();
    if (await per.count()) { await per.selectOption('50').catch(() => {}); await counterPage.settle(2_000); }
    const headers = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
    const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 160));
    console.log(`${label} headers: ${JSON.stringify(headers)}`);
    console.log(`${label} rows (${rows.length}): ${JSON.stringify(rows.slice(0, max))}`);
  };
  await counterPage.open();
  await counterPage.selectAssignmentTab();
  await dump('EMPLOYEE COUNTER MAPPING');
  await counterPage.selectTab();
  await dump('COUNTERS');
});
