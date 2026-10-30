const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): where does a "Created" Metal Inward get APPROVED (new
// Status column, 30-10-2026)? Lists every sidebar link mentioning approval /
// inward, inspects the INWARD row's cells and controls on the inward list
// (hover the row, open its Status cell), then visits each approval-ish link
// and reports its tabs / headers / whether INWARD is listed. Nothing is saved.
// Run: INWARD=M778 npx playwright test tests/probe/inward-approval-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE inward approval', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(500_000);
  const inward = process.env.INWARD || 'M778';
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });

  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }))
    .filter((l) => l.href && l.href.startsWith('/') && l.text));
  const interesting = links.filter((l) => /approv|inward|pending|verify|authori/i.test(l.text + ' ' + l.href));
  console.log(`LINKS approval/inward (${interesting.length}): ${JSON.stringify(interesting)}`);

  // the inward list row
  await metalInward.open();
  await metalInward.waitForSpinner();
  await page.waitForTimeout(3_000);
  const row = page.locator('table tbody tr').locator('visible=true').filter({ hasText: new RegExp(`\\b${inward}\\b`) }).first();
  if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const html = await row.evaluate((tr) => tr.outerHTML.replace(/\s+/g, ' ').slice(0, 3000));
    console.log(`ROW HTML: ${html}`);
    await row.hover().catch(() => {});
    await page.waitForTimeout(1_000);
    const ctrls = await row.locator('button, a, i, select, ng-select, [class*="badge"], [class*="status"]').evaluateAll((els) => els.map((e) => `${e.tagName}.${e.className}|${e.getAttribute('title') || ''}|${e.textContent.trim().slice(0, 30)}`));
    console.log(`ROW controls after hover: ${JSON.stringify(ctrls.slice(0, 30))}`);
    const cells = row.locator('td');
    const n = await cells.count();
    const status = cells.nth(n - 1);
    await status.click().catch(() => {});
    await page.waitForTimeout(2_000);
    let opened = ((await page.locator('.offcanvas, .modal, ngb-modal-window, .dropdown-menu.show, .ng-dropdown-panel, .p-overlaypanel').locator('visible=true').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    console.log(`after Status cell click: ${opened.slice(0, 500) || '(nothing opened)'}`);
    const buttons = (await page.locator('button').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`BUTTONS now: ${JSON.stringify(buttons)}`);
    await page.keyboard.press('Escape').catch(() => {});
    // tick the row (first cell) and look for toolbar actions
    const box = row.getByRole('checkbox').first();
    if (await box.count()) { await box.check({ force: true }).catch(() => {}); await page.waitForTimeout(2_000); }
    const buttons2 = (await page.locator('button, a.btn').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const titled = await page.locator('button[title], a[title], i[title]').locator('visible=true').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
    console.log(`BUTTONS after tick: ${JSON.stringify(buttons2)}; titled: ${JSON.stringify(titled.slice(0, 30))}`);
    await page.screenshot({ path: 'test-results/screens/probe-inward-approval-row.png', fullPage: true });
    // a double click / the receipt-no cell may open the record
    await cells.nth(2).dblclick().catch(() => {});
    await page.waitForTimeout(3_000);
    opened = ((await page.locator('.offcanvas, .modal, ngb-modal-window').locator('visible=true').last().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const buttons3 = (await page.locator('button').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`after dblclick: ${opened.slice(0, 500) || '(nothing opened)'}; buttons ${JSON.stringify(buttons3)}`);
    await page.screenshot({ path: 'test-results/screens/probe-inward-approval-open.png', fullPage: true });
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 2_000 }).catch(() => {});
  } else console.log(`row ${inward} not on page 1 of the inward list`);

  // visit the approval-ish links
  const seen = new Set();
  for (const l of interesting) {
    if (seen.has(l.href) || /stock-inward-setup/.test(l.href)) continue;
    seen.add(l.href);
    await page.goto(l.href, { waitUntil: 'commit' }).catch(() => {});
    await metalInward.waitForSpinner().catch(() => {});
    await page.waitForTimeout(5_000);
    const info = await page.evaluate((inw) => {
      const vis = (n) => !!n.offsetParent;
      return {
        url: location.pathname,
        tabs: [...document.querySelectorAll('[role=tab], .nav-link')].filter(vis).map((t) => t.textContent.trim()).filter(Boolean).slice(0, 15),
        headings: [...document.querySelectorAll('h4, h5')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).slice(0, 10),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25),
        selects: [...document.querySelectorAll('sioniq-ng-select[controlname]')].filter(vis).map((n) => n.getAttribute('controlname')),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20),
        hasInward: document.body.innerText.includes(inw),
        rows: [...document.querySelectorAll('table tbody tr')].filter(vis).slice(0, 5).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)),
      };
    }, inward);
    console.log(`PAGE ${l.text}: ${JSON.stringify(info)}`);
  }
});
