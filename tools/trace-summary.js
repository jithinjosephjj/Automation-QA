// Usage: unzip test-results/<dir>/trace.zip -d <dir> ; node tools/trace-summary.js <dir> [minSeconds]
// Finds where a test spends its time: long actions, idle gaps, time per page-object caller, slow API calls.
const fs = require('fs');
const path = require('path');
const T = process.argv[2];
const gapMin = Number(process.argv[3] || 1.0);

let ev = [];
for (const f of fs.readdirSync(T).filter((f) => f.endsWith('.trace'))) {
  for (const l of fs.readFileSync(path.join(T, f), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { ev.push(JSON.parse(l)); } catch {}
  }
}
const ends = new Map(ev.filter((e) => e.type === 'after').map((e) => [e.callId, e.endTime]));
const acts = ev
  .filter((e) => e.type === 'before' && e.class !== 'Test')
  .map((e) => {
    const p = e.params || {};
    const desc = [
      e.apiName || e.title || '',
      p.selector ? p.selector.slice(0, 70) : '',
      p.value !== undefined ? '=' + String(p.value).slice(0, 25) : '',
      p.state ? 'state=' + p.state : '',
      p.timeout && /waitForTimeout/.test(e.apiName || '') ? 'ms=' + p.timeout : '',
    ].filter(Boolean).join(' ');
    return { t: e.startTime, end: ends.get(e.callId) || e.startTime, s: desc, id: e.callId, stack: e.stack };
  })
  .sort((a, b) => a.t - b.t);
const t0 = acts[0].t;
const tEnd = Math.max(...acts.map((a) => a.end));
console.log(`total ${((tEnd - t0) / 1000).toFixed(1)} s, ${acts.length} actions`);

// long actions (>= gapMin s) with the calling page-object frame
console.log(`\n--- actions >= ${gapMin}s (start, duration, action, caller)`);
const frameOf = (a) => {
  const fr = (a.stack || []).find((f) => /pages[\\/]/.test(f.file)) || (a.stack || []).find((f) => /tests[\\/]/.test(f.file));
  return fr ? `${path.basename(fr.file)}:${fr.line}` : '';
};
let longTotal = 0;
for (const a of acts) {
  const d = (a.end - a.t) / 1000;
  if (d >= gapMin) { longTotal += d; console.log(((a.t - t0) / 1000).toFixed(1).padStart(7), ('+' + d.toFixed(1)).padStart(6), a.s.slice(0, 90).padEnd(90), frameOf(a)); }
}
console.log(`long actions total: ${longTotal.toFixed(1)} s`);

// idle gaps between consecutive actions (test code / JS time, not Playwright waits)
console.log(`\n--- gaps >= ${gapMin}s between actions`);
let gapTotal = 0;
let lastEnd = t0;
for (const a of acts) {
  const gap = (a.t - lastEnd) / 1000;
  if (gap >= gapMin) { gapTotal += gap; console.log(((lastEnd - t0) / 1000).toFixed(1).padStart(7), ('+' + gap.toFixed(1)).padStart(6), 'before', a.s.slice(0, 80), frameOf(a)); }
  lastEnd = Math.max(lastEnd, a.end);
}
console.log(`gaps total: ${gapTotal.toFixed(1)} s`);

// time by page-object method (sum of action durations attributed to the innermost pages/ frame)
console.log('\n--- time by page-object caller (top 15)');
const byFrame = new Map();
for (const a of acts) {
  const k = frameOf(a) || '(spec)';
  byFrame.set(k, (byFrame.get(k) || 0) + (a.end - a.t) / 1000);
}
[...byFrame.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).forEach(([k, v]) => console.log(v.toFixed(1).padStart(7), k));

// slow API calls
const netFile = fs.readdirSync(T).find((f) => f.endsWith('.network'));
if (netFile) {
  const net = fs.readFileSync(path.join(T, netFile), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const slow = net.map((e) => e.snapshot).filter((s) => s && s.request && /sioniq\//.test(s.request.url) && s.time > 1500)
    .map((s) => `${(s.time / 1000).toFixed(1)}s ${s.request.method} ${s.request.url.split('/sioniq/')[1].split('?')[0].slice(0, 70)} ${s.response && s.response.status}`);
  console.log(`\n--- API calls slower than 1.5 s (${slow.length})`);
  slow.forEach((x) => console.log('  ' + x));
}
