const { test } = require('../../fixtures/test-fixtures');
const { StockInwardBasePage } = require('../../pages/StockInwardBasePage');

// PROBE: Layaway / EMA Plans > Operations > Enrollment & Collections
// (/ema/app-enrollment-collection-setup) at Kakkanad - the EMA Enrollment
// form (controlnames / ids / buttons after each pick, the Make Payment
// dialog) and the EMA Collection tab. Nothing is saved unless SAVE=1. Run:
//   npx playwright test tests/probe/ema-enrollment-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE EMA enrollment + collection tabs', async ({ loginPage, page }) => {
  test.setTimeout(500_000);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = new StockInwardBasePage(page, 'EMA');

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return {
        url: location.pathname,
        dialog: !!root,
        text: (root ? root.innerText : document.body.innerText).replace(/\s+/g, ' ').slice(0, 2500),
        tabs: [...document.querySelectorAll('[role=tab], .nav-link, a.nav-item')].filter(vis).map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        checkboxes: [...scope.querySelectorAll('input[type=checkbox]')].map((c) => `${c.id || c.getAttribute('formcontrolname') || '-'}=${c.checked}${vis(c) ? '' : '(hidden)'}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        tables: [...scope.querySelectorAll('table')].filter(vis).map((t) => ({ head: [...t.querySelectorAll('th')].map((h) => h.textContent.trim()).join('|'), rows: [...t.querySelectorAll('tbody tr')].slice(0, 5).map((r) => r.innerText.replace(/\s+/g, ' ').trim()) })),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  const openSel = async (name) => {
    await pg.closeStalePanels();
    await pg.select(name).locator('.ng-select-container').click({ timeout: 10_000 });
    await pg.settle(1_500);
    const o = await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => []);
    console.log(`${name} options: ${JSON.stringify(o.slice(0, 20))}`);
    await page.keyboard.press('Escape');
    await pg.settle(500);
    return o;
  };

  const saves = [];
  page.on('response', async (r) => {
    if (['POST', 'PUT'].includes(r.request().method()) && !/KeepAlive|Translation|GetMasterData/i.test(r.url())) {
      saves.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-3).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 400)}`);
    }
  });

  await pg.goto('/ema/app-enrollment-collection-setup');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  await dump('PAGE OPEN');
  await page.screenshot({ path: 'test-results/screens/probe-ema-list.png', fullPage: true }).catch(() => {});

  // Collection tab first (list only)
  const collTab = page.getByRole('tab', { name: /EMA Collection/i }).or(page.locator('a, li, button, div').filter({ hasText: /^\s*EMA Collection\s*$/ })).locator('visible=true').first();
  if (await collTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await collTab.click({ timeout: 60_000 });
    await pg.waitForSpinner();
    await pg.settle(3_000);
    await dump('COLLECTION TAB (list)');
    await page.screenshot({ path: 'test-results/screens/probe-ema-collection-list.png', fullPage: true }).catch(() => {});
    const add = page.locator('button:has(i.ri-add-fill)').locator('visible=true').first();
    if (await add.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await add.click({ timeout: 60_000 });
      await pg.settle(3_000);
      await dump('COLLECTION ADD FORM');
      await page.screenshot({ path: 'test-results/screens/probe-ema-collection-form.png', fullPage: true }).catch(() => {});
      const info = await dump('COLLECTION ADD FORM selects');
      for (const s of info.selects.slice(0, 4)) {
        const n = s.split('[')[0];
        if (n && n !== '-') await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));
      }
      // back to the list
      const back = page.locator('button:has(i[class*="arrow-left"]), button[title*="Back" i], .btn-back').locator('visible=true').first();
      if (await back.isVisible({ timeout: 2_000 }).catch(() => false)) await back.click().catch(() => {});
    }
  } else {
    console.log('no EMA Collection tab found');
  }

  // Enrollment tab
  await pg.goto('/ema/app-enrollment-collection-setup');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  const enrTab = page.getByRole('tab', { name: /EMA Enrollment/i }).or(page.locator('a, li, button, div').filter({ hasText: /^\s*EMA Enrollment\s*$/ })).locator('visible=true').first();
  if (await enrTab.isVisible({ timeout: 5_000 }).catch(() => false)) { await enrTab.click({ timeout: 60_000 }); await pg.waitForSpinner(); await pg.settle(2_000); }
  await dump('ENROLLMENT TAB (list)');
  const add = page.locator('button:has(i.ri-add-fill)').locator('visible=true').first();
  await add.click({ timeout: 60_000 });
  await pg.settle(3_000);
  await dump('ENROLLMENT FORM OPEN');
  await page.screenshot({ path: 'test-results/screens/probe-ema-enrollment-form.png', fullPage: true }).catch(() => {});

  // Mobile number
  const mobile = page.locator('input[type="tel"], input[formcontrolname*="mobile" i], [controlname*="mobile" i] input:not([role=combobox]), input[id*="mobile" i]:not([role=combobox]), input[placeholder*="mobile" i]').locator('visible=true').first();
  if (await mobile.count()) {
    console.log(`mobile input: id="${await mobile.getAttribute('id')}" name="${await mobile.getAttribute('formcontrolname')}" placeholder="${await mobile.getAttribute('placeholder')}"`);
    await mobile.fill(process.env.MOBILE || '1234567890');
    await mobile.blur();
    await pg.settle(2_500);
    await dump('AFTER MOBILE');
  } else console.log('no mobile input found');

  const info = await dump('selects now');
  const names = info.selects.map((s) => s.split('[')[0]);
  console.log('select controlnames: ' + JSON.stringify(names));
  for (const n of names) if (n && n !== '-') await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`));

  const tryPick = async (patterns, value, opts = {}) => {
    const n = names.find((x) => patterns.some((p) => p.test(x)));
    if (!n) { console.log(`no select for ${patterns.map(String).join(',')}`); return; }
    await pg.pick(n, value, opts).catch((e) => console.log(`pick ${n} "${value}" failed: ${e.message.split('\n')[0]}`));
    await pg.settle(2_000);
    await dump(`AFTER ${n} = ${value}`);
  };
  await tryPick([/customer|member/i], process.env.CUSTOMER || 'Anu aa11', { search: true });
  await tryPick([/planType|plan_type/i], 'Weight-Based Plan');
  await tryPick([/^(?!.*type).*plan/i, /emaPlan|planID/i], '2LAKH PLAN');
  await tryPick([/group/i], '100000');
  await tryPick([/salesman|sales/i], 'Chandu');
  await page.screenshot({ path: 'test-results/screens/probe-ema-enrollment-filled.png', fullPage: true }).catch(() => {});

  // Make Payment
  const mp = page.getByRole('button', { name: /Make Payment/i }).locator('visible=true').last();
  if (await mp.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await mp.click({ timeout: 15_000 });
    await pg.waitForIdle();
    await pg.settle(3_000);
    await dump('AFTER MAKE PAYMENT');
    await page.screenshot({ path: 'test-results/screens/probe-ema-payment.png', fullPage: true }).catch(() => {});
    if (process.env.PAY === '1') {
      const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
      const paid = await pg.addPaymentEntry(dlg, { mode: 'Cash', what: 'probe' }).catch((e) => { console.log('addPaymentEntry failed: ' + e.message.split('\n')[0]); return ''; });
      console.log('paid ' + paid);
      await dump('AFTER PAYMENT ENTRY');
      const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click().catch(() => {});
      await pg.settle(2_000);
      await dump('AFTER PAYMENT DIALOG CLOSED');
    } else {
      const close = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').locator('visible=true').last().getByRole('button', { name: /^Close$|Cancel/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click().catch(() => {});
    }
  } else console.log('no Make Payment button');

  if (process.env.SAVE === '1') {
    await page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: 15_000 });
    await page.waitForTimeout(10_000);
    await dump('AFTER SUBMIT');
    await page.screenshot({ path: 'test-results/screens/probe-ema-after-submit.png', fullPage: true }).catch(() => {});
  }
  console.log('responses ' + JSON.stringify(saves, null, 1));
  console.log('alerts ' + JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
