const fs = require('fs');
const path = require('path');

/**
 * Demo files for upload fields.
 *
 * PRIMARY SOURCE: the "Demo files folder" at the project root, maintained by
 * the QA lead - drop any images / PDFs / spreadsheets there and they are
 * discovered at runtime (no script changes needed). Files are sorted by
 * name; "Earrings for Women.jpg" is preferred as image1 to match the
 * recorded manual flow.
 *
 * FALLBACK: generated files in fixtures/assets/ (used when the demo folder
 * is missing on a machine).
 *
 * Usage from any spec or page object:
 *   const { DEMO_FILES } = require('../../utils/demo-files');
 *   await input.setInputFiles(DEMO_FILES.image1);   // or .pdf / .excel
 *   DEMO_FILES.images  // every image in the folder
 */
const DEMO_DIR = path.join(__dirname, '..', 'Demo files folder');
const ASSETS = path.join(__dirname, '..', 'fixtures', 'assets');

function listDemo(extensions) {
  try {
    return fs.readdirSync(DEMO_DIR)
      .filter((f) => extensions.includes(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => path.join(DEMO_DIR, f));
  } catch {
    return [];
  }
}

const images = listDemo(['.jpg', '.jpeg', '.png']);
const pdfs = listDemo(['.pdf']);
const excels = listDemo(['.xlsx', '.xls', '.csv']);

// the recorded manual flow used this file - keep it as the first choice
const preferred = images.find((p) => /earrings for women/i.test(p));
if (preferred) {
  images.splice(images.indexOf(preferred), 1);
  images.unshift(preferred);
}

const fallback = (name) => path.join(ASSETS, name);

const DEMO_FILES = {
  images,
  image1: images[0] || fallback('demo-image-1.jpg'),
  image2: images[1] || fallback('demo-image-2.png'),
  image3: images[2] || fallback('demo-image-3.jpg'),
  pdf: pdfs[0] || fallback('demo-document.pdf'),
  excel: excels[0] || fallback('demo-sheet.xlsx'),
};

module.exports = { DEMO_FILES, DEMO_DIR, ASSETS };
