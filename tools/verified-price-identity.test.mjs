import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, fixture} from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const row = 'aiScanResponse.scan.documents[0].rows[0]';
const resolution = c => json(c, 'aiResolveInvoiceBarcode(' + row + ')');
const audit = c => json(c, 'receiptPriceAudit().rows[0]');
function setup({selectedRead = 0, peer = 1, change = () => {}} = {}) {
  const data = fixture('yotvata'), doc = data.paper.scan.documents[0], r = doc.rows[0];
  data.products[0] = {...data.products[0], name: 'מעדן פרו וניל', price: 3.61};
  data.products[1] = {...data.products[1], name: 'משקה פרו צהוב', price: 5.24};
  data.items = [{productId: 'coffee', name: data.products[1].name, barcode: data.products[1].barcode, qty: 6}];
  Object.assign(r, {barcode: null, barcodeObserved: '7290000009999', barcodeReadType: 'full',
    barcodeMatchMethod: 'suggested_name_multiple', description: 'יוגורט פרו וניל', confidence: .5,
    catalogHintId: null, catalogCandidateHintIds: ['milk', 'coffee'], quantity: 6,
    unitPriceExVat: 5.24, grossLineTotalExVat: 31.44, lineDiscountExVat: null, lineTotalExVat: 31.44});
  const candidates = data.products.map(p => ({productId: p.id, barcode: p.barcode}));
  r.barcodeSuggestedCandidates = structuredClone(candidates);
  const fields = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
    'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
  const evidence = Object.fromEntries(fields.map(k => [k, r[k] ?? null]));
  r.modelVerification = {version: 1, status: 'needs_review', selectedRead, strongSelected: selectedRead === 2,
    issues: ['identity'], identity: null, identitySupport: [], candidates,
    fieldSupport: Object.fromEntries(fields.slice(-5).map(k => [k, [peer]])), evidence,
    readings: [{read: selectedRead, identity: candidates[0], values: structuredClone(evidence)},
      {read: peer, identity: candidates[1], values: structuredClone(evidence)}]};
  Object.assign(doc, {subtotalExVat: 31.44, printedUnits: 6, itemsSectionTotalExVat: 31.44});
  data.paper.serviceVersion = 147;
  change(data, r, doc);
  doc.__pricePaper = structuredClone(doc); doc.__priceSourceId = 'verified-price-fixture';
  const c = runtime('yotvata', {data});
  c.context.savedPriceScan = {...data.paper, docInputs: [{amount: doc.subtotalExVat, units: 6, pageCount: 1}]};
  c.run("receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedPriceScan);receiptPaperScanState='ok';receiptDocDate='2026-09-20';receiptNotes=[{amount:aiScanResponse.scan.documents[0].subtotalExVat,units:6}];recomputeNoteTotal();receiptList=structuredClone(testData.items);saveReceiptDraft();renderReceiving()");
  return {c, data};
}

test('two cheap reads verify the price and select its matching product without an identity question', () => {
  const {c, data} = setup();
  assert.equal(resolution(c).product.id, 'coffee');
  assert.equal(resolution(c).method, 'verified_price_name');
  assert.deepEqual(resolution(c).identityEvidence.priceVerification, {selectedRead: 0, supportingReads: [1], unitPrice: 5.24});
  assert.equal(audit(c).result, 'match');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true);
  assert.equal(c.run("aiEvaluateInvoiceScan(aiScanResponse).aggregates.get('coffee').totalCents"), 3144);
  assert.deepEqual(json(c, row), data.paper.scan.documents[0].rows[0]);
  assert.equal(c.requests.length, 0);
});

test('strong read agreeing with either cheap read is sufficient even with low name confidence', () => {
  for (const [selectedRead, peer] of [[2, 0], [2, 1], [0, 2], [1, 2]]) {
    const {c} = setup({selectedRead, peer});
    assert.equal(audit(c).productId, 'coffee');
    assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  }
});

test('equal-price names are ranked by similarity, including a catalog match missing from model hints', () => {
  const {c} = setup({change: (data, r) => {
    data.products[0].price = 5.24;
    data.products.push({id: 'closest', name: 'יוגורט פרו וניל', price: 5.24, barcode: '7290000000022'});
  }});
  assert.equal(resolution(c).product.id, 'closest');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.ok(json(c, 'aiRowChoiceCandidates(' + row + ')').some(p => p.product.id === 'closest'));
});

test('a name tie at the same price follows the strong read, never catalog insertion order', () => {
  const {c} = setup({selectedRead: 0, peer: 2, change: data => {
    data.products[0].price = 5.24;
    data.products[0].name = data.products[1].name = 'יוגורט פרו וניל';
  }});
  assert.equal(resolution(c).product.id, 'coffee');
});

test('single, duplicate, altered, cross-page or inexact price readings cannot confirm the price', () => {
  for (const edit of [
    "r.modelVerification.readings.pop()", "r.modelVerification.readings[1].read=0",
    "r.modelVerification.readings[1].values.unitPriceExVat=5.2401",
    "r.modelVerification.readings[1].values.sourcePage=2",
    "r.modelVerification.fieldSupport.unitPriceExVat=[0]",
    "r.unitPriceExVat=5.2401", "r.description='changed source'",
    "r.modelVerification.issues.push('unitPriceExVat')"
  ]) {
    const {c} = setup(); c.run('{const r=' + row + ';' + edit + '}');
    assert.equal(resolution(c).product, undefined, edit);
    assert.equal(audit(c).capability, 'unidentified', edit);
  }
});

