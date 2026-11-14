const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

// PROBE (read-only): which EMA members the Estimation tab (Sales Type EMA) accepts.
// For each [memberNo, customer, mobile] it opens a fresh Add form, picks the customer,
// Sales Type EMA, types the member number and reports the fetch (grid row + tiles,
// or the app's refusal). Nothing is saved.
//   npx playwright test tests/probe/estimation-ema-members-probe.noauth.spec.js --project=no-auth --reporter=line
const MEMBERS = (process.env.MEMBERS || 'V002|Ginu|1477533698;EM002KKD|Aneesh Maradu|8547963321;d001|Mohini|1111111111;WB002KKD|Angel|9865321478;WB005KKD|Anu|1234567890')
  .split(';').map((m) => { const [memberNo, customer, mobile] = m.split('|'); return { memberNo, customer, mobile }; });

test('PROBE estimation EMA members', async ({ loginPage, estimationSalesType, page }) => {
  test.setTimeout(900_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', 'Kakkanad');
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const pg = estimationSalesType;
  const results = [];
  for (const m of MEMBERS) {
    try {
      await pg.openForm();
      await pg.setCustomer({ name: m.customer, mobile: m.mobile });
      await pg.pickSalesType('EMA');
      const offered = await pg.emaMembersOffered(m.memberNo);
      const r = await pg.pickupEmaMember(m.memberNo);
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      const closure = (text.match(/Closure Type\s*(.{0,60})/) || [])[1] || '';
      results.push({ ...m, offered: !!offered.entry, plan: offered.entry && offered.entry.adpPlanName, available: offered.entry && offered.entry.accountAvailableClosureAmountTran, row: r.row, tiles: r.tiles, setupGap: r.setupGap, status: r.status, toasts: r.toasts, closureHint: closure.slice(0, 60) });
      await page.screenshot({ path: `test-results/screens/probe-ema-${m.memberNo}.png`, fullPage: true }).catch(() => {});
    } catch (e) {
      results.push({ ...m, error: String(e.message).split('\n')[0].slice(0, 200) });
    }
  }
  console.log('RESULTS ' + JSON.stringify(results, null, 1));
});
