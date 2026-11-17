const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

/** READ-ONLY: the latest retail invoices and the Item Delivery pending list (after a 504 on save). */
test('latest invoices + pending deliveries', async ({ loginPage, retailInvoice, itemDelivery, page }) => {
  test.setTimeout(300_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  await retailInvoice.open();
  const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 4);
  console.log(`INVOICE list top rows: ${JSON.stringify(rows)}`);
  await itemDelivery.open();
  await itemDelivery.openAddForm();
  const host = itemDelivery.select('salesInvoiceID');
  await host.locator('.ng-select-container').click({ timeout: 10_000 });
  await page.waitForTimeout(2_500);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim());
  console.log(`Item Delivery Invoice No options: ${JSON.stringify(opts.slice(0, 10))}`);
  await page.keyboard.press('Escape');
});
