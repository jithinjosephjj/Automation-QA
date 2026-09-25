const { test } = require('../../fixtures/test-fixtures');
const { businessDate, uniqueInvoiceNo } = require('../../utils/unique');

// PROBE (SAVES, like the TC-HLM chain): walks Metal Inward -> Hallmark Issue
// -> Hallmark Receipt with the chain's data and dumps every screen state a
// test-case workbook needs: option lists, auto-filled / calculated values,
// summary panels, grid columns and rows, dialogs, save responses.
test('PROBE hallmark flow mapping', async ({ loginPage, metalInward, hallmarkWorkflow, page }) => {
  test.setTimeout(900_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const saves = [];
  page.on('response', async (r) => {
    if (!['POST', 'PUT'].includes(r.request().method())) return;
    if (!/Create|Save/i.test(r.url()) || /GetAll|Pagination|KeepAlive|Tax/i.test(r.url())) return;
    const body = await r.json().catch(() => null);
    saves.push({ url: r.url().split('/').slice(-2).join('/'), status: r.status(), body });
    console.log(`SAVE ${r.status()} ${r.url().split('/').slice(-2).join('/')} ${JSON.stringify(body).slice(0, 400)}`);
  });

  const dump = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const cap = (n) => { const b = n.closest('.form-group, .col, [class*="col-"], div'); const l = b && (b.querySelector('label') || b.previousElementSibling); return (l ? l.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
      return {
        selects: [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')} [${cap(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}${n.querySelector('ng-select')?.classList.contains('ng-select-disabled') ? ' (ro)' : ''}`),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header, .topbar')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${cap(i)}]=${i.value}${i.disabled || i.readOnly ? ' (ro)' : ''}`),
        checks: [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.offsetParent && !c.closest('table')).map((c) => `${(c.closest('label') || c.parentElement)?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}=${c.checked}`),
        headers: [...document.querySelectorAll('th')].filter(vis).map((h) => h.textContent.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 260)).slice(0, 6),
        summary: (document.querySelector('app-summary, .summary, [class*="summary"]') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim().slice(0, 1200),
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

  // ================= METAL INWARD =================
  await metalInward.open();
  await metalInward.openAddWizard();
  await dump('INWARD basic (empty)');
  for (const c of ['subTransactionType', 'inwardType', 'purchaseType']) await options(c);
  await metalInward.fillBasicDetails({ subTransactionType: 'Invoice', businessUnit: 'Cochin', inwardType: 'Stock', purchaseType: 'Direct', vendor: 'Luxurio', purchaser: 'Abc', invoiceNo: uniqueInvoiceNo() });
  await dump('INWARD basic (filled)');
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await dump('INWARD item (empty)');
  for (const c of ['entryMode', 'referenceType', 'purity', 'makingType']) await options(c);
  await metalInward.fillItem({ entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 10, rate: 6000 });
  await dump('INWARD item (filled, before Add Item)');
  await metalInward.addItem();
  await dump('INWARD after Add Item');
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await dump('INWARD review');
  const inward = await metalInward.submit();
  const inwardNo = (inward && inward.data && inward.data.receiptNo) || (await metalInward.voucherNumber().catch(() => ''));
  console.log(`INWARD SAVED: ${inwardNo}`);
  await dump('INWARD after save (print dialog)');
  await metalInward.closeVisibleDialog();

  // ================= HALLMARK ISSUE =================
  await hallmarkWorkflow.openHallmarkTab('/inv/app-issue-list');
  await dump('ISSUE list');
  await hallmarkWorkflow.clickVisibleAdd();
  await dump('ISSUE form (empty)');
  await options('hallmarkVendorID');
  await hallmarkWorkflow.pick('hallmarkVendorID', 'Luxurio', { exact: true });
  await options('masterDataValueID_StockSourceType');
  await hallmarkWorkflow.pick('masterDataValueID_StockSourceType', 'Inward', { exact: true });
  await hallmarkWorkflow.settle(1_500);
  const after = await dump('ISSUE after Stock Source = Inward');
  for (const s of after.selects) { const c = s.split(' ')[0]; if (!/hallmarkVendorID|StockSourceType/.test(c)) await options(c); }
  await hallmarkWorkflow.fillEmptySelects(['Metal Inward']);
  await hallmarkWorkflow.waitForIdle();
  await hallmarkWorkflow.settle(2_500);
  await dump('ISSUE grid loaded');
  await hallmarkWorkflow.checkRow(inwardNo);
  await dump('ISSUE row ticked');
  const add = page.locator('button').filter({ hasText: /Add/ }).filter({ hasNotText: /Files|Image|Charges|Certification/ }).locator('visible=true').last();
  console.log(`ISSUE add button text: ${(await add.textContent().catch(() => '')).trim()}`);
  await add.click();
  await hallmarkWorkflow.settle(2_000);
  await dump('ISSUE after Add');
  const issue = await hallmarkWorkflow.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  const issueNo = (issue && issue.data && (issue.data.receiptNo || issue.data.docNo)) || '';
  console.log(`ISSUE SAVED: ${issueNo}`);
  await dump('ISSUE after save');
  await hallmarkWorkflow.previewAndClose();
  await hallmarkWorkflow.openHallmarkTab('/inv/app-issue-list');
  const issueList = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.includes(issueNo));
  console.log(`ISSUE LIST ROW: ${JSON.stringify(issueList.map((t) => t.slice(0, 260)))}`);

  // ================= HALLMARK RECEIPT =================
  await hallmarkWorkflow.openHallmarkTab('/inv/app-receipt-list');
  await dump('RECEIPT list');
  await hallmarkWorkflow.clickVisibleAdd();
  await dump('RECEIPT form (empty)');
  await options('hallmarkVendorID');
  await hallmarkWorkflow.pick('hallmarkVendorID', 'Luxurio', { exact: true });
  await page.getByPlaceholder('Enter Invoice Number').fill(uniqueInvoiceNo());
  const dd = page.locator('#invoiceDate');
  await dd.fill(businessDate(0).replace(/-/g, '/'));
  await dd.blur();
  await page.keyboard.press('Escape');
  await hallmarkWorkflow.settle(1_500);
  const rc = await dump('RECEIPT header filled');
  for (const s of rc.selects) { const c = s.split(' ')[0]; if (!/hallmarkVendorID/.test(c)) await options(c); }
  // run the page object's receipt from here would re-open the form - finish by hand the same way
  const rst = page.locator('label:text-is("Receipt Selection Type")').last().locator('xpath=following::ng-select[1]');
  if (await rst.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await rst.locator('.ng-select-container').click();
    const rcOpt = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: /RC/i }).first();
    await rcOpt.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await rcOpt.click().catch(() => {});
    await hallmarkWorkflow.settle(2_000);
  }
  await hallmarkWorkflow.pickByLabel('Issue Stock Source Type', 'Inward', { exact: true }).catch(() => hallmarkWorkflow.fillEmptySelects(['Inward']));
  await hallmarkWorkflow.waitForIdle();
  await hallmarkWorkflow.settle(2_500);
  const rcAfter = await dump('RECEIPT after selection type / source');
  for (const s of rcAfter.selects) { const c = s.split(' ')[0]; if (/rc|issue|receipt/i.test(c) && s.includes('(empty)')) await options(c); }
  await hallmarkWorkflow.checkRow(issueNo);
  await dump('RECEIPT issue row ticked');
  const itemRow = hallmarkWorkflow.rowMatcher(issueNo).nth(1);
  if (await itemRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
    const box = itemRow.getByRole('checkbox').first();
    if (!(await box.isChecked({ timeout: 2_000 }).catch(() => false))) await box.check({ force: true });
    await hallmarkWorkflow.settle(1_500);
    await dump('RECEIPT item row ticked (details overlay?)');
    const details = page.locator('.offcanvas, .modal, ngb-modal-window, [role="dialog"]').filter({ hasText: /Details/ }).last();
    if (await details.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await details.getByRole('button', { name: 'Submit' }).last().click();
      await details.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      await hallmarkWorkflow.settle(1_500);
    }
  }
  const radd = page.locator('button').filter({ hasText: /Add/ }).filter({ hasNotText: /Files|Image|Certification|Item|Charges/ }).locator('visible=true').last();
  if (await radd.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log(`RECEIPT add button text: ${(await radd.textContent().catch(() => '')).trim()}`);
    await radd.click();
    await hallmarkWorkflow.settle(2_000);
  }
  await dump('RECEIPT after Add');
  const receipt = await hallmarkWorkflow.clickAndCaptureSave(page.getByRole('button', { name: 'Submit' }).locator('visible=true').last());
  console.log(`RECEIPT SAVED: ${(receipt && receipt.data && (receipt.data.receiptNo || receipt.data.docNo)) || '(no number)'}`);
  await dump('RECEIPT after save');
  await hallmarkWorkflow.previewAndClose();
  await hallmarkWorkflow.openHallmarkTab('/inv/app-receipt-list');
  const rcList = (await page.locator('tbody tr').locator('visible=true').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 2);
  console.log(`RECEIPT LIST TOP ROWS: ${JSON.stringify(rcList.map((t) => t.slice(0, 260)))}`);
  const rcHeaders = (await page.locator('th').locator('visible=true').allInnerTexts()).map((h) => h.replace(/ Sort Ascending.*$/, '').trim()).filter(Boolean);
  console.log(`RECEIPT LIST HEADERS: ${JSON.stringify(rcHeaders)}`);
});
