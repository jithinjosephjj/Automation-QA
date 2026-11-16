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
  setNext(n + 1);
}

/**
 * Point the counter at iteration n. The masters suite calls this at the
 * start of a run after reading qa: the last Sioniquser on the Employee list
 * + 1 when its chain is complete, the same number when it was cut short.
 * qa is the source of truth; the file only mirrors it for the later steps
 * and for latestSioniqUser().
 */
function setNext(n) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next: n }, null, 2));
}

/**
 * A second, independent series for the KAKKANAD masters chain (16-11-2026):
 * SioniqKkd<N> (first name Sioniq, last name kkd<N>, sales code KK<N>, email
 * sioniqkkd<N>@sioniq.com) counted in sioniqkkd-counter.json, so the Cochin
 * suite's Sioniquser<N> numbering is untouched.
 */
const KKD_COUNTER_FILE = path.join(__dirname, '..', 'sioniqkkd-counter.json');
function currentKkdN() {
  try { return JSON.parse(fs.readFileSync(KKD_COUNTER_FILE, 'utf8')).next || 1; } catch { return 1; }
}
function setNextKkd(n) { fs.writeFileSync(KKD_COUNTER_FILE, JSON.stringify({ next: n }, null, 2)); }
function commitKkd(n) { setNextKkd(n + 1); }
function nextSioniqKkdUser() {
  const n = currentKkdN();
  return {
    n,
    firstName: 'Sioniq',
    lastName: `kkd${n}`,
    displayName: `SioniqKkd${n}`,
    nameInWords: `SioniqKkd${numberInWords(n)}`,
    salesCode: `KK${n}`,
    email: `sioniqkkd${n}@sioniq.com`,
    mobile: '8' + String(Date.now()).slice(-9),
    password: '123',
  };
}

/**
 * The Sioniquser the masters suite created LAST (the iteration before
 * "next"): the production chains use it as their freshly created inhouse
 * worker, so a run of tests/masters followed by a chain always exercises
 * the newest employee without editing any spec.
 */
function latestSioniqUser() {
  const n = Math.max(1, currentN() - 1);
  return { n, displayName: `Sioniquser${n}` };
}

module.exports = {
  nextSioniqKkdUser, currentKkdN, setNextKkd, commitKkd, nextSioniqUser, latestSioniqUser, commit, setNext, currentN };
