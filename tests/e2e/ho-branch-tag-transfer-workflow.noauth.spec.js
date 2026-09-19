const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

/**
 * HO -> BRANCH TAG TRANSFER — CONTINUES the HO-to-HO chain's tag.
 *
 * The tag generated at Kakkanad and received at ALUVA by TC-HHT-05
 * (e2e-tag-hh-state.json) moves on to the COCHIN branch:
 *
 *   Aluva   TC-HBT-01  Transfer Out of the tag -> Cochin
 *   Cochin  TC-HBT-02  Transfer In from Aluva
 *
 * Run the ho-ho variant first - this spec reads its state file.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
const hh = makeState('e2e-tag-hh-state.json');
const state = makeState('e2e-tag-hb-state.json');

const DATA = { itemType: 'Metal', groupCategory: 'Gold', receiver: 'JJ' };

async function loginAs(loginPage, page, bu) {
  await loginPage.ensureLoggedIn({ bu });
}

test.describe('Tag Transfer - HO to Branch (Aluva -> Cochin, continues the HO-HO tag)', () => {
  test('TC-HBT-01 Aluva: transfer out the HO-HO tag to Cochin', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferInNo } = hh.readState();
    expect(tagNo && transferInNo, 'run the ho-ho variant first (the tag must be RECEIVED at Aluva)').toBeTruthy();
    await loginAs(loginPage, page, 'Aluva');

    // received plain stock at Aluva - no From Process / From Transaction Type
    const body = await transfers.transferOut({
      destination: 'Cochin',
      itemType: DATA.itemType,
      groupCategory: DATA.groupCategory,
      fromProcess: null,
      fromTransactionType: null,
      tag: tagNo,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ tagNo, transferOutNo });
    console.log(`[TC-HBT] tag ${tagNo} transferred out Aluva -> Cochin (doc: ${transferOutNo})`);
  });

  test('TC-HBT-02 Cochin: transfer in from Aluva', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferOutNo } = state.readState();
    expect(tagNo && transferOutNo, 'run TC-HBT-01 first').toBeTruthy();
    await loginAs(loginPage, page, 'Cochin');

    const body = await transfers.transferIn({
      fromBU: 'Aluva',
      transactionMode: 'Stock',
      stockSourceType: 'TagWise',
      itemType: DATA.itemType,
      groupCategory: DATA.groupCategory,
      transferOutNo,
      receiver: DATA.receiver,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferInNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ transferInNo });
    console.log(`[TC-HBT] tag ${tagNo} received at Cochin from Aluva (transfer in ${transferInNo}) - HO -> Branch complete`);
  });
});
