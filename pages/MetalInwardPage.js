const { StockInwardBasePage } = require('./StockInwardBasePage');

/**
 * Metal Inward — Procurement > Operations > Stock Inward, Metal tab (the
 * default-active tab). 3-step wizard: Basic Details → Inward Metal Items →
 * Review & Submit.
 *
 * Metal-specific facts:
 * - The vendor list loads only AFTER Sub Transaction Type / Purchase Type are
 *   chosen (GetStockInwardMetalVendors) - select Sub Transaction Type FIRST.
 * - Selecting an Article by search back-fills Group Category and Category.
 * - The editable weight is "Gross Weight With Tare"; Gross / Item / Net
 *   Weight and the money fields below Rate are calculated and disabled.
 */
class MetalInwardPage extends StockInwardBasePage {
  constructor(page) {
    super(page, 'Metal');

    this.rateFix = page.locator('#rateFix');
    this.hallmark = page.locator('#hallmark');
    this.noOfPcs = page.locator('#noOfPcs');
    this.makingCharges = page.locator('#makingCharges');
    this.remarks = page.locator('#remarks');
  }

  /**
   * Step 1 in the field order the app expects: Sub Transaction Type first
   * (it drives the vendor fetch), then BU / types, vendor, purchaser.
   */
  async fillBasicDetails({ subTransactionType, businessUnit, inwardType, purchaseType, vendor, purchaser, invoiceNo, hallmark }) {
    const picked = {};
    const vendorsLoaded = this.page.waitForResponse(
      (r) => r.url().includes('GetStockInwardMetalVendors') && r.status() === 200,
      { timeout: 30_000 },
    );

    picked.subTransactionType = await this.pick('subTransactionType', subTransactionType);
    picked.businessUnit = await this.pick('businessUnit', businessUnit);
    picked.inwardType = await this.pick('inwardType', inwardType);
    picked.purchaseType = await this.pick('purchaseType', purchaseType);

    await vendorsLoaded;
    picked.vendor = await this.pick('vendor', vendor);
    picked.purchaser = await this.pick('purchaser', purchaser, { closePanel: true });

    if (invoiceNo) await this.invoiceNo.fill(invoiceNo);
    if (hallmark !== undefined) await this.setCheckbox('hallmark', hallmark);
    return picked;
  }

  /**
   * Step 1 for the JOBWORK RETURN flow (Order-to-Lot chain, QA lead
   * recording 31-08-2026): Sub Transaction Type "Jobwork" + Inward Type
   * "Order" receive the goods of an outsourced job work back into stock.
   */
  async fillJobworkBasicDetails({ businessUnit = 'Cochin', vendor = 'RAJA', invoiceNo, invoiceDate } = {}) {
    await this.pick('subTransactionType', 'Jobwork');
    await this.pick('businessUnit', businessUnit, { exact: true });
    await this.pick('inwardType', 'Order', { exact: true });
    await this.pick('purchaseType', 'Direct', { exact: true });
    await this.page.waitForTimeout(2_000); // vendor list refetches per the types
    await this.pick('vendor', vendor);
    if (invoiceNo) await this.invoiceNo.fill(invoiceNo);
    if (invoiceDate) {
      await this.invoiceDate.fill(invoiceDate);
      await this.invoiceDate.blur();
      await this.page.keyboard.press('Escape'); // close the date-picker popup
    }
  }

