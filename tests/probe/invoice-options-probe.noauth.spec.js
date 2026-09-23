const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): the Metal Invoice (B2B) header - Stock Source and Issue
// Type options, and what the form reveals for each Stock Source.
test('PROBE metal invoice stock source options', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    if (!(await host.count())) { console.log(`  ${ctl}: (absent)`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  ${ctl}: ${JSON.stringify(opts.slice(0, 15))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  const selects = async (label) => {
    const info = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent).map((n) => {
      const box = n.closest('.form-group, .col, [class*="col-"], div');
      const cap = (box && (box.querySelector('label') || box.previousElementSibling) ? (box.querySelector('label') || box.previousElementSibling).textContent : '').replace(/[ \t\n]+/g, ' ').trim().slice(0, 30);
      return `${n.getAttribute('controlname')} [${cap}]`;
    }));
    const inputs = await page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter((i) => i.offsetParent && !i.closest('ng-select, header')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type}`));
    console.log(`${label}: selects ${JSON.stringify(info)} inputs ${JSON.stringify(inputs)}`);
  };
  await logisticsSales.goto('/sls/app-invoice-setup');
  await logisticsSales.waitForIdle();
  const tab = page.getByRole('tab', { name: /^(B2B )?Metal (Sales )?Invoice$/ }).or(page.getByRole('button', { name: /^(B2B )?Metal (Sales )?Invoice$/ })).first();
  await tab.waitFor({ state: 'visible', timeout: 30_000 });
  await tab.click();
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(1_500);
  await logisticsSales.clickVisibleAdd();
  await logisticsSales.pickPreferred('transactionSubTypeID', /invoice/i);
  await logisticsSales.pick('b2BCustomerID', 'RAJA');
  await logisticsSales.pickFirstByCaption('Customer Branch', /branch/i, { optional: true });
  await selects('INVOICE header');
  const sources = await options('masterDataValueID_StockSourceFrom');
  await options('masterDataValueID_InvoiceIssueType');
  for (const src of sources) {
    await logisticsSales.pick('masterDataValueID_StockSourceFrom', src, { exact: true });
    await logisticsSales.settle(1_500);
    await selects(`after Stock Source "${src}"`);
    await options('masterDataValueID_InvoiceIssueType');
  }
});
