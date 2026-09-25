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
import { PRODUCTS, SUBTOTAL, UNITS, FIELD_ROWS, catalog, readRows, modelDoc } from './quantity-arithmetic-fixture.mjs';

const serviceDir = process.env.YOTVATA_AI_SCAN || fileURLToPath(new URL('../../yotvata-ai-scan/', import.meta.url));
const serverFile = new URL('server.js', pathToFileURL(serviceDir.endsWith('/') ? serviceDir : serviceDir + '/'));
const skip = fs.existsSync(serverFile) ? false : 'the companion service is not checked out next to this repo (set YOTVATA_AI_SCAN=<dir of yotvata-ai-scan>)';
const { createServer, yotvataPaperCheck } = skip ? {} : await import(serverFile.href);

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
async function service(responses) {
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
  // The body the app sends for an invoice (aiRequestInvoiceScan): the pages, no typed anchors, the catalog.
  const body = { reviewProtocolVersion: 1, documents: [{ noteIndex: 0, pages: [image, image, image], expectedSubtotalExVat: null, expectedUnits: null }],
    receivedProductIds: [], catalog };
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
async function scanInApp(paper) {
  const data = fixture('yotvata');
  data.products = PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode, price: p.price }));
  data.items = [];
  data.paper = paper; // what fetch('/scan') answers: the service's real answer, untouched
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened=false;receiptList=[];receiptDupConfirmed=true;
    aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:Array.from({length:3},()=>({dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}))}];`);
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
