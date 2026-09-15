const { test, expect } = require('../../fixtures/test-fixtures');
const fs = require('fs');
const path = require('path');

/**
 * LOAD SWEEP — open EVERY sidebar page and click its Add (+) button, verifying
 * each page loads without an issue.
 *
 * "Load testing" here means PAGE-LOAD verification across the whole app
 * (single user), not concurrency/stress. Checks per page:
 *   - the route renders real content (no "under construction" / "page not
 *     found", body text above a floor)
 *   - the ngx-spinner clears (no stuck loader)
 *   - console errors stay at the app's known baseline (3/page) - pages above
 *     the WARN threshold are reported, not failed
 *   - where an Add (+) button exists, clicking it opens a form/wizard/modal,
 *     which is then closed before moving on (pages with no Add are fine)
 *
 * Routes are DISCOVERED at runtime by expanding the sidebar (same approach as
 * the perf runbook), so new pages are swept automatically. One test per
 * module keeps a single bad module from killing the sweep; failures list
 * every offending route at once.
 *
 * Run:  npm run test:load     Report: tests/load/last-sweep-report.md
 * MUST run headed - see README (Device Radar gate + Local Network Access).
 */

const ROUTES_FILE = path.join(__dirname, '.discovered-routes.json');
const RESULTS_FILE = path.join(__dirname, '.sweep-results.json');
const REPORT_FILE = path.join(__dirname, 'last-sweep-report.md');

const MODULES = [
  ['dsb', 'Dashboard'],
  ['adm', 'Admin'],
  ['ite', 'Intelligence Engine'],
  ['prc', 'Procurement'],
  ['inv', 'Inventory'],
  ['prd', 'Production'],
  ['sls', 'Sales & Distribution'],
  ['pos', 'Retail Operations'],
  ['fin', 'Finance'],
  ['ema', 'Layaway / EMA'],
  ['hrm', 'HRMS'],
  ['crm', 'CRM'],
  ['other', 'Other'],
];

const MIN_CHARS = 150; // rendered-content floor
const CONSOLE_WARN_AT = 6; // known baseline is 3 errors/page - warn above this

async function login(loginPage, page) {
  await loginPage.open();
  await loginPage.login();
  await loginPage.throwIfGated();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Expand every sidebar menu and collect all app routes, grouped by module prefix. */
async function discoverRoutes(page) {
  const hrefs = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let pass = 0; pass < 8; pass++) {
      const tog = [...document.querySelectorAll('#sidebar-menu a,.side-nav a,.leftside-menu a,.sidebar a')]
        .filter((a) => { const h = a.getAttribute('href'); return (!h || h.includes('void')) && a.getAttribute('aria-expanded') !== 'true'; });
      if (!tog.length) break;
      for (const t of tog) { try { t.click(); } catch (e) { /* keep expanding */ } }
      await sleep(350);
    }
    const seen = {}; const out = [];
    for (const a of document.querySelectorAll('a')) {
      const h = a.getAttribute('href');
      if (h && !h.startsWith('javascript') && h !== '#' && !h.startsWith('http') && !seen[h]) {
        seen[h] = 1;
        out.push({ t: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: h });
      }
    }
    return out;
  });
  const grouped = {};
  for (const { t, href } of hrefs) {
    if (/^\/(login|pages-)/.test(href)) continue;
    const m = href.match(/^\/([a-z]+)\//);
    const key = m && MODULES.some(([p]) => p === m[1]) ? m[1] : 'other';
    (grouped[key] = grouped[key] || []).push({ title: t, route: href });
  }
  return grouped;
}

/** Open one route, verify it loads, click Add when present, close the form. */
async function sweepPage(page, route, consoleErrors) {
  const res = { route, loadOk: false, chars: 0, uc: false, stuckSpinner: false, consoleErrors: 0, addFound: false, addOpened: null, problem: '' };
  consoleErrors.length = 0;
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (e) {
    res.problem = `navigation failed: ${String(e).split('\n')[0]}`;
    return res;
  }
  // stuck-loader check: the overlay must clear
  const spinnerHidden = await page.locator('.ngx-spinner-overlay').last()
    .waitFor({ state: 'hidden', timeout: 30_000 }).then(() => true).catch(() => false);
  res.stuckSpinner = !spinnerHidden;
  // short network-idle wait, then content check (runbook routine M, trimmed)
  const info = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = performance.getEntriesByType('resource').length; let still = performance.now();
    const start = performance.now();
    while (performance.now() - start < 8_000) {
      await sleep(250);
      const n = performance.getEntriesByType('resource').length;
      if (n !== last) { last = n; still = performance.now(); } else if (performance.now() - still > 900) break;
    }
    const bt = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    return { chars: bt.length, uc: /under construction|coming soon|page not found/i.test(bt) };
  }).catch(() => ({ chars: 0, uc: false }));
  res.chars = info.chars;
  res.uc = info.uc;
  res.consoleErrors = consoleErrors.length;
  res.loadOk = !res.uc && !res.stuckSpinner && res.chars >= MIN_CHARS;
  if (!res.loadOk) {
    res.problem = res.uc ? 'page under construction / not found'
      : res.stuckSpinner ? 'loader never cleared (stuck spinner)'
        : `page rendered almost nothing (${res.chars} chars)`;
    return res;
  }

  // Add (+) button: click it and verify a form opens (runbook routine A, trimmed)
  const addBtn = await page.evaluateHandle(() => {
    const vis = (el) => el && el.getClientRects().length > 0;
    const ic = [...document.querySelectorAll('.ri-add-fill,.ri-add-line,.ri-add-circle-fill,.ri-add-circle-line')]
      .map((i) => i.closest('button,a')).find(vis);
    if (ic) return ic;
    return [...document.querySelectorAll('button,a')]
      .find((e) => vis(e) && /^(add|new|create)\b/i.test((e.innerText || '').trim())) || null;
  }).catch(() => null);
  const hasAdd = addBtn && await addBtn.evaluate((el) => !!el).catch(() => false);
  if (!hasAdd) return res; // no Add on this page - by design on config/monitor screens
  res.addFound = true;

  const before = await page.evaluate(() => ({
    url: location.href,
    fields: document.querySelectorAll('input,select,textarea').length,
    rc: performance.getEntriesByType('resource').length,
  }));
  await addBtn.asElement().click({ timeout: 10_000 }).catch(() => {});
  const deadline = Date.now() + 8_000;
  let opened = false;
  while (Date.now() < deadline && !opened) {
    await page.waitForTimeout(300);
    opened = await page.evaluate((b) => {
      const modal = document.querySelector('.modal.show,.offcanvas.show,[role="dialog"],ngb-modal-window');
      const fields = document.querySelectorAll('input,select,textarea').length;
      const rc = performance.getEntriesByType('resource').length;
      return location.href !== b.url || !!modal || fields > b.fields + 1 || rc > b.rc + 1;
    }, before).catch(() => false);
  }
  res.addOpened = opened;
  if (!opened) res.problem = 'Add clicked but no form/wizard/modal opened';

  // close whatever opened so the next route starts clean
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    const vis = (el) => el && el.getClientRects().length > 0;
    const c = [...document.querySelectorAll('.ri-close-line,.ri-close-fill,.ri-arrow-left-line,.ri-arrow-go-back-line,.btn-close')]
      .map((i) => i.closest('button,a') || i).find(vis)
      || [...document.querySelectorAll('button,a')].find((e) => vis(e) && /^(cancel|close|back)\b/i.test((e.innerText || '').trim()));
    if (c) { try { c.click(); } catch (e) { /* best effort */ } }
  }).catch(() => {});
  await page.waitForTimeout(600);
  return res;
}

