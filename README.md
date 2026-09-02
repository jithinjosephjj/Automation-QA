# Sioniq Playwright Automation

UI automation suite for the Sioniq QA environment. Playwright + JavaScript, Page Object Model.

Built to the conventions in `Playwright-Automation-Basics.pdf`.

---

## Status

| Layer | State |
|---|---|
| Config, fixtures, utils, reporters | Verified working |
| Login page object + login suite | **5 tests passing** against qa.sioniq.com |
| Metal Inward page object + TC-MI-001 add-record E2E | **Passing headed** — submits a real record, asserts voucher no, opens report preview |
| Brand Inward page object + TC-BRIN-001 add-record E2E | **Passing headed** — same journey on the Brand tab (MRP pricing, manual hierarchy) |
| Stone Inward page object + TC-E2E-001 add-record E2E | **Passing headed** — Stone tab without tare (UOM conversion, auto rate, discount/return %) |
| Alloy Inward page object + TC-AI-001 add-record E2E | **Passing headed** — single-screen form at /prc/view-alloy-inward; pricing asserted via self-consistency poll (tax engine lands values one at a time) |
| Bullion Inward page object + TC-BUI-001 add-record E2E | **Blocked by app bug (29-08-2026)** — flow updated for the new mandatory Additional Charges (item-level + bill-level before Add Items); Submit now silently does nothing after Add Items. Spec turns green when dev fixes Submit |
| Master add operations (tests/masters/master-add-operations) | **Passing headed** — TC-EMP-001 Employee → TC-USR-001 User → TC-SMH-001 Smith → TC-CNT-001 Locker Counter → TC-ELC-001 Locker Assignment, one Sioniquser&lt;N&gt; iteration per run |
| Production E2E workflow (tests/e2e/production-concept-workflow, TC-PRD-E2E-01…08) | **All 8 steps passing headed** — Concept (create/upload/approve) → Job Work → Assignment → Movement Accept → Worker Issue/Receipt (CAD) → Transfer+Accept (Casting) → Issue/Receipt with item → Job Finalize + barcode. Integration chain: document numbers flow via e2e-production-state.json; every step resumes/skips what's already done |
| Master Design E2E workflow (tests/e2e/production-master-design-workflow, TC-PRD-MD-01…08) | **All 8 steps passing headed** — same chain seeded from Master Design (design RDDDD# series); own state file. Known app bug encoded: filtering the Design Number dropdown on Job Work breaks Submit silently — the spec selects the design card from the full grid instead |
| Order - Inhouse - Production workflow (tests/e2e/order-inhouse-production-workflow, TC-PRD-OB-01…08) | **All 8 steps passing headed** — Order Booking → inhouse Job Work (Procurement > Issue: Order/Inhouse/Cochin, PP## series) → same downstream to the barcode; own state file |
| Order - Outsource - Lot - Barcode workflow (tests/e2e/order-outsource-lot-barcode-workflow, TC-OLG-01…05) | **All 5 steps passing headed** — Stock Order → outsource Job Work (Issue: Order/Outsource/vendor RAJA, PP##) → Metal Inward jobwork return (Sub Txn "Jobwork" + Inward Type "Order"; one `jobWorkItemNo` pick fills the item, M##) → Lot Generation (/inv/view-lot-generation, employee Ubaid + BU Cochin, NNN##) → Barcode (/inv/view-barcode-generation **as user suja**; three mandatory description dropdowns; tag verified in Generated Tags); own state file e2e-order-lot-state.json |
| B2B Order - Inhouse - Production workflow (tests/e2e/b2b-order-inhouse-production-workflow, TC-B2B-PRD-01…08) | **All 8 steps passing headed** — B2B Order Booking (customer Luxurio, Making Type "Job Work", BB## series) → inhouse Job Work (the Issue grid lists B2B orders under Generation Type "Order" too, PP##) → same downstream to the barcode; own state file e2e-b2border-state.json |
| B2B Order - Outsource - Lot - Barcode workflow (tests/e2e/b2b-order-outsource-lot-barcode-workflow, TC-B2B-OLG-01…05) | **All 5 steps passing headed** — B2B Order Booking (Making Type "Job Work", BB##, + Add Files image) → outsource Job Work (vendor RAJA, PP##) → Metal Inward jobwork return (M##) → Lot Generation (NNN##) → Barcode **as user suja** (tag verified in Generated Tags); print-preview checks at every Print dialog; own state file e2e-b2b-order-lot-state.json |
| B2B Sample - Outsource - Delivery workflow (tests/e2e/b2b-sample-outsource-delivery-workflow, TC-B2B-SD-01…04) | **All 4 steps passing headed** — B2B order + Add Sample panel (manual Rate, Yes-confirm) registers the sample under its OWN sample no → Sample Issue outsource (Issue page Sample tab, vendor RAJA) → Sample Receipt (/prc/app-repair-setup Sample tab, Submit Receipt) → Sample Delivery (/sls/app-sample-setup, dispatch Our Employee); grids key by the sample no, captured post-save; own state file e2e-b2b-sample-delivery-state.json |
| B2B Sample Registration - Outsource workflow (tests/e2e/b2b-sample-registration-outsource-workflow, TC-B2B-SR-01…05) | **All 5 steps passing headed** — plain B2B order (no sample) → Sample Registration page registers a sample AGAINST the order no (RC No. typeahead + record-wise Add Sample panel, then wizard Next → Submit; CreateSample returns the sample no) → outsource issue → receipt → delivery; own state file e2e-b2b-samplereg-state.json |
| B2B Sample Registration - Inhouse Production workflow (tests/e2e/b2b-sample-registration-inhouse-production-workflow, TC-B2B-SRI-01…09) | **All 9 steps passing headed** — B2B order → Sample Registration → inhouse Sample Issue (production unit Cochin) → Job Assignment (source "Sample" + Item Type/BU structural picks, save verified) → Process Movement → Worker Issue/Receipt ×2 (final Casting receipt checks **Finalize Sample**) → Sample Receipt (Repair page, Inhouse) → Sample Delivery. Samples have NO Job Finalize/barcode step. Own state file e2e-b2b-samplereg-inhouse-state.json |
| B2B Sample - Inhouse Production workflow (tests/e2e/b2b-sample-inhouse-workflow, TC-B2B-SMP-01…08) | **All 8 steps passing headed** — B2B order WITH sample (Add Sample panel + 2 images) → inhouse Sample Issue → Job Assignment (source "Sample"; samples from the order pop an Edit Item Details overlay confirmed via its footer Update) → Process Movement → Worker Issue/Receipt ×2 (final receipt checks **Finalize Sample**) → Sample Receipt (Inhouse) → Sample Delivery. Unblocked 01-09-2026 (Worker Issue/Receipt sample bug fixed). Own state file e2e-b2b-sample-state.json |
| B2B Repair - Outsource - Delivery workflow (tests/e2e/b2b-repair-outsource-workflow, TC-B2B-RPO-01…04) | **All 4 steps passing headed** — Repair Registration (customer Luxurio, Ring soldering, Expec Add/Loss weights per the repair-wastage config, REP series) → Repair Issue outsource (Issue page Repair tab, vendor, grid keyed "repairKey.1") → Repair Receipt (Outsource + Invoice + repair-no item picks + Add) → Repair Delivery (customer → row → Submit). Grids show "REP-…" while saves return the series prefix — matched on the shared core. Own state file e2e-b2b-repair-outsource-state.json |
| B2B Repair - Inhouse Production workflow (tests/e2e/b2b-repair-inhouse-production-workflow, TC-B2B-RPI-01…08) | **All 8 steps passing headed** — Repair Registration (Bangle repair) → Repair Issue inhouse → Job Assignment (source "Repair" + Business Type B2B; NO Item Type select on this form) → Process Movement → Worker rounds (Casting receipt = item form: Production No → **Repair Finalize** → **Add** (not "Add Items") → row in grid → Submit) → Repair Receipt (grid row + Add) → Repair Delivery. Worker issue/receipt submits now VERIFY the save fired (a silent no-op receipt slipped through before). Own state file e2e-b2b-repair-inhouse-state.json |
| Order Booking add (TC-OB-001, tests/sales/order-booking-add) | **Passing headed** — the CreateOrderBooking 400 bug was fixed by dev (verified 30-08-2026) |
| B2B Order Booking add (TC-B2B-001, tests/sales/b2b-order-booking-add) | **Passing headed** — confirmed via TC-B2B-PRD-01 (same flow) on 31-08-2026 after the endpoint fix |

The five master tests live in ONE file in declaration order — that is the
only ordering both the CLI and the VS Code test runner honour. Each test is
independent and idempotent (skips what already exists, creates its employee
prerequisite when run alone); the counter in `sioniquser-counter.json` is
bumped only by the final assignment test. Run the whole iteration:

```bash
npx playwright test tests/masters --headed
```

Or a single page's add operation by its TC id:

```bash
npx playwright test -g "TC-USR-001" --headed
```
| Saved-session auth (`global.setup.js`) | Works headed, but see the sessionStorage caveat below |

### Environment gates (both solved, both required)

**1. Device Radar agent.** Login submits only after the app confirms the Device
Radar desktop agent on `http://127.0.0.1:5151/status`. The agent must be running
on the machine (check for a `DeviceRadar` process). Without it, a
`Device Radar Required` modal blocks login and no auth request is ever sent.
The headless shell cannot reach the agent at all — **run everything `--headed`**.

**2. Chrome Local Network Access permission.** Newer Chrome shows a per-site
prompt — "qa.sioniq.com wants to access other apps and services on this device" —
before allowing the 127.0.0.1 call. A fresh automation profile can never click
Allow, so `playwright.config.js` launches Chromium with
`--disable-features=LocalNetworkAccessChecks`. In your own Chrome, click Allow
once (or Settings → Privacy and security → Site settings → qa.sioniq.com →
Local network access → Allow).

### sessionStorage caveat

The auth token (`_SIONIQ_AUTH`) lives in **sessionStorage**, which Playwright's
`storageState` does not capture. Saved-session reuse therefore does not work —
specs log in through the UI at the start of each test (see the TC-MI-001 spec)
and are named `*.noauth.spec.js` so they run in the fresh-context project.

---

## Setup

```bash
npm install
```

```bash
npx playwright install chromium
```

Then copy `.env.example` to `.env` and fill it in. `.env` is gitignored — never
commit credentials, never hardcode them in a spec.

```
SIONIQ_URL=https://qa.sioniq.com
SIONIQ_USER=admin
SIONIQ_PWD=123
SIONIQ_BU=Cochin
```

Note: the PDF references `qa.sioniq.ai`; that host no longer resolves. The live
QA environment is `qa.sioniq.com`.

---

## Commands

```bash
npm run test:ui
```

| Command | What it does |
|---|---|
| `npm test` | Run everything |
| `npm run test:headed` | Watch it run in Chromium |
| `npm run test:ui` | UI mode — best for learning and for picking locators |
| `npm run auth` | Log in once and save the session to `auth/` |
| `npm run test:inward` | Just the Inward specs |
| `npm run codegen` | Record clicks against QA, generates selectors |
| `npm run report` | Open the HTML report |
| `npm run trace -- test-results/<dir>/trace.zip` | Post-mortem a failure |

Filter to one case by its TC ID:

```bash
npx playwright test -g "TC-LOGIN-003"
```

---

## Layout

```
playwright.config.js     baseURL, timeouts, projects, reporters
.env                     credentials (gitignored)
fixtures/
  test-fixtures.js       import { test, expect } from here - page objects arrive built
pages/
  BasePage.js            ng-select helpers, loader waits, clickAndWaitForApi, toasts
  LoginPage.js           login form + Device Radar gate handling   [verified]
  BaseInwardPage.js      header / detail grid / totals / save      [selectors unconfirmed]
  MetalInwardPage.js     Metal Inward specifics                    [selectors unconfirmed]
tests/
  global.setup.js        logs in once -> auth/admin-cochin.json
  auth/login.noauth.spec.js    login suite                         [passing]
  inward/metal-inward.spec.js  Inward suite                        [skipped]
utils/
  ng-select.js           select / read / clear / enumerate ng-select dropdowns
  unique.js              unique invoice + reference numbers, dates, weights
  env.js                 validated env vars
auth/                    saved storageState (gitignored)
```

### Projects

Three, in `playwright.config.js`:

- **`no-auth`** — specs matching `*.noauth.spec.js`. No saved session, no dependency
  on `setup`, so the login screen itself is testable and the suite still runs while
  authentication is broken.
- **`setup`** — runs `global.setup.js`, writes `auth/admin-cochin.json`.
- **`chromium`** — everything else, starting from that saved session.

Serial by default (`workers: 1`): Sioniq shares voucher and reference series
across a business unit, so parallel workers collide on document numbering.

---

## Environment facts verified live

- Login inputs have **no `<label>` elements** — only `id` + placeholder. So
  `page.getByLabel('Username')` does **not** work here, contrary to the PDF snippet.
  Use `#username` / `#password`.
- The submit button reads **"Log In"**, not "Login".
- Business Unit is `ng-select#location`. Its options load from
  `GetLocationByLoginUser`, fired when the **username field loses focus** — the
  `.blur()` call in `LoginPage.login()` is load-bearing.
- BU options for `admin`: Aluva, Palakkad, Trivendrum, Cochin.
- `ng-select` is not a native `<select>`. `loc.selectOption()` silently does
  nothing on it — always go through `utils/ng-select.js`.
- The app sets `body { zoom: 0.9 }`, so full-page screenshots read small. Prefer
  element-scoped shots (`BasePage.shot(name, locator)`).

---

## Finishing the Inward layer

Once login works:

1. `npm run auth`
2. `npm run codegen`, navigate to Metal Inward, harvest the real selectors.
3. Replace the placeholder locators in `pages/BaseInwardPage.js` and
   `pages/MetalInwardPage.js`, and the `route` / `apiPattern` in the latter.
4. Change `test.describe.skip` to `test.describe` in
   `tests/inward/metal-inward.spec.js`.
5. For the other four Inward screens, subclass `BaseInwardPage` the way
   `MetalInwardPage` does — they share roughly 70% of the DOM.

Ask dev for `data-testid` attributes on the Inward fields. It is the single
highest-leverage change for the stability of this suite.

---

## Checklist for every NEW add-operation spec

Mandatory (QA lead directive) — every new page's add spec includes all of these:

1. **Login** only via the shared `LoginPage.login()` (self-healing field checks built in).
2. **Spinner guard** before clicking Add (`waitForSpinner()` — the transparent
   ngx-spinner overlay swallows clicks).
3. **Dropdowns** only via the retrying `pick()` / `pickByLabel()` helpers.
4. **Unique per-run data** (`utils/unique.js`); watch length limits (short names
   truncate at 5 chars) and character filters (digits/hyphens rejected on some fields).
5. **Verify Add Item registered** via the summary panel or grid — never trust the click.
6. **Verify Submit via the save response** — capture the POST, assert the success
   body, and fail loudly when no request fires (silent block = app bug to surface).
7. **Verify the record in the list view** after save — `verifyRowInList(<doc no>)`.
8. **Upload files** from `Demo files folder` via `utils/demo-files.js`, injected
   straight into `input[type=file]` (no Browse popup).
9. **Verify the print template** when the post-save Print dialog offers Preview —
   `verifyPrintPreview({screenshot})` opens it, asserts a report surface actually
   rendered (inline offcanvas or popup), and throws when the template is broken.

## Conventions

- `await` **every** `expect(locator)`. A missing `await` is a silent false pass.
- Prefer `getByTestId` / `getByRole`. Never XPath.
- **Zero `waitForTimeout`.** Wait on a response (`clickAndWaitForApi`) or an
  assertion. `waitForLoadState('networkidle')` is discouraged too — the app polls.
- One behaviour per test.
- Tests must pass when run alone with `-g`.
- Unique invoice / reference number per run — use `utils/unique.js`, or duplicate
  validation blocks the second execution.
- Never type into an auto-calculated field. Read it and verify the arithmetic
  with `toBeCloseTo(value, 3)`.
- Assertions live in specs, never inside a page object.
- Name specs with the TC ID. `results.json` then maps cleanly into the 5-sheet
  Excel test-report workbook.

---

## OneDrive note

This project lives in a OneDrive-synced folder, so `node_modules/` (~5k files)
gets sync churn and can hit file locks mid-install. If npm or a test run fails
oddly, pause OneDrive sync, or exclude this folder via
*OneDrive → Settings → Account → Choose folders*. Moving the project to a local
path and keeping only the source in OneDrive avoids it entirely.
