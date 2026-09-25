// v367: the contract with the companion service on the field case of quantity-arithmetic.test.mjs, checked
// against the REAL service code — never against a fixture that only imitates its answer (the pattern of
// credit-service-contract.test.mjs). The three model reads of invoice 9073807997 (the shop's backup of
// 2026-09-25 12:03) go through the service's createServer in-process (fake OpenAI, a locally signed
// Firebase token, no paid call, no live network): cheap read 0 halves rows 6 and 18 (units 272, paper
// check failed), cheap read 1 has every quantity right and balances (selected), and the verifier reads the
// packages column (units 25, failed, not selected). The service's exact JSON answer is then handed to the
// complete app module (receipt-scan-harness) through the real invoice scan path (yotvataStartPaperScan), and
// the price audit must show no pending row: with a v149 answer (rows 6 and 18 needs_review, issues
// ['quantity'], no read supporting the quantity) through the app's own arithmetic; with a v150 answer
// (rows verified, fieldSupport.quantity ['arithmetic'], modelVerification.arithmetic.quantity) through the
// service's marker. Needs the service checkout next to this one (../yotvata-ai-scan, or
// YOTVATA_AI_SCAN=<dir>); skipped, with a message, when it is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime, fixture } from './receipt-scan-harness.mjs';
import { PRODUCTS, SUBTOTAL, UNITS, FIELD_ROWS, catalog, readRows, modelDoc, ean13 } from './quantity-arithmetic-fixture.mjs';
import { creditInvoiceData } from './credit-verified-fixture.mjs';

const serviceDir = process.env.YOTVATA_AI_SCAN || fileURLToPath(new URL('../../yotvata-ai-scan/', import.meta.url));
const serverFile = new URL('server.js', pathToFileURL(serviceDir.endsWith('/') ? serviceDir : serviceDir + '/'));
const skip = fs.existsSync(serverFile) ? false : 'the companion service is not checked out next to this repo (set YOTVATA_AI_SCAN=<dir of yotvata-ai-scan>)';
const { createServer, yotvataPaperCheck, yotvataCreditPaperCheck } = skip ? {} : await import(serverFile.href);
// v150's rule function (absent in a v149 checkout, whose answer on a deposit row is needs_review as well).
const { quantityArithmetic } = skip ? {} : await import(new URL('scan-consensus.js', serverFile).href);

// ---- the service, in-process: the same harness as its own tests (test-document-summary.mjs) ----
const image = 'data:image/jpeg;base64,YQ==';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({
  aud: 'globrands-db', iss: 'https://securetoken.google.com/globrands-db', sub: 'fixture', iat: now, exp: now + 3600 });
const token = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
const answer = d => ({ output_text: JSON.stringify({ documents: [d], warnings: [] }) });
async function service(responses, { catalog: sent = catalog, pages = 3, documentKind = null } = {}) {
  const calls = [];
  const server = createServer({ env: { OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'gpt-5.6-luna',
    OPENAI_RETRY_MODEL: 'gpt-5.6-terra', OPENAI_RETRY_SERVICE_TIER: 'priority' },
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
  // The body the app sends for an invoice (aiRequestInvoiceScan): the pages, no typed anchors, the catalog
  // (and, for a driver credit, documentKind 'credit').
  const body = { reviewProtocolVersion: 1, documents: [{ noteIndex: 0, pages: Array.from({ length: pages }, () => image), expectedSubtotalExVat: null, expectedUnits: null }],
    receivedProductIds: [], catalog: sent, ...(documentKind ? { documentKind } : {}) };
  const output = await new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.url = '/scan'; req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { origin: 'https://asafkiri.github.io', authorization: 'Bearer ' + token };
    server.emit('request', req, { headersSent: false, writeHead() { this.headersSent = true; }, write() {}, end(body) { resolve(JSON.parse(body)); } });
  });
  server.close();
  assert.equal(responses.length, 0, 'every prepared model answer was used');
  return { output, calls };
}

