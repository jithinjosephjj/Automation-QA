const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-invoice-sales-return-estimation-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> RETAIL INVOICE (sells the tag) -> ESTIMATION with
 * Sales Type SALES RETURN against that invoice, SUBMITTED, at Kakkanad.
 * Requested 14-11-2026 ("do sale invoice > estimation (sale return) and create
 * workflow").
 *
 *   TC-ISR-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 2 pcs, 200 g), "Barcode or Lot?" = No
 *   TC-ISR-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-ISR-03  suja:  Barcode Generation for the lot: 1 pc / 50 g with Multi Barcode 2
 *              -> tag A and tag B (one save)
 *   TC-ISR-04  admin (form login): Retail Operations > Invoice (Direct): customer
 *              Aneesh Maradu, scan tag A, Add Item, Cash, Submit (bill no.)
 *   TC-ISR-05  admin (form login): Estimations > Estimation: customer, Retail, Sales
 *              Type SALES RETURN -> Old Bill No = the bill (Old Bill Date back-fills),
 *              Return Item = the bill's item, Sales Executive Chandu, scan tag B ->
 *              Add Item (the exchange item - the form offers no Submit without an
 *              item, 14-11-2026) -> Submit (Estimation/CreateEstimation, EST-nnnn)
 *
 * Numbers chain through e2e-retail-invoice-sales-return-estimation-state.json.
 * MUST run headed (Device Radar gate).
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  inward: {
    subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: VENDOR, purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 2, grossWeightWithTare: 200, rate: 6000 },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: { user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, stockIdentityType: 'Stock', pieces: 1, grossWeight: 50, multiBarcode: 2, descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' }, counter: null },
  customer: { name: process.env.CUSTOMER || 'Aneesh Maradu', mobile: process.env.CUSTOMER_MOBILE || '8547963321' },
  invoice: { salesman: 'Chandu', helper: 'Chandu', metalRate: 6000, payment: { mode: 'Cash' } },
  estimation: { salesType: 'Sales Return', businessType: 'Retail', salesExecutive: 'Chandu' },
};

async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Invoice - Estimation (Sales Return) - Workflow', () => {
  test('TC-ISR-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    await metalInward.open();
    await metalInward.openAddWizard();
    await metalInward.fillBasicDetails({ subTransactionType: DATA.inward.subTransactionType, businessUnit: HEAD_OFFICE, inwardType: DATA.inward.inwardType, purchaseType: DATA.inward.purchaseType, vendor: DATA.inward.vendor, purchaser: DATA.inward.purchaser, invoiceNo: uniqueInvoiceNo() });
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await metalInward.fillItem(DATA.inward.item);
    await metalInward.addItem();
    await metalInward.waitForIdle();
    await metalInward.clickNext();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });
    const saved = await metalInward.submit();
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const inwardVoucherNo = await metalInward.voucherNumber();
    expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, tagB: null, invoiceDocNo: null, estimationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-ISR-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-ISR-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-ISR-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-ISR-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({ stockIdentityType: DATA.barcode.stockIdentityType, vendor: DATA.inward.vendor, lotNo, grossWeight: DATA.barcode.grossWeight, pieces: DATA.barcode.pieces, multiBarcode: DATA.barcode.multiBarcode, additionalCharges: true, descriptions: DATA.barcode.descriptions, counter: DATA.barcode.counter });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const refs = (saved && saved.data && Array.isArray(saved.data.tagReferences)) ? saved.data.tagReferences : [];
    const tags = refs.length ? refs.map((r) => r.tagNo).filter(Boolean) : (barcodeGeneration.lastLotTags || []).slice(-DATA.barcode.multiBarcode);
    expect(tags.length, `two tags from the save (body ${JSON.stringify(saved).slice(0, 300)})`).toBe(2);
    state.writeState({ tagNo: tags[0], tagB: tags[1], tags });
    console.log(`Barcode tags generated: A ${tags[0]} (to sell), B ${tags[1]} (the exchange item)`);
  });

  test('TC-ISR-04 Kakkanad: retail sales invoice (Direct) sells the tag', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-ISR-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const body = await retailInvoice.createDirectInvoice({ customer: DATA.customer.name, mobile: DATA.customer.mobile, salesman: DATA.invoice.salesman, helper: DATA.invoice.helper, tagNo, metalRate: DATA.invoice.metalRate, payment: DATA.invoice.payment });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${DATA.customer.name})`);
  });

  test('TC-ISR-05 Kakkanad: estimation (Sales Type Sales Return) against the invoice - Submit', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { invoiceDocNo, tagNo, tagB } = state.readState();
    expect(invoiceDocNo && tagB, 'run TC-ISR-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const d = DATA.estimation;

    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: DATA.customer.name, mobile: DATA.customer.mobile, businessType: d.businessType });
    expect(await estimationSalesType.pickSalesType(d.salesType)).toMatch(/Sales Return/);
    const controls = await estimationSalesType.revealedControls();
    expect(controls.oldBillNo, 'Old Bill No revealed by Sales Type Sales Return').toBe(true);

    const r = await estimationSalesType.pickupSalesReturnBill(invoiceDocNo);
    expect(r.picked, `bill ${invoiceDocNo} offered as Old Bill No (offered ${JSON.stringify(r.offered.slice(0, 10))}, toasts ${JSON.stringify(r.toasts)})`).toBe(true);
    expect(r.date, 'Old Bill Date back-filled from the invoice').toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(r.items.join(' | '), 'Return Item lists the bill\'s item').toContain(DATA.inward.item.article);
    await estimationSalesType.pick('returnItemID', DATA.inward.item.article, { search: true }).catch(() => estimationSalesType.pickOrFirst('returnItemID', DATA.inward.item.article));
    await estimationSalesType.waitForIdle();
    await estimationSalesType.settle(2_000);
    await estimationSalesType.pick('salesExecutiveID', d.salesExecutive, { search: true });
    await estimationSalesType.settle(1_500);
    console.log(`sales return estimation: return item "${await estimationSalesType.selectValue('returnItemID').catch(() => '')}"`);
    // the exchange item: without a scanned item the form offers no Submit
    const summary = await estimationSalesType.scanAndAddTag(tagB, { applyOffer: true }); // the returned item's value is applied as the offer on the exchange tag
    expect(summary.items, 'No. of Items after Add Item (the exchange tag)').toBeGreaterThanOrEqual(1);

    const body = await estimationSalesType.submitEstimation();
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const estimationNo = OrderEstimationPage.numberOf(body);
    expect(estimationNo, `estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ estimationNo });
    console.log(`Estimation saved: ${estimationNo} (Sales Type Sales Return against bill ${invoiceDocNo} / sold tag ${tagNo}; exchange tag ${tagB})`);
  });
});
