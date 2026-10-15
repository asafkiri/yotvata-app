// v396: the second strong read of the companion service v153 (Terra#2, "קריאה 4") in the app.
// The owner's design: (1) the cheap reads agree — accepted; (2) they disagree — the strong read (Terra, read 2,
// "קריאה 3"), and a field where it agrees with a cheap read is accepted; (3) a field where it agrees with neither
// — the service reads once more with the strong model (Terra#2, read 3), and when it sees the same value the
// field is accepted with no worker action; (4) otherwise the worker approves or corrects as today. The service
// closes such a field by taking it out of `issues` (fieldSupport gets 3, the row turns 'verified') and records
// it in scan.verification.secondVerifier and its audit log; the app shows the worker nothing new for it.
//
// The paper is invoice 9073807997 of quantity-arithmetic-fixture.mjs (3 pages, 22 rows, ₪1,717.49, 285 units).
// The unit price of row 6 ("מארז 8 מילקי בטעם שוקולד", 6 × 16.03 = 96.18) is read three ways: 16.13 by cheap
// read 0, 16.3 by cheap read 1 and 16.03 by the verifier — the scenario of the service's own
// test-second-strong-read.mjs. The paper check does not cover the unit price, so every read balances; the
// verifier is selected (its row arithmetic closes, the cheap reads' rows contradict their own gross).
//
// Two kinds of tests, as in quantity-arithmetic(-contract): the complete app module (receipt-scan-harness) on an
// imitation of the service answer (splitInvoice), and the same through the REAL service code next to this repo
// (../yotvata-ai-scan or YOTVATA_AI_SCAN=<dir>; fake OpenAI, a locally signed Firebase token, no paid call), which
// also checks that the imitation is the service's real answer. The contract tests are skipped, with a message,
// when the service is not there (or, for the v153 ones, older than v153).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime, fixture } from './receipt-scan-harness.mjs';
import { PRODUCTS, SUBTOTAL, UNITS, catalog, readRows, modelDoc, ean13 } from './quantity-arithmetic-fixture.mjs';

const MILKY = 5, PRINTED = 16.03, CHEAP = [16.13, 16.3];
const r2 = n => Math.round(n * 100) / 100;
const EVIDENCE_KEYS = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
  'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
const evidence = row => Object.fromEntries(EVIDENCE_KEYS.map(k => [k, row[k] ?? null]));
// One model read of the paper: every row as printed, the milky unit price as that read saw it.
const readDoc = unit => { const rows = readRows('selected'); rows[MILKY].unitPriceExVat = unit; return modelDoc(rows); };

// The service answer (imitated; the contract tests below compare it with the real one). `server`: 152 — no
// second strong read at all (no secondVerifier, no read 3); 153 — with it. `fourth` (153 only): Terra#2's milky
// unit price (16.03 closes the field; anything else leaves it to the worker), 'failed' (Terra#2 timed out —
// nothing changes), 'off' (SECOND_STRONG_READ=off — outcome 'disabled', three reads), or the outcomes where the
// service made no fourth call: 'skipped_deadline' (too little time left) and 'not_provable' (C1 failed).
function splitInvoice({ server = 153, fourth = PRINTED } = {}) {
  const docs = [readDoc(CHEAP[0]), readDoc(CHEAP[1]), readDoc(PRINTED)];
  const read3 = server >= 153 && typeof fourth === 'number' ? readDoc(fourth) : null;
  const closed = !!read3 && fourth === PRINTED;
  const both = [0, 1];
  const rows = docs[2].rows.map((row, i) => {
    const identity = { productId: PRODUCTS[i].id, barcode: PRODUCTS[i].barcode }, milky = i === MILKY;
    const issues = milky && !closed ? ['unitPriceExVat'] : [];
    const readings = [2, 0, 1].map(read => ({ read, identity, values: evidence(docs[read].rows[i]) }));
    if (milky && read3) readings.push({ read: 3, identity, values: evidence(read3.rows[i]) });
    return { ...row, barcodeObserved: row.barcode, barcodeMatchMethod: 'model_consensus', barcodeResolvedProductId: PRODUCTS[i].id, barcodeRetryConflict: false,
      modelVerification: { version: 1, status: issues.length ? 'needs_review' : 'verified', selectedRead: 2, strongSelected: true, issues, identity,
        identitySupport: both, candidates: [identity],
        fieldSupport: { quantity: both, unitPriceExVat: milky ? (closed ? [3] : []) : both, grossLineTotalExVat: both, lineDiscountExVat: both, lineTotalExVat: both },
        readings, evidence: evidence(row),
        ...(milky && read3 ? { secondStrongRead: { version: 1, read: 3, fields: ['unitPriceExVat'], closed: closed ? { unitPriceExVat: 'second_strong_read' } : {} } } : {}) } };
  });
  const summary = { pageCount: 3, subtotalExVat: SUBTOTAL, printedUnits: UNITS, printedLines: 22, documentDiscountExVat: null, vatAmount: r2(SUBTOTAL * 0.18), totalInclVat: r2(SUBTOTAL * 1.18) };
  const doc = { ...docs[2], rows, modelVerification: { version: 1, issues: [], values: { pageCount: 3, subtotalExVat: SUBTOTAL, printedUnits: UNITS, documentDiscountExVat: null },
    readings: [2, 0, 1].map(read => ({ read, values: summary, discountSeparate: false })),
    support: Object.fromEntries(['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount'].map(f => [f, both])) } };
  // Service 153, third review round: a field Terra#2 read and did not close says why (here 'disagrees': another value).
  const entry = { noteIndex: 0, rowIndex: MILKY, sourcePage: 1, lineNumber: MILKY + 1, field: 'unitPriceExVat', closedBy: closed ? 'second_strong_read' : null,
    values: [{ read: 2, value: PRINTED }, { read: 0, value: CHEAP[0] }, { read: 1, value: CHEAP[1] }, ...(read3 ? [{ read: 3, value: fourth }] : [])],
    ...(read3 && !closed ? { reason: 'disagrees' } : {}) };
  const secondVerifier = server < 153 ? null
    : fourth === 'off' ? { attempted: false, outcome: 'disabled', read: 3, model: null, requestId: null, error: null, usage: null, fields: [], closed: [] }
    : fourth === 'not_provable' ? { attempted: false, outcome: 'not_provable', read: 3, model: null, requestId: null, error: null, usage: null, fields: [], closed: [] }
    : fourth === 'skipped_deadline' ? { attempted: false, outcome: 'skipped_deadline', read: 3, model: null, requestId: null, error: null, usage: null,
      remainingMs: 100_000, fields: [entry], closed: [] }
    : fourth === 'failed' ? { attempted: true, outcome: 'failed', read: 3, model: 'gpt-5.6-terra', requestId: null, error: 'timeout', usage: null,
      remainingMs: 200_000, timeoutMs: 180_000, fields: [entry], closed: [] }
    : { attempted: true, outcome: closed ? 'closed' : 'disagreed', read: 3, model: 'gpt-5.6-terra', requestId: 'resp-second', error: null,
      usage: { input_tokens: 41_000, output_tokens: 9_000 }, remainingMs: 200_000, timeoutMs: 180_000, fields: [entry], closed: closed ? [entry] : [] };
  const verification = { version: 1, status: closed ? 'verified' : 'needs_review', primaryReads: 2, escalationAttempted: true, selectedRead: 2,
    readCount: read3 || fourth === 'failed' ? 4 : 3,
    verifier: { attempted: true, model: 'gpt-5.6-terra', requestId: 'resp-verifier', outcome: closed ? 'agreed' : 'disagreed', error: null, selected: true },
    ...(secondVerifier ? { secondVerifier } : {}) };
  return { ok: true, serviceVersion: server, model: 'gpt-5.6-terra', requestId: 'resp-verifier', usage: { input_tokens: 40_000, output_tokens: 9_000 },
    scan: { warnings: [], documents: [doc], verification }, checksumRetryAttempted: true, paperValidation: [{ noteIndex: 0, ok: true }],
    scanAudit: { version: 1, id: 'audit-9073807997', documentKind: 'invoice', result: closed ? 'paper_verified' : 'needs_review',
      ...(secondVerifier ? { secondStrongRead: secondVerifier } : {}) } };
}

