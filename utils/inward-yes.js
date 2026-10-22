const { uniqueInvoiceNo, businessDate } = require('./unique');

/**
 * Shared steps of the "Metal Inward -> Process with Barcode or Lot? = Yes"
 * chains that start from an outsourced job work (Direct, B2B order or stock
 * order): the jobwork-return inward is filled up to - not including - its
 * Submit, and the numbers the dialog's single save produces are read back
 * from the response bodies. Assertions stay in the specs.
 */

/**
 * Jobwork-return Metal Inward (Sub Transaction Type "Jobwork" + Inward Type
 * "Order") for job work item `<jobWorkNo>.001`, ready for Submit. Returns
 * the article the item picker auto-filled (the spec asserts on it).
 */
async function jobworkInwardUpToSubmit(metalInward, { vendor, jobWorkNo, businessUnit = 'Cochin', inwardType = 'Order' }) {
  await metalInward.open();
  await metalInward.openAddWizard();
  await metalInward.fillJobworkBasicDetails({
    businessUnit,
    vendor,
    inwardType,
    invoiceNo: uniqueInvoiceNo(), // duplicates are blocked - always random
    invoiceDate: businessDate(0).replace(/-/g, '/'),
  });
  await metalInward.clickNext();
  await metalInward.waitForIdle();

  // one pick fills the whole item form from the issued job work
  const article = await metalInward.addJobworkItem(`${jobWorkNo}.001`);

  await metalInward.clickNext();
  await metalInward.waitForIdle();
  return article;
}

/** Every document number the saves carry anywhere: the inward M###, lots NN##, tags 2026-06-23000##. */
function numbersIn(bodies) {
  const text = JSON.stringify(bodies || []);
  const uniq = (list) => [...new Set(list.map((m) => m.replace(/"/g, '')))];
  return {
    inward: (text.match(/"receiptNo":"(M\d+)"/) || [])[1] || '',
    lots: uniq(text.match(/"(N{2,}\d+)"/g) || []),
    tags: uniq(text.match(/"(\d{4}-\d{2}-\d{2}\d{3,})"/g) || []),
  };
}

module.exports = { jobworkInwardUpToSubmit, numbersIn };
