import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const pending = c => json(c, 'priceAuditPendingRows(receiptPriceAudit())');
const originalWarning = 'Some item descriptions are abbreviated as printed; line 17 description is partially unclear.';

function setup({ rows = 18, documentWarning = originalWarning, scanWarning = null, change } = {}) {
  const data = fixture('yotvata'), doc = data.paper.scan.documents[0];
  doc.rows = Array.from({ length: rows }, (_, i) => ({ ...structuredClone(doc.rows[0]), lineNumber: i + 1 }));
  Object.assign(doc, { invoiceNumber: 'TEST-WARNINGS', subtotalExVat: rows * 50,
    itemsSectionTotalExVat: rows * 50, printedUnits: rows * 10,
    itemsPrintedLines: rows, printedLines: rows,
    warnings: documentWarning ? [documentWarning] : [] });
  data.paper.scan.warnings = scanWarning ? [scanWarning] : [];
  if (change) change(doc, data);
  doc.__pricePaper = structuredClone(doc);
  const saved = { ...data.paper, docInputs: [{ amount: doc.subtotalExVat, units: doc.printedUnits, pageCount: 1 }] };
  const c = runtime('yotvata', { data, handoff: false });
  c.context.warningSaved = saved;
  c.run("receiptOpened=true;receiptEntryMode='photo';restoreDraftScan(warningSaved);receiptPaperScanState='ok';receiptDocDate='2026-10-11';scanPurpose='receiving';saveReceiptDraft()");
  return { c, data };
}

test('a partly unclear description does not turn eighteen verified rows into an unapprovable queue', () => {
  const { c, data } = setup();
  const before = c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)');
  assert.equal(c.run('yotvataPaperCheck(priceAuditSource(aiScanResponse.scan.documents[0]),1).ok'), true);
  const a = report(c);
  assert.equal(a.complete, true);
  assert.equal(a.rows.length, 18);
  assert.ok(a.rows.every(r => r.capability === 'checkable' && r.result === 'match'));
  assert.deepEqual(pending(c), []);
  assert.match(c.run('receiptPriceAuditHtml()'), /המחירים שנבדקו תואמים · 18 שורות/);
  assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /data-price-row=|צריך להשלים את הבדיקה/);
  assert.equal(c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'), before);
  const restored = runtime('yotvata', { data, storage: c.storage, handoff: false });
  assert.equal(report(restored).complete, true);
  assert.deepEqual(pending(restored), []);
  assert.equal(c.requests.length + restored.requests.length, 0, 'existing saved readings require no paid rescan');
});

test('row descriptions and barcode warnings stay local at both document and scan scope', () => {
  const { c } = setup({ rows: 2, documentWarning: null });
  const warnings = [originalWarning, 'Partial barcode in row 2.',
    'The row description is incomplete.', 'Item name partially unreadable.',
    'חסר ברקוד בשורה 2', 'שם המוצר נקרא באופן חלקי'];
  for (const scope of ['document', 'scan']) {
    for (const warning of warnings) {
      c.context.warningValue = warning;
      c.run(`aiScanResponse.scan.warnings=${scope === 'scan' ? '[warningValue]' : '[]'};
        aiScanResponse.scan.documents[0].__pricePaper.warnings=${scope === 'document' ? '[warningValue]' : '[]'};`);
      assert.equal(report(c).complete, true, scope + ': ' + warning);
      assert.deepEqual(pending(c), [], scope + ': ' + warning);
    }
  }
});

test('a real row issue is still actionable when another description is partly unclear', () => {
  const { c } = setup({ rows: 2, change(doc) {
    Object.assign(doc.rows[1], { unitPriceExVat: 6, grossLineTotalExVat: 60, lineTotalExVat: 60 });
    doc.subtotalExVat = doc.itemsSectionTotalExVat = 110;
  } });
  const a = report(c);
  assert.equal(a.rows[0].result, 'match');
  assert.equal(a.rows[1].capability, 'checkable');
  assert.equal(a.rows[1].result, 'difference');
  assert.deepEqual(pending(c).map(r => r.rowIndex), [1]);
  assert.match(c.run('receiptPriceAuditHtml()'), /data-role="price-confirm-paper"/);
});

test('a genuinely unresolved product remains the only row requiring identity review', () => {
  const { c } = setup({ rows: 2, change(doc) {
    Object.assign(doc.rows[1], { description: 'מוצר לא ידוע', itemCode: 'UNKNOWN',
      barcode: null, barcodeObserved: null, barcodeReadType: 'unreadable', barcodeMatchMethod: null });
  } });
  assert.equal(report(c).rows[0].result, 'match');
  assert.deepEqual(pending(c).map(r => r.rowIndex), [1]);
  assert.equal(pending(c)[0].capability, 'unidentified');
  assert.match(c.run('receiptPriceAuditHtml()'), /data-role="ai-manual-paper-barcode"/);
});

test('genuine missing or incomplete document warnings keep final price approval blocked', () => {
  const { c } = setup({ rows: 2, documentWarning: null });
  const warnings = ['Missing page 2', 'Page 2 is missing', 'Partial document',
    'The invoice is incomplete', 'Incomplete scan', 'OCR incomplete',
    'חסר עמוד בתעודה', 'חסר דף אחרון'];
  for (const scope of ['document', 'scan']) {
    for (const warning of warnings) {
      c.context.warningValue = warning;
      c.run(`aiScanResponse.scan.warnings=${scope === 'scan' ? '[warningValue]' : '[]'};
        aiScanResponse.scan.documents[0].__pricePaper.warnings=${scope === 'document' ? '[warningValue]' : '[]'};`);
      assert.equal(report(c).complete, false, scope + ': ' + warning);
      assert.equal(pending(c).length, 2, scope + ': ' + warning);
      assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /data-role="price-confirm-paper"/);
    }
  }
});

test('explicit partial flags, missing pages and unbalanced paper remain blocking', () => {
  const scenarios = {
    partial: doc => { doc.partial = true; },
    incomplete: doc => { doc.incomplete = true; },
    pageCount: doc => { doc.pageCount = 2; },
    subtotal: doc => { doc.subtotalExVat += 1; },
    printedUnits: doc => { doc.printedUnits += 1; },
    printedLines: doc => { doc.printedLines += 1; },
    sourcePage: doc => { doc.rows[0].sourcePage = 2; }
  };
  for (const [name, change] of Object.entries(scenarios)) {
    const { c } = setup({ rows: 2, change });
    assert.equal(report(c).complete, false, name);
    assert.ok(pending(c).length > 0, name);
    assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /המחירים שנבדקו תואמים/, name);
  }
});
