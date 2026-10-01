const { selectNgOption, getNgValue, clearNgSelect } = require('../utils/ng-select');
const { T } = require('../utils/timeouts');

// settle() floor and cap - see settle() below. Env overrides for A/B runs.
const SETTLE_GRACE = Number(process.env.PW_SETTLE_GRACE || 300);
const SETTLE_CAP = Number(process.env.PW_SETTLE_CAP || 1_500);

/**
 * Shared plumbing for every page object.
 *
 * Rule: page objects hold locators and actions. Assertions live in the spec.
 */
class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.toast = page.locator('.toast-container, .toast, #toast-container');
    this.spinner = page.locator('.loader, .spinner, .ngx-spinner-overlay');
  }

  async goto(path) {
    // Every attempt is raced against a LOCAL timer: when the browser process
    // has died (01-10-2026 TC-GRGRN-01: context gone 3 s into the step, out
    // of memory) page.goto never honours its own timeout and the step burnt
    // its whole 600 s budget. Now it fails in ~35 s with a clear message.
    const attempt = (ms) => Promise.race([
      this.page.goto(path, { waitUntil: 'commit', timeout: ms }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`goto ${path}: browser unresponsive for ${Math.round((ms + 5_000) / 1000)} s (crashed / out of memory?)`)), ms + 5_000)),
    ]);
    if (this.page.isClosed()) throw new Error(`goto ${path}: the page is already closed (browser crashed / out of memory?)`);
    try {
      await attempt(T(20_000));
    } catch (e) {
      if (/unresponsive|has been closed/.test(String(e))) throw e;
      // a navigation that hangs is retried once before it counts as a failure
      console.log(`goto ${path}: first attempt did not settle (${String(e).split(/\r?\n/)[0]}) - retrying`);
      await attempt(T(30_000));
    }
    await this.waitForIdle();
  }

  /** Wait for the app's own loader to clear - not a blind timeout. */
  async waitForIdle() {
    const n = await this.spinner.count();
    for (let i = 0; i < n; i++) {
      await this.spinner.nth(i).waitFor({ state: 'hidden', timeout: T(30_000) }).catch(() => {});
    }
  }

  /**
   * The replacement for a blind waitForTimeout(ms): returns as soon as the
   * app is actually quiet - no request in flight, none started for `quiet`
   * ms, and the ngx-spinner overlay gone - but never before `grace` ms
   * (debounced filters and the spinner start a few hundred ms after the
   * triggering action). `max` caps the wait when the network never goes
   * quiet; only a spinner that is still up may extend it, up to 30 s.
   *
   * 30-09-2026 speed pass: the 364 call sites made the 600 ms floor ~20 % of
   * a serial run, so the floor is 300 ms and `max` is capped at SETTLE_CAP
   * (1.5 s; the old 2-2.5 s sleeps). PW_SETTLE_GRACE / PW_SETTLE_CAP restore
   * the old values for a comparison run (600 / 2500).
   */
  async settle(max = 2_000, { grace = SETTLE_GRACE, quiet = SETTLE_GRACE } = {}) {
    max = Math.min(max, SETTLE_CAP);
    const page = this.page;
    const start = Date.now();
    let inflight = 0;
    let lastActivity = start;
    const onReq = () => { inflight++; lastActivity = Date.now(); };
    const onDone = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
    page.on('request', onReq);
    page.on('requestfinished', onDone);
    page.on('requestfailed', onDone);
    const overlay = page.locator('.ngx-spinner-overlay');
    try {
      for (;;) {
        const elapsed = Date.now() - start;
        const spinnerUp = (await overlay.count().catch(() => 0)) > 0;
        const networkQuiet = inflight === 0 && Date.now() - lastActivity >= quiet;
        if (elapsed >= grace && networkQuiet && !spinnerUp) return;
        if (elapsed >= max && !spinnerUp) return;
        if (elapsed >= 30_000) return;
        await page.waitForTimeout(100);
      }
    } finally {
      page.off('request', onReq);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
    }
  }

  /**
   * Tick the grid row matching rowText (via the subclass's rowMatcher) and
   * VERIFY it took. PrimeNG re-renders the table after a filter / sort /
   * data refresh, and a click that lands mid-render toggles nothing:
   * "Clicking the checkbox did not change its state" (TC-AIR-05, 30-09-2026,
   * as soon as the settle floor dropped to 300 ms). Each attempt re-resolves
   * the row, clicks, and accepts either the checkbox reporting checked or
   * the grid's "n of m selected" / "n Records selected" counter going up.
   * ProductionWorkflowPage keeps its own richer variant.
   */
  async checkRow(rowText) {
    const label = Array.isArray(rowText) ? rowText.join('|') : String(rowText);
    await this.rowMatcher(rowText).first().waitFor({ state: 'visible', timeout: T(30_000) });
    const selectedCount = async () => {
      const t = await this.page.getByText(/\d+ (?:of \d+ )?(?:Records? )?selected/i).first().textContent({ timeout: 1_000 }).catch(() => '');
      const m = (t || '').match(/(\d+) (?:of \d+ )?(?:Records? )?selected/i);
      return m ? Number(m[1]) : 0;
    };
    const isOn = (box) => box.isChecked({ timeout: 1_000 }).catch(() => false);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const box = this.rowMatcher(rowText).first().getByRole('checkbox').first();
      if (await isOn(box)) { await this.settle(1_000); return; }
      const before = await selectedCount();
      await box.click({ force: true, timeout: T(10_000) }).catch(() => {});
      await this.settle(1_000);
      if (await isOn(box)) return;
      if ((await selectedCount()) > before) { console.log(`checkRow: the grid counted the selection of "${label}"`); return; }
      console.log(`checkRow: tick did not stick for "${label}" (attempt ${attempt}) - grid re-rendered, retrying`);
      await this.page.waitForTimeout(500);
    }
    throw new Error(`row checkbox for "${label}" never took the tick after 4 attempts`);
  }

  /**
   * Names of the visible form controls Angular currently marks invalid -
   * the answer to "why did Submit / Add Item silently do nothing?".
   */
  async invalidControls() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const selects = [...document.querySelectorAll('sioniq-ng-select, ng-select')]
        .filter((n) => (n.matches('ng-select') ? n : n.querySelector('ng-select'))?.classList.contains('ng-invalid') && vis(n))
        .map((n) => n.getAttribute('controlname') || n.getAttribute('formcontrolname') || n.closest('[controlname]')?.getAttribute('controlname') || 'ng-select');
      const inputs = [...document.querySelectorAll('input.ng-invalid, textarea.ng-invalid')]
        .filter(vis)
        .map((i) => i.id || i.getAttribute('formcontrolname') || i.getAttribute('placeholder') || i.closest('div')?.querySelector('label')?.textContent?.trim() || 'input');
      return { selects: [...new Set(selects)], inputs: [...new Set(inputs)] };
    }).catch(() => ({ selects: [], inputs: [] }));
  }

  /**
   * Click the last VISIBLE .btn-close (offcanvas / modal / print dialog) if
   * there is one. Replaces blind `.btn-close` clicks that waited out a 10 s
   * timeout whenever nothing was open. Returns whether something was closed.
   */
  async closeVisibleDialog(timeout = 3_000) {
    const close = this.page.locator('.btn-close').locator('visible=true').last();
    if (!(await close.isVisible().catch(() => false))) return false;
    await close.click({ timeout }).catch(() => {});
    return true;
  }

  selectNg(selector, text, opts) {
    return selectNgOption(this.page, selector, text, opts);
  }

  ngValue(selector) {
    return getNgValue(this.page, selector);
  }

  clearNg(selector) {
    return clearNgSelect(this.page, selector);
  }

  /**
   * Click something and return the parsed body of the API call it triggers.
   * Waiting on the real response is the only reliable "save finished" signal.
   */
  async clickAndWaitForApi(locator, urlPattern, { status = 200 } = {}) {
    const waiter = this.page.waitForResponse(
      (r) => matches(r.url(), urlPattern) && r.status() === status,
      { timeout: T(30_000) },
    );
    await locator.click();
    const res = await waiter;
    return res.json().catch(() => null);
  }

  async toastText() {
    await this.toast.first().waitFor({ state: 'visible' });
    return (await this.toast.first().textContent() || '').trim();
  }

  /** Element-scoped screenshot - the app sets body { zoom: 0.9 }, so full-page shots read small. */
  async shot(name, locator) {
    const target = locator || this.page;
    return target.screenshot({ path: `test-results/screens/${name}.png` });
  }

  /**
   * The app's PROCESS (business) date shown in the top-bar chip next to the
   * Business Unit (e.g. "23/06/2026 Cochin") - this is the app's "today", which
   * differs from the real system clock. Returned as DD/MM/YYYY (the format the
   * date inputs accept). Use it for delivery/booking dates so they align with
   * the process date, not the machine's clock.
   */
  async processDate() {
    return this.page.evaluate(() => {
      const dateRe = /\b(\d{2}\/\d{2}\/\d{4})\b/;
      const buRe = /(Cochin|Aluva|Palakkad|Trivendrum|Hyderabad)/;
      // the header chip carries both the date and the BU name - prefer it
      const nodes = [...document.querySelectorAll('span, div, p, button, a, li')];
      for (const n of nodes) {
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length <= 60 && dateRe.test(t) && buRe.test(t)) return t.match(dateRe)[1];
      }
      const m = (document.body.innerText || '').match(dateRe);
      return m ? m[1] : '';
    });
  }
}

function matches(url, pattern) {
  return pattern instanceof RegExp ? pattern.test(url) : url.includes(pattern);
}

module.exports = { BasePage };
