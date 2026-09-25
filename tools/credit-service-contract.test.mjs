// v365: the contract with the companion service (yotvata-ai-scan v149), checked against the REAL service
// code — never against a fixture that only imitates its answer.
// Why: the app attaches a verified driver credit by itself only when the service's answer carries
// paper.modelVerification.support.invoiceNumber with at least one other read (deliveryCreditNumberUnsupported).
// The review of v365 found the app suite proving this with a fixture that fabricated that key while the
// service did not emit it: against the real service no credit ever attached by itself, and the card blamed
// the server ("מספר הזיכוי לא אומת בשרת"). These tests run the service's createServer in-process (fake OpenAI,
// a locally signed Firebase token, no paid call, no live network) on the shop's credit 22229080 from the
// backup of 2026-09-25 — one slip, two rows (ארגז שטראוס ×2 at 15.10, מוקה שקית ×10 at 12.53), −155.50 before
// VAT, −12 units, the two cheap reads exactly as the backup's readings recorded them and the real catalog
// rows — and hand its exact JSON answer to the complete app module (receipt-scan-harness), reading the
// credit as the automatic trigger does. They need the service checkout next to this one (../yotvata-ai-scan,
// or YOTVATA_AI_SCAN=<dir>) and are skipped, with a message, when it is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const serviceDir = process.env.YOTVATA_AI_SCAN || fileURLToPath(new URL('../../yotvata-ai-scan/', import.meta.url));
const serverFile = new URL('server.js', pathToFileURL(serviceDir.endsWith('/') ? serviceDir : serviceDir + '/'));
const skip = fs.existsSync(serverFile) ? false : 'the companion service is not checked out next to this repo (set YOTVATA_AI_SCAN=<dir of yotvata-ai-scan>)';
const { createServer } = skip ? {} : await import(serverFile.href);

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
// `responses` are the model's answers in call order; an Error is a failed call (dropped connection).
async function service(responses, catalog) {
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
  // The body the app sends for a driver credit (deliveryCreditTransport): one document, documentKind 'credit'.
  const body = { documents: [{ noteIndex: 0, pages: [image] }], catalog, reviewProtocolVersion: 1, documentKind: 'credit' };
  const output = await new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.url = '/scan'; req.socket = { remoteAddress: '127.0.0.1' };
    req.headers = { origin: 'https://asafkiri.github.io', authorization: 'Bearer ' + token };
    server.emit('request', req, { headersSent: false, writeHead() { this.headersSent = true; }, write() {}, end(body) { resolve(JSON.parse(body)); } });
  });
  server.close();
  assert.equal(responses.length, 0, 'every prepared model answer was used');
  return { output, calls: calls.length };
}

// ---- the field case: the backup's credit 22229080 ----
const ARLA = ['prod_4836d631-d2f4-42c2-84e3-3b46794793b9', 'prod_8e761c89-fbf2-4aa4-b85b-03ed7788620d', 'prod_0266c40a-4a99-47fc-9ae0-b4c98ec84946'];
const PRODUCTS = [
  { id: 'barcode_7290003029327', name: 'ארגז שטראוס חדש - פלסטיק 400*300', barcode: '7290003029327', price: 15.1, sku: '328330', defaultUnit: 'carton', hidden: true },
  { id: 'prod_12', name: 'שוקו שקית (מארז)', barcode: '7290003029792', price: 15.91, sku: '329102', defaultUnit: 'unit' },
  { id: 'prod_13', name: 'מוקה שקית (מארז)', barcode: '7290003029884', price: 12.53, sku: '329103', defaultUnit: 'unit' },
  { id: ARLA[0], name: 'ארלה גבינת שמנת טבעי 200 גרם', barcode: '5711953106583', price: 12.77, sku: '353994', defaultUnit: 'carton' },
  { id: ARLA[1], name: 'ארלה גבינת שמנת שום', barcode: '5711953106590', price: 12.77, sku: '353993', defaultUnit: 'carton' },
  { id: ARLA[2], name: 'ארלה גבינת שמנת עשבי תיבול', barcode: '5711953106606', price: 12.77, sku: '353995', defaultUnit: 'carton' }];
const catalog = PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode }));
const base = { sourcePage: 1, supplierItemCode: null, barcodeReadType: 'full', lineDiscountExVat: null, promotionText: null };
// Read 0 (selected in the backup): a catalog hint per row; the second row's hint pointed at the wrong sibling
// product (prod_12), the barcode settled it (prod_13). Read 1: no hints, an Arla candidate list on row 1.
const READ0 = [
  { ...base, lineNumber: null, rowRegion: { x: 27, y: 364, width: 839, height: 34 }, barcode: '7290003029327', catalogHintId: 'barcode_7290003029327', catalogCandidateHintIds: [], description: 'ארגז שטרא', quantity: -2, unitPriceExVat: 15.1, grossLineTotalExVat: -30.2, lineTotalExVat: -30.2, confidence: 0.91 },
  { ...base, lineNumber: null, rowRegion: { x: 27, y: 394, width: 839, height: 32 }, barcode: '7290003029884', catalogHintId: 'prod_12', catalogCandidateHintIds: [], description: 'שק 6 מארז שוק', quantity: -10, unitPriceExVat: 12.53, grossLineTotalExVat: -125.3, lineTotalExVat: -125.3, confidence: 0.84 }];