// ---- the app: the photo gate of a new receipt, three pages photographed, the read fired ----
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const R = 'aiScanResponse.scan.documents[0].rows[' + MILKY + ']';
const pending = c => json(c, 'priceAuditPendingRows(receiptPriceAudit())');
const auditHtml = c => c.run('receiptPriceAuditHtml()');
const diagnostics = c => c.run('aiScanDiagnosticsHtml(aiEvaluateInvoiceScan(aiScanResponse))');
async function scanInApp(paper) {
  const data = fixture('yotvata');
  data.products = PRODUCTS.map(p => ({ ...p }));
  data.items = [];
  data.paper = paper; // what fetch('/scan') answers, untouched
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened=false;receiptList=[];receiptDupConfirmed=true;
    aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:Array.from({length:3},()=>({dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}))}];`);
  await c.run('yotvataStartPaperScan()');
  c.run("receiptDocDate='2026-09-25';saveReceiptDraft();renderReceiving()");
  assert.equal(c.requests.filter(r => r.url.endsWith('/scan')).length, 1, 'one paid read');
  assert.equal(c.run('receiptPaperScanState'), 'ok', c.run('JSON.stringify(receiptPaperScanProblems)'));
  return { c, data };
}

// A field Terra#2 closed is settled: no card, nothing new for the worker, the values as read. Only the
// collapsed diagnostics name the closure.
function assertClosedSettled(c) {
  assert.deepEqual(json(c, R + '.modelVerification.issues'), [], 'the service took the field out of issues');
  assert.equal(c.run(R + '.unitPriceExVat'), PRINTED, 'the value of the selected read');
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), []);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + R + ')'), true);
  const audit = json(c, 'receiptPriceAudit()');
  assert.deepEqual(pending(c), [], 'no card');
  assert.equal(audit.complete, true);
  assert.deepEqual([audit.rows[MILKY].capability, audit.rows[MILKY].result, audit.rows[MILKY].modelReviewIssues], ['checkable', 'match', undefined]);
  const html = auditHtml(c);
  assert.match(html, /המחירים שנבדקו תואמים · 22 שורות · אין מה לאשר/);
  assert.doesNotMatch(html, /צריך להשלים את הבדיקה|price-confirm-values|data-price-row=|קריאה 4|פעם שנייה|המודל החזק/, 'nothing new for the worker');
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true, JSON.stringify(json(c, 'aiEvaluateInvoiceScan(aiScanResponse).errors')));
  const diag = diagnostics(c);
  assert.match(diag, /קריאה 4 \(המודל החזק, פעם שנייה\) · תעודה 1: closed · נסגרו 1 מתוך 1 שדות/);
  assert.match(diag, /טוקנים · קריאה 4 בתעודה 1: כניסה /);
}

// The worker's card when Terra#2 read a different value: the four reads, named, and the value of the selected
// read on the paper row. Step (4) as today — the one-tap approval (6 × 16.03 = 96.18 holds) and the correction.
async function assertFourReadCard(c, fourth, tail) {
  assert.deepEqual(json(c, R + '.modelVerification.issues'), ['unitPriceExVat']);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), ['unitPriceExVat']);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + R + ')'), false);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [MILKY]);
  const html = auditHtml(c);
  assert.match(html, /נשארה שורה אחת לטיפול/);
  assert.match(html, /צריך להשלים את הבדיקה/);
  const shown = fourth.toFixed(2).replace('.', '\\.');
  assert.match(html, new RegExp('<p data-row-dispute-field="unitPriceExVat">הקריאות לא הסכימו על מחיר היחידה: קריאה 1 – 16\\.13 · קריאה 2 – 16\\.30 · ' +
    'קריאה 3 \\(המודל החזק\\) – 16\\.03 · קריאה 4 \\(המודל החזק, פעם שנייה\\) – ' + shown + '\\. ' + tail + '</p>'));
  assert.equal((html.match(/קריאה \d/g) || []).length, 4, 'four reads, each named once');
  assert.match(html, /מחיר ליחידה<b class="block text-sm text-slate-900">₪16\.03<\/b>/, 'the value shown is the selected read\'s');
  assert.match(html, /data-role="price-confirm-values"/);
  assert.match(html, /data-role="paper-row-edit"/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, 'the receipt waits for the worker');
  await c.click('price-confirm-values', '', { doc: '0', row: String(MILKY), reviewToken: c.run('priceAuditValuesReviewToken(aiSourceRow(0,' + MILKY + '))') });
  assert.deepEqual(pending(c), [], 'the worker approved it, as today');
  assert.equal(c.run(R + '.unitPriceExVat'), PRINTED, 'the OCR value is kept');
}
const SOME_PAIR = 'גם הקריאה השלישית והקריאה הרביעית \\(המודל החזק, פעמיים\\) קראו את הנייר, ועדיין אף קריאה אחרת לא ראתה את מה שהפענוח קרא\\.';
const NO_PAIR = 'גם הקריאה השלישית והקריאה הרביעית \\(המודל החזק, פעמיים\\) קראו את הנייר, ועדיין אין שתי קריאות שמסכימות\\.';

// What the worker saw before v396 (service 152), byte for byte: three reads, the verifier named once, the v367 tail.
const V152_CARD = '<p data-row-dispute-field="unitPriceExVat">הקריאות לא הסכימו על מחיר היחידה: קריאה 1 – 16.13 · קריאה 2 – 16.30 · קריאה 3 (המודל החזק) – 16.03.' +
  ' גם הקריאה השלישית (המודל החזק) קראה את הנייר, ועדיין אין שתי קריאות שמסכימות.</p>';
function assertService152Card(c) {
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), ['unitPriceExVat']);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [MILKY]);
  const html = auditHtml(c);
  assert.ok(html.includes(V152_CARD), (html.match(/<p data-row-dispute-field[\s\S]*?<\/p>/) || [''])[0]);
  assert.doesNotMatch(html, /קריאה 4|פעם שנייה|פעמיים/);
  assert.match(html, /data-role="price-confirm-values"/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false);
  return html;
}
// Two scans of the same paper differ only in their generated ids (the source id in review tokens and row ids).
const withoutTokens = html => html.replace(/data-review-token="[^"]*"/g, '').replace(/local-[a-z0-9]+/g, 'local-id');

test('the read labels: the verifier is "המודל החזק" and the fourth read "המודל החזק, פעם שנייה"; identity stays on reads 0–2', async () => {
  const { c } = await scanInApp(splitInvoice({ server: 152, fourth: null }));
  assert.deepEqual([0, 1, 2, 3].map(read => c.run('aiScanReadLabel(' + JSON.stringify({ read }) + ')')),
    ['קריאה 1', 'קריאה 2', 'קריאה 3 (המודל החזק)', 'קריאה 4 (המודל החזק, פעם שנייה)']);
  assert.equal(c.run('aiScanReadLabel({read:0,strong:true})'), 'קריאה 1 (המודל החזק)', 'an explicit strong flag is kept');
  assert.deepEqual(json(c, '[AI_SCAN_STRONG_READ, AI_SCAN_SECOND_STRONG_READ, AI_SCAN_IDENTITY_READS]'), [2, 3, [0, 1, 2]]);
});

test('a field Terra#2 closed (second_strong_read) is settled: no card, the values of the selected read, nothing new for the worker — and the draft restores it', async () => {
  const answer = splitInvoice({ fourth: PRINTED });
  assert.equal(answer.scan.verification.secondVerifier.closed[0].closedBy, 'second_strong_read');
  const { c } = await scanInApp(structuredClone(answer));
  assert.equal(json(c, 'aiScanResponse.perDocument[0].verification.secondVerifier.outcome'), 'closed', 'the verification block is kept with the receipt');
  assertClosedSettled(c);
  const reloaded = runtime('yotvata', { data: c.context.testData, storage: c.storage });
  assert.deepEqual(pending(reloaded), []);
  assert.match(diagnostics(reloaded), /קריאה 4 \(המודל החזק, פעם שנייה\) · תעודה 1: closed/);
  assert.equal(reloaded.requests.length, 0, 'no new read');
});

test('Terra#2 read a cheap read\'s value: the card lists all four reads, names the fourth as the strong model\'s second read, and the worker approves as today', async () => {
  const { c } = await scanInApp(splitInvoice({ fourth: CHEAP[0] }));
  await assertFourReadCard(c, CHEAP[0], SOME_PAIR);
  assert.doesNotMatch(auditHtml(c), /אין שתי קריאות שמסכימות/);
  assert.match(diagnostics(c), /קריאה 4 \(המודל החזק, פעם שנייה\) · תעודה 1: disagreed · נסגרו 0 מתוך 1 שדות/);
});

test('Terra#2 read a fourth value: four reads, no two agree — the familiar sentence, naming both strong reads', async () => {
  const { c } = await scanInApp(splitInvoice({ fourth: 16.33 }));
  await assertFourReadCard(c, 16.33, NO_PAIR);
});

test('a service 152 answer (no second strong read) shows exactly the v395 card: three reads, the verifier named once, no diagnostics line', async () => {
  const answer = splitInvoice({ server: 152, fourth: null });
  assert.equal('secondVerifier' in answer.scan.verification, false);
  const { c } = await scanInApp(answer);
  const html = assertService152Card(c);
  assert.doesNotMatch(diagnostics(c), /קריאה 4/);
  // Service 153 with SECOND_STRONG_READ=off, and a Terra#2 that timed out (a failure changes nothing), show the
  // worker the same card; only the collapsed diagnostics mention the failed read.
  const { c: off } = await scanInApp(splitInvoice({ fourth: 'off' }));
  assert.equal(withoutTokens(assertService152Card(off)), withoutTokens(html), 'off');
  assert.doesNotMatch(diagnostics(off), /קריאה 4/, 'disabled: no line');
  const { c: failed } = await scanInApp(splitInvoice({ fourth: 'failed' }));
  assert.equal(withoutTokens(assertService152Card(failed)), withoutTokens(html), 'failed');
  assert.match(diagnostics(failed), /קריאה 4 \(המודל החזק, פעם שנייה\) · תעודה 1: failed \(timeout\) · נסגרו 0 מתוך 1 שדות/);
  // No fourth call at all: too little time left, or the paper/row proof (C1) failed. The same card again.
  for (const [outcome, asked] of [['skipped_deadline', 1], ['not_provable', 0]]) {
    const { c: none } = await scanInApp(splitInvoice({ fourth: outcome }));
    assert.equal(withoutTokens(assertService152Card(none)), withoutTokens(html), outcome);
    assert.match(diagnostics(none), new RegExp('קריאה 4 \\(המודל החזק, פעם שנייה\\) · תעודה 1: ' + outcome + ' · נסגרו 0 מתוך ' + asked + ' שדות'));
  }
});

test('Terra#2 never decides a product: a price supported only by read 3 does not choose the identity, and identity support from read 3 is not consensus', async () => {
  const { c } = await scanInApp(splitInvoice({ fourth: PRINTED }));
  assert.equal(c.run('aiResolveInvoiceBarcode(' + R + ').method'), 'model_consensus');
  // The row with an open identity and a unit price only Terra#2 saw (a shape the service never sends: it never
  // asks Terra#2 about such a row). The verified-price identity rule needs two of reads 0–2.
  c.run(`(() => { const p = ${R}.modelVerification; p.issues = ['identity']; p.status = 'needs_review'; p.fieldSupport.unitPriceExVat = [3]; })()`);
  assert.equal(c.run('aiModelPriceAgreement(' + R + ')'), null);
  assert.equal(c.run('aiModelPriceResolution(' + R + ')'), null);
  c.run(`${R}.modelVerification.fieldSupport.unitPriceExVat = [0, 3]; ${R}.modelVerification.readings.find(r => r.read === 0).values.unitPriceExVat = ${PRINTED};`);
  assert.deepEqual(json(c, 'aiModelPriceAgreement(' + R + ').supportingReads'), [0], 'a cheap read still counts; read 3 does not');
  // model_consensus: identity supported by read 3 alone is not consensus.
  c.run(`(() => { const p = ${R}.modelVerification; p.issues = []; p.status = 'verified'; p.identitySupport = [3]; })()`);
  assert.match(String(c.run('aiResolveInvoiceBarcode(' + R + ').error')), /זהות המוצר השתנתה/);
});

// ---- the same against the REAL service (the pattern of quantity-arithmetic-contract.test.mjs) ----
const serviceDir = process.env.YOTVATA_AI_SCAN || fileURLToPath(new URL('../../yotvata-ai-scan/', import.meta.url));
const serverFile = new URL('server.js', pathToFileURL(serviceDir.endsWith('/') ? serviceDir : serviceDir + '/'));
const missing = fs.existsSync(serverFile) ? false : 'the companion service is not checked out next to this repo (set YOTVATA_AI_SCAN=<dir of yotvata-ai-scan>)';
const { createServer } = missing ? {} : await import(serverFile.href);
const consensus = missing ? {} : await import(new URL('scan-consensus.js', serverFile).href);
const skip153 = missing || (consensus.SECOND_STRONG_READ_INDEX === 3 ? false : 'the companion service is older than v153 (no second strong read)');

const image = 'data:image/jpeg;base64,YQ==';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({
  aud: 'globrands-db', iss: 'https://securetoken.google.com/globrands-db', sub: 'fixture', iat: now, exp: now + 3600 });
const token = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
const answer = d => ({ output_text: JSON.stringify({ documents: [d], warnings: [] }) });
// documents (service 153, fourth review round) — the scan's notes, for a scan of more than one note; by default one note of three pages.
async function service(responses, env = {}, { products = catalog, documents = null } = {}) {
  const calls = [];
  const server = createServer({ env: { OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'gpt-5.6-luna',
    OPENAI_RETRY_MODEL: 'gpt-5.6-terra', OPENAI_RETRY_SERVICE_TIER: 'priority', ...env },
    logger: { info: () => {}, error: error => { throw error; } },
    fetchImpl: async (url, options) => {
      if (String(url).includes('googleapis.com')) return Response.json({ keys: [jwk] });
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const call = JSON.parse(options.body); calls.push(call);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, 'unexpected paid model call');
      return Response.json({ ...next, model: call.model, id: 'test-' + calls.length, usage: { input_tokens: 10, output_tokens: 20 } });
    } });
  const body = { reviewProtocolVersion: 1, documents: documents || [{ noteIndex: 0, pages: [image, image, image], expectedSubtotalExVat: null, expectedUnits: null }],
    receivedProductIds: [], catalog: products };
  const output = await new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.url = '/scan'; req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { origin: 'https://asafkiri.github.io', authorization: 'Bearer ' + token };
    server.emit('request', req, { headersSent: false, writeHead() { this.headersSent = true; }, write() {}, end(chunk) { resolve(JSON.parse(chunk)); } });
  });
  server.close();
  assert.equal(responses.length, 0, 'every prepared model answer was used');
  return { output, calls };
}
const SPLIT = () => [answer(readDoc(CHEAP[0])), answer(readDoc(CHEAP[1])), answer(readDoc(PRINTED))];
// The imitation is the real answer on everything the app reads: every row's and the document's
// modelVerification, the OCR values, and the verification block (without request ids, clocks and tokens).
function assertImitation(output, imitation) {
  assert.equal(output.ok, true, JSON.stringify(output).slice(0, 300));
  const [real, fake] = [output.scan.documents[0], imitation.scan.documents[0]];
  assert.deepEqual(real.rows.map(r => r.modelVerification), fake.rows.map(r => r.modelVerification));
  assert.deepEqual(real.modelVerification, fake.modelVerification);
  assert.deepEqual(real.rows.map(evidence), fake.rows.map(evidence));
  const shape = v => { const { verifier, secondVerifier, ...rest } = structuredClone(v);
    return { ...rest, verifier: { ...verifier, requestId: null }, ...(secondVerifier ? { secondVerifier: { attempted: secondVerifier.attempted, outcome: secondVerifier.outcome,
      read: secondVerifier.read, model: secondVerifier.model, error: secondVerifier.error, fields: secondVerifier.fields, closed: secondVerifier.closed } } : {}) }; };
  assert.deepEqual(shape(output.scan.verification), shape(imitation.scan.verification));
}

test('against the real service v153: Terra#2 confirms the verifier, the field closes, and the app shows no card', { skip: skip153 }, async () => {
  const { output, calls } = await service([...SPLIT(), answer(readDoc(PRINTED))]);
  assert.deepEqual(calls.map(c => [c.model, c.reasoning.effort]), [['gpt-5.6-luna', 'medium'], ['gpt-5.6-luna', 'medium'], ['gpt-5.6-terra', 'high'], ['gpt-5.6-terra', 'high']]);
  assert.equal(output.serviceVersion, 153);
  assertImitation(output, splitInvoice({ fourth: PRINTED }));
  assert.equal(output.scan.verification.secondVerifier.closed[0].closedBy, 'second_strong_read');
  const { c } = await scanInApp(structuredClone(output));
  assertClosedSettled(c);
});

test('against the real service v153: Terra#2 read another value — the worker\'s card lists the four reads', { skip: skip153 }, async () => {
  const { output, calls } = await service([...SPLIT(), answer(readDoc(CHEAP[0]))]);
  assert.equal(calls.length, 4);
  assertImitation(output, splitInvoice({ fourth: CHEAP[0] }));
  const { c } = await scanInApp(structuredClone(output));
  await assertFourReadCard(c, CHEAP[0], SOME_PAIR);
});

test('against the real service with SECOND_STRONG_READ=off: three reads, and the app shows the worker exactly what it shows for a service 152 answer', { skip: missing }, async () => {
  const { output, calls } = await service(SPLIT(), { SECOND_STRONG_READ: 'off' });
  assert.equal(calls.length, 3, 'no fourth read');
  const v153 = output.serviceVersion >= 153;
  assertImitation(output, splitInvoice(v153 ? { fourth: 'off' } : { server: 152, fourth: null }));
  const { c } = await scanInApp(structuredClone(output));
  const html = assertService152Card(c);
  assert.doesNotMatch(diagnostics(c), /קריאה 4/);
  // The same answer as service 152 would send it (no secondVerifier): the same card and the same audit.
  const as152 = structuredClone(output);
  as152.serviceVersion = 152; delete as152.scan.verification.secondVerifier; if (as152.scanAudit) delete as152.scanAudit.secondStrongRead;
  const { c: old } = await scanInApp(as152);
  assert.equal(withoutTokens(assertService152Card(old)), withoutTokens(html));
  const audit = x => json(x, 'receiptPriceAudit()').rows.map(r => [r.capability, r.result, r.modelReviewIssues || null, r.quantity]);
  assert.deepEqual(audit(old), audit(c));
});

// ---- service 153, second review round: read 3 never proves a quantity both cheap reads read alike ----
// Before the round, service 153 asked Terra#2 about the money of a row whose quantity was open and that both cheap
// reads had read alike (they agreed against the verifier there; only the money split). Read 3 then entered the
// row's fieldSupport, and the app's own v367 arithmetic, which counted any read, proved the verifier's quantity
// with no card (v395 too). The service now asks nothing in such a row; the app counts read 3 in that arithmetic
// only on a row whose quantity Terra#2 was asked about (proof.secondStrongRead.fields), as the service's own
// re-check does, so an answer of that earlier build still gives the worker the card.
test('read 3 proves no quantity it was not asked about: the unit price Terra#2 closed in a row whose quantity both cheap reads read as 3 leaves the verifier\'s 6 to the worker', async () => {
  const answer = splitInvoice({ fourth: PRINTED });
  const row = answer.scan.documents[0].rows[MILKY], proof = row.modelVerification;
  for (const r of proof.readings) if (r.read === 0 || r.read === 1) r.values.quantity = 3;
  Object.assign(proof, { issues: ['quantity'], status: 'needs_review', fieldSupport: { ...proof.fieldSupport, quantity: [] } });
  answer.scan.verification.status = 'needs_review';
  assert.deepEqual(proof.fieldSupport.unitPriceExVat, [3]); assert.deepEqual(proof.secondStrongRead.fields, ['unitPriceExVat']);
  const { c } = await scanInApp(structuredClone(answer));
  assert.equal(c.run(R + '.quantity'), 6);
  assert.equal(c.run('priceAuditQuantityArithmetic(' + R + ', true).proven'), false);
  // Service 153, third review round: the reason names read 4 — the unit price is not "not agreed between the reads"
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + R + ', true).reasons'), ['unit_second']);
  assert.match(auditHtml(c), /<p class="mt-1">החשבון לא מכריע: מחיר היחידה אושר רק בקריאה הרביעית \(המודל החזק, פעם שנייה\), שלא נשאלה על הכמות\.<\/p>/);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), ['quantity']);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + R + ')'), false);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [MILKY]);
  assert.match(auditHtml(c), /צריך להשלים את הבדיקה/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, 'the receipt waits for the worker');
  // A quantity Terra#2 was asked about: read 3 counts, as in the service's re-check (which marks it 'arithmetic')
  c.run(`${R}.modelVerification.secondStrongRead.fields = ['quantity', 'unitPriceExVat']`);
  assert.equal(c.run('priceAuditQuantityArithmetic(' + R + ', true).proven'), true);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), []);
});

// The case of the second review round through the real service: 22 rows, A (row 7) 12 × 3.86 = 46.32 and B (row 8)
// 6 × 3.86 = 23.16, the same unit price. Both cheap reads read A's and B's quantities right; cheap read 0 misread
// another row's money and cheap read 1 a digit of A's and B's money, so neither paper balances. Terra#1 and Terra#2
// swap A and B (6 / 23.16 and 12 / 46.32): the paper and every row's arithmetic still close. Before the round the
// app accepted 6 and 12 with no card. And a lone cheap read (the other failed) is never outvoted by Terra twice.
const SWAP_A = 6, SWAP_B = 7;
const SWAP_LINES = Array.from({ length: 22 }, (_, i) => i === SWAP_A ? ['שוקו בקבוק 1 ליטר', 12, 3.86] : i === SWAP_B ? ['שוקו בקבוק חצי ליטר', 6, 3.86] : ['מוצר החלפה ' + (i + 1), 13, 5]);
const SWAP_PRODUCTS = SWAP_LINES.map(([name, , price], i) => ({ id: 'swap_' + (i + 1), name, barcode: ean13('72900002' + String(i + 1).padStart(4, '0')), price }));
const swapRow = (i, { qty = SWAP_LINES[i][1], money = r2(SWAP_LINES[i][1] * SWAP_LINES[i][2]) } = {}) => ({ sourcePage: i < 8 ? 1 : i < 16 ? 2 : 3, lineNumber: i + 1,
  rowRegion: null, barcode: SWAP_PRODUCTS[i].barcode, barcodeReadType: 'full', catalogHintId: null, catalogCandidateHintIds: [], supplierItemCode: null,
  description: SWAP_LINES[i][0], quantity: qty, unitPriceExVat: SWAP_LINES[i][2], grossLineTotalExVat: money, lineDiscountExVat: 0, lineTotalExVat: money,
  promotionText: null, confidence: 0.9 });
const SWAP_CATALOG = SWAP_PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode }));
const SWAP_SUBTOTAL = r2(SWAP_LINES.reduce((n, [, q, u]) => n + r2(q * u), 0));
const swapDoc = (edit = {}) => ({ noteIndex: 0, invoiceNumber: '9073800001', pageCount: 3, subtotalExVat: SWAP_SUBTOTAL, vatAmount: r2(SWAP_SUBTOTAL * 0.18),
  totalInclVat: r2(SWAP_SUBTOTAL * 1.18), printedUnits: SWAP_LINES.reduce((n, [, q]) => n + q, 0), printedLines: 22, documentDiscountExVat: null, confidence: 0.9,
  warnings: [], rows: SWAP_LINES.map((_, i) => swapRow(i, edit[i])) });
const SWAPPED = () => answer(swapDoc({ [SWAP_A]: { qty: 6, money: 23.16 }, [SWAP_B]: { qty: 12, money: 46.32 } }));
async function swapScanInApp(paper) {
  const data = fixture('yotvata');
  data.products = SWAP_PRODUCTS.map(p => ({ ...p })); data.items = []; data.paper = paper;
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened=false;receiptList=[];receiptDupConfirmed=true;
    aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:Array.from({length:3},()=>({dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}))}];`);
  await c.run('yotvataStartPaperScan()');
  c.run("receiptDocDate='2026-09-25';saveReceiptDraft();renderReceiving()");
  assert.equal(c.run('receiptPaperScanState'), 'ok', c.run('JSON.stringify(receiptPaperScanProblems)'));
  return c;
}
const swapRowsOf = c => [SWAP_A, SWAP_B].map(i => [c.run('aiScanResponse.scan.documents[0].rows[' + i + '].quantity'),
  json(c, 'aiModelReviewIssues(aiScanResponse.scan.documents[0].rows[' + i + '])')]);
