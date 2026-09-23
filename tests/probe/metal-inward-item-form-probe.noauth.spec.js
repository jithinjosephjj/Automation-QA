const { test } = require('../../fixtures/test-fixtures');
const { uniqueInvoiceNo } = require('../../utils/unique');

// PROBE (nothing saved): the Metal Inward ITEM form after tonight's app
// change (no Rate field): labels, invalid controls, toasts before and after
// Add Item, and the summary counters.
test('PROBE metal inward item form', async ({ loginPage, metalInward, page }) => {
  test.setTimeout(300_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  await metalInward.open();
  await metalInward.openAddWizard();
  await metalInward.fillBasicDetails({ subTransactionType: 'Invoice', businessUnit: 'Cochin', inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', purchaser: 'Abc', invoiceNo: uniqueInvoiceNo() });
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const labels = [...document.querySelectorAll('label')].filter(vis).map((l) => l.textContent.replace(/[ \t\n]+/g, ' ').trim()).filter(Boolean);
      const invalidSelects = [...document.querySelectorAll('sioniq-ng-select')].filter(vis).filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid')).map((n) => n.getAttribute('controlname'));
      const invalidInputs = [...document.querySelectorAll('input.ng-invalid, textarea.ng-invalid')].filter(vis).map((i) => (i.closest('div')?.querySelector('label')?.textContent || i.id || i.placeholder || i.type).trim().slice(0, 40));
      const inputs = [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox])')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${(i.closest('div')?.querySelector('label')?.textContent || i.id || i.placeholder || i.type).trim().slice(0, 30)}=${i.value}${i.disabled ? '(ro)' : ''}`);
      const toasts = [...document.querySelectorAll('.toast, .toast-message, [role=alert], .invalid-feedback, .text-danger')].filter(vis).map((t) => t.textContent.replace(/[ \t\n]+/g, ' ').trim()).filter(Boolean).slice(0, 8);
      const summary = (document.body.innerText.match(/No\. of Pieces\s*:\s*\d+/) || [''])[0];
      const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/[ \t\n]+/g, ' ').trim()).filter((t) => t && t.length < 30);
      return { labels: labels.slice(0, 60), invalidSelects, invalidInputs, inputs: inputs.slice(0, 40), toasts, summary, buttons };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
  };
  await describe('ITEM FORM (empty)');
  await metalInward.fillItem({ entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 60 });
  await describe('ITEM FORM (filled)');
  await metalInward.addItemBtn.click().catch((e) => console.log('Add Item click: ' + String(e).split('\n')[0]));
  await page.waitForTimeout(4_000);
  await describe('after Add Item');
});
