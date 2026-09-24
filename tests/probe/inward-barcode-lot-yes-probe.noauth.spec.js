const { test } = require('../../fixtures/test-fixtures');
const { uniqueInvoiceNo } = require('../../utils/unique');

// PROBE (SAVES an inward and whatever the app creates after it): Metal
// Inward -> Submit -> "Process with Barcode or Lot?" -> YES -> the
// "Lot / Barcode" dialog: list the "Lot or Barcode" options, pick the one
// PROBE_CHOICE matches (default /barcode/i), Submit, and capture every
// screen / dialog / API call that follows for ~45 s.
test('PROBE inward: process with barcode and lot = Yes', async ({ loginPage, metalInward, page, context }) => {
  test.setTimeout(500_000);
  const choice = new RegExp(process.env.PROBE_CHOICE || 'barcode', 'i');
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  page.on('response', async (r) => {
    const url = r.url();
    if (!/Inward|Lot|Barcode|Tag|Print/i.test(url) || /KeepAlive|Translation|GetMasterData|Pagination|Dropdown|\.js|\.css/i.test(url) || !['POST', 'PUT'].includes(r.request().method())) return;
    let body = ''; try { body = (await r.text()).slice(0, 500); } catch { body = '(no body)'; }
    console.log(`API ${r.request().method()} ${r.status()} ${url.replace(/^https?:\/\/[^/]+/, '')} req=${(r.request().postData() || '').slice(0, 200)} res=${body}`);
  });
  context.on('page', (p) => console.log(`POPUP opened: ${p.url()}`));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`NAVIGATED: ${f.url()}`); });

  const describe = async (label) => {
    const info = await page.evaluate(() => {
      const vis = (n) => !!n.offsetParent;
      const captionOf = (n) => { const box = n.closest('.form-group, .col, [class*="col-"], div'); const lab = box && (box.querySelector('label') || box.previousElementSibling); return (lab ? lab.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 40); };
      return {
        url: location.pathname,
        dialogs: [...document.querySelectorAll('.swal2-popup, .modal.show, ngb-modal-window, [role=dialog], .offcanvas.show')].filter(vis).map((d) => d.innerText.replace(/\s+/g, ' ').trim().slice(0, 500)),
        headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(vis).map((h) => h.textContent.trim()).filter((t) => t && t.length < 60 && !/^[\d.,:₹ -]+$/.test(t)).slice(0, 25),
        selects: [...document.querySelectorAll('sioniq-ng-select')].filter(vis).map((n) => `${n.getAttribute('controlname')} [${captionOf(n)}]=${[...n.querySelectorAll('.ng-value')].map((v) => v.textContent.replace(/×/g, '').trim()).join('|') || '(empty)'}`).slice(0, 30),
        inputs: [...document.querySelectorAll('input:not([type=checkbox]):not([role=combobox]), textarea')].filter(vis).filter((i) => !i.closest('ng-select, header')).map((i) => `${i.getAttribute('formcontrolname') || i.id || i.placeholder || i.type} [${captionOf(i)}]=${i.value}${i.disabled ? '(ro)' : ''}`).slice(0, 30),
        buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 30),
        rows: [...document.querySelectorAll('tbody tr')].filter(vis).map((r) => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 160)).slice(0, 5),
        toasts: [...document.querySelectorAll('.toast, .toast-message, [role=alert]')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5),
      };
    });
    console.log(`${label}: ${JSON.stringify(info)}`);
    return info;
  };

  await metalInward.open();
  await metalInward.openAddWizard();
  await metalInward.fillBasicDetails({ subTransactionType: 'Invoice', businessUnit: 'Cochin', inwardType: 'Stock', purchaseType: 'Direct', vendor: 'RAJA', purchaser: 'Abc', invoiceNo: uniqueInvoiceNo() });
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await metalInward.fillItem({ entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 60, rate: 6000 });
  await metalInward.addItem();
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await metalInward.fillPureRateIfEmpty();

  await metalInward.submitBtn.click();
  const confirm = page.locator('.swal2-popup, .modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Barcode or Lot/i }).last();
  await confirm.waitFor({ state: 'visible', timeout: 15_000 });
  await confirm.getByRole('button', { name: /^Yes$/i }).click();
  console.log('answered YES');

  const dlg = page.locator('.modal.show, ngb-modal-window, [role="dialog"]').filter({ hasText: /Lot \/ Barcode|Lot or Barcode/i }).last();
  await dlg.waitFor({ state: 'visible', timeout: 15_000 });
  const host = dlg.locator('sioniq-ng-select[controlname="postInwardProcessType"] ng-select').first();
  await host.locator('.ng-select-container').click();
  await page.waitForTimeout(1_200);
  const opts = (await page.locator('.ng-dropdown-panel .ng-option').allTextContents()).map((t) => t.trim()).filter(Boolean);
  console.log(`Lot or Barcode options: ${JSON.stringify(opts)}`);
  const pick = page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: choice }).first();
  const label = (await pick.count()) ? ((await pick.textContent()) || '').trim() : '';
  if (!label) { console.log('no option matched the choice'); await page.keyboard.press('Escape'); return; }
  await pick.click();
  console.log(`picked "${label}"`);
  await page.waitForTimeout(1_500);
  await describe('dialog after the pick');
  await dlg.getByRole('button', { name: /^Submit$/ }).last().click();
  console.log('dialog Submit clicked');
  for (const wait of [3_000, 5_000, 8_000, 12_000, 15_000]) {
    await page.waitForTimeout(wait);
    await describe(`after dialog Submit +${wait / 1000}s`);
  }
  await page.screenshot({ path: 'test-results/screens/probe-inward-yes-final.png', fullPage: true }).catch(() => {});
});