const SWAP_PENDING = [[6, ['quantity', 'grossLineTotalExVat', 'lineTotalExVat']], [12, ['quantity', 'grossLineTotalExVat', 'lineTotalExVat']]];

test('against the real service v153: two strong reads that swap two same-price rows the cheap reads read right never pass the worker by — split money or a lone cheap read', { skip: skip153 }, async () => {
  const cheap = [answer(swapDoc({ 9: { money: 56 } })), answer(swapDoc({ [SWAP_A]: { money: 48.32 }, [SWAP_B]: { money: 28.16 } }))];
  const lone = [answer(swapDoc()), new Error('test network failure')];
  for (const [label, reads] of [['the cheap reads split only on the money', cheap], ['a lone cheap read', lone]]) {
    // Three answers each: a fourth call would find no answer (the fake model's assertion fails that read) and is counted.
    const off = await service([...reads, SWAPPED()], { SECOND_STRONG_READ: 'off' }, { products: SWAP_CATALOG });
    const on = await service([...reads, SWAPPED()], {}, { products: SWAP_CATALOG });
    assert.equal(on.calls.length, 3, label + ': no fourth call');
    assert.equal(on.output.scan.verification.secondVerifier.outcome, 'not_needed', label);
    const c = await swapScanInApp(structuredClone(on.output)), old = await swapScanInApp(structuredClone(off.output));
    assert.deepEqual(swapRowsOf(c), SWAP_PENDING, label);
    assert.deepEqual(pending(c).map(r => r.rowIndex), [SWAP_A, SWAP_B], label);
    assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, label + ': the receipt waits for the worker');
    assert.deepEqual(swapRowsOf(old), swapRowsOf(c), label + ': what the switch off shows');
  }
});

