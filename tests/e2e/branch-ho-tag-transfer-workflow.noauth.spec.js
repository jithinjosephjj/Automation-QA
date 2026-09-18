const { test, expect } = require('../../fixtures/test-fixtures');
const { makeState } = require('../../utils/e2e-state');

/**
 * BRANCH -> HO TAG TRANSFER — CONTINUES (and closes) the relay tag.
 *
 * The tag received at PALAKKAD by TC-BBT-02 (e2e-tag-bb-state.json)
 * returns to the KAKKANAD head office where it was born:
 *
 *   Palakkad  TC-BHT-01  Transfer Out of the tag -> Kakkanad
 *   Kakkanad  TC-BHT-02  Transfer In from Palakkad
 *
 * Run the branch-branch variant first - this spec reads its state file.
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */
const bb = makeState('e2e-tag-bb-state.json');
const state = makeState('e2e-tag-bh-state.json');

const DATA = { itemType: 'Metal', groupCategory: 'Gold', receiver: 'JJ' };

async function loginAs(loginPage, page, bu) {
  await loginPage.open();
  await loginPage.login({ bu });
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe('Tag Transfer - Branch to HO (Palakkad -> Kakkanad, closes the relay)', () => {
  test('TC-BHT-01 Palakkad: transfer out the relay tag to Kakkanad', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferInNo } = bb.readState();
    expect(tagNo && transferInNo, 'run the branch-branch variant first (the tag must be RECEIVED at Palakkad)').toBeTruthy();
    await loginAs(loginPage, page, 'Palakkad');

    const body = await transfers.transferOut({
      destination: 'Kakkanad',
      itemType: DATA.itemType,
      groupCategory: DATA.groupCategory,
      fromProcess: null,
      fromTransactionType: null,
      tag: tagNo,
    });
    expect(JSON.stringify(body)).toMatch(/success|saved|1001/i);
    const transferOutNo = (body && body.data && (body.data.receiptNo || body.data.docNo)) || '';
    state.writeState({ tagNo, transferOutNo });
    console.log(`[TC-BHT] tag ${tagNo} transferred out Palakkad -> Kakkanad (doc: ${transferOutNo})`);
  });

  test('TC-BHT-02 Kakkanad: transfer in from Palakkad', async ({ loginPage, transfers, page }) => {
    test.setTimeout(600_000);
    const { tagNo, transferOutNo } = state.readState();
    expect(tagNo && transferOutNo, 'run TC-BHT-01 first').toBeTruthy();
    await loginAs(loginPage, page, 'Kakkanad');

    const body = await transfers.transferIn({
      fromBU: 'Palakkad',
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
    console.log(`[TC-BHT] tag ${tagNo} received back at Kakkanad from Palakkad (transfer in ${transferInNo}) - all 4 directions complete`);
  });
});
