const fs = require('fs');
const path = require('path');

/**
 * Sioniquser<N> iteration counter for the Employee -> User -> Smith chain.
 *
 * Naming convention (per QA lead, 23-08-2026 screenshot):
 *   First Name  : Sioniq
 *   Last Name   : user<N>
 *   Display Name: Sioniquser<N>   (also the User page Name + Login Name)
 *   Sales Code  : RT<N>           (dynamic per iteration, Manual generation)
 *   Password    : 123 for every user
 *
 * The counter lives in sioniquser-counter.json at the project root and is
 * bumped ONLY by commit() after the whole chain succeeds, so a failed run
 * retries the same number instead of leaving gaps.
 */
const COUNTER_FILE = path.join(__dirname, '..', 'sioniquser-counter.json');

function currentN() {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).next || 1;
  } catch {
    return 1;
  }
}

/** 1 -> "one", 21 -> "twentyone" ... for fields that reject digits. */
function numberInWords(n) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + ones[n % 10];
  return numberInWords(Math.floor(n / 100)) + 'hundred' + numberInWords(n % 100);
}

function nextSioniqUser() {
  const n = currentN();
  return {
    n,
    firstName: 'Sioniq',
    lastName: `user${n}`,
    displayName: `Sioniquser${n}`,
    // The User page Name field REJECTS digits - spell the number instead.
    nameInWords: `Sioniquser${numberInWords(n)}`,
    salesCode: `RT${n}`,
    email: `sioniquser${n}@sioniq.com`,
    // unique-enough 10-digit mobile: 9 + last 9 of epoch millis
    mobile: '9' + String(Date.now()).slice(-9),
    password: '123',
  };
}

/** Call only after employee + user + smith have ALL saved. */
function commit(n) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next: n + 1 }, null, 2));
}

module.exports = { nextSioniqUser, commit, currentN };
