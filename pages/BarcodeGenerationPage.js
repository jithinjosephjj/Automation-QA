const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Barcode Generation — Inventory > Operations > Barcode.
 * Route: /inv/view-barcode-generation.
 *
 * Add form (mapped live, 31-08-2026): Source From is preset to "Vendor".
 * Item Type → Stock Identity Type → Vendor → Lot No cascade; picking the
 * Lot No auto-fills Lot Serial No (e.g. NNN86-1), Business Unit, Barcode
 * Type "Normal", Entry Mode "SINGLE TAG" and the whole article chain from
 * the lot. The three custom "Description Fields" dropdowns
 * (Descriptionttest / Decsription2 / Testdoc) are MANDATORY - the QA lead's
 * recording shows Submit silently failing until "Test 2" was picked.
 * Gross Weight is the manual entry (tag weight out of the lot).
 */
class BarcodeGenerationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Barcode');
  }

  async open() {
    await this.goto('/inv/view-barcode-generation');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Generate one tag from a lot. Returns the save-response body. */
  async generateTag({
    itemType = 'Metal',
    stockIdentityType = 'Jobwork Stock',
    vendor = 'RAJA',
    lotNo,
    brand, // Brand item type only: the Brand Name select (QA lead 04-09-2026)
    amount, // Brand item type only: the Pricing Amount input is mandatory
    grossWeight,
    descriptions = { Descriptionttest: 'Test 2', Decsription2: 'Test', Testdoc: 'Doc' },
  }) {
    await this.open();
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: 60_000 });
    await this.select('masterDataValueID_JewelleryItemType').waitFor({ state: 'visible', timeout: 30_000 });

    await this.pick('masterDataValueID_JewelleryItemType', itemType, { exact: true });
    await this.pick('masterDataValueID_StockIdentityType', stockIdentityType, { exact: true });
    await this.pick('vendorID', vendor);
    await this.pick('lotGenerationID', lotNo, { exact: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_500);

    // the lot pick auto-fills Lot Serial No / BU / barcode type / entry mode /
    // article chain; make sure the serial actually landed before moving on
    if (!(await this.selectValue('lotGenerationMetalID'))) {
      await this.pickFirstOption('lotGenerationMetalID');
      await this.page.waitForTimeout(2_000);
    }
    console.log(
      `barcode form: serial=${await this.selectValue('lotGenerationMetalID')}, ` +
      `article=${await this.selectValue('productArticleID')}, entry=${await this.selectValue('masterDataValueID_ItemTaggingMode')}`,
    );

    // Brand tags carry a mandatory Brand Name select (controlname
    // productBrandID - named by the silent-submit diagnostics)
    if (brand) {
      await this.pick('productBrandID', brand);
    }

    // mandatory custom description dropdowns (labels are env-configured;
    // present on Metal/Brand, ABSENT on the Stone barcode form) - skip any
    // label that is not on this form
    for (const [label, option] of Object.entries(descriptions)) {
      const lbl = this.page.locator(`label:text-is("${label}")`).first();
      if (await lbl.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await this.pickByLabel(label, option, { exact: true });
      } else {
        console.log(`description "${label}" not on this form - skipped`);
      }
    }

    // Brand lots do not auto-fill the entry mode - set it when blank
    if (!(await this.selectValue('masterDataValueID_ItemTaggingMode').catch(() => 'skip'))) {
      await this.pick('masterDataValueID_ItemTaggingMode', 'SINGLE TAG', { exact: true }).catch(() => {});
    }
    // Gross weight label differs by tab: Metal/Brand "Gross Weight",
    // Stone "Stone Gross Weight With Tare" (the plain Gross Weight there is
    // a disabled computed field)
    if (grossWeight !== undefined) {
      const stoneGross = this.inputByLabel('Stone Gross Weight With Tare');
      if (await stoneGross.isVisible({ timeout: 2_000 }).catch(() => false) && await stoneGross.isEnabled().catch(() => false)) {
        await this.fillByLabel('Stone Gross Weight With Tare', grossWeight);
      } else {
        await this.fillByLabel('Gross Weight', grossWeight);
      }
    }
    if (amount !== undefined) await this.fillByLabel('Amount', amount);
    await this.page.waitForTimeout(1_500);

    const resp = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /create|save|generate/i.test(r.url()) && !/GetAll|Pagination|KeepAlive|GetMasterData|Translation/i.test(r.url()),
      { timeout: 120_000 },
    ).catch(() => null);
    await this.submitBtn.click();
    const r = await resp;
    if (!r) {
      const diag = await this.page.evaluate(() =>
        [...document.querySelectorAll('sioniq-ng-select')]
          .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && n.offsetParent)
          .map((n) => n.getAttribute('controlname')));
      throw new Error(`Barcode Submit fired no save request - form silently blocked; invalid: ${JSON.stringify(diag)}`);
    }
    const body = await r.json().catch(() => null);
    console.log('barcode tag save:', r.status(), JSON.stringify(body).slice(0, 300));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Barcode save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.page.locator('.btn-close').last().click({ timeout: 5_000 }).catch(() => {});
    return body;
  }

  /** Fallback: open a select and take its first offered option. */
  async pickFirstOption(controlname) {
    await this.select(controlname).locator('.ng-select-container').click();
    const opt = this.page.locator('.ng-dropdown-panel .ng-option').first();
    await opt.waitFor({ state: 'visible', timeout: 20_000 });
    await opt.click();
  }

  /**
   * Proof via the Generated Tags view: the new tag row (matched by text,
   * e.g. the article) must be listed. Returns the tag number - first
   * date-serial token of the newest matching row.
   */
  async verifyGeneratedTag(rowText) {
    await this.page.getByRole('button', { name: 'Generated Tags' }).click();
    await this.waitForIdle();
    for (let i = 0; i < 5; i++) {
      await this.page.waitForTimeout(2_500);
      const row = this.gridRows.filter({ hasText: rowText }).first();
      if (await row.isVisible().catch(() => false)) {
        const text = ((await row.innerText()) || '').replace(/\s+/g, ' ').trim();
        console.log(`Generated Tags row: ${text}`);
        const m = text.match(/\d{4}-\d{2}-\d{2}\d+/);
        return m ? m[0] : text.split(' ')[1];
      }
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await this.page.getByRole('button', { name: 'Generated Tags' }).click().catch(() => {});
    }
    throw new Error(`Generated Tags never listed a row matching "${rowText}"`);
  }
}

module.exports = { BarcodeGenerationPage };
