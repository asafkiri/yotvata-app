// v394: a driver's credit note photographed with the REGULAR document buttons ("צלם את התעודה",
// "+ תעודה נוספת מהנהג / הספק", "בחר תמונות מהגלריה") is recognised after its paid invoice read and
// moved into the driver-credit flow. These tests run the complete app module (receipt-scan-harness);
// only fetch, timers, image preparation and the Firebase boundary are faked. No network, no paid call.
// The scan service is a fetch-level fake that answers exactly as the v151 contract says
// (tools/CREDIT-AS-DOCUMENT-V394.md): an invoice body with detectDocumentType gets documentType,
// printedTitle and modelVerification.documentType; a v150 service ignores the key and answers untyped.
// tools/credit-service-contract.test.mjs runs the same slip through the REAL service code.
// Synthetic papers only: a delivery note (48 yogurt + 10 milk = ₪217.04 / 58 units) and a slip
// "ביטול מכירה חלקי ת.משלוח" (24 yogurt @3.48 = −83.52 / −15.03 / −98.55, number 22230011).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, reply } from './receipt-scan-harness.mjs';

const YOGURT = { id: 'yogurt', name: 'יוגורט בדיקה', barcode: '7290000000022', price: 3.48 };
const MILK = { id: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', price: 5 };
const SLIP_TITLE = 'ביטול מכירה חלקי ת.משלוח';
const SLIP_NUMBER = '22230011';

const tick = () => new Promise(resolve => setImmediate(resolve));
// Runs the harness' parked timers, except the fetch-timeout abort timers (an aborted upload can
// then only come from the app dropping the read — as in credit-on-gate.test.mjs).
async function flush(c, rounds = 40) {
  for (let i = 0; i < rounds; i++) { for (const cb of c.callbacks.splice(0)) { if (!/controller\.abort/.test(String(cb))) cb(); } await tick(); }
}
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const app = c => c.node('app').innerHTML;
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cents = n => Math.round(n * 100) / 100;

// ---- the papers, as an invoice-mode (or credit-mode) model read returns them ----
const line = (product, quantity, total, sourcePage = 1) => ({ sourcePage, lineNumber: null, supplierItemCode: null, rowRegion: null,
  barcode: product.barcode, barcodeObserved: product.barcode, barcodeReadType: 'full', catalogHintId: null, catalogCandidateHintIds: [],
  description: product.name, quantity, unitPriceExVat: product.price, grossLineTotalExVat: total, lineDiscountExVat: null,
  lineTotalExVat: total, promotionText: null, confidence: 0.93 });
function delivery({ number = '9073800001', type = 'delivery', title = 'תעודת משלוח' } = {}) {
  return { noteIndex: 0, invoiceNumber: number, pageCount: 1, subtotalExVat: 217.04, vatAmount: 39.07, totalInclVat: 256.11,
    printedUnits: 58, printedLines: 2, documentDiscountExVat: null, confidence: 0.92, warnings: [],
    rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50)], documentType: type, printedTitle: title };
}
// The slip. Variant A: quantity as printed (24), money negative. B: everything negative (-24).
// C: the minus signs dropped. Credit mode (the green button, "העבר וקרא כזיכוי"): -24 and negative money.
function slip({ qty = 24, sign = -1, printedUnits = null, type = 'credit', title = SLIP_TITLE, number = SLIP_NUMBER, pageCount = 1, sourcePage = 1 } = {}) {
  return { noteIndex: 0, invoiceNumber: number, pageCount, subtotalExVat: cents(sign * 83.52), vatAmount: cents(sign * 15.03), totalInclVat: cents(sign * 98.55),
    printedUnits, printedLines: 1, documentDiscountExVat: null, confidence: 0.9, warnings: [],
    rows: [line(YOGURT, qty, cents(sign * 83.52), sourcePage)], documentType: type, printedTitle: title };
}
const VARIANT = {
  A: () => slip(),
  B: () => slip({ qty: -24, printedUnits: -24 }),
  C: () => slip({ sign: 1, printedUnits: 24 }),
  CREDIT: () => slip({ qty: -24 })
};

// ---- the scan service, answering as the v151 contract says (or as v150 when version < 151) ----
const DOC_FIELDS = ['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat'];
const READING_FIELDS = ['pageCount', 'subtotalExVat', 'vatAmount', 'totalInclVat', 'printedUnits', 'printedLines', 'documentDiscountExVat'];
const ROW_FIELDS = ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
const evidence = row => Object.fromEntries(['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
  ...ROW_FIELDS].map(k => [k, row[k] ?? null]));
const numberKey = v => String(v == null ? '' : v).replace(/\s/g, '');
const typeOf = d => ['delivery', 'credit', 'unclear'].includes(d && d.documentType) ? d.documentType : 'unclear';
const titleOf = d => typeof (d && d.printedTitle) === 'string' && d.printedTitle.trim() ? d.printedTitle.trim().slice(0, 120) : null;
// keep identical with creditPaperSigns of the service
function signsOf(doc) {
  let negative = 0, positive = 0;
  const count = v => { if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return; if (v < 0) negative++; else positive++; };
  count(doc.subtotalExVat); doc.rows.forEach(r => count(r.lineTotalExVat));
  return negative === 0 ? 'as_printed' : positive === 0 ? 'negative' : 'mixed';
}
// reads = the model's answers (read 0 and 1 are the cheap reads, read 2 the verifier); `selected` is the
// read the service's selection picked. Each answer is turned into the service's response for it.
function serviceAnswer(reads, { version, typed, credit, selected = 0, requestId }) {
  const strip = d => { const { documentType, printedTitle, ...rest } = structuredClone(d); return rest; };
  const docs = reads.map(strip);
  const sel = structuredClone(docs[selected]);
  const peers = docs.map((d, i) => ({ d, i })).filter(p => p.i !== selected);
  const support = Object.fromEntries(DOC_FIELDS.map(f => [f, peers.filter(p => p.d[f] === sel[f]).map(p => p.i)]));
  support.rowCount = peers.filter(p => p.d.rows.length === sel.rows.length).map(p => p.i);
  if (credit) support.invoiceNumber = peers.filter(p => numberKey(p.d.invoiceNumber) === numberKey(sel.invoiceNumber)).map(p => p.i);
  const issues = Object.keys(support).filter(k => !support[k].length);
  sel.rows = sel.rows.map((row, ri) => {
    const product = [YOGURT, MILK].find(p => p.barcode === row.barcode);
    const fieldSupport = Object.fromEntries(ROW_FIELDS.map(f => [f, peers.filter(p => p.d.rows[ri] && p.d.rows[ri][f] === row[f]).map(p => p.i)]));
    const rowIssues = ROW_FIELDS.filter(f => !fieldSupport[f].length);
    const identity = product ? { productId: product.id, barcode: product.barcode } : null;
    return { ...row, barcodeMatchMethod: 'model_consensus', barcodeResolvedProductId: product ? product.id : null,
      modelVerification: { version: 1, status: rowIssues.length ? 'needs_review' : 'agreed', selectedRead: selected, strongSelected: selected === 2, issues: rowIssues,
        identity, identitySupport: peers.map(p => p.i), candidates: identity ? [identity] : [], fieldSupport, evidence: evidence(row),
        readings: [selected, ...peers.map(p => p.i)].map(i => ({ read: i, identity, values: Object.fromEntries(ROW_FIELDS.map(f => [f, docs[i].rows[ri] ? docs[i].rows[ri][f] : null])) })) } };
  });
  sel.modelVerification = { version: 1, issues, values: Object.fromEntries(DOC_FIELDS.map(f => [f, sel[f] ?? null])),
    readings: [selected, ...peers.map(p => p.i)].map(i => ({ read: i, values: Object.fromEntries(READING_FIELDS.map(f => [f, docs[i][f] ?? null])), discountSeparate: false })), support };
  if (typed) {
    const others = peers.map(p => p.i);
    sel.documentType = typeOf(reads[selected]); sel.printedTitle = titleOf(reads[selected]);
    sel.modelVerification.documentType = { version: 1, value: sel.documentType, printedTitle: sel.printedTitle,
      support: others.filter(i => typeOf(reads[i]) === sel.documentType),
      invoiceNumberSupport: others.filter(i => numberKey(reads[i].invoiceNumber) === numberKey(sel.invoiceNumber)),
      readings: [selected, ...others].map(i => ({ read: i, documentType: typeOf(reads[i]), printedTitle: titleOf(reads[i]), creditSigns: signsOf(docs[i]), subtotalExVat: docs[i].subtotalExVat ?? null })) };
  }
  const status = issues.length || sel.rows.some(r => r.modelVerification.issues.length) ? 'needs_review' : reads.length > 2 ? 'verified' : 'agreed';
  return { ok: true, serviceVersion: version, model: 'fixture-model', requestId, ...(typed ? { documentTypeDetection: true } : {}), ...(credit ? { documentKind: 'credit' } : {}),
    scan: { documents: [sel], warnings: [], verification: { version: 1, status, primaryReads: 2, escalationAttempted: reads.length > 2, selectedRead: selected, readCount: reads.length } },
    scanAudit: { version: 1, id: 'audit-' + requestId, result: status === 'needs_review' ? 'needs_review' : 'paper_verified', ...(credit ? { documentKind: 'credit' } : {}),
      ...(typed ? { detectDocumentType: true, documentTypes: [{ noteIndex: 0, value: sel.documentType, support: sel.modelVerification.documentType.support,
        titles: sel.modelVerification.documentType.readings.map(r => r.printedTitle), signs: sel.modelVerification.documentType.readings.map(r => r.creditSigns) }] } : {}) } };
}
// papers: { 'name.jpg': ({ credit, typed, upgraded }) => reads | { reads, selected } }. A request is named by the
// file names of its pages ('a.jpg+b.jpg'); a page re-encoded at the credit budget carries '@credit'.
function service(c, { version = 151, papers, hold = null }) {
  const log = [], stats = { modelCalls: 0 };
  c.context.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/health')) { log.push({ kind: 'health' }); return reply({ ok: true, keyConfigured: true, photoFirst: true, serviceVersion: version, scanResume: true, creditDocuments: true, ...(version >= 151 ? { documentTypeDetection: true } : {}) }); }
    assert.ok(u.endsWith('/scan'), 'unexpected request ' + u);
    const body = JSON.parse(options.body);
    if (body.mode === 'analyze') return reply({ ok: true, analysis: { claims: [], summary: 'fixture' } });
    assert.ok(!body.resume, 'no resume is expected here');
    const credit = body.documentKind === 'credit';
    const names = body.documents[0].pages.map(p => atob(p.split(',')[1]));
    const name = names.map(n => n.replace(/@credit$/, '')).join('+');
    const entry = { kind: credit ? 'credit' : 'invoice', name, names, body, signal: options.signal || null };
    log.push(entry);
    const plan = papers[name];
    assert.ok(plan, 'no paper prepared for ' + name);
    const typed = version >= 151 && !credit && body.detectDocumentType === true;
    const planned = plan({ credit, typed, upgraded: names.every(n => n.endsWith('@credit')) });
    const { reads, selected = 0 } = Array.isArray(planned) ? { reads: planned } : planned;
    stats.modelCalls += reads.length;
    const answer = serviceAnswer(reads, { version, typed, credit, selected, requestId: 'req-' + log.length });
    if (hold && hold(entry)) return new Promise(resolve => { entry.release = () => resolve(reply(answer)); });
    return reply(answer);
  };
  return { log, stats, scans: () => log.filter(e => e.kind !== 'health'), kinds: () => log.filter(e => e.kind !== 'health').map(e => e.kind + ':' + e.name) };
}
// Both cheap reads read the same paper the same way (no verifier).
const twice = read => () => [read(), read()];

