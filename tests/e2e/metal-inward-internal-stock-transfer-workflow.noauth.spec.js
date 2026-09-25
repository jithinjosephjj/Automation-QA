const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

const state = makeState('e2e-internal-transfer-state.json');

/**
 * METAL INWARD -> INTERNAL STOCK TRANSFER (Department -> Locker -> Locker).
 *
 * QA lead, 25-09-2026. qa has no "Process" transfer option, so the metal
 * inward goes Department -> Asmi's locker, then Asmi's locker -> Bhavani's,
 * each accepted on Internal Transfer > Accept. Stock Entity Type Material,
 * Stock Identity Type Stock throughout:
 *
 *   TC-IST-01  Metal Inward              Invoice / Stock / Direct, RAJA, 1 pc Tendulkar 91.60, gross 100 g
 *   TC-IST-02  Internal Transfer         Department -> Locker (Asmi), Material, Transaction Type Metal Inward, the inward's line
 *   TC-IST-03  Internal Stock Accept     at Asmi's locker, received from Department
 *   TC-IST-04  Internal Transfer         Locker -> Locker, Asmi -> Bhavani, Material / Stock, 100 g
 *   TC-IST-05  Internal Stock Accept     at Bhavani's locker, received from Locker (Asmi)
 *
 * One continuous business flow: each test consumes the previous test's
 * output via e2e-internal-transfer-state.json, so the chain resumes where it
 * stopped and any step can be re-run alone.
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
      grossWeightWithTare: 100,
    },
  },
  first: { employee: 'Asmi' },
  second: { employee: 'Bhavani' },
  stockEntityType: 'Material',
  stockIdentityType: 'Stock',
  weight: 100,
};

async function login(loginPage) {
  await loginPage.ensureLoggedIn({ bu: BU });
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const docNo = (body) => (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';

test.describe('Metal Inward - Internal Stock Transfer (Department -> Locker -> Locker)', () => {
  test('TC-IST-01 metal inward (RAJA, Tendulkar 91.60, gross 100 g)', async ({ loginPage, metalInward, page }) => {
    test.setTimeout(600_000);
    state.reset(); // a new inward starts a new chain
    await login(loginPage);
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
    await metalInward.addItem(); // mandatory description selects; pure rate 15000 after Add Item
    await metalInward.nextBtn.click();
    await metalInward.waitForIdle();
    await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });

    const saved = await metalInward.submit(); // answers "Process with Barcode or Lot?" with No
    expect(JSON.stringify(saved)).toMatch(/success/i);
    let inwardNo = docNo(saved);
    if (!inwardNo) inwardNo = await metalInward.voucherNumber().catch(() => '');
    expect(inwardNo, 'generated inward voucher number').toBeTruthy();
    state.writeState({ inwardNo });
    console.log(`Metal inward saved: ${inwardNo} (gross ${DATA.inward.item.grossWeightWithTare} g)`);
    await page.locator('.btn-close').locator('visible=true').last().click({ timeout: 3_000 }).catch(() => {});
  });

  test('TC-IST-02 internal transfer Department -> Locker (Asmi)', async ({ loginPage, internalTransfer }) => {
    test.setTimeout(420_000);
    const { inwardNo } = state.readState();
    expect(inwardNo, 'run TC-IST-01 first').toBeTruthy();
    await login(loginPage);
    const body = await internalTransfer.transfer({
      issueFrom: 'Department',
      issueTo: 'Locker',
      toEmployee: DATA.first.employee,
      stockEntityType: DATA.stockEntityType,
      transactionType: 'Metal Inward',
      stockIdentityType: DATA.stockIdentityType,
      search: inwardNo,
      rowText: [new RegExp(`\\b${esc(inwardNo)}\\.\\d+\\b`)], // the inward's line "M205.1" - never another inward
    });
    const transferNo = docNo(body);
    expect(transferNo, 'internal transfer number').toBeTruthy();
    state.writeState({ transfer1No: transferNo });
    console.log(`Internal transfer ${transferNo}: ${inwardNo} Department -> ${DATA.first.employee}'s locker`);
  });

  test('TC-IST-03 internal stock accept at Asmi\'s locker (from Department)', async ({ loginPage, internalTransfer }) => {
    test.setTimeout(420_000);
    const { transfer1No } = state.readState();
    expect(transfer1No, 'run TC-IST-02 first').toBeTruthy();
    await login(loginPage);
    const body = await internalTransfer.accept({
      employee: DATA.first.employee,
      receivedFrom: 'Department',
      stockEntityType: DATA.stockEntityType,
      stockIdentityType: DATA.stockIdentityType,
      rowText: [new RegExp(`\\b${esc(transfer1No)}\\b`, 'i')],
    });
    expect(body, 'accept save response').toBeTruthy();
    state.writeState({ accept1No: docNo(body) });
    console.log(`Transfer ${transfer1No} accepted at ${DATA.first.employee}'s locker: ${docNo(body)}`);
  });

  test('TC-IST-04 internal transfer Locker -> Locker (Asmi -> Bhavani, 100 g)', async ({ loginPage, internalTransfer }) => {
    test.setTimeout(420_000);
    const { accept1No, transfer1No } = state.readState();
    expect(transfer1No && accept1No !== undefined, 'run TC-IST-03 first').toBeTruthy();
    await login(loginPage);
    const body = await internalTransfer.transfer({
      issueFrom: 'Locker',
      fromEmployee: DATA.first.employee,
      issueTo: 'Locker',
      toEmployee: DATA.second.employee,
      stockEntityType: DATA.stockEntityType,
      stockIdentityType: DATA.stockIdentityType,
      // the locker's stock rows carry article + purity, not the inward no
      rowText: [/Gold,Ring-Tendulkar[\s\S]*91\.60/, /Tendulkar[\s\S]*22 Karat/],
      weight: DATA.weight,
    });
    const transferNo = docNo(body);
    expect(transferNo, 'internal transfer number').toBeTruthy();
    state.writeState({ transfer2No: transferNo, transfer2Row: internalTransfer.lastRow || null });
    console.log(`Internal transfer ${transferNo}: ${DATA.first.employee} -> ${DATA.second.employee}`);
  });

  test('TC-IST-05 internal stock accept at Bhavani\'s locker (from Asmi\'s locker)', async ({ loginPage, internalTransfer }) => {
    test.setTimeout(420_000);
    const { transfer2No } = state.readState();
    expect(transfer2No, 'run TC-IST-04 first').toBeTruthy();
    await login(loginPage);
    const body = await internalTransfer.accept({
      employee: DATA.second.employee,
      receivedFrom: 'Locker',
      sourceEmployee: DATA.first.employee,
      stockEntityType: DATA.stockEntityType,
      stockIdentityType: DATA.stockIdentityType,
      rowText: [new RegExp(`\\b${esc(transfer2No)}\\b`, 'i')],
    });
    expect(body, 'accept save response').toBeTruthy();
    state.writeState({ accept2No: docNo(body) });
    console.log(`Transfer ${transfer2No} accepted at ${DATA.second.employee}'s locker: ${docNo(body)}`);
  });
});
