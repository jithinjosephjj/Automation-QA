const { test } = require('../../fixtures/test-fixtures');
const { LogisticsSalesWorkflowPage } = require('../../pages/LogisticsSalesWorkflowPage');

// PROBE (read-only): Retail Operation > Operations > Invoice, Invoice Source
// "Direct" at Kakkanad - the route, the Add form's selects / inputs / buttons
// and the options every header select offers. Nothing is saved.
// Run: npx playwright test tests/probe/retail-invoice-direct-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE retail invoice (Direct) form', async ({ loginPage, page }) => {
  test.setTimeout(400_000);
  const pg = new LogisticsSalesWorkflowPage(page);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });

  // 1. sidebar links that look like the retail invoice
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }))
    .filter((l) => l.href && l.href.startsWith('/') && l.text));
  const pos = links.filter((l) => /^\/pos\//.test(l.href) || /invoice/i.test(l.text) || /invoice/i.test(l.href));
  console.log(`LINKS pos/invoice (${pos.length}): ${JSON.stringify(pos)}`);
  const route = process.env.ROUTE || (pos.find((l) => /^\/pos\//.test(l.href) && /invoice/i.test(l.text + l.href)) || {}).href;
  console.log(`ROUTE chosen: ${route}`);
  if (!route) throw new Error('no /pos/ invoice link found in the sidebar');

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => {
        const box = n.closest('.form-group, .col, [class*="col-"], .mb-2, .mb-3, div');
        const lab = box && (box.querySelector('label') || box.previousElementSibling);
        return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40);
      };
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select'))
        .map((n) => {
          const ng = n.matches('ng-select') ? n : n.querySelector('ng-select');
          const val = ng && ng.querySelector('.ng-value') ? ng.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : '';
          return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${captionOf(n)}]=${val}${ng && ng.classList.contains('ng-invalid') ? ' *' : ''}${ng && ng.classList.contains('ng-select-disabled') ? ' (dis)' : ''}`;
        });
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar'))
        .map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? ' *' : ''}`);
      const radios = [...document.querySelectorAll('input[type=radio], input[type=checkbox]')].filter(vis).map((r) => `${r.type}:${(r.closest('label') || r.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${r.checked}`);
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 40);
      const tabs = [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim());
      const headers = [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
      const headings = [...document.querySelectorAll('h4, h5, h6, .card-title')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60);
      const texts = [...document.querySelectorAll('.card-body span, .card-body p, .card-body div, label')].filter(vis).map((n) => n.childNodes.length === 1 && n.firstChild.nodeType === 3 ? n.textContent.trim() : '').filter((t) => t && t.length > 2 && t.length < 40);
      return { url: location.pathname, tabs, headings, selects, inputs, radios: radios.slice(0, 20), buttons, headers, captions: [...new Set(texts)].slice(0, 80) };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };

  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select, ng-select[formcontrolname="${ctl}"]`).locator('visible=true').first();
    if (!(await host.count())) { console.log(`  ${ctl}: (absent)`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`  options ${ctl}: ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    return opts;
  };
  const emptySelects = async () => page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')]
    .filter((n) => n.offsetParent && !n.querySelector('.ng-value'))
    .map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname')));

  await pg.goto(route);
  await pg.waitForIdle();
  await pg.waitForSpinner();
  await page.waitForTimeout(4_000);
  await describe('LIST');
  await page.screenshot({ path: 'test-results/screens/probe-retail-invoice-list.png' });

  // Add
  for (let i = 0; i < 3; i++) {
    await pg.waitForSpinner().catch(() => {});
    const add = page.locator('button:has(i.ri-add-fill)').locator('visible=true').first();
    console.log(`add button present: ${await add.count()}`);
    await add.click({ timeout: 60_000 }).catch((e) => console.log(`add click: ${String(e).split('\n')[0]}`));
    await page.waitForTimeout(5_000);
    const n = (await emptySelects()).length;
    if (n > 0) break;
    const alerts = (await page.getByRole('alert').allTextContents().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    console.log(`add form not open after click ${i + 1}; alerts ${JSON.stringify(alerts)}`);
  }
  await describe('ADD FORM');
  await page.screenshot({ path: 'test-results/screens/probe-retail-invoice-add.png', fullPage: true });

  for (const ctl of await emptySelects()) await options(ctl);

  // Invoice Source = Direct
  const srcCtl = (await emptySelects()).find((c) => /source/i.test(c)) || process.env.SOURCE_CTL;
  console.log(`invoice source control: ${srcCtl}`);
  if (srcCtl) {
    await pg.pick(srcCtl, 'Direct', { exact: true }).catch((e) => console.log(`pick Direct failed: ${String(e).slice(0, 200)}`));
    await pg.waitForIdle();
    await page.waitForTimeout(3_000);
    await describe('AFTER Invoice Source = Direct');
    for (const ctl of await emptySelects()) await options(ctl);
    await page.screenshot({ path: 'test-results/screens/probe-retail-invoice-direct.png', fullPage: true });
  }

  // customer / staff picks to reveal the rest
  const cust = (await emptySelects()).find((c) => /customer/i.test(c));
  if (cust) {
    await pg.pick(cust, process.env.CUSTOMER || 'RAJA', { search: true }).catch((e) => console.log(`pick customer failed: ${String(e).slice(0, 200)}`));
    await page.waitForTimeout(3_000);
    await describe('AFTER customer');
    for (const ctl of await emptySelects()) await options(ctl);
  }
  if (process.env.TAG) {
    const scan = pg.inputByCaption('Tag Number');
    console.log(`Tag Number input: ${await scan.count()}`);
    const alt = page.locator('input[formcontrolname="scanInput"], input#scanInput, input[placeholder*="Scan" i], input[placeholder*="Tag" i]').locator('visible=true');
    console.log(`scan-like inputs: ${await alt.count()} ${JSON.stringify(await alt.evaluateAll((els) => els.map((e) => `${e.getAttribute('formcontrolname') || e.id}|${e.placeholder}`)))}`);
    const target = (await scan.count()) ? scan : alt.first();
    await target.fill(process.env.TAG);
    await target.press('Enter');
    await page.waitForTimeout(5_000);
    await describe('AFTER scan');
    const toasts = await page.locator('.toast, .toast-message, [role="alert"], .swal2-container').allTextContents().catch(() => []);
    console.log(`toasts after scan: ${JSON.stringify(toasts)}`);
    const rows = await page.locator('table tbody tr').locator('visible=true').allInnerTexts().catch(() => []);
    console.log(`rows after scan: ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' ').trim()).slice(0, 8))}`);
    await page.screenshot({ path: 'test-results/screens/probe-retail-invoice-scanned.png', fullPage: true });
  }
});
