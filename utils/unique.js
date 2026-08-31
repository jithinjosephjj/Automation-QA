/**
 * Unique test data.
 *
 * Sioniq blocks duplicate invoice / reference numbers, so a hardcoded value
 * passes on the first run and fails on every run after it. Always generate.
 */

const RUN_ID = `${Date.now().toString(36)}`.toUpperCase();

/** e.g. AUT-INV-LZ4K91-3 */
let seq = 0;
function uniqueRef(prefix = 'AUT') {
  seq += 1;
  return `${prefix}-${RUN_ID}-${seq}`;
}

function uniqueInvoiceNo() {
  return uniqueRef('AUT-INV');
}

/** Today (or an offset) as dd-MM-yyyy, the format Sioniq date inputs accept. */
function businessDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Weight string with the 3 decimals the app stores. */
function weight(n) {
  return Number(n).toFixed(3);
}

module.exports = { RUN_ID, uniqueRef, uniqueInvoiceNo, businessDate, weight };