  /**
   * Step 2 for the jobwork flow: ONE pick does it all - selecting the Job
   * Work Item No (e.g. "PP84.001") auto-fills entry mode, reference type,
   * the whole article hierarchy, purity, weights and making data from the
   * issued order. Add Item then clears the form (that reset is the proof
   * the row was accepted - Add Item is a silent no-op on invalid forms).
   */
  async addJobworkItem(jobWorkItemNo) {
    await this.pick('jobWorkItemNo', jobWorkItemNo);
    await this.page.waitForTimeout(2_500); // let the auto-fill settle
    const article = await this.selectValue('article');
    console.log(`jobwork item ${jobWorkItemNo} auto-filled article: ${article}`);
    await this.addItemBtn.click();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!(await this.selectValue('jobWorkItemNo'))) return article;
      await this.page.waitForTimeout(500);
    }
    throw new Error(`Add Item never registered - "${jobWorkItemNo}" still selected in the form`);
  }

  /**
   * Step 2 for the GOODS RECEIPT flow (logistics chain, QA lead screenshots
   * 03-09-2026): purchase type "Goods Receipt" adds a Goods Receipt select
   * on the items step; picking the GR back-fills weights (gross-with-tare
   * from the receipt). The rest is picked/filled only where still empty.
   */
  async fillItemFromGoodsReceipt({ goodsReceiptNo, entryMode = 'SINGLE TAG', referenceType = 'Combination', article = 'Tendulkar', purity = '91.60', noOfPcs, grossWeightWithTare, makingType = 'Direct', makingCharges = 1200 }) {
    await this.pickByLabel('Goods Receipt', this.shortCore(goodsReceiptNo))
      .catch(() => this.pick('goodsReceipt', this.shortCore(goodsReceiptNo)));
    await this.page.waitForTimeout(2_500);

    // the GR pick does NOT auto-fill the item (unlike the jobwork one-pick):
    // entry data and the gross-with-tare weight are entered manually; rate
    // computes after the article/purity picks; making charges defaults 1200
    if (!(await this.selectValue('entryMode'))) await this.pick('entryMode', entryMode);
    if (!(await this.selectValue('referenceType'))) await this.pick('referenceType', referenceType);
    if (!(await this.selectValue('article'))) await this.pick('article', article, { search: true });
    if (!(await this.selectValue('purity'))) await this.pick('purity', purity);
    if (noOfPcs !== undefined && !(await this.noOfPcs.inputValue())) await this.noOfPcs.fill(String(noOfPcs));
    const gwt = this.inputByLabel('Gross Weight With Tare');
    if (grossWeightWithTare !== undefined && !Number(await gwt.inputValue().catch(() => 0))) {
      await this.fillByLabel('Gross Weight With Tare', grossWeightWithTare);
    }
    if (!(await this.selectValue('makingType').catch(() => 'skip'))) {
      await this.pick('makingType', makingType).catch(() => {});
    }
    const mc = await this.makingCharges.inputValue().catch(() => 'skip');
    if (makingCharges !== undefined && !mc) {
      await this.makingCharges.fill(String(makingCharges));
      await this.makingCharges.blur();
    }
    await this.page.waitForTimeout(2_000);
    console.log('GR item state: article', await this.selectValue('article').catch(() => ''),
      '| gross with tare', await gwt.inputValue().catch(() => '?'),
      '| making charges', mc);
  }

  /** Distinctive middle segment of a composed doc no (series permute). */
  shortCore(docNo) {
    const s = String(docNo).replace(/w?june/gi, '').replace(/d4\d{4}\/\d{4}/gi, '');
    return s.split(/[^A-Za-z0-9]+/).filter(Boolean)[0] || String(docNo);
  }

  /**
   * Item entry on step 2. Auto-populated fields (Wastage, Making) are left
   * alone. Selecting an Article by search back-fills Group Category and
   * Category on its own, so the cascade fields are optional.
   */
  async fillItem({ entryMode, referenceType, groupCategory, category, article, purity, noOfPcs, grossWeightWithTare, rate }) {
    await this.pick('entryMode', entryMode);
    await this.pick('referenceType', referenceType);
    if (groupCategory) await this.pick('groupCategory', groupCategory);
    if (category) await this.pick('category', category);
    await this.pick('article', article, { search: true });
    await this.pick('purity', purity);

    await this.noOfPcs.fill(String(noOfPcs));
    await this.fillByLabel('Gross Weight With Tare', grossWeightWithTare);
    await this.fillByLabel('Rate', rate);
  }
}

module.exports = { MetalInwardPage };
