const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE: on the Reserve Estimation form with TAG staged, what does "Proceed to
// Payment" open (dialog text, its buttons / inputs / modes), and does a
// Submit appear anywhere afterwards? Nothing is submitted unless SAVE=1.
// Run: TAG=... npx playwright test tests/probe/reserve-payment-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE reserve estimation payment step', async ({ loginPage, orderEstimation, page }) => {
  test.setTimeout(400_000);
  const tagNo = process.env.TAG;
  if (!tagNo) throw new Error('TAG=<tag number> required');
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = orderEstimation;

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const root = [...document.querySelectorAll('.modal, [role="dialog"], ngb-modal-window, .offcanvas')].filter(vis).pop();
      const scope = root || document.body;
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      return {
        dialog: !!root,
        text: root ? root.innerText.replace(/\s+/g, ' ').slice(0, 1200) : '',
        selects: [...scope.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${name(i)}="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        buttons: [...scope.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };

  await pg.open();
  await page.getByRole('tab', { name: /Reserve Estimation/i }).locator('visible=true').first().click({ timeout: 15_000 });
  await pg.waitForIdle(); await pg.waitForSpinner(); await pg.settle(1_500);
  await page.locator('button:has(i.ri-add-fill)').locator('visible=true').first().click({ timeout: 60_000 });
  await pg.select('customerID').waitFor({ state: 'visible', timeout: 15_000 });
  await pg.settle(2_000);
  await pg.pick('customerID', 'Aneesh Maradu', { search: true });
  await pg.settle(2_000);
  await pg.pickUnlessSet('masterDataValueID_BusinessType', 'Retail');
  await pg.pickUnlessSet('masterDataValueID_StockSourceType', 'TagWise');
  await pg.pick('salesExecutiveID', 'Chandu', { search: true });
  await pg.closeStalePanels();
  const scan = page.locator('input#scanValue').locator('visible=true').first();
  await scan.fill(tagNo);
  await scan.press('Enter');
  await page.waitForTimeout(5_000);
  await page.getByRole('button', { name: /Add Item/ }).locator('visible=true').last().click();
  await page.waitForTimeout(3_000);
  await dump('AFTER ADD ITEM');

  const proceed = page.getByRole('button', { name: /Proceed to Payment/i }).locator('visible=true').last();
  const saves = [];
  page.on('response', async (r) => { if (['POST', 'PUT'].includes(r.request().method()) && /Estimation|Reserve/i.test(r.url()) && !/Get|KeepAlive/i.test(r.url())) saves.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 200)}`); });
  await proceed.click({ timeout: 15_000 });
  await page.waitForTimeout(5_000);
  await dump('AFTER PROCEED TO PAYMENT');
  await page.screenshot({ path: 'test-results/screens/probe-reserve-payment.png', fullPage: true });
  console.log(`saves so far: ${JSON.stringify(saves)}`);
  if (process.env.SAVE) {
    // close the dialog without paying, then look for Submit
    const close = page.locator('.modal, [role="dialog"], ngb-modal-window').locator('visible=true').last().getByRole('button', { name: /^Close$|Done|Ok/i }).last();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await close.click();
    await page.waitForTimeout(3_000);
    await dump('AFTER CLOSING PAYMENT');
    console.log(`saves after close: ${JSON.stringify(saves)}`);
  }
});