// ---- service 153, third review round: the reading of a row is the reading of that printed line ----
// Until this round the service took each read's reading of a row from the vote's alignment (by position when the row
// counts are equal, by content otherwise). A cheap read that listed A after its neighbour, skipped A and read another
// line twice, or a paper with one product on two lines, paired different printed lines: both strong reads' swap of A
// and B then passed as "the cheap reads disagreed" (or Terra#2's reading of B confirmed A), and A was accepted as 6
// with no card. Now step 3 counts a read for a line only by the same page, printed line number and product, that
// product on one row only (the reviewers' repro-row-order and repro-dup-product, through the real service and the app).
const swapOrdered = (edit, order) => { const d = swapDoc(edit); d.rows = order.map(i => d.rows[i]); return d; };
const SWAP_ORDER = SWAP_LINES.map((_, i) => i);

test('against the real service v153: a cheap read that lists A after its neighbour, one that skipped A and read another line twice, or one product on lines 7 and 8 — no fourth call, A and B with the worker as with the switch off', { skip: skip153 }, async () => {
  const dupCatalog = SWAP_CATALOG.filter((_, i) => i !== SWAP_B);
  const dup = edit => { const d = swapDoc(edit); d.rows[SWAP_B] = { ...d.rows[SWAP_B], barcode: SWAP_PRODUCTS[SWAP_A].barcode, description: SWAP_LINES[SWAP_A][0] }; return d; };
  // Before this round the third case's Terra#2 (every number right, line 8 listed before line 7) "confirmed" the verifier's 6
  // on line 7 with its reading of line 8; now no fourth call is made at all, so it is never asked.
  for (const [label, reads, verifier, outcome, products] of [
    ['a cheap read lists A (line 7) after line 6', [answer(swapDoc({ 9: { money: 56 } })), answer(swapOrdered({ 15: { money: 66 } }, SWAP_ORDER.map(i => i === SWAP_A - 1 ? SWAP_A : i === SWAP_A ? SWAP_A - 1 : i)))],
      SWAPPED(), 'not_needed', SWAP_CATALOG],
    ['a cheap read skipped A and read line 3 twice', [answer(swapDoc({ 9: { money: 56 } })), answer(swapOrdered({ 15: { money: 66 } }, [0, 1, 2, 2, ...SWAP_ORDER.filter(i => i > 2 && i !== SWAP_A)]))],
      SWAPPED(), 'not_needed', SWAP_CATALOG],
    ['one product on lines 7 and 8', [answer(dup({ 9: { money: 56 } })), answer(dup({ [SWAP_A]: { qty: 1, money: 48.32 }, 15: { money: 66 } }))],
      answer(dup({ [SWAP_A]: { qty: 6, money: 23.16 }, [SWAP_B]: { qty: 12, money: 46.32 } })), 'not_matchable', dupCatalog],
  ]) {
    // Three answers each: a fourth call would find no answer (the fake model's assertion fails that read) and is counted.
    const off = await service([...reads, verifier], { SECOND_STRONG_READ: 'off' }, { products });
    const on = await service([...reads, verifier], {}, { products });
    assert.equal(on.calls.length, 3, label + ': no fourth call');
    assert.equal(on.output.scan.verification.secondVerifier.outcome, outcome, label);
    const c = await swapScanInApp(structuredClone(on.output)), old = await swapScanInApp(structuredClone(off.output));
    assert.deepEqual(swapRowsOf(c), SWAP_PENDING, label);
    assert.deepEqual(pending(c).map(r => r.rowIndex), [SWAP_A, SWAP_B], label);
    assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, label + ': the receipt waits for the worker');
    assert.deepEqual(swapRowsOf(old), swapRowsOf(c), label + ': what the switch off shows');
  }
});

