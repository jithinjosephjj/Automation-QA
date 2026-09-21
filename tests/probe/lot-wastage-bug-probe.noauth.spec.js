const { test } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const fs = require('fs');

// PROBE for the bug report: Lot Generation sends a NEGATIVE wastage weight
// (-286.125 g for a 350 g item: wastage 97 %, tunch 5 %) and the save fails
// with HTTP 500. Captures screenshots, the payload and the response.
test('PROBE lot generation negative wastage weight', async ({ loginPage, lotGeneration, page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync('bug-reports/shots', { recursive: true });
  const inwardNo = makeState('e2e-b2b-order-lot-state.json').readState().inwardVoucherNo || 'M293';
  await loginPage.ensureLoggedIn();
  const lg = lotGeneration;
  await lg.open();
  await lg.waitForSpinner();
  await lg.addBtn.click({ timeout: 60_000 });
  await lg.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });
  await lg.pick('masterDataValueID_JewelleryItemType', 'Metal', { exact: true });
  await lg.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await lg.pick('fromTransactionTypeID', 'Metal Inward', { exact: true });
  await lg.pick('vendorFilter', 'RAJA', { closePanel: true }).catch(() => {});
  await lg.waitForIdle();
  await lg.settle(2_500);

  const row = lg.rowMatcher(inwardNo).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.getByRole('checkbox').first().check({ force: true });
  await lg.settle(3_000);
  await page.screenshot({ path: 'bug-reports/shots/1-pending-stock.png', fullPage: false });

  await lg.pick('employeeID', 'Ubaid', { search: true });
  await lg.pick('businessUnitID', 'Cochin', { exact: true });
  await lg.settle(1_500);
  const weights = page.locator('text=Weight Details').first();
  if (await weights.count()) await weights.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: 'bug-reports/shots/2-item-panel.png', fullPage: false });

  await page.getByRole('button', { name: 'Add To Lot' }).click();
  await lg.settle(2_500);
  await page.screenshot({ path: 'bug-reports/shots/3-added-to-lot.png', fullPage: true });

  let payload = null;
  page.on('request', (r) => { if (/CreateLotGeneration/.test(r.url())) payload = r.postDataJSON(); });
  const resp = page.waitForResponse((r) => /CreateLotGeneration/.test(r.url()), { timeout: 60_000 }).catch(() => null);
  await lg.submitBtn.click();
  const r = await resp;
  const status = r ? r.status() : 'none';
  const body = r ? (await r.text().catch(() => '')).slice(0, 300) : '';
  console.log(`SUBMIT RESPONSE: ${status} ${body}`);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: 'bug-reports/shots/4-submit-error.png', fullPage: false });
  const toast = await page.locator('.toast, .toast-message, [role=alert]').allTextContents().catch(() => []);
  console.log('TOASTS: ' + JSON.stringify(toast.map((t) => t.trim()).filter(Boolean)));

  if (payload) {
    const d = payload.invLotGenerationMetalDTL && payload.invLotGenerationMetalDTL[0];
    const rows = [
      ['Inward / item', `${inwardNo}  ${d.noOfPcs} pc  ${d.grossWeightTran} g  purity 91.60 (22 Karat Gold)`],
      ['grossWeightTran', d.grossWeightTran],
      ['tunchPercentage', d.tunchPercentage],
      ['wastagePercentage', d.wastagePercentage],
      ['pureWeightTran', d.pureWeightTran],
      ['wastageWeightTran (header)', payload.wastageWeightTran],
      ['wastageWeightTran (item)', d.wastageWeightTran],
      ['makingRate', d.makingRate],
      ['Response', `HTTP ${status}  ${body}`],
    ];
    console.log('PAYLOAD FIELDS: ' + JSON.stringify(rows));
    fs.writeFileSync('bug-reports/shots/lot-create-payload.json', JSON.stringify(payload, null, 2));
    const html = `<html><body style="font-family:Segoe UI,Arial;padding:24px;width:1100px;background:#fff">
      <h3 style="margin:0 0 12px">POST /sioniq/LotGeneration/CreateLotGeneration &mdash; request payload (key fields)</h3>
      <table style="border-collapse:collapse;font-size:15px">${rows.map(([k, v]) => `<tr><td style="border:1px solid #bbb;padding:6px 12px;font-weight:600">${k}</td><td style="border:1px solid #bbb;padding:6px 12px;${/wastage|Response/.test(k) ? 'color:#c00;font-weight:600' : ''}">${v}</td></tr>`).join('')}</table>
      <p style="font-size:13px;color:#555;margin-top:14px">Captured by the automation suite from the browser's network traffic, 21-09-2026. Full payload: bug-reports/shots/lot-create-payload.json</p>
    </body></html>`;
    const p2 = await page.context().newPage();
    await p2.setContent(html);
    await p2.setViewportSize({ width: 1180, height: 520 });
    await p2.screenshot({ path: 'bug-reports/shots/5-request-payload.png', fullPage: true });
    await p2.close();
  }
});