// ---- the app: the photo gate of a new receipt, three pages photographed, the read fired ----
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
async function scanInApp(paper, { products = PRODUCTS, pages = 3 } = {}) {
  const data = fixture('yotvata');
  data.products = products.map(p => ({ ...p }));
  data.items = [];
  data.paper = paper; // what fetch('/scan') answers: the service's real answer, untouched
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened=false;receiptList=[];receiptDupConfirmed=true;
    aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:Array.from({length:${pages}},()=>({dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}))}];`);
  await c.run('yotvataStartPaperScan()');
  c.run("receiptDocDate='2026-09-25';saveReceiptDraft();renderReceiving()");
  assert.equal(c.requests.filter(r => r.url.endsWith('/scan')).length, 1, 'one paid read');
  return c;
}

test('the field case against the real service: the selected read balances, rows 6 and 18 have no read supporting the quantity, and the app shows no pending row', { skip }, async () => {
  const halved = modelDoc(readRows('halved')), selected = modelDoc(readRows('selected')), packages = modelDoc(readRows('packages'));
  assert.deepEqual([yotvataPaperCheck(halved, 3).ok, yotvataPaperCheck(selected, 3).ok, yotvataPaperCheck(packages, 3).ok], [false, true, false]);
  assert.deepEqual([yotvataPaperCheck(halved, 3).rowUnits, yotvataPaperCheck(selected, 3).rowUnits, yotvataPaperCheck(packages, 3).rowUnits], [272, 285, 25]);
  const { output, calls } = await service([answer(halved), answer(selected), answer(packages)]);
  assert.deepEqual(calls.map(c => c.model), ['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra'], 'the quantity dispute escalated to the verifier');
  assert.equal(output.ok, true, JSON.stringify(output).slice(0, 300));
  assert.ok(output.serviceVersion >= 149, 'service v' + output.serviceVersion);
  assert.equal(output.scan.verification.selectedRead, 1, 'the balanced cheap read is selected');
  assert.equal(output.scan.verification.verifier.selected, false);
  assert.equal(output.paperValidation[0].ok, true);
  const doc = output.scan.documents[0];
  assert.deepEqual([doc.subtotalExVat, doc.printedUnits, doc.rows.length], [SUBTOTAL, UNITS, 22]);
  assert.deepEqual(doc.modelVerification.issues, []);
  for (const i of FIELD_ROWS) {
    const proof = doc.rows[i].modelVerification;
    assert.equal(doc.rows[i].barcodeMatchMethod, 'model_consensus');
    assert.deepEqual([doc.rows[i].quantity, doc.rows[i].unitPriceExVat, doc.rows[i].lineTotalExVat], i === 5 ? [6, 16.03, 96.18] : [20, 12.53, 250.6], 'the OCR values as read');
    assert.deepEqual(proof.readings.map(r => [r.read, r.values.quantity]), i === 5 ? [[1, 6], [0, 3], [2, 2]] : [[1, 20], [0, 10], [2, 2]]);
    assert.deepEqual([proof.fieldSupport.unitPriceExVat, proof.fieldSupport.lineTotalExVat, proof.fieldSupport.grossLineTotalExVat], [[0, 2], [0, 2], [0, 2]]);
    if (output.serviceVersion >= 150) {
      // v150: the service proves the quantity itself and says so.
      assert.deepEqual(proof.issues, [], 'row ' + (i + 1));
      assert.equal(proof.status, 'verified');
      assert.deepEqual(proof.fieldSupport.quantity, ['arithmetic']);
      assert.deepEqual(proof.arithmetic, { quantity: i === 5 ? { unit: 16.03, gross: 96.18, net: 96.18, printedUnitsBalanced: true } : { unit: 12.53, gross: 250.6, net: 250.6, printedUnitsBalanced: true } });
    } else {
      // v149: the shape of the backup — the app's own arithmetic has to settle it.
      assert.deepEqual(proof.issues, ['quantity'], 'row ' + (i + 1));
      assert.equal(proof.status, 'needs_review');
      assert.deepEqual(proof.fieldSupport.quantity, []);
    }
  }
  assert.ok(doc.rows.every((r, i) => FIELD_ROWS.includes(i) || (r.modelVerification.status === 'agreed' && r.modelVerification.issues.length === 0)));
  if (output.serviceVersion >= 150) {
    assert.equal(output.scan.verification.status, 'verified');
    assert.equal(output.scan.verification.verifier.outcome, 'agreed');
    assert.equal(output.scanAudit.result, 'paper_verified');
  } else {
    assert.equal(output.scan.verification.status, 'needs_review');
    assert.equal(output.scan.verification.verifier.outcome, 'disagreed');
  }

  const c = await scanInApp(structuredClone(output));
  assert.equal(c.run('receiptPaperScanState'), 'ok', c.run('JSON.stringify(receiptPaperScanProblems)'));
  assert.equal(json(c, 'aiScanResponse.perDocument[0].verification.selectedRead'), 1);
  const audit = json(c, 'receiptPriceAudit()');
  assert.equal(audit.state, 'ready');
  assert.equal(audit.rows.length, 22);
  assert.deepEqual(json(c, 'priceAuditPendingRows(receiptPriceAudit())'), [], 'no "נשארו 2 שורות לטיפול"');
  assert.equal(audit.complete, true);
  assert.deepEqual(FIELD_ROWS.map(i => [audit.rows[i].capability, audit.rows[i].result, audit.rows[i].quantity]), [['checkable', 'match', 6], ['checkable', 'match', 20]]);
  for (const i of FIELD_ROWS) {
    assert.deepEqual(json(c, 'aiModelReviewIssues(aiScanResponse.scan.documents[0].rows[' + i + '])'), []);
    assert.equal(c.run('priceAuditConsensusConfirmed(aiScanResponse.scan.documents[0].rows[' + i + '])'), true);
  }
  const html = c.run('receiptPriceAuditHtml()');
  assert.match(html, /המחירים שנבדקו תואמים · 22 שורות · אין מה לאשר/);
  assert.doesNotMatch(html, /צריך להשלים את הבדיקה|price-confirm-values|data-price-row=/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true, JSON.stringify(json(c, 'aiEvaluateInvoiceScan(aiScanResponse).errors')));
  // The paper is as the service returned it: nothing filled or altered on the way.
  assert.deepEqual(json(c, 'aiScanResponse.scan.documents[0].rows.map(r => paperRowValues(r))'), doc.rows.map(r => ({ quantity: r.quantity, unitPriceExVat: r.unitPriceExVat,
    grossLineTotalExVat: r.grossLineTotalExVat, lineDiscountExVat: r.lineDiscountExVat, lineTotalExVat: r.lineTotalExVat })));
  assert.deepEqual(json(c, 'aiScanResponse.scan.documents[0].rows[5].modelVerification.issues'), doc.rows[5].modelVerification.issues);
  // The draft restores the same conclusion.
  const reloaded = runtime('yotvata', { data: c.context.testData, storage: c.storage });
  assert.deepEqual(json(reloaded, 'priceAuditPendingRows(receiptPriceAudit())'), []);
  assert.equal(reloaded.requests.length, 0);
});

test('against the real service, a quantity the arithmetic does not prove still reaches the worker with the readings', { skip }, async () => {
  // The selected read reads row 6's unit price as 16.04 in all three reads: 6 × 16.04 ≠ 96.18, the paper
  // still balances, the verifier still fails on the units total.
  const reads = ['halved', 'selected', 'packages'].map(kind => { const rows = readRows(kind); rows[5].unitPriceExVat = 16.04; return modelDoc(rows); });
  const { output, calls } = await service(reads.map(answer));
  assert.equal(calls.length, 3);
  const doc = output.scan.documents[0];
  assert.equal(output.scan.verification.selectedRead, 1);
  assert.deepEqual(doc.rows[5].modelVerification.issues, ['quantity'], 'no arithmetic marker for a quantity the arithmetic does not prove');
  assert.deepEqual(doc.rows[5].modelVerification.fieldSupport.quantity, []);
  assert.equal(doc.rows[5].modelVerification.arithmetic, undefined);
  assert.equal(doc.rows[5].unitPriceExVat, 16.04);
  if (output.serviceVersion >= 150) assert.deepEqual(doc.rows[17].modelVerification.issues, [], 'row 18 (20 × 12.53) is proven');
  const c = await scanInApp(structuredClone(output));
  assert.deepEqual(json(c, 'priceAuditPendingRows(receiptPriceAudit())').map(r => r.rowIndex), [5]);
  const html = c.run('receiptPriceAuditHtml()');
  assert.match(html, /צריך להשלים את הבדיקה/);
  assert.match(html, /הקריאות לא הסכימו על הכמות: קריאה 1 – 3 · קריאה 2 – 6 · קריאה 3 \(המודל החזק\) – 2\./);
  assert.match(html, /החשבון לא מכריע: מחיר היחידה × הכמות לא יוצא סכום השורה באף אחת מהקריאות\./);
  assert.match(html, /data-role="price-confirm-values"/);
  assert.match(html, /data-role="paper-row-edit"/);
});

test('against the real service, a row only one read parsed is explained as a single read — never as reads that did not agree', { skip }, async () => {
  // The v365 field scenario: cheap read 0 fails on the network, cheap read 1 balances and is selected, the
  // verifier times out. The service's real answer for every row: one reading, no field supported by
  // another read, every financial field and the identity in issues — a shape the imitated fixture
  // (readings spliced, fieldSupport kept) never produces.
  const { output, calls } = await service([new Error('network failure'), answer(modelDoc(readRows('selected'))), new Error('verifier timeout')]);
  assert.equal(calls.length, 3, 'the failed cheap read still escalates to the verifier');
  assert.equal(output.ok, true, JSON.stringify(output).slice(0, 300));
  assert.equal(output.scan.verification.verifier.outcome, 'failed');
  assert.equal(output.paperValidation[0].ok, true, 'the selected read balances');
  const proof = output.scan.documents[0].rows[0].modelVerification;
  assert.equal(proof.readings.length, 1);
  assert.deepEqual(Object.values(proof.fieldSupport), [[], [], [], [], []]);
  assert.deepEqual(proof.issues, ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat', 'identity']);
  const c = await scanInApp(structuredClone(output));
  // The worker confirms the product first (the identity card); then the financial card renders.
  const candidate = json(c, 'receiptPriceAudit().rows[0].identityConfirmation');
  assert.ok(candidate && candidate.productId, 'an identity candidate is offered');
  await c.click('price-confirm-identity', '', { doc: '0', row: '0', candidateId: candidate.productId, candidateBarcode: candidate.barcode,
    reviewToken: c.run('priceAuditIdentityReviewToken(aiSourceRow(0,0), ' + JSON.stringify(candidate) + ')') });
  assert.deepEqual(json(c, 'receiptPriceAudit().rows[0].modelReviewIssues'), ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat']);
  const html = c.run('receiptPriceAuditHtml()');
  const block = (html.match(/<div class="mt-2 text-sm text-slate-700" data-row-dispute>[\s\S]*?<\/div>/) || [''])[0];
  assert.match(block, /<p>רק קריאה אחת קראה את השורה הזאת \(הקריאה השלישית, המודל החזק, נכשלה\), ולכן אין קריאה נוספת שמאשרת את הכמות, מחיר היחידה, הסכום לפני הנחה, ההנחה ואת הסכום\.<\/p>/);
  // One read cannot have "reads that did not agree", and the list after "מאשרת את" is joined with "ואת".
  assert.doesNotMatch(html, /לא מוסכם בין הקריאות|לא הסכימו|באף אחת מהקריאות/);
  assert.doesNotMatch(block, /ועל /);
  assert.doesNotMatch(block, /החשבון לא מכריע/, 'the paper balances and 13 × 5.00 = 65.00: no paper or arithmetic reason is left');
  assert.match(block, /<p class="mt-1 text-\[11px\] text-slate-400" dir="ltr">network_error<\/p>/);
  assert.match(html, /data-role="price-confirm-values"/);
  assert.match(html, /data-role="paper-row-edit"/);
  assert.deepEqual([c.run('aiSourceRow(0,0).mapped.quantity'), c.run('aiSourceRow(0,0).mapped.unitPriceExVat')], [13, 5], 'the OCR values are as read');
});

// ---- a deposit row: the service's own scenario (its test-quantity-arithmetic.mjs), invoice and credit ----
// Milk 10 × 5.00 = 50.00 (agreed) + "פיקדון בקבוק" printed 9 × 4.00 = 36.00; subtotal 86, printed units 10
// (a deposit row is not counted). The selected read swapped the deposit's quantity and price (4 × 9.00 = 36),
// the other cheap read 9 × 9.00 = 36 (the same wrong price, so the money is supported), the verifier
// 9 × 4.00 = 36 with subtotal 86.5 — fails the paper check, not selected. The paper check passes for any
// deposit quantity, so nothing on the paper corroborates 4 against two reads that said 9: the service
// leaves the quantity needs_review, and the app must keep it for the worker too (same rule, both repos).
const MILK = '7290000000008', DEPOSIT = ean13('729000000003');
const depositCatalog = [{ id: 'milk', name: 'חלב בדיקה', barcode: MILK }, { id: 'deposit', name: 'פיקדון בקבוק', barcode: DEPOSIT }];
const depositProducts = [{ id: 'milk', name: 'חלב בדיקה', barcode: MILK, price: 5 }, { id: 'deposit', name: 'פיקדון בקבוק', barcode: DEPOSIT, price: 4, deposit: 4 }];
const milkRow = (o = {}) => ({ sourcePage: 1, lineNumber: 1, rowRegion: null, barcode: MILK, barcodeReadType: 'full', catalogHintId: null, catalogCandidateHintIds: [],
  supplierItemCode: null, description: 'חלב בדיקה', quantity: 10, unitPriceExVat: 5, grossLineTotalExVat: 50, lineDiscountExVat: 0, lineTotalExVat: 50, promotionText: null, confidence: 0.95, ...o });
const depositRow = (qty, unit, sign) => milkRow({ lineNumber: 2, barcode: DEPOSIT, description: 'פיקדון בקבוק', quantity: sign * qty, unitPriceExVat: unit,
  grossLineTotalExVat: sign * 36, lineDiscountExVat: 0, lineTotalExVat: sign * 36 });
const depositDoc = (qty, unit, sign, overrides = {}) => ({ noteIndex: 0, invoiceNumber: sign < 0 ? '22229081' : '9073807998', pageCount: 1, subtotalExVat: sign * 86,
  vatAmount: sign * 15.48, totalInclVat: sign * 101.48, printedUnits: sign * 10, printedLines: 2, documentDiscountExVat: null, confidence: 0.95, warnings: [],
  rows: [milkRow({ quantity: sign * 10, grossLineTotalExVat: sign * 50, lineTotalExVat: sign * 50 }), depositRow(qty, unit, sign)], ...overrides });
const depositReads = sign => [depositDoc(4, 9, sign), depositDoc(9, 9, sign), depositDoc(9, 4, sign, { subtotalExVat: sign * 86.5 })].map(answer);
function assertDepositLeftToWorker(output, sign) {
  assert.equal(output.ok, true, JSON.stringify(output).slice(0, 300));
  assert.equal(output.scan.verification.selectedRead, 0);
  assert.equal(output.scan.verification.status, 'needs_review');
  assert.equal(output.scanAudit.result, 'needs_review');
  const doc = output.scan.documents[0], proof = doc.rows[1].modelVerification;
  assert.equal(doc.rows[0].modelVerification.status, 'agreed');
  assert.deepEqual([doc.rows[1].quantity, doc.rows[1].unitPriceExVat, doc.rows[1].barcodeMatchMethod], [sign * 4, 9, 'model_consensus'], 'the read values, as read');
  assert.deepEqual(proof.issues, ['quantity']);
  assert.equal(proof.status, 'needs_review');
  assert.deepEqual(proof.fieldSupport.quantity, []);
  assert.ok(proof.fieldSupport.unitPriceExVat.length && proof.fieldSupport.lineTotalExVat.length, 'the money is supported');
  assert.equal(proof.arithmetic, undefined, 'no arithmetic marker for a deposit row');
  assert.deepEqual(proof.readings.map(r => r.values.quantity), [4, 9, 9].map(q => sign * q));
  if (quantityArithmetic) assert.equal(quantityArithmetic(doc.rows[1], proof.fieldSupport, sign < 0), null, 'the service rule never proves a deposit quantity');
  return doc;
}

test('against the real service, a deposit row on an invoice: the service leaves its quantity needs_review and the app keeps the row pending with the reason', { skip }, async () => {
  for (const qty of [4, 9, 1, 100]) assert.equal(yotvataPaperCheck(depositDoc(qty, 9, 1), 1).ok, true, 'the paper check is ok for any deposit quantity');
  const { output, calls } = await service(depositReads(1), { catalog: depositCatalog, pages: 1 });
  assert.equal(calls.length, 3, 'the quantity dispute escalated to the verifier');
  const doc = assertDepositLeftToWorker(output, 1);
  const c = await scanInApp(structuredClone(output), { products: depositProducts, pages: 1 });
  assert.equal(c.run('receiptPaperScanState'), 'ok', c.run('JSON.stringify(receiptPaperScanProblems)'));
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 1).ok'), true);
  const R = 'aiScanResponse.scan.documents[0].rows[1]';
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + R + ', true)'), { proven: false, server: false, reasons: ['deposit'] });
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + R + ')'), ['quantity']);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + R + ')'), false);
  assert.equal(c.run('priceAuditConsensusConfirmed(aiScanResponse.scan.documents[0].rows[0])'), true, 'the product row is untouched');
  const audit = json(c, 'receiptPriceAudit()');
  assert.deepEqual(json(c, 'priceAuditPendingRows(receiptPriceAudit())').map(r => r.rowIndex), [1]);
  assert.equal(audit.complete, false);
  const html = c.run('receiptPriceAuditHtml()');
  assert.match(html, /צריך להשלים את הבדיקה/);
  assert.match(html, /הקריאות לא הסכימו על הכמות: קריאה 1 – 4 · קריאה 2 – 9 · קריאה 3 \(המודל החזק\) – 9\./);
  assert.match(html, /החשבון לא מכריע: שורת פיקדון לא נספרת בסך היחידות המודפס, ולכן הנייר לא מאשש את הכמות שלה\./);
  assert.match(html, /data-role="price-confirm-values"/);
  assert.match(html, /data-role="paper-row-edit"/);
  assert.doesNotMatch(html, /אין מה לאשר/);
  const evaluation = json(c, 'aiEvaluateInvoiceScan(aiScanResponse)');
  assert.equal(evaluation.valid, false);
  assert.ok(evaluation.errors.some(e => /שורה 2: הכמות או המחיר עדיין לא אומתו בין הסריקות/.test(e)), evaluation.errors.join(' | '));
  assert.deepEqual(evaluation.depositRows, [], 'no deposit line on a quantity the worker has not confirmed');
  assert.deepEqual([c.run(R + '.quantity'), c.run(R + '.unitPriceExVat')], [4, 9], 'the OCR values as returned');
  assert.deepEqual(json(c, R + '.modelVerification.issues'), doc.rows[1].modelVerification.issues, 'the service record as received');
});

test('against the real service in credit mode, a deposit row on a driver slip: the service leaves its quantity needs_review and the app does not attach the slip by itself', { skip }, async () => {
  assert.equal(yotvataCreditPaperCheck(depositDoc(4, 9, -1), 1).ok, true);
  const { output, calls } = await service(depositReads(-1), { catalog: depositCatalog, pages: 1, documentKind: 'credit' });
  assert.equal(calls.length, 3);
  assertDepositLeftToWorker(output, -1);
  // The app: the receiving session of quantity-arithmetic.test.mjs ("a driver credit…"), with the deposit
  // product in the catalog (a deposit row carries a barcode the app resolves, as on Yotvata paper).
  const data = creditInvoiceData();
  data.products.push(depositProducts[1]);
  const c = runtime('yotvata', { data });
  c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:9}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  data.paper = structuredClone(output); // what fetch('/scan') answers for the slip: the service's real answer
  c.run(`receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  const credit = json(c, 'receiptDeliveryCredits[0]');
  assert.equal(c.run('deliveryCreditPaperCheck(receiptDeliveryCredits[0].paper, 1)'), '', 'the slip balances in the app too');
  assert.deepEqual(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])').map(r => r.productId), ['milk', 'deposit'], 'both products resolved');
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(receiptDeliveryCredits[0].paper.rows[1], true, true)'), { proven: false, server: false, reasons: ['deposit'] });
  assert.deepEqual(json(c, 'deliveryCreditConsensus(receiptDeliveryCredits[0]).disputes'), ['הכמות בשורה 2']);
  assert.deepEqual(json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[0])').map(r => r.code), ['disputed']);
  assert.equal(credit.status, 'review');
  assert.equal(!!credit.autoConfirmed, false);
  assert.deepEqual(c.toasts, []);
  assert.match(c.run('deliveryCreditsHtml()'), /הקריאות לא הסכימו על הכמות בשורה 2 — בדוק מול הנייר/);
  assert.equal(credit.paper.rows[1].quantity, -4, 'the read value is kept, with its sign');
});
