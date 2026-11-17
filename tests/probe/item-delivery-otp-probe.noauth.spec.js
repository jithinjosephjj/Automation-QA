const { test } = require('../../fixtures/test-fixtures');
const sessionCache = require('../../utils/session-cache');

/**
 * Item Delivery probe: load an invoice (default: the TC-RID chain's), select
 * the tag, then watch what "Send OTP" and "Deliver & Print Challan" do -
 * every DOM node that appears (toast / swal / modal / inline text), every
 * network call, console errors. May deliver the invoice if the gate opens.
 */
const BU = process.env.BU || 'Kakkanad';
const st = require('../../utils/e2e-state').makeState('e2e-retail-item-delivery-state.json').readState();
const INVOICE = process.env.INVOICE || st.invoiceDocNo;
const TAG = process.env.TAG || st.tagNo;

test('item delivery otp / deliver probe', async ({ loginPage, itemDelivery, page }) => {
  test.setTimeout(600_000);
  sessionCache.clear(process.env.SIONIQ_USER || 'admin', BU);
  page.context()[Symbol.for('sioniq.session')] = null;
  await loginPage.ensureLoggedIn({ bu: BU });
  const pg = itemDelivery;
  page.on('response', async (r) => {
    const u = r.url();
    if (/KeepAlive|Translation|GetMasterData|\.js|\.css|\.png|\.woff|GetAll|Pagination/i.test(u) || r.request().method() === 'OPTIONS') return;
    console.log(`  net ${r.request().method()} ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')} ${JSON.stringify(await r.json().catch(() => null)).slice(0, 300)}`);
  });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`  console.${m.type()} ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => console.log(`  pageerror ${String(e).slice(0, 300)}`));

  await pg.open();
  await pg.openAddForm();
  await pg.loadInvoice(INVOICE);
  await pg.verifyAndSelectTag(TAG);
  for (const name of [/Signature|thumb impression/i, /Certificate & box/i]) {
    const box = page.getByRole('checkbox', { name }).locator('visible=true').first();
    if (!(await box.isChecked().catch(() => false))) await box.check({ timeout: 5_000 }).catch(() => {});
  }
  // observe everything that gets added to the DOM from now on
  await page.evaluate(() => {
    window.__added = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const t = (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) window.__added.push(`${n.tagName}.${String(n.className).slice(0, 40)}: ${t.slice(0, 200)}`);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
  const added = async (label) => {
    const a = await page.evaluate(() => { const x = window.__added.slice(); window.__added = []; return x; }).catch(() => []);
    console.log(`${label}: ${a.length} added node(s)\n  ${a.slice(0, 25).join('\n  ')}`);
  };
  const fields = async (label) => console.log(`${label}: ${JSON.stringify(await pg.visibleFields()).slice(0, 1200)}`);

  // 1. Send OTP
  const send = page.locator('button').filter({ hasText: /Send OTP/i }).locator('visible=true').first();
  await send.click({ timeout: 10_000 });
  await page.waitForTimeout(3_500);
  await added('after Send OTP');
  await fields('fields after Send OTP');
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-otp.png', fullPage: true }).catch(() => {});
  const otpIn = page.locator('input[placeholder*="OTP" i], input[formcontrolname*="otp" i], input#otp, input[id*="otp" i]').locator('visible=true');
  console.log(`otp inputs: ${await otpIn.count()}`);
  const otpModal = page.locator('.modal.show, ngb-modal-window, .swal2-container').locator('visible=true');
  if (await otpModal.count()) console.log(`otp modal: ${(await otpModal.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)}`);

  // 2. Deliver
  const deliver = page.getByRole('button', { name: /Deliver & Print Challan/ }).locator('visible=true').last();
  console.log(`Deliver enabled=${await deliver.isEnabled()} html=${await deliver.evaluate((b) => b.outerHTML.slice(0, 300))}`);
  await deliver.click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-deliver-0.png', fullPage: true }).catch(() => {});
  await added('0.4 s after Deliver');
  await page.waitForTimeout(3_000);
  await added('3.4 s after Deliver');
  await fields('fields after Deliver');
  await page.screenshot({ path: 'test-results/adhoc/probe-item-delivery-deliver-1.png', fullPage: true }).catch(() => {});
  const modal = page.locator('.modal.show, ngb-modal-window, .swal2-container').locator('visible=true');
  if (await modal.count()) console.log(`modal after Deliver: ${(await modal.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 800)}`);
  console.log(`url now ${page.url()}`);
});