// ---- the app, driven only through its own UI events ----
function setup({ attach = false } = {}) {
  const data = { products: [structuredClone(YOGURT), structuredClone(MILK)], promos: [], items: [], paper: null };
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true; confirmLog = [];
    showConfirm = (t, x, l, fn) => { confirmLog.push([t, x, l]); fn(); };
    aiCompressInvoiceImage = async (file, forceFullFrame, maxPixels) => { const url = 'data:image/jpeg;base64,' + btoa(file.name);
      const page = { name: file.name, dataUrl: url, baseDataUrl: url, rotation: 0, orientationConfirmed: false, sourceBlob: { name: file.name },
        sourceRegion: { x: 0, y: 0, width: 1000, height: 5000 }, processScale: 0.37 };
      if (maxPixels) page.maxPixels = maxPixels; return page; };
    aiReprocessFromSource = async (page, rect) => ({ encoded: { dataUrl: 'data:image/jpeg;base64,' + btoa(page.name + '@credit'), bytes: 1 },
      region: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, scale: 0.715, maxPixels: page.maxPixels });
    aiRenderInvoiceRotation = async (url) => ({ dataUrl: url, bytes: 1 });`);
  if (attach) c.run(`receiptAttachTarget = { id: 'old', timestamp: 1, date: '2026-10-12', label: 'x' }; receiptOpened = false; receiptEntryMode = 'photo'`);
  const opened = [];
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => opened.push(id); return n; };
  return { c, data, opened };
}
// "צלם את התעודה" (or "בחר תמונות מהגלריה") on document card `doc`, the photo(s), and "אשר" for each.
async function photograph(c, doc, names, { gallery = false } = {}) {
  await c.click(gallery ? 'ai-add-photo-gallery' : 'ai-add-photo', undefined, { doc: String(doc) });
  c.events.get('app:change')({ target: { id: '', dataset: { role: 'ai-file', doc: String(doc) }, getAttribute: n => n === 'data-role' ? 'ai-file' : null,
    files: names.map(name => ({ name })), value: 'x' } });
  for (let i = 0; i < names.length + 2; i++) {
    await flush(c, 6);
    if (c.run('!!aiOrientationSession')) await c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
  }
  await flush(c, 6);
  assert.equal(c.run(`aiScanDocuments[${doc}].pages.every(p => p.orientationConfirmed)`), true, 'the photos are confirmed');
}
// The gate: one paper per document card ("+ תעודה נוספת מהנהג / הספק" between them), then "התחל קליטת מוצרים".
async function gate(c, papers, { start = 'rc-photo-start' } = {}) {
  c.run('renderReceiving()');
  for (let i = 0; i < papers.length; i++) {
    if (i) await c.click('rc-photo-add-doc');
    await photograph(c, i, [].concat(papers[i]));
  }
  if (!start) return;
  await c.click(start);
  await flush(c);
  assert.equal(c.run('aiScanBusy'), false);
}
// 24 yogurt + 10 milk counted (the driver brought 24 of the 48; the slip credits the other 24).
function count(c, yogurt = 24, milk = 10) {
  c.run(`receiptList = [{ productId: 'yogurt', name: 'יוגורט בדיקה', barcode: '7290000000022', qty: ${yogurt} }, { productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: ${milk} }];
    receiptDupConfirmed = true; priceAuditSetDate(0, '2026-10-13'); saveReceiptDraft(); renderReceiving()`);
}
function finish(c) {
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  return json(c, 'pendingReceipt');
}
const pressCart = c => { c.run("mainMode = 'receiving'; currentView = 'receiving'"); c.toasts.length = 0; c.events.get('cartBtn:click')({ type: 'click' }); };
const credit0 = c => json(c, 'receiptDeliveryCredits[0]');
const cardOf = (c, index = 0) => c.run(`yotvataCreditDocumentCardHtml(${index})`);
const scanIdOf = (c, index) => c.run(`aiScanDocuments[${index}].scanId`);
// Invariants after every scenario (tests.txt r).
function invariants(c) {
  assert.equal(c.run('aiScanBusy'), false, 'nothing is left busy');
  assert.equal(c.run(`(() => { const ids = new Set(aiScanDocuments.map(d => d.scanId).filter(Boolean));
    return receiptDeliveryCredits.some(x => x.origin && !x.origin.recapture && x.origin.kind === 'document' && ids.has(x.origin.scanId)); })()`), false, 'no paper is both a document and a credit');
  assert.equal(c.run('receiptNotes.some(n => normNote(n).amount < 0)'), false, 'no negative note amount');
  assert.equal(c.run(`(() => { const docs = aiScanResponse && aiScanResponse.scan ? aiScanResponse.scan.documents : [];
    return yotvataHeldDocuments().some(x => docs.includes(x.input.scanResult.doc)); })()`), false, 'a held document is never in the money view');
}

const ATTACHED_TOAST = 'תעודה 2 היא תעודת זיכוי («' + SLIP_TITLE + '») — הועברה לזיכויים וצורפה למשלוח. בסיום הספירה נבדוק איזה חוסר היא מכסה.';
const REVIEW_TOAST = n => 'תעודה ' + n + ' היא תעודת זיכוי — הועברה לזיכויים. בדוק אותה מול הנייר ואשר בכרטיס הזיכוי.';
const HELD_TOAST = n => 'תעודה ' + n + ' נראית כמו תעודת זיכוי — צריך החלטה שלך לפני הסיום.';
const FINISH_HELD = n => 'לפני הסיום צריך להחליט על תעודה ' + n + ' — היא נראית כמו תעודת זיכוי.';
const DOCUMENT_REASON = 'הזיכוי צולם כתעודה רגילה — בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר';
const reasonLines = html => [...html.matchAll(/<p data-credit-review-reason[^>]*>([^<]*)<\/p>/g)].map(m => m[1]);

test('a: v151 — the slip photographed as "תעודה 2" is moved and attached by itself with its own invoice read: 4 model calls, the delivery note alone is the paper, the credit closes the shortage', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.deepEqual(s.kinds(), ['invoice:delivery.jpg', 'invoice:slip.jpg'], 'one paid request per document, no credit-mode read');
  assert.equal(s.stats.modelCalls, 4, 'two cheap reads per document, nothing more');
  for (const e of s.scans()) {
    assert.equal(e.body.detectDocumentType, true, 'every invoice body asks for the document type');
    assert.equal('documentKind' in e.body, false, 'an invoice read carries no credit marker');
  }
  assert.equal(c.run('aiScanDocuments.length'), 1);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  const credit = credit0(c);
  assert.deepEqual([credit.origin.kind, credit.origin.docNumber, credit.origin.auto, credit.origin.verdict, credit.origin.title], ['document', 2, true, 'move', SLIP_TITLE]);
  assert.equal(credit.paperMode, 'invoice');
  assert.equal(credit.status, 'confirmed');
  assert.equal(credit.autoConfirmed, true);
  assert.equal(credit.number, SLIP_NUMBER);
  assert.equal(credit.paper.subtotalExVat, -83.52, 'the paid invoice read is the credit paper, as read');
  assert.equal(credit.paper.rows[0].quantity, 24);
  assert.deepEqual(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])').map(r => [r.productId, r.qty, r.amount]), [['yogurt', 24, 83.52]]);
  assert.ok(c.toasts.includes(ATTACHED_TOAST), c.toasts.join(' | '));
  assert.equal(c.toasts.filter(t => /הזיכוי צורף למשלוח/.test(t)).length, 0, 'one announcement, not the green button\'s toast as well');
  assert.match(c.node('rcDeliveryCredits').outerHTML, /זיכוי שאושר · ₪83\.52 לפני מע״מ · פרטים/);
  assert.match(c.run('deliveryCreditsHtml()'), /<p data-credit-origin class="mt-1 text-sm text-slate-600">צולם כ"תעודה 2" וזוהה כתעודת זיכוי \(«ביטול מכירה חלקי ת\.משלוח»\)\./);
  assert.match(c.run('deliveryCreditsHtml()'), /data-role="delivery-credit-unmove"[^>]*>זו לא תעודת זיכוי\? החזר לתעודות</);
  count(c);
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  const p = finish(c);
  assert.ok(p, 'the summary opens');
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.noteParts, [{ amount: 217.04, units: 58 }], 'the delivery note alone is the paper');
  assert.equal(p.ex, 133.52, 'payable = what was received');
  assert.equal(p.shortCreditNotes.length, 1);
  const note = p.shortCreditNotes[0];
  assert.deepEqual([note.number, note.amount, note.autoConfirmed, note.paperMode, note.origin.docNumber, note.origin.kind, note.origin.auto],
    [SLIP_NUMBER, 83.52, true, 'invoice', 2, 'document', true]);
  assert.equal(note.source, 'delivery_credit_scan');
  assert.equal(s.stats.modelCalls, 4, 'no further paid call');
  invariants(c);
});

test('a2: the slip as "תעודה 1" — the toast names the number the worker saw, the delivery note becomes "תעודה 1", and a reload restores one document and one credit without a read', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(c, ['slip.jpg', 'delivery.jpg']);
  assert.deepEqual(s.kinds(), ['invoice:slip.jpg', 'invoice:delivery.jpg']);
  assert.ok(c.toasts.includes(ATTACHED_TOAST.replace('תעודה 2', 'תעודה 1')), c.toasts.join(' | '));
  assert.equal(c.run('aiScanDocuments.length'), 1);
  assert.equal(c.run('aiScanDocuments[0].noteIndex'), 0, 'renumbered');
  assert.equal(c.run('aiScanResponse.scan.documents[0].noteIndex'), 0);
  assert.equal(c.run('aiScanResponse.scan.documents[0].subtotalExVat'), 217.04);
  assert.equal(credit0(c).origin.docNumber, 1);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(c.run('receiptScanHistory.find(e => e.movedToCredit) ? receiptScanHistory.find(e => e.movedToCredit).movedToCredit === receiptDeliveryCredits[0].id : false'), true, 'the slip\'s history entry says where it went');
  assert.match(c.run('yotvataScanHistoryHtml({ history: receiptScanHistory })'), /תעודה 1 · זוהתה כתעודת זיכוי והועברה לזיכויים/);
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.equal(r.run('aiScanDocuments.length'), 1);
  assert.equal(r.run('receiptDeliveryCredits.length'), 1);
  assert.equal(r.run('receiptDeliveryCredits[0].status'), 'confirmed');
  assert.equal(r.run('receiptDeliveryCredits[0].origin.docNumber'), 1);
  assert.equal(r.run('receiptPaperScanState'), 'ok');
  assert.equal(r.run('receiptNoteTotal'), 217.04);
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0, 'a reload reads nothing');
  assert.equal(r.run('"originCache" in receiptDeliveryCredits[0] || "originPages" in receiptDeliveryCredits[0]'), false, 'photos never reach the draft');
  invariants(c);
});

test('b: v150 (the key is ignored, no types) — the all-negative slip is still moved, but waits for one tap: "הזיכוי צולם כתעודה רגילה…", then "כן, צרף זיכוי…" and the same save', async () => {
  const { c } = setup();
  const s = service(c, { version: 150, papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(s.stats.modelCalls, 4);
  assert.ok(s.scans().every(e => e.body.detectDocumentType === true), 'v394 always asks; v150 never answers');
  assert.equal(c.run('aiScanDocuments.length'), 1);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  const credit = credit0(c);
  assert.deepEqual([credit.origin.auto, credit.origin.verdict, credit.paperMode, credit.status, credit.autoConfirmed], [true, 'move', 'invoice', 'review', false]);
  assert.deepEqual(credit.origin.types, []);
  assert.equal(credit.origin.title, null);
  assert.deepEqual(json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[0])').map(r => r.code), ['document'], 'one reason; the unsupported number is not said twice');
  assert.deepEqual(reasonLines(c.run('deliveryCreditsHtml()')), [DOCUMENT_REASON]);
  assert.ok(c.toasts.includes(REVIEW_TOAST(2)), c.toasts.join(' | '));
  assert.match(c.run('deliveryCreditsHtml()'), /data-role="delivery-credit-confirm"[^>]*>כן, צרף זיכוי של ₪83\.52 למשלוח</);
  assert.match(c.run('deliveryCreditsHtml()'), /צולם כ"תעודה 2" וזוהה כתעודת זיכוי\./);
  await c.click('delivery-credit-confirm', credit.id);
  assert.equal(credit0(c).status, 'confirmed');
  assert.equal(credit0(c).autoConfirmed, false);
  count(c);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.noteParts, [{ amount: 217.04, units: 58 }]);
  assert.equal(p.ex, 133.52);
  assert.deepEqual([p.shortCreditNotes[0].number, p.shortCreditNotes[0].amount, p.shortCreditNotes[0].autoConfirmed, p.shortCreditNotes[0].paperMode],
    [SLIP_NUMBER, 83.52, false, 'invoice']);
  assert.equal(s.stats.modelCalls, 4);
  invariants(c);
});

test('b2: the same move without the number agreeing between the reads (v151) or with only one credit vote stays for one tap', async () => {
  // Typed, but read 1 saw another number: invoiceNumberSupport is empty.
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ number: '22230017' })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(credit0(c).status, 'review');
  assert.deepEqual(json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[0])').map(r => r.code), ['document']);
  // Typed, but one read said "unclear": a single credit vote is not full evidence.
  const u = setup();
  service(u.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ type: 'unclear', title: null })] } });
  await gate(u.c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(credit0(u.c).origin.verdict, 'move', 'no read said "delivery" — still moved by itself');
  assert.equal(credit0(u.c).status, 'review');
  invariants(c); invariants(u.c);
});

test('c: v151, the minus signs dropped under the credit title — held out of the money (never billed as +24), one tap reads it once as a credit at the credit pixel budget, then it attaches', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.deepEqual(s.kinds(), ['invoice:delivery.jpg', 'invoice:slip.jpg']);
  assert.equal(c.run('aiScanDocuments.length'), 2, 'nothing moved by itself: the read is positive');
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.deepEqual(json(c, 'receiptNotes'), [], 'no anchors while a document is held');
  assert.equal(c.run('receiptNoteTotal'), null);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.ok(json(c, 'receiptPaperScanProblems').includes('תעודה 2 נראית כמו תעודת זיכוי — ההחלטה בכרטיס שמתחת.'));
  assert.deepEqual(json(c, 'aiScanResponse.scan.documents.map(d => d.subtotalExVat)'), [217.04], 'the money view has the delivery note only');
  count(c);
  const ev = c.run('(() => { const e = aiEvaluateInvoiceScan(aiScanResponse, receiptReconcileRows()); return JSON.stringify({ yogurt: e.aggregates.get("yogurt").qty, errors: e.errors }); })()');
  assert.equal(JSON.parse(ev).yogurt, 48, 'the evaluation bills 48 yogurt — never 72');
  assert.ok(JSON.parse(ev).errors.includes('תעודה 2 נראית כמו תעודת זיכוי — היא אינה נכללת בהשוואה עד שתחליט עליה.'), ev);
  assert.ok(c.toasts.includes(HELD_TOAST(2)), c.toasts.join(' | '));
  const card = c.node('rcPaperStatus').innerHTML;
  assert.match(card, new RegExp('<div data-credit-document="' + scanIdOf(c, 1) + '"'));
  assert.match(card, /תעודה 2 נראית כמו תעודת זיכוי/);
  assert.match(card, /הכותרת שנקראה: «ביטול מכירה חלקי ת\.משלוח»/);
  assert.match(card, /אבל הסכומים נקראו בלי סימן מינוס\./);
  assert.match(card, /data-role="rc-credit-doc-move"[^>]*>כן, זו תעודת זיכוי — העבר וקרא כזיכוי</);
  assert.match(card, /הצילום ייקרא שוב כזיכוי — קריאה אחת נוספת\./);
  assert.match(card, /data-role="rc-credit-doc-keep"[^>]*>לא, זו תעודת משלוח רגילה</);
  assert.match(card, /data-role="rc-credit-doc-remove"[^>]*>הסר את תעודה 2 מהקליטה</);
  c.run("scanPurpose = 'receiving'; refreshPriceScannerNotice()");
  assert.equal(c.node('scanPriceNotice').textContent, 'תעודה 2 נראית כמו זיכוי — לחץ להחלטה');
  assert.equal(c.node('scanPriceNotice').dataset.kind, 'credit-document');
  assert.equal(c.node('scanPriceNotice').classList.contains('hidden'), false);
  pressCart(c);
  assert.deepEqual(c.toasts, [FINISH_HELD(2)]);
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(c.run('currentView'), 'receiving');
  // One tap: exactly one credit-mode read of the same photo, re-encoded at the credit budget.
  c.toasts.length = 0;
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  assert.ok(c.toasts.includes('תעודה 2 הועברה לזיכויים ונקראת עכשיו כזיכוי.'), c.toasts.join(' | '));
  await flush(c);
  assert.deepEqual(s.kinds(), ['invoice:delivery.jpg', 'invoice:slip.jpg', 'credit:slip.jpg']);
  const read = s.scans()[2];
  assert.equal(read.body.documentKind, 'credit');
  assert.equal('detectDocumentType' in read.body, false, 'a credit body never asks for the type');
  assert.deepEqual(read.names, ['slip.jpg@credit'], 'the page was re-encoded at the credit pixel budget before the read');
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].maxPixels'), c.run('AI_CREDIT_MAX_PIXELS'));
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].orientationConfirmed'), true);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.autoConfirmed, credit.paperMode, credit.origin.verdict, credit.origin.auto], ['confirmed', true, 'credit', 'ask-read', false]);
  assert.equal(c.run('aiScanDocuments.length'), 1);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  c.run("refreshPriceScannerNotice()");
  assert.notEqual(c.node('scanPriceNotice').dataset.kind, 'credit-document');
  count(c);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.equal(p.ex, 133.52);
  assert.equal(p.shortCreditNotes[0].paperMode, 'credit');
  assert.equal(s.stats.modelCalls, 6, '2 + 2 invoice reads, 2 credit reads');
  invariants(c);
});

test('c2: "לא, זו תעודת משלוח רגילה" adopts the positive read as a second delivery note with no call, and the decision survives a reload', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  c.toasts.length = 0;
  await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
  assert.deepEqual(c.toasts, ['תעודה 2 נקלטת כתעודת משלוח, לפי ההחלטה שלך.']);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoteTotal'), 300.56);
  assert.equal(c.run('receiptNoteUnits'), 82);
  assert.equal(c.run('aiScanDocuments[1].kindDecision.kind'), 'delivery');
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(s.scans().length, 2, 'no call');
  const r = runtime('yotvata', { data, storage: c.storage });
  assert.equal(r.run('aiScanDocuments[1].kindDecision.kind'), 'delivery');
  assert.equal(r.run('aiScanDocuments[1].kindDecision.source'), 'card');
  assert.equal(r.run('receiptPaperScanState'), 'ok');
  assert.equal(r.run('receiptNoteTotal'), 300.56);
  assert.deepEqual(json(r, 'yotvataHeldDocuments()'), []);
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  invariants(c); invariants(r);
});

test('d: v150 with the minus signs dropped is not detected — the residual risk, billed exactly as before v394', async () => {
  const { c } = setup();
  service(c, { version: 150, papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoteTotal'), 300.56, 'the slip is a second delivery note — what v393 did');
  invariants(c);
});

test('e: reads split on the sign (v150, no types): the positive read selected, the negative readings hold it — ask-read, never an automatic move', async () => {
  const { c } = setup();
  const s = service(c, { version: 150, papers: { 'delivery.jpg': twice(delivery),
    'slip.jpg': () => ({ reads: [slip({ printedUnits: 24 }), VARIANT.C(), slip({ printedUnits: 24 })], selected: 1 }) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(s.stats.modelCalls, 5, 'the invoice consensus already paid for the verifier');
  assert.equal(c.run('receiptDeliveryCredits.length'), 0, 'not moved');
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.equal(c.run('yotvataPaperCreditSignals(aiScanDocuments[1].scanResult.doc, 1).readingNegative'), true);
  // Three readings (the verifier included) are counted as three: 2 of 3 read the minus.
  assert.match(cardOf(c, 1), /2 מתוך 3 הקריאות קראו סכום שלילי \(‎-83\.52\), ואחת חיובי \(83\.52\)\./);
  assert.match(cardOf(c, 1), /כן, זו תעודת זיכוי — העבר וקרא כזיכוי/);
  assert.doesNotMatch(cardOf(c, 1), /rc-credit-doc-keep/, 'most readings saw the minus: "לא, זו תעודת משלוח רגילה" is not offered');
  assert.ok(c.toasts.includes(HELD_TOAST(2)));
  assert.deepEqual(json(c, 'receiptNotes'), []);
  invariants(c);
  // The negative read selected, but a positive read beside it: fully negative is not enough — one tap.
  const n = setup();
  service(n.c, { version: 150, papers: { 'delivery.jpg': twice(delivery),
    'slip.jpg': () => ({ reads: [slip({ printedUnits: 24 }), VARIANT.C(), slip({ printedUnits: 24 })], selected: 0 }) } });
  await gate(n.c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(n.c.run('receiptDeliveryCredits.length'), 0, 'reads that split on the sign never move by themselves');
  assert.equal(n.c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-move');
  assert.match(cardOf(n.c, 1), /2 מתוך 3 הקריאות קראו סכום שלילי \(‎-83\.52\), ואחת חיובי \(83\.52\)\./);
  invariants(n.c);
});

test('e2: a fully negative read that one read typed "delivery" waits for a tap (ask-move); the tap moves it with no call', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ type: 'delivery', title: 'ת.משלוח' })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-move');
  assert.match(cardOf(c, 1), /קריאה אחת סימנה אותה כזיכוי והשנייה כתעודת משלוח\./);
  assert.match(cardOf(c, 1), /data-role="rc-credit-doc-move"[^>]*>כן, זו תעודת זיכוי — העבר לזיכויים</);
  assert.doesNotMatch(cardOf(c, 1), /rc-credit-doc-keep/, 'a negative read is never kept as a delivery note');
  c.toasts.length = 0;
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  await flush(c);
  assert.equal(s.scans().length, 2, 'no call');
  const credit = credit0(c);
  assert.deepEqual([credit.origin.verdict, credit.origin.auto, credit.paperMode, credit.status], ['ask-move', false, 'invoice', 'review']);
  assert.deepEqual(c.toasts, [REVIEW_TOAST(2)]);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  invariants(c);
});

test('f: an invoice with one return line (positive total, one negative row) is no credit — no card, no hold, and the problem says what was really read', async () => {
  const { c } = setup();
  const withReturn = () => ({ ...delivery(), subtotalExVat: 207.04, vatAmount: 37.27, totalInclVat: 244.31, printedUnits: 56, printedLines: 3,
    rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), { ...line(MILK, -2, -10), description: 'החזרה חלב בדיקה' }] });
  service(c, { papers: { 'delivery.jpg': twice(withReturn) } });
  await gate(c, ['delivery.jpg']);
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(c.run('yotvataPaperCreditSignals(aiScanDocuments[0].scanResult.doc, 1).signal'), false);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.ok(json(c, 'receiptPaperScanProblems').includes('תעודה 1: בשורה 3 נקרא סכום שלילי (‎-10.00) — אם זו שורת החזרה בתוך התעודה, הקלד את הסכום והיחידות ידנית.'), json(c, 'receiptPaperScanProblems').join(' | '));
  assert.ok(!json(c, 'receiptPaperScanProblems').some(p => /חסרים כמות, סכום נטו/.test(p)));
  assert.doesNotMatch(c.node('rcPaperStatus').innerHTML, /data-credit-document/);
  assert.equal(c.run('aiScanResponse.scan.documents.length'), 1, 'it stays in the money view, as in v393');
  // The paper check itself is the service's, unchanged.
  assert.ok(json(c, 'yotvataPaperCheck(aiScanDocuments[0].scanResult.doc, 1).problems').includes('חסרים כמות, סכום נטו או שיוך לעמוד באחת השורות'));
  invariants(c);
});

test('g: only the slip was photographed — it moves, an empty "תעודה 1" remains, the receipt never saves as read; photographing the delivery note reads only that', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(c, ['slip.jpg']);
  assert.equal(credit0(c).status, 'confirmed');
  assert.equal(c.run('aiScanDocuments.length === 1 && aiScanDocuments[0].pages.length === 0 && !aiScanDocuments[0].scanResult'), true, 'an empty document is seeded');
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), ['צולמה רק תעודת זיכוי. צלם גם את תעודת המשלוח (בדוק צילומים) או הקלד את הסכום והיחידות שלה.']);
  count(c);
  pressCart(c);
  assert.equal(c.run('pendingReceipt'), null, 'a receipt with no delivery note never saves as read');
  assert.deepEqual(c.toasts, ['השלם צילום או הזן ידנית את נתוני התעודה לפני הסיום']);
  await c.click('rc-photo-repair');
  assert.match(app(c), /שלב 1 · צילום תעודה/);
  await photograph(c, 0, ['delivery.jpg']);
  await c.click('rc-photo-start'); await flush(c);
  assert.deepEqual(s.kinds(), ['invoice:slip.jpg', 'invoice:delivery.jpg'], 'only the new document is read; the credit is untouched');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(credit0(c).status, 'confirmed');
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.equal(p.shortCreditNotes.length, 1);
  invariants(c);
});

test('h: delivery note and slip picked together from the gallery into one document — the pages split by sign; one tap moves page 2 to a credit read and re-reads page 1 (2 reads, both named)', async () => {
  const { c } = setup();
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  const s = service(c, { papers: { 'delivery-p.jpg+slip-p.jpg': twice(mixed), 'slip-p.jpg': twice(VARIANT.CREDIT), 'delivery-p.jpg': twice(delivery) } });
  c.run('renderReceiving()');
  await photograph(c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  assert.equal(c.run('aiScanDocuments.length === 1 && aiScanDocuments[0].pages.length === 2'), true, 'one document of two pages');
  await c.click('rc-photo-start'); await flush(c);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0, 'a split is never automatic');
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-split');
  assert.deepEqual(json(c, 'yotvataPaperCreditSignals(aiScanDocuments[0].scanResult.doc, 2).pageSplit'), { creditPages: [2], deliveryPages: [1] });
  const card = cardOf(c, 0);
  assert.match(card, /בתעודה 1 צולמו יחד שני מסמכים: עמוד 2 נראה כמו תעודת זיכוי\./);
  assert.match(card, /data-role="rc-credit-doc-split"[^>]*>העבר את עמוד 2 לזיכויים וקרא מחדש</);
  assert.match(card, /הזיכוי ייקרא כזיכוי, ותעודה 1 תיקרא שוב בלי העמוד הזה — שתי קריאות\./);
  assert.match(c.run('yotvataCreditDocumentCardHtml(0, { gate: true })'), /הזיכוי ייקרא עכשיו; תעודה 1 תיקרא שוב כשתלחץ "התחל קליטת מוצרים"\./);
  c.toasts.length = 0;
  await c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(c, 0) });
  assert.ok(c.toasts.includes('עמוד 2 הועבר לזיכויים. הזיכוי נקרא כזיכוי, ותעודה 1 נקראת שוב.'), c.toasts.join(' | '));
  await flush(c);
  assert.deepEqual(s.kinds(), ['invoice:delivery-p.jpg+slip-p.jpg', 'credit:slip-p.jpg', 'invoice:delivery-p.jpg'], 'exactly one credit read and one invoice re-read');
  const credit = credit0(c);
  assert.deepEqual([credit.origin.kind, credit.origin.pages, credit.origin.docNumber, credit.status, credit.paperMode], ['page', [2], 1, 'confirmed', 'credit']);
  assert.equal(c.run('aiScanDocuments.length === 1 && aiScanDocuments[0].pages.length === 1'), true);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.match(c.run('deliveryCreditsHtml()'), /עמוד 2 של "תעודה 1" הועבר לכאן כזיכוי\./);
  assert.match(c.run('deliveryCreditsHtml()'), /זה לא זיכוי\? החזר את העמוד לתעודות/);
  invariants(c);
});

test('i: after a reload (photos gone) restore reads and moves nothing; a negative read moves paper-only by tap; a dropped-sign read offers "הסר וצלם כזיכוי", which opens the green camera within the tap', async () => {
  // 1. ask-move (a read typed "delivery"), reloaded.
  const { c, data } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ type: 'delivery', title: null })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0, 'restore reads nothing');
  assert.equal(r.run('receiptDeliveryCredits.length'), 0, 'restore moves nothing');
  assert.deepEqual(json(r, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  assert.equal(r.run('yotvataCachedDoc(aiScanDocuments[1])'), true, 'the held read is cached');
  assert.match(app(r), /כן, זו תעודת זיכוי — העבר לזיכויים/);
  await r.click('rc-credit-doc-move', undefined, { scan: r.run('aiScanDocuments[1].scanId') });
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0, 'paper-only, no read');
  const moved = json(r, 'receiptDeliveryCredits[0]');
  assert.deepEqual([moved.pages.length, moved.pageCount, moved.paperMode, moved.status], [0, 1, 'invoice', 'review']);
  assert.equal(r.run('receiptPaperScanState'), 'ok');
  invariants(r);
  // 2. ask-read without photos: the tap removes the document and opens the green camera.
  const d = setup();
  service(d.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(d.c, ['delivery.jpg', 'slip.jpg']);
  const opened = [];
  const t = runtime('yotvata', { data: d.data, storage: d.c.storage });
  t.context.document.getElementById = id => { const n = t.node(id); n.click = () => opened.push(id); return n; };
  t.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.match(app(t), /data-role="rc-credit-doc-recapture"[^>]*>הסר את תעודה 2 וצלם אותה כזיכוי</);
  assert.doesNotMatch(app(t), /העבר וקרא כזיכוי/, 'no read without photos');
  const scanId = t.run('aiScanDocuments[1].scanId');
  await t.click('rc-credit-doc-recapture', undefined, { scan: scanId });
  const fresh = json(t, 'receiptDeliveryCredits[0]');
  assert.deepEqual(opened, ['creditCam_' + fresh.id], 'the green camera opens inside the tap');
  assert.deepEqual([fresh.status, fresh.pages.length, fresh.origin.recapture, fresh.origin.docNumber], ['capture', 0, true, 2]);
  assert.equal(t.run('aiScanDocuments.length'), 1);
  assert.equal(t.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  assert.equal(t.run('receiptPaperScanState'), 'ok', 'the remaining delivery note is read and adopted');
  invariants(t);
});

test('j: 4 credits already, more than 4 pages, attach mode — the credit stays held and is never adopted or billed; removing a credit frees the move', async () => {
  // 4 credits already on the receipt.
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  c.run(`receiptDeliveryCredits = [1, 2, 3, 4].map(i => ({ id: 'green-' + i, pages: [], status: 'capture', pageCount: 0 }))`);
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(c.run('receiptDeliveryCredits.length'), 4, 'not moved');
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'blocked-full');
  assert.equal(c.run('receiptNoteTotal'), null, 'nothing adopted');
  assert.match(cardOf(c, 1), /תעודה 2 היא תעודת זיכוי, אבל כבר יש 4 זיכויים בקליטה\. הסר זיכוי שאינו של המשלוח הזה ואז "העבר לזיכויים"\./);
  assert.doesNotMatch(cardOf(c, 1), /rc-credit-doc-move/);
  await c.click('delivery-credit-remove', 'green-4');
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'move');
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  assert.equal(c.run('receiptDeliveryCredits.length'), 4);
  assert.equal(c.run('receiptDeliveryCredits[3].origin.docNumber'), 2);
  assert.equal(c.run('receiptNoteTotal'), 217.04);
  invariants(c);
  // A slip of 5 pages.
  const p = setup();
  const five = ['s1.jpg', 's2.jpg', 's3.jpg', 's4.jpg', 's5.jpg'];
  service(p.c, { papers: { 'delivery.jpg': twice(delivery), [five.join('+')]: twice(() => slip({ pageCount: 5 })) } });
  await gate(p.c, ['delivery.jpg', five]);
  assert.equal(p.c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(p.c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'blocked-pages');
  assert.match(cardOf(p.c, 1), /לתעודת זיכוי אפשר עד 4 עמודים; בתעודה 2 יש 5\. מחק את העמודים שאינם של הזיכוי \(בדוק צילומים\)\./);
  assert.equal(p.c.run('receiptNoteTotal'), null);
  p.c.toasts.length = 0;
  await p.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(p.c, 1) });
  assert.equal(p.c.run('receiptDeliveryCredits.length'), 0, 'a refused move is never truncated');
  invariants(p.c);
  // Attach mode: no credits on any screen.
  const a = setup({ attach: true });
  service(a.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(a.c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(a.c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(a.c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'blocked-attach');
  assert.equal(a.c.run('receiptNoteTotal'), null, 'never adopted');
  assert.match(cardOf(a.c, 1), /בצירוף תעודה לקליטה שנשמרה אין זיכויים: הסר אותה, ואחרי השמירה רשום את הזיכוי בכרטיס התעודה \("התקבל זיכוי מהספק"\)\./);
  await a.c.click('rc-credit-doc-remove', undefined, { scan: scanIdOf(a.c, 1) });
  assert.deepEqual(json(a.c, 'confirmLog').at(-1).slice(0, 1), ['להסיר את תעודה 2?']);
  assert.ok(a.c.toasts.includes('תעודה 2 הוסרה מהקליטה.'));
  assert.equal(a.c.run('aiScanDocuments.length'), 1);
  assert.equal(a.c.run('receiptNoteTotal'), 217.04, 'the remaining delivery note is adopted');
  invariants(a.c);
});

test('k: a credit with a discount on the whole document moves, but can only be removed — no undo, no re-read', async () => {
  const { c } = setup();
  const discounted = () => ({ ...slip(), subtotalExVat: -89.8, vatAmount: -16.16, totalInclVat: -105.96, documentDiscountExVat: -5, printedLines: 2,
    rows: [line(YOGURT, 10, -34.8), line(MILK, 12, -60)] });
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(discounted) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.errorKind, credit.origin.verdict], ['error', 'discount', 'move']);
  assert.ok(c.toasts.includes('תעודה 2 היא תעודת זיכוי — הועברה לזיכויים, אבל הקריאה שלה לא נסגרה. פרטים בכרטיס הזיכוי.'), c.toasts.join(' | '));
  const html = c.run('deliveryCreditsHtml()');
  assert.match(html, /data-role="delivery-credit-remove"[^>]*>הסר את הזיכוי</);
  assert.doesNotMatch(html, /delivery-credit-unmove|delivery-credit-read|delivery-credit-retake/);
  assert.equal(s.scans().length, 2);
  invariants(c);
});

test('l: cancelling the receipt while a moved credit is read aborts its upload — nothing lands in the next receipt, no further call', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] },
    hold: e => e.kind === 'credit' });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  await flush(c, 10);
  const upload = s.scans()[2];
  assert.equal(upload && upload.kind, 'credit');
  assert.equal(upload.signal && upload.signal.aborted, false, 'the credit upload is in flight');
  assert.equal(credit0(c).status, 'reading');
  await c.click('rc-cancel');
  assert.equal(upload.signal.aborted, true, 'the cancelled receipt\'s credit upload is aborted');
  upload.release(); await flush(c);
  assert.deepEqual(json(c, 'receiptDeliveryCredits'), []);
  assert.equal(s.scans().length, 3, 'no further call');
  assert.equal(c.toasts.filter(t => /הזיכוי צורף/.test(t)).length, 0);
  invariants(c);
});

test('m: a held document is never uploaded again — "בדוק צילומים" and "התחל" read nothing', async () => {
  const { c } = setup();
  // A negative read that one read typed "delivery" (ask-move): its own paper check fails, so only the
  // hold keeps it cached.
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ type: 'delivery', title: null })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(s.scans().length, 2);
  assert.equal(c.run('yotvataPaperCheck(aiScanDocuments[1].scanResult.doc, 1).ok'), false);
  assert.equal(c.run('yotvataCachedDoc(aiScanDocuments[1])'), true, 'the held read is cached');
  await c.click('rc-photo-repair');
  assert.match(app(c), /שלב 1 · צילום תעודה/);
  assert.match(app(c), new RegExp('data-credit-document="' + scanIdOf(c, 1) + '"'), 'the gate shows the decision card in the document card');
  assert.doesNotMatch(app(c), /הפענוח שמור — אין צורך בסריקה נוספת[^]*הפענוח שמור — אין צורך בסריקה נוספת/, 'the held document shows the card, not "הפענוח שמור"');
  await c.click('rc-photo-start'); await flush(c);
  assert.equal(s.scans().length, 2, 'zero uploads');
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  assert.ok(c.toasts.filter(t => t === HELD_TOAST(2)).length >= 1);
  invariants(c);
});

test('n: "זו לא תעודת זיכוי? החזר לתעודות" in every state restores the original read with no upload, marks it "delivery" and adopts; after a reload it is paper-only', async () => {
  // Confirmed (automatic attach).
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(credit0(c).status, 'confirmed');
  c.run('slipPages = receiptDeliveryCredits[0].pages');
  c.toasts.length = 0;
  await c.click('delivery-credit-unmove', credit0(c).id);
  assert.deepEqual(json(c, 'confirmLog').at(-1), ['להחזיר לתעודות?', 'תעודה 2 תחזור לרשימת התעודות כתעודת משלוח, והזיכוי יוסר. הקריאה שכבר נעשתה נשמרת — אין קריאה נוספת.', 'החזר לתעודות']);
  assert.deepEqual(c.toasts, ['תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה.']);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('aiScanDocuments.length'), 2);
  assert.equal(c.run('aiScanDocuments[1].pages === slipPages || aiScanDocuments[1].pages.every((p, i) => p === slipPages[i])'), true, 'the same photos');
  assert.equal(c.run('aiScanDocuments[1].kindDecision.kind'), 'delivery');
  assert.equal(c.run('aiScanDocuments[1].scanResult.doc.subtotalExVat'), -83.52, 'the original read');
  assert.equal(c.run('yotvataCachedDoc(aiScanDocuments[1])'), true);
  assert.equal(s.scans().length, 2, 'no upload');
  // The read is negative: the worker's "delivery" is not honoured on a negative read — it waits for a decision, nothing billed.
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-move');
  assert.match(cardOf(c, 1), /סימנת אותה כתעודת משלוח, אבל הסכומים בה שליליים\./);
  assert.equal(c.run('receiptPaperScanState'), 'failed', 'adoption ran, and refuses the negative paper');
  // "כן, זו תעודת זיכוי — העבר לזיכויים" brings it back with no call.
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  assert.equal(credit0(c).origin.verdict, 'ask-move');
  assert.equal(s.scans().length, 2);
  invariants(c);
  // Review (service v150), then a reload: the undo is paper-only.
  const v = setup();
  const sv = service(v.c, { version: 150, papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(v.c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(credit0(v.c).status, 'review');
  const r = runtime('yotvata', { data: v.data, storage: v.c.storage });
  r.run(`showConfirm = (t, x, l, fn) => fn(); mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()`);
  assert.equal(r.run('receiptDeliveryCredits[0].pages.length'), 0);
  assert.match(r.run('deliveryCreditsHtml()'), /זו לא תעודת זיכוי\? החזר לתעודות/);
  await r.click('delivery-credit-unmove', r.run('receiptDeliveryCredits[0].id'));
  assert.equal(r.run('receiptDeliveryCredits.length'), 0);
  assert.deepEqual(json(r, 'aiScanDocuments.map(d => [d.pages.length, d.restoredPageCount, yotvataCachedDoc(d)])'), [[0, 1, true], [0, 1, true]], 'paper-only, cached');
  assert.equal(r.run('aiScanDocuments[1].scanResult.doc.invoiceNumber'), SLIP_NUMBER);
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  assert.equal(sv.scans().length, 2);
  invariants(r);
});

test('o: the same slip as a document and with the green button — both carry the number, neither attaches, the finish waits; removing one lets the other attach', async () => {
  const { c, opened } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A), 'green.jpg': twice(VARIANT.CREDIT) } });
  c.run('renderReceiving()');
  await c.click('delivery-credit-add');
  const green = c.run('receiptDeliveryCredits[0].id');
  assert.equal(opened.at(-1), 'creditCam_' + green);
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-file', id: green }, files: [{ name: 'green.jpg' }], value: 'x' } });
  await flush(c, 6);
  await c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
  await flush(c);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'confirmed', 'the green button credit attached');
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.deepEqual(s.kinds(), ['credit:green.jpg', 'invoice:delivery.jpg', 'invoice:slip.jpg']);
  assert.equal(c.run('receiptDeliveryCredits.length'), 2);
  assert.equal(c.run('receiptDeliveryCredits[1].status'), 'review');
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(deliveryCreditDuplicate)'), [true, true]);
  assert.equal(c.run('deliveryCreditReady()'), false);
  await c.click('delivery-credit-remove', green);
  await c.click('delivery-credit-confirm', c.run('receiptDeliveryCredits[0].id'));
  assert.equal(credit0(c).status, 'confirmed');
  assert.equal(c.run('deliveryCreditReady()'), true);
  invariants(c);
});

test('p: "העבר וקרא כזיכוי" on a paper that is really an invoice — the credit read finds positive amounts; "זו תעודה רגילה — החזר לתעודות" restores the read and adopts it, with no further call', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  await flush(c);
  assert.deepEqual(s.kinds(), ['invoice:delivery.jpg', 'invoice:slip.jpg', 'credit:slip.jpg']);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.errorKind, credit.notCredit, credit.readAs], ['error', 'paper', true, 'credit']);
  const html = c.run('deliveryCreditsHtml()');
  assert.match(html, /הקריאה כזיכוי מצאה סכומים חיוביים — נראה שזו תעודת משלוח רגילה\. אם כך, החזר אותה לתעודות\./);
  assert.match(html, /<button data-role="delivery-credit-unmove"[^>]*class="btn-tap w-full bg-emerald-600[^>]*>זו תעודה רגילה — החזר לתעודות</);
  assert.match(html, /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
  await c.click('delivery-credit-unmove', credit.id);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('aiScanDocuments.length'), 2);
  assert.equal(c.run('aiScanDocuments[1].kindDecision.source'), 'unmove');
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), [], 'a valid positive invoice kept as a delivery note');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoteTotal'), 300.56);
  assert.equal(c.run('aiScanDocuments[1].pages[0].maxPixels'), undefined, 'the original invoice photo, not the credit re-encode');
  assert.equal(s.scans().length, 3, 'the mistaken tap cost one credit read; the undo costs nothing');
  invariants(c);
});

test('q: a false alarm on a real second delivery note (one read typed it "credit") — held, "לא" adopts it with no call, and "בטל — זו כן תעודת זיכוי" on the gate holds it again', async () => {
  const { c } = setup();
  const second = (type = 'delivery') => delivery({ number: '9073800002', type });
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'second.jpg': () => [second(), second('credit')] } });
  await gate(c, ['delivery.jpg', 'second.jpg']);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.match(cardOf(c, 1), /קריאה אחת סימנה אותה כזיכוי והשנייה כתעודת משלוח\./);
  assert.match(cardOf(c, 1), /לא, זו תעודת משלוח רגילה/);
  await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoteTotal'), 434.08);
  assert.equal(s.scans().length, 2, 'no call');
  await c.click('rc-photo-repair');
  assert.match(app(c), /סומנה כתעודת משלוח רגילה לפי ההחלטה שלך\./);
  assert.match(app(c), /data-role="rc-credit-doc-unkeep"[^>]*>בטל — זו כן תעודת זיכוי</);
  await c.click('rc-credit-doc-unkeep', undefined, { scan: scanIdOf(c, 1) });
  assert.ok(c.toasts.includes('ההחלטה בוטלה — תעודה 2 שוב ממתינה להחלטה.'));
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.equal(c.run('receiptNoteTotal'), null);
  assert.match(app(c), new RegExp('data-credit-document="' + scanIdOf(c, 1) + '"'));
  assert.equal(s.scans().length, 2);
  invariants(c);
});

test('s: the non-background read ("ai-run") of a slip read as −24 — no rotated re-reads, routing before the comparison, and the app is not left busy', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.B) } });
  await gate(c, ['delivery.jpg', 'slip.jpg'], { start: null });
  c.run(`receiptOpened = true; realEvaluate = aiEvaluateInvoiceScan; evaluatedWith = null;
    aiEvaluateInvoiceScan = (payload, rows) => { if (evaluatedWith === null) evaluatedWith = JSON.stringify({ docs: payload.scan.documents.length, credits: receiptDeliveryCredits.length }); return realEvaluate(payload, rows); };`);
  const runId = c.run('aiScanRunId');
  await c.click('ai-run'); await flush(c);
  assert.equal(s.stats.modelCalls, 4, 'two reads per document — the −24 slip is content, not a page upside down');
  assert.deepEqual(s.kinds(), ['invoice:delivery.jpg', 'invoice:slip.jpg']);
  assert.equal(c.run('aiScanBusy'), false, 'routing never bumps aiScanRunId, so the run releases the app');
  assert.equal(c.run('aiScanRunId'), runId + 1, 'one run, nothing else');
  assert.deepEqual(JSON.parse(c.run('evaluatedWith')), { docs: 1, credits: 1 }, 'the slip moved before the comparison ran');
  assert.equal(credit0(c).origin.auto, true);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.ok(c.run('aiScanEvaluation') && !json(c, 'aiScanEvaluation.errors').some(e => /תעודה 2/.test(e)));
  invariants(c);
});

test('t: a draft v393 already adopted (a sign split adopted on the positive read) restored on v394 — un-adopted, the hold line and the card, no read', async () => {
  const { c, data } = setup();
  service(c, { version: 150, papers: { 'delivery.jpg': twice(delivery),
    'slip.jpg': () => ({ reads: [slip({ printedUnits: 24 }), VARIANT.C(), slip({ printedUnits: 24 })], selected: 1 }) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  // What v393 saved for the same reads: both documents adopted, the slip billed as +83.52 / +24.
  const draft = JSON.parse(c.storage.get(c.run('RECEIPT_DRAFT_KEY')));
  assert.equal(draft.aiScan.scan.documents.length, 2, 'the snapshot keeps every paid read, held ones included');
  Object.assign(draft, { paperState: 'ok', paperProblems: [], anchorSource: 'paper', notes: [{ amount: 217.04, units: 58 }, { amount: 83.52, units: 24 }] });
  const storage = new Map(c.storage); storage.set(c.run('RECEIPT_DRAFT_KEY'), JSON.stringify(draft));
  const r = runtime('yotvata', { data, storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.equal(r.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(r, 'receiptPaperScanProblems'), ['תעודה 2 נראית כמו תעודת זיכוי — ההחלטה בכרטיס שמתחת.']);
  assert.equal(r.run('receiptNoteTotal'), null, 'the anchors that billed the slip are dropped');
  assert.match(app(r), /data-credit-document=/);
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  assert.equal(r.run('receiptDeliveryCredits.length'), 0);
  invariants(r);
});

test('u: "פענח תעודה — הכמויות נבדקות ידנית" — the card on the manual screen; after the move the paper rows come from the delivery note only; routing never rebuilds a credit card being typed in', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg'], { start: 'rc-photo-quantity' });
  assert.equal(c.run('receiptUsesManualQuantities()'), true);
  assert.match(app(c), /data-manual-receiving/);
  assert.match(app(c), new RegExp('data-credit-document="' + scanIdOf(c, 1) + '"'), 'the card is on the manual screen');
  assert.equal(c.run('receiptQuantityPaperRows()'), null, 'nothing to check against while a document is held');
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  await flush(c);
  assert.equal(credit0(c).status, 'confirmed');
  assert.deepEqual(json(c, 'receiptQuantityPaperRows().map(r => [r.productId, r.paperQty])'), [['yogurt', 48], ['milk', 10]]);
  assert.match(app(c), /data-manual-receiving/);
  assert.equal(s.scans().length, 3);
  // While the worker types in a credit card, routing refreshes the credit cards only (v364 rule).
  const t = setup();
  service(t.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(t.c, ['delivery.jpg', 'slip.jpg'], { start: null });
  t.c.run(`renders = 0; realRender = renderReceiving; renderReceiving = () => { renders++; realRender(); }`);
  t.c.run(`deliveryCreditEditingCard = () => ({ dataset: {} })`);
  await t.c.click('rc-photo-quantity'); await flush(t.c);
  const before = t.c.run('renders');
  t.c.run('yotvataAnnounceRouting({ moved: [], held: [] })');
  assert.equal(t.c.run('renders'), before, 'the announcement never rebuilds the screen');
  invariants(c);
});

test('v: typed anchors refuse a minus — "-83.52", "83.52-" and "(83.52)" are credits (green button, or attach mode\'s receipt card); "83.52" is accepted; a held document still blocks the finish there', async () => {
  const NORMAL = 'סכום עם מינוס הוא זיכוי. זיכוי מהנהג מצלמים בכפתור הירוק "הנהג הביא זיכוי על חוסר? צלם כאן" — כאן מקלידים רק תעודות משלוח.';
  const ATTACH = 'סכום עם מינוס הוא זיכוי. כאן מקלידים רק תעודות משלוח; זיכוי רושמים אחרי השמירה בכרטיס התעודה ("התקבל זיכוי מהספק").';
  for (const [attach, expected] of [[false, NORMAL], [true, ATTACH]]) {
    const { c } = setup({ attach });
    c.run('renderReceiving()');
    await c.click('rc-photo-manual');
    for (const typed of ['-83.52', '83.52-', '(83.52)', '−83.52']) {
      c.toasts.length = 0;
      c.node('rcNoteInput').value = typed; c.node('rcNoteUnits').value = '24';
      await c.click('rc-note-add');
      assert.deepEqual(c.toasts, [expected], typed);
      assert.deepEqual(json(c, 'receiptNotes'), [], typed + ' is never +83.52');
    }
    c.toasts.length = 0;
    c.node('rcNoteInput').value = '83.52'; c.node('rcNoteUnits').value = '-24';
    await c.click('rc-note-add');
    // A minus in the units only: the message is about the units (finding g), not «סכום».
    assert.deepEqual(c.toasts, [expected.replace('סכום עם מינוס הוא זיכוי.', 'יחידות עם מינוס הן זיכוי.')], 'a minus in the units too');
    c.node('rcNoteInput').value = '83.52'; c.node('rcNoteUnits').value = '24';
    await c.click('rc-note-add');
    assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 83.52, units: 24 }]);
    assert.equal(c.run('parseNoteVal("-83.52")'), 83.52, 'parseNoteVal itself is unchanged');
  }
  // A held document on a typed-anchors receipt: the card stays in #rcPaperStatus and the finish waits.
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-photo-manual');
  c.node('rcNoteInput').value = '217.04'; c.node('rcNoteUnits').value = '58';
  await c.click('rc-notes-done');
  assert.equal(c.run('receiptEntryMode'), 'manual');
  assert.match(c.run('yotvataPaperStatusHtml()'), /data-credit-document=/);
  count(c);
  pressCart(c);
  assert.deepEqual(c.toasts, [FINISH_HELD(2)]);
  assert.equal(c.run('pendingReceipt'), null);
  invariants(c);
});

// ---- review fixes (each test pins one finding of the integration, money-safety, state and UX reviews) ----

// A second slip (5 milk = −25.00, number 22230012) whose invoice reads dropped the minus under the credit title.
const milkSlip = ({ sign = -1, qty = 5, printedUnits = null } = {}) => ({ noteIndex: 0, invoiceNumber: '22230012', pageCount: 1, subtotalExVat: sign * 25,
  vatAmount: cents(sign * 4.5), totalInclVat: cents(sign * 29.5), printedUnits, printedLines: 1, documentDiscountExVat: null, confidence: 0.9, warnings: [],
  rows: [line(MILK, qty, sign * 25)], documentType: 'credit', printedTitle: SLIP_TITLE });
// An invoice with one store return line (positive summary 207.04 / 56; the rows close it: 167.04 + 50 − 10).
const withReturnLine = ({ type = 'delivery', pageCount = 1, returnPage = 1 } = {}) => ({ ...delivery({ type, title: 'חשבונית מס' }), pageCount,
  subtotalExVat: 207.04, vatAmount: 37.27, totalInclVat: 244.31, printedUnits: 56, printedLines: 3,
  rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), { ...line(MILK, -2, -10, returnPage), description: 'החזרה חלב בדיקה' }] });
const RETURN_LINE_PROBLEM = 'תעודה 1: בשורה 3 נקרא סכום שלילי (‎-10.00) — אם זו שורת החזרה בתוך התעודה, הקלד את הסכום והיחידות ידנית.';
async function typeNotes(c, lines) {
  await c.click('rc-photo-manual');
  for (const [amount, units] of lines.slice(0, -1)) { c.node('rcNoteInput').value = amount; c.node('rcNoteUnits').value = units; await c.click('rc-note-add'); }
  const [amount, units] = lines.at(-1);
  c.node('rcNoteInput').value = amount; c.node('rcNoteUnits').value = units;
  await c.click('rc-notes-done'); await flush(c);
}

test('w1: a slip that moves by itself ahead of a held one — the toast names both, the held card keeps the number it was photographed as, and the two credits never share "תעודה 2"', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A),
    'slip2.jpg': ({ credit }) => credit ? [milkSlip({ qty: -5 }), milkSlip({ qty: -5 })] : [milkSlip({ sign: 1, printedUnits: 5 }), milkSlip({ sign: 1, printedUnits: 5 })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg', 'slip2.jpg']);
  assert.equal(credit0(c).origin.docNumber, 2);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => [x.index, x.input.shotAs])'), [[1, 3]], 'the held slip is now second, photographed as third');
  assert.ok(c.toasts.includes(ATTACHED_TOAST + ' תעודה 3 (עכשיו תעודה 2) נראית כמו תעודת זיכוי — צריך החלטה שלך לפני הסיום.'), c.toasts.join(' | '));
  assert.match(cardOf(c, 1), /תעודה 2 \(צולמה כ"תעודה 3"\) נראית כמו תעודת זיכוי/);
  const r = runtime('yotvata', { data, storage: c.storage });
  assert.equal(r.run('aiScanDocuments[1].shotAs'), 3, 'the number survives a reload');
  assert.match(r.run('yotvataCreditDocumentCardHtml(1)'), /צולמה כ"תעודה 3"/);
  c.toasts.length = 0;
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) });
  await flush(c);
  assert.ok(c.toasts.includes('תעודה 3 הועברה לזיכויים ונקראת עכשיו כזיכוי.'), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => [x.number, x.origin.docNumber, x.status])'), [[SLIP_NUMBER, 2, 'confirmed'], ['22230012', 3, 'confirmed']]);
  assert.match(c.run('deliveryCreditsHtml()'), /צולם כ"תעודה 3" וזוהה כתעודת זיכוי/);
  count(c, 24, 5);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.shortCreditNotes.map(n => [n.number, n.origin.docNumber]), [[SLIP_NUMBER, 2], ['22230012', 3]]);
  assert.equal(p.ex, 108.52);
  assert.equal(s.stats.modelCalls, 8, '2 + 2 + 2 invoice reads, 2 credit reads');
  invariants(c);
});

test('w2: a real 2-page invoice whose return line is alone on page 2 is one document (its rows close the printed summary) — no split, no hold, as v393; a real split that is undone puts the page back in its document with the original read', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'inv-p1.jpg+inv-p2.jpg': twice(() => withReturnLine({ pageCount: 2, returnPage: 2 })) } });
  c.run('renderReceiving()');
  await photograph(c, 0, ['inv-p1.jpg', 'inv-p2.jpg'], { gallery: true });
  await c.click('rc-photo-start'); await flush(c);
  const signals = json(c, 'yotvataPaperCreditSignals(aiScanDocuments[0].scanResult.doc, 2)');
  assert.deepEqual([signals.rowsClose, signals.pageSplit, signals.signal], [true, null, false]);
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(s.stats.modelCalls, 2, 'no split, no credit read, no re-read');
  assert.ok(json(c, 'receiptPaperScanProblems').includes(RETURN_LINE_PROBLEM), json(c, 'receiptPaperScanProblems').join(' | '));
  assert.equal(c.run('aiScanResponse.scan.documents.length'), 1, 'in the money view, as in v393');
  invariants(c);
  // A real mixed pick (test h) split, then "זה לא זיכוי? החזר את העמוד לתעודות".
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  const papers = { 'delivery-p.jpg+slip-p.jpg': twice(mixed), 'slip-p.jpg': twice(VARIANT.CREDIT), 'delivery-p.jpg': twice(delivery) };
  const h = setup();
  const hs = service(h.c, { papers });
  h.c.run('renderReceiving()');
  await photograph(h.c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await h.c.click('rc-photo-start'); await flush(h.c);
  h.c.run('allPages = aiScanDocuments[0].pages.slice()');
  await h.c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(h.c, 0) }); await flush(h.c);
  assert.equal(hs.scans().length, 3);
  h.c.toasts.length = 0;
  await h.c.click('delivery-credit-unmove', credit0(h.c).id);
  assert.deepEqual(json(h.c, 'confirmLog').at(-1), ['להחזיר לתעודות?', 'העמוד יחזור למקומו בתעודה 1, והזיכוי יוסר. הקריאה הקודמת של התעודה חוזרת — אין קריאה נוספת.', 'החזר לתעודות']);
  assert.deepEqual(h.c.toasts, ['העמוד חזר לתעודה 1. הקריאה הקודמת שלה נשמרה — אין קריאה נוספת.']);
  assert.equal(h.c.run('aiScanDocuments.length'), 1, 'one document again — not a new "תעודה 1" ahead of the invoice');
  assert.equal(h.c.run('aiScanDocuments[0].pages.length === 2 && aiScanDocuments[0].pages.every((p, i) => p === allPages[i])'), true, 'the same pages, in their order');
  assert.equal(h.c.run('aiScanDocuments[0].scanResult.doc.pageCount'), 2, 'the original two-page read');
  assert.equal(h.c.run('yotvataCachedDoc(aiScanDocuments[0])'), true);
  assert.equal(h.c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-split', 'back to the decision it was');
  assert.equal(h.c.run('receiptDeliveryCredits.length'), 0);
  await h.c.click('rc-photo-repair'); await h.c.click('rc-photo-start'); await flush(h.c);
  assert.equal(hs.scans().length, 3, 'nothing is uploaded again');
  invariants(h.c);
  // The invoice changed after the split (a page added): the page goes back into it, and it is read again on "התחל".
  const g = setup();
  service(g.c, { papers });
  g.c.run('renderReceiving()');
  await photograph(g.c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await g.c.click('rc-photo-start'); await flush(g.c);
  await g.c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(g.c, 0) }); await flush(g.c);
  g.c.run(`aiScanDocuments[0].pages.push({ name: 'extra.jpg', dataUrl: 'data:image/jpeg;base64,' + btoa('extra.jpg'), orientationConfirmed: true }); yotvataInvalidatePhotoDoc(aiScanDocuments[0])`);
  g.c.toasts.length = 0;
  await g.c.click('delivery-credit-unmove', credit0(g.c).id);
  assert.deepEqual(g.c.toasts, ['העמוד חזר לתעודה 1. היא תיקרא שוב כשתלחץ "התחל קליטת מוצרים".']);
  assert.deepEqual(json(g.c, 'aiScanDocuments[0].pages.map(p => p.name)'), ['delivery-p.jpg', 'slip-p.jpg', 'extra.jpg']);
  assert.deepEqual(json(g.c, 'receiptPaperScanProblems'), ['תעודה 1 עוד לא נקראה — היא תיקרא כשתלחץ "התחל קליטת מוצרים" (בדוק צילומים).'], 'not four checks of a paper that was never read');
  invariants(g.c);
});

test('w3: an invoice with a return line that one read typed "credit" — "לא, זו תעודת משלוח רגילה" is offered (0 calls); a mistaken "העבר וקרא כזיכוי" finds a positive summary, offers the free way back, and the way back does not hold it again', async () => {
  const papers = { 'invoice.jpg': ({ credit }) => credit ? [withReturnLine(), withReturnLine()] : [withReturnLine(), withReturnLine({ type: 'credit' })] };
  const { c } = setup();
  const s = service(c, { papers });
  await gate(c, ['invoice.jpg']);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-read');
  assert.match(cardOf(c, 0), /data-role="rc-credit-doc-keep"[^>]*>לא, זו תעודת משלוח רגילה</);
  await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 0) });
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(c.run('aiScanResponse.scan.documents.length'), 1, 'it is in the money view, as in v393');
  assert.ok(json(c, 'receiptPaperScanProblems').includes(RETURN_LINE_PROBLEM));
  assert.equal(s.stats.modelCalls, 2, 'the false alarm cost nothing');
  invariants(c);
  // The mistaken tap: one credit read, then the free way back.
  const m = setup();
  const ms = service(m.c, { papers });
  await gate(m.c, ['invoice.jpg']);
  await m.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(m.c, 0) }); await flush(m.c);
  const credit = credit0(m.c);
  assert.deepEqual([credit.status, credit.errorKind, credit.notCredit], ['error', 'paper', true], 'a positive summary is no credit, return line or not');
  const html = m.c.run('deliveryCreditsHtml()');
  assert.match(html, /<button data-role="delivery-credit-unmove"[^>]*class="btn-tap w-full bg-emerald-600[^>]*>זו תעודה רגילה — החזר לתעודות</);
  assert.match(html, /הקריאה כזיכוי מצאה סכומים חיוביים — נראה שזו תעודת משלוח רגילה\./);
  assert.doesNotMatch(html, /נסה לקרוא שוב את אותו צילום/, 'no paid re-read is offered');
  await m.c.click('delivery-credit-unmove', credit.id);
  assert.deepEqual(json(m.c, 'yotvataHeldDocuments()'), [], 'the way back is not a loop');
  assert.equal(m.c.run('aiScanDocuments[0].kindDecision.source'), 'unmove');
  assert.ok(json(m.c, 'receiptPaperScanProblems').includes(RETURN_LINE_PROBLEM));
  assert.equal(ms.stats.modelCalls, 4, 'two invoice reads, two credit reads, nothing after');
  invariants(m.c);
});

test('w4: removing the only document from its card leaves an empty "תעודה 1" — the paper status says it was not photographed, not four checks of a paper never read', async () => {
  const { c } = setup();
  service(c, { papers: { 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['slip.jpg']);
  await c.click('rc-credit-doc-remove', undefined, { scan: scanIdOf(c, 0) });
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), ['תעודה 1 עוד לא צולמה — צלם אותה (בדוק צילומים) או הקלד את הסכום והיחידות שלה.']);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  invariants(c);
});

test('w5: a v393 draft that failed on the slip restored on v394 — the stale lines of the held document become the hold line; the other lines stay', async () => {
  const { c, data } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => [VARIANT.A(), slip({ type: 'delivery', title: null })] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  const draft = JSON.parse(c.storage.get(c.run('RECEIPT_DRAFT_KEY')));
  // What v393 saved for the same papers: not adopted, its paper check of the negative slip asks to photograph again.
  Object.assign(draft, { paperState: 'failed', anchorSource: null, notes: [], paperProblems: ['תעודה 2: חסרים כמות, סכום נטו או שיוך לעמוד באחת השורות',
    'תעודה 2: הסכום ללא מע״מ לא נקרא בסיכום התעודה', 'תעודה 1: מספר השורות אינו תואם למספר המודפס'] });
  const storage = new Map(c.storage); storage.set(c.run('RECEIPT_DRAFT_KEY'), JSON.stringify(draft));
  const r = runtime('yotvata', { data, storage });
  assert.equal(r.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(r, 'receiptPaperScanProblems'), ['תעודה 2 נראית כמו תעודת זיכוי — ההחלטה בכרטיס שמתחת.', 'תעודה 1: מספר השורות אינו תואם למספר המודפס']);
  assert.equal(r.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  // A v394 draft is restored exactly as saved.
  const same = runtime('yotvata', { data, storage: c.storage });
  assert.deepEqual(json(same, 'receiptPaperScanProblems'), json(c, 'receiptPaperScanProblems'));
});

test('w6: "לא, זו תעודת משלוח רגילה" is not offered when most readings saw the minus, and asks first when every read typed it "credit"', async () => {
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': () => ({ reads: [slip({ printedUnits: 24 }), VARIANT.C(), slip({ printedUnits: 24 })], selected: 1 }) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.match(cardOf(c, 1), /2 מתוך 3 הקריאות קראו סכום שלילי \(‎-83\.52\), ואחת חיובי \(83\.52\)\./);
  assert.doesNotMatch(cardOf(c, 1), /rc-credit-doc-keep/);
  await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [1], 'a keep that is not offered changes nothing');
  assert.equal(c.run('receiptNoteTotal'), null, 'never billed as goods');
  invariants(c);
  const k = setup();
  service(k.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(k.c, ['delivery.jpg', 'slip.jpg']);
  k.c.run('confirmLog = []; showConfirm = (t, x, l, fn) => { confirmLog.push([t, x, l]); }'); // the worker has not answered yet
  await k.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(k.c, 1) });
  assert.deepEqual(json(k.c, 'confirmLog'), [['תעודה 2 היא תעודת משלוח?',
    'כל הקריאות סימנו אותה כתעודת זיכוי («ביטול מכירה חלקי ת.משלוח»). אם תאשר, הסכום שלה (₪83.52 לפני מע״מ · 24 יח׳) ייכנס לתעודות כסחורה שהתקבלה.', 'כן, תעודת משלוח']]);
  assert.deepEqual(json(k.c, 'yotvataHeldDocuments().map(x => x.index)'), [1], 'nothing changes before the answer');
  invariants(k.c);
});

test('w8: typed anchors — moving the held slip removes the line typed for it, so it is never billed as goods next to its own credit (photo-first "או הקלד סכום ויחידות", and the classic typed receipt)', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await typeNotes(c, [['217.04', '58'], ['83.52', '24']]);
  assert.equal(c.run('receiptEntryMode'), 'manual');
  assert.equal(c.run('receiptNoteTotal'), 300.56);
  c.toasts.length = 0;
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  assert.ok(c.toasts.includes('תעודה 2 הועברה לזיכויים ונקראת עכשיו כזיכוי. השורה שהוקלדה לה (₪83.52 · 24 יח׳) הוסרה מסכום התעודות.'), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(credit0(c).status, 'confirmed');
  assert.equal(s.stats.modelCalls, 6);
  count(c);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.noteParts, [{ amount: 217.04, units: 58 }]);
  assert.equal(p.ex, 133.52);
  invariants(c);
  // Classic: typed 217.04/58 and 83.52/24, "סרוק את התעודות" in the comparison — AI document i is typed line i.
  const k = setup();
  service(k.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  k.c.run('renderReceiving()');
  await k.c.click('rc-photo-manual');
  k.c.node('rcNoteInput').value = '217.04'; k.c.node('rcNoteUnits').value = '58'; await k.c.click('rc-note-add');
  k.c.node('rcNoteInput').value = '83.52'; k.c.node('rcNoteUnits').value = '24'; await k.c.click('rc-open'); await flush(k.c, 5);
  count(k.c);
  pressCart(k.c); await flush(k.c, 10);
  assert.equal(k.c.run('currentView'), 'reconcile');
  await k.c.click('ai-rescan'); await flush(k.c);
  await photograph(k.c, 0, ['delivery.jpg']); await photograph(k.c, 1, ['slip.jpg']);
  k.c.toasts.length = 0;
  await k.c.click('ai-run'); await flush(k.c);
  assert.deepEqual(json(k.c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  assert.equal(k.c.run('receiptDeliveryCredits.length'), 0, 'no routing on the classic path');
  assert.ok(k.c.toasts.includes(HELD_TOAST(2)), 'the classic read names the held document: ' + k.c.toasts.join(' | '));
  k.c.run("currentView = 'receiving'; renderReceiving()");
  await k.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(k.c, 1) }); await flush(k.c);
  assert.deepEqual(json(k.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], 'typed line 2 was this paper');
  assert.equal(k.c.run('aiScanDocuments.length'), 1, 'AI documents and typed lines stay in step');
  assert.equal(credit0(k.c).origin.docNumber, 2);
  invariants(k.c);
});

test('w9: the page split on a receipt whose anchors were typed never leaves the paper "running" — the receipt still saves', async () => {
  const { c } = setup();
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  const s = service(c, { papers: { 'delivery-p.jpg+slip-p.jpg': twice(mixed), 'slip-p.jpg': twice(VARIANT.CREDIT), 'delivery-p.jpg': twice(delivery) } });
  c.run('renderReceiving()');
  await photograph(c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await c.click('rc-photo-start'); await flush(c);
  await typeNotes(c, [['217.04', '58']]);
  assert.equal(c.run('receiptEntryMode'), 'manual');
  assert.match(c.run('yotvataPaperStatusHtml()'), /rc-credit-doc-split/, 'the card still shows on a typed-anchors receipt');
  await c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(c, 0) }); await flush(c);
  assert.deepEqual(s.kinds(), ['invoice:delivery-p.jpg+slip-p.jpg', 'credit:slip-p.jpg', 'invoice:delivery-p.jpg']);
  assert.notEqual(c.run('receiptPaperScanState'), 'running');
  assert.equal(c.run('handoffDraft("receiving").scanRunning'), false);
  assert.equal(c.run('receiptPriceAudit().state'), 'ready');
  assert.equal(credit0(c).status, 'confirmed');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], 'no typed line was the slip page\'s');
  count(c);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  c.toasts.length = 0;
  await c.run('confirmReceipt()'); await flush(c);
  assert.ok(c.writes.some(w => w.path && w.path.includes('receipts')), 'saved: ' + c.toasts.join(' | '));
  assert.ok(!c.toasts.includes('קריאת התעודה עדיין רצה — המתן לסיומה.'));
});

test('w10: while a document waits for a decision, the price check covers the documents that were read — their rows are not "partial"', async () => {
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  count(c);
  const audit = json(c, 'receiptPriceAudit()');
  assert.equal(audit.complete, true);
  assert.equal(audit.rows.length, 2);
  assert.deepEqual(audit.rows.filter(r => r.capability === 'partial').map(r => r.reason), []);
  assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /שורות לטיפול/);
  invariants(c);
});

test('w11: a document held by the comparison\'s own read ("פענח") — the comparison says so outside "מה לא נסגר?" and leads to the decision card', async () => {
  const { c } = setup();
  const twoPages = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'delivery.jpg+slip.jpg': twice(twoPages) } });
  await gate(c, ['delivery.jpg']);
  count(c);
  pressCart(c); await flush(c, 10);
  assert.equal(c.run('currentView'), 'reconcile');
  // The driver hands over the slip late: added as page 2 of "תעודה 1", then "פענח".
  await c.click('ai-edit-images'); await flush(c);
  await photograph(c, 0, ['slip.jpg']);
  c.toasts.length = 0;
  await c.click('ai-run'); await flush(c);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => yotvataDocumentKindVerdict(x.input))'), ['ask-split']);
  assert.ok(c.toasts.includes(HELD_TOAST(1)), c.toasts.join(' | '));
  const html = app(c);
  assert.match(html, /<div data-credit-document-pending[^>]*><div class="font-black text-amber-900 text-sm">תעודה 1 נראית כמו תעודת זיכוי — היא אינה נכללת בהשוואה עד שתחליט עליה\.<\/div>/);
  assert.match(html, /data-role="rc-credit-doc-open"[^>]*>להחלטה על תעודה 1</);
  await c.click('rc-credit-doc-open', undefined, { scan: scanIdOf(c, 0) });
  assert.equal(c.run('currentView'), 'receiving');
  assert.match(app(c), /data-role="rc-credit-doc-split"[^>]*>העבר את עמוד 2 לזיכויים וקרא מחדש</);
  invariants(c);
});

// ---- the LOW findings of the review round, each reproduced and pinned ----

test('w12 (a): a document held by the comparison\'s own read ("פענח") on a classic typed receipt — "קלוט תעודה" and the summary\'s confirm both refuse, lead to the card, and nothing is saved', async () => {
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  c.run('renderReceiving()');
  await c.click('rc-photo-manual');
  c.node('rcNoteInput').value = '217.04'; c.node('rcNoteUnits').value = '58'; await c.click('rc-note-add');
  c.node('rcNoteInput').value = '83.52'; c.node('rcNoteUnits').value = '24'; await c.click('rc-open'); await flush(c, 5);
  count(c);
  pressCart(c); await flush(c, 10);
  assert.equal(c.run('currentView'), 'reconcile');
  await c.click('ai-rescan'); await flush(c);
  await photograph(c, 0, ['delivery.jpg']); await photograph(c, 1, ['slip.jpg']);
  await c.click('ai-run'); await flush(c);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => [x.index, yotvataDocumentKindVerdict(x.input)])'), [[1, 'move']], 'held, not moved: no routing on the classic path');
  assert.equal(c.run('currentView'), 'reconcile');
  // «קלוט תעודה» (and «סגור עם הפרש ואטפל אחר כך», the same role) in the comparison.
  c.toasts.length = 0; c.run('confirmLog = []');
  await c.click('rc-recon-save');
  assert.deepEqual(c.toasts, [FINISH_HELD(2)]);
  assert.deepEqual(json(c, 'confirmLog'), [], 'refused before any "הפרש" question');
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(c.run('currentView'), 'receiving');
  assert.match(app(c), new RegExp('data-credit-document="' + scanIdOf(c, 1) + '"'), 'the decision card is on the screen');
  // A summary that was already open (stale) is not confirmed either.
  c.run("pendingReceipt = { lines: [], ex: 0, status: 'open', noteParts: [], shortCreditNotes: [] }");
  c.toasts.length = 0;
  await c.run('confirmReceipt()'); await flush(c);
  assert.deepEqual(c.toasts, [FINISH_HELD(2)]);
  assert.equal(c.run('pendingReceipt'), null);
  assert.equal(c.writes.some(w => w.path && w.path.includes('receipts')), false, 'nothing saved');
  // The decision, then the finish: the slip is a credit and its typed line leaves the paper sum.
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(credit0(c).status, 'confirmed');
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.equal(c.run('yotvataHeldStopsSave()'), false);
  invariants(c);
});

test('w13 (b): a credit that its own credit-mode read verified ("העבר וקרא כזיכוי", attached by itself) offers no way back to the documents — the dropped-sign read is never billed as goods', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.autoConfirmed, credit.paperMode, credit.origin.kind], ['confirmed', true, 'credit', 'document']);
  const html = c.run('deliveryCreditsHtml()');
  assert.match(html, /צולם כ"תעודה 2" וזוהה כתעודת זיכוי \(«ביטול מכירה חלקי ת\.משלוח»\)\./, 'where it came from is still said');
  assert.doesNotMatch(html, /delivery-credit-unmove/, 'no "זו לא תעודת זיכוי? החזר לתעודות"');
  assert.match(html, /data-role="delivery-credit-remove"/, '"הסר זיכוי" stays, as on a green-button credit');
  c.run('confirmLog = []');
  await c.click('delivery-credit-unmove', credit.id); // a forged or stale tap
  assert.deepEqual(json(c, 'confirmLog'), []);
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  assert.equal(c.run('aiScanDocuments.length'), 1);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], 'the slip is not a second delivery note');
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.doesNotMatch(r.run('deliveryCreditsHtml()'), /delivery-credit-unmove/, 'not after a reload either');
  count(c);
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts.length, p.shortCreditNotes.length], ['ok', 133.52, 1, 1]);
  assert.equal(s.stats.modelCalls, 6);
  invariants(c); invariants(r);
});

test('w14 (c): "פרטי פענוח התעודה" — an undo clears "הועברה לזיכויים"; a page split names only the page that moved, never the delivery note that stayed', async () => {
  const historyText = c => text(c.run('yotvataScanHistoryHtml(yotvataReceiptScanAudit(), null)'));
  // Undo after a mistaken "העבר וקרא כזיכוי" (the credit read found positive amounts).
  const { c } = setup();
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C) } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  const slipScan = scanIdOf(c, 1);
  await c.click('rc-credit-doc-move', undefined, { scan: slipScan }); await flush(c);
  const credit = credit0(c);
  assert.equal(c.run(`receiptScanHistory.filter(e => e.scanId === ${JSON.stringify(slipScan)}).every(e => e.movedToCredit === ${JSON.stringify(credit.id)})`), true);
  assert.match(historyText(c), /תעודה 2 · זוהתה כתעודת זיכוי והועברה לזיכויים/);
  await c.click('delivery-credit-unmove', credit.id);
  assert.equal(c.run('aiScanDocuments[1].scanId'), slipScan, 'the same paper is back');
  assert.equal(c.run('receiptScanHistory.some(e => e.movedToCredit)'), false, 'no history entry points at the removed credit');
  assert.doesNotMatch(historyText(c), /הועברה לזיכויים/);
  assert.match(historyText(c), /תעודה 2 · התקבלה קריאה/);
  count(c);
  const p = finish(c);
  assert.equal(p.noteParts.length, 2, 'billed as the worker decided');
  assert.equal(c.run('yotvataReceiptScanAudit().history.some(e => e.movedToCredit)'), false, 'the saved audit agrees');
  // The page split: "תעודה 1" stays and is billed; only its page 2 moved.
  const h = setup();
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  service(h.c, { papers: { 'delivery-p.jpg+slip-p.jpg': twice(mixed), 'slip-p.jpg': twice(VARIANT.CREDIT), 'delivery-p.jpg': twice(delivery) } });
  h.c.run('renderReceiving()');
  await photograph(h.c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await h.c.click('rc-photo-start'); await flush(h.c);
  await h.c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(h.c, 0) }); await flush(h.c);
  const pageCredit = credit0(h.c);
  assert.deepEqual(json(h.c, 'receiptScanHistory.map(e => [e.docIndex, !!e.movedToCredit, e.movedPagesToCredit ? e.movedPagesToCredit.pages : null])'),
    [[0, false, [2]], [0, false, null]], 'the combined read names page 2; the re-read of the delivery note is a plain read');
  assert.equal(h.c.run(`receiptScanHistory[0].movedPagesToCredit.id === ${JSON.stringify(pageCredit.id)}`), true);
  const panel = historyText(h.c);
  assert.doesNotMatch(panel, /זוהתה כתעודת זיכוי והועברה לזיכויים/, 'the delivery note is never said to have moved');
  assert.match(panel, /תעודה 1 · התקבלה קריאה · עמוד 2 זוהה כתעודת זיכוי והועבר לזיכויים/);
  await h.c.click('delivery-credit-unmove', pageCredit.id);
  assert.equal(h.c.run('receiptScanHistory.some(e => e.movedToCredit || e.movedPagesToCredit)'), false, 'the page undo clears it too');
  invariants(c); invariants(h.c);
});

test('w15 (d): "זו תעודה רגילה — החזר לתעודות" while an invoice read runs says why it waits, then works once the read ends', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.C), 'third.jpg': twice(() => delivery({ number: '9073800003' })) },
    hold: entry => entry.name === 'third.jpg' });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  const credit = credit0(c);
  assert.equal(credit.notCredit, true);
  // One more delivery note, and "התחל": its read is slow.
  await c.click('rc-photo-repair'); await flush(c, 10);
  await c.click('rc-photo-add-doc');
  await c.click('ai-add-photo', undefined, { doc: '1' });
  c.events.get('app:change')({ target: { id: '', dataset: { role: 'ai-file', doc: '1' }, getAttribute: n => n === 'data-role' ? 'ai-file' : null, files: [{ name: 'third.jpg' }], value: 'x' } });
  await flush(c, 6);
  // After an earlier read the photo opens for viewing only (as in v393); the worker taps it and confirms.
  c.run('aiCloseOrientationReview()');
  await c.click('ai-review-page', undefined, { doc: '1', page: '0' });
  await c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') }); await flush(c, 6);
  assert.equal(c.run('aiScanDocuments[1].pages[0].orientationConfirmed'), true);
  await c.click('rc-photo-start'); await flush(c, 20);
  assert.equal(c.run('aiScanBusy'), true, 'the read of the third paper is in the air');
  c.toasts.length = 0; c.run('confirmLog = []');
  await c.click('delivery-credit-unmove', credit.id);
  assert.deepEqual(c.toasts, ['ממתין לסיום קריאת התעודות — אחרי הקריאה אפשר להחזיר לתעודות.'], 'not a silent refusal');
  assert.deepEqual(json(c, 'confirmLog'), []);
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  s.scans().find(e => e.name === 'third.jpg').release(); await flush(c);
  assert.equal(c.run('aiScanBusy'), false);
  c.toasts.length = 0;
  await c.click('delivery-credit-unmove', credit.id);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.ok(c.toasts.includes('תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה.'), c.toasts.join(' | '));
  invariants(c);
});

test('w16 (e): a false alarm (one read typed a real delivery note "credit", no credit title) — the card never claims minus signs were lost, and a mistaken move\'s origin line carries no "delivery" title', async () => {
  const { c } = setup();
  const second = (type = 'delivery') => delivery({ number: '9073800002', type });
  service(c, { papers: { 'delivery.jpg': twice(delivery), 'second.jpg': ({ credit }) => credit ? [second(), second()] : [second(), second('credit')] } });
  await gate(c, ['delivery.jpg', 'second.jpg']);
  const card = cardOf(c, 1);
  assert.doesNotMatch(card, /בלי סימן מינוס/);
  assert.match(card, /הכותרת שנקראה: «תעודת משלוח»/);
  assert.match(card, /הסכומים בה חיוביים\./);
  assert.match(card, /קריאה אחת סימנה אותה כזיכוי והשנייה כתעודת משלוח\./);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  const credit = credit0(c);
  assert.deepEqual([credit.notCredit, credit.origin.title], [true, null]);
  assert.match(c.run('deliveryCreditsHtml()'), /צולם כ"תעודה 2" וזוהה כתעודת זיכוי\./);
  assert.doesNotMatch(c.run('deliveryCreditsHtml()'), /«תעודת משלוח»/);
  invariants(c);
  // One read typed it "credit", the other "unclear": the card says what that one read said.
  const u = setup();
  service(u.c, { papers: { 'delivery.jpg': twice(delivery), 'second.jpg': () => [second('unclear'), second('credit')] } });
  await gate(u.c, ['delivery.jpg', 'second.jpg']);
  assert.match(cardOf(u.c, 1), /קריאה אחת סימנה אותה כזיכוי, אבל הסכומים בה חיוביים\./);
  assert.doesNotMatch(cardOf(u.c, 1), /בלי סימן מינוס/);
  // Control: the dropped-sign slip under a credit title still says it (test c).
  invariants(u.c);
});

test('w17 (f): two slips that move and attach by themselves — one toast that says they were attached, and their cards in the order they were photographed', async () => {
  const { c } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A), 'slip2.jpg': twice(() => milkSlip()) } });
  await gate(c, ['delivery.jpg', 'slip.jpg', 'slip2.jpg']);
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => [x.origin.docNumber, x.status, x.autoConfirmed])'), [[2, 'confirmed', true], [3, 'confirmed', true]]);
  assert.ok(c.toasts.includes('תעודות 2 ו-3 הן תעודות זיכוי — הועברו לזיכויים וצורפו למשלוח. בסיום הספירה נבדוק איזה חוסר הן מכסות.'), c.toasts.join(' | '));
  assert.deepEqual([...c.run('deliveryCreditsHtml()').matchAll(/צולם כ"תעודה (\d)"/g)].map(m => m[1]), ['2', '3']);
  count(c, 24, 5);
  const p = finish(c);
  assert.deepEqual([p.status, p.ex], ['ok', 108.52]);
  assert.deepEqual(p.shortCreditNotes.map(n => n.origin.docNumber), [2, 3]);
  assert.equal(s.stats.modelCalls, 6);
  invariants(c);
  // v150 (no types): both move but wait for a tap — the toast still asks to check them.
  const v = setup();
  service(v.c, { version: 150, papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A), 'slip2.jpg': twice(() => milkSlip()) } });
  await gate(v.c, ['delivery.jpg', 'slip.jpg', 'slip2.jpg']);
  assert.deepEqual(json(v.c, 'receiptDeliveryCredits.map(x => [x.origin.docNumber, x.status])'), [[2, 'review'], [3, 'review']]);
  assert.ok(v.c.toasts.includes('תעודות 2 ו-3 הן תעודות זיכוי — הועברו לזיכויים. בדוק אותן בכרטיסי הזיכוי.'), v.c.toasts.join(' | '));
  invariants(v.c);
});

test('w18 (g): the minus refusal in typed anchors names the green button as it is on the screen — absent before the delivery note is typed, "צלם תעודת זיכוי נוספת" once a credit exists — and a minus only in the units is about the units', async () => {
  const typeMinus = async (c, amount, units, role = 'rc-note-add') => {
    const focused = [];
    c.node('rcNoteInput').focus = () => focused.push('amount'); c.node('rcNoteUnits').focus = () => focused.push('units');
    c.node('rcNoteInput').value = amount; c.node('rcNoteUnits').value = units;
    c.toasts.length = 0;
    await c.click(role); await flush(c, 5);
    return focused;
  };
  // "אין תעודה בכלל", then "מצאתי את התעודה — הזן את המספרים": no green button until a delivery note is typed.
  const n = setup();
  n.c.run('renderReceiving()');
  await n.c.click('rc-photo-manual'); await n.c.click('rc-open-nodoc'); await n.c.click('rc-nodoc-found');
  n.c.run('renderReceiving()');
  assert.doesNotMatch(app(n.c), /data-role="delivery-credit-add"/);
  assert.deepEqual(await typeMinus(n.c, '-83.52', '24'), ['amount']);
  assert.deepEqual(n.c.toasts, ['סכום עם מינוס הוא זיכוי. כאן מקלידים רק תעודות משלוח. הקלד קודם את תעודת המשלוח; אחר כך יופיע הכפתור הירוק לצילום הזיכוי.']);
  assert.deepEqual(json(n.c, 'receiptNotes'), []);
  // A credit already on the receipt: the button reads "צלם תעודת זיכוי נוספת".
  const k = setup();
  service(k.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(k.c, ['delivery.jpg', 'slip.jpg']);
  await k.c.click('rc-notes-edit');
  k.c.run('renderReceiving()');
  assert.match(app(k.c), /data-role="delivery-credit-add"[^>]*>[^<]*<i[^>]*><\/i> צלם תעודת זיכוי נוספת</);
  assert.deepEqual(await typeMinus(k.c, '-25.00', '5'), ['amount']);
  assert.deepEqual(k.c.toasts, ['סכום עם מינוס הוא זיכוי. זיכוי מהנהג מצלמים בכפתור הירוק "צלם תעודת זיכוי נוספת" — כאן מקלידים רק תעודות משלוח.']);
  assert.deepEqual(json(k.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  // Only the units carry the minus: the units field is named and focused.
  const m = setup();
  m.c.run('renderReceiving()');
  await m.c.click('rc-photo-manual');
  assert.deepEqual(await typeMinus(m.c, '83.52', '-24', 'rc-open'), ['units']);
  assert.deepEqual(m.c.toasts, ['יחידות עם מינוס הן זיכוי. זיכוי מהנהג מצלמים בכפתור הירוק "הנהג הביא זיכוי על חוסר? צלם כאן" — כאן מקלידים רק תעודות משלוח.']);
  assert.deepEqual(json(m.c, 'receiptNotes'), []);
});

// ---- the final review round: the two medium findings, and the two low ones that touch money ----

// A real second delivery note: 30 milk = ₪150.00 / 30 units. One read typed it "credit" (edge case 22); read as a credit it is positive.
const thirty = (type = 'delivery') => ({ ...delivery({ number: '9073800002', type }), subtotalExVat: 150, vatAmount: 27, totalInclVat: 177,
  printedUnits: 30, printedLines: 1, rows: [line(MILK, 30, 150)] });
const thirtyPapers = { 'delivery.jpg': twice(delivery), 'second.jpg': ({ credit }) => credit ? [thirty(), thirty()] : [thirty(), thirty('credit')] };
const BOTH_TYPED = [{ amount: 217.04, units: 58 }, { amount: 150, units: 30 }];
const UNMOVE_TYPED_CONFIRM = ['להחזיר לתעודות?', 'תעודה 2 תחזור לרשימת התעודות כתעודת משלוח, והזיכוי יוסר. הקריאה שכבר נעשתה נשמרת — אין קריאה נוספת. ' +
  'השורה שהוקלדה לה (₪150.00 · 30 יח׳) חוזרת לסכום התעודות.', 'החזר לתעודות'];
const UNMOVE_TYPED_TOAST = 'תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה. השורה שהוקלדה לה (₪150.00 · 30 יח׳) חזרה לסכום התעודות.';

test('w19: typed anchors — a mistaken move of a real delivery note drops its typed line, and the free way back puts the line back, so the receipt saves as typed (photo-first, after a reload, and the classic typed receipt)', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: thirtyPapers });
  await gate(c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(c, [['217.04', '58'], ['150', '30']]);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.notCredit], ['error', true], 'the credit read found positive amounts');
  assert.deepEqual(credit.origin.typedNote, { index: 1, amount: 150, units: 30, inStep: false, left: [{ amount: 217.04, units: 58 }] },
    'the dropped line is kept on the credit (and in the draft), with the typed lines the move left');
  // After a reload (photos gone) the way back is paper-only, and the line still comes back.
  const r = runtime('yotvata', { data, storage: c.storage });
  service(r, { papers: thirtyPapers });
  r.run("confirmLog = []; showConfirm = (t, x, l, fn) => { confirmLog.push([t, x, l]); fn(); }; mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  await r.click('delivery-credit-unmove', credit.id);
  assert.deepEqual(json(r, 'confirmLog').at(-1), UNMOVE_TYPED_CONFIRM);
  assert.deepEqual(json(r, 'receiptNotes'), BOTH_TYPED);
  assert.equal(r.run('receiptDeliveryCredits.length'), 0);
  invariants(r);
  // The same device: the confirm and the toast say the line comes back; the receipt saves as typed.
  c.toasts.length = 0;
  await c.click('delivery-credit-unmove', credit.id);
  assert.deepEqual(json(c, 'confirmLog').at(-1), UNMOVE_TYPED_CONFIRM);
  assert.ok(c.toasts.includes(UNMOVE_TYPED_TOAST), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptNotes'), BOTH_TYPED);
  assert.equal(c.run('receiptNoteTotal'), 367.04);
  count(c, 48, 40);
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 367.04, BOTH_TYPED]);
  assert.equal(s.stats.modelCalls, 6, 'the mistaken tap cost one credit read; the way back costs nothing');
  invariants(c);
  // Classic: typed 217.04/58 and 150/30, "סרוק את התעודות" + "פענח" in the comparison — AI document i is typed line i.
  const k = setup();
  service(k.c, { papers: thirtyPapers });
  k.c.run('renderReceiving()');
  await k.c.click('rc-photo-manual');
  k.c.node('rcNoteInput').value = '217.04'; k.c.node('rcNoteUnits').value = '58'; await k.c.click('rc-note-add');
  k.c.node('rcNoteInput').value = '150'; k.c.node('rcNoteUnits').value = '30'; await k.c.click('rc-open'); await flush(k.c, 5);
  count(k.c, 47, 40); // one yogurt short, so the finish opens the comparison
  pressCart(k.c); await flush(k.c, 10);
  assert.equal(k.c.run('currentView'), 'reconcile');
  await k.c.click('ai-rescan'); await flush(k.c);
  await photograph(k.c, 0, ['delivery.jpg']); await photograph(k.c, 1, ['second.jpg']);
  await k.c.click('ai-run'); await flush(k.c);
  assert.deepEqual(json(k.c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  k.c.run("currentView = 'receiving'; renderReceiving()");
  await k.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(k.c, 1) }); await flush(k.c);
  assert.deepEqual(json(k.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.equal(credit0(k.c).origin.typedNote.inStep, true);
  k.c.toasts.length = 0;
  await k.c.click('delivery-credit-unmove', credit0(k.c).id);
  assert.ok(k.c.toasts.includes(UNMOVE_TYPED_TOAST), k.c.toasts.join(' | '));
  assert.deepEqual(json(k.c, 'receiptNotes'), BOTH_TYPED);
  assert.deepEqual(json(k.c, 'aiScanDocuments.map(d => [d.amount, d.units])'), [[217.04, 58], [150, 30]], 'AI documents and typed lines are in step again');
  count(k.c, 48, 40); // everything on both papers arrived
  pressCart(k.c); await flush(k.c, 10);
  if (k.c.run('currentView') === 'reconcile') k.c.run('aiApplyInvoiceResult(); saveReconciledReceipt({ skipChecked: true })');
  const kp = json(k.c, 'pendingReceipt');
  assert.deepEqual([kp.status, kp.ex, kp.noteParts], ['ok', 367.04, BOTH_TYPED]);
  invariants(k.c);
});

test('w20: a 2-page invoice whose return line is alone on page 2 and whose rows miss the printed summary (a price 1 agora off, the discount read with a minus, a deposit with no row) is one invoice — no split, no hold, in the money view as v393 (v151 and v150); a read that types it "credit" still offers the split', async () => {
  const base = withReturnLine({ pageCount: 2, returnPage: 2 });
  const shapes = {
    'one price 1 agora off': { ...base, rows: [line(YOGURT, 48, 167.03), ...base.rows.slice(1)] },
    'the discount read with a minus': { ...base, subtotalExVat: 202.04, vatAmount: 36.37, totalInclVat: 238.41, documentDiscountExVat: -5 },
    'a deposit with no row': { ...base, subtotalExVat: 214.24, vatAmount: 38.56, totalInclVat: 252.8 },
  };
  for (const [name, paper] of Object.entries(shapes)) for (const version of [151, 150]) {
    const label = name + ' (v' + version + ')';
    const { c } = setup();
    const s = service(c, { version, papers: { 'inv-p1.jpg+inv-p2.jpg': twice(() => structuredClone(paper)) } });
    c.run('renderReceiving()');
    await photograph(c, 0, ['inv-p1.jpg', 'inv-p2.jpg'], { gallery: true });
    await c.click('rc-photo-start'); await flush(c);
    const signals = json(c, 'yotvataPaperCreditSignals(aiScanDocuments[0].scanResult.doc, 2)');
    assert.deepEqual([signals.pageSplit, signals.signal], [null, false], label);
    assert.deepEqual(json(c, 'yotvataHeldDocuments()'), [], label);
    assert.equal(c.run('aiScanResponse.scan.documents.length'), 1, label + ': in the money view, as in v393');
    assert.ok(json(c, 'receiptPaperScanProblems').includes(RETURN_LINE_PROBLEM), label + ': ' + json(c, 'receiptPaperScanProblems').join(' | '));
    assert.equal(s.stats.modelCalls, 2, label + ': no split, no credit read, no re-read');
    invariants(c);
  }
  // A read that typed the same paper "credit" is evidence of a second paper: held, and the split is offered (as for test h).
  const t = setup();
  service(t.c, { papers: { 'inv-p1.jpg+inv-p2.jpg': () => [structuredClone(shapes['one price 1 agora off']), { ...structuredClone(shapes['one price 1 agora off']), documentType: 'credit' }] } });
  t.c.run('renderReceiving()');
  await photograph(t.c, 0, ['inv-p1.jpg', 'inv-p2.jpg'], { gallery: true });
  await t.c.click('rc-photo-start'); await flush(t.c);
  assert.equal(t.c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-split');
  invariants(t.c);
});

test('w21: typed anchors — moving the slip never removes the typed line of another delivery note that has the same amount and units; the credit closes its own shortage', async () => {
  const { c } = setup();
  // A second delivery note: one tray of 24 yogurt = ₪83.52 / 24 units — the slip's amount and units.
  const tray = () => ({ ...delivery({ number: '9073800003' }), subtotalExVat: 83.52, vatAmount: 15.03, totalInclVat: 98.55, printedUnits: 24, printedLines: 1, rows: [line(YOGURT, 24, 83.52)] });
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'tray.jpg': twice(tray), 'slip.jpg': ({ credit }) => credit ? [VARIANT.CREDIT(), VARIANT.CREDIT()] : [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'tray.jpg', 'slip.jpg']);
  assert.deepEqual(json(c, 'yotvataHeldDocuments().map(x => x.index)'), [2]);
  await typeNotes(c, [['217.04', '58'], ['83.52', '24']]); // the two delivery notes; the slip is no delivery note
  c.toasts.length = 0;
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 2) }); await flush(c);
  assert.ok(c.toasts.includes('תעודה 3 הועברה לזיכויים ונקראת עכשיו כזיכוי.'), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }, { amount: 83.52, units: 24 }], 'the tray\'s typed line stays');
  assert.equal(credit0(c).origin.typedNote, undefined);
  assert.equal(credit0(c).status, 'confirmed');
  count(c, 48, 10); // 72 yogurt billed; the slip credits the 24 missing
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts.length, p.shortCreditNotes.map(n => n.number)], ['ok', 217.04, 2, [SLIP_NUMBER]]);
  assert.equal(s.stats.modelCalls, 8);
  invariants(c);
});

test('w22: a credit whose own credit-mode read saw the minus but failed another check (the units, or a summary whose minus was dropped) offers no way back to the documents — the dropped-sign read is never billed as goods', async () => {
  const reads = {
    units: () => slip({ qty: -24, printedUnits: 25 }),
    'summary without its minus': () => ({ ...slip({ qty: -24, printedUnits: 24 }), subtotalExVat: 83.52, vatAmount: 15.03, totalInclVat: 98.55 }),
  };
  for (const [name, read] of Object.entries(reads)) {
    const { c, data } = setup();
    const s = service(c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit ? [read(), read()] : [VARIANT.C(), VARIANT.C()] } });
    await gate(c, ['delivery.jpg', 'slip.jpg']);
    await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
    const credit = credit0(c);
    assert.deepEqual([credit.status, credit.errorKind, credit.readAs, credit.notCredit], ['error', 'paper', 'credit', false], name + ': not "a regular delivery note"');
    const html = c.run('deliveryCreditsHtml()');
    assert.doesNotMatch(html, /delivery-credit-unmove/, name + ': no way back to the documents');
    assert.doesNotMatch(html, /נראה שזו תעודת משלוח רגילה/, name);
    assert.match(html, /data-role="delivery-credit-retake"/, name);
    assert.match(html, /data-role="delivery-credit-remove"/, name);
    c.run('confirmLog = []');
    await c.click('delivery-credit-unmove', credit.id); // a forged or stale tap
    assert.deepEqual(json(c, 'confirmLog'), [], name);
    assert.equal(c.run('aiScanDocuments.length'), 1, name);
    assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], name + ': the slip is not a second delivery note');
    const r = runtime('yotvata', { data, storage: c.storage });
    r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
    assert.doesNotMatch(r.run('deliveryCreditsHtml()'), /delivery-credit-unmove/, name + ': not after a reload either');
    assert.equal(s.stats.modelCalls, 6, name);
    invariants(c); invariants(r);
  }
});

// ---- convergence round 1 (each test pins one finding; all fail on e28aeda) ----

// The same real second delivery note (30 milk = ₪150.00 / 30), its own paper check failing for an ordinary reason.
const thirtyNoUnits = (type = 'delivery') => ({ ...thirty(type), printedUnits: null });
const thirtyAgora = (type = 'delivery') => ({ ...thirty(type), rows: [line(MILK, 30, 150.01)] });
const papersOf = paper => ({ 'delivery.jpg': twice(delivery), 'second.jpg': ({ credit }) => credit ? [paper(), paper()] : [paper(), paper('credit')] });

test('w23: a real second delivery note that one read typed "credit" and whose own paper check fails for an ordinary reason (printed units not read, a row 1 agora off) can be kept — typed anchors save as typed; from the photo its problems are named until the anchors are typed; after a mistaken move the free way back keeps it', async () => {
  for (const [name, paper] of Object.entries({ 'units not read': thirtyNoUnits, 'a row 1 agora off': thirtyAgora })) {
    // Typed anchors (photo-first, "או הקלד סכום ויחידות").
    const { c } = setup();
    const s = service(c, { papers: papersOf(paper) });
    await gate(c, ['delivery.jpg', 'second.jpg']);
    assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read', name);
    assert.equal(c.run('yotvataPaperCheck(aiScanDocuments[1].scanResult.doc, 1).ok'), false, name);
    assert.match(cardOf(c, 1), /data-role="rc-credit-doc-keep"[^>]*>לא, זו תעודת משלוח רגילה</, name + ': the keep is offered');
    await typeNotes(c, [['217.04', '58'], ['150', '30']]);
    c.run('confirmLog = []');
    await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
    assert.deepEqual(json(c, 'confirmLog'), [], name + ': no credit title, nothing to confirm');
    assert.deepEqual(json(c, 'yotvataHeldDocuments()'), [], name);
    assert.deepEqual(json(c, 'receiptNotes'), BOTH_TYPED, name + ': the line typed for it stays');
    count(c, 48, 40);
    const p = finish(c);
    assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 367.04, BOTH_TYPED], name);
    assert.equal(s.stats.modelCalls, 4, name + ': the keep costs nothing');
    invariants(c);
    // From the photo alone: kept, in the money view, its own problems named — never "read and verified" without it.
    const f = setup();
    service(f.c, { papers: papersOf(paper) });
    await gate(f.c, ['delivery.jpg', 'second.jpg']);
    await f.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(f.c, 1) });
    assert.equal(f.c.run('aiScanResponse.scan.documents.length'), 2, name);
    assert.equal(f.c.run('receiptPaperScanState'), 'failed', name);
    assert.ok(json(f.c, 'receiptPaperScanProblems').every(p => p.startsWith('תעודה 2: ')), name + ': ' + json(f.c, 'receiptPaperScanProblems').join(' | '));
    pressCart(f.c); await flush(f.c, 10);
    assert.equal(f.c.run('currentView'), 'receiving', name + ': no finish before the anchors are complete (as v393)');
    await typeNotes(f.c, [['217.04', '58'], ['150', '30']]);
    count(f.c, 48, 40);
    const fp = finish(f.c);
    assert.deepEqual([fp.status, fp.ex, fp.noteParts], ['ok', 367.04, BOTH_TYPED], name);
    invariants(f.c);
  }
  // A mistaken "העבר וקרא כזיכוי": the credit read is positive; the free way back puts the line back, and the note is kept, not held again.
  const m = setup();
  const ms = service(m.c, { papers: papersOf(thirtyNoUnits) });
  await gate(m.c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(m.c, [['217.04', '58'], ['150', '30']]);
  await m.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(m.c, 1) }); await flush(m.c);
  assert.deepEqual([credit0(m.c).notCredit, credit0(m.c).origin.creditRead], [true, 'no-minus']);
  await m.c.click('delivery-credit-unmove', credit0(m.c).id);
  assert.deepEqual(json(m.c, 'yotvataHeldDocuments()'), [], 'kept, not held again');
  assert.deepEqual(json(m.c, 'receiptNotes'), BOTH_TYPED);
  count(m.c, 48, 40);
  const mp = finish(m.c);
  assert.deepEqual([mp.status, mp.ex, mp.noteParts], ['ok', 367.04, BOTH_TYPED]);
  assert.equal(ms.stats.modelCalls, 6, 'the mistaken tap cost one credit read; the way back costs nothing');
  invariants(m.c);
});

test('w24: typed anchors — the worker types the moved note\'s line again before the free way back: the line does not come back a second time, the confirm and the toast say why, and the receipt saves as typed (photo-first and the classic typed receipt); two moves undone in either order each put their own line back once', async () => {
  const CHANGED_CONFIRM = ' השורות שהוקלדו השתנו מאז ההעברה לזיכויים, ולכן השורה שהוקלדה לה (₪150.00 · 30 יח׳) לא תחזור לבד — בדוק את סכום התעודות.';
  const CHANGED_TOAST = 'תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה. השורות שהוקלדו השתנו מאז ההעברה לזיכויים, ולכן השורה שהוקלדה לה (₪150.00 · 30 יח׳) לא הוחזרה — בדוק את סכום התעודות.';
  const retype = async c => {
    await c.click('rc-notes-edit'); await flush(c, 3);
    c.node('rcNoteInput').value = '150'; c.node('rcNoteUnits').value = '30'; await c.click('rc-note-add');
    c.node('rcNoteInput').value = ''; c.node('rcNoteUnits').value = '';
    await c.click('rc-notes-done'); await flush(c);
    assert.deepEqual(json(c, 'receiptNotes'), BOTH_TYPED, 'the worker typed the line again');
  };
  const { c } = setup();
  const s = service(c, { papers: thirtyPapers });
  await gate(c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(c, [['217.04', '58'], ['150', '30']]);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  await retype(c);
  c.toasts.length = 0;
  await c.click('delivery-credit-unmove', credit0(c).id);
  assert.ok(json(c, 'confirmLog').at(-1)[1].endsWith(CHANGED_CONFIRM), json(c, 'confirmLog').at(-1)[1]);
  assert.ok(c.toasts.includes(CHANGED_TOAST), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptNotes'), BOTH_TYPED, 'not 517.04: the line is not counted twice');
  count(c, 48, 40);
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 367.04, BOTH_TYPED]);
  assert.equal(s.stats.modelCalls, 6);
  invariants(c);
  // Classic: typed lines first, "סרוק את התעודות" + "פענח" in the comparison, then the card.
  const k = setup();
  service(k.c, { papers: thirtyPapers });
  k.c.run('renderReceiving()');
  await k.c.click('rc-photo-manual');
  k.c.node('rcNoteInput').value = '217.04'; k.c.node('rcNoteUnits').value = '58'; await k.c.click('rc-note-add');
  k.c.node('rcNoteInput').value = '150'; k.c.node('rcNoteUnits').value = '30'; await k.c.click('rc-open'); await flush(k.c, 5);
  count(k.c, 47, 40);
  pressCart(k.c); await flush(k.c, 10);
  await k.c.click('ai-rescan'); await flush(k.c);
  await photograph(k.c, 0, ['delivery.jpg']); await photograph(k.c, 1, ['second.jpg']);
  await k.c.click('ai-run'); await flush(k.c);
  k.c.run("currentView = 'receiving'; renderReceiving()");
  await k.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(k.c, 1) }); await flush(k.c);
  assert.equal(credit0(k.c).origin.typedNote.inStep, true);
  await retype(k.c);
  k.c.toasts.length = 0;
  await k.c.click('delivery-credit-unmove', credit0(k.c).id);
  assert.ok(k.c.toasts.includes(CHANGED_TOAST), k.c.toasts.join(' | '));
  assert.deepEqual(json(k.c, 'receiptNotes'), BOTH_TYPED);
  count(k.c, 48, 40);
  pressCart(k.c); await flush(k.c, 10);
  if (k.c.run('currentView') === 'reconcile') k.c.run('aiApplyInvoiceResult(); saveReconciledReceipt({ skipChecked: true })');
  const kp = json(k.c, 'pendingReceipt');
  assert.deepEqual([kp.status, kp.ex, kp.noteParts], ['ok', 367.04, BOTH_TYPED]);
  invariants(k.c);
  // Only the worker's edits count: two moves (the slip, then the real note by mistake) undone in either order — each
  // line comes back once, beside its document, after a reload too.
  const THREE = [{ amount: 217.04, units: 58 }, { amount: 150, units: 30 }, { amount: 83.52, units: 24 }];
  for (const order of [[3, 2], [2, 3]]) {
    const t = setup();
    service(t.c, { papers: { ...thirtyPapers, 'slip.jpg': twice(VARIANT.A) } });
    t.c.run('renderReceiving()');
    await t.c.click('rc-photo-manual');
    for (const [a, u] of [['217.04', '58'], ['150', '30']]) { t.c.node('rcNoteInput').value = a; t.c.node('rcNoteUnits').value = u; await t.c.click('rc-note-add'); }
    t.c.node('rcNoteInput').value = '83.52'; t.c.node('rcNoteUnits').value = '24'; await t.c.click('rc-open'); await flush(t.c, 5);
    count(t.c, 23, 40);
    pressCart(t.c); await flush(t.c, 10);
    await t.c.click('ai-rescan'); await flush(t.c);
    await photograph(t.c, 0, ['delivery.jpg']); await photograph(t.c, 1, ['second.jpg']); await photograph(t.c, 2, ['slip.jpg']);
    await t.c.click('ai-run'); await flush(t.c);
    t.c.run("currentView = 'receiving'; renderReceiving()");
    await t.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(t.c, 2) }); await flush(t.c);
    await t.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(t.c, 1) }); await flush(t.c);
    assert.deepEqual(json(t.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], 'both lines left with their papers');
    const r = runtime('yotvata', { data: t.data, storage: t.c.storage });
    service(r, { papers: { ...thirtyPapers, 'slip.jpg': twice(VARIANT.A) } });
    r.run("confirmLog = []; showConfirm = (t, x, l, fn) => { confirmLog.push([t, x, l]); fn(); }; mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
    for (const n of order) {
      r.toasts.length = 0;
      await r.click('delivery-credit-unmove', r.run(`receiptDeliveryCredits.find(x => x.origin.docNumber === ${n}).id`)); await flush(r, 5);
      assert.ok(r.toasts.some(x => /חזרה לסכום התעודות\.$/.test(x)), 'order ' + order + ': ' + r.toasts.join(' | '));
    }
    assert.deepEqual(json(r, 'receiptNotes'), THREE, 'order ' + order + ': each line once');
    assert.deepEqual(json(r, 'aiScanDocuments.map(d => d.amount)'), [217.04, 150, 83.52], 'order ' + order + ': AI documents and typed lines in step');
    invariants(r);
  }
});

test('w25: once a credit-mode read of the paper saw the minus, the way back stays closed — after "צלם את הזיכוי מחדש" (waiting for its check), after a retake read that fails, after one that drops the minus, and after a reload', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery),
    'slip.jpg': ({ credit }) => credit ? [slip({ qty: -24, printedUnits: 25 }), slip({ qty: -24, printedUnits: 25 })] : [VARIANT.C(), VARIANT.C()],
    'slip-again.jpg': () => { throw new TypeError('Load failed'); }, 'slip-third.jpg': () => [VARIANT.C(), VARIANT.C()] } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  const id = credit0(c).id;
  assert.deepEqual([credit0(c).status, credit0(c).readAs, credit0(c).notCredit], ['error', 'credit', false], 'the credit read saw the minus (the units failed)');
  const closed = async label => {
    const html = c.run('deliveryCreditsHtml()');
    assert.doesNotMatch(html, /delivery-credit-unmove/, label);
    assert.doesNotMatch(html, /נראה שזו תעודת משלוח רגילה/, label);
    c.run('confirmLog = []');
    await c.click('delivery-credit-unmove', id);
    assert.deepEqual(json(c, 'confirmLog'), [], label + ': a forged or stale tap does nothing');
    assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 217.04, units: 58 }], label + ': the slip is never a second delivery note');
  };
  // "צלם את הזיכוי מחדש": the new photo waits for "בדוק ואשר את הצילום".
  const retake = name => c.events.get('app:change')({ target: { id: 'creditRetake_' + id, dataset: { role: 'delivery-credit-file', id, replace: '1' }, files: [{ name }], value: 'x' } });
  retake('slip-again.jpg');
  await flush(c, 10);
  assert.equal(credit0(c).status, 'capture');
  await closed('waiting for the check of the retake');
  // The retake read ends on the network.
  if (c.run('!aiOrientationSession')) c.run('deliveryCreditOpenPage(' + JSON.stringify(id) + ', 0)');
  // not awaited: a read that ends on the network waits for the harness' parked retry timers (flush runs them)
  const confirmed = c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
  await flush(c); await confirmed;
  assert.equal(credit0(c).status, 'error');
  await closed('after a retake read that failed');
  // Another retake whose read drops the minus says "positive", but the paper is the one that was read with its minus.
  retake('slip-third.jpg'); await flush(c, 10);
  if (c.run('!aiOrientationSession')) c.run('deliveryCreditOpenPage(' + JSON.stringify(id) + ', 0)');
  const third = c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
  await flush(c); await third;
  assert.equal(credit0(c).notCredit, true);
  await closed('after a retake read that dropped the minus');
  assert.equal(credit0(c).origin.creditRead, 'credit', 'what the credit reads saw is on the origin, not on the paper state');
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.doesNotMatch(r.run('deliveryCreditsHtml()'), /delivery-credit-unmove/, 'not after a reload either');
  invariants(c); invariants(r);
  assert.ok(s.stats.modelCalls >= 6);
  // A credit read that failed saw nothing: the way back stays — and its confirm names the credit title, as "לא, זו תעודת משלוח רגילה" does.
  const n = setup();
  service(n.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => { if (credit) throw new TypeError('Load failed'); return [VARIANT.C(), VARIANT.C()]; } } });
  await gate(n.c, ['delivery.jpg', 'slip.jpg']);
  const moved = n.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(n.c, 1) }); await flush(n.c); await moved;
  assert.equal(credit0(n.c).origin.creditRead, undefined);
  await n.c.click('delivery-credit-unmove', credit0(n.c).id);
  assert.deepEqual(json(n.c, 'confirmLog').at(-1), ['להחזיר לתעודות?', 'תעודה 2 תחזור לרשימת התעודות כתעודת משלוח, והזיכוי יוסר. הקריאה שכבר נעשתה נשמרת — אין קריאה נוספת. ' +
    'כל הקריאות סימנו אותה כתעודת זיכוי («' + SLIP_TITLE + '»). אם תאשר, הסכום שלה (₪83.52 לפני מע״מ · 24 יח׳) ייכנס לתעודות כסחורה שהתקבלה.', 'החזר לתעודות']);
  invariants(n.c);
});

test('w26: drafts written by earlier v394 builds — a moved credit whose credit-mode read is not on record offers no way back; one whose read was positive still does; a hold line of a document that is no longer held becomes that document\'s own problems; nothing is read', async () => {
  const KEY = c => c.run('RECEIPT_DRAFT_KEY');
  const reopen = async (c, data, edit) => {
    const draft = JSON.parse(c.storage.get(KEY(c)));
    edit(draft);
    const storage = new Map(c.storage); storage.set(KEY(c), JSON.stringify(draft));
    const r = runtime('yotvata', { data, storage });
    r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
    return r;
  };
  // (Y) The credit-mode read had negative rows under a summary whose minus was dropped; the old build saved notCredit and nothing else.
  const y = setup();
  service(y.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': ({ credit }) => credit
    ? [{ ...slip({ qty: -24, printedUnits: 24 }), subtotalExVat: 83.52, vatAmount: 15.03, totalInclVat: 98.55 }, { ...slip({ qty: -24, printedUnits: 24 }), subtotalExVat: 83.52, vatAmount: 15.03, totalInclVat: 98.55 }]
    : [VARIANT.C(), VARIANT.C()] } });
  await gate(y.c, ['delivery.jpg', 'slip.jpg']);
  await y.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(y.c, 1) }); await flush(y.c);
  const old = await reopen(y.c, y.data, d => { const x = d.deliveryCredits[0]; delete x.origin.creditRead; delete x.creditReadSigns; x.notCredit = true; });
  assert.doesNotMatch(old.run('deliveryCreditsHtml()'), /delivery-credit-unmove|נראה שזו תעודת משלוח רגילה/);
  assert.match(old.run('deliveryCreditsHtml()'), /data-role="delivery-credit-retake"/);
  assert.equal(json(old, 'receiptDeliveryCredits[0].origin.creditRead'), 'credit');
  assert.equal(old.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  invariants(old);
  // The build before that recorded what the credit read saw (creditReadSigns): a positive read keeps the way back, a negative one does not.
  const t = setup();
  service(t.c, { papers: thirtyPapers });
  await gate(t.c, ['delivery.jpg', 'second.jpg']);
  await t.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(t.c, 1) }); await flush(t.c);
  for (const [signs, open] of [['as_printed', true], ['negative', false]]) {
    const r = await reopen(t.c, t.data, d => { const x = d.deliveryCredits[0]; delete x.origin.creditRead; x.creditReadSigns = signs; x.notCredit = signs === 'as_printed'; });
    assert.equal(/delivery-credit-unmove/.test(r.run('deliveryCreditsHtml()')), open, signs);
  }
  // (X) A 2-page invoice whose return line is alone on page 2, one price 1 agora off: an earlier build held it; this one does not.
  const x = setup();
  const base = withReturnLine({ pageCount: 2, returnPage: 2 });
  service(x.c, { papers: { 'inv-p1.jpg+inv-p2.jpg': twice(() => ({ ...structuredClone(base), rows: [line(YOGURT, 48, 167.03), ...structuredClone(base.rows.slice(1))] })) } });
  x.c.run('renderReceiving()');
  await photograph(x.c, 0, ['inv-p1.jpg', 'inv-p2.jpg'], { gallery: true });
  await x.c.click('rc-photo-start'); await flush(x.c);
  const now = json(x.c, 'receiptPaperScanProblems');
  const held = await reopen(x.c, x.data, d => { d.paperProblems = ['תעודה 1 נראית כמו תעודת זיכוי — ההחלטה בכרטיס שמתחת.']; });
  assert.deepEqual(json(held, 'yotvataHeldDocuments()'), []);
  assert.deepEqual(json(held, 'receiptPaperScanProblems'), now, 'the problems this build says for the same read');
  assert.ok(now.includes(RETURN_LINE_PROBLEM), now.join(' | '));
  assert.equal(held.requests.filter(q => q.url.endsWith('/scan')).length, 0);
  invariants(held);
});

test('w27: "לא, זו תעודת משלוח רגילה" is a decision, not a read — the saved aiAudit counts the reads that happened, as v393 does for the same papers', async () => {
  const second = (type = 'delivery') => delivery({ number: '9073800002', type });
  const attempts = async typedCredit => {
    const { c } = setup();
    service(c, { papers: { 'delivery.jpg': twice(delivery), 'second.jpg': () => [second(), second(typedCredit ? 'credit' : 'delivery')] } });
    await gate(c, ['delivery.jpg', 'second.jpg']);
    if (typedCredit) await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
    assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
    count(c, 95, 20); // one yogurt short, so the comparison builds the audit
    pressCart(c); await flush(c, 10);
    assert.equal(c.run('currentView'), 'reconcile');
    c.run('aiApplyInvoiceResult(); saveReconciledReceipt({ skipChecked: true })');
    invariants(c);
    return json(c, 'pendingReceipt.aiAudit.attempts');
  };
  assert.equal(await attempts(true), await attempts(false));
  assert.equal(await attempts(true), 2);
});

// ---- convergence round 2 (each test pins one finding; all fail on dfeb839) ----

// A tax invoice with a store return line whose yogurt row was read 1 agora off (167.03; printed 167.04): its rows sum to
// 207.03 under the printed 207.04 — positive, so an invoice, not a credit whose summary minus was dropped.
const agoraReturnLine = (type = 'delivery') => ({ ...withReturnLine({ type }), invoiceNumber: '9073800002',
  rows: [line(YOGURT, 48, 167.03), line(MILK, 10, 50), { ...line(MILK, -2, -10), description: 'החזרה חלב בדיקה' }] });
const agoraPapers = { 'delivery.jpg': twice(delivery), 'invoice.jpg': ({ credit }) => credit ? [agoraReturnLine(), agoraReturnLine()] : [agoraReturnLine(), agoraReturnLine('credit')] };
const AGORA_TYPED = [{ amount: 217.04, units: 58 }, { amount: 207.04, units: 56 }];

test('w28: an invoice with a return line, one row read 1 agora off, that one read typed "credit" — "לא, זו תעודת משלוח רגילה" is offered and kept; a mistaken "העבר וקרא כזיכוי" finds a positive invoice and the free way back keeps it; typed anchors save as typed', async () => {
  const { c } = setup();
  const s = service(c, { papers: agoraPapers });
  await gate(c, ['delivery.jpg', 'invoice.jpg']);
  const signals = json(c, 'yotvataPaperCreditSignals(aiScanDocuments[1].scanResult.doc, 1)');
  assert.deepEqual([signals.signs, signals.rowsClose, signals.pageSplit], ['mixed', false, null]);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.match(cardOf(c, 1), /data-role="rc-credit-doc-keep"[^>]*>לא, זו תעודת משלוח רגילה</, 'the keep is offered');
  await typeNotes(c, [['217.04', '58'], ['207.04', '56']]);
  await c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(c, 1) });
  assert.deepEqual(json(c, 'yotvataHeldDocuments()'), []);
  assert.deepEqual(json(c, 'receiptNotes'), AGORA_TYPED, 'the line typed for it stays');
  count(c, 96, 18);
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 424.08, AGORA_TYPED]);
  assert.equal(s.stats.modelCalls, 4, 'the keep costs nothing');
  invariants(c);
  // From the photo alone: kept, in the money view, its own problems named (as v393).
  const f = setup();
  service(f.c, { papers: agoraPapers });
  await gate(f.c, ['delivery.jpg', 'invoice.jpg']);
  await f.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(f.c, 1) });
  assert.equal(f.c.run('aiScanResponse.scan.documents.length'), 2);
  assert.ok(json(f.c, 'receiptPaperScanProblems').some(x => x.startsWith('תעודה 2: בשורה 3 נקרא סכום שלילי')), json(f.c, 'receiptPaperScanProblems').join(' | '));
  invariants(f.c);
  // The mistaken tap (typed anchors): the credit read is the same positive invoice — the way back is open and keeps it.
  const m = setup();
  const ms = service(m.c, { papers: agoraPapers });
  await gate(m.c, ['delivery.jpg', 'invoice.jpg']);
  await typeNotes(m.c, [['217.04', '58'], ['207.04', '56']]);
  await m.c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(m.c, 1) }); await flush(m.c);
  assert.deepEqual([credit0(m.c).status, credit0(m.c).notCredit, credit0(m.c).origin.creditRead], ['error', true, 'no-minus']);
  assert.match(m.c.run('deliveryCreditsHtml()'), /<button data-role="delivery-credit-unmove"[^>]*class="btn-tap w-full bg-emerald-600[^>]*>זו תעודה רגילה — החזר לתעודות</);
  await m.c.click('delivery-credit-unmove', credit0(m.c).id);
  assert.deepEqual(json(m.c, 'yotvataHeldDocuments()'), [], 'kept, not held again');
  assert.deepEqual(json(m.c, 'receiptNotes'), AGORA_TYPED);
  count(m.c, 96, 18);
  const mp = finish(m.c);
  assert.deepEqual([mp.status, mp.ex, mp.noteParts], ['ok', 424.08, AGORA_TYPED]);
  assert.equal(ms.stats.modelCalls, 6, 'the mistaken tap cost one credit read; the way back costs nothing');
  invariants(m.c);
  // Two papers picked together from the gallery (test h): their rows sum positive too, but the pages split by sign —
  // still no keep, the split stays the decision.
  const h = setup();
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  service(h.c, { papers: { 'delivery-p.jpg+slip-p.jpg': twice(mixed) } });
  h.c.run('renderReceiving()');
  await photograph(h.c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await h.c.click('rc-photo-start'); await flush(h.c);
  assert.equal(h.c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-split');
  assert.doesNotMatch(cardOf(h.c, 0), /rc-credit-doc-keep/);
  await h.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(h.c, 0) });
  assert.deepEqual(json(h.c, 'yotvataHeldDocuments().map(x => x.index)'), [0], 'a keep that is not offered changes nothing');
  invariants(h.c);
  // A credit whose summary minus was dropped still reads as a credit: its rows sum negative.
  assert.equal(c.run(`yotvataPositiveRead(${JSON.stringify({ ...slip({ qty: -24 }), subtotalExVat: 83.52 })})`), false);
  assert.equal(c.run(`yotvataPositiveRead(${JSON.stringify(agoraReturnLine())})`), true);
});

test('w29: typed anchors — a real delivery note that comes into the documents with no typed line ("החזר לתעודות" of a move made before the amounts were typed, or "לא, זו תעודת משלוח רגילה") enters the paper total too, and the confirm and the toast say so; a read whose paper check fails asks for the line instead', async () => {
  const ADDED = ' השורה שלה (₪150.00 · 30 יח׳) נוספה לסכום התעודות.';
  // The mistaken move first, then the typing (the paper box asks for it: the invoice's return line fails its paper
  // check, as in v393), then the way back.
  const RETURN_TYPED = [{ amount: 207.04, units: 56 }, { amount: 150, units: 30 }];
  const { c } = setup();
  const s = service(c, { papers: { 'invoice.jpg': twice(withReturnLine), 'second.jpg': thirtyPapers['second.jpg'] } });
  await gate(c, ['invoice.jpg', 'second.jpg']);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  assert.equal(credit0(c).origin.typedNote, undefined, 'nothing was typed when it moved');
  assert.deepEqual([c.run('receiptPaperScanState'), json(c, 'receiptNotes')], ['failed', []]);
  await typeNotes(c, [['207.04', '56']]);
  c.toasts.length = 0;
  await c.click('delivery-credit-unmove', credit0(c).id);
  assert.ok(json(c, 'confirmLog').at(-1)[1].endsWith(' השורה שלה (₪150.00 · 30 יח׳) תתווסף לסכום התעודות.'), json(c, 'confirmLog').at(-1)[1]);
  assert.ok(c.toasts.includes('תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה.' + ADDED), c.toasts.join(' | '));
  assert.deepEqual(json(c, 'receiptNotes'), RETURN_TYPED);
  count(c, 48, 38); // 10 milk on the invoice less the 2 the store returned, and 30 on the second note
  const p = finish(c);
  assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 357.04, RETURN_TYPED]);
  assert.equal(s.stats.modelCalls, 6);
  invariants(c);
  // The keep, with only the other paper typed.
  const k = setup();
  service(k.c, { papers: thirtyPapers });
  await gate(k.c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(k.c, [['217.04', '58']]);
  k.c.toasts.length = 0;
  await k.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(k.c, 1) });
  assert.ok(k.c.toasts.includes('תעודה 2 נקלטת כתעודת משלוח, לפי ההחלטה שלך.' + ADDED), k.c.toasts.join(' | '));
  assert.deepEqual(json(k.c, 'receiptNotes'), BOTH_TYPED);
  count(k.c, 48, 40);
  const kp = finish(k.c);
  assert.deepEqual([kp.status, kp.ex, kp.noteParts], ['ok', 367.04, BOTH_TYPED]);
  invariants(k.c);
  // Already typed: nothing is added, nothing is said.
  const t = setup();
  service(t.c, { papers: thirtyPapers });
  await gate(t.c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(t.c, [['217.04', '58'], ['150', '30']]);
  t.c.toasts.length = 0;
  await t.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(t.c, 1) });
  assert.deepEqual(t.c.toasts, ['תעודה 2 נקלטת כתעודת משלוח, לפי ההחלטה שלך.']);
  assert.deepEqual(json(t.c, 'receiptNotes'), BOTH_TYPED);
  invariants(t.c);
  // Its read fails its own paper check (the printed units were not read): the line is not invented — the worker is asked.
  const u = setup();
  service(u.c, { papers: papersOf(thirtyNoUnits) });
  await gate(u.c, ['delivery.jpg', 'second.jpg']);
  await typeNotes(u.c, [['217.04', '58']]);
  u.c.toasts.length = 0;
  await u.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(u.c, 1) });
  assert.ok(u.c.toasts.includes('תעודה 2 נקלטת כתעודת משלוח, לפי ההחלטה שלך. השורה שלה לא בסכום התעודות, והקריאה שלה לא אומתה — הקלד את הסכום והיחידות שלה ("ערוך").'), u.c.toasts.join(' | '));
  assert.deepEqual(json(u.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  invariants(u.c);
  // Classic typed receipt (AI document i is typed line i), the held note first, its line deleted by the worker: the
  // line comes back beside its document, so the documents and the typed lines stay in step.
  const g = setup();
  service(g.c, { papers: thirtyPapers });
  g.c.run('renderReceiving()');
  await g.c.click('rc-photo-manual');
  g.c.node('rcNoteInput').value = '150'; g.c.node('rcNoteUnits').value = '30'; await g.c.click('rc-note-add');
  g.c.node('rcNoteInput').value = '217.04'; g.c.node('rcNoteUnits').value = '58'; await g.c.click('rc-open'); await flush(g.c, 5);
  count(g.c, 47, 40);
  pressCart(g.c); await flush(g.c, 10);
  await g.c.click('ai-rescan'); await flush(g.c);
  await photograph(g.c, 0, ['second.jpg']); await photograph(g.c, 1, ['delivery.jpg']);
  await g.c.click('ai-run'); await flush(g.c);
  assert.deepEqual(json(g.c, 'yotvataHeldDocuments().map(x => x.index)'), [0]);
  g.c.run("currentView = 'receiving'; receiptNotes.splice(0, 1); recomputeNoteTotal(); renderReceiving()");
  await g.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(g.c, 0) });
  assert.deepEqual(json(g.c, 'receiptNotes'), [{ amount: 150, units: 30 }, { amount: 217.04, units: 58 }]);
  assert.deepEqual(json(g.c, 'aiScanDocuments.map(d => [d.amount, d.units])'), [[150, 30], [217.04, 58]], 'in step');
  invariants(g.c);
  // A negative read that comes back from the credits waits for a decision again — no line, nothing said about one.
  const n = setup();
  service(n.c, { papers: { 'delivery.jpg': twice(delivery), 'slip.jpg': twice(VARIANT.A) } });
  await gate(n.c, ['delivery.jpg', 'slip.jpg']);
  n.c.run("switchReceiptEntryMode('manual')");
  n.c.toasts.length = 0;
  await n.c.click('delivery-credit-unmove', credit0(n.c).id);
  assert.deepEqual(n.c.toasts, ['תעודה 2 חזרה לתעודות. הקריאה שכבר נעשתה נשמרה.']);
  assert.deepEqual(json(n.c, 'receiptNotes'), [{ amount: 217.04, units: 58 }]);
  assert.deepEqual(json(n.c, 'yotvataHeldDocuments().map(x => x.index)'), [1]);
  invariants(n.c);
  // From the photo (no typed amounts) nothing changes: the paper itself is the anchor.
  const f = setup();
  service(f.c, { papers: thirtyPapers });
  await gate(f.c, ['delivery.jpg', 'second.jpg']);
  f.c.toasts.length = 0;
  await f.c.click('rc-credit-doc-keep', undefined, { scan: scanIdOf(f.c, 1) });
  assert.deepEqual(f.c.toasts, ['תעודה 2 נקלטת כתעודת משלוח, לפי ההחלטה שלך.']);
  assert.deepEqual(json(f.c, 'receiptNotes'), BOTH_TYPED, 'adopted from the paper');
  invariants(f.c);
});

test('w30: a typed receipt saved by an earlier v394 build (the moved line kept without the lines the move left) — the way back puts the line back only when no typed line explains the paper, so a line typed again is never counted twice', async () => {
  const KEY = c => c.run('RECEIPT_DRAFT_KEY');
  const run = async retyped => {
    const { c, data } = setup();
    service(c, { papers: thirtyPapers });
    await gate(c, ['delivery.jpg', 'second.jpg']);
    await typeNotes(c, [['217.04', '58'], ['150', '30']]);
    await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
    if (retyped) {
      await c.click('rc-notes-edit'); await flush(c, 3);
      c.node('rcNoteInput').value = '150'; c.node('rcNoteUnits').value = '30'; await c.click('rc-note-add');
      c.node('rcNoteInput').value = ''; c.node('rcNoteUnits').value = '';
      await c.click('rc-notes-done'); await flush(c);
      assert.deepEqual(json(c, 'receiptNotes'), BOTH_TYPED, 'the worker typed the line again');
    }
    const draft = JSON.parse(c.storage.get(KEY(c)));
    delete draft.deliveryCredits[0].origin.typedNote.left; // as the earlier build saved it
    const storage = new Map(c.storage); storage.set(KEY(c), JSON.stringify(draft));
    const r = runtime('yotvata', { data, storage });
    const rs = service(r, { papers: thirtyPapers });
    r.run("confirmLog = []; showConfirm = (t, x, l, fn) => { confirmLog.push([t, x, l]); fn(); }; mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
    r.toasts.length = 0;
    await r.click('delivery-credit-unmove', r.run('receiptDeliveryCredits[0].id'));
    assert.deepEqual(json(r, 'receiptNotes'), BOTH_TYPED, (retyped ? 'typed again' : 'not typed again') + ': the line is in the total once');
    count(r, 48, 40);
    const p = finish(r);
    assert.deepEqual([p.status, p.ex, p.noteParts], ['ok', 367.04, BOTH_TYPED]);
    assert.equal(rs.scans().length, 0, 'nothing is read');
    invariants(r);
    return r.toasts.join(' | ');
  };
  assert.match(await run(true), /השורות שהוקלדו השתנו מאז ההעברה לזיכויים, ולכן השורה שהוקלדה לה \(₪150\.00 · 30 יח׳\) לא הוחזרה/);
  assert.match(await run(false), /השורה שהוקלדה לה \(₪150\.00 · 30 יח׳\) חזרה לסכום התעודות\./);
});

test('w31: a credit whose undo would come back held again (most readings read the minus; its credit-mode read is positive) offers no way back — never a loop of paid "העבר וקרא כזיכוי"', async () => {
  const { c, data } = setup();
  const s = service(c, { papers: { 'delivery.jpg': twice(delivery),
    'slip.jpg': ({ credit }) => credit ? [VARIANT.C(), VARIANT.C()] : { reads: [slip({ printedUnits: 24 }), VARIANT.C(), slip({ printedUnits: 24 })], selected: 1 } } });
  await gate(c, ['delivery.jpg', 'slip.jpg']);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[1])'), 'ask-read');
  assert.doesNotMatch(cardOf(c, 1), /rc-credit-doc-keep/);
  await c.click('rc-credit-doc-move', undefined, { scan: scanIdOf(c, 1) }); await flush(c);
  const credit = credit0(c);
  assert.deepEqual([credit.status, credit.notCredit, credit.origin.creditRead], ['error', true, 'no-minus']);
  const html = c.run('deliveryCreditsHtml()');
  assert.doesNotMatch(html, /delivery-credit-unmove/, 'no way back that would hold it again');
  assert.doesNotMatch(html, /נראה שזו תעודת משלוח רגילה/);
  assert.match(html, /data-role="delivery-credit-retake"/);
  assert.match(html, /data-role="delivery-credit-remove"/);
  const calls = s.stats.modelCalls;
  c.run('confirmLog = []');
  await c.click('delivery-credit-unmove', credit.id); // a forged or stale tap
  assert.deepEqual(json(c, 'confirmLog'), []);
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  assert.equal(s.stats.modelCalls, calls);
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
  assert.doesNotMatch(r.run('deliveryCreditsHtml()'), /delivery-credit-unmove/, 'not after a reload either');
  invariants(c); invariants(r);
});

test('w32: page split → "זה לא זיכוי? החזר את העמוד לתעודות" → split again — "פרטי פענוח התעודה" marks only the read the split was decided on, never the earlier re-read of page 1 alone', async () => {
  const historyText = c => text(c.run('yotvataScanHistoryHtml(yotvataReceiptScanAudit(), null)'));
  const { c } = setup();
  const mixed = () => ({ ...delivery(), pageCount: 2, rows: [line(YOGURT, 48, 167.04), line(MILK, 10, 50), line(YOGURT, 24, -83.52, 2)] });
  service(c, { papers: { 'delivery-p.jpg+slip-p.jpg': twice(mixed), 'slip-p.jpg': twice(VARIANT.CREDIT), 'delivery-p.jpg': twice(delivery) } });
  c.run('renderReceiving()');
  await photograph(c, 0, ['delivery-p.jpg', 'slip-p.jpg'], { gallery: true });
  await c.click('rc-photo-start'); await flush(c);
  await c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(c, 0) }); await flush(c);
  await c.click('delivery-credit-unmove', credit0(c).id);
  assert.equal(c.run('yotvataDocumentKindVerdict(aiScanDocuments[0])'), 'ask-split', 'the original two-page read is back');
  await c.click('rc-credit-doc-split', undefined, { scan: scanIdOf(c, 0) }); await flush(c);
  const id = credit0(c).id;
  assert.deepEqual(json(c, 'receiptScanHistory.map(e => e.movedPagesToCredit ? e.movedPagesToCredit.pages : null)'), [[2], null, null],
    'the two-page read is marked; the earlier re-read of page 1 and the new one are plain reads');
  assert.equal(c.run(`receiptScanHistory[0].movedPagesToCredit.id === ${JSON.stringify(id)}`), true);
  assert.equal((historyText(c).match(/עמוד 2 זוהה כתעודת זיכוי והועבר לזיכויים/g) || []).length, 1);
  count(c);
  const p = finish(c);
  assert.equal(p.status, 'ok');
  assert.equal(c.run('yotvataReceiptScanAudit().history.filter(e => e.movedPagesToCredit).length'), 1, 'the saved audit agrees');
  invariants(c);
});
