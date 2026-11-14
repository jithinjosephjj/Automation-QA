const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');
const sessionCache = require('../../utils/session-cache');
const { OrderEstimationPage } = require('../../pages/OrderEstimationPage');
const { RetailInvoicePage } = require('../../pages/RetailInvoicePage');

const state = makeState('e2e-retail-sales-return-registration-state.json');

/**
 * E2E WORKFLOW — BARCODE TAG -> RETAIL INVOICE -> SALES RETURN ESTIMATION ->
 * SALES RETURN REGISTRATION against that estimation (Entry Mode Estimation,
 * cash refund) at Kakkanad. Requested 14-11-2026 ("create sale return
 * estimation -> registration workflow").
 *
 *   TC-SRR-01  admin: Procurement > Stock Inward > Metal (Invoice / Stock / Direct,
 *              vendor RAJA; Tendulkar 91.60, 1 pc, 100 g), "Barcode or Lot?" = No
 *   TC-SRR-02  admin: Lot Generation (employee Ubaid, Location Kakkanad)
 *   TC-SRR-03  suja:  Barcode Generation for the lot (1 piece, Additional Charges)
 *   TC-SRR-04  admin (form login): Retail Operations > Invoice (Direct): customer
 *              Aneesh Maradu, scan the tag, Add Item, Cash, Submit (bill no.)
 *   TC-SRR-05  admin (form login): Estimations > Sales Return Estimation: Retail,
 *              Salesman code AJ10 (Ajin G), Helper Chandu, Metal, BillWise, the bill ->
 *              item card -> Add Item -> Sales Return Entries (5 %) -> Submit (SR
 *              estimation no.)
 *   TC-SRR-06  admin (form login): Sales Return Registration: Entry Mode Estimation,
 *              SR Estimation No = that estimation, Add, Payment (refund the balance by
 *              Cash), Submit (SalesReturnRegistration/CreateSalesReturnRegistration,
 *              receipt e.g. PLKSSS25)
 *
 * Numbers chain through e2e-retail-sales-return-registration-state.json. MUST run
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
  registration: { refund: { mode: 'Cash' } },
};

async function freshPosLogin(loginPage, page) {
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', HEAD_OFFICE);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
}

test.describe('Retail Tag - Invoice - Sales Return Estimation - Sales Return Registration - Workflow', () => {
  test('TC-SRR-01 Kakkanad: metal inward (Direct, Stock, barcode-or-lot No)', async ({ loginPage, metalInward, page }) => {
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
    state.writeState({ inwardVoucherNo, lotNo: null, tagNo: null, invoiceDocNo: null, srEstimationNo: null, srRegistrationNo: null });
    console.log(`Metal inward saved: ${inwardVoucherNo}`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-SRR-02 Kakkanad: generate a lot from the inward', async ({ loginPage, lotGeneration }) => {
    test.setTimeout(600_000);
    const { inwardVoucherNo } = state.readState();
    expect(inwardVoucherNo, 'run TC-SRR-01 first').toBeTruthy();
    await loginPage.ensureLoggedIn({ bu: HEAD_OFFICE });
    const lotNo = await lotGeneration.generateLot({ vendor: DATA.inward.vendor, inwardNo: inwardVoucherNo, employee: DATA.lot.employee, location: DATA.lot.location, businessUnit: DATA.lot.businessUnit });
    expect(lotNo, 'generated lot number').toBeTruthy();
    state.writeState({ lotNo });
    console.log(`Lot generated: ${lotNo}`);
  });

  test('TC-SRR-03 Kakkanad: generate the barcode tag for the lot (as suja)', async ({ loginPage, barcodeGeneration }) => {
    test.setTimeout(600_000);
    const { lotNo } = state.readState();
    expect(lotNo, 'run TC-SRR-02 first').toBeTruthy();
    await loginPage.ensureLoggedIn(DATA.barcode.user);
    const saved = await barcodeGeneration.generateTag({ stockIdentityType: DATA.barcode.stockIdentityType, vendor: DATA.inward.vendor, lotNo, grossWeight: DATA.barcode.grossWeight, pieces: 1, additionalCharges: true, descriptions: DATA.barcode.descriptions, counter: DATA.barcode.counter });
    expect(JSON.stringify(saved)).toMatch(/success/i);
    const tagNo = barcodeGeneration.tagNoFromSave(saved) || await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
    expect(tagNo, 'generated tag number').toBeTruthy();
    state.writeState({ tagNo });
    console.log(`Barcode tag generated: ${tagNo}`);
  });

  test('TC-SRR-04 Kakkanad: retail sales invoice (Direct) sells the tag', async ({ loginPage, retailInvoice, page }) => {
    test.setTimeout(600_000);
    const { tagNo } = state.readState();
    expect(tagNo, 'run TC-SRR-03 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const body = await retailInvoice.createDirectInvoice({ customer: DATA.customer.name, mobile: DATA.customer.mobile, salesman: DATA.invoice.salesman, helper: DATA.invoice.helper, tagNo, metalRate: DATA.invoice.metalRate, payment: DATA.invoice.payment });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const invoiceDocNo = RetailInvoicePage.numberOf(body);
    expect(invoiceDocNo, `invoice document number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    state.writeState({ invoiceDocNo });
    console.log(`Retail invoice saved: ${invoiceDocNo} (tag ${tagNo}, customer ${DATA.customer.name})`);
  });

  test('TC-SRR-05 Kakkanad: sales return estimation (BillWise) for the bill', async ({ loginPage, salesReturn, page }) => {
    test.setTimeout(600_000);
    const { invoiceDocNo, tagNo } = state.readState();
    expect(invoiceDocNo, 'run TC-SRR-04 first').toBeTruthy();
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

  test('TC-SRR-06 Kakkanad: sales return registration against the SR estimation (Cash refund)', async ({ loginPage, salesReturn, page }) => {
    test.setTimeout(600_000);
    const { srEstimationNo, srEstimationAmount, invoiceDocNo } = state.readState();
    expect(srEstimationNo, 'run TC-SRR-05 first').toBeTruthy();
    await freshPosLogin(loginPage, page);
    const body = await salesReturn.registerSalesReturn({ estimationNo: srEstimationNo, ...DATA.registration });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const srRegistrationNo = OrderEstimationPage.numberOf(body);
    expect(srRegistrationNo, `sales return registration number in the save body: ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
    const summary = await salesReturn.summaryNumbers().catch(() => ({}));
    if (srEstimationAmount && summary.totalReturnValue) expect(summary.totalReturnValue, 'Total Return Value = the estimation amount').toBeCloseTo(srEstimationAmount, 2);
    state.writeState({ srRegistrationNo });
    console.log(`Sales return registered: ${srRegistrationNo} (SR estimation ${srEstimationNo}, bill ${invoiceDocNo}, refund ${summary.paid ?? '?'})`);
  });
});
