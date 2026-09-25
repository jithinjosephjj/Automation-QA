const { test } = require('../../fixtures/test-fixtures');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

// PROBE (SAVES, like the TC-CRT chain): walks Stone Inward -> Certification
// Issue -> Certification Receipt and dumps every screen state a test-case
// workbook needs: option lists, auto-filled / calculated values, summary
// panels, grid columns and rows, dialogs, save responses and list rows.
// Recipe kept UNDER the "Stone Rule" approval limit (Invoice Amount >
// 2,000,000 holds the inward for approval): 4 pcs / 6 g Jerald.
test('PROBE certification flow mapping', async ({ loginPage, stoneInward, certificationWorkflow, page }) => {
  test.setTimeout(900_000);
  const item = { refType: 'Combination', stoneArticle: 'Jerald', entryMode: 'Without Tare', uom: 'Gram', noOfPcs: 4, grossWeight: 6, discountPercent: 7, returnPercent: 6, assortedStock: true };
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    if (!['POST', 'PUT'].includes(r.request().method())) return;
    if (!/Create|Save/i.test(r.url()) || /GetAll|Pagination|KeepAlive|Tax/i.test(r.url())) return;
    const body = await r.json().catch(() => null);
    console.log(`SAVE ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(body).slice(0, 500)}`);
  });
  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
      return {
        selects: [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${ng?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}`; }),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}`),
        checks: [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.offsetParent && !c.closest('table')).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)).slice(0, 6),
        summary: (document.querySelector('app-summary, .summary, [class*="summary"]') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim().slice(0, 1400),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 32),
        dialogs: [...document.querySelectorAll('.modal.show, ngb-modal-window, [role=dialog], .offcanvas.show, .swal2-popup')].filter(vis).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 600)),
        toasts: [...document.querySelectorAll('.toast, .toast-message, [role=alert]')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
      };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };
  const options = async (ctl) => {
    const host = page.locator(`sioniq-ng-select[controlname="${ctl}"] ng-select`).first();
    if (!(await host.count())) { console.log(`  OPTIONS ${ctl}: (absent)`); return []; }
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  OPTIONS ${ctl}: ${opts.length} -> ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  const listRow = async (key) => {
    const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    const headers = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
    console.log(`  LIST headers: ${JSON.stringify(headers)}`);
    console.log(`  LIST row(s) for ${key}: ${JSON.stringify(rows.filter((t) => t.toLowerCase().includes(String(key).toLowerCase())).map((t) => t.slice(0, 300)))}`);
  };

  // ================= STONE INWARD =================
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.openAddWizard();
  await dump('INWARD basic (empty)');
  for (const c of ['inwardType', 'purchaseType']) await options(c);
  const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, '');
  await stoneInward.fillBasicDetails({ inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', invoiceNo, invoiceDate: businessDate(0).replace(/-/g, '/') });
  await dump('INWARD basic (filled)');
  await stoneInward.nextBtn.click();
  await stoneInward.waitForIdle();
  await dump('INWARD item (empty)');
  for (const c of ['refType', 'entryMode', 'uom']) await options(c);
  await stoneInward.fillItem(item);
  await dump('INWARD item (filled, before Add Item)');
  await stoneInward.addItem();
  await dump('INWARD after Add Item');
  if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await stoneInward.nextBtn.click();
    await stoneInward.waitForIdle();
  }
  await dump('INWARD before Submit');
  const inward = await stoneInward.submit();
  const inwardNo = (inward && inward.data && inward.data.receiptNo) || (await stoneInward.voucherNumber().catch(() => ''));
  console.log(`INWARD SAVED: ${inwardNo} (invoice ${invoiceNo})`);
  await dump('INWARD after save');
  await stoneInward.closeVisibleDialog();
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.settle(2_000);
  await listRow(inwardNo);

  // ================= CERTIFICATION ISSUE =================
  await certificationWorkflow.openCertificationTab('/inv/app-issue-list');
  await dump('ISSUE list');
  await certificationWorkflow.clickVisibleAdd();
  await dump('ISSUE form (empty)');
  await options('masterDataValueID_JewelleryItemType');
  await certificationWorkflow.pick('masterDataValueID_JewelleryItemType', 'Stone');
  await certificationWorkflow.settle(1_200);
  await options('certificationVendorID');
  await certificationWorkflow.pick('certificationVendorID', 'ram');
  await options('masterDataValueID_StockSourceType');
  await certificationWorkflow.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await certificationWorkflow.settle(1_500);
  const after = await dump('ISSUE after Stock Source = Inward');
  for (const s of after.selects) { const c = s.split(' ')[0]; if (!/JewelleryItemType|certificationVendorID|StockSourceType/.test(c)) await options(c); }
  await certificationWorkflow.fillEmptySelects(['Stone Inward']);
  await certificationWorkflow.waitForIdle();
  await certificationWorkflow.settle(2_500);
  await dump('ISSUE grid loaded');
  await certificationWorkflow.checkRow(inwardNo);
  await dump('ISSUE row ticked');
  const add = page.locator('button').filter({ hasText: /Add/ }).filter({ hasNotText: /Files|Image|Charges|Certification/ }).locator('visible=true').last();
  console.log(`ISSUE add button text: ${(await add.textContent().catch(() => '')).trim()}`);
  await add.click();
  await certificationWorkflow.settle(2_000);
  await dump('ISSUE after Add');
  const issue = await certificationWorkflow.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  const issueNo = (issue && issue.data && (issue.data.receiptNo || issue.data.docNo)) || '';
  console.log(`ISSUE SAVED: ${issueNo}`);
  await dump('ISSUE after save');
  await certificationWorkflow.previewAndClose();
  await certificationWorkflow.openCertificationTab('/inv/app-issue-list');
  await listRow(issueNo);

  // ================= CERTIFICATION RECEIPT =================
  await certificationWorkflow.openCertificationTab('/inv/app-receipt-list');
  await dump('RECEIPT list');
  await certificationWorkflow.clickVisibleAdd();
  await dump('RECEIPT form (empty)');
  await options('masterDataValueID_JewelleryItemType');
  await certificationWorkflow.pick('masterDataValueID_JewelleryItemType', 'Stone');
  await certificationWorkflow.settle(1_200);
  await options('certificationVendorID');
  await certificationWorkflow.pick('certificationVendorID', 'ram');
  await certificationWorkflow.settle(1_500);
  const rh = await dump('RECEIPT after vendor');
  for (const s of rh.selects) { const c = s.split(' ')[0]; if (!/JewelleryItemType|certificationVendorID/.test(c)) await options(c); }
  const rst = page.locator('label:text-is("Receipt Selection Type")').last().locator('xpath=following::ng-select[1]');
  if (await rst.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await rst.locator('.ng-select-container').click();
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim());
    console.log(`  OPTIONS Receipt Selection Type: ${opts.length} -> ${JSON.stringify(opts)}`);
    await page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /RC/i }).first().click().catch(() => {});
    await certificationWorkflow.settle(2_000);
  }
  await page.getByPlaceholder('Enter Invoice Number').fill(uniqueInvoiceNo());
  const dd = page.locator('#invoiceDate');
  await dd.fill(businessDate(0).replace(/-/g, '/'));
  await dd.blur();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Receipt Configuration' }).click({ timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await dump('RECEIPT header filled');
  const src = page.locator('xpath=//*[normalize-space(text())="Issue Stock Source Type"]/following::ng-select[1]').last();
  await src.locator('.ng-select-container').click().catch(() => {});
  await page.waitForTimeout(1_200);
  console.log(`  OPTIONS Issue Stock Source Type: ${JSON.stringify((await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()))}`);
  await page.keyboard.press('Escape').catch(() => {});
  await certificationWorkflow.pickByCaption('Issue Stock Source Type', 'Inward');
  await certificationWorkflow.waitForIdle();
  await certificationWorkflow.settle(2_500);
  await dump('RECEIPT after Issue Stock Source = Inward');
  await certificationWorkflow.checkRow(issueNo);
  await dump('RECEIPT issue row ticked');
  const itemRow = certificationWorkflow.rowMatcher(issueNo).nth(1);
  if (await itemRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
    const box = itemRow.getByRole('checkbox').first();
    if (!(await box.isChecked({ timeout: 2_000 }).catch(() => false))) await box.check({ force: true });
    await certificationWorkflow.settle(1_500);
    await dump('RECEIPT item row ticked (details overlay?)');
    const details = page.locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]').filter({ hasText: /Details/ }).last();
    if (await details.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await details.getByRole('button', { name: 'Submit' }).last().click();
      await details.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      await certificationWorkflow.settle(1_500);
    }
  }
  const radd = page.locator('button').filter({ hasText: /Add/ }).filter({ hasNotText: /Files|Image|Certification|Item|Charges/ }).locator('visible=true').last();
  if (await radd.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log(`RECEIPT add button text: ${(await radd.textContent().catch(() => '')).trim()}`);
    await radd.click();
    await certificationWorkflow.settle(2_000);
  }
  await dump('RECEIPT after Add');
  const receipt = await certificationWorkflow.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  const receiptNo = (receipt && receipt.data && (receipt.data.receiptNo || receipt.data.docNo)) || '';
  console.log(`RECEIPT SAVED: ${receiptNo || '(no number)'}`);
  await dump('RECEIPT after save');
  await certificationWorkflow.previewAndClose();
  await certificationWorkflow.openCertificationTab('/inv/app-receipt-list');
  await listRow(receiptNo || issueNo);
});
