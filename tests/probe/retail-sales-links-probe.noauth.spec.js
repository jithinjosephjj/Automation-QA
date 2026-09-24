const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): every sidebar link outside the known modules, grouped
// by route prefix - looking for a retail / POS sales screen that sells
// Brand stock (the B2B "Metal Invoice" rejects brand tags).
test('PROBE retail sales links', async ({ loginPage, page }) => {
  test.setTimeout(120_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })).filter((l) => l.href && l.href.startsWith('/') && l.text));
  const byPrefix = {};
  for (const l of links) { const p = l.href.split('/')[1]; (byPrefix[p] = byPrefix[p] || []).push(`${l.text} ${l.href}`); }
  for (const [p, list] of Object.entries(byPrefix)) if (!['adm', 'ite', 'prd', 'inv', 'prc', 'dsb', 'app-reports-home', 'invoice-dashboard'].includes(p)) console.log(`PREFIX /${p}: ${JSON.stringify(list)}`);
});
