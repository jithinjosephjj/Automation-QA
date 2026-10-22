// Read-only: Transfer Out form at the given login - picks Transfer Mode +
// Destination, lists the Transaction Mode options and, for each, the fields
// the form then shows (looking for an ORDER transfer). Nothing is submitted.
// Run: BU=Cochin DEST=Kakkanad npx playwright test tests/diag/transfer-modes.diag.js (rename to *.noauth.spec.js to run) --project=no-auth --output=test-results-diag --reporter=list
const { test } = require('../../fixtures/test-fixtures');
const fs = require('fs');

const DIR = 'bug-reports/shots-transfer-modes';
const DEST = process.env.DEST || 'Kakkanad';

async function dumpLabels(page, tag) {
  const out = await page.evaluate(() => {
    const vis = (el) => !!(el && el.offsetParent);
    return [...document.querySelectorAll('ng-select')].filter(vis).map((ng) => {
      const col = ng.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-lg-2, .col-lg-3, .col-lg-4, .form-group') || ng.parentElement;
      const lbl = col && col.querySelector('label');
      const wrap = ng.closest('[controlname]');
      return `${(wrap && wrap.getAttribute('controlname')) || ng.getAttribute('formcontrolname') || '-'} | ${lbl ? lbl.textContent.trim() : '-'} | ${ng.querySelector('.ng-value') ? ng.querySelector('.ng-value').textContent.trim() : '(empty)'}${ng.classList.contains('ng-select-disabled') ? ' (disabled)' : ''}`;
    }).concat([...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([role=combobox])')].filter(vis).map((i) => `input | ${i.placeholder || i.id || '-'} | "${i.value}"`))
      .concat([...document.querySelectorAll('button')].filter(vis).map((b) => 'button | ' + b.textContent.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 9));
  });
  console.log(`--- ${tag}\n  ${out.join('\n  ')}`);
}

test('transfer out modes', async ({ loginPage, transfers, page }) => {
  test.setTimeout(400_000);
  fs.mkdirSync(DIR, { recursive: true });
  await loginPage.ensureLoggedIn(process.env.BU ? { bu: process.env.BU } : undefined);
  await transfers.open();
  await transfers.openTab('Transfer Out');
  await transfers.addBtn.click({ timeout: 30_000 });
  await transfers.settle(2_000);
  await transfers.pickByLabelText('Transfer Mode', /^\s*Confirmed\s*$/);
  await transfers.pickByLabelText('Destination Business Unit', new RegExp(DEST));
  await transfers.settle(1_500);
  const modeSel = transfers.selectByLabel('Transaction Mode');
  await modeSel.locator('.ng-select-container').first().click({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  const modes = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`Transaction Mode options: ${JSON.stringify(modes)}`);
  await page.keyboard.press('Escape');
  for (const m of modes) {
    await transfers.pickByLabelText('Transaction Mode', new RegExp(`^\\s*${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)).catch((e) => console.log(String(e).slice(0, 120)));
    await transfers.settle(2_000);
    await dumpLabels(page, `Transaction Mode = ${m}`);
    await page.screenshot({ path: `${DIR}/mode-${m.replace(/\W+/g, '_')}.png`, fullPage: true });
    // open every empty select once to show its options
    const labels = await page.evaluate(() => [...document.querySelectorAll('ng-select')].filter((n) => n.offsetParent && !n.querySelector('.ng-value') && !n.classList.contains('ng-select-disabled')).map((ng) => { const col = ng.closest('.col, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-lg-2, .col-lg-3, .col-lg-4, .form-group') || ng.parentElement; const lbl = col && col.querySelector('label'); return lbl ? lbl.textContent.trim() : ''; }).filter(Boolean));
    for (const l of labels.slice(0, 8)) {
      const sel = transfers.selectByLabel(l);
      await sel.locator('.ng-select-container').first().click({ timeout: 4_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
      console.log(`   options of "${l}" (${opts.length}): ${JSON.stringify(opts.slice(0, 20))}`);
      await page.keyboard.press('Escape');
    }
  }
});
