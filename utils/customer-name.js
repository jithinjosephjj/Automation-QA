const { makeState } = require('./e2e-state');

/**
 * Sequential all-alpha customer names: SioniqCustomerone, ...two, ...three
 * (a persisted counter in customer-counter.json; words avoid the digit
 * rejection some Name fields have). Shared by the CRM add spec and the
 * chains that register a retail customer of their own (30-10-2026).
 */
const counter = makeState('customer-counter.json');

function numberToWords(n) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + ones[n % 10];
  return `${ones[Math.floor(n / 100)]}hundred${numberToWords(n % 100)}`;
}

function nextCustomerName() {
  const n = (counter.readState().next || 1);
  counter.writeState({ next: n + 1 });
  return `SioniqCustomer${numberToWords(n)}`;
}

/** A dynamic 10-digit Indian mobile number (duplicate contacts are blocked). */
function uniqueMobileNumber() {
  return `9${String(Date.now()).slice(-9)}`;
}

module.exports = { nextCustomerName, uniqueMobileNumber, numberToWords };
