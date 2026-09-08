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
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForIdle();
  }

  /** Wait for the app's own loader to clear - not a blind timeout. */
  async waitForIdle() {
    const n = await this.spinner.count();
    for (let i = 0; i < n; i++) {
      await this.spinner.nth(i).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    }
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
