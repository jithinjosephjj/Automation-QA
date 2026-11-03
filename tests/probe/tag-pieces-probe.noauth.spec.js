const { test } = require('../../fixtures/test-fixtures');

// PROBE: what did the barcode save record for a lot? The Barcode Generation list
// is a per-lot grid (Lot No, Lot Pcs, Lot Weight, Barcoded Pcs, Barcoded Weight,
// Pending Pcs, Pending Weight, Progress %, Status). Prints those cells for each
// lot in LOTS (comma separated; default: the order chain's lot). Read-only.
//   LOTS=NN405,NN396 npx playwright test tests/probe/tag-pieces-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE barcoded pieces per lot', async ({ loginPage, barcodeGeneration, page }) => {
  test.setTimeout(300_000);
  const lots = (process.env.LOTS || require('../../utils/e2e-state').makeState('e2e-retail-order-estimation-state.json').readState().lotNo || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!lots.length) throw new Error('LOTS=<lot numbers> required');
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123', bu: 'Kakkanad' });
  const pg = barcodeGeneration;
  await pg.open();
  const headers = (await page.locator('table thead th').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
  console.log(`headers: ${JSON.stringify(headers)}`);
  const search = page.getByRole('textbox', { name: 'Search' }).locator('visible=true').first();
  for (const lot of lots) {
    await search.fill(lot);
    await search.press('Enter');
    await pg.waitForIdle();
    await pg.settle(3_000);
    const row = page.locator('table tbody tr').filter({ hasText: lot }).first();
    if (!(await row.isVisible({ timeout: 10_000 }).catch(() => false))) {
      console.log(`lot ${lot}: no row; first rows ${JSON.stringify((await page.locator('table tbody tr').allInnerTexts().catch(() => [])).slice(0, 3).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 160)))}`);
      continue;
    }
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `test-results/screens/probe-lot-${lot}-row.png`, fullPage: false }).catch(() => {});
    const cells = (await row.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    console.log(`lot ${lot}: ${JSON.stringify(headers.map((h, i) => `${h}=${cells[i] ?? ''}`).filter((p) => !/^=|^Sl No/.test(p)))}`);
    // the row's Barcoded view (eye / expand), if any, lists the tags with their pieces
    const open = row.locator('button, a').locator('visible=true');
    const n = await open.count();
    console.log(`lot ${lot}: ${n} row action(s): ${JSON.stringify(await open.evaluateAll((els) => els.map((e) => (e.getAttribute('title') || e.getAttribute('aria-label') || e.className || '').slice(0, 60))))}`);
    if (n) {
      await open.first().click({ timeout: 5_000 }).catch(() => {});
      await pg.waitForIdle();
      await pg.settle(2_500);
      const dlg = page.locator('.modal, [role="dialog"], ngb-modal-window, .offcanvas').locator('visible=true').last();
      const inDlg = await dlg.isVisible().catch(() => false);
      const scope = inDlg ? dlg : page;
      const h2 = (await scope.locator('table thead th').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim());
      const rows = (await scope.locator('table tbody tr').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 6);
      console.log(`lot ${lot} detail (${inDlg ? 'dialog' : 'page'} ${page.url().split('/').slice(-1)[0]}): headers ${JSON.stringify(h2.slice(0, 30))}; rows ${JSON.stringify(rows)}`);
      await page.screenshot({ path: `test-results/screens/probe-lot-${lot}-detail.png`, fullPage: true }).catch(() => {});
      if (inDlg) await dlg.getByRole('button', { name: /Close/i }).locator('visible=true').last().click({ timeout: 3_000 }).catch(() => page.keyboard.press('Escape'));
      else { await pg.open(); }
      await pg.settle(1_500);
    }
  }
});
