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
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
    return next;
  };
  const reset = () => {
    fs.writeFileSync(file, JSON.stringify({ startedAt: new Date().toISOString() }, null, 2));
  };
  return { readState, writeState, reset, STATE_FILE: file };
}

// default chain (Concept-based production flow) - keeps the original API
const defaultState = makeState('e2e-production-state.json');

module.exports = { ...defaultState, makeState };
