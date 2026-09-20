import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const html = c => c.run('receiptPriceAuditHtml()');
function setup({ gap = false, consensus = false, issues = [], carton = false } = {}) {
  const data = fixture('yotvata'), d = data.paper.scan.documents[0], r = d.rows[0];
  if (gap) { r.unitPriceExVat = 6; r.grossLineTotalExVat = r.lineTotalExVat = 60; d.subtotalExVat = 60; }
  if (carton) data.promos = [{ id: 'p1', name: 'מבצע חלב', productIds: ['milk'], pct: 20, start: '2026-09-01', end: '2026-09-30', minQty: 1, minUnit: 'carton', cartonSize: null }];
  if (consensus) {
    r.barcodeMatchMethod = 'model_consensus';
    r.modelVerification = { version: 1, status: issues.length ? 'needs_review' : 'verified', selectedRead: 2, strongSelected: true,
      identity: { productId: 'milk', barcode: r.barcode }, identitySupport: [1], issues,
      evidence: Object.fromEntries(['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
        'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'].map(k => [k, r[k] ?? null])) };
  }
  d.__pricePaper = structuredClone(d); d.__priceSourceId = 'review-fixture';
  const saved = { ...data.paper, docInputs: [{ amount: d.subtotalExVat, units: 10, pageCount: 1 }] };
  const c = runtime('yotvata', { data }); c.context.savedReview = saved;
  c.run("receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedReview);receiptPaperScanState='ok';receiptDocDate='2026-09-20';receiptNotes=[{amount:aiScanResponse.scan.documents[0].subtotalExVat,units:10}];recomputeNoteTotal();receiptList=structuredClone(testData.items);saveReceiptDraft();renderReceiving()");
  return { c, data };
}
function confirm(c) {
  return c.click('price-confirm-paper', '', { doc: '0', row: '0', reviewToken: c.run('priceAuditPaperReviewToken(receiptPriceAudit().rows[0])') });
}

test('an actual price gap has a working yes action; it folds but remains a financial gap after reload', async () => {
  const { c, data } = setup({ gap: true });
  assert.match(html(c), /data-role="price-confirm-paper"/);
  const before = c.run('JSON.stringify(aiEvaluateInvoiceScan(aiScanResponse))');
  const paper = c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)');
  c.run('pendingReceipt={ex:999}'); await confirm(c);
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(report(c).rows[0].result, 'difference');
  assert.equal(report(c).rows[0].expectedOptions[0].lineDifference, 10);
  assert.equal(report(c).rows[0].paperConfirmed, true);
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.match(html(c), /פערי מחיר שאומתו ונשמרו/);
  assert.doesNotMatch(html(c), /המחירים שנבדקו תואמים|data-price-row=/);
  assert.equal(c.run('JSON.stringify(aiEvaluateInvoiceScan(aiScanResponse))'), before);
  assert.equal(c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'), paper);
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(report(reloaded).rows[0].paperConfirmed, true);
  assert.equal(c.requests.length + reloaded.requests.length, 0);
  await c.click('price-reopen-paper', '', { doc: '0', row: '0' });
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 1);
});

test('changed catalog price, promotion, source, date or identity invalidates acknowledgement', async () => {
  for (const change of ["products[0].price=4", "priceAuditSetDate(0,'2026-09-21')", "aiScanResponse.scan.documents[0].rows[0].description='changed'",
    "promos=[{id:'p',pct:10,start:'2026-09-01',end:'2026-09-30',productIds:['milk']}]", "aiScanResponse.scan.documents[0].__priceSourceId='another'"]) {
    const { c } = setup({ gap: true }); await confirm(c); c.run(change);
    assert.equal(report(c).rows[0].paperConfirmed, false, change);
    assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 1);
  }
});

test('stale card cannot acknowledge changed financial data', async () => {
  const { c } = setup({ gap: true });
  const token = c.run('priceAuditPaperReviewToken(receiptPriceAudit().rows[0])');
  c.run('products[0].price=4');
  await c.click('price-confirm-paper', '', { doc: '0', row: '0', reviewToken: token });
  assert.equal(report(c).rows[0].paperConfirmed, false);
});

test('missing carton size is completed in receiving and saved, with no OCR or changed paper', async () => {
  const { c } = setup({ carton: true });
  const paper = c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)');
  assert.match(html(c), /data-role="price-complete-carton"/);
  assert.doesNotMatch(html(c), /data-role="paper-row-edit"|data-role="rc-photo-capture"/);
  c.run("showInputModal=async()=> '10';pendingReceipt={ex:999}");
  await c.click('price-complete-carton', 'p1', { doc: '0', row: '0' });
  assert.equal(c.writes.at(-1).data.cartonSize, 10);
  assert.equal(c.run('promos[0].cartonSize'), 10);
  assert.equal(report(c).rows[0].capability, 'checkable');
  assert.equal(report(c).rows[0].expectedOptions[0].price, 4);
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'), paper);
  assert.equal(c.requests.length, 0);
});

