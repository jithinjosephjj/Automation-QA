#!/usr/bin/env node
/**
 * Parallel e2e run: 4 independent lanes at the same time, then the tag-relay
 * tail alone. Cuts the full run (229 tests, 5.1 h serial on 26-09-2026) to
 * roughly the longest lane (~1.5-2 h).
 *
 * Why lanes and not `--workers=4`: Playwright spreads files over workers in
 * any order, but these chains share qa resources that must not overlap:
 *   - the barcode TAG COUNTER is shared by all business units and resets to 1
 *     whenever a tag with another date part is generated (Kakkanad 23/06 vs
 *     Cochin 24-25/06, bug report 28-09-2026) -> the tag relay, which tags at
 *     Kakkanad, runs ALONE after every barcode lane has finished;
 *   - Asmi's locker (material issue / internal transfer) -> one lane;
 *   - the casting worker Sioniquser16 / CAD worker Prabhat queues ->
 *     production in one lane; the inhouse samples use their own worker
 *     (SAMPLE_WORKER, default Sioniquser33).
 * Each lane is a chain of `playwright test` runs with 1 worker (one run per
 * STEP: a run executes its files alphabetically, so order-critical parts -
 * masters before the CAD chain, the relay legs - are separate steps).
 *
 * Every step writes its own test-results folder (a run clears its output
 * dir) and a blob report; they are merged into playwright-report/ (HTML) and
 * results.json at the end. Logs: logs/parallel/<lane>.log.
 *
 * Four lane groupings, 3 running at a time (--concurrency=N), all on Chromium;
 * --firefox=<lanes> runs those lanes on the no-auth-firefox project (the
 * prewarm and the tail stay on Chromium).
 *
 * Usage:
 *   npm run test:parallel                    all lanes (3 at a time) + tail
 *   npm run test:parallel -- --concurrency=4 all 4 lanes at once (needs more than 8 GB RAM)
 *   npm run test:parallel -- --lanes=1,3     only lanes 1 and 3 (no tail)
 *   npm run test:parallel -- --firefox=3,4   lanes 3 and 4 on Firefox, 1 and 2 on Chromium
 *   npm run test:parallel -- --chromium      every lane on Chromium
 *   npm run test:parallel -- --no-tail       lanes 1-4 without the relay
 *   npm run test:parallel -- --failed        re-run the spec files that failed last time
 *   npm run test:parallel -- --dry-run       print the plan, run nothing
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const E2E = (n) => `tests/e2e/${n}-workflow.noauth.spec.js`;

const PREWARM = { name: 'prewarm', steps: [['tests/setup/prewarm-sessions.noauth.spec.js']] };

// FOUR lanes, 2 Chromium + 2 Firefox (29-09-2026). The shared resources
// decide the grouping:
//   lane 1 - Cochin inward -> lot -> barcode (as suja) -> counter / sales,
//            plus the stone and other inward chains (nothing shared beyond
//            the barcode user);
//   lane 2 - production (Sioniquser16 / Prabhat queues);
//   lane 3 - the 5 B2B sample chains (the inhouse ones cast with their own
//            worker SAMPLE_WORKER, default Sioniquser33);
//   lane 4 - masters, then Asmi's locker (CAD material, MD settlement,
//            internal transfer).
// CONCURRENCY: at most 3 lanes run at the same time (--concurrency=N); the
// 4th starts when the first finishes. Four headed browsers with video
// recording exhaust this 8 GB machine (29-09-2026: CPU 100 %, 88 MB free ->
// page loads hung 60-90 s, 18 chains lost a step in the 4-Chromium run; the
// 2 Chromium + 2 Firefox run lost both Firefox lanes entirely). Raise it only
// on a machine with more memory.
// Browser per lane: `browser` below is the default (all Chromium);
// --firefox=3,4 puts those lanes on the no-auth-firefox project of
// playwright.config.js, --chromium forces every lane back. Firefox passes the
// qa login gate and the session replay, so it works for cross-browser runs,
// but it needs the same memory headroom as a Chromium lane.
const LANES = [
  {
    name: 'lane1-inward-barcode-sales-stone',
    browser: 'chromium',
    steps: [[
      'approval-issue-receipt-sales', 'logistics-goods-receipt-sales', 'metal-inward-grn-to-grn-sales-invoice',
      'metal-inward-purchase-return', 'metal-inward-barcode-lot-yes', 'b2b-order-outsource-lot-barcode',
      'order-outsource-lot-barcode', 'jobwork-direct-outsource-lot-barcode', 'brand-inward-lot-barcode',
      'stone-inward-lot-barcode', 'stone-assorted-lot-barcode',
      'stone-assorted-certification', 'stone-assorted-certification-tare', 'stone-inward-certification',
      'metal-inward-hallmark', 'metal-inward-remodel', 'goods-receipt-grn-metal-inward', 'metal-inward-grn',
      'metal-inward-direct-purchase-return', 'bullion-booking-inward', 'repair-outsource',
    ].map(E2E)],
  },
  {
    name: 'lane2-production',
    browser: 'chromium',
    steps: [[
      'production-concept', 'order-inhouse-production', 'b2b-order-inhouse-production',
      'b2b-order-inhouse-barcode-counter-transfer', 'production-master-design', 'jobwork-direct-inhouse-production',
      'repair-inhouse-production',
    ].map(E2E)],
  },
  {
    name: 'lane3-samples',
    browser: 'chromium',
    steps: [[
      'b2b-sample-outsource-delivery', 'b2b-sample-registration-outsource', 'b2b-sample-inhouse',
      'b2b-sample-inhouse-usedinprod', 'b2b-sample-registration-inhouse-production',
    ].map(E2E)],
  },
  {
    name: 'lane4-masters-material',
    browser: 'chromium',
    steps: [
      // masters first: the CAD / MD-settlement chains cast with the Sioniquser it creates
      ['tests/masters/master-add-operations.noauth.spec.js'],
      ['production-cad-material', 'production-master-design-settlement', 'metal-inward-internal-stock-transfer'].map(E2E),
    ],
  },
];
const PROJECT = { chromium: 'no-auth', firefox: 'no-auth-firefox' };

// ALONE, after lanes 1-4, legs in relay order (each leg reads the previous leg's state)
const TAIL = {
  name: 'tail-tag-relay',
  steps: ['tag-relay-1-ho-ho', 'tag-relay-2-ho-branch', 'tag-relay-3-branch-branch', 'tag-relay-4-branch-ho'].map((n) => [E2E(n)]),
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noTail = args.includes('--no-tail');
const laneArg = (args.find((a) => a.startsWith('--lanes=')) || '').split('=')[1];
const pickLanes = laneArg ? laneArg.split(',').map((x) => Number(x.trim())) : null;
// --firefox=3,4 runs those lanes (1-based) on Firefox and the rest on Chromium;
// --chromium runs every lane on Chromium; neither keeps each lane's default.
const firefoxArg = (args.find((a) => a.startsWith('--firefox=')) || '').split('=')[1];
const firefoxLanes = firefoxArg ? firefoxArg.split(',').map((x) => Number(x.trim())) : null;
const allChromium = args.includes('--chromium');
const concurrency = Math.max(1, Number((args.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1] || 3));
LANES.forEach((lane, i) => {
  if (allChromium) lane.browser = 'chromium';
  else if (firefoxLanes) lane.browser = firefoxLanes.includes(i + 1) ? 'firefox' : 'chromium';
});
// --smoke: 2 short READ-ONLY lanes at the same time - checks the runner
// itself (parallel processes, per-lane output, blob merge) in ~5 minutes
const SMOKE = [
  { name: 'smoke-a', steps: [['tests/probe/full-run-failures-evidence-probe.noauth.spec.js']] },
  { name: 'smoke-b', steps: [['tests/probe/amount-decimals-probe.noauth.spec.js']] },
];
const smoke = args.includes('--smoke');
const onlyFailed = args.includes('--failed');

/**
 * --failed: the spec files that had a failing test in the last merged
 * results.json (Playwright's JSON report: spec.ok === false), so a re-run
 * checks exactly the failures and nothing else - each spec stays in its own
 * lane (the resource rules still hold), empty steps and lanes are dropped.
 */
