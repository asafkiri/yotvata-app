import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
function setup({ weakIdentity = false } = {}) {
  const data = fixture('yotvata'); data.products[1].price = 7.3;
  const doc = data.paper.scan.documents[0], milk = doc.rows[0];
  // Two misread prices happen to cancel in the invoice total. Correcting one
  // must not silently change the invoice anchor to make the other look valid.
  Object.assign(milk, { unitPriceExVat: 6, grossLineTotalExVat: 60, lineTotalExVat: 60 });
  const coffee = { ...milk, description: 'קפה בדיקה', barcode: '7290000000015', barcodeObserved: '7290000000015',
    quantity: 6, unitPriceExVat: 5.6333, grossLineTotalExVat: 33.8, lineTotalExVat: 33.8, lineNumber: 2 };
  if (weakIdentity) Object.assign(coffee, { barcode: null, barcodeObserved: null, barcodeReadType: 'unreadable',
    barcodeMatchMethod: 'suggested_name_only', catalogHintId: 'coffee', barcodeSuggestedProductId: 'coffee', barcodeSuggested: '7290000000015' });
  doc.rows.push(coffee);
  Object.assign(doc, { invoiceNumber: 'TEST-CORRECTION', subtotalExVat: 93.8, printedUnits: 16, printedLines: 2 });
  doc.__pricePaper = structuredClone(doc); doc.__priceSourceId = 'source-test';
  const saved = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  const c = runtime('yotvata', { data }); c.context.paperFixture = saved;
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];recomputeNoteTotal();
    receiptList=[{productId:'milk',name:'חלב בדיקה',qty:9},{productId:'coffee',name:'קפה בדיקה',qty:6}];
    restoreDraftScan(paperFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  return { c, data };
}
async function edit(c, index, qty, unit, total) {
  await c.click('paper-row-edit', '', { doc: '0', row: String(index) });
  assert.ok(c.events.has('paperRowSave:click'), 'The visible action opens a working editor');
  c.node('paperRowQty').value = String(qty); c.node('paperRowUnit').value = String(unit); c.node('paperRowTotal').value = String(total);
  await c.events.get('paperRowSave:click')();
}
function finish(c) {
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  return json(c, 'pendingReceipt');
}

test('the price warning offers a paper correction directly and keeps catalog editing secondary', () => {
  const { c } = setup(); const html = c.run('receiptPriceAuditHtml()');
  assert.match(html, /הפענוח שגוי — תקן לפי הנייר/);
  assert.ok(html.indexOf('data-role="paper-row-edit"') < html.indexOf('data-role="edit-prod"'));
  assert.match(html, /<details[^>]*>.*?הנתונים מהנייר נכונים, והמחיר במאגר לא מעודכן/);
});

test('corrected paper values drive price review and final payment while the original OCR and catalog remain unchanged', async () => {
  const { c } = setup(); const original = c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'), catalog = c.run('JSON.stringify(products)');
  await edit(c, 0, 10, 5, 50);
  assert.equal(c.run('paperRowCorrectionProblems().length'), 1);
  assert.match(c.run('receiptPriceAuditHtml()'), /השורות עדיין אינן תואמות לסיכום החשבונית/);
  c.run('finishReceipt()'); assert.equal(c.run('pendingReceipt'), null);
  await edit(c, 1, 6, 7.3, 43.8);
  assert.equal(c.run('paperRowCorrectionProblems().length'), 0);
  const report = json(c, 'receiptPriceAudit()');
  assert.equal(report.complete, true); assert.ok(report.rows.every(r => r.result === 'match'));
  assert.equal(report.rows[0].originalUnitPrice, 5); assert.equal(report.rows[1].comparisonPrice, 7.3);
  assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /data-price-row=/);
  assert.match(c.run('receiptPriceAuditHtml()'), /תיקונים שאישרת לפי הנייר/);
  assert.equal(c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'), original);
  assert.equal(c.run('JSON.stringify(products)'), catalog); assert.equal(c.run('receiptNoteTotal'), 93.8);
  const p = finish(c); assert.ok(p); assert.equal(p.ex, 88.8);
  assert.equal(p.lines.find(r => r.productId === 'milk').unitPrice, 5);
  assert.equal(p.lines.find(r => r.productId === 'milk').noteQty, 10);
  assert.equal(p.lines.find(r => r.productId === 'coffee').unitPrice, 7.3);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}'); await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.ok(saved); assert.equal(saved.totalExVat, 88.8);
  assert.equal(saved.priceAudit.rows[0].paperCorrection.values.unitPriceExVat, 5);
  assert.equal(JSON.parse(saved.priceAudit.rows[0].paperCorrection.originalEvidence).unitPriceExVat, 6);
  assert.equal(c.requests.length, 0);
});

