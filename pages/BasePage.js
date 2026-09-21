const { selectNgOption, getNgValue, clearNgSelect } = require('../utils/ng-select');

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
    try {
      await this.page.goto(path, { waitUntil: 'commit', timeout: 20_000 });
    } catch (e) {
      // a navigation that hangs is retried once before it counts as a failure
      console.log(`goto ${path}: first attempt did not settle (${String(e).split(/\r?\n/)[0]}) - retrying`);
      await this.page.goto(path, { waitUntil: 'commit', timeout: 30_000 });
    }
    await this.waitForIdle();
  }

  /** Wait for the app's own loader to clear - not a blind timeout. */
  async waitForIdle() {
    const n = await this.spinner.count();
    for (let i = 0; i < n; i++) {
      await this.spinner.nth(i).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    }
  }

  /**
   * The replacement for a blind waitForTimeout(ms): returns as soon as the
   * app is actually quiet - no request in flight, none started for `quiet`
   * ms, and the ngx-spinner overlay gone - but never before `grace` ms
   * (debounced filters and the spinner start a few hundred ms after the
   * triggering action). `max` caps the wait at the old sleep length, so the
   * worst case is unchanged and the typical case is ~0.6 s; only a spinner
   * that is still up may extend it, up to 30 s.
   */
  async settle(max = 2_000, { grace = 600, quiet = 600 } = {}) {
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
      { timeout: 30_000 },
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
