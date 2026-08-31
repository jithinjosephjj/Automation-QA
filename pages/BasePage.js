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
}

function matches(url, pattern) {
  return pattern instanceof RegExp ? pattern.test(url) : url.includes(pattern);
}

module.exports = { BasePage };