test('a price correction reaffirms the approved product instead of invalidating its identity evidence', async () => {
  const { c } = setup({ weakIdentity: true });
  c.run(`const src=aiSourceRow(0,1), candidate=priceAuditIdentityCandidate(src.mapped);
    priceAuditConfirmIdentity(0,1,candidate.productId,candidate.barcode,priceAuditIdentityReviewToken(src,candidate));`);
  await edit(c, 0, 10, 5, 50); await edit(c, 1, 6, 7.3, 43.8);
  assert.equal(c.run('priceAuditIdentity(aiScanResponse.scan.documents[0].rows[1]).id'), 'coffee');
  assert.equal(json(c, 'receiptPriceAudit()').rows[1].result, 'match');
});

test('both balanced corrections and an unfinished correction survive reload with no new OCR', async () => {
  for (const complete of [false, true]) {
    const { c, data } = setup(); await edit(c, 0, 10, 5, 50); if (complete) await edit(c, 1, 6, 7.3, 43.8);
    const reload = runtime('yotvata', { data, storage: c.storage });
    assert.equal(reload.run('aiScanResponse.scan.documents[0].rows[0].unitPriceExVat'), 5);
    assert.equal(reload.run('priceAuditSource(aiScanResponse.scan.documents[0]).rows[0].unitPriceExVat'), 5);
    assert.equal(reload.run('aiScanResponse.scan.documents[0].__pricePaper.rows[0].unitPriceExVat'), 6);
    if (complete) assert.equal(finish(reload).ex, 88.8);
    else { reload.run('finishReceipt()'); assert.equal(reload.run('pendingReceipt'), null); await edit(reload, 1, 6, 7.3, 43.8); assert.equal(finish(reload).ex, 88.8); }
    assert.equal(reload.requests.length, 0);
  }
});

test('correcting paper does not erase a real price difference', async () => {
  const { c } = setup(); await edit(c, 0, 10, 5.1, 51); await edit(c, 1, 6, 7.1333, 42.8);
  assert.equal(c.run('paperRowCorrectionProblems().length'), 0);
  const r = json(c, 'receiptPriceAudit()').rows[0]; assert.equal(r.result, 'difference');
  assert.equal(r.comparisonPrice, 5.1); assert.equal(c.run('products[0].price'), 5);
  assert.match(c.run('receiptPriceAuditHtml()'), /המחיר בתעודה שונה מהמחיר שבמאגר/);
});

for (const [qty, unit, total] of [['',5,50], [0,5,0], [1.5,5,7.5], [10,0,0], [10,5,51], [10,5,-50], [10,'NaN',50], [10,5,'50.001']]) {
  test('invalid paper values remain in the editor without changing the receipt: ' + [qty,unit,total].join('/'), async () => {
    const { c } = setup(); const before = c.run('JSON.stringify(aiScanResponse)'); await edit(c, 0, qty, unit, total);
    assert.equal(c.run('JSON.stringify(aiScanResponse)'), before); assert.ok(c.node('paperRowError').textContent.length > 0);
  });
}

test('cancel and a late confirmation of a changed row cannot modify the document', async () => {
  const { c } = setup(); const before = c.run('JSON.stringify(aiScanResponse)');
  c.run('openPaperRowCorrection(0,0)'); c.events.get('paperRowCancel:click')();
  assert.equal(c.run('JSON.stringify(aiScanResponse)'), before);
  c.run('openPaperRowCorrection(0,0)'); c.node('paperRowQty').value='10'; c.node('paperRowUnit').value='5'; c.node('paperRowTotal').value='50';
  c.run('aiScanResponse.scan.documents[0].rows[0].quantity=11'); c.events.get('paperRowSave:click')();
  assert.equal(c.run('aiScanResponse.scan.documents[0].rows[0].unitPriceExVat'), 6);
  assert.match(c.node('paperRowError').textContent, /השתנו בזמן העריכה/);
});

test('correcting quantity preserves counted goods and requires matching the printed units total', async () => {
  const { c } = setup(); const counted = c.run('JSON.stringify(receiptList)');
  await edit(c, 0, 9, 5, 45); assert.equal(c.run('JSON.stringify(receiptList)'), counted);
  assert.equal(c.run('receiptNoteUnits'), 16); assert.equal(c.run('paperRowCorrectionProblems().length'), 1);
  c.run('finishReceipt()'); assert.equal(c.run('pendingReceipt'), null);
});

test('a later edit replaces the correction without rewriting the original scan', async () => {
  const { c } = setup(); await edit(c, 0, 10, 5.1, 51); await edit(c, 0, 10, 5, 50); await edit(c, 1, 6, 7.3, 43.8);
  const doc = json(c, 'aiScanResponse.scan.documents[0]');
  assert.equal(doc.rows[0].paperValuesCorrection.previous.values.unitPriceExVat, 5.1);
  assert.equal(doc.__pricePaper.rows[0].unitPriceExVat, 6);
  assert.equal(json(c, 'receiptPriceAudit()').rows[0].result, 'match');
});
