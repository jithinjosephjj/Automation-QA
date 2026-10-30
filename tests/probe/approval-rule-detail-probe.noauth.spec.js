const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the CONDITIONS of the "Anson Approval" Metal Inward
// approval rule and its work flow row (Intelligence Engine > Approvals), and
// the admin approval inbox's full text. Nothing is changed.
// Run: npx playwright test tests/probe/approval-rule-detail-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE approval rule detail', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(500_000);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });

  const dumpOpen = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const root = [...document.querySelectorAll('.offcanvas, .modal, ngb-modal-window')].filter(vis).pop() || document.body;
      const labelOf = (el) => {
        const wrap = el.closest('[controlname]');
        const col = el.closest('.col, [class*="col-"], .form-group, .mb-3') || el.parentElement;
        const lbl = col && col.querySelector('label');
        return `${(wrap && wrap.getAttribute('controlname')) || el.getAttribute('formcontrolname') || '-'} | ${lbl ? lbl.textContent.trim() : (el.placeholder || '-')}`;
      };
      return {
        rootClass: root.className.slice(0, 60),
        text: root.innerText.replace(/\s+/g, ' ').slice(0, 2500),
        selects: [...root.querySelectorAll('ng-select')].filter(vis).map((ng) => `${labelOf(ng)} = ${[...ng.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join(', ') || '(empty)'}`),
        inputs: [...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).map((i) => `${labelOf(i)} = "${i.value}"`),
        checks: [...root.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(vis).map((i) => `${labelOf(i)}=${i.checked}`),
        tables: [...root.querySelectorAll('table')].filter(vis).map((t) => [...t.querySelectorAll('tr')].slice(0, 8).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 200))),
        buttons: [...root.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
  };

  const openRow = async (route, rowText, label) => {
    await page.goto(route, { waitUntil: 'commit' }).catch(() => {});
    await metalInward.waitForSpinner().catch(() => {});
    await page.waitForTimeout(3_000);
    const row = page.locator('table tbody tr').filter({ hasText: rowText }).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    const controls = await row.locator('button, a, i').evaluateAll((els) => els.map((e) => `${e.tagName}.${e.className}|${e.getAttribute('title') || ''}`));
    console.log(`${label} row controls: ${JSON.stringify(controls.slice(0, 12))}`);
    // try: an edit/view icon in the row, else double-click the name cell
    const icon = row.locator('button, a, i[class*="ri-"], i[class*="mdi"]').filter({ hasNot: page.locator('input') }).first();
    if (await icon.count()) await icon.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    if (!(await page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').count())) {
      await row.locator('td').nth(1).dblclick().catch(() => {});
      await page.waitForTimeout(2_500);
    }
    if (!(await page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').count())) {
      await row.locator('td').nth(1).click().catch(() => {});
      await page.waitForTimeout(2_500);
    }
    // step through any wizard inside the dialog
    for (let i = 0; i < 4; i++) {
      await dumpOpen(`${label} step ${i + 1}`);
      await page.screenshot({ path: `test-results/screens/probe-${label.replace(/\W+/g, '-')}-${i + 1}.png`, fullPage: true }).catch(() => {});
      const next = page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').last().getByRole('button', { name: /^Next$/ }).locator('visible=true').last();
      if (!(await next.isVisible({ timeout: 1_000 }).catch(() => false))) break;
      await next.click().catch(() => {});
      await page.waitForTimeout(2_000);
    }
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 2_000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  };

  await openRow('/ite/Approval-RuleMaster', /Anson Approval/, 'rule Anson Approval');
  await openRow('/ite/Approval-Work-Flow', /Metal Inward/, 'workflow Metal Inward');

  await page.goto('/adm/app-approval', { waitUntil: 'commit' }).catch(() => {});
  await metalInward.waitForSpinner().catch(() => {});
  await page.waitForTimeout(5_000);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log(`INBOX text: ${body.slice(0, 2500)}`);
  const items = await page.locator('main li, main .card, main .list-group-item, main tr, [class*="mail"] li, [class*="inbox"] li').locator('visible=true').allInnerTexts().catch(() => []);
  console.log(`INBOX items (${items.length}): ${JSON.stringify(items.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 150)).slice(0, 15))}`);
  await page.screenshot({ path: 'test-results/screens/probe-inbox.png', fullPage: true });
});
