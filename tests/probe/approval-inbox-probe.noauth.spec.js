const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): where are pending approvals (the new Metal Inward
// approval rule, 30-10-2026) acted on? Visits /adm/app-approval, the
// Intelligence Engine "Approvals" tab, the topbar inbox / bell icons, and
// the "Anson Approval" rule's record; reports every page's tabs, headers,
// rows, buttons and whether INWARD is listed. Nothing is approved.
// Run: INWARD=M778 npx playwright test tests/probe/approval-inbox-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE approval inbox', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(500_000);
  const inward = process.env.INWARD || 'M778';
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });

  const dump = async (label) => {
    await metalInward.waitForSpinner().catch(() => {});
    await page.waitForTimeout(4_000);
    const info = await page.evaluate((inw) => {
      const vis = (n) => !!n.offsetParent;
      return {
        url: location.pathname,
        tabs: [...document.querySelectorAll('[role=tab], .nav-link, .nav-item a')].filter(vis).map((t) => `${t.textContent.replace(/\s+/g, ' ').trim()}${t.getAttribute('href') ? ` -> ${t.getAttribute('href')}` : ''}`).filter(Boolean).slice(0, 30),
        headings: [...document.querySelectorAll('h4, h5, h6')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean).slice(0, 25),
        selects: [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter(vis).map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname')}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.trim() : ''}`),
        buttons: [...document.querySelectorAll('button, a.btn')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim() || b.getAttribute('title') || b.className.slice(0, 30)).filter(Boolean).slice(0, 30),
        hasInward: document.body.innerText.includes(inw),
        rows: [...document.querySelectorAll('table tbody tr')].filter(vis).slice(0, 6).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)),
        cards: [...document.querySelectorAll('.card, .list-group-item')].filter(vis).slice(0, 6).map((c) => c.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)),
      };
    }, inward);
    console.log(`=== ${label}: ${JSON.stringify(info)}`);
    return info;
  };

  // 1. Admin > Approval
  await page.goto('/adm/app-approval', { waitUntil: 'commit' }).catch(() => {});
  const adm = await dump('ADM /adm/app-approval');
  await page.screenshot({ path: 'test-results/screens/probe-adm-approval.png', fullPage: true });
  if (adm.hasInward) {
    const row = page.locator('table tbody tr, .card, .list-group-item').locator('visible=true').filter({ hasText: inward }).first();
    console.log(`ROW ${inward}: ${((await row.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 300)}`);
    console.log(`ROW HTML: ${(await row.evaluate((e) => e.outerHTML).catch(() => '')).replace(/\s+/g, ' ').slice(0, 2500)}`);
  }

  // 2. Intelligence Engine "Approvals" tab (sub-tab of the /ite pages)
  await page.goto('/ite/Approval-Category', { waitUntil: 'commit' }).catch(() => {});
  await metalInward.waitForSpinner().catch(() => {});
  await page.waitForTimeout(3_000);
  const approvalsTab = page.locator('a, [role=tab], .nav-link, li').filter({ hasText: /^\s*Approvals\s*$/ }).locator('visible=true').first();
  const href = await approvalsTab.getAttribute('href').catch(() => null);
  console.log(`ITE Approvals tab href: ${href}`);
  await approvalsTab.click({ timeout: 10_000 }).catch((e) => console.log(`Approvals tab click failed: ${String(e).split('\n')[0]}`));
  await dump('ITE Approvals tab');
  // the rule's record: "Anson Approval"
  await page.goto('/ite/Approval-RuleMaster', { waitUntil: 'commit' }).catch(() => {});
  await metalInward.waitForSpinner().catch(() => {});
  await page.waitForTimeout(3_000);
  const rule = page.locator('table tbody tr').filter({ hasText: /Anson Approval/ }).first();
  if (await rule.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await rule.locator('td').nth(1).dblclick().catch(() => {});
    await page.waitForTimeout(3_000);
    const edit = rule.locator('button, a, i').first();
    if (!(await page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').count())) { await edit.click({ timeout: 3_000 }).catch(() => {}); await page.waitForTimeout(3_000); }
    const txt = ((await page.locator('.offcanvas, .modal, ngb-modal-window, form').locator('visible=true').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    console.log(`RULE Anson Approval opened: ${txt.slice(0, 1500)}`);
    await page.screenshot({ path: 'test-results/screens/probe-approval-rule.png', fullPage: true });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 2_000 }).catch(() => {});
  }

  // 3. topbar icons (inbox / bell)
  const icons = page.locator('header button, header a, .topbar button, .topbar a, app-topbar button, app-topbar a').locator('visible=true');
  const n = await icons.count();
  const names = await icons.evaluateAll((els) => els.map((e) => `${e.tagName}:${e.className.slice(0, 40)}:${e.getAttribute('title') || e.getAttribute('aria-label') || ''}:${(e.querySelector('i') || {}).className || ''}`));
  console.log(`TOPBAR controls (${n}): ${JSON.stringify(names.slice(0, 25))}`);
  for (let i = 0; i < n; i++) {
    const cls = names[i] || '';
    if (!/mail|bell|notif|inbox|approv|message|envelope/i.test(cls)) continue;
    await icons.nth(i).click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    const open = ((await page.locator('.dropdown-menu.show, .offcanvas.show, .modal.show, .p-overlaypanel, [class*="notification"]').locator('visible=true').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    console.log(`TOPBAR ${cls} -> url ${new URL(page.url()).pathname}; opened: ${open.slice(0, 800) || '(nothing)'}`);
    if (!/\/(adm|ite)\//.test(page.url())) await dump(`after topbar ${cls}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
});
