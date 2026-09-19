const { test, expect } = require('../../fixtures/test-fixtures');

// PROBE: does the auth token ROTATE across navigations (KeepAlive), and does
// an older token stay valid once a newer one exists? Decides how the session
// cache must be refreshed. Uses REAL routes: an unknown route makes the app
// clear the session and bounce to /login.
const ROUTES = ['/prc/stock-inward-setup', '/inv/view-lot-generation', '/dsb/e-commerce'];
const SHELL = 'app-topbar, .navbar-custom, form.login-form, #username';
const tokenOf = (p) => p.evaluate(() => sessionStorage.getItem('_SIONIQ_AUTH'));
const jti = (t) => { try { return JSON.parse(Buffer.from(JSON.parse(t).split('.')[1], 'base64').toString()).jti.slice(0, 8); } catch { return String(t).slice(0, 12); } };

async function settleShell(p) {
  await p.locator(SHELL).first().waitFor({ timeout: 30_000 }).catch(async () => {
    console.log('  shell marker missing; body:', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))));
  });
  await p.waitForTimeout(2000);
}

async function bootInjected(browser, storage, cookies, label, overwrite) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  await ctx.addCookies(cookies);
  await ctx.addInitScript((data) => {
    if (location.hostname !== data.host) return;
    for (const [k, v] of Object.entries(data.local)) if (data.overwrite || localStorage.getItem(k) === null) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(data.session)) if (data.overwrite || sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
  }, { host: 'qa.sioniq.com', overwrite, ...storage });
  const p = await ctx.newPage();
  const api = [];
  p.on('response', (r) => { if (r.url().includes('/sioniq/')) api.push(`${r.status()} ${r.url().split('/sioniq/')[1].split('?')[0]}`); });
  const t = Date.now();
  await p.goto('/dsb/e-commerce', { waitUntil: 'domcontentloaded' });
  await settleShell(p);
  console.log(`[${label}] dashboard boot -> ${p.url()} token=${jti(await tokenOf(p))} spinnerOverlays=${await p.locator('.ngx-spinner-overlay').count()} (${Date.now() - t} ms incl 2s pad)`);
  for (const route of ROUTES.slice(0, 2)) {
    await p.goto(route, { waitUntil: 'domcontentloaded' });
    await settleShell(p);
    console.log(`[${label}] ${route} -> ${p.url()} token=${jti(await tokenOf(p))}`);
  }
  console.log(`[${label}] api statuses:`, [...new Set(api.map((a) => a.split(' ')[0]))], 'count', api.length);
  await ctx.close();
}

test('PROBE token rotation and old-token validity', async ({ loginPage, page, browser }) => {
  test.setTimeout(500_000);
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const t0 = await tokenOf(page);
  console.log(`T0 after UI login: ${jti(t0)}`);
  const snap = async () => ({
    local: await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))),
    session: await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]))),
  });
  const s0 = await snap();
  const cookies = await page.context().cookies();

  const keep = [];
  page.on('response', async (r) => { if (r.url().includes('KeepAlive')) keep.push(`${r.status()} ${(await r.text().catch(() => '')).slice(0, 100)}`); });
  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await settleShell(page);
    console.log(`original page ${route} -> ${page.url()} token=${jti(await tokenOf(page))}`);
  }
  console.log('KeepAlive responses on original page:', keep);
  const s1 = await snap();
  const localDiff = Object.keys({ ...s0.local, ...s1.local }).filter((k) => s0.local[k] !== s1.local[k]);
  const sessDiff = Object.keys({ ...s0.session, ...s1.session }).filter((k) => s0.session[k] !== s1.session[k]);
  console.log('storage keys changed across navigations: local=', localDiff, 'session=', sessDiff);

  await bootInjected(browser, s0, cookies, 'A:T0 set-if-missing', false);
  await bootInjected(browser, s0, cookies, 'B:T0 overwrite-always', true);
  await bootInjected(browser, s1, cookies, 'C:latest set-if-missing', false);
  // and the original page must still be alive after the injected contexts ran
  await page.goto('/dsb/e-commerce', { waitUntil: 'domcontentloaded' });
  await settleShell(page);
  console.log(`original page after injected contexts -> ${page.url()} token=${jti(await tokenOf(page))}`);
});
