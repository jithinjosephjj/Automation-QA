const base = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const { MetalInwardPage } = require('../pages/MetalInwardPage');
const { BrandInwardPage } = require('../pages/BrandInwardPage');
const { StoneInwardPage } = require('../pages/StoneInwardPage');
const { AlloyInwardPage } = require('../pages/AlloyInwardPage');
const { BullionInwardPage } = require('../pages/BullionInwardPage');
const { EmployeePage } = require('../pages/EmployeePage');
const { UserPage } = require('../pages/UserPage');
const { SmithPage } = require('../pages/SmithPage');
const { CounterPage } = require('../pages/CounterPage');
const { OrderBookingPage } = require('../pages/OrderBookingPage');
const { B2BOrderBookingPage } = require('../pages/B2BOrderBookingPage');
const { ProductionWorkflowPage } = require('../pages/ProductionWorkflowPage');
const { LotGenerationPage } = require('../pages/LotGenerationPage');
const { BarcodeGenerationPage } = require('../pages/BarcodeGenerationPage');
const { SampleWorkflowPage } = require('../pages/SampleWorkflowPage');
const { RepairWorkflowPage } = require('../pages/RepairWorkflowPage');
const { RemodelWorkflowPage } = require('../pages/RemodelWorkflowPage');
const { HallmarkWorkflowPage } = require('../pages/HallmarkWorkflowPage');
const { CertificationWorkflowPage } = require('../pages/CertificationWorkflowPage');
const { StoneAssortedWorkflowPage } = require('../pages/StoneAssortedWorkflowPage');
const { BullionBookingPage } = require('../pages/BullionBookingPage');
const { LogisticsSalesWorkflowPage } = require('../pages/LogisticsSalesWorkflowPage');
const { TransfersPage } = require('../pages/TransfersPage');
const { CustomerRegistrationPage } = require('../pages/CustomerRegistrationPage');
const { DepartmentProcessPage } = require('../pages/DepartmentProcessPage');
const { InternalStockTransferPage } = require('../pages/InternalStockTransferPage');

/**
 * Import { test, expect } from here instead of '@playwright/test' and page
 * objects arrive already constructed:
 *
 *   test('TC-MI-001 ...', async ({ metalInward }) => { ... });
 */
/**
 * The app's invisible "transparent" ngx-spinner overlay covers the whole
 * page while data loads; under load (parallel runs, a slow qa) it stays up
 * longer than the 15 s action timeout and clicks fail with "element
 * intercepts pointer events" (26-09-2026 full run: IST-01, CADM-13,
 * LGS-08, BBI-02, B2B-SR-03). Playwright runs this handler before any
 * action whenever the overlay is visible: wait for it to clear (up to
 * OVERLAY_WAIT_MS, default 60 s), then the action proceeds.
 */
const handled = new WeakSet();
async function installOverlayHandler(page) {
  if (handled.has(page)) return;
  handled.add(page);
  const overlayWait = Number(process.env.OVERLAY_WAIT_MS || 60_000);
  await page.addLocatorHandler(page.locator('.ngx-spinner-overlay').first(), async (overlay) => {
    await overlay.waitFor({ state: 'hidden', timeout: overlayWait }).catch(() => {});
  }, { noWaitAfter: true });
}

/**
 * ONE BROWSER CONTEXT PER WORKER (30-09-2026, "one login per chain").
 *
 * Playwright's own `page` fixture opens a fresh context for every test, so
 * every chain step paid a session replay + app boot (8-15 s, ~130 steps a
 * run) and the two /login stalls of 30-09 hit exactly there. This override
 * hands every test of the worker the same page: the first step logs in,
 * the later steps find the session live and skip the login
 * (LoginPage.ensureLoggedIn); a user / business-unit switch mid-chain still
 * logs in as before. Each step starts with a goto, so nothing of the
 * previous step's screen carries over. Traces, failure screenshots and
 * error-context.md still work: Playwright's artifacts recorder attaches to
 * every context that exists when a test starts. Playwright restarts the
 * worker after a failed test, which drops the context - the next step
 * simply logs in again. CHAIN_CONTEXT=0 restores a context per test.
 */
