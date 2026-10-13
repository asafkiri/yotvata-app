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
  assert.match(cardOf(c, 1), /קריאה אחת קראה סכום שלילי \(‎-83\.52\) והשנייה חיובי \(83\.52\)\./);
  assert.match(cardOf(c, 1), /כן, זו תעודת זיכוי — העבר וקרא כזיכוי/);
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
  assert.match(cardOf(n.c, 1), /קריאה אחת קראה סכום שלילי \(‎-83\.52\) והשנייה חיובי \(83\.52\)\./);
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
    assert.deepEqual(c.toasts, [expected], 'a minus in the units too');
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
