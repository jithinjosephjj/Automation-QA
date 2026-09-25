const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing): Procurement > Operations > Internal
 * Transfer (prc/internal-stock-list) on the suite's environment. QA lead,
 * 25-09-2026: qa has no "Process" option - the metal-inward transfer is
 * Department -> Locker (Asmi), then Locker -> Locker (Asmi -> Bhavani), with
 * Stock Entity Type Material, each accepted on the Accept tab.
 *
 * Walks the header cascade with the wanted values (env ISSUE_FROM / ISSUE_TO /
 * FROM_EMP / TO_EMP override), dumps everything that renders after it (selects,
 * inputs, grid, buttons), clicks Next when offered to see Review & Submit, and
 * dumps the Accept tab. Never presses Submit / Accept.
 */
const WANT = {
  'Transaction Sub Type': /./,
  'Issue From': new RegExp(`^${process.env.ISSUE_FROM || 'Department'}$`),
  'Issue To': new RegExp(`^${process.env.ISSUE_TO || 'Locker'}$`),
  'From Employee': new RegExp(`^${process.env.FROM_EMP || 'Asmi'}$`),
  'To Employee': new RegExp(`^${process.env.TO_EMP || 'Asmi'}$`),
  'Stock Entity Type': /^Material$/,
  'Transaction Type': /^Metal Inward$/,
};

async function dumpForm(page, label) {
  const info = await page.evaluate(() => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside');
    const labelOf = (n) => {
      const wrap = n.closest('sioniq-ng-select, app-sioniq-input, .form-group') || n;
      return (wrap.parentElement?.querySelector('label')?.textContent || wrap.closest('div')?.parentElement?.querySelector('label')?.textContent || n.placeholder || n.id || '').trim().slice(0, 40);
    };
    return {
      headings: [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60),
      selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${labelOf(n)} [${(n.closest('sioniq-ng-select') || n).getAttribute('controlname') || ''}]=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.classList.contains('ng-invalid') ? '(invalid)' : ''}`),
      inputs: [...document.querySelectorAll('input:not([role=combobox])')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) => `${labelOf(i)} (${i.type})=${i.type === 'checkbox' ? i.checked : i.value}${i.disabled || i.readOnly ? '(ro)' : ''}`).slice(0, 40),
      headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean),
      rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 220)).slice(0, 10),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30),
    };
  });
  console.log(`${label}: ${JSON.stringify(info, null, 1)}`);
  return info;
}

async function walkCascade(page, production) {
  const seen = new Set();
  for (let round = 0; round < 16; round++) {
    const selects = await page.evaluate(() => [...document.querySelectorAll('ng-select')].filter((n) => n.offsetParent && !n.closest('header, .topbar, nav'))
      .map((n, i) => {
        const wrap = n.closest('sioniq-ng-select') || n;
        const label = (wrap.parentElement?.querySelector('label')?.textContent || wrap.closest('div')?.parentElement?.querySelector('label')?.textContent || '').trim();
        return { i, label, control: wrap.getAttribute('controlname') || '', value: (n.querySelector('.ng-value-label')?.textContent || '').trim() };
      }));
    const next = selects.find((s) => !seen.has(s.control || s.label || s.i));
    if (!next) break;
    seen.add(next.control || next.label || next.i);
    const host = page.locator('ng-select').locator('visible=true').nth(next.i);
    await production.closeStalePanels();
    await host.locator('.ng-select-container').click().catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).filter(Boolean);
    console.log(`"${next.label}" [${next.control}] value="${next.value}" options=${JSON.stringify(opts.slice(0, 25))}`);
    const want = WANT[next.label];
    const target = want ? opts.find((o) => want.test(o)) : null;
    const choice = next.value ? null : (target || opts.find((o) => !/No items found/i.test(o)));
    if (choice) {
      await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: new RegExp(`^\\s*${choice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click().catch(() => {});
      console.log(`   -> picked "${choice}"${want && !target ? ` (wanted ${want} - NOT offered)` : ''}`);
      await production.waitForIdle();
      await production.settle(2_000);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
}

test('probe internal stock transfer: transfer form', async ({ loginPage, production, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn();
  await production.openRoute('/prc/internal-stock-list');
  await page.getByRole('tab', { name: 'Transfer', exact: true }).click().catch(() => {});
  await production.settle(1_500);
  await dumpForm(page, 'transfer list');
  await production.clickAdd();
  await production.settle(2_500);
  await walkCascade(page, production);
  await dumpForm(page, 'transfer form after cascade');
  await page.screenshot({ path: 'test-results/probe-ist-transfer.png', fullPage: true });
});

test('probe internal stock transfer: accept tab', async ({ loginPage, production, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn();
  await production.openRoute('/prc/internal-stock-list');
  await page.getByRole('tab', { name: 'Accept', exact: true }).click().catch(() => {});
  await production.waitForIdle();
  await production.settle(2_500);
  await dumpForm(page, 'accept list');
  const add = await page.locator('button:has(i.ri-add-fill)').locator('visible=true').count();
  console.log(`accept tab: add buttons visible = ${add}`);
  if (add) {
    await production.clickAdd();
    await production.settle(2_500);
    await walkCascade(page, production);
    await dumpForm(page, 'accept form after cascade');
  }
  await page.screenshot({ path: 'test-results/probe-ist-accept.png', fullPage: true });
});
