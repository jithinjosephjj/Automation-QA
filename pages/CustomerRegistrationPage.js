const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Customer Registration — CRM > Operations > Customer Registration.
 * Route: /crm/customer-list (probed live 05-09-2026).
 *
 * A multi-section wizard: an Individual / New Group (Primary) / Link to
 * Existing kind selector, an identity block (name + contactNumber with a
 * dialCode select, Title/Gender/Marital Status/Occupation/Classification,
 * dob/anniversary), an address block (zipCode/area/city/district/state/
 * country), plus optional Document / Nominee / Bank sections. The primary
 * footer button is "Next" (not Submit) - the final step has Submit.
 *
 * Identity inputs carry formcontrolnames (name, contactNumber, email, ...)
 * but no ids; reach them by [formcontrolname=...].
 */
class CustomerRegistrationPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Customer Registration');
    this.submitApiPattern = /Customer|Create|Save/i;
  }

  async open() {
    await this.goto('/crm/customer-list');
    await this.addBtn.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async openAddForm() {
    await this.waitForSpinner();
    await this.addBtn.click({ timeout: 60_000 });
    await this.select('masterDataValueID_CustomerType').waitFor({ state: 'visible', timeout: 30_000 });
  }

  input(controlname) {
    return this.page.locator(`[formcontrolname="${controlname}"]`).first();
  }

  async fillDate(id, value) {
    const el = this.page.locator(`#${id}`);
    await el.fill(value);
    await el.blur();
    await this.page.keyboard.press('Escape'); // close the date-picker popup
  }

  async fillCustomer(d) {
    // kind selector (Individual is the default; click to be sure). Customer
    // Type is NOT touched in the recording - it defaults, so leave it unless
    // a value is explicitly provided.
    if (d.kind) {
      await this.page.getByRole('button', { name: d.kind, exact: true }).click().catch(() => {});
      await this.page.waitForTimeout(1_000);
    }
    if (d.customerType) await this.pick('masterDataValueID_CustomerType', d.customerType, { exact: true }).catch(() => {});

    // Title carries the dot ("Mr."); pick then identity fields by controlname
    if (d.title) await this.pick('masterDataValueID_NameTitle', d.title).catch(() => {});
    if (d.contactNumber) await this.input('contactNumber').fill(String(d.contactNumber));
    await this.input('name').fill(d.name);
    if (d.gender) await this.pick('masterDataValueID_Gender', d.gender, { exact: true }).catch(() => {});
    if (d.maritalStatus) await this.pick('masterDataValueID_MaritalStatus', d.maritalStatus).catch(() => {});
    if (d.occupation) await this.pick('masterDataValueID_Profession', d.occupation).catch(() => {});
    if (d.classification) await this.pick('customerClassificationID', d.classification).catch(() => {});
    if (d.source) await this.pick('masterDataValueID_CustomerSource', d.source).catch(() => {});
    if (d.email) await this.input('email').fill(d.email).catch(() => {});
    if (d.dob) await this.fillDate('dob', d.dob);
    if (d.anniversary) await this.fillDate('anniversary', d.anniversary);

    // Document: Type (Aadhar Card) + one demo image via Browse -> file input
    // -> Add Document (adds the row to the document grid). The type select
    // clears when the doc is staged, so RE-SELECT it (documentTypeID is a
    // mandatory field on the Identity step).
    if (d.document) {
      await this.pickDocType(d.document.type);
      // no Browse click - the native picker would hang; set the hidden file
      // input directly, then Add Document
      await this.page.locator('input[type="file"]').last().setInputFiles(d.document.file);
      await this.page.waitForTimeout(1_000);
      await this.page.getByRole('button', { name: 'Add Document' }).click();
      await this.page.waitForTimeout(1_500);
      console.log(`customer: document ${d.document.type} attached`);
      // re-select the type if Add Document cleared it (mandatory validation)
      const dtVal = await this.selectValue('documentTypeID').catch(() => '');
      if (!dtVal) await this.pickDocType(d.document.type).catch(() => {});
    }

    // Address block (Communication Address) - ZIP CODE FIRST (QA lead): the
    // zipCode select CASCADES, auto-filling area/city/district/state/country.
    // Fill any field the cascade leaves empty as a fallback.
    const addr = d.address || {};
    // "Door No / Street / Full Address" - a plain text input/textarea with
    // no controlname (the required "?" input in the diagnostics)
    const line = addr.line || 'Door 12, MG Road';
    const addrLine = this.page
      .locator('textarea, input[type="text"]')
      .filter({ hasNot: this.page.locator('[formcontrolname]') })
      .locator('visible=true');
    await this.fillByLabelLoose(['Door No', 'Full Address', 'Address', 'Street'], line)
      .catch(async () => { await addrLine.first().fill(line).catch(() => {}); });
    await this.pickAddress('zipCode', addr.zipCode, { firstIfMissing: true });
    await this.waitForIdle();
    await this.page.waitForTimeout(2_000); // let the cascade populate
    for (const [cn, val] of [
      ['country', addr.country], ['state', addr.state], ['district', addr.district],
      ['city', addr.city], ['area', addr.area],
    ]) {
      if (!(await this.selectValue(cn).catch(() => ''))) {
        await this.pickAddress(cn, val, { firstIfMissing: true });
      }
    }
    await this.waitForIdle();
  }

  /** Fill an input/textarea by any of several label substrings. */
  async fillByLabelLoose(labels, value) {
    for (const lbl of labels) {
      const field = this.page
        .locator('div.grid, div.form-group, .mb-3, .form-group')
        .filter({ has: this.page.locator('label', { hasText: lbl }) })
        .last()
        .locator('input:not([type=checkbox]):not([disabled]), textarea')
        .first();
      if (await field.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await field.fill(String(value));
        await field.blur();
        return;
      }
    }
    throw new Error(`no address-line field matched ${JSON.stringify(labels)}`);
  }

  async pickDocType(type) {
    await this.pick('documentTypeID', type)
      .catch(() => this.page.locator('#kyc-doctype-select .ng-select-container').click()
        .then(() => this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasText: type }).first().click()));
  }

  /** Pick an address select by value; fall back to its first real option. */
  async pickAddress(controlname, value, { firstIfMissing = false } = {}) {
    if (value) {
      const ok = await this.pick(controlname, value, { exact: true, search: true })
        .then(() => true).catch(() => false);
      if (ok) return;
    }
    if (value || firstIfMissing) await this.pickFirstOption(controlname).catch(() => {});
  }

  async pickFirstOption(controlname) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await this.page.locator('.ng-dropdown-panel').first().isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
      await this.select(controlname).locator('.ng-select-container').click();
      const opt = this.page.locator('.ng-dropdown-panel .ng-option').filter({ hasNotText: /No items found/i }).first();
      const ok = await opt.waitFor({ state: 'visible', timeout: attempt * 4_000 }).then(() => true).catch(() => false);
      if (ok) { await opt.click(); await this.page.waitForTimeout(800); return; }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`address select "${controlname}" offered no option`);
  }

  /**
   * Walk Next -> ... -> Submit, capturing the save response. Throws with the
   * ng-invalid diagnostics if a step is silently blocked (checklist rule 6).
   */
  async submitCustomer() {
    // 4-step wizard (Identity -> Contact -> Financial -> Review); the final
    // action on the Review step is "Register" (not Submit). Walk Next until
    // the Register button appears.
    // the Review-step button is "Register" (green ✓ icon glyph in its
    // accessible name breaks an anchored regex) - match by text, not role name
    const commitBtn = () => this.page.locator('button')
      .filter({ hasText: /Register|Submit/ })
      .filter({ hasNotText: /Add|Document|UPI/ })
      .locator('visible=true').last();
    for (let step = 0; step < 6; step++) {
      if (await commitBtn().isVisible({ timeout: 2_000 }).catch(() => false)) break;
      const next = this.page.getByRole('button', { name: 'Next' }).locator('visible=true').last();
      if (!(await next.isVisible({ timeout: 2_000 }).catch(() => false))) break;
      await next.click();
      await this.waitForIdle();
      await this.page.waitForTimeout(2_000);
    }
    if (!(await commitBtn().isVisible({ timeout: 3_000 }).catch(() => false))) {
      throw new Error(`Customer wizard never reached Register; ${JSON.stringify(await this.invalidDiag())}`);
    }

    const resp = this.page.waitForResponse(
      (r) => ['POST', 'PUT'].includes(r.request().method()) && /customer|create|save|register/i.test(r.url()) &&
        !/GetAll|Pagination|KeepAlive|GetMasterData|GetLocation|Translation|Search/i.test(r.url()),
      { timeout: 30_000 },
    ).catch(() => null);
    await commitBtn().click();
    const r = await resp;
    if (!r) {
      throw new Error(`Customer Register fired no save request - form silently blocked; ${JSON.stringify(await this.invalidDiag())}`);
    }
    const body = await r.json().catch(() => null);
    console.log('customer save:', r.status(), r.url().split('/').pop(), JSON.stringify(body).slice(0, 200));
    if (r.status() >= 400 || (body && body.errorCode)) {
      throw new Error(`Customer save rejected (HTTP ${r.status()}): ${body ? body.error || '' : ''}`);
    }
    await this.previewAndClose().catch(() => {});
    return body;
  }

  /** Active wizard step label (Identity / Contact / Financial / Review). */
  async currentStep() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const active = [...document.querySelectorAll('.active, [class*=active]')]
        .filter((e) => vis(e) && /^(Identity|Contact|Financial|Review)$/i.test(e.textContent.trim()));
      if (active.length) return active[0].textContent.trim();
      // fallback: the section heading currently shown
      const h = [...document.querySelectorAll('h4,h5')].filter(vis)[0];
      return h ? h.textContent.trim() : '';
    }).catch(() => '');
  }

  async invalidDiag() {
    return this.page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent);
      const invalidNg = [...document.querySelectorAll('sioniq-ng-select')]
        .filter((n) => n.querySelector('ng-select')?.classList.contains('ng-invalid') && vis(n))
        .map((n) => n.getAttribute('controlname'));
      const invalidInputs = [...document.querySelectorAll('input.ng-invalid, textarea.ng-invalid')]
        .filter(vis).map((n) => n.getAttribute('formcontrolname') || n.id || '?');
      const toast = (document.querySelector('.toast-message, .toast, [role=alert]') || {}).textContent || '';
      return { invalidNg, invalidInputs, toast: toast.trim() };
    });
  }

  async previewAndClose() {
    this.printPreviewError = null;
    const dialogVisible = await this.printDialog.waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true).catch(() => false);
    if (dialogVisible) await this.verifyPrintPreview().catch((e) => { this.printPreviewError = String(e); });
    await this.page.locator('.btn-close').last().click({ timeout: 8_000 }).catch(() => {});
    await this.page.waitForTimeout(1_000);
  }
}

module.exports = { CustomerRegistrationPage };
