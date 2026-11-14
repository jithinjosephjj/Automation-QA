const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-sales-return-estimation-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> RETAIL INVOICE (sells the tag) -> SALES RETURN
 * ESTIMATION at Kakkanad. The Sales Return Estimation is its own flow (user
 * 14-11-2026: "sales return estimation and sales return registration is a
 * separate flow") - the registration has its own chain
 * (retail-tag-invoice-sales-return-registration-direct-workflow).
 *
 *   TC-SRE-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), "Barcode or Lot?" = No
 *   TC-SRE-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-SRE-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges)
 *   TC-SRE-04  admin (form login): Retail Operations > Invoice (Direct): customer
 *              Aneesh Maradu, scan the tag, Add Item, Cash, Submit (bill no.)
 *   TC-SRE-05  admin (form login): Estimations > Estimation, Sales Type Sales Return:
 *              Old Bill No offers the bill (date + Return Item back-fill) - verify only
 *   TC-SRE-06  admin (form login): Estimations > Sales Return Estimation: Retail,
 *              Salesman code AJ10 (Ajin G), Helper Chandu, Metal, BillWise, the bill ->
 *              item -> Add Item -> Sales Return Entries -> Submit (SR estimation no.)
 *
 * Numbers chain through e2e-retail-sales-return-estimation-state.json. MUST run
 * headed (Device Radar gate).
 */

const HEAD_OFFICE = 'Kakkanad';
const VENDOR = process.env.VENDOR || 'RAJA';

const DATA = {
  inward: {
    subTransactionType: 'Invoice', inwardType: 'Stock', purchaseType: 'Direct', vendor: VENDOR, purchaser: 'Abc',
    item: { entryMode: 'SINGLE TAG', referenceType: 'Combination', article: 'Tendulkar', purity: '91.60', noOfPcs: 1, grossWeightWithTare: 100, rate: 6000 },
  },
  lot: { employee: 'Ubaid', location: HEAD_OFFICE, businessUnit: HEAD_OFFICE },
  barcode: { user: { user: 'suja', pwd: '123', bu: HEAD_OFFICE }, stockIdentityType: 'Stock', grossWeight: 50, descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' }, counter: null },
  customer: { name: process.env.CUSTOMER || 'Aneesh Maradu', mobile: process.env.CUSTOMER_MOBILE || '8547963321' },
  invoice: { salesman: 'Chandu', helper: 'Chandu', metalRate: 6000, payment: { mode: 'Cash' } },
  salesReturnEstimation: { businessType: 'Retail', salesmanCode: process.env.SALESMAN_CODE || 'AJ10', helper: 'Chandu', itemType: 'Metal', returnType: 'BillWise' },
};

async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Invoice - Sales Return Estimation - Workflow', () => {
  test('TC-SRE-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
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
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, invoiceDocNo: null, srEstimationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-SRE-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SRE-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-SRE-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-SRE-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({ stockIdentityType: DATA.barcode.stockIdentityType, vendor: DATA.inward.vendor, lotNo, grossWeight: DATA.barcode.grossWeight, pieces: 1, additionalCharges: true, descriptions: DATA.barcode.descriptions, counter: DATA.barcode.counter });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-SRE-04 Kakkanad: retail sales invoice (Direct) sells the tag', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-SRE-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const body = await retailInvoice.createDirectInvoice({ customer: DATA.customer.name, mobile: DATA.customer.mobile, salesman: DATA.invoice.salesman, helper: DATA.invoice.helper, tagNo, metalRate: DATA.invoice.metalRate, payment: DATA.invoice.payment });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${DATA.customer.name})`);
  });

  test('TC-SRE-05 Kakkanad: estimation (Sales Type Sales Return) picks up the bill', async ({ loginPage, estimationSalesType, page }) => {
    test.setTimeout(600_000);
    const { invoiceDocNo } = state.readState();
    expect(invoiceDocNo, 'run TC-SRE-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    await estimationSalesType.openForm();
    await estimationSalesType.setCustomer({ name: DATA.customer.name, mobile: DATA.customer.mobile, businessType: 'Retail' });
    expect(await estimationSalesType.pickSalesType('Sales Return')).toMatch(/Sales Return/);
    const r = await estimationSalesType.pickupSalesReturnBill(invoiceDocNo);
    expect(r.picked, `bill ${invoiceDocNo} offered as Old Bill No (offered ${JSON.stringify(r.offered.slice(0, 10))}, toasts ${JSON.stringify(r.toasts)})`).toBe(true);
    expect(r.date, 'Old Bill Date back-filled from the invoice').toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(r.items.join(' | '), 'Return Item lists the bill\'s item').toContain(DATA.inward.item.article);
    state.writeState({ pickup: { date: r.date, items: r.items } });
    console.log(`Sales Return pick-up verified: bill ${invoiceDocNo}, date ${r.date}, items ${JSON.stringify(r.items)} - nothing saved`);
  });

  test('TC-SRE-06 Kakkanad: sales return estimation (BillWise) for the bill', async ({ loginPage, salesReturn, page }) => {
    test.setTimeout(600_000);
    const { invoiceDocNo, tagNo } = state.readState();
    expect(invoiceDocNo, 'run TC-SRE-04 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const { body, rows, summary } = await salesReturn.createSalesReturnEstimation({ ...DATA.salesReturnEstimation, billNo: invoiceDocNo });
    expect(rows.join(' | '), 'the bill\'s item in Sales Return Entries').toContain(DATA.inward.item.article);
    expect(rows.join(' | ')).toContain(String(invoiceDocNo));
    expect(summary.items, 'No. of Items').toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const srEstimationNo = OrderEstimationPage.numberOf(body);
    expect(srEstimationNo, `sales return estimation number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ srEstimationNo, srEstimationAmount: summary.estimationAmount });
    console.log(`Sales return estimation saved: ${srEstimationNo} (bill ${invoiceDocNo}, tag ${tagNo}, estimation amount ${summary.estimationAmount})`);
  });
});
