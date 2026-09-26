const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing): the redesigned Customer Registration add
 * form (26-09-2026: Mobile Number first with a +91 code, "Name (Existing
 * match)" select, Full Name, KYC "Attach" button). Dumps every visible
 * control with its label, formcontrolname / controlname, id, placeholder and
 * type, per wizard step, walking Next without filling anything.
 */
async function dump(page, label) {
  const info = await page.evaluate(() => {
    const vis = (n) => !!n.offsetParent && !n.closest('header, .topbar, nav, .navbar, aside, app-sidebar');
    const labelOf = (n) => {
      let el = n;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        const l = el && el.querySelector(':scope > label, :scope > .form-label, :scope > span.label');
        if (l && l.textContent.trim()) return l.textContent.trim().slice(0, 35);
      }
      return '';
    };
    const selects = [...document.querySelectorAll('ng-select')].filter(vis).map((n) => {
      const wrap = n.closest('sioniq-ng-select, [formcontrolname], [controlname]') || n;
      return `SELECT "${labelOf(n)}" ctl=${wrap.getAttribute('controlname') || n.getAttribute('formcontrolname') || wrap.getAttribute('formcontrolname') || ''} id=${n.id || wrap.id || ''} value=${(n.querySelector('.ng-value-label')?.textContent || '').trim()}${n.classList.contains('ng-invalid') ? ' (invalid)' : ''}`;
    });
    const inputs = [...document.querySelectorAll('input, textarea')].filter(vis).filter((i) => !i.closest('ng-select')).map((i) =>
      `${i.tagName === 'TEXTAREA' ? 'TEXTAREA' : 'INPUT'}[${i.type}] "${labelOf(i)}" fcn=${i.getAttribute('formcontrolname') || ''} id=${i.id || ''} name=${i.name || ''} ph=${i.placeholder || ''}${i.classList.contains('ng-invalid') ? ' (invalid)' : ''}`);
    const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { selects, inputs, buttons };
  });
  console.log(`===== ${label}\n${info.selects.join('\n')}\n${info.inputs.join('\n')}\nBUTTONS ${JSON.stringify(info.buttons)}`);
}

test('probe customer registration form controls', async ({ loginPage, customerRegistration, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn();
  await customerRegistration.open();
  await customerRegistration.waitForSpinner();
  await customerRegistration.addBtn.click({ timeout: 60_000 });
  await customerRegistration.waitForIdle();
  await customerRegistration.settle(3_000);
  await dump(page, 'form as opened');
  await page.screenshot({ path: 'test-results/probe-customer-form.png', fullPage: true });
  // KYC Attach: what does it open?
  const attach = page.getByRole('button', { name: /Attach/ }).locator('visible=true').first();
  if (await attach.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await attach.click();
    await customerRegistration.settle(2_000);
    await dump(page, 'after KYC Attach');
    await page.screenshot({ path: 'test-results/probe-customer-kyc.png', fullPage: true });
    await page.keyboard.press('Escape').catch(() => {});
    await customerRegistration.settle(1_000);
  }
});
