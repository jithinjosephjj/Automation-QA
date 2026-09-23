const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the Add forms of Approval Issue
// (/sls/view-b2b-approval-issue) and Approval Receipt
// (/sls/view-approval-receipt) - captions, controlnames, inputs, buttons,
// grid headers, and the options every header select offers (nothing is
// saved; every panel is closed with Escape).
test('PROBE approval issue / receipt add forms', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(400_000);
  await loginPage.ensureLoggedIn();

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => {
        const box = n.closest('.form-group, .col, [class*="col-"], .mb-2, .mb-3, div');
        const lab = box && (box.querySelector('label') || box.previousElementSibling);
        return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40);
      };
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select'))
        .map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${captionOf(n)}]${(n.matches('ng-select') ? n : n.querySelector('ng-select'))?.classList.contains('ng-invalid') ? ' *' : ''}`);
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar'))
        .map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}`);
      const radios = [...document.querySelectorAll('input[type=radio], input[type=checkbox]')].filter(vis).map((r) => `${r.type}:${(r.closest('label') || r.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${r.checked}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 40);
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const headings = [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60);
      const texts = [...document.querySelectorAll('.card-body span, .card-body p, .card-body div')].filter(vis).map((n) => n.childNodes.length === 1 && n.firstChild.nodeType === 3 ? n.textContent.trim() : '').filter((t) => t && t.length > 2 && t.length < 40);
      return { url: location.pathname, headings, selects, inputs, radios: radios.slice(0, 20), buttons, headers, captions: [...new Set(texts)].slice(0, 60) };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };

  const listOptions = async () => {
    const hosts = page.locator('sioniq-ng-select, ng-select:not(sioniq-ng-select ng-select)').locator('visible=true');
    const n = await hosts.count();
    for (let i = 0; i < n; i++) {
      const host = hosts.nth(i);
      const ctl = (await host.getAttribute('controlname').catch(() => '')) || (await host.getAttribute('formcontrolname').catch(() => '')) || `#${i}`;
      if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await host.locator('.ng-select-container').first().click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
      const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
      console.log(`  select ${ctl}: ${JSON.stringify(opts.slice(0, 15))}${opts.length > 15 ? ` (+${opts.length - 15})` : ''}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  };

  for (const [name, route] of [['Approval Issue', '/sls/view-b2b-approval-issue'], ['Approval Receipt', '/sls/view-approval-receipt']]) {
    await logisticsSales.goto(route);
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(1_500);
    await logisticsSales.clickVisibleAdd();
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(2_000);
    await describe(`ADD FORM ${name}`);
    await listOptions();
    await page.screenshot({ path: `test-results/screens/probe-${name.replace(/\s+/g, '-').toLowerCase()}-add.png`, fullPage: true }).catch(() => {});
  }
});