// ---- the card's "החשבון לא מכריע" and read 4 ----
// Since the second review round the app's own arithmetic counts read 4 (read 3) only in a row whose quantity the service
// asked it about. In a row where read 4 closed the money but was not asked about the quantity, the card listed the money
// as "לא מוסכם בין הקריאות" — though read 4 had agreed with the selected read on it. The card now says what is true: the
// money was confirmed by read 4 only, which was not asked about the quantity (so it does not prove it).
const SECOND_ONLY = 'סכום השורה והסכום לפני הנחה אושרו רק בקריאה הרביעית \\(המודל החזק, פעם שנייה\\), שלא נשאלה על הכמות';
const reasonsLine = html => (html.match(/<p class="mt-1">החשבון לא מכריע: [^<]*<\/p>/) || [''])[0];

test('the card: money read 4 confirmed in a row it was not asked the quantity of is not "not agreed between the reads" — read 4 is named, as the reason it proves no quantity', { skip: skip153 }, async () => {
  // The milky row: the cheap reads saw 16.13 / 96.78 and 16.3 / 97.80, the verifier 16.03 / 96.18, Terra#2 16.13 / 96.18. The
  // quantity (6) is agreed; Terra#2 closes the gross and the net and leaves the unit price to the worker.
  const read = (unit, money) => { const rows = readRows('selected'); Object.assign(rows[MILKY], { unitPriceExVat: unit, grossLineTotalExVat: money, lineTotalExVat: money }); return answer(modelDoc(rows)); };
  const { output, calls } = await service([read(16.13, 96.78), read(16.3, 97.8), read(16.03, 96.18), read(16.13, 96.18)]);
  assert.equal(calls.length, 4);
  const proof = output.scan.documents[0].rows[MILKY].modelVerification;
  assert.deepEqual(proof.issues, ['unitPriceExVat']);
  assert.deepEqual([proof.fieldSupport.grossLineTotalExVat, proof.fieldSupport.lineTotalExVat], [[3], [3]]);
  assert.deepEqual(proof.secondStrongRead.fields, ['unitPriceExVat', 'grossLineTotalExVat', 'lineTotalExVat']);
  const { c } = await scanInApp(structuredClone(output));
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + R + ', true).reasons'), ['unit', 'net_second', 'gross_second']);
  const line = reasonsLine(auditHtml(c));
  assert.match(line, new RegExp('החשבון לא מכריע: מחיר היחידה לא מוסכם בין הקריאות · ' + SECOND_ONLY + '\\.'));
  assert.doesNotMatch(line, /סכום השורה לא מוסכם|הסכום לפני הנחה לא מוסכם/);
});

