import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const view = c => c.run('receiptPriceAuditHtml()');
const decode = value => value.replace(/&(quot|amp|lt|gt|#39);/g, (_, key) => ({ quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'" })[key]);
function approval(html) {
  const button = html.match(/<button data-role="price-confirm-identity"[^>]*>/);
  assert.ok(button, 'The pending identity has a visible approval button');
  return Object.fromEntries([...button[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) =>
    [key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()), decode(value)]));
}
function setup({ mixed = true, conflict = false, missingPage = false } = {}) {
  const data = fixture('yotvata'), doc = data.paper.scan.documents[0], base = doc.rows[0];
  const weak = { ...structuredClone(base), description: 'קפה בדיקה', quantity: 6, unitPriceExVat: 5, lineTotalExVat: 30, grossLineTotalExVat: 30,
    lineNumber: 2, confidence: .60, barcode: null, barcodeObserved: null, barcodeReadType: 'unreadable',
    barcodeMatchMethod: 'suggested_name_only', catalogHintId: 'coffee', catalogCandidateHintIds: [],
    barcodeSuggestedProductId: 'coffee', barcodeSuggested: '7290000000015' };
  if (conflict) {
    data.products[1].price = 7;
    Object.assign(weak, { description: 'שורה לא ברורה', confidence: .99, barcodeMatchMethod: 'conflicting_reads',
      barcodeObserved: '7290000000008', barcodeInitialObserved: '7290000000008', barcodeRetryObserved: '7290000000015',
      barcodeReadType: 'full', barcodeInitialReadType: 'full', barcodeRetryReadType: 'full',
      barcodeRetryAttempted: true, barcodeRetryConflict: true, barcodeRetryApplied: false, barcodeRetryConfidence: .99,
      catalogHintId: null, barcodeSuggested: null, barcodeSuggestedProductId: null });
  }
  doc.rows = mixed ? [base, weak,
    { ...structuredClone(base), lineNumber: 3, quantity: 3, unitPriceExVat: 6, lineTotalExVat: 18, grossLineTotalExVat: 18 },
    { ...structuredClone(weak), lineNumber: 4, description: 'שם עמום', barcodeMatchMethod: 'suggested_name_multiple',
      catalogHintId: null, catalogCandidateHintIds: ['milk', 'coffee'], barcodeSuggested: null, barcodeSuggestedProductId: null,
      barcodeSuggestedCandidates: [{ productId: 'milk', barcode: '7290000000008' }, { productId: 'coffee', barcode: '7290000000015' }] }
  ] : [weak];
  const amount = doc.rows.reduce((n, r) => n + r.lineTotalExVat, 0), units = doc.rows.reduce((n, r) => n + r.quantity, 0);
  Object.assign(doc, { invoiceNumber: 'TEST-344', subtotalExVat: amount, itemsSectionTotalExVat: amount,
    printedUnits: units, itemsPrintedLines: doc.rows.length, printedLines: doc.rows.length });
  if (missingPage) doc.pageCount = 2;
  doc.__pricePaper = structuredClone(doc);
  const saved = { ...data.paper, docInputs: [{ amount, units, pageCount: 1 }] };
  const c = runtime('yotvata', { data }); c.context.actionSaved = saved;
  c.run("receiptOpened=true;restoreDraftScan(actionSaved);receiptPaperScanState='ok';receiptDocDate='2026-09-15';scanPurpose='receiving';renderReceiving()");
  return { c, data };
}

test('one work queue contains only unfinished rows, with no repeated choices or matching prices', () => {
  const { c } = setup(), a = report(c), html = view(c);
  assert.equal(a.rows.length, 4); assert.equal(a.rows.filter(r => r.result === 'match').length, 1);
  assert.match(html, /נשארו 3 שורות לטיפול/);
  assert.equal((html.match(/data-price-row=/g) || []).length, 3);
  assert.equal((html.match(/data-role="price-confirm-identity"/g) || []).length, 1);
  assert.equal((html.match(/data-role="ai-confirm-name-candidate"/g) || []).length, 2);
  assert.doesNotMatch(html, /data-price-result="match"|data-price-details|פתח פירוט מחירים ומצבים|המחיר תואם/);
  assert.equal(html.includes('data-price-row="' + a.rows[0].id + '"'), false);
  assert.equal(c.requests.length, 0);
});

test('human approval removes a matching row, preserves original paper and persists on reload', async () => {
  const { c, data } = setup(), source = c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)');
  assert.equal(c.run('!!aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[1]).product'), false);
  await c.click('price-confirm-identity', '', approval(view(c)));
  const row = report(c).rows[1];
  assert.equal(row.productId, 'coffee'); assert.equal(row.result, 'match');
  assert.equal(row.originalUnitPrice, 5); assert.equal(row.quantity, 6);
  assert.equal(source, c.run('JSON.stringify(aiScanResponse.scan.documents[0].__pricePaper)'));
  assert.match(view(c), /נשארו 2 שורות לטיפול/);
  assert.equal(view(c).includes('data-price-row="' + row.id + '"'), false);
  assert.equal(c.run('receiptList.length'), 0);
  const b = runtime('yotvata', { data, storage: c.storage });
  assert.equal(report(b).rows[1].result, 'match'); assert.match(view(b), /נשארו 2 שורות לטיפול/);
  const audit = json(b, 'aiConfirmedMappingsAudit()');
  assert.equal(audit[0].confirmationSource, 'paper_identity_review');
  assert.equal(audit[0].selectedProductId, 'coffee'); assert.equal(audit[0].enteredBarcode, null);
  assert.equal(c.requests.length + b.requests.length, 0);
});

