const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-inward-yes-state.json');

/**
 * METAL INWARD - "PROCESS WITH BARCODE OR LOT?" = YES (UI change 24-09-2026).
 *
 * Submit on Metal Inward now asks "Process with Barcode or Lot?". Answering
 * YES opens the "Lot / Barcode" dialog whose "Lot or Barcode" select offers
 * two post-processes that run together with the inward save:
 *
 *   TC-MIY-01  Metal Inward -> Yes -> LOT      Lot Employee picked; Submit saves the inward and generates its lot
 *   TC-MIY-02  Metal Inward -> Yes -> BARCODE  one tag card per piece (Employee = login user, weight prefilled);
 *                                              Submit saves the inward, an auto-generated lot and its tag(s)
 *
 * Each test is a standalone inward (Stock / Direct / Invoice, RAJA, 1 pc
 * Tendulkar 91.60, 60 g) and records what the dialog's Submit created in
 * e2e-inward-yes-state.json. The other Metal Inward chains keep answering
 * No (lot and barcode as separate steps).
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const BU = 'Cochin';

const DATA = {
  inward: {
    subTransactionType: 'Invoice',
    inwardType: 'Stock',
    purchaseType: 'Direct',
    vendor: 'RAJA',
    purchaser: 'Abc',
    item: {
      entryMode: 'SINGLE TAG',
      referenceType: 'Combination',
      article: 'Tendulkar',
      purity: '91.60',
      noOfPcs: 1,
      grossWeightWithTare: 60,
      rate: 6000, // per-item rate (gone since 23-09; the pure rate 15000 is entered after Add Item)
    },
  },
  lotEmployee: 'Ubaid',
};

async function createInwardUpToSubmit(loginPage, metalInward) {
  await loginPage.ensureLoggedIn({ bu: BU });
  await metalInward.open();
  await metalInward.openAddWizard();
  await metalInward.fillBasicDetails({
    subTransactionType: DATA.inward.subTransactionType,
    businessUnit: BU,
    inwardType: DATA.inward.inwardType,
    purchaseType: DATA.inward.purchaseType,
    vendor: DATA.inward.vendor,
    purchaser: DATA.inward.purchaser,
    invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
  });
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await metalInward.fillItem(DATA.inward.item);
  await metalInward.addItem(); // verified Add Item: mandatory description selects, the pure rate after the add
  await metalInward.nextBtn.click();
  await metalInward.waitForIdle();
  await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
}

/** Every document number the saves carry anywhere: the inward M###, lots NNN##, tags 2026-06-23000##. */
function numbersIn(bodies) {
  const text = JSON.stringify(bodies || []);
  const uniq = (list) => [...new Set(list.map((m) => m.replace(/"/g, '')))];
  return {
    inward: (text.match(/"receiptNo":"(M\d+)"/) || [])[1] || '',
    lots: uniq(text.match(/"(N{2,}\d+)"/g) || []),
    tags: uniq(text.match(/"(\d{4}-\d{2}-\d{2}\d{3,})"/g) || []),
  };
}

test.describe('Metal Inward - Process with Barcode or Lot = Yes', () => {
  test('TC-MIY-01 metal inward, Yes -> Lot: the inward and its lot are saved together', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    await createInwardUpToSubmit(loginPage, metalInward);

    const result = await metalInward.submitWithPostProcess({ mode: 'Lot', lotEmployee: DATA.lotEmployee });
    expect(JSON.stringify(result.inward)).toMatch(/success/i);
    console.log(`inward save body: ${JSON.stringify(result.inward).slice(0, 1500)}`);
    const found = numbersIn(result.all.map((x) => x.body));
    expect(found.inward, 'inward voucher number').toBeTruthy();
    console.log(`Inward ${found.inward} saved with Yes -> Lot; numbers in the saves: ${JSON.stringify(found)}`);
    expect(found.lots[0], `a lot must be generated with the inward (saves: ${JSON.stringify(result.all.map((x) => x.url))})`).toBeTruthy();
    state.writeState({ lotFlow: { inwardVoucherNo: found.inward, lotNo: found.lots[0], at: new Date().toISOString() } });
    console.log(`Lot generated with the inward: ${found.lots[0]}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-MIY-02 metal inward, Yes -> Barcode: the inward and its tag are saved together', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    await createInwardUpToSubmit(loginPage, metalInward);

    const result = await metalInward.submitWithPostProcess({ mode: 'Barcode' });
    expect(JSON.stringify(result.inward)).toMatch(/success/i);
    console.log(`inward save body: ${JSON.stringify(result.inward).slice(0, 1500)}`);
    const found = numbersIn(result.all.map((x) => x.body));
    expect(found.inward, 'inward voucher number').toBeTruthy();
    console.log(`Inward ${found.inward} saved with Yes -> Barcode; numbers in the saves: ${JSON.stringify(found)}`);
    expect(found.tags[0], `a tag must be generated with the inward (saves: ${JSON.stringify(result.all.map((x) => x.url))})`).toBeTruthy();
    state.writeState({ barcodeFlow: { inwardVoucherNo: found.inward, tagNo: found.tags[0], at: new Date().toISOString() } });
    console.log(`Tag generated with the inward: ${found.tags[0]}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });
});