function failedSpecFiles() {
  const p = path.join(ROOT, 'results.json');
  if (!fs.existsSync(p)) { console.error('--failed: no results.json (run the suite or merge-reports first)'); process.exit(1); }
  const report = JSON.parse(fs.readFileSync(p, 'utf8'));
  const failed = new Set();
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      if (spec.ok === false && spec.file) failed.add(spec.file.replace(/\\/g, '/').replace(/^tests\//, ''));
    }
  };
  walk({ suites: report.suites });
  return failed;
}
function keepFailed(lane, failed) {
  const steps = lane.steps
    .map((files) => files.filter((f) => failed.has(f.replace(/\\/g, '/').replace(/^tests\//, ''))))
    .filter((files) => files.length);
  return steps.length ? { ...lane, steps } : null;
}

let lanes = smoke ? SMOKE : pickLanes ? LANES.filter((_, i) => pickLanes.includes(i + 1)) : LANES;
let tail = TAIL;
if (onlyFailed) {
  const failed = failedSpecFiles();
  console.log(`--failed: ${failed.size} spec file(s) had failures in results.json`);
  lanes = lanes.map((l) => keepFailed(l, failed)).filter(Boolean);
  tail = keepFailed(TAIL, failed);
}
const runTail = !noTail && !pickLanes && !smoke && !!tail;

const LOG_DIR = path.join(ROOT, 'logs', 'parallel');
const BLOB_DIR = path.join(ROOT, 'blob-reports');

function stamp() { return new Date().toTimeString().slice(0, 8); }
function mins(ms) { return `${(ms / 60000).toFixed(1)} min`; }

/** One `playwright test` run (1 worker) for a list of files; resolves {code, passed, failed}. */
function runStep(laneName, stepIndex, files, log, browser = 'chromium') {
  return new Promise((resolve) => {
    const tag = `${laneName}#${stepIndex + 1}`;
    const project = PROJECT[browser] || PROJECT.chromium;
    const missing = files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    if (missing.length) {
      log.write(`[${stamp()}] ${tag}: MISSING spec files ${JSON.stringify(missing)} - step skipped\n`);
      console.log(`[${stamp()}] ${tag}: missing spec files ${missing.join(', ')} - step skipped`);
      resolve({ code: 1, passed: 0, failed: 0, missing: missing.length });
      return;
    }
    const env = {
      ...process.env,
      // 4 browsers make qa slow: scale the page objects' explicit waits (utils/timeouts.js)
      // and Playwright's default action / navigation timeouts (playwright.config.js)
      PW_TIMEOUT_FACTOR: process.env.PW_TIMEOUT_FACTOR || '3',
      PW_ACTION_TIMEOUT: process.env.PW_ACTION_TIMEOUT || '45000',
      PW_NAV_TIMEOUT: process.env.PW_NAV_TIMEOUT || '90000',
      PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(BLOB_DIR, `${tag.replace(/[^a-z0-9#-]/gi, '_').replace('#', '-')}.zip`),
    };
    const cmd = ['playwright', 'test', ...files, `--project=${project}`, '--workers=1',
      `--output=test-results/${laneName}-${stepIndex + 1}`, '--reporter=list,blob'];
    log.write(`\n[${stamp()}] ${tag}: npx ${cmd.join(' ')}\n`);
    const child = spawn(['npx', ...cmd].join(' '), { cwd: ROOT, env, shell: true }); // one command string: paths are relative, no spaces
    let passed = 0; let failed = 0; let buf = '';
    const onData = (d) => {
      const text = d.toString();
      log.write(text);
      buf += text;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^\s+(ok|x|✓|✘)\s+\d+\s+\[no-auth(?:-firefox)?\]\s+›\s+(\S+?)(?::\d+:\d+)?\s+›\s+(.*)$/);
        if (m) {
          const ok = m[1] === 'ok' || m[1] === '✓';
          if (ok) passed++; else failed++;
          const title = m[3].split(' › ').pop();
          console.log(`[${stamp()}] ${laneName.padEnd(34)} ${ok ? 'PASS' : 'FAIL'}  ${title.slice(0, 110)}`);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => resolve({ code, passed, failed }));
  });
}

async function runLane(lane) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(LOG_DIR, `${lane.name}.log`), { flags: 'w' });
  const t0 = Date.now();
  let passed = 0; let failed = 0; let worst = 0;
  console.log(`[${stamp()}] ${lane.name}: start (${lane.steps.reduce((n, s) => n + s.length, 0)} spec files, ${lane.steps.length} step(s), ${lane.browser || 'chromium'})`);
  for (const [i, files] of lane.steps.entries()) {
    const r = await runStep(lane.name, i, files, log, lane.browser);
    passed += r.passed; failed += r.failed; worst = Math.max(worst, r.code || 0);
  }
  log.end();
  const res = { name: lane.name, passed, failed, code: worst, ms: Date.now() - t0 };
  console.log(`[${stamp()}] ${lane.name}: done in ${mins(res.ms)} - ${passed} passed, ${failed} failed`);
  return res;
}

function printPlan() {
  const show = (l) => {
    console.log(`\n${l.name} [${l.browser || 'chromium'}]`);
    l.steps.forEach((s, i) => console.log(`  step ${i + 1}: ${s.map((f) => path.basename(f).replace('.noauth.spec.js', '')).join(', ')}`));
  };
  console.log(`PLAN (${Math.min(concurrency, lanes.length)} lane(s) at a time; the tail runs alone afterwards)`);
  show(PREWARM);
  lanes.forEach(show);
  if (runTail) show(tail);
  const all = [PREWARM, ...lanes, ...(runTail ? [tail] : [])].flatMap((l) => l.steps.flat());
  const missing = all.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  console.log(`\n${all.length} spec files, ${missing.length} missing${missing.length ? ': ' + missing.join(', ') : ''}`);
}

async function mergeReports() {
  if (!fs.existsSync(BLOB_DIR) || !fs.readdirSync(BLOB_DIR).some((f) => f.endsWith('.zip'))) return;
  console.log(`[${stamp()}] merging ${fs.readdirSync(BLOB_DIR).filter((f) => f.endsWith('.zip')).length} blob reports -> playwright-report/ + results.json`);
  await new Promise((resolve) => {
    const child = spawn('npx playwright merge-reports --reporter=html,json blob-reports', {
      cwd: ROOT, shell: true, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: 'results.json', PLAYWRIGHT_HTML_OPEN: 'never' },
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', resolve);
  });
}

(async () => {
  printPlan();
  if (dryRun) return;
  const t0 = Date.now();
  fs.rmSync(BLOB_DIR, { recursive: true, force: true });
  fs.mkdirSync(BLOB_DIR, { recursive: true });

  const warm = await runLane(PREWARM);
  if (warm.failed) {
    console.log(`[${stamp()}] prewarm failed - qa login is not working; stopping before the lanes start`);
    process.exitCode = 1;
    return;
  }

  // lane pool: `concurrency` lanes at a time, the next lane starts as soon as one finishes
  const results = [];
  const queue = [...lanes];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const lane = queue.shift();
      results.push(await runLane(lane));
    }
  }));
  if (runTail) results.push(await runLane(tail));

  await mergeReports();
  const passed = results.reduce((n, r) => n + r.passed, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  console.log(`\n==== PARALLEL RUN done in ${mins(Date.now() - t0)} - ${passed} passed, ${failed} failed ====`);
  for (const r of results) console.log(`  ${r.name.padEnd(36)} ${mins(r.ms).padStart(9)}  ${String(r.passed).padStart(3)} passed  ${String(r.failed).padStart(3)} failed`);
  console.log('Report: npx playwright show-report   |   lane logs: logs/parallel/');
  process.exitCode = failed || results.some((r) => r.code) ? 1 : 0;
})();