test('against the real service v153: a cheap read that read a quantity as null does not split it — the swapped quantities stay with the worker, and the card says read 4 confirmed only the money', { skip: skip153 }, async () => {
  // The reviewers' field-level null case on the 22-row swap paper: cheap read 0 left A's and B's quantities unread (null) but read
  // their money right; cheap read 1 read the quantities right and slipped a digit of the money. Both strong reads swap A and B.
  const nullQuantities = swapDoc({ 9: { money: 56 } }); for (const i of [SWAP_A, SWAP_B]) nullQuantities.rows[i].quantity = null;
  const cheap = [answer(nullQuantities), answer(swapDoc({ [SWAP_A]: { money: 48.32 }, [SWAP_B]: { money: 28.16 } }))];
  const off = await service([...cheap, SWAPPED()], { SECOND_STRONG_READ: 'off' }, { products: SWAP_CATALOG });
  const on = await service([...cheap, SWAPPED(), SWAPPED()], {}, { products: SWAP_CATALOG });
  assert.equal(on.calls.length, 4);
  const second = on.output.scan.verification.secondVerifier;
  assert.deepEqual(second.closed.map(e => [e.rowIndex, e.field]), [SWAP_A, SWAP_B].flatMap(i => [[i, 'grossLineTotalExVat'], [i, 'lineTotalExVat']]));
  assert.deepEqual(second.notAsked.map(e => [e.rowIndex, e.field, e.reason]), [[SWAP_A, 'quantity', 'cheap_not_read'], [SWAP_B, 'quantity', 'cheap_not_read']]);
  const c = await swapScanInApp(structuredClone(on.output)), old = await swapScanInApp(structuredClone(off.output));
  assert.deepEqual(swapRowsOf(c), [[6, ['quantity']], [12, ['quantity']]], 'the money closed; the swapped quantities wait for the worker');
  assert.deepEqual(pending(c).map(r => r.rowIndex), [SWAP_A, SWAP_B]);
  assert.deepEqual(pending(old).map(r => r.rowIndex), [SWAP_A, SWAP_B]);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false);
  const A = 'aiScanResponse.scan.documents[0].rows[' + SWAP_A + ']';
  assert.equal(c.run('priceAuditQuantityArithmetic(' + A + ', true).proven'), false, 'read 4 was not asked about the quantity');
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + A + ', true).reasons'), ['net_second', 'gross_second']);
  assert.match(auditHtml(c), new RegExp('<p class="mt-1">החשבון לא מכריע: ' + SECOND_ONLY + '\\.</p>'));
});

