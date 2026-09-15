import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
function setup({ images = false, twoPages = false } = {}) {
  const data = fixture('yotvata');
  data.products.push({ id: 'third', name: 'המוצר הנכון', barcode: '7290000000022', price: 7 });
  const base = data.paper.scan.documents[0];
  const numbered = { ...structuredClone(base), invoiceNumber: 'TEST-900', noteIndex: 0 };
  const unnumbered = { ...structuredClone(base), noteIndex: 1, subtotalExVat: 120, printedUnits: 24, printedLines: 4,
    pageCount: twoPages ? 2 : 1, rows: Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(base.rows[0]),
      sourcePage: twoPages && i >= 2 ? 2 : 1, lineNumber: null, quantity: 6, unitPriceExVat: 5, lineTotalExVat: 30, grossLineTotalExVat: 30 })) };
  Object.assign(unnumbered.rows[2], { description: 'תיאור לא בטוח', barcode: null, barcodeMatchMethod: 'conflicting_reads',
    barcodeRetryConflict: true, barcodeInitialObserved: '7290000000008', barcodeObserved: '7290000000008',
    barcodeRetryObserved: '7290000000015', barcodeInitialReadType: 'full', barcodeRetryReadType: 'full',
    barcodeRetryAttempted: true, barcodeRetryApplied: false, barcodeRetryConfidence: .99,
    rowRegion: { x: 50, y: 500, width: 900, height: 40 } });
  for (const d of [numbered, unnumbered]) d.__pricePaper = structuredClone(d);
  const saved = { ...data.paper, scan: { warnings: [], documents: [numbered, unnumbered] },
    docInputs: [{ amount: 50, units: 10, pageCount: 1 }, { amount: 120, units: 24, pageCount: unnumbered.pageCount }] };
  const c = runtime('yotvata', { data });
  c.context.reviewSaved = saved;
  c.run("receiptOpened=true;receiptNotes=[{amount:50,units:10},{amount:120,units:24}];restoreDraftScan(reviewSaved);receiptPaperScanState='ok'");
  if (images) c.run("aiScanDocuments.forEach(d=>{d.pages=Array.from({length:d.restoredPageCount},()=>({dataUrl:'data:image/png;base64,AA==',orientationConfirmed:true}));});");
  return { c, data };
}

test('unnumbered source shows amount, page, ordinal, paper text and amounts without inventing a printed line', () => {
  const { c } = setup();
  const before = c.run('JSON.stringify(aiScanResponse)');
  const view = c.run('receiptPriceAuditHtml()');
  assert.match(view, /תעודה בסך ₪120\.00 לפני מע״מ/);
  assert.match(view, /24 יחידות בתעודה/);
  assert.match(view, /עמוד 1 מתוך 1 · שורת מוצר 3 מתוך 4 לפי סדר הפענוח — לפני האחרונה/);
  assert.match(view, /ייתכן שהשם שגוי/);
  assert.match(view, /צילום העמוד אינו זמין במכשיר/);
  assert.match(view, /המוצר לא ברשימה/);
  assert.doesNotMatch(view, /שורה לא נקראה/);
  assert.equal(before, c.run('JSON.stringify(aiScanResponse)'));
  assert.equal(c.requests.length, 0);
});

test('page ordinals restart per page, while actual printed numbers remain distinct', () => {
  const { c } = setup({ twoPages: true });
  assert.match(c.run('aiSourceRow(1,2).position'), /עמוד 2 מתוך 2 · שורת מוצר 1 מתוך 2 לפי סדר הפענוח/);
  assert.match(c.run('aiSourceRow(0,0).position'), /שורה מודפסת 1/);
  c.run('aiScanResponse.scan.documents.reverse()');
  assert.match(c.run('aiSourceRow(1,2).title'), /120\.00/);
  assert.match(c.run('aiSourceRow(0,0).title'), /TEST-900/);
});

