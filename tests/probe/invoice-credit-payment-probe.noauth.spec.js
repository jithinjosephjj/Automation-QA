const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

/**
 * READ-ONLY probe (never submits): the retail invoice's Payment Collection
 * dialog with "Credit Payment Mode" - its panel inputs, what "+ Add" does,
 * the dialog's Close, and the form's Submit / balance afterwards.
 * TAG= an unsold tag (default: the TC-RID chain's tag).
 */
const BU = process.env.BU || 'Kakkanad';
const TAG = process.env.TAG || require('../../utils/e2e-state').makeState('e2e-retail-item-delivery-state.json').readState().tagNo;
const MOBILE = process.env.MOBILE || '8778894889';

async function dumpDlg(page, dlg, label) {
  const info = await dlg.evaluate((d) => {
    const vis = (n) => !!n.offsetParent;
    return {
      inputs: [...d.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type}=${i.value}${i.disabled || i.readOnly ? '(ro)' : ''}${i.classList.contains('ng-invalid') ? '(invalid)' : ''}`),
      selects: [...d.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'}=${n.querySelector('.ng-value')?.textContent.trim() || '(empty)'}`),
      labels: [...d.querySelectorAll('label')].filter(vis).map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30),
      buttons: [...d.querySelectorAll('button')].filter(vis).map((b) => `${b.textContent.replace(/\s+/g, ' ').trim() || '?'}${b.disabled ? '(disabled)' : ''}`).slice(0, 40),
      rows: [...d.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).slice(0, 5),
      text: d.innerText.replace(/\s+/g, ' ').trim().slice(0, 900),
    };
  }).catch((e) => ({ error: String(e).slice(0, 120) }));
  console.log(`${label}: ${JSON.stringify(info)}`);
  return info;
}

test('invoice credit payment mode', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(600_000);
  if (!TAG) throw new Error('TAG= an unsold tag is needed');
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', BU);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: BU });
  const pg = retailInvoice;
  page.on('response', async (r) => {
    const u = r.url();
    if (/KeepAlive|Translation|GetMasterData|\.js|\.css|\.png|\.woff|GetAll|Pagination/i.test(u) || r.request().method() === 'OPTIONS') return;
    if (/Invoice|Credit|Payment/i.test(u)) console.log(`  net ${r.request().method()} ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 200)}`);
  });

  await pg.open();
  await pg.openAddForm();
  const mob = pg.input('mobileNumber').or(page.locator('input[placeholder="Mobile number"]').locator('visible=true').first()).first();
  await mob.fill(MOBILE); await mob.blur(); await pg.waitForIdle(); await pg.settle(2_500);
  if (!(await pg.selectValue('customerID').catch(() => ''))) await pg.pick('customerID', process.env.CUSTOMER || 'Abhilash Attayam', { search: true });
  await pg.settle(2_000);
  console.log('customer: ' + await pg.selectValue('customerID').catch(() => ''));
  await pg.pickSalesExecutive('Chandu');
  await pg.closeStalePanels();
  await pg.scanTag(TAG);
  await pg.fillMetalRateIfEmpty(6000);

  const proceed = page.getByRole('button', { name: /Proceed To Payment/i }).locator('visible=true').last();
  await proceed.click({ timeout: 15_000 });
  await pg.waitForIdle(); await pg.settle(3_000);
  const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
  await dlg.waitFor({ state: 'visible', timeout: 15_000 });
  console.log(`dialog element: ${await dlg.evaluate((d) => `${d.tagName}.${d.className}`.slice(0, 120))}; dialogs matching: ${await page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection/i }).locator('visible=true').count()}`);
  await dumpDlg(page, dlg, 'PAYMENT dialog (opened)');

  const credit = dlg.locator('button').filter({ hasText: /Credit Payment Mode/i }).locator('visible=true').first();
  await credit.click({ timeout: 10_000 });
  await pg.settle(2_000);
  const after = await dumpDlg(page, dlg, 'after Credit Payment Mode');
  await page.screenshot({ path: 'test-results/adhoc/probe-credit-mode-panel.png', fullPage: true }).catch(() => {});
  for (const s of after.selects) {
    const c = s.split('=')[0];
    const host = dlg.locator(`sioniq-ng-select[controlname="${c}"] ng-select, ng-select[formcontrolname="${c}"]`).locator('visible=true').first();
    await host.locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    console.log(`  OPTIONS ${c}: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).slice(0, 20))}`);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // fill the amount with the balance due (if an amount input is offered) and Add
  const due = ((await dlg.locator('xpath=.//*[contains(normalize-space(.),"BALANCE DUE")]/following::*[contains(text(),"₹")][1]').first().textContent().catch(() => '')) || '').replace(/[^0-9.]/g, '');
  console.log(`balance due "${due}"`);
  const amt = dlg.locator('xpath=.//label[contains(translate(normalize-space(.),"amount","AMOUNT"),"AMOUNT")]/following::input[not(@type="checkbox")][1]').locator('visible=true').first();
  if (await amt.count() && !(await amt.isDisabled().catch(() => true))) { await amt.fill(due); await amt.blur(); await pg.settle(800); }
  // any other empty required inputs: leave; just report
  await dumpDlg(page, dlg, 'credit panel filled');
  const addBtn = dlg.locator('button').filter({ hasText: /^\s*\+?\s*Add\b/i }).locator('visible=true').last();
  console.log(`add button "${(await addBtn.innerText().catch(() => '')).trim()}" enabled=${await addBtn.isEnabled().catch(() => '?')}`);
  await addBtn.click({ timeout: 10_000 }).catch((e) => console.log(`add click: ${String(e).slice(0, 120)}`));
  await pg.waitForIdle(); await pg.settle(2_500);
  await dumpDlg(page, dlg, 'after + Add (credit)');
  console.log(`toasts: ${JSON.stringify(await pg.toasts())}`);
  await page.screenshot({ path: 'test-results/adhoc/probe-credit-mode-added.png', fullPage: true }).catch(() => {});

  // the Close control(s)
  const closes = page.locator('button').filter({ hasText: /^\s*Close\s*$/ }).locator('visible=true');
  console.log(`visible Close buttons on page: ${await closes.count()}; inside dlg: ${await dlg.getByRole('button', { name: /^Close$|Done|Ok/i }).locator('visible=true').count()}`);
  const closeBtn = closes.last();
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await closeBtn.click({ timeout: 5_000 }).catch((e) => console.log(`close: ${String(e).slice(0, 100)}`));
  await pg.settle(2_000);
  console.log(`dialog still open: ${await dlg.isVisible().catch(() => false)}; Submit visible: ${await page.getByRole('button', { name: /Submit\s*$/ }).locator('visible=true').count()}; form fields ${JSON.stringify(await pg.visibleFields()).slice(0, 900)}`);
  await page.screenshot({ path: 'test-results/adhoc/probe-credit-mode-closed.png', fullPage: true }).catch(() => {});
  // NOT submitting - leave the form
});
