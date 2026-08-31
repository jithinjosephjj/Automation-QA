const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Order Booking — Sales & Distribution > B2B > Order, "Order Booking" tab.
 * Route: /sls/order-booking. 2-step wizard (Order Details → Build Order
 * Items) rendered as one scrolling form with Add Items, then Next → Submit.
 *
 * Facts (verified live 23-08-2026):
 * - Picking SM Executive Code auto-fills Sales Executive (AJ10 → Ajin G).
 * - Picking the Article (typed search) back-fills Group Category, Category
 *   AND every productSubCategoryID dropdown (Necklacean, Modern Chains, ...).
 * - "No of Pcs" is preset to 1 and disabled; Gross Weight is the manual
 *   entry; Net Weight is calculated.
 * - Add Items is a silent no-op on invalid forms - verify via the Stock
 *   Order Summary panel (No. of Items).
 */
class OrderBookingPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Order Booking');
    this.addItemBtn = page.getByRole('button', { name: 'Add Items' });
    this.submitApiPattern = /Order/i;
  }

  async open() {
    await this.goto('/sls/order-booking');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddWizard() {
    await this.addBtn.click();
    await this.select('itemType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * General Order Information. Sales Executive fills itself from the SM code.
   * Delivery Date is mandatory - without it, Next silently never reaches the
   * Submit step.
   */
  async fillOrderDetails({ itemType, supervisor, smCode, deliveryNote, deliveryDate }) {
    await this.pick('itemType', itemType);
    await this.pick('supervisor', supervisor, { search: true });
    await this.pick('smcode', smCode, { search: true });
    await this.pick('deliveryNote', deliveryNote);

    const date = this.page.locator('#deliveryDate');
    await date.fill(deliveryDate);
    await date.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
  }

  /**
   * Build Order Items. Group Category and Category MUST be picked manually:
   * the article's search auto-fill paints them in the UI but leaves the
   * underlying model empty, and CreateOrderBooking then rejects with 400
   * ("GroupCategory/Category/HSNCode ... field is required").
   */
  async fillItem({ referenceType, groupCategory, category, article, purity, grossWeight }) {
    await this.pick('referenceType', referenceType);
    await this.pick('groupCategory', groupCategory, { exact: true });
    await this.pick('category', category, { exact: true });
    await this.page.waitForTimeout(2_000); // let the article list refilter
    // NO typed search here: the search path returns options missing the
    // joined fields (HSN, short names) and the save then 400s.
    await this.pick('article', article);
    await this.pick('purity', purity);

    // The Gross Weight container also holds the disabled "No of Pcs" input -
    // target the enabled one explicitly.
    const gross = this.page
      .locator('div.grid, div.form-group')
      .filter({ has: this.page.locator('label:text-is("Gross Weight")') })
      .last()
      .locator('input:not([type=checkbox]):not([disabled])')
      .first();
    await gross.fill(String(grossWeight));
    await gross.blur();
  }

  /**
   * Submit with full diagnostics: logs every save-like request fired and the
   * page's validation state, so a silent client-side block or an unexpected
   * endpoint name surfaces immediately instead of as a bare timeout.
   */
  async submitWithDiagnostics() {
    const fired = [];
    const listener = (r) => {
      if (['POST', 'PUT'].includes(r.method()) && !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation/i.test(r.url())) {
        fired.push(`${r.method()} ${r.url()}`);
      }
    };
    const responses = [];
    const respListener = async (r) => {
      if (['POST', 'PUT'].includes(r.request().method()) && /create|save|book/i.test(r.url())) {
        const body = await r.json().catch(() => null);
        const payload = r.request().postData() || '';
        responses.push({ status: r.status(), url: r.url(), body, payload });
      }
    };
    this.page.on('request', listener);
    this.page.on('response', respListener);
    await this.submitBtn.click();
    await this.page.waitForTimeout(20_000);
    this.page.off('request', listener);
    this.page.off('response', respListener);

    const diag = await this.page.evaluate(() => {
      const txt = (el) => ((el && el.innerText) || '').trim().replace(/\s+/g, ' ');
      return {
        toast: txt(document.querySelector('#toast-container, .toast-container')).slice(0, 200),
        invalidNg: [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && n.offsetParent)
          .map((n) => n.getAttribute('controlname')),
      };
    });
    console.log('order submit fired:', fired.join(' | ') || '(nothing)');
    console.log('order submit responses:', JSON.stringify(responses).slice(0, 400) || '(none)');
    console.log('order submit diag:', JSON.stringify(diag));
    return { fired, responses, diag };
  }

  /**
   * Attach a file through the "Add Files" control (renders with the item
   * section): opens the Upload Files dialog, injects the file straight into
   * its input[type=file], commits with "Add Image", then closes the dialog.
   */
  async attachFileViaAddFiles(filePath) {
    await this.page.getByRole('button', { name: 'Add Files' }).first().scrollIntoViewIfNeeded();
    await this.page.getByRole('button', { name: 'Add Files' }).first().click();
    const dlg = this.page
      .locator('[role="dialog"], .modal, ngb-modal-window, .offcanvas')
      .filter({ hasText: 'Upload Files' })
      .last();
    await dlg.waitFor({ state: 'visible', timeout: 15_000 });

    await dlg.locator('input[type="file"]').first().setInputFiles(filePath);
    await this.page.waitForTimeout(1_500);

    const addImage = dlg.getByRole('button', { name: 'Add Image' });
    await addImage.waitFor({ state: 'visible', timeout: 15_000 });
    await addImage.click();
    await this.page.waitForTimeout(1_500);

    await dlg.getByRole('button', { name: 'Close' }).last().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    console.log('Add Files: image attached and dialog closed');
  }

  /** Add Items with proof via the Stock Order Summary panel. */
  async addItemsAndVerify(expectedItems = 1) {
    // Rate and the pricing strip land asynchronously after Gross Weight -
    // clicking Add Items while that fetch is in flight gets rejected.
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.addItemBtn.click();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if ((await this.summaryText()).includes(`No. of Items : ${expectedItems}`)) return;
        await this.page.waitForTimeout(500);
      }
    }
    throw new Error(`Add Items never registered - summary does not show No. of Items : ${expectedItems}`);
  }
}

module.exports = { OrderBookingPage };
