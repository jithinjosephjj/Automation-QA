const { OrderBookingPage } = require('./OrderBookingPage');

/**
 * B2B Order Booking — Sales & Distribution > B2B > Order, "B2B Order Booking"
 * tab of /sls/order-booking. Same 2-step shape as Order Booking with extra
 * General Order Information fields: Purpose Type, Customer (address panel
 * auto-fills from it), Customer Branch (optional), Making Type, Order Given
 * By and Contact Number (both label-reached text inputs, no ids).
 */
class B2BOrderBookingPage extends OrderBookingPage {
  constructor(page) {
    super(page);
    this.tabName = 'B2B Order Booking';
    this.tab = page.getByRole('tab', { name: 'B2B Order Booking' });
  }

  async open() {
    await this.goto('/sls/order-booking');
    await this.tab.waitFor({ state: 'visible', timeout: 30_000 });
    await this.tab.click();
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000);
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('purposeType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** B2B General Order Information, per the QA lead's screenshot. */
  async fillOrderDetails({ purposeType, customer, itemType, makingType, supervisor, smCode, orderGivenBy, contactNumber, deliveryNote, deliveryDate }) {
    await this.pick('purposeType', purposeType, { exact: true });
    await this.pick('customer', customer, { search: true });
    await this.pick('itemType', itemType);
    await this.pick('makingType', makingType);
    await this.pick('supervisor', supervisor, { search: true });
    await this.pick('smcode', smCode, { search: true });

    await this.fillByLabel('Order Given By', orderGivenBy);
    await this.fillByLabel('Contact Number', contactNumber);
    await this.pick('deliveryNote', deliveryNote);

    const date = this.page.locator('#deliveryDate');
    await date.fill(deliveryDate);
    await date.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
  }
}

module.exports = { B2BOrderBookingPage };
