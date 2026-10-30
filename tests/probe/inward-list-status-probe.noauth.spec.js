const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the Stock Inward (Metal) list's first page - Receipt
// No / Sub Txn Type / Purchase Type / Vendor / Status per row - plus the row
// actions offered for the inward INWARD (env, e.g. M778): tick its row and
// list the buttons that appear. Nothing is saved.
// Run: INWARD=M778 npx playwright test tests/probe/inward-list-status-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE inward list statuses', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(300_000);
  const inward = process.env.INWARD || 'M778';
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  await metalInward.open();
  await metalInward.waitForSpinner();
  await page.waitForTimeout(3_000);
  const rows = (await page.locator('table tbody tr').locator('visible=true').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim());
  for (const r of rows.slice(0, 25)) {
    const m = r.match(/^(\d+) (M\d+) \d+ (\S+) (\S+) (\S+) (\S+) (.+?) (\d+) [\d.]+ .* (\S+)$/);
    console.log(`ROW ${m ? `${m[2]} | ${m[3]} | ${m[4]} | ${m[5]} | ${m[6]} | ${m[7]} | pcs ${m[8]} | ${m[9]}` : r.slice(0, 160)}`);
  }
  const buttonsBefore = (await page.locator('button').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  console.log(`BUTTONS before tick: ${JSON.stringify(buttonsBefore)}`);
  const search = page.locator('xpath=//input[contains(translate(@placeholder, "SEARCH", "search"), "search") and not(ancestor::header) and not(ancestor::*[contains(@class, "topbar") or contains(@class, "navbar")])]').locator('visible=true').first();
  if (await search.count()) { await search.fill(inward); await page.waitForTimeout(4_000); }
  const row = page.getByRole('row').filter({ hasText: new RegExp(`\\b${inward}\\b`) }).first();
  if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const box = row.getByRole('checkbox').first();
    if (await box.count()) await box.check({ force: true }).catch(() => {});
    else await row.click().catch(() => {});
    await page.waitForTimeout(2_500);
    const buttonsAfter = (await page.locator('button').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`BUTTONS after tick of ${inward}: ${JSON.stringify(buttonsAfter)}`);
    const icons = await row.locator('button, a, i[class*="ri-"]').evaluateAll((els) => els.map((e) => `${e.tagName}:${e.className}:${e.getAttribute('title') || e.textContent.trim()}`));
    console.log(`ROW controls: ${JSON.stringify(icons.slice(0, 20))}`);
    await page.screenshot({ path: 'test-results/screens/probe-inward-row.png', fullPage: true });
    // open the row's view/edit if a click opens something
    await row.locator('td').nth(2).dblclick().catch(() => {});
    await page.waitForTimeout(3_000);
    const text = ((await page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    console.log(`OPENED after dblclick: ${text.slice(0, 600)}`);
  } else console.log(`row ${inward} not found on the list`);
});
