const fs = require('fs');
const path = require('path');

/**
 * Cached browser sessions, one file per user@BU under auth/sessions/.
 *
 * The Sioniq auth token (_SIONIQ_AUTH, a 120-minute JWT) lives in
 * sessionStorage, which Playwright's storageState never captures - so every
 * test used to log in through the form (~10 s). Verified live (19-09-2026):
 * the token does NOT rotate across navigations (KeepAlive returns no new
 * token) and an older copy stays valid in a fresh browser context, so one
 * form login per user can be replayed by injecting the storage into each
 * new context. See LoginPage.ensureLoggedIn().
 */
const DIR = path.join(__dirname, '..', 'auth', 'sessions');
const TOKEN_KEY = '_SIONIQ_AUTH';
const EXPIRY_MARGIN_MS = 10 * 60_000; // refresh well before the JWT dies mid-test

function file(user, bu) {
  const safe = (s) => String(s).replace(/[^a-z0-9]+/gi, '_');
  return path.join(DIR, `${safe(user)}-${safe(bu)}.json`);
}

/** JWT exp (ms since epoch) of the stored token, or null when unreadable. */
function tokenExpiry(sessionStorage) {
  try {
    const raw = sessionStorage[TOKEN_KEY];
    const token = raw.startsWith('"') ? JSON.parse(raw) : raw;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The cached session for user@bu, or null when missing or about to expire. */
function load(user, bu) {
  const f = file(user, bu);
  if (!fs.existsSync(f)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!s.session || !s.session[TOKEN_KEY]) return null;
    const exp = tokenExpiry(s.session) ?? s.savedAt + 60 * 60_000;
    if (Date.now() > exp - EXPIRY_MARGIN_MS) return null;
    return s;
  } catch {
    return null;
  }
}

/** Snapshot the page's cookies + localStorage + sessionStorage into the cache. */
async function save(user, bu, page) {
  const storage = await page.evaluate(() => {
    const dump = (s) => Object.fromEntries(Object.keys(s).map((k) => [k, s.getItem(k)]));
    return { local: dump(localStorage), session: dump(sessionStorage) };
  });
  const cookies = await page.context().cookies();
  const landing = new URL(page.url()).pathname;
  fs.mkdirSync(DIR, { recursive: true });
  const record = { user, bu, savedAt: Date.now(), landing, cookies, ...storage };
  fs.writeFileSync(file(user, bu), JSON.stringify(record));
  return record;
}

function clear(user, bu) {
  fs.rmSync(file(user, bu), { force: true });
}

module.exports = { load, save, clear, TOKEN_KEY };
