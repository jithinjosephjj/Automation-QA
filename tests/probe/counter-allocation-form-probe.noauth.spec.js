const { test } = require('../../fixtures/test-fixtures');

// PROBE: the Counter Allocation Add form (/sls/view-counter-allocation) at
// Kakkanad - every select / input / checkbox / switch / button it offers
// after Item Type Metal + Group Category Gold + Scan Type Lot Number, to
// find what drives `requiresAcceptance` in CreateCounterAllocation
// (11-11-2026: allocations save with requiresAcceptance:false and never
// reach Counter Accept / Reject). Nothing is saved. Run:
//   npx playwright test tests/probe/counter-allocation-form-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE counter allocation form controls', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = logisticsSales;
  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const name = (el) => (el.closest('[controlname]') || el).getAttribute('controlname') || el.getAttribute('formcontrolname') || el.placeholder || el.id || '-';
      const labelOf = (el) => { const l = el.closest('.form-group, .mb-3, .col, .form-check, div')?.querySelector('label'); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; };
      const form = document.querySelector('form') || document.body;
      return {
        text: form.innerText.replace(/\s+/g, ' ').slice(0, 2500),
        selects: [...document.querySelectorAll('ng-select')].filter(vis).map((n) => `${name(n)}[${labelOf(n)}]=${n.querySelector('.ng-value') ? n.querySelector('.ng-value').textContent.replace(/×/g, '').trim() : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.id || '-'}|${name(i)}[${labelOf(i)}]="${i.value}"${i.disabled || i.readOnly ? '(ro)' : ''}`),
        checkboxes: [...document.querySelectorAll('input[type=checkbox], input[type=radio], [role=switch]')].map((c) => `${c.id || c.getAttribute('formcontrolname') || c.getAttribute('name') || '-'}[${labelOf(c)}]=${c.checked}${vis(c) ? '' : '(hidden)'} labels:${[...document.querySelectorAll(`label[for="${c.id}"]`)].map((l) => l.textContent.trim()).join('/')}`),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
        acceptanceText: [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /accept/i.test(e.textContent)).map((e) => e.textContent.trim()).slice(0, 10),
      };
    });
    console.log(`=== ${label}: ${JSON.stringify(info, null, 1)}`);
    return info;
  };
  await pg.goto('/sls/view-counter-allocation');
  await pg.waitForIdle();
  await dump('LIST');
  await pg.clickVisibleAdd();
  await pg.settle(2_000);
  await dump('FORM OPEN');
  await pg.pick('masterDataValueID_JewelleryItemType', 'Metal');
  await pg.settle(1_500);
  await pg.pick('groupCategoryMetalIDs', 'Gold', { closePanel: true }).catch((e) => console.log('group pick failed ' + e.message.split('\n')[0]));
  await pg.settle(1_500);
  await dump('AFTER ITEM TYPE + GROUP');
  await pg.pickPreferred('masterDataValueID_ScanType', /lot/i);
  await pg.settle(1_500);
  await dump('AFTER SCAN TYPE LOT');
  await page.screenshot({ path: 'test-results/screens/probe-counter-allocation-form.png', fullPage: true }).catch(() => {});
  const sel = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select[controlname], ng-select[formcontrolname]')].filter((n) => n.offsetParent).map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname')));
  for (const n of sel) {
    if (/JewelleryItemType|groupCategory|ScanType|vendorIDs|lotNos/.test(n)) continue;
    await pg.closeStalePanels();
    await pg.select(n).locator('.ng-select-container').click({ timeout: 5_000 }).catch(() => {});
    await pg.settle(1_200);
    console.log(`${n} options: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allInnerTexts().catch(() => [])).slice(0, 15))}`);
    await page.keyboard.press('Escape');
  }
});
