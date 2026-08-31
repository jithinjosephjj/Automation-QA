const { test, expect } = require('../../fixtures/test-fixtures');
const { businessDate } = require('../../utils/unique');

/** TEMP PROBE - maps the B2B Sample order form and the Issue page's Sample tab. Delete after use. */

async function dump(page, tag) {
  const info = await page.evaluate(() => {
    const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const selects = [...document.querySelectorAll('sioniq-ng-select')]
      .filter((n) => n.offsetParent)
      .map((n) => {
        const label = clean(n.querySelector('label')?.innerText) ||
          clean(n.closest('div.grid, div.form-group, .w-100')?.querySelector('label')?.innerText);
        const value = clean(n.querySelector('.ng-value')?.innerText);
        return { controlname: n.getAttribute('controlname'), label, value };
      });
    const labels = [...document.querySelectorAll('label')]
      .filter((n) => n.offsetParent).map((n) => clean(n.innerText)).filter(Boolean);
    const buttons = [...document.querySelectorAll('button')]
      .filter((n) => n.offsetParent).map((n) => clean(n.innerText)).filter(Boolean);
    const inputs = [...document.querySelectorAll('input, textarea')]
      .filter((n) => n.offsetParent)
      .map((n) => ({ id: n.id, type: n.type, ph: n.placeholder, dis: n.disabled }))
      .filter((i) => i.id || i.ph || ['number', 'decimal'].includes(i.type));
    const gridHead = clean(document.querySelector('table thead')?.innerText);
    const gridFirstRows = [...document.querySelectorAll('table tbody tr')].slice(0, 3).map((r) => clean(r.innerText));
    return { url: location.pathname, selects, labels: [...new Set(labels)], buttons: [...new Set(buttons)], inputs, gridHead, gridFirstRows };
  });
  console.log(`\n===== ${tag} =====\n${JSON.stringify(info, null, 1)}\n`);
}

test('PROBE b2b sample order + sample issue', async ({ loginPage, b2bOrderBooking, production, page }) => {
  test.setTimeout(900_000);
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

  const t = (po) => async (name, val, opts) =>
    po.pick(name, val, opts).then(
      (all) => console.log(`pick ${name}=${val} OK; options: ${JSON.stringify(all).slice(0, 250)}`),
      (e) => console.log(`pick ${name}=${val} FAILED: ${String(e).split('\n')[0]}`),
    );

  // ---- 1. B2B Order Booking with Sample purpose ----
  await b2bOrderBooking.open();
  await b2bOrderBooking.openAddWizard();
  const tb = t(b2bOrderBooking);
  await tb('purposeType', 'Sample', { exact: true });
  await page.waitForTimeout(2000);
  await dump(page, 'B2B SAMPLE order details');
  await tb('customer', 'Luxurio', { search: true });
  await tb('itemType', 'Metal');
  await tb('makingType', 'Job Work');
  await tb('supervisor', 'Abc', { search: true });
  await tb('smcode', 'AJ10', { search: true });
  await b2bOrderBooking.fillByLabel('Order Given By', 'JJ').catch((e) => console.log('orderGivenBy failed:', String(e).split('\n')[0]));
  await b2bOrderBooking.fillByLabel('Contact Number', '4545454555').catch((e) => console.log('contact failed:', String(e).split('\n')[0]));
  await tb('deliveryNote', 'Urgent');
  const date = page.locator('#deliveryDate');
  if (await date.isVisible().catch(() => false)) {
    await date.fill(businessDate(30).replace(/-/g, '/'));
    await date.blur();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Next' }).click().catch(() => {});
  await b2bOrderBooking.waitForIdle();
  await page.waitForTimeout(2500);
  await dump(page, 'B2B SAMPLE items step');

  // fill the main item block, then open the Add Sample sub-form
  await tb('referenceType', 'Combination');
  await page.waitForTimeout(1500);
  await dump(page, 'B2B SAMPLE items after referenceType');
  await tb('groupCategory', 'Gold', { exact: true });
  await tb('category', 'Ring', { exact: true });
  await page.waitForTimeout(1500);
  await dump(page, 'B2B SAMPLE items after group/category');

  const addSample = page.getByRole('button', { name: 'Add Sample' });
  if (await addSample.isVisible().catch(() => false)) {
    await addSample.click();
    await page.waitForTimeout(2000);
    await dump(page, 'B2B SAMPLE sub-form after Add Sample');
  } else {
    console.log('Add Sample button NOT visible at this point');
  }

  // ---- 2. Issue page, Sample tab ----
  await production.openRoute('/prc/view-samplejobwork-issue');
  await page.getByRole('tab', { name: 'Sample' }).click();
  await production.waitForIdle();
  await page.waitForTimeout(1500);
  await production.clickAdd();
  await dump(page, 'SAMPLE ISSUE add form');
  // open each empty select to log its options
  const wraps = page.locator('sioniq-ng-select').locator('visible=true');
  const n = await wraps.count();
  for (let i = 0; i < n; i++) {
    const wrap = wraps.nth(i);
    const val = ((await wrap.locator('.ng-value').first().textContent().catch(() => '')) || '').trim();
    if (val) continue;
    const cn = await wrap.getAttribute('controlname');
    await wrap.locator('ng-select .ng-select-container').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const opts = await page.locator('.ng-dropdown-panel .ng-option').allTextContents();
    console.log(`SAMPLE ISSUE select [${cn}] options:`, JSON.stringify(opts.slice(0, 12)));
    await page.keyboard.press('Escape');
  }
});