test('cancelled, invalid, stale or failed carton edits do not claim to save', async () => {
  for (const code of ["showInputModal=async()=>null", "showInputModal=async()=> '1.5'", "showInputModal=async()=>{promos[0].pct=30;return '12'}",
    "showInputModal=async()=> '12';runCloudTask=async()=>false"]) {
    const { c } = setup({ carton: true }); c.run(code);
    await c.click('price-complete-carton', 'p1', { doc: '0', row: '0' });
    assert.equal(c.run('promos[0].cartonSize'), null);
    assert.equal(report(c).rows[0].capability, 'partial');
  }
});

test('strong model agreeing with one cheap read stays verified in price review and after reload', () => {
  const { c, data } = setup({ consensus: true });
  assert.equal(report(c).rows[0].result, 'match');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.doesNotMatch(html(c), /price-confirm-identity|ai-confirm-name-candidate/);
  assert.equal(c.run("aiEvaluateInvoiceScan(aiScanResponse).aggregates.get('milk').qty"), 10);
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(report(reloaded).rows[0].result, 'match');
  assert.equal(json(c, 'aiAutomaticNamePriceMappingsAudit()')[0].confirmationSource, 'model_consensus');
});

test('model consensus never asks to approve the same paper again; a real catalog price gap stays visible after reload', async () => {
  const { c, data } = setup({ consensus: true, gap: true });
  assert.equal(report(c).rows[0].productId, 'milk');
  assert.equal(report(c).rows[0].result, 'difference');
  assert.doesNotMatch(html(c), /price-confirm-identity/);
  assert.doesNotMatch(html(c), /price-confirm-paper/);
  assert.match(html(c), /פערי מחיר שאומתו ונשמרו/);
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.equal(report(c).rows[0].expectedOptions[0].lineDifference, 10);
  assert.equal(report(c).rows[0].paperReview.source, 'model_consensus');
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(report(reloaded).rows[0].paperConfirmed, true);
  await c.click('price-reopen-paper', '', { doc: '0', row: '0' });
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 1);
  await confirm(c);
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
});

test('unconfirmed numbers cannot be approved by a price acknowledgement or used for reconciliation', async () => {
  const { c } = setup({ consensus: true, gap: true, issues: ['unitPriceExVat'] });
  assert.equal(report(c).rows[0].capability, 'partial');
  assert.doesNotMatch(html(c), /price-confirm-paper/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false);
  await confirm(c);
  assert.equal(report(c).rows[0].paperConfirmed, false);
  await c.click('paper-row-edit', '', { doc: '0', row: '0' });
  c.node('paperRowQty').value = '10'; c.node('paperRowUnit').value = '6'; c.node('paperRowTotal').value = '60';
  await c.events.get('paperRowSave:click')();
  assert.equal(report(c).rows[0].capability, 'checkable');
  assert.equal(report(c).rows[0].result, 'difference');
});

test('changed or unsupported saved consensus cannot authorize an identity', () => {
  for (const change of ["aiScanResponse.scan.documents[0].rows[0].modelVerification.identitySupport=[2]",
    "products[0].barcode='7290000000022'", "aiScanResponse.scan.documents[0].rows[0].description='other row'"]) {
    const { c } = setup({ consensus: true }); c.run(change);
    assert.equal(report(c).rows[0].capability, 'unidentified');
  }
});

test('a disputed summary appears once without reopening every verified product and can be checked from paper', async () => {
  const { c, data } = setup({ consensus: true });
  c.run("aiScanResponse.scan.documents[0].modelVerification={version:1,issues:['rowCount']};saveReceiptDraft()");
  assert.equal(report(c).complete, false);
  assert.equal(report(c).rows[0].result, 'match');
  assert.equal((html(c).match(/data-role="price-confirm-document"/g) || []).length, 1);
  assert.doesNotMatch(html(c), /data-price-row=/);
  const token = c.run('priceAuditDocumentReviewToken(aiScanResponse.scan.documents[0])');
  await c.click('price-confirm-document', '', { doc: '0', reviewToken: token });
  assert.equal(report(c).complete, true);
  assert.equal(runtime('yotvata', { data, storage: c.storage }).run('receiptPriceAudit().complete'), true);
  c.run("aiScanResponse.scan.documents[0].__pricePaper.rows[0].quantity=11");
  assert.equal(c.run('priceAuditDocumentReviewNeeded(aiScanResponse.scan.documents[0])'), true);
});

test('acknowledged price discrepancy reaches the final saved audit without changing the payable amount', async () => {
  const { c } = setup({ gap: true });
  await confirm(c);
  c.run('aiScanFromDraft=true;showConfirm=(title,text,label,fn)=>fn();finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  assert.equal(c.run('pendingReceipt.ex'), 54);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.ok(saved);
  assert.equal(saved.totalExVat, 54);
  assert.equal(saved.priceAudit.rows[0].result, 'difference');
  assert.equal(saved.priceAudit.rows[0].paperConfirmed, true);
});