const CHAIN_CONTEXT = process.env.CHAIN_CONTEXT !== '0';
let shared = null; // { context, page } of this worker process

const pageFixture = CHAIN_CONTEXT
  ? async ({ browser, baseURL, viewport, deviceScaleFactor, ignoreHTTPSErrors, storageState }, use) => {
    if (!shared || shared.crashed || shared.page.isClosed() || !browser.isConnected()) {
      if (shared) await shared.context.close().catch(() => {});
      const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor, ignoreHTTPSErrors, storageState });
      shared = { context, page: await context.newPage(), crashed: false };
      // a crashed page is NOT "closed": remember it so the next test gets a
      // fresh context instead of a dead one (01-10-2026, out-of-memory crash)
      // (context 'close' / browser 'disconnected' also fire on Playwright's
      // normal worker teardown after a failed test - not logged, they read
      // like crashes; 'crash' is the real signal)
      shared.page.on('crash', () => { shared.crashed = true; console.log('chain context: the page CRASHED (browser out of memory?) - a fresh context will be opened for the next test'); });
      console.log('chain context: opened the worker\'s shared browser context');
    }
    await installOverlayHandler(shared.page);
    await use(shared.page);
  }
  : async ({ page }, use) => {
    await installOverlayHandler(page);
    await use(page);
  };

const test = base.test.extend({
  page: pageFixture,

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  metalInward: async ({ page }, use) => {
    await use(new MetalInwardPage(page));
  },

  brandInward: async ({ page }, use) => {
    await use(new BrandInwardPage(page));
  },

  stoneInward: async ({ page }, use) => {
    await use(new StoneInwardPage(page));
  },

  alloyInward: async ({ page }, use) => {
    await use(new AlloyInwardPage(page));
  },

  bullionInward: async ({ page }, use) => {
    await use(new BullionInwardPage(page));
  },

  employeePage: async ({ page }, use) => {
    await use(new EmployeePage(page));
  },

  userPage: async ({ page }, use) => {
    await use(new UserPage(page));
  },

  smithPage: async ({ page }, use) => {
    await use(new SmithPage(page));
  },

  counterPage: async ({ page }, use) => {
    await use(new CounterPage(page));
  },

  orderBooking: async ({ page }, use) => {
    await use(new OrderBookingPage(page));
  },

  b2bOrderBooking: async ({ page }, use) => {
    await use(new B2BOrderBookingPage(page));
  },

  production: async ({ page }, use) => {
    await use(new ProductionWorkflowPage(page));
  },

  lotGeneration: async ({ page }, use) => {
    await use(new LotGenerationPage(page));
  },

  barcodeGeneration: async ({ page }, use) => {
    await use(new BarcodeGenerationPage(page));
  },

  sampleWorkflow: async ({ page }, use) => {
    await use(new SampleWorkflowPage(page));
  },

  repairWorkflow: async ({ page }, use) => {
    await use(new RepairWorkflowPage(page));
  },

  remodelWorkflow: async ({ page }, use) => {
    await use(new RemodelWorkflowPage(page));
  },

  hallmarkWorkflow: async ({ page }, use) => {
    await use(new HallmarkWorkflowPage(page));
  },

  certificationWorkflow: async ({ page }, use) => {
    await use(new CertificationWorkflowPage(page));
  },

  stoneAssortedWorkflow: async ({ page }, use) => {
    await use(new StoneAssortedWorkflowPage(page));
  },

  bullionBooking: async ({ page }, use) => {
    await use(new BullionBookingPage(page));
  },

  logisticsSales: async ({ page }, use) => {
    await use(new LogisticsSalesWorkflowPage(page));
  },

  transfers: async ({ page }, use) => {
    await use(new TransfersPage(page));
  },

  customerRegistration: async ({ page }, use) => {
    await use(new CustomerRegistrationPage(page));
  },

  departmentProcess: async ({ page }, use) => {
    await use(new DepartmentProcessPage(page));
  },

  internalTransfer: async ({ page }, use) => {
    await use(new InternalStockTransferPage(page));
  },
});

module.exports = { test, expect: base.expect };
