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

/**
 * Import { test, expect } from here instead of '@playwright/test' and page
 * objects arrive already constructed:
 *
 *   test('TC-MI-001 ...', async ({ metalInward }) => { ... });
 */
const test = base.test.extend({
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
});

module.exports = { test, expect: base.expect };
