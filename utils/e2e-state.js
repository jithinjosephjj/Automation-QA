const fs = require('fs');
const path = require('path');

/**
 * Shared state for the Production end-to-end workflow chain
 * (Concept → Job Work → Job Assignment → Process Movement → Worker
 * Issue/Receipt → Job Finalize).
 *
 * This is INTEGRATION testing: each step consumes the previous step's output
 * (document numbers, ids), so the chain persists them here between tests and
 * across runs. A step that completes writes its artifact; a rerun picks up
 * exactly where the chain stopped. reset() starts a fresh workflow.
 */

/**
 * The project lives in a OneDrive-synced folder: the sync client can hold a
 * state file open for a moment right after a write, and the next write then
 * fails with "UNKNOWN: unknown error, open ..." (seen 19-09-2026). Retry a few
 * times before letting a whole passing step fail on its bookkeeping.
 */
function writeJsonWithRetry(file, value, attempts = 6) {
  const text = JSON.stringify(value, null, 2);
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.writeFileSync(file, text);
      return;
    } catch (e) {
      lastError = e;
      const until = Date.now() + 250 * i;
      while (Date.now() < until) { /* short synchronous back-off */ }
    }
  }
  throw lastError;
}

/** Factory: one state file per workflow chain. */
function makeState(fileName) {
  const file = path.join(__dirname, '..', fileName);
  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const writeState = (patch) => {
    const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
    writeJsonWithRetry(file, next);
    return next;
  };
  const reset = () => {
    writeJsonWithRetry(file, { startedAt: new Date().toISOString() });
  };
  return { readState, writeState, reset, STATE_FILE: file };
}

// default chain (Concept-based production flow) - keeps the original API
const defaultState = makeState('e2e-production-state.json');

module.exports = { ...defaultState, makeState };
