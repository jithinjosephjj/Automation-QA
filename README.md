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
| Metal Inward - Remodel workflow (tests/e2e/metal-inward-remodel-workflow, TC-RMD-01…03) | **All 3 steps passing headed** — Metal Inward (stock, vendor Luxurio — a catalog vendor is required for remodel, random invoice no) → Remodel Issue (/inv/app-issue-list Remodel tab: type/vendor/Inward/Metal Inward → row → "Add N" count-named button → Submit, RR## series) → Remodel Receipt (/inv/app-receipt-list Remodel tab: type/vendor/random invoice no/credit days → Receipt Selection Type **RC Number** → Issue Stock Source Inward → RR row → item-wise row pops the **Remodel Details overlay** (confirm via its Submit) → + Add → Submit). Own state file e2e-remodel-state.json |
| Metal Inward - Hallmark workflow (tests/e2e/metal-inward-hallmark-workflow, TC-HLM-01…03) | **All 3 steps passing headed** — Metal Inward (stock, vendor Luxurio, random invoice no) → Hallmark Issue (/inv/app-issue-list Hallmark tab: Hallmark Vendor + Stock Source Inward + From Transaction Type Metal Inward → inward row → "Add Items" → Submit) → Hallmark Receipt (/inv/app-receipt-list Hallmark tab: vendor + random invoice no + date → RC Number → issue row → Add → Submit). Own state file e2e-hallmark-state.json |
| Stone Inward - Certification workflow (tests/e2e/stone-inward-certification-workflow, TC-CRT-01…03) | **All 3 steps passing headed** — Stone Inward (stock, vendor RAJA, article Jerald, **Assorted Stock ticked** — ONLY assorted stone inwards are certification-eligible; alphanumeric random invoice) → Certification Issue (/inv/app-issue-list Certification tab: Jewellery Item Type Stone + Certification Vendor Ram + Stock Source Inward + From Transaction Type Stone Inward → inward row → Add → Submit, short g## series) → Certification Receipt (/inv/app-receipt-list Certification tab: Item Type + Vendor + **RC Number** + random invoice no/date + Issue Stock Source Inward (caption is a plain div — structural pick; dismiss the flatpickr calendar first) → issue rows → "Add Selected to Receipt" → Submit, cc## series). Own state file e2e-certification-state.json |
| Stone Assorting - Certification workflow (tests/e2e/stone-assorted-certification-workflow, TC-SAC-01…05) | **All 5 steps passing headed** — Stone Inward (RAJA/Jerald, NO assorted tick) → Stone Assorting Issue (/prc/app-stone-assorting-list via NAV SEARCH "stone as"; raw ng-selects without wrappers/labels: transaction type Stone Inward + purchase vendor RAJA → inward item row → assorter employee (Sioniquser##) → Add → Close → Next → Submit, permuted gg## series) → Stone Assorting Receipt (Receipt tab: employee → issue row by docCore → Add Items → Close → Submit, f## series) → Certification Issue (From Transaction Type **"Stone Assorting Receipt"** → receipt row by docCore → Add → Submit, g##) → Certification Receipt (RC Number → "Add Selected to Receipt" → Submit, cc##). Grids render series PERMUTED vs save responses — keyed via docCore(). Own state file e2e-assorted-cert-state.json |
| Stone Assorting - Certification TARE variant (tests/e2e/stone-assorted-certification-tare-workflow, TC-SACT-01…05) | **All 5 steps passing headed** — same chain entered "With Tare" (gross 76g / TARE 10g / net 66g). With Tare mode auto-sets+disables UOM and replaces the tare input with a "+" button opening the **Tare Weight Information** dialog (Item + Tare Weight Type — avoid "Per Pcs", it multiplies by piece count — + weight → Add Item → data-role=close-tare). Weights verified at every step via `expectInRow`: the assorting-issue Add Stone Details panel shows 76/10/66 (panel INPUT values captured — innerText misses them); **assorting consumes the tare** — from the assorting receipt onward stock carries net 66.000 as gross, tare 0.000, verified on the certification issue/receipt grids. Own state file e2e-assorted-cert-tare-state.json |
| Bullion Booking - Bullion Inward workflow (tests/e2e/bullion-booking-inward-workflow, TC-BBI-01…02) | **Both steps passing headed** — Bullion Booking (default tab of /prc/app-bullion-list: booking type Fix + vendor RAJA + Gold/Ring/Tendulkar + purity 91.6 + delivery/validity dates + DYNAMIC Booking Reference ID + **mandatory Advance Percentage** + gross 50 @ rate 15000 + reduce-tax checkbox with 2% (rate renders 14705.88 = 15000/1.02) → Add Items (summary-verified) → Submit, CreateBullionBooking, jjj## series) → Bullion Inward Generation Type "Bullion Booking" (vendor + random invoice + credit days + **hierarchy picks BEFORE the Booking ID typeahead — it stays "Type to search" until group/category/article are set** → booking back-fills rate/purity → item charge → Add Items → bill charge → Submit, CreateBullionInward). Own state file e2e-bullion-booking-state.json |
| Logistics - Goods Receipt - Sales workflow (tests/e2e/logistics-goods-receipt-sales-workflow, TC-LGS-01…08) | **All 8 steps passing headed** — Logistics Inward (/prc/view-logistics: DTDC + RAJA, DYNAMIC logistic/invoice/tracking numbers, Metal Gold/Ring/91.60, 120g seal / qty 5 / 100g / 20g stone; captions are plain text nodes → fillByCaption) → Goods Receipt (/prc/view-goods-receipt: Generation Type "Logistic Inward" + logistics RC + tare 2g via the "+" Tare dialog; gross 118 / net 98 verified) → Metal Inward (Purchase Type "Goods Receipt"; the GR pick does NOT auto-fill the item — entry data + gross-with-tare 118 manual, making charges defaults 1200) → Lot (NN##) → Barcode as suja (Stock Identity **"Stock"** for purchase inwards) → Counter Allocation (/sls/view-counter-allocation: Item Type/Group Category/Scan Type "Tag Number" + scan → Add → Submit, ccc##) → Counter Accept (/sls/view-counter-accept-reject: filter, row, Accept, AAA##) → B2B Metal Sales Invoice (/sls/app-invoice-setup B2B tab: Invoice + customer RAJA + branch + Stock Source Counter + Issue Type **"Tag Wise"** (Approval RC No switches modes) + tag into the "Tag Number" field then "+ Add" — the caption lookup must skip ng-select internals since Scan Type's VALUE is also "Tag Number"; SaveB2BSalesInvoice, SSSS##). Own state file e2e-logistics-sales-state.json |
| Metal Inward - Lot - Barcode - Purchase Return workflow (tests/e2e/metal-inward-purchase-return-workflow, TC-PRT-01…04) | **All 4 steps passing headed** — Metal Inward (stock/Direct, RAJA/Tendulkar 100g @ 6000) → Lot (NN##) → Barcode as suja (Stock Identity "Stock") → Purchase Return (/prc/view-purchase-return: Item Type Metal + Return Mode **Confirmed** + Sub Txn **Invoice** + Return Type **Original Vendor** + vendor RAJA + Stock Source **TagWise** + Scan Type **Tag Number** → tag into the scan field → staged row → Submit, CreatePurchaseReturn, wJune-AAA## series). Own state file e2e-purchase-return-state.json |
| Metal Inward - Direct Purchase Return workflow (tests/e2e/metal-inward-direct-purchase-return-workflow, TC-PRI-01…02) | **Both steps passing headed** — Metal Inward (stock/Direct, RAJA) → Purchase Return with Stock Source **Inward** (no lot/barcode): From Transaction Type "Metal Inward" auto-cascade + **RC No typeahead** (search the inward number) → row → Add → Submit (CreatePurchaseReturn, wJune-AAA## series). Own state file e2e-purchase-return-inward-state.json |
| Brand Inward - Lot - Barcode workflow (tests/e2e/brand-inward-lot-barcode-workflow, TC-BLB-01…03) | **All 3 steps passing headed** — Brand Inward (TC-BRIN-001 recipe: RAJA/Direct/Cochin, Gold/Ring/**Amraa**/Tendulkar, 10 pcs / 20g / MRP 90000, **NO discount** — the lot's amount (MRP×pcs) is capped at the inward's TAXABLE value, so any inward discount blocks Add To Lot; inward amount itself caps at 950000) → Lot Generation (Item Type **Brand** + From Transaction Type **Brand Inward**; no print preview offered on brand lots) → Barcode as suja (Item Type Brand, Stock Identity "Stock"; brand tags need **Brand Name** (controlname productBrandID) AND the Pricing **Amount** input — both silently block Submit when empty; tag series 26-06-22####). Own state file e2e-brand-lot-state.json |
| Stone Inward - Lot - Barcode workflow (tests/e2e/stone-inward-lot-barcode-workflow, TC-SLB-01…03) | **All 3 steps passing headed** — Stone Inward (RAJA/Jerald, **Assorted Stock ticked** — a plain stone inward is NOT lot-eligible; the tick exposes From Transaction Type "Stone Inward" on the lot form) → Lot Generation (Item Type **Stone** + From Transaction Type **Stone Inward**; no print preview on stone lots) → Barcode as suja (Item Type Stone, Stock Identity "Stock"; the stone barcode form has NO custom Description dropdowns — skipped when absent — and the editable weight is **Stone Gross Weight With Tare**, not "Gross Weight"; tag series RSbbbb#). Own state file e2e-stone-lot-state.json |
| Stone Assorting - Lot - Barcode workflow (tests/e2e/stone-assorted-lot-barcode-workflow, TC-SAL-01…05) | **All 5 steps passing headed** — plain Stone Inward (NO assorted tick) → Stone Assorting Issue → Stone Assorting Receipt → Lot Generation (Item Type Stone + From Transaction Type **Stone Assorting Receipt**) → Barcode as suja. The assorting-cycle route to a lot (vs TC-SLB's direct assorted-tick route). Own state file e2e-stone-assorted-lot-state.json |
| B2B Sample - Inhouse - Used In Production workflow (tests/e2e/b2b-sample-inhouse-usedinprod-workflow, TC-B2B-SUP-01…08) | **All 8 steps passing headed** — variant of the B2B sample inhouse chain with the **Used In Production** toggle ENABLED in BOTH places: the Add Sample panel on the B2B order (input#useInProduction, fillSampleItem sample.usedInProduction) AND the Sample Issue form (input#active, createSampleIssue usedInProduction) — both off by default. Full inhouse chain runs identically; verified at Worker Receipt (Casting) — the used-in-production sample was receivable and finalized there. Own state file e2e-b2b-sample-usedinprod-state.json |
| Customer Registration add (TC-CRM-CUST-01, tests/crm/customer-registration-add) | **Passing headed** — CRM > Operations > Customer Registration (/crm/customer-list), a 4-step wizard (Identity → Contact → Financial → Review). Individual customer: Title "Mr." + sequential all-alpha name (SioniqCustomerone/two/… via customer-counter.json — Name fields reject digits) + dynamic 10-digit mobile, Gender Male, dob/anniversary, Aadhar Card document (one demo image via direct setInputFiles — NO Browse click) with the type re-selected after Add Document, and the Communication **Address** block filled ZIP-CODE-FIRST (it cascades area/city/district/state/country; the "Door No / Street / Full Address" line filled too). Final action is **Register** (green ✓ glyph — matched by text). Verified: CreateCustomer save response + list view. Own counter file customer-counter.json |
| Process & Sub-Process add (TC-HRM-PROC-01…10, tests/hrm/process-subprocess-add) | **Passing headed** — HRM > Department > Process / Sub-Process (/hrm/department-setup), a TAB strip with a right-side **offcanvas** add form. **Data-driven from the QA lead's 3 Excel exports** (tests/hrm/department-process-data.js: 10 processes + 43 sub-processes, exact Material Issue/Receipt/Clearance triples, Process Type "CAD" only on Design And CAD). One test per process: adds the Process then all its Sub-Processes (linked via the `process` dropdown). Traps handled: **Escape closes the whole offcanvas** → Escape-free picks (close stray dropdowns by clicking a neutral spot); **Submit resets the form to blank instead of closing** → X clicked after each save; the **Material/Process Type selects render only after department+location are set**; **sub receipt/clearance controlnames are lowercase** (materialreceipt/materialclearance); a **No-Material parent auto-populates the sub's material fields** → skip-if-already-set. QA lead decisions: per-run suffix (exported names already exist), and sub-processes with a parent not in the process sheet are skipped (only "Burnout"→"Casting"; 42/43 created). Verified: CreateDepartmentProcess/CreateDepartmentSubProcess responses (sub carries parent departmentProcessID) + list view |
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