// ---- service 153, fourth review round: the reading of a row is the reading of that paper ----
// The reviewers' repro-doc-swap. Two one-page notes of one supplier in one scan ("+ תעודה נוספת מהנהג / הספק"), the same 8
// products in the same order. A (line 3) and B (line 4) have the same unit price, 3.86; note 0 prints A 12 / 46.32 and B 6 / 23.16.
// Until this round the service found each read's note by the noteIndex the read reported about itself. A read that returned the
// two notes under each other's noteIndex then "read" the line from the other paper (same page, line and product, the product
// unique in each note), and with the switch on the app accepted Terra's swap of A and B on note 0 with no card (valid: true).
// Now, in a scan of several notes, a read's note is the same paper only with the same invoice number.
const DOC_A = 2, DOC_B = 3;
const DOC_NAMES = ['גבינה לבנה 5%', 'יוגורט 3%', 'שוקו בקבוק 1 ליטר', 'שוקו בקבוק חצי ליטר', 'חלב 3% קרטון', 'קוטג׳ 5%', 'שמנת חמוצה', 'לבן 1.5%'];
const docPrice = i => i === DOC_A || i === DOC_B ? 3.86 : 5;
const DOC_PRODUCTS = DOC_NAMES.map((name, i) => ({ id: 'ds_' + (i + 1), name, barcode: ean13('72900004' + String(i + 1).padStart(4, '0')), price: docPrice(i) }));
const DOC_CATALOG = DOC_PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode }));
const DOC_Q0 = [13, 13, 12, 6, 13, 13, 13, 13], DOC_N0 = '9073800101', DOC_N1 = '9073800102';
const docRow = (i, qty, money = r2(qty * docPrice(i))) => ({ sourcePage: 1, lineNumber: i + 1, rowRegion: null, barcode: DOC_PRODUCTS[i].barcode, barcodeReadType: 'full',
  catalogHintId: null, catalogCandidateHintIds: [], supplierItemCode: null, description: DOC_NAMES[i], quantity: qty, unitPriceExVat: docPrice(i),
  grossLineTotalExVat: money, lineDiscountExVat: 0, lineTotalExVat: money, promotionText: null, confidence: 0.9 });
// One note as a read returned it: noteIndex — the label the read gave it; Q and the number — the paper it really read.
const docNote = (noteIndex, Q, invoiceNumber, edit = {}) => { const sub = r2(Q.reduce((n, q, i) => n + r2(q * docPrice(i)), 0));
  return { noteIndex, invoiceNumber, pageCount: 1, subtotalExVat: sub, vatAmount: r2(sub * 0.18), totalInclVat: r2(sub * 1.18), printedUnits: Q.reduce((n, q) => n + q, 0),
    printedLines: 8, documentDiscountExVat: null, confidence: 0.9, warnings: [], rows: Q.map((q, i) => edit[i] ? docRow(i, edit[i].qty, edit[i].money) : docRow(i, q)) }; };