test('confirming identity cannot approve away an actual price gap or copy a catalog price onto the paper', async () => {
  const { c } = setup({ mixed: false }); c.run("products.find(p=>p.id==='coffee').price=7");
  await c.click('price-confirm-identity', '', approval(view(c)));
  const r = report(c).rows[0];
  assert.equal(r.result, 'difference'); assert.equal(r.originalUnitPrice, 5); assert.equal(r.comparisonPrice, 5);
  assert.equal(r.expectedOptions[0].price, 7); assert.equal(r.quantity, 6);
  assert.match(view(c), /המחיר בתעודה שונה מהמחיר שבמאגר/);
  assert.equal((view(c).match(/data-price-row=/g) || []).length, 1);
  assert.doesNotMatch(view(c), /data-role="price-confirm-identity"/);
  c.run("products.find(p=>p.id==='coffee').price=5;renderReceiving()");
  assert.equal(report(c).rows[0].result, 'match'); assert.doesNotMatch(view(c), /data-price-row=/);
  c.run("products.find(p=>p.id==='coffee').price=8;renderReceiving()");
  assert.equal(report(c).rows[0].result, 'difference'); assert.match(view(c), /data-price-row=/);
});

test('an automatic choice based on price remains pending until the person identifies it from the paper', async () => {
  const { c } = setup({ mixed: false, conflict: true });
  assert.equal(c.run('aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[0]).priceAssisted'), true);
  assert.equal(report(c).rows[0].capability, 'unidentified');
  const button = approval(view(c)); assert.equal(button.candidateId, 'milk');
  await c.click('price-confirm-identity', '', button);
  assert.equal(report(c).rows[0].result, 'match');
  assert.equal(c.run('aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[0]).priceAssisted===true'), false);
});

test('a stale row, changed product or forged target cannot be approved from an old card', async () => {
  for (const change of ["aiScanResponse.scan.documents[0].rows[0].quantity=9", "aiScanResponse.scan.documents[0].__priceSourceId='changed-document'",
    "products.find(p=>p.id==='coffee').name='מוצר ששמו השתנה'", "products.find(p=>p.id==='coffee').barcode='7290000000022'", '']) {
    const { c } = setup({ mixed: false }), button = approval(view(c));
    if (change) c.run(change); else button.candidateId = 'milk';
    const before = c.run('JSON.stringify(aiScanResponse)');
    await c.click('price-confirm-identity', '', button);
    assert.equal(before, c.run('JSON.stringify(aiScanResponse)'));
    assert.match(c.toasts.at(-1), /השתנו/);
  }
});

test('saved identity approval expires if its source evidence or barcode binding changes', async () => {
  for (const change of ["aiScanResponse.scan.documents[0].rows[0].description='שורה אחרת'",
    "aiScanResponse.scan.documents[0].rows[0].barcode='7290000000008'",
    "products.find(p=>p.id==='coffee').barcode='7290000000022'",
    "delete aiScanResponse.scan.documents[0].rows[0].barcodePaperIdentityReview"]) {
    const { c } = setup({ mixed: false }); await c.click('price-confirm-identity', '', approval(view(c)));
    assert.equal(report(c).rows[0].result, 'match'); c.run(change);
    assert.equal(report(c).rows[0].capability, 'unidentified'); assert.match(view(c), /data-price-row=/);
  }
});

test('the last resolved row leaves no approval list or scanner prompt', async () => {
  const { c } = setup({ mixed: false });
  c.run('refreshPriceScannerNotice()'); assert.equal(c.node('scanPriceNotice').classList.contains('hidden'), false);
  await c.click('price-confirm-identity', '', approval(view(c)));
  assert.match(view(c), /אין מה לאשר/); assert.doesNotMatch(view(c), /data-price-row=|data-role="price-confirm-identity"/);
  assert.equal(c.node('scanPriceNotice').classList.contains('hidden'), true);
});

test('identity approval leaves missing-page work visible and never reports a clean pass', async () => {
  const { c } = setup({ mixed: false, missingPage: true });
  await c.click('price-confirm-identity', '', approval(view(c)));
  assert.equal(report(c).complete, false); assert.equal(report(c).rows[0].capability, 'partial');
  assert.match(view(c), /data-role="rc-photo-capture"/); assert.doesNotMatch(view(c), /אין מה לאשר/);
});

test('the checkout summary returns to the active review and discards its stale payment snapshot', async () => {
  const { c } = setup(); c.run("pendingReceipt={ex:999};$('receiptSummaryModal').classList.remove('hidden');refreshPriceAuditViews()");
  const html = c.node('rsPriceAudit').innerHTML;
  assert.match(html, /data-role="price-open-review"/);
  assert.doesNotMatch(html, /data-role="price-confirm-identity"|data-price-row=/);
  const button = { dataset: { role: 'price-open-review' }, closest() { return this; } };
  await c.events.get('rsBody:click')({ target: button });
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(c.node('receiptSummaryModal').classList.contains('hidden'), true);
  assert.match(c.node('app').innerHTML, /data-role="price-confirm-identity"/);
  assert.equal(c.requests.length, 0);
});
