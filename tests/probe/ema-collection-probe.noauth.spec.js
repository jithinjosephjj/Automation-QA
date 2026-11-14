const { test } = require('../../fixtures/test-fixtures');
const { StockInwardBasePage } = require('../../pages/StockInwardBasePage');

// PROBE: the EMA / ADP Collection tab of /ema/app-enrollment-collection-setup
// at Kakkanad - the Add form, what typing a Member Number fetches, the Make
// Payment dialog. Nothing is saved unless SAVE=1. Run:
//   MEMBER=WB002KKD npx playwright test tests/probe/ema-collection-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE EMA collection tab', async ({ loginPage, page }) => {
  test.setTimeout(500_000);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = new StockInwardBasePage(page, 'EMA');
  const member = process.env.MEMBER || 'WB002KKD';

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return {
        dialog: !!root,
        text: (root ? root.innerText : document.body.innerText).replace(/\s+/g, ' ').slice(0, 2500),
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.id || '-'}|${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
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
    if (['POST', 'PUT'].includes(r.request().method()) && !/KeepAlive|Translation|GetMasterData|Pagination/i.test(r.url())) {
      saves.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-3).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 600)}`);
    }
  });

  await pg.goto('/ema/app-enrollment-collection-setup');
  await pg.waitForSpinner();
  await pg.settle(3_000);
  const collTab = page.locator('button, a, [role=tab]').filter({ hasText: /^\s*(EMA|ADP) Collection\s*$/ }).locator('visible=true').first();
  await collTab.click({ timeout: 60_000 });
  await pg.waitForSpinner();
  await pg.settle(3_000);
  await dump('COLLECTION LIST');
  await page.screenshot({ path: 'test-results/screens/probe-ema-collection-list.png', fullPage: true }).catch(() => {});
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await pg.settle(3_000);
  const info = await dump('COLLECTION FORM OPEN');
  for (const s of info.selects) { const n = s.split('[')[0]; if (n && n !== '-' && !/mobile/i.test(n)) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`)); }

  const memberInput = page.locator('input[placeholder="Enter"], input[formcontrolname*="member" i], input[id*="member" i]').locator('visible=true').first();
  console.log(`member input: id="${await memberInput.getAttribute('id')}" fc="${await memberInput.getAttribute('formcontrolname')}" placeholder="${await memberInput.getAttribute('placeholder')}"`);
  await memberInput.fill(member);
  await memberInput.press('Enter');
  await memberInput.blur();
  await pg.waitForIdle();
  await pg.settle(3_000);
  await page.waitForTimeout(3_000);
  await dump('AFTER MEMBER NUMBER');
  await page.screenshot({ path: 'test-results/screens/probe-ema-collection-member.png', fullPage: true }).catch(() => {});
  const info2 = await dump('selects after member');
  for (const s of info2.selects) { const n = s.split('[')[0]; if (n && n !== '-' && !/mobile|businessUnit/i.test(n)) await openSel(n).catch((e) => console.log(`openSel ${n} failed: ${e.message.split('\n')[0]}`)); }
  if (process.env.PICK_MEMBER) {
    const n = info2.selects.map((s) => s.split('[')[0]).find((x) => /member/i.test(x) && !/mobile/i.test(x));
    if (n) { await pg.pick(n, process.env.PICK_MEMBER, { search: true }).catch((e) => console.log(`pick ${n} failed ${e.message.split('\n')[0]}`)); await pg.settle(3_000); await dump('AFTER MEMBER PICK'); }
  }

  const mp = page.getByRole('button', { name: /Make Payment/i }).locator('visible=true').last();
  if (await mp.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await mp.click({ timeout: 15_000 });
    await pg.waitForIdle();
    await pg.settle(3_000);
    await dump('AFTER MAKE PAYMENT');
    await page.screenshot({ path: 'test-results/screens/probe-ema-collection-payment.png', fullPage: true }).catch(() => {});
    if (process.env.PAY === '1') {
      const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
      const paid = await pg.addPaymentEntry(dlg, { mode: 'Cash', what: 'probe' }).catch((e) => { console.log('addPaymentEntry failed: ' + e.message.split('\n')[0]); return ''; });
      console.log('paid ' + paid);
      const close = dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click().catch(() => {});
      await pg.settle(2_000);
      await dump('AFTER PAYMENT DIALOG CLOSED');
    } else {
      const close = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').locator('visible=true').last().getByRole('button', { name: /^Close$|Cancel/i }).locator('visible=true').last();
      if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click().catch(() => {});
    }
  } else console.log('no Make Payment button');
  // EMA Details sub-tab of Payment Collection
  const details = page.locator('button, a, li').filter({ hasText: /^\s*(EMA|ADP) Details\s*$/ }).locator('visible=true').first();
  if (await details.isVisible({ timeout: 2_000 }).catch(() => false)) { await details.click().catch(() => {}); await pg.settle(2_000); await dump('EMA DETAILS SUB-TAB'); }
  if (process.env.SAVE === '1') {
    await page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').last().click({ timeout: 15_000 });
    await page.waitForTimeout(10_000);
    await dump('AFTER SUBMIT');
  }
  console.log('responses ' + JSON.stringify(saves, null, 1));
  console.log('alerts ' + JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
