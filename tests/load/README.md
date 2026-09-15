# Load Sweep suite

Opens **every sidebar page** of the app and clicks its **Add (+)** button,
verifying each page loads without an issue. "Load testing" here means
page-load verification across the whole application (single user) — it is
NOT a concurrency/stress test.

## What each page is checked for

| Check | Fails the sweep when |
|---|---|
| Real content renders | body text under 150 chars, or "under construction" / "page not found" |
| Loader clears | the ngx-spinner overlay never hides (stuck loader) |
| Add (+) works | an Add button exists but clicking it opens no form/wizard/modal |
| Console errors | reported only — the app's known baseline is 3/page, WARN at ≥ 6 |

Pages with **no Add button** (config/monitor/inbox screens) pass — that is by
design; the report marks them `none`.

## How it runs

- `LOAD-00` logs in and **discovers all routes at runtime** by expanding the
  sidebar (same approach as the perf runbook) — new pages are swept
  automatically, no route list to maintain.
- One test per module (adm/ite/prc/inv/prd/sls/pos/fin/ema/hrm/crm/other), so
  one broken module doesn't kill the sweep; each failure message lists every
  offending route in that module.
- `LOAD-99` compiles `last-sweep-report.md` — one row per page.

## Run

```bash
npm run test:load
```

Full sweep is ~120 pages and takes roughly 25–40 minutes headed.
MUST run headed (Device Radar gate + Local Network Access — see repo README).

Sweep one module only:

```bash
npx playwright test tests/load --headed --project=no-auth --grep "LOAD-00|LOAD-PRC|LOAD-99"
```

(`LOAD-00` must run first in a fresh sweep — it writes `.discovered-routes.json`
and resets the results; the module tests read from it.)
