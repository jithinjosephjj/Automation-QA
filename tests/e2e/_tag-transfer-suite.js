const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');
const { uniqueInvoiceNo } = require('../../utils/unique');

/**
 * SHARED BUILDER — BARCODE TAG TRANSFER between business units on qa.
 *
 * qa locations (18-09-2026): Kakkanad + Aluva are HEAD OFFICES; Cochin +
 * Palakkad are BRANCHES. The four direction variants (HO-HO, HO-branch,
 * branch-HO, branch-branch) differ ONLY in the source/destination BU - one
 * builder holds the 5 steps, each variant spec passes its direction.
 *
 * Chain per variant (seed mirrors the proven TC-LGS lot chain):
 *   <source>  01  Metal Inward (Stock/Direct/Invoice, RAJA, manual rate)
 *             02  Lot Generation from the inward
 *             03  Barcode tag from the lot (the TAG NUMBER seeds the transfer)
 *             04  Transfer Out -> <destination>
 *   <dest>    05  Transfer In from <source>
 *
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
function registerTagTransferSuite({ title, tc, stateFile, sourceBU, destinationBU }) {
  const state = makeState(stateFile);

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
        rate: 6000,
      },
    },
    lot: { vendor: 'RAJA', employee: 'Ubaid' },
    barcode: {
      // barcode is USER-SCOPED: the Lot No lookup lists only for the barcode
      // employee's login (QA lead 18-09-2026: barcode user is "suja") -
      // admin sees "No items found"
      user: { user: 'suja', pwd: '123' },
      stockIdentityType: 'Stock', // purchase inwards land as plain Stock
      vendor: 'RAJA',
      grossWeight: 10,
      descriptions: { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
    },
    transfer: { itemType: 'Metal', groupCategory: 'Gold', receiver: 'JJ' },
  };

  async function loginAs(loginPage, page, bu, creds = {}) {
    await loginPage.open();
    await loginPage.login({ ...creds, bu });
    await loginPage.throwIfGated();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  }

  test.describe(title, () => {
    test(`${tc}-01 ${sourceBU}: metal inward (stock)`, async ({ loginPage, metalInward, page }) => {
      test.setTimeout(600_000);
      state.reset(); // a new inward starts a new chain
      await loginAs(loginPage, page, sourceBU);

      await metalInward.open();
      await metalInward.openAddWizard();
      await metalInward.fillBasicDetails({
        subTransactionType: DATA.inward.subTransactionType,
        businessUnit: sourceBU,
        inwardType: DATA.inward.inwardType,
        purchaseType: DATA.inward.purchaseType,
        vendor: DATA.inward.vendor,
        purchaser: DATA.inward.purchaser,
        invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
      });
      await metalInward.nextBtn.click();
      await metalInward.waitForIdle();

      await metalInward.fillItem(DATA.inward.item);
      // Kakkanad's item step carries env-configured MANDATORY description
      // dropdowns (18-09-2026) that block Add Item silently while empty -
      // fill whatever the form marks invalid; a no-op elsewhere
      await metalInward.fillMandatoryEmptySelects();
      // Add Item is a silent no-op while the pricing/tax recompute is in
      // flight (Kakkanad, 18-09-2026: the click got swallowed and Next never
      // advanced) - click, VERIFY the piece registered, retry when it did not
      let added = false;
      for (let attempt = 1; attempt <= 3 && !added; attempt++) {
        await metalInward.waitForIdle();
        await metalInward.addItemBtn.click().catch(() => {});
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
          if (/No\. of Pieces\s*:\s*1/.test(body)) { added = true; break; }
          await page.waitForTimeout(800);
        }
      }
      expect(added, 'Add Item must register (No. of Pieces : 1)').toBe(true);
      await metalInward.nextBtn.click();
      await metalInward.waitForIdle();
      await expect(metalInward.gridRows.filter({ hasText: DATA.inward.item.article })).toHaveCount(1, { timeout: 30_000 });

      // KAKKANAD (18-09-2026): the review step renders a "Pure Rate" (Gold)
      // input that stays EMPTY - the location has no metal-rate config - and
      // Submit silently never fires while it is blank. Enter it when offered.
      const pureRate = page.locator('label:text-is("Gold")').last().locator('xpath=following::input[1]');
      if (await pureRate.isVisible({ timeout: 3_000 }).catch(() => false)
        && !(await pureRate.inputValue().catch(() => ''))) {
        await pureRate.fill(String(DATA.inward.item.rate));
        await pureRate.blur();
        await page.waitForTimeout(1_500);
        console.log(`[${tc}] review step: Pure Rate (Gold) was empty - entered ${DATA.inward.item.rate}`);
      }

      const saved = await metalInward.submit();
      expect(saved, 'metal inward save response').toBeTruthy();
      expect(JSON.stringify(saved)).toMatch(/success/i);
      // Kakkanad opens NO print dialog after the save (no template configured
      // for the location, 18-09-2026) - read the voucher from the save body
      // and fall back to the dialog where it does open
      let inwardVoucherNo = (saved.data && (saved.data.receiptNo || saved.data.docNo)) || '';
      if (!inwardVoucherNo) inwardVoucherNo = await metalInward.voucherNumber().catch(() => '');
      expect(inwardVoucherNo, 'generated inward voucher number').toBeTruthy();
      state.writeState({ inwardVoucherNo });
      console.log(`[${tc}] metal inward saved at ${sourceBU}: ${inwardVoucherNo}`);
      await page.locator('.btn-close').last().click({ timeout: 10_000 }).catch(() => {});
    });

    test(`${tc}-02 ${sourceBU}: lot generation from the inward`, async ({ loginPage, lotGeneration, page }) => {
      test.setTimeout(600_000);
      const { inwardVoucherNo } = state.readState();
      expect(inwardVoucherNo, `run ${tc}-01 first`).toBeTruthy();
      await loginAs(loginPage, page, sourceBU);

      const lotNo = await lotGeneration.generateLot({
        vendor: DATA.lot.vendor,
        inwardNo: inwardVoucherNo,
        employee: DATA.lot.employee,
        businessUnit: sourceBU,
      });
      expect(lotNo, 'generated lot number').toBeTruthy();
      state.writeState({ lotNo });
      console.log(`[${tc}] lot generated at ${sourceBU}: ${lotNo}`);
    });

    test(`${tc}-03 ${sourceBU}: barcode tag from the lot (as the barcode employee)`, async ({ loginPage, barcodeGeneration, page }) => {
      test.setTimeout(600_000);
      const { lotNo } = state.readState();
      expect(lotNo, `run ${tc}-02 first`).toBeTruthy();
      await loginAs(loginPage, page, sourceBU, DATA.barcode.user);

      const saved = await barcodeGeneration.generateTag({
        stockIdentityType: DATA.barcode.stockIdentityType,
        vendor: DATA.barcode.vendor,
        lotNo,
        grossWeight: DATA.barcode.grossWeight,
        descriptions: DATA.barcode.descriptions,
      });
      expect(saved, 'barcode save response').toBeTruthy();
      expect(JSON.stringify(saved)).toMatch(/success/i);

      // the TAG NUMBER: the save's receiptNo when it looks like a tag,
      // else read it from the Generated Tags view
      let tagNo = (saved.data && saved.data.receiptNo) || '';
      if (!/\d{4}-\d{2}-\d{2}\d+|\d+\/\d+/.test(tagNo)) {
        tagNo = await barcodeGeneration.verifyGeneratedTag(DATA.inward.item.article);
      }
      expect(tagNo, 'generated tag number').toBeTruthy();
      state.writeState({ tagNo });
      console.log(`[${tc}] barcode tag generated at ${sourceBU}: ${tagNo}`);
    });

    test(`${tc}-04 ${sourceBU}: transfer out to ${destinationBU}`, async ({ loginPage, transfers, page }) => {
      test.setTimeout(600_000);
      const { tagNo } = state.readState();
      expect(tagNo, `run ${tc}-03 first`).toBeTruthy();
      await loginAs(loginPage, page, sourceBU);

      // qa is not process-wise: lot tags transfer as plain stock, so the
      // From Process / From Transaction Type picks are skipped when absent
      const body = await transfers.transferOut({
        destination: destinationBU,
        itemType: DATA.transfer.itemType,
        groupCategory: DATA.transfer.groupCategory,
        fromProcess: null,
        fromTransactionType: null,
        tag: tagNo,
      });
      expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
      const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
      state.writeState({ transferOutNo });
      console.log(`[${tc}] tag ${tagNo} transferred out ${sourceBU} -> ${destinationBU} (doc: ${transferOutNo})`);
    });

    test(`${tc}-05 ${destinationBU}: transfer in from ${sourceBU}`, async ({ loginPage, transfers, page }) => {
      test.setTimeout(600_000);
      const { tagNo, transferOutNo } = state.readState();
      expect(tagNo && transferOutNo, `run ${tc}-04 first`).toBeTruthy();
      await loginAs(loginPage, page, destinationBU);

      const body = await transfers.transferIn({
        fromBU: sourceBU,
        transactionMode: 'Stock',
        stockSourceType: 'TagWise',
        itemType: DATA.transfer.itemType,
        groupCategory: DATA.transfer.groupCategory,
        transferOutNo,
        receiver: DATA.transfer.receiver,
      });
      expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
      const transferInNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
      state.writeState({ transferInNo });
      console.log(`[${tc}] tag ${tagNo} received at ${destinationBU} from ${sourceBU} (transfer in ${transferInNo}) - ${sourceBU} -> ${destinationBU} complete`);
    });
  });
}

module.exports = { registerTagTransferSuite };