test('photo action opens the correct page read-only with its document and row labels', () => {
  const { c } = setup({ images: true, twoPages: true });
  const before = c.run('JSON.stringify(receiptScanSnapshot())');
  const html = c.run('aiSourceRowHtml(1,2)');
  assert.match(html, /data-role="ai-open-source-row" data-doc="1" data-row="2"/);
  assert.match(html, /מיקום משוער/);
  assert.doesNotMatch(html, /src="data:/); // Hidden cards do not duplicate large photos.
  const image = { src: '', removeAttribute() { this.src = ''; } };
  c.context.photoDetails = { dataset: { sourcePhoto: '', doc: '1', row: '2' }, open: true, querySelector: () => image };
  c.run('aiToggleSourcePhoto(photoDetails)');
  assert.equal(image.src, 'data:image/png;base64,AA==');
  c.context.photoDetails.open = false;
  c.run('aiToggleSourcePhoto(photoDetails)');
  assert.equal(image.src, '');
  assert.equal(c.run('aiOpenSourceRowPage(1,2)'), true);
  assert.equal(c.run('aiOrientationSession.page === aiScanDocuments[1].pages[1]'), true);
  assert.equal(c.run('aiOrientationSession.reviewOnly'), true);
  assert.match(c.node('aiOrientationLabel').textContent, /120\.00.*עמוד 2/);
  c.run('aiCloseOrientationReview()');
  assert.equal(before, c.run('JSON.stringify(receiptScanSnapshot())'));
  assert.equal(c.requests.length, 0);
});

test('a manually read barcode requires confirmation, preserves paper values, surfaces a price gap and survives reload', async () => {
  const { c, data } = setup();
  const before = json(c, 'aiScanResponse.scan.documents[1].rows[2]');
  const paper = c.run('JSON.stringify(aiScanResponse.scan.documents[1].__pricePaper)');
  c.run("showInputModal=async()=> '7290000000022'");
  assert.equal(await c.run('aiEnterPrintedBarcode(1,2)'), true);
  assert.match(c.node('confirmMsg').textContent, /המוצר הנכון/);
  assert.deepEqual(before, json(c, 'aiScanResponse.scan.documents[1].rows[2]'));
  c.run('confirmCb()');
  let r = json(c, 'receiptPriceAudit().rows.find(r=>r.documentIndex===1&&r.rowIndex===2)');
  assert.equal(r.productId, 'third');
  assert.equal(r.result, 'difference'); // Printed 5 against catalog 7, never overwritten.
  assert.equal(r.originalUnitPrice, 5);
  assert.equal(r.quantity, 6);
  assert.equal(paper, c.run('JSON.stringify(aiScanResponse.scan.documents[1].__pricePaper)'));
  assert.equal(c.run('receiptList.length'), 0);
  const b = runtime('yotvata', { data, storage: c.storage });
  r = json(b, 'receiptPriceAudit().rows.find(r=>r.documentIndex===1&&r.rowIndex===2)');
  assert.equal(r.productId, 'third');
  assert.equal(r.result, 'difference');
  const audit = json(b, 'aiConfirmedMappingsAudit()');
  assert.equal(audit[0].confirmationSource, 'manual_paper_barcode');
  assert.equal(audit[0].enteredBarcode, '7290000000022');
  assert.equal(c.requests.length + b.requests.length, 0);
});

test('cancelled, invalid, absent and duplicate barcodes never change the row', async () => {
  for (const entered of [null, '0000000000001', '7290000000039', '7290000000022']) {
    const { c } = setup();
    if (entered === '7290000000022') c.run("products.push({id:'duplicate',barcode:'7290000000022',price:7})");
    const before = c.run('JSON.stringify(aiScanResponse)');
    c.context.testEntered = entered;
    c.run('showInputModal=async()=>testEntered');
    assert.equal(await c.run('aiEnterPrintedBarcode(1,2)'), false);
    assert.equal(c.run('JSON.stringify(aiScanResponse)'), before);
  }
});

test('an open confirmation cannot apply to a changed row, document, or catalog', async () => {
  for (const change of ["aiScanResponse.scan.documents[1].rows[2].quantity=7", 'restoreDraftScan(structuredClone(reviewSaved))', "products.find(p=>p.id==='third').barcode='7290000000039'"]) {
    const { c } = setup();
    c.run("showInputModal=async()=> '7290000000022'");
    await c.run('aiEnterPrintedBarcode(1,2)');
    c.run(change);
    const before = c.run('JSON.stringify(aiScanResponse)');
    c.run('confirmCb()');
    assert.equal(c.run('JSON.stringify(aiScanResponse)'), before);
    assert.match(c.toasts.at(-1), /השתנו/);
  }
});

test('manual confirmation stops being valid when its barcode or product binding changes', async () => {
  const { c } = setup();
  c.run("showInputModal=async()=> '7290000000022'");
  await c.run('aiEnterPrintedBarcode(1,2)'); c.run('confirmCb()');
  c.run("aiScanResponse.scan.documents[1].rows[2].barcodeUserEntered='7290000000008'");
  assert.equal(c.run('!!aiResolveInvoiceBarcode(aiScanResponse.scan.documents[1].rows[2]).product'), false);
});