const READ1 = [
  { ...READ0[0], lineNumber: 1, catalogHintId: null, catalogCandidateHintIds: ARLA, description: 'ארלה שמנת' },
  { ...READ0[1], lineNumber: 2, catalogHintId: null, description: 'שק 6' }];
const slip = (rows, overrides = {}) => ({ noteIndex: 0, invoiceNumber: '22229080', pageCount: 1, subtotalExVat: -155.5, vatAmount: -27.99, totalInclVat: -183.49,
  printedUnits: -12, printedLines: 2, documentDiscountExVat: null, confidence: 0.9,
  warnings: ['זהו מסמך ביטול מכירה/תעודת זיכוי, ולכן הכמויות וסכומי השורות והסיכום הוחזרו בסימן שלילי.'], rows, ...overrides });

// ---- the app: the receiving screen of an open invoice, a driver credit photographed, its read fired ----
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const card = c => c.run('deliveryCreditsHtml()');
const reasonLines = html => [...html.matchAll(/<p data-credit-review-reason[^>]*>([^<]*)<\/p>/g)].map(m => m[1]);
const AUTO_TOAST = 'הזיכוי צורף למשלוח. בסיום הספירה נבדוק איזה חוסר הוא מכסה.';
async function readInApp(paper) {
  const data = fixture('yotvata');
  data.products.push(...structuredClone(PRODUCTS));
  const d = data.paper.scan.documents[0];
  Object.assign(d, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 50, printedUnits: 10, printedLines: 1, itemsPrintedLines: 1, itemsSectionTotalExVat: 50 });
  d.__pricePaper = structuredClone(d);
  const c = runtime('yotvata', { data });
  c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 50, units: 10, pageCount: 1 }] };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:50,units:10}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:9}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  data.paper = paper; // what fetch('/scan') answers from here on: the service's real answer, untouched
  c.run(`receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  assert.equal(c.requests.filter(r => r.url.endsWith('/scan')).length, 1, 'one paid read');
  return { c, credit: json(c, 'receiptDeliveryCredits[0]'), reasons: json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[0])'),
    rows: json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])').map(r => [r.productId, r.qty, r.amount]) };
}

test('the field case against the real service: two cheap reads agree on credit 22229080 — the answer names the number\'s support and the app attaches the credit by itself', { skip }, async () => {
  const { output, calls } = await service([answer(slip(READ0)), answer(slip(READ1))], catalog);
  assert.equal(calls, 2, 'no verifier: the cheap reads agreed');
  assert.ok(output.serviceVersion >= 149, 'service v' + output.serviceVersion);
  assert.equal(output.scan.verification.status, 'agreed');
  assert.equal(output.scanAudit.result, 'paper_verified');
  assert.equal(output.scanAudit.documentKind, 'credit');
  const doc = output.scan.documents[0];
  // The contract the app's gate relies on (deliveryCreditNumberUnsupported): support.invoiceNumber is an array
  // naming the other read. A fixture may not invent it — the service must send it.
  assert.deepEqual(doc.modelVerification.issues, []);
  assert.deepEqual(doc.modelVerification.support, { pageCount: [1], subtotalExVat: [1], printedUnits: [1], documentDiscountExVat: [1], rowCount: [1], invoiceNumber: [1] });
  assert.deepEqual(doc.rows.map(r => [r.barcode, r.barcodeMatchMethod, r.barcodeResolvedProductId, r.modelVerification.status, r.modelVerification.issues]),
    [['7290003029327', 'model_consensus', 'barcode_7290003029327', 'agreed', []], ['7290003029884', 'model_consensus', 'prod_13', 'agreed', []]]);
  // The paper is as read: no value filled or altered anywhere on the way.
  assert.deepEqual([doc.invoiceNumber, doc.subtotalExVat, doc.printedUnits, doc.documentDiscountExVat, doc.rows.map(r => r.lineTotalExVat)], ['22229080', -155.5, -12, null, [-30.2, -125.3]]);
  const { c, credit, reasons, rows } = await readInApp(structuredClone(output));
  assert.deepEqual(reasons, [], 'nothing is unclear');
  assert.equal(credit.status, 'confirmed');
  assert.equal(credit.autoConfirmed, true);
  assert.equal(credit.number, '22229080');
  assert.deepEqual(rows, [['barcode_7290003029327', 2, 30.2], ['prod_13', 10, 125.3]]);
  assert.equal(credit.paper.subtotalExVat, -155.5, 'the OCR paper is kept as read');
  assert.equal(credit.confirmedSignature, c.run('deliveryCreditSignature(receiptDeliveryCredits[0])'));
  assert.deepEqual(c.toasts, [AUTO_TOAST]);
  const html = card(c);
  assert.match(html, /<summary[^>]*>זיכוי שאושר · ₪155\.50 לפני מע״מ · פרטים/);
  assert.deepEqual(reasonLines(html), []);
  assert.doesNotMatch(html, /data-role="delivery-credit-confirm"|data-role="delivery-credit-barcode"|לא אומת בשרת/);
  assert.match(html, /צורף אוטומטית — לא של המשלוח הזה\?/);
});

test('against the real service: a number the reads did not agree on (22229030 / 22229080) and a failed verifier leave one review line about the number', { skip }, async () => {
  const { output, calls } = await service([answer(slip(READ0, { invoiceNumber: '22229030' })), answer(slip(READ1)), new Error('verifier network failure')], catalog);
  assert.equal(calls, 3, 'the number alone escalated to the verifier');
  const doc = output.scan.documents[0];
  assert.equal(output.scan.verification.status, 'needs_review');
  assert.equal(output.scan.verification.verifier.outcome, 'failed');
  assert.deepEqual(doc.modelVerification.issues, ['invoiceNumber']);
  assert.deepEqual(doc.modelVerification.support.invoiceNumber, []);
  assert.ok(['22229030', '22229080'].includes(doc.invoiceNumber), 'one of the read numbers, as read');
  const { c, credit, reasons } = await readInApp(structuredClone(output));
  assert.equal(credit.status, 'review');
  assert.equal(credit.autoConfirmed, false);
  assert.deepEqual(reasons.map(r => r.code), ['disputed'], 'the number dispute is said once, not also as "unsupported"');
  assert.equal(credit.number, doc.invoiceNumber);
  assert.deepEqual(reasonLines(card(c)), ['הקריאות לא הסכימו על מספר הזיכוי — בדוק מול הנייר']);
  assert.match(card(c), new RegExp('<input data-role="delivery-credit-number" data-id="credit-1" value="' + doc.invoiceNumber + '"'));
  assert.match(card(c), /data-role="delivery-credit-confirm"/);
  assert.doesNotMatch(card(c), /data-role="delivery-credit-barcode"/, 'identified rows keep no barcode field');
  assert.deepEqual(c.toasts, []);
  // The verifier read the printed number (22229080): verified, support names read 1, the credit attaches by itself.
  const settled = await service([answer(slip(READ0, { invoiceNumber: '22229030' })), answer(slip(READ1)), answer(slip(READ1))], catalog);
  assert.equal(settled.calls, 3);
  assert.equal(settled.output.scan.verification.status, 'verified');
  assert.deepEqual(settled.output.scan.documents[0].modelVerification.support.invoiceNumber, [1]);
  const again = await readInApp(structuredClone(settled.output));
  assert.equal(again.credit.status, 'confirmed');
  assert.equal(again.credit.autoConfirmed, true);
  assert.equal(again.credit.number, '22229080');
});

test('against the real service: when only one read parsed (the other cheap read and the verifier dropped) the card says so, and does not claim a disagreement', { skip }, async () => {
  const { output, calls } = await service([answer(slip(READ0)), new Error('cheap read B network failure'), new Error('verifier network failure')], catalog);
  assert.equal(calls, 3);
  const doc = output.scan.documents[0];
  assert.equal(output.scan.verification.verifier.outcome, 'failed');
  assert.deepEqual(doc.modelVerification.readings.map(r => r.read), [0], 'one parsed read');
  assert.deepEqual(doc.modelVerification.issues, ['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount', 'invoiceNumber']);
  const { c, credit, reasons, rows } = await readInApp(structuredClone(output));
  assert.equal(credit.status, 'review');
  assert.equal(credit.autoConfirmed, false);
  assert.deepEqual(reasons.map(r => r.code), ['disputed']);
  assert.deepEqual(reasonLines(card(c)), ['רק קריאה אחת של הנייר הצליחה — בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר']);
  assert.doesNotMatch(card(c), /לא הסכימו|לא אומת בשרת/);
  assert.deepEqual(rows, [['barcode_7290003029327', 2, 30.2], ['prod_13', 10, 125.3]], 'the rows still resolved; the worker checks them against the slip');
  assert.match(card(c), /data-role="delivery-credit-confirm"/);
  assert.deepEqual(c.toasts, []);
  // One look at the slip and one tap, as in v364.
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(json(c, 'receiptDeliveryCredits[0]').status, 'confirmed');
  assert.equal(json(c, 'receiptDeliveryCredits[0]').autoConfirmed, false);
});