test.describe('Load Sweep - all pages + Add buttons', () => {
  test('LOAD-00 discover all sidebar routes', async ({ loginPage, page }) => {
    test.setTimeout(300_000);
    await login(loginPage, page);
    await page.waitForTimeout(4_000);
    const grouped = await discoverRoutes(page);
    const total = Object.values(grouped).reduce((n, a) => n + a.length, 0);
    expect(total, 'discovered route count').toBeGreaterThan(50);
    writeJson(ROUTES_FILE, grouped);
    writeJson(RESULTS_FILE, {}); // reset results for this sweep
    console.log(`discovered ${total} routes across ${Object.keys(grouped).length} modules:`,
      Object.entries(grouped).map(([k, v]) => `${k}:${v.length}`).join(' '));
  });

  for (const [prefix, label] of MODULES) {
    test(`LOAD-${prefix.toUpperCase()} sweep ${label} pages`, async ({ loginPage, page }) => {
      const routes = (readJson(ROUTES_FILE, {})[prefix]) || [];
      test.setTimeout(Math.max(180_000, 60_000 + routes.length * 30_000));
      test.skip(routes.length === 0, `no ${label} routes discovered`);
      await login(loginPage, page);

      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });

      const results = [];
      for (const { title, route } of routes) {
        const r = await sweepPage(page, route, consoleErrors);
        r.title = title;
        results.push(r);
        const flag = r.problem ? `FAIL - ${r.problem}` : (r.consoleErrors >= CONSOLE_WARN_AT ? `ok (WARN ${r.consoleErrors} console errors)` : 'ok');
        console.log(`[${prefix}] ${route} -> load:${r.loadOk ? 'ok' : 'FAIL'} add:${r.addFound ? (r.addOpened ? 'opened' : 'FAIL') : 'n/a'} ${flag}`);
      }

      const all = readJson(RESULTS_FILE, {});
      all[prefix] = { label, results };
      writeJson(RESULTS_FILE, all);

      const failures = results.filter((r) => r.problem);
      expect(failures.map((f) => `${f.route}: ${f.problem}`).join('\n'), `${label}: ${failures.length} of ${results.length} pages failed`).toBe('');
    });
  }

  test('LOAD-99 compile the sweep report', async () => {
    const all = readJson(RESULTS_FILE, {});
    const lines = [
      '# Load Sweep Report', '',
      `Run: ${new Date().toISOString()} | pages are FAIL on: under-construction, stuck spinner, near-empty render, or Add opening nothing.`,
      `Console errors are reported (baseline is 3/page); WARN at >= ${CONSOLE_WARN_AT}.`, '',
      '| Module | Page | Route | Load | Add (+) | Console errors | Problem |',
      '|---|---|---|---|---|---|---|',
    ];
    let pages = 0, loadFails = 0, addFails = 0;
    for (const [prefix, { label, results }] of Object.entries(all)) {
      for (const r of results) {
        pages += 1;
        if (!r.loadOk) loadFails += 1;
        if (r.addFound && r.addOpened === false) addFails += 1;
        lines.push(`| ${label} | ${r.title || ''} | ${r.route} | ${r.loadOk ? 'ok' : 'FAIL'} | ${r.addFound ? (r.addOpened ? 'opened' : 'FAIL') : 'none'} | ${r.consoleErrors} | ${r.problem || ''} |`);
      }
    }
    lines.push('', `**${pages} pages swept - ${loadFails} load failures, ${addFails} Add-button failures.**`, '');
    fs.writeFileSync(REPORT_FILE, lines.join('\n'));
    console.log(`report written: ${REPORT_FILE} (${pages} pages, ${loadFails} load failures, ${addFails} add failures)`);
    expect(pages, 'swept page count in the report').toBeGreaterThan(0);
  });
});