const notesAnswer = docs => ({ output_text: JSON.stringify({ documents: docs, warnings: [] }) });
const docSwapped = () => docNote(0, DOC_Q0, DOC_N0, { [DOC_A]: { qty: 6, money: 23.16 }, [DOC_B]: { qty: 12, money: 46.32 } });
const TWO_NOTES = [0, 1].map(noteIndex => ({ noteIndex, pages: [image], expectedSubtotalExVat: null, expectedUnits: null }));
async function twoNotesInApp(paper) {
  const data = fixture('yotvata');
  data.products = DOC_PRODUCTS.map(p => ({ ...p })); data.items = []; data.paper = paper;
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened=false;receiptList=[];receiptDupConfirmed=true;
    aiScanDocuments=[0,1].map(noteIndex=>({noteIndex,amount:null,units:null,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]}));`);
  await c.run('yotvataStartPaperScan()');
  c.run("receiptDocDate='2026-09-25';saveReceiptDraft();renderReceiving()");
  assert.equal(c.run('receiptPaperScanState'), 'ok', c.run('JSON.stringify(receiptPaperScanProblems)'));
  return c;
}
const docRowsOf = c => [DOC_A, DOC_B].map(i => [c.run('aiScanResponse.scan.documents[0].rows[' + i + '].quantity'),
  json(c, 'aiModelReviewIssues(aiScanResponse.scan.documents[0].rows[' + i + '])')]);
const notesPending = c => pending(c).map(r => [r.documentIndex, r.rowIndex]);

test('against the real service v153: two notes of one supplier — a read that returned the notes under each other\'s noteIndex never confirms the other paper\'s line; A and B with the worker as with the switch off', { skip: skip153 }, async () => {
  const t2Q1 = [10, 10, 6, 12, 10, 10, 10, 10], cheapQ1 = [10, 10, 7, 5, 10, 10, 10, 10];
  for (const [label, reads, fourth, calls, outcome] of [
    // case 't2': note 1 prints A 6 and B 12 (Terra#1's swap on note 0). Cheap read 0 reads A and B as packs, cheap read 1 reads them right
    // and slips line 6's money. Terra#2 reads every number right but returns note 1 as noteIndex 0 — its vote is not counted.
    ['Terra#2 returned note 1 as noteIndex 0', [notesAnswer([docNote(0, DOC_Q0, DOC_N0, { [DOC_A]: { qty: 1, money: 3.86 }, [DOC_B]: { qty: 1, money: 3.86 } }), docNote(1, t2Q1, DOC_N1)]),
      notesAnswer([docNote(0, DOC_Q0, DOC_N0, { 5: { qty: 13, money: 66 } }), docNote(1, t2Q1, DOC_N1)]), notesAnswer([docSwapped(), docNote(1, t2Q1, DOC_N1)])],
      notesAnswer([docNote(0, t2Q1, DOC_N1), docNote(1, DOC_Q0, DOC_N0)]), 4, 'disagreed'],
    // case 'cheap': cheap read 0 returns note 1 (A 7, B 5) as noteIndex 0; cheap read 1 reads note 0 right. By the paper read 1 is a lone
    // cheap read that saw the printed values, so nothing is asked.
    ['a cheap read returned note 1 as noteIndex 0', [notesAnswer([docNote(0, cheapQ1, DOC_N1), docNote(1, DOC_Q0, DOC_N0, { 5: { qty: 13, money: 66 } })]),
      notesAnswer([docNote(0, DOC_Q0, DOC_N0, { 6: { qty: 13, money: 66 } }), docNote(1, cheapQ1, DOC_N1)]), notesAnswer([docSwapped(), docNote(1, cheapQ1, DOC_N1)])],
      notesAnswer([docSwapped(), docNote(1, cheapQ1, DOC_N1)]), 3, 'not_needed'],
  ]) {
    const off = await service(reads.slice(), { SECOND_STRONG_READ: 'off' }, { products: DOC_CATALOG, documents: TWO_NOTES });
    const on = await service(calls === 4 ? [...reads, fourth] : reads.slice(), {}, { products: DOC_CATALOG, documents: TWO_NOTES });
    assert.equal(on.calls.length, calls, label);
    const second = on.output.scan.verification.secondVerifier;
    assert.equal(second.outcome, outcome, label); assert.deepEqual(second.closed, [], label);
    const c = await twoNotesInApp(structuredClone(on.output)), old = await twoNotesInApp(structuredClone(off.output));
    assert.deepEqual(docRowsOf(c), [[6, ['quantity', 'grossLineTotalExVat', 'lineTotalExVat']], [12, ['quantity', 'grossLineTotalExVat', 'lineTotalExVat']]], label);
    assert.ok(notesPending(c).some(([d, i]) => d === 0 && i === DOC_A) && notesPending(c).some(([d, i]) => d === 0 && i === DOC_B), label + ': A and B are pending');
    assert.deepEqual(notesPending(c), notesPending(old), label + ': what the switch off shows');
    assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, label + ': the receipt waits for the worker');
    assert.deepEqual(docRowsOf(old), docRowsOf(c), label);
  }
});

// ---- service 153, fifth review round: a quantity both cheap reads read alike by the printed line, even when the vote "supported" another ----
// The reviewers' repro-qty-hidden on the 22-row swap paper. Cheap read 0 reads A and B right (and slips row 10's money); cheap read 1
// reads both quantities right (A 12, B 6), slips both moneys (48.32, 28.16) and lists line 8 before line 7. Terra#1 and Terra#2 swap A
// and B. The vote's positional alignment credits cheap read 1's B (6) to Terra's A and its A (12) to Terra's B, so service 152 leaves only
// the money open. Until this round step 3 then asked that money by the printed line, Terra#2 confirmed it, and the app showed no card:
// valid: true, A accepted as 6 (printed 12) and B as 12 (printed 6). Now the service asks nothing in a row whose quantity both cheap
// reads read alike on that printed line, unlike Terra#1 — whether or not service 152 left the quantity open.
test('against the real service v153: a cheap read that lists line 8 before line 7 never lets Terra#2 close the money of the swapped rows — no fourth call, A and B with the worker as with the switch off', { skip: skip153 }, async () => {
  const order = SWAP_ORDER.map(i => i === SWAP_A ? SWAP_B : i === SWAP_B ? SWAP_A : i);
  const reads = () => [answer(swapDoc({ 9: { money: 56 } })), answer(swapOrdered({ [SWAP_A]: { money: 48.32 }, [SWAP_B]: { money: 28.16 } }, order)), SWAPPED()];
  // Three answers each: a fourth call would find no answer (the fake model's assertion fails that read) and is counted.
  const off = await service(reads(), { SECOND_STRONG_READ: 'off' }, { products: SWAP_CATALOG });
  const on = await service(reads(), {}, { products: SWAP_CATALOG });
  assert.equal(on.calls.length, 3, 'no fourth call');
  assert.equal(on.output.scan.verification.secondVerifier.outcome, 'not_needed');
  assert.deepEqual(on.output.scan.verification.secondVerifier.closed, []);
  const c = await swapScanInApp(structuredClone(on.output)), old = await swapScanInApp(structuredClone(off.output));
  const MONEY = ['grossLineTotalExVat', 'lineTotalExVat'];
  assert.deepEqual(swapRowsOf(c), [[6, MONEY], [12, MONEY]], 'the swapped quantities (printed 12 and 6) wait for the worker with their money');
  assert.deepEqual(pending(c).map(r => r.rowIndex), [SWAP_A, SWAP_B]);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, 'the receipt waits for the worker');
  assert.deepEqual(swapRowsOf(old), swapRowsOf(c), 'what the switch off shows');
  assert.deepEqual(pending(old).map(r => r.rowIndex), pending(c).map(r => r.rowIndex));
});

// The same root without the cheap reads agreeing: cheap read 0 left A's and B's quantities unread (null) and read their money right;
// cheap read 1 is the one above (quantities right, money slipped, line 8 listed first). By the printed line no cheap read read
// Terra#1's quantity, and the only one that read it saw the printed value. Until this round the money closed and A and B passed
// with no card; now a row whose quantity the vote "supported" only through another printed line is not asked about.
test('against the real service v153: a cheap read that left A and B null and one that listed line 8 first — no fourth call, A and B with the worker as with the switch off', { skip: skip153 }, async () => {
  const order = SWAP_ORDER.map(i => i === SWAP_A ? SWAP_B : i === SWAP_B ? SWAP_A : i);
  const nullQuantities = swapDoc({ 9: { money: 56 } }); for (const i of [SWAP_A, SWAP_B]) nullQuantities.rows[i].quantity = null;
  const reads = () => [answer(structuredClone(nullQuantities)), answer(swapOrdered({ [SWAP_A]: { money: 48.32 }, [SWAP_B]: { money: 28.16 } }, order)), SWAPPED()];
  // Three answers each: a fourth call would find no answer (the fake model's assertion fails that read) and is counted.
  const off = await service(reads(), { SECOND_STRONG_READ: 'off' }, { products: SWAP_CATALOG });
  const on = await service(reads(), {}, { products: SWAP_CATALOG });
  assert.equal(on.calls.length, 3, 'no fourth call');
  const second = on.output.scan.verification.secondVerifier;
  assert.equal(second.outcome, 'not_needed'); assert.deepEqual(second.closed, []);
  assert.deepEqual([...new Set(second.notAsked.map(e => e.reason))], ['cheap_quantity_unconfirmed']);
  const c = await swapScanInApp(structuredClone(on.output)), old = await swapScanInApp(structuredClone(off.output));
  const MONEY = ['grossLineTotalExVat', 'lineTotalExVat'];
  assert.deepEqual(swapRowsOf(c), [[6, MONEY], [12, MONEY]]);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [SWAP_A, SWAP_B]);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), false, 'the receipt waits for the worker');
  assert.deepEqual(swapRowsOf(old), swapRowsOf(c), 'what the switch off shows');
  assert.deepEqual(pending(old).map(r => r.rowIndex), pending(c).map(r => r.rowIndex));
});
