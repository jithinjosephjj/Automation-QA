/**
 * Load-scaled waits. Every explicit `timeout:` in the page objects was tuned
 * for one lane on a quiet qa; in the parallel run of 29-09-2026 (4 lanes)
 * 18 of 19 primary failures were exactly those waits expiring while the
 * loading overlay was still up: 15 s clicks, 30 s list-page Add-button waits,
 * 30 s login navigations, the 5 s "Barcode or Lot?" No click.
 *
 * T(ms) multiplies a wait by PW_TIMEOUT_FACTOR (default 1, so single-lane
 * runs are unchanged); scripts/run-parallel.js sets it to 3. Only genuine
 * waits are scaled - a wait that finishes early still finishes early.
 */
const FACTOR = Math.max(1, Number(process.env.PW_TIMEOUT_FACTOR || 1));

/** @param {number} ms */
function T(ms) {
  return Math.round(ms * FACTOR);
}

module.exports = { T, FACTOR };
