const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

/**
 * BRANCH -> BRANCH TAG TRANSFER — CONTINUES the relay tag.
 *
 * The tag received at COCHIN by TC-HBT-02 (e2e-tag-hb-state.json) moves on
 * to the PALAKKAD branch:
 *
 *   Cochin    TC-BBT-01  Transfer Out of the tag -> Palakkad
 *   Palakkad  TC-BBT-02  Transfer In from Cochin
 *
 * Run the ho-branch variant first - this spec reads its state file.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
const hb = makeState('e2e-tag-hb-state.json');
const state = makeState('e2e-tag-bb-state.json');

const DATA = { itemType: 'Metal', groupCategory: 'Gold', receiver: 'JJ' };

async function loginAs(loginPage, page, bu) {
  await loginPage.open();
  await loginPage.login({ bu });
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Tag Transfer - Branch to Branch (Cochin -> Palakkad, continues the relay tag)', () => {
  test('TC-BBT-01 Cochin: transfer out the relay tag to Palakkad', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferInNo } = hb.readState();
    expect(tagNo && transferInNo, 'run the ho-branch variant first (the tag must be RECEIVED at Cochin)').toBeTruthy();
    await loginAs(loginPage, page, 'Cochin');

    const body = await transfers.transferOut({
      destination: 'Palakkad',
      itemType: DATA.itemType,
      groupCategory: DATA.groupCategory,
      fromProcess: null,
      fromTransactionType: null,
      tag: tagNo,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ tagNo, transferOutNo });
    console.log(`[TC-BBT] tag ${tagNo} transferred out Cochin -> Palakkad (doc: ${transferOutNo})`);
  });

  test('TC-BBT-02 Palakkad: transfer in from Cochin', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferOutNo } = state.readState();
    expect(tagNo && transferOutNo, 'run TC-BBT-01 first').toBeTruthy();
    await loginAs(loginPage, page, 'Palakkad');

    const body = await transfers.transferIn({
      fromBU: 'Cochin',
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
    console.log(`[TC-BBT] tag ${tagNo} received at Palakkad from Cochin (transfer in ${transferInNo}) - Branch -> Branch complete`);
  });
});