test('catalog mismatch, duplicate barcode or unrelated names leave the identity for review', () => {
  for (const edit of ["products[1].price=5.2401", "products.push({...products[1],id:'duplicate'})",
    "products[1].price=6;products.push({id:'unrelated',name:'לחם שחור',price:5.24,barcode:'7290000000022'})"]) {
    const {c} = setup(); c.run(edit);
    assert.equal(resolution(c).product, undefined, edit);
    assert.equal(audit(c).capability, 'unidentified', edit);
  }
});

test('verified price resolves the name while a real quantity disagreement still blocks receiving', () => {
  const {c} = setup({change: (data, r, doc) => {
    r.modelVerification.issues.push('quantity'); r.modelVerification.fieldSupport.quantity = [];
    r.modelVerification.readings[1].values.quantity = 7;
    // v367: a quantity the arithmetic proves on a balanced paper is no longer a dispute (6 × 5.24 = 31.44 exactly,
    // 6 units printed — quantity-arithmetic.test.mjs), so this row's money is printed as 31.40: neither 6 nor 7
    // times 5.24 gives it, the paper still balances, and the price (5.24, supported) still resolves the name.
    for (const target of [r, r.modelVerification.evidence, ...r.modelVerification.readings.map(x => x.values)]) target.grossLineTotalExVat = target.lineTotalExVat = 31.4;
    doc.subtotalExVat = doc.itemsSectionTotalExVat = 31.4;
  }});
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 1).ok'), true);
  assert.equal(c.run('priceAuditQuantityProvenByArithmetic(aiScanResponse.scan.documents[0], ' + row + ')'), false);
  assert.equal(resolution(c).product.id, 'coffee');
  assert.equal(audit(c).capability, 'partial');
  assert.deepEqual(audit(c).modelReviewIssues, ['quantity']);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false);
  assert.equal(c.run("aiEvaluateInvoiceScan(aiScanResponse).aggregates.has('coffee')"), false);
});

test('automatic identity preserves an actual promotion gap in the financial audit without another OCR approval', () => {
  const {c} = setup({change: data => {
    data.promos = [{id: 'promo', productIds: ['coffee'], pct: 20, minQty: 1, minUnit: 'unit', start: '2026-09-01', end: '2026-09-30'}];
  }});
  assert.equal(audit(c).result, 'difference');
  assert.equal(audit(c).paperConfirmed, true);
  assert.equal(audit(c).expectedOptions[0].lineDifference, 6.29);
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
});

test('an exact active promotion price can match a product when the printed quantity qualifies', () => {
  const {c} = setup({change: data => {
    data.products[1].price = 6.55;
    data.promos = [{id: 'promo', productIds: ['coffee'], pct: 20, minQty: 6, minUnit: 'unit', start: '2026-09-01', end: '2026-09-30'}];
  }});
  assert.equal(resolution(c).identityEvidence.priceBasis, 'active_promotion');
  assert.equal(audit(c).result, 'match');
  c.run('promos[0].minQty=7');
  assert.equal(resolution(c).product, undefined);
});

test('restoration reuses the independent votes and keeps the extracted paper unchanged', () => {
  const {c, data} = setup();
  const before = json(c, 'aiScanResponse.scan.documents[0].__pricePaper');
  const restored = runtime('yotvata', {data, storage: c.storage});
  assert.equal(audit(restored).productId, 'coffee');
  assert.equal(restored.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.deepEqual(json(restored, 'aiScanResponse.scan.documents[0].__pricePaper'), before);
  assert.equal(c.requests.length + restored.requests.length, 0);
});

test('promotion comparison keeps sub-agora precision and tolerates only binary arithmetic noise', () => {
  const {c} = setup({change: (data, r, doc) => {
    data.products[1].price = 15.91;
    data.promos = [{id: 'promo', productIds: ['coffee'], pct: 15, minQty: 1, minUnit: 'unit', start: '2026-09-01', end: '2026-09-30'}];
    for (const values of [r, r.modelVerification.evidence, ...r.modelVerification.readings.map(read => read.values)])
      Object.assign(values, {unitPriceExVat: 13.5235, grossLineTotalExVat: 81.14, lineTotalExVat: 81.14});
    doc.subtotalExVat = doc.itemsSectionTotalExVat = 81.14;
  }});
  assert.equal(resolution(c).product.id, 'coffee');
  assert.equal(audit(c).result, 'match');
  c.run('{const r=' + row + ';for(const v of [r,r.modelVerification.evidence,...r.modelVerification.readings.map(x=>x.values)])v.unitPriceExVat=13.5236;}');
  assert.equal(resolution(c).product, undefined);
});

test('the optional change-product action overrides automation and survives reload', async () => {
  const {c, data} = setup();
  assert.match(c.run('receiptPriceAuditHtml()'), /<details data-price-automatic/);
  await c.click('ai-confirm-name-candidate', '', {doc: '0', row: '0', candidateId: 'milk'});
  assert.equal(resolution(c).product.id, 'milk');
  assert.equal(c.run(row + '.barcodeMatchMethod'), 'user_confirmed');
  assert.equal(resolution(runtime('yotvata', {data, storage: c.storage})).product.id, 'milk');
});

test('final receipt retains the exact payable, source and automatic price evidence', async () => {
  const {c} = setup();
  c.run('logAction=()=>{};aiScanFromDraft=true;showConfirm=(title,text,label,fn)=>fn();finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  assert.equal(c.run('pendingReceipt.ex'), 31.44);
  const mappings = json(c, 'aiAutomaticNamePriceMappingsAudit()');
  assert.equal(mappings[0].confirmationSource, 'verified_price_name');
  assert.equal(mappings[0].priceVerification.unitPrice, 5.24);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.equal(saved.totalExVat, 31.44);
  assert.equal(saved.priceAudit.rows[0].productId, 'coffee');
  assert.equal(saved.priceAudit.rows[0].result, 'match');
  assert.equal(c.requests.length, 0);
});
