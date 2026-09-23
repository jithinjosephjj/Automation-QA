const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

// PROBE: where does a tag land after the Approval Receipt (Receipt To
// "Stock")? Counter Allocation says "Tag / RFID not found or not eligible".
// Lists the Counter Accept pending grid (all item types), the Counter
// Transfer form, and the approval receipt record; when the tag waits in the
// Counter Accept grid it is ACCEPTED there and the state file is advanced.
test('PROBE returned tag location', async ({ loginPage, logisticsSales, page }) => {
  test.setTimeout(400_000);
  const state = makeState('e2e-approval-sales-state.json');
  const st = state.readState();
  const keys = [st.tagNo, st.rfidNo].filter(Boolean);
  console.log(`probing ${JSON.stringify(keys)} (approval receipt ${st.approvalReceiptNo})`);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!/CounterAccept|ApprovalReceipt|CounterTransfer/i.test(r.url()) || /Pagination/i.test(r.url()) || !['POST', 'GET'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 600); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${r.url().replace(/^https?:[/][/][^/]+/, '')} req=${(r.request().postData() || '').slice(0, 200)} res=${body}`);
  });
  const rows = async (label) => {
    const all = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim());
    const hits = all.filter((t) => keys.some((k) => t.includes(k)));
    console.log(`${label}: ${all.length} rows; ours: ${JSON.stringify(hits.map((t) => t.slice(0, 200)))}; first rows: ${JSON.stringify(all.slice(0, 3).map((t) => t.slice(0, 120)))}`);
    return hits;
  };

  // Counter Accept pending grid, every item type
  await logisticsSales.goto('/sls/view-counter-accept-reject');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd();
  let accepted = false;
  for (const itemType of ['Metal', 'Brand', 'Stone']) {
    await logisticsSales.pickTolerant('Item Type *', itemType).catch(() => logisticsSales.pickTolerant('Item Type', itemType).catch(() => {}));
    await logisticsSales.waitForIdle();
    await logisticsSales.settle(2_500);
    const hits = await rows(`COUNTER ACCEPT pending (${itemType})`);
    if (hits.length && !accepted) {
      const key = keys.find((k) => hits[0].includes(k));
      await logisticsSales.checkRow(key);
      const body = await logisticsSales.clickAndCaptureSave(page.getByRole('button', { name: /Accept/ }).locator('visible=true').last());
      await logisticsSales.previewAndClose();
      console.log(`ACCEPTED the returned tag: ${JSON.stringify(body && body.data)}`);
      state.writeState({ reaccepted: true, reallocationNo: 'n/a - the approval receipt itself queued the counter accept' });
      accepted = true;
      break;
    }
  }

  // Counter Transfer form
  await logisticsSales.goto('/sls/view-counter-transfer');
  await logisticsSales.waitForIdle();
  await logisticsSales.clickVisibleAdd().catch(() => {});
  await logisticsSales.settle(1_500);
  const ctSelects = await page.evaluate(() => [...document.querySelectorAll('sioniq-ng-select')].filter((n) => n.offsetParent).map((n) => n.getAttribute('controlname')));
  console.log(`COUNTER TRANSFER selects: ${JSON.stringify(ctSelects)}`);
  for (const ctl of ctSelects) {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    console.log(`  ${ctl}: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).slice(0, 10))}`);
    await page.keyboard.press('Escape').catch(() => {});
  }

  // the approval receipt record
  await logisticsSales.goto('/sls/view-approval-receipt');
  await logisticsSales.waitForIdle();
  await logisticsSales.settle(2_000);
  const rc = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => t.includes(st.approvalReceiptNo || 'RRRR'));
  console.log(`APPROVAL RECEIPT rows: ${JSON.stringify(rc.map((t) => t.slice(0, 300)))}`);
});
