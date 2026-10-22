// Read-only: dumps the app's sidebar menu (every link text + route) at the
// given login, to find screens we have no page object for yet.
// Run: BU=Cochin npx playwright test tests/diag/menu-routes.diag.js (rename to *.noauth.spec.js to run) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');

test('menu routes', async ({ loginPage, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  await page.waitForTimeout(3_000);
  // expand every collapsed sidebar group so nested links render
  for (let round = 0; round < 6; round++) {
    const toggles = page.locator('#sidebar-menu a[href="javascript: void(0)"], .navbar-nav a[href="javascript: void(0)"], aside a[href="javascript: void(0)"], a[href="javascript: void(0)"]').locator('visible=true');
    const n = await toggles.count();
    let clicked = 0;
    for (let i = 0; i < n; i++) {
      const a = toggles.nth(i);
      const expanded = await a.getAttribute('aria-expanded').catch(() => null);
      const cls = (await a.getAttribute('class').catch(() => '')) || '';
      if (expanded === 'true' || /active|open|show/.test(cls)) continue;
      await a.click({ timeout: 2_000 }).catch(() => {});
      clicked++;
      await page.waitForTimeout(150);
    }
    if (!clicked) break;
  }
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="/"]')]
    .map((a) => `${a.getAttribute('href')} | ${a.textContent.replace(/\s+/g, ' ').trim()}`)
    .filter((s, i, arr) => arr.indexOf(s) === i));
  const wanted = process.env.FILTER ? new RegExp(process.env.FILTER, 'i') : null;
  console.log(`--- ${links.length} routes${wanted ? ` (filter ${wanted})` : ''}`);
  for (const l of links) if (!wanted || wanted.test(l)) console.log(l);
});
