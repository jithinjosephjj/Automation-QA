const { test } = require('../../fixtures/test-fixtures');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

// PROBE (SAVES, like the TC-SAL chain): walks Stone Inward (NOT assorted) ->
// Stone Assorting Issue -> Stone Assorting Receipt -> Lot Generation (Stone /
// Stone Assorting Receipt) -> Barcode (as suja) and dumps every screen state a
// test-case workbook needs: option lists, auto-filled / calculated values,
// summary panels, grid columns and rows, dialogs, save responses, list rows.
// Recipe kept UNDER the "Stone Rule" approval limit (Invoice Amount >
// 2,000,000 holds the inward): 4 pcs / 6 g Jerald (the spec's 5 pcs / 10 g
// comes to ~2,260,000 and is held).
test('PROBE stone assorting flow mapping', async ({ loginPage, stoneInward, stoneAssortedWorkflow, lotGeneration, barcodeGeneration, page }) => {
  test.setTimeout(1_200_000);
  const item = { refType: 'Combination', stoneArticle: 'Jerald', entryMode: 'Without Tare', uom: 'Gram', noOfPcs: 4, grossWeight: 6, returnPercent: 5 };
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const saves = [];
  page.on('response', async (r) => {
    if (!['POST', 'PUT'].includes(r.request().method())) return;
    if (!/Create|Save|Generate/i.test(r.url()) || /GetAll|Pagination|KeepAlive|Tax/i.test(r.url())) return;
    const body = await r.json().catch(() => null);
    saves.push(body);
    console.log(`SAVE ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(body).slice(0, 700)}`);
  });
  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
      return {
        selects: [...document.querySelectorAll('sioniq-ng-select, ng-select')].filter(vis).filter((n) => !n.closest('sioniq-ng-select') || n.matches('sioniq-ng-select')).map((n) => { const ng = n.matches('ng-select') ? n : n.querySelector('ng-select'); return `${n.getAttribute('controlname') || n.getAttribute('formcontrolname') || '?'} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${ng?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}${ng?.classList.contains('ng-invalid') ? ' (invalid)' : ''}`; }),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}`),
        checks: [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.offsetParent && !c.closest('table')).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 300)).slice(0, 6),
        summary: (document.querySelector('app-summary, .summary, [class*="summary"]') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim().slice(0, 1400),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 32),
        dialogs: [...document.querySelectorAll('.modal.show, ngb-modal-window, [role=dialog], .offcanvas.show, .swal2-popup')].filter(vis).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 700)),
        toasts: [...document.querySelectorAll('.toast, .toast-message, [role=alert]')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
        tabs: [...document.querySelectorAll('[role=tab]')].filter(vis).map((t) => t.textContent.trim()),
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
  /** Options of the n-th visible RAW ng-select (the assorting forms carry no controlnames). */
  const rawOptions = async (n, label) => {
    const host = page.locator('ng-select').locator('visible=true').nth(n);
    if (!(await host.count())) return [];
    if (await page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await host.locator('.ng-select-container').click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    console.log(`  RAW OPTIONS #${n} ${label}: ${opts.length} -> ${JSON.stringify(opts.slice(0, 25))}`);
    await page.keyboard.press('Escape').catch(() => {});
    return opts;
  };
  const listRow = async (key) => {
    const rows = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    const headers = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
    console.log(`  LIST headers: ${JSON.stringify(headers)}`);
    console.log(`  LIST row(s) for ${key}: ${JSON.stringify(rows.filter((t) => t.toLowerCase().includes(String(key).toLowerCase())).map((t) => t.slice(0, 300)))}`);
  };

  // ================= STONE INWARD (not assorted) =================
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.openAddWizard();
  await dump('INWARD basic (empty)');
  for (const c of ['subTransactionType', 'inwardType', 'purchaseType']) await options(c);
  const invoiceNo = uniqueInvoiceNo().replace(/[^A-Za-z0-9]/g, '');
  await stoneInward.fillBasicDetails({ subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', invoiceNo, invoiceDate: businessDate(0).replace(/-/g, '/') });
  await dump('INWARD basic (filled)');
  await stoneInward.clickNext();
  await stoneInward.waitForIdle();
  await dump('INWARD item (empty)');
  for (const c of ['refType', 'entryMode', 'uom']) await options(c);
  await stoneInward.fillItem(item);
  await dump('INWARD item (filled, before Add Item)');
  await stoneInward.addItem();
  await dump('INWARD after Add Item');
  if (!(await stoneInward.submitBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await stoneInward.clickNext();
    await stoneInward.waitForIdle();
  }
  await dump('INWARD before Submit');
  const inward = await stoneInward.submit();
  const inwardNo = (inward && inward.data && inward.data.receiptNo) || (await stoneInward.voucherNumber().catch(() => ''));
  console.log(`INWARD SAVED: ${inwardNo} (invoice ${invoiceNo})`);
  await stoneInward.closeVisibleDialog();
  await stoneInward.open();
  await stoneInward.selectTab();
  await stoneInward.settle(2_000);
  await listRow(inwardNo);

  // ================= STONE ASSORTING ISSUE =================
  const sa = stoneAssortedWorkflow;
  await sa.openAssortedPage();
  await dump('ASSORT ISSUE list');
  await sa.clickVisibleAdd();
  await dump('ASSORT ISSUE form (empty)');
  await rawOptions(0, 'first select (transaction type?)');
  await sa.pickEmptyRaw('Stone Inward');
  await rawOptions(1, 'second select (vendor?)');
  await sa.pickEmptyRaw('RAJA');
  await sa.waitForIdle();
  await sa.settle(2_500);
  await dump('ASSORT ISSUE after transaction type + vendor');
  await sa.pickByCaption('RC No', sa.docCore(inwardNo), { exact: false, search: true }).catch((e) => console.log('RC No pick skipped -', String(e).slice(0, 100)));
  await sa.waitForIdle();
  await sa.settle(2_500);
  await dump('ASSORT ISSUE after RC No');
  await sa.checkRow(inwardNo).catch(() => sa.checkRow(sa.docCore(inwardNo)));
  await dump('ASSORT ISSUE inward row ticked');
  await sa.pickEmptyRaw(/Sioniquser/i, { search: 'Sion' });
  await dump('ASSORT ISSUE assorter picked');
  const add = page.locator('button').filter({ hasText: /Add\s*$/ }).locator('visible=true').last();
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await sa.settle(2_000);
  await dump('ASSORT ISSUE after Add (dialog?)');
  await sa.closeThenNext({ next: true });
  await dump('ASSORT ISSUE review step');
  const issue = await sa.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  const issueNo = (issue && issue.data && (issue.data.receiptNo || issue.data.docNo)) || '';
  console.log(`ASSORT ISSUE SAVED: ${issueNo}`);
  await dump('ASSORT ISSUE after save');
  await sa.previewAndClose();
  await sa.openAssortedPage();
  await listRow(sa.docCore(issueNo));

  // ================= STONE ASSORTING RECEIPT =================
  await sa.openAssortedPage('Receipt');
  await dump('ASSORT RECEIPT list');
  await sa.clickVisibleAdd();
  await dump('ASSORT RECEIPT form (empty)');
  await rawOptions(0, 'first select (employee?)');
  await sa.pickEmptyRaw(/Sioniquser/i, { search: 'Sion' });
  await sa.waitForIdle();
  await sa.settle(2_500);
  await dump('ASSORT RECEIPT after employee');
  await sa.checkRow(sa.docCore(issueNo));
  await dump('ASSORT RECEIPT issue row ticked');
  const addItems = page.locator('button').filter({ hasText: /Add Items\s*$/ }).locator('visible=true').last();
  await addItems.scrollIntoViewIfNeeded();
  await addItems.click();
  await sa.settle(2_000);
  await dump('ASSORT RECEIPT after Add Items (dialog?)');
  await sa.closeThenNext({ next: false });
  await dump('ASSORT RECEIPT before Submit');
  const receipt = await sa.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  const receiptNo = (receipt && receipt.data && (receipt.data.receiptNo || receipt.data.docNo)) || '';
  console.log(`ASSORT RECEIPT SAVED: ${receiptNo}`);
  await sa.previewAndClose();
  await sa.openAssortedPage('Receipt');
  await listRow(sa.docCore(receiptNo));

  // ================= LOT GENERATION (read the form, then the page object saves) =================
  await lotGeneration.open();
  await lotGeneration.waitForSpinner();
  await lotGeneration.addBtn.click({ timeout: 60_000 });
  await lotGeneration.settle(2_000);
  await dump('LOT form (empty)');
  for (const c of ['masterDataValueID_JewelleryItemType']) await options(c);
  await lotGeneration.pick('masterDataValueID_JewelleryItemType', 'Stone', { exact: true });
  await options('masterDataValueID_StockSourceType');
  await lotGeneration.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await options('fromTransactionTypeID');
  await lotGeneration.pick('fromTransactionTypeID', 'Stone Assorting Receipt', { exact: true });
  await lotGeneration.waitForIdle();
  await lotGeneration.settle(2_500);
  await dump('LOT after Stone / Inward / Stone Assorting Receipt');
  const lotNo = await lotGeneration.generateLot({ itemType: 'Stone', transactionType: 'Stone Assorting Receipt', vendor: 'RAJA', inwardNo: sa.docCore(receiptNo), employee: 'Ubaid', businessUnit: 'Cochin' });
  console.log(`LOT SAVED: ${lotNo}`);
  await lotGeneration.open();
  await lotGeneration.settle(2_000);
  await listRow(lotNo);

  // ================= BARCODE (as suja) =================
  await loginPage.ensureLoggedIn({ user: 'suja', pwd: '123', bu: 'Cochin' });
  await barcodeGeneration.open();
  await barcodeGeneration.waitForSpinner();
  await barcodeGeneration.addBtn.click({ timeout: 60_000 });
  await barcodeGeneration.settle(2_000);
  await dump('BARCODE form (empty)');
  for (const c of ['masterDataValueID_JewelleryItemType', 'masterDataValueID_StockIdentityType']) await options(c);
  await barcodeGeneration.pick('masterDataValueID_JewelleryItemType', 'Stone', { exact: true });
  await barcodeGeneration.pick('masterDataValueID_StockIdentityType', 'Stock', { exact: true });
  await barcodeGeneration.pick('vendorID', 'RAJA');
  await barcodeGeneration.pick('lotGenerationID', lotNo, { exact: true });
  await barcodeGeneration.waitForIdle();
  await barcodeGeneration.settle(2_500);
  await dump('BARCODE after lot pick');
  const tag = await barcodeGeneration.generateTag({ itemType: 'Stone', stockIdentityType: 'Stock', vendor: 'RAJA', lotNo, grossWeight: 6, descriptions: {} });
  console.log(`BARCODE SAVED: ${JSON.stringify(tag && tag.data)}`);
  const tagNo = await barcodeGeneration.verifyGeneratedTag('Jerald').catch(() => '');
  console.log(`BARCODE TAG: ${tagNo}`);
  console.log(`CHAIN: inward ${inwardNo} / issue ${issueNo} / receipt ${receiptNo} / lot ${lotNo} / tag ${tagNo}`);
});
