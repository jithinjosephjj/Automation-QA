const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const sessionCache = require('../../utils/session-cache');

// PROBE: on the retail Invoice (Direct) form with the chain's tag staged, what does
// the Payment Collection dialog's "Advance" mode offer (selects / inputs / the
// customer's open advances)? Reads e2e-retail-general-advance-state.json (tag,
// customer, advance). Nothing is submitted unless SAVE=1. Run:
//   npx playwright test tests/probe/invoice-advance-payment-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE invoice payment - Advance mode', async ({ loginPage, retailInvoice, page }) => {
  test.setTimeout(400_000);
  const state = makeState(process.env.STATE || 'e2e-retail-general-advance-state.json');
  const { tagNo, customerName, customerMobile, advanceNo } = state.readState();
  if (!tagNo || !customerName) throw new Error('state has no tag / customer - run the chain to TC-ADV-05 first');
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = retailInvoice;

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      return {
        dialog: !!root,
        text: root ? root.innerText.replace(/\s+/g, ' ').slice(0, 1500) : '',
        selects: [...scope.querySelectorAll('ng-select, select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : (n.value || '')}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        rows: [...scope.querySelectorAll('table tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim()).slice(0, 8),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };

  await pg.open();
  await pg.openAddForm();
  const mob = pg.input('mobileNumber').or(page.locator('input[placeholder="Mobile number"]').locator('visible=true').first()).first();
  await mob.fill(String(customerMobile));
  await mob.blur();
  await pg.waitForIdle();
  await pg.settle(2_500);
  if (!(await pg.selectValue('customerID').catch(() => ''))) await pg.pick('customerID', customerName, { search: true });
  await pg.pickUnlessSet('masterDataValueID_InvoiceSource', 'Direct');
  await pg.settle(1_500);
  await pg.pickSalesExecutive('Chandu');
  await pg.pickOrFirst('helperID', 'Chandu');
  await pg.closeStalePanels();
  await pg.scanTag(tagNo, {});
  await pg.fillMetalRateIfEmpty(6000);
  await dump('BEFORE PAYMENT');

  await page.getByRole('button', { name: /Proceed To Payment/i }).locator('visible=true').last().click({ timeout: 15_000 });
  await pg.waitForIdle();
  await pg.settle(3_000);
  const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').filter({ hasText: /Payment Collection|PAYMENT MODES|BALANCE DUE/i }).locator('visible=true').last();
  await dump('PAYMENT DIALOG');
  const adv = dlg.locator('button').filter({ hasText: /Advance/i }).locator('visible=true').first();
  console.log(`Advance mode button count: ${await adv.count()} (looking for advance ${advanceNo})`);
  if (await adv.count()) {
    await adv.click();
    await pg.settle(2_000);
    await dump('ADVANCE PANEL');
    // open any select in the panel to list its options
    const sel = dlg.locator('ng-select').locator('visible=true');
    for (let i = 0; i < (await sel.count()); i++) {
      await sel.nth(i).click().catch(() => {});
      await pg.settle(1_200);
      console.log(`select[${i}] options: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).slice(0, 12))}`);
      await page.keyboard.press('Escape');
      await pg.settle(400);
    }
    const native = dlg.locator('select').locator('visible=true');
    for (let i = 0; i < (await native.count()); i++) console.log(`native select[${i}] options: ${JSON.stringify(await native.nth(i).locator('option').allInnerTexts())}`);
    await page.screenshot({ path: 'test-results/screens/probe-invoice-advance-panel.png', fullPage: true }).catch(() => {});
    if (process.env.PICK) {
      // ADVANCE TYPE General -> REFERENCE NUMBER = the advance receipt -> Amount (auto) -> + Add Advance
      const fetches = [];
      page.on('response', async (r) => { if (/Advance/i.test(r.url()) && !/KeepAlive/i.test(r.url())) fetches.push(`${r.status()} ${r.request().method()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 300)}`); });
      const typeSel = dlg.locator('sioniq-ng-select[controlname="advanceTypeId"] ng-select, ng-select[formcontrolname="advanceTypeId"]').locator('visible=true').first();
      await typeSel.click(); await pg.settle(800);
      await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /^\s*General\s*$/ }).first().click();
      await pg.settle(1_500);
      await dump('AFTER ADVANCE TYPE GENERAL');
      const ref = dlg.locator('input[formcontrolname="referenceNumber"], [controlname="referenceNumber"] input, input#referenceNumber').locator('visible=true').first();
      await ref.fill(String(advanceNo));
      await ref.press('Enter');
      await ref.blur();
      await pg.waitForIdle();
      await pg.settle(3_000);
      await dump('AFTER REFERENCE');
      console.log('fetches', JSON.stringify(fetches, null, 1));
      const addBtn = dlg.locator('button').filter({ hasText: /^\s*\+?\s*Add\b/i }).locator('visible=true').last();
      console.log(`add button "${await addBtn.innerText().catch(() => '')}"`);
      await addBtn.click({ timeout: 10_000 });
      await pg.waitForIdle();
      await pg.settle(2_500);
      await dump('AFTER ADD ADVANCE');
      console.log('fetches', JSON.stringify(fetches, null, 1));
      console.log('toasts', JSON.stringify(await page.locator('.toast, .toast-message, [role="alert"]').allTextContents().catch(() => [])));
    }
  }
  console.log('alerts', JSON.stringify(await page.getByRole('alert').allTextContents().catch(() => [])));
});
