import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const html = c => c.run('receiptPriceAuditHtml()');
function setup({ gap = false, consensus = false, issues = [], carton = false, barcode = null, missingDiscount = false } = {}) {
  const data = fixture('yotvata'), d = data.paper.scan.documents[0], r = d.rows[0];
  if (barcode) { data.products[0].barcode = r.barcode = r.barcodeObserved = data.items[0].barcode = barcode; }
  if (missingDiscount) r.lineDiscountExVat = null;
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

test('EAN-8 consensus needs no user approval and survives draft restoration', () => {
  const {c,data}=setup({consensus:true,barcode:'72940754'});
  assert.equal(report(c).rows[0].result,'match');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'),0);
  assert.equal(c.run("aiEvaluateInvoiceScan(aiScanResponse).aggregates.get('milk').qty"),10);
  assert.equal(report(runtime('yotvata',{data,storage:c.storage})).rows[0].result,'match');
});

test('saved v146 identity disputes show a working product approval for EAN-8 and EAN-13, with no price question', async () => {
  for (const barcode of ['72940754','7290000000008']) {
    const {c,data}=setup({consensus:true,issues:['identity'],barcode});
    c.run("aiScanResponse.scan.documents[0].rows[0].barcodeMatchMethod='exact_full'");
    const before=c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).row))');
    assert.equal(report(c).rows[0].capability,'unidentified');
    assert.match(html(c),/data-role="price-confirm-identity"/);
    assert.doesNotMatch(html(c),/data-role="paper-row-edit"/);
    const candidate=report(c).rows[0].identityConfirmation;c.context.candidate=candidate;
    const token=c.run('priceAuditIdentityReviewToken(aiSourceRow(0,0),candidate)');
    await c.click('price-confirm-identity','',{doc:'0',row:'0',candidateId:candidate.productId,candidateBarcode:barcode,reviewToken:token});
    assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'),0);
    assert.equal(c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).row))'),before);
    assert.equal(report(runtime('yotvata',{data,storage:c.storage})).rows[0].result,'match');
    assert.equal(c.requests.length,0);
  }
});

test('a candidate from another scan remains selectable even when missing from the chosen name hints', async () => {
  const {c}=setup({consensus:true,issues:['identity']});
  c.run("Object.assign(aiScanResponse.scan.documents[0].rows[0],{barcode:null,barcodeMatchMethod:'suggested_name_multiple',catalogHintId:null,catalogCandidateHintIds:['coffee'],barcodeSuggestedCandidates:[]});aiScanResponse.scan.documents[0].rows[0].modelVerification.candidates=[{productId:'coffee',barcode:'7290000000015'}]");
  const choices=report(c).rows[0].choice.candidates;
  assert.deepEqual(choices.map(x=>x.productId),['coffee','milk']);
  await c.click('ai-confirm-name-candidate','',{doc:'0',row:'0',candidateId:'coffee'});
  assert.equal(report(c).rows[0].productId,'coffee');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'),0);
});

test('unresolved paper values can be confirmed as-is without rewriting null discounts or losing a genuine price gap', async () => {
  const {c,data}=setup({consensus:true,gap:true,issues:['lineDiscountExVat'],missingDiscount:true});
  const before=c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))');
  assert.match(html(c),/data-role="price-confirm-values"/);
  const token=c.run('priceAuditValuesReviewToken(aiSourceRow(0,0))');
  await c.click('price-confirm-values','',{doc:'0',row:'0',reviewToken:token});
  assert.equal(c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))'),before);
  assert.equal(c.run('aiScanEvaluation.valid'),true);
  assert.equal(report(c).rows[0].result,'difference');
  assert.equal(report(c).rows[0].expectedOptions[0].lineDifference,10);
  assert.ok(report(c).rows[0].paperValuesReview);
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'),0);
  c.run("const proof=aiSourceRow(0,0).mapped.modelVerification;proof.evidence=Object.fromEntries(Object.entries(proof.evidence).reverse());saveReceiptDraft()");
  const restored=runtime('yotvata',{data,storage:c.storage});
  assert.equal(restored.run('priceAuditPendingRows(receiptPriceAudit()).length'),0);
  assert.equal(c.requests.length,0);
});

test('a stale paper-values click cannot clear changed data, and edited values invalidate a saved approval', async () => {
  const {c}=setup({consensus:true,issues:['unitPriceExVat']});
  const token=c.run('priceAuditValuesReviewToken(aiSourceRow(0,0))');
  c.run("aiScanResponse.scan.documents[0].rows[0].description='changed'");
  await c.click('price-confirm-values','',{doc:'0',row:'0',reviewToken:token});
  assert.equal(c.run('aiSourceRow(0,0).mapped.paperValuesReview'),undefined);
  const {c:valid}=setup({consensus:true,issues:['unitPriceExVat']});
  await valid.click('price-confirm-values','',{doc:'0',row:'0',reviewToken:valid.run('priceAuditValuesReviewToken(aiSourceRow(0,0))')});
  valid.run('aiSourceRow(0,0).mapped.unitPriceExVat=5.01');
  assert.ok(valid.run("aiModelReviewIssues(aiSourceRow(0,0).mapped).includes('unitPriceExVat')"));
});

test('manual paper barcode entry accepts valid eight-digit codes and keeps them approved after reload', async () => {
  const {c,data}=setup({consensus:true,issues:['identity'],barcode:'72940754'});
  c.run("showInputModal=async()=> '72940754';showConfirm=(a,b,label,fn)=>fn()");
  await c.click('ai-manual-paper-barcode','',{doc:'0',row:'0'});
  // The delegated click starts an async handler; flush its input promise.
  await Promise.resolve();
  assert.equal(c.run('aiSourceRow(0,0).mapped.barcodeMatchMethod'),'user_confirmed');
  assert.equal(report(runtime('yotvata',{data,storage:c.storage})).rows[0].result,'match');
});

test('missing or contradictory numbers do not expose an approve-as-is action', () => {
  for (const change of ['unitPriceExVat=null','grossLineTotalExVat=99']) {
    const {c}=setup({consensus:true,issues:['unitPriceExVat']});
    c.run('aiSourceRow(0,0).mapped.'+change+';aiSourceRow(0,0).doc.__pricePaper.rows[0].'+change);
    assert.doesNotMatch(html(c),/data-role="price-confirm-values"/);
    assert.equal(c.run('priceAuditCanConfirmValues(aiSourceRow(0,0))'),false);
  }
});
