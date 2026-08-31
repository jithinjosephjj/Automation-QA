/**
 * Helpers for ng-select (Angular) dropdowns.
 *
 * ng-select is NOT a native <select>, so loc.selectOption() does nothing on it.
 * It renders as:
 *   <ng-select id="location"> <div class="ng-select-container"> ...
 *     <div class="ng-input"><input role="combobox"></div>
 * and options appear in a detached panel as .ng-option elements.
 */

/**
 * Open an ng-select, type to filter, and pick the option by visible text.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector  e.g. '#location' or 'ng-select[formcontrolname="itemType"]'
 * @param {string} optionText
 * @param {{exact?: boolean, timeout?: number}} [opts]
 */
async function selectNgOption(page, selector, optionText, opts = {}) {
  const { exact = true, timeout = 15_000 } = opts;
  const select = page.locator(selector);

  const option = page
    .locator('.ng-dropdown-panel .ng-option')
    .filter({ hasText: exact ? new RegExp(String.raw`^\s*${escapeRe(optionText)}\s*$`) : optionText });

  // ng-select renders whatever its list held at open time. Remote-loaded
  // lists (the login BU list on a slow server, for instance) can still be
  // empty on the first open, and the panel does not refresh until reopened -
  // so close and reopen instead of waiting one long timeout.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await select.scrollIntoViewIfNeeded();
    await select.locator('.ng-select-container').click();

    // Typing filters the panel; it also forces remote-loaded lists to fetch.
    const search = select.locator('input[role="combobox"]');
    if (await search.count()) await search.fill(optionText);

    try {
      await option.first().waitFor({ state: 'visible', timeout: attempt * timeout });
      await option.first().click();
      // Confirm the value landed - guards against a still-rendering panel.
      await select.locator('.ng-value').waitFor({ state: 'visible', timeout });
      return;
    } catch (e) {
      lastError = e;
      await page.keyboard.press('Escape');
    }
  }
  throw lastError;
}

/** Read the currently selected label of an ng-select ('' when empty). */
async function getNgValue(page, selector) {
  const value = page.locator(selector).locator('.ng-value-label');
  if (!(await value.count())) return '';
  return (await value.first().textContent() || '').trim();
}

/** Clear an ng-select via its × button. */
async function clearNgSelect(page, selector) {
  const clear = page.locator(selector).locator('.ng-clear-wrapper');
  if (await clear.count()) await clear.click();
}

/** All option labels currently offered by an ng-select. */
async function getNgOptions(page, selector) {
  await page.locator(selector).locator('.ng-select-container').click();
  const panel = page.locator('.ng-dropdown-panel .ng-option');
  await panel.first().waitFor({ state: 'visible' });
  const labels = (await panel.allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  return labels;
}

const RE_SPECIALS = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

function escapeRe(s) {
  return [...s].map((ch) => (RE_SPECIALS.has(ch) ? '\\' + ch : ch)).join('');
}

module.exports = { selectNgOption, getNgValue, clearNgSelect, getNgOptions };
