// v367: a quantity proven by the arithmetic needs no confirmation.
// Field evidence (the shop's backup of 2026-09-25 12:03, app v366 / service v149): invoice 9073807997
// (3 pages, 22 rows) was read three times. The selected cheap read had every quantity right and its paper
// balanced (rows Σ 1,717.49 = the printed subtotal, units Σ 285 = the printed total). The other cheap read
// halved rows 6 and 18 (3 for 6, 10 for 20; units 272, paper check failed); the verifier read the packages
// column of every row (units 25, failed, not selected — correct). Rows 6 and 18 ended with
// issues ['quantity'] and no read supporting the quantity, so the app showed "נשארו 2 שורות לטיפול" and
// asked the worker to confirm a quantity the arithmetic had already proven: 6 × 16.03 = 96.18 and
// 20 × 12.53 = 250.60 exactly, and only these quantities make the printed units total 285.
// These tests run the complete app module (receipt-scan-harness) on the fixture of
// quantity-arithmetic-fixture.mjs; quantity-arithmetic-contract.test.mjs replays the same three reads
// through the real service code. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';
import { PRODUCTS, SUBTOTAL, UNITS, fieldInvoice } from './quantity-arithmetic-fixture.mjs';
import { creditInvoiceData, verifiedCredit } from './credit-verified-fixture.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const html = c => c.run('receiptPriceAuditHtml()');
const pending = c => json(c, 'priceAuditPendingRows(receiptPriceAudit())');
const values = c => c.run('JSON.stringify(aiScanResponse.scan.documents[0].rows.map(r => paperRowValues(r)))');
const row = (c, i) => 'aiScanResponse.scan.documents[0].rows[' + i + ']';
const finishErrors = c => json(c, 'aiEvaluateInvoiceScan(aiScanResponse).errors || []');
const READINGS = 'קריאה 1 – 3 · קריאה 2 – 6 · קריאה 3 \\(המודל החזק\\) – 2';

function setup(options = {}, { catalogPrice = null } = {}) {
  const data = fixture('yotvata');
  data.products = PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode, price: p.price }));
  if (catalogPrice != null) data.products[5].price = catalogPrice;
  data.items = [];
  const answer = fieldInvoice(options), d = answer.scan.documents[0];
  d.__pricePaper = structuredClone(d); d.__priceSourceId = 'field-9073807997';
  data.paper = answer;
  const saved = { ...answer, docInputs: [{ amount: SUBTOTAL, units: UNITS, pageCount: 3 }],
    perDocument: [{ docIndex: 0, ok: true, serviceVersion: answer.serviceVersion, model: answer.model, requestId: answer.requestId, verification: answer.scan.verification }] };
  const c = runtime('yotvata', { data }); c.context.savedReview = saved;
  c.run(`receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedReview);receiptPaperScanState='ok';receiptDocDate='2026-09-25';
    receiptNotes=[{amount:${SUBTOTAL},units:${UNITS}}];recomputeNoteTotal();receiptList=[];saveReceiptDraft();renderReceiving()`);
  return { c, data };
}

test('the field case (service v149 answer): the two quantities without a supporting read are proven by the arithmetic — no pending rows, audit complete, nothing altered', () => {
  const { c, data } = setup();
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 3).ok'), true, 'the selected paper balances');
  assert.deepEqual(json(c, row(c, 5) + '.modelVerification.issues'), ['quantity'], 'the service still says needs_review');
  const before = values(c), proof = c.run('JSON.stringify(' + row(c, 5) + '.modelVerification)');
  const a = report(c);
  assert.equal(a.rows.length, 22);
  assert.deepEqual(pending(c), []);
  assert.equal(a.complete, true);
  assert.deepEqual([a.rows[5].capability, a.rows[5].result, a.rows[17].capability, a.rows[17].result], ['checkable', 'match', 'checkable', 'match']);
  assert.equal(a.rows[5].modelReviewIssues, undefined);
  for (const i of [5, 17]) {
    assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, i) + ')'), [], 'row ' + (i + 1));
    assert.equal(c.run('priceAuditConsensusConfirmed(' + row(c, i) + ')'), true, 'row ' + (i + 1));
    assert.equal(c.run('priceAuditQuantityProvenByArithmetic(aiScanResponse.scan.documents[0], ' + row(c, i) + ')'), true);
  }
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', true)'), { proven: true, server: false, reasons: [], unit: 16.03, gross: 96.18, net: 96.18, printedUnitsBalanced: true });
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 17) + ', true)'), { proven: true, server: false, reasons: [], unit: 12.53, gross: 250.6, net: 250.6, printedUnitsBalanced: true });
  const h = html(c);
  assert.match(h, /המחירים שנבדקו תואמים · 22 שורות · אין מה לאשר/);
  assert.doesNotMatch(h, /צריך להשלים את הבדיקה|price-confirm-values|data-price-row=|נשארו/);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true);
  assert.equal(finishErrors(c).some(e => /לא אומתו|לא הסכימו/.test(e)), false, finishErrors(c).join(' | '));
  // Nothing was filled or altered: the OCR values and the service's own record are as received.
  assert.equal(values(c), before);
  assert.equal(c.run('JSON.stringify(' + row(c, 5) + '.modelVerification)'), proof);
  assert.deepEqual(json(c, row(c, 5) + '.modelVerification.fieldSupport.quantity'), []);
  assert.equal(c.run(row(c, 5) + '.paperValuesReview'), undefined, 'no approval record was invented');
  // After a reload the same conclusion comes back from the draft.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.deepEqual(pending(reloaded), []);
  assert.equal(report(reloaded).complete, true);
  assert.equal(c.requests.length + reloaded.requests.length, 0);
});

test('a proven quantity counts as consensus for the price check: a catalog gap on that row is acknowledged by the reads, not by the worker', () => {
  const { c } = setup({}, { catalogPrice: 15 });
  const a = report(c);
  assert.equal(a.rows[5].result, 'difference');
  assert.equal(a.rows[5].expectedOptions[0].lineDifference, 6.18);
  assert.equal(a.rows[5].paperConfirmed, true);
  assert.equal(a.rows[5].paperReview.source, 'model_consensus');
  assert.deepEqual(pending(c), []);
  assert.match(html(c), /הבדיקה הושלמה · 1 פערי מחיר נשמרו/);
  assert.doesNotMatch(html(c), /price-confirm-paper|price-confirm-values/);
});

test('a quantity the arithmetic does not prove stays pending, and the card names the field, the three readings and the reason', () => {
  // The selected read's unit price is 16.04: 6 × 16.04 = 96.24 ≠ 96.18. The paper still balances (the
  // unit price is not part of the paper check), and the unit price is supported by reads 0 and 2.
  const { c } = setup({ unit: 16.04 });
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 3).ok'), true);
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', true).reasons'), ['arithmetic']);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), ['quantity']);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + row(c, 5) + ')'), false);
  const a = report(c);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [5], 'row 18 (20 × 12.53 = 250.60) is still proven');
  assert.equal(a.rows[5].capability, 'partial');
  assert.deepEqual(a.rows[5].modelReviewIssues, ['quantity']);
  assert.equal(a.complete, false);
  const h = html(c);
  assert.match(h, /נשארה שורה אחת לטיפול/);
  assert.match(h, /צריך להשלים את הבדיקה/);
  assert.match(h, new RegExp('<p data-row-dispute-field="quantity">הקריאות לא הסכימו על הכמות: ' + READINGS + '\\. גם הקריאה השלישית \\(המודל החזק\\) קראה את הנייר, ועדיין אין שתי קריאות שמסכימות\\.</p>'));
  assert.match(h, /<p class="mt-1">החשבון לא מכריע: מחיר היחידה × הכמות לא יוצא סכום השורה באף אחת מהקריאות\.<\/p>/);
  assert.match(h, /בדוק את הכמות, מחיר היחידה וסכום השורה מול הנייר\./);
  assert.match(h, /data-role="price-confirm-values"/);
  assert.match(h, /data-role="paper-row-edit"/);
  const visible = (h.match(/<div[^>]*data-row-dispute>[\s\S]*?<\/div>/) || [''])[0].replace(/<[^>]+>/g, ' ');
  assert.ok(visible.length > 40 && !/[A-Za-z]/.test(visible), 'no raw English in the explanation: ' + visible);
  assert.ok(finishErrors(c).some(e => /הכמות או המחיר עדיין לא אומתו בין הסריקות/.test(e)), finishErrors(c).join(' | '));
});

test('when another read\'s arithmetic holds the reason says the selected read, and a quantity that fails the arithmetic never becomes proven', () => {
  // Row 6 as read 0 would have had it: quantity 3 against 96.18 (the money as printed). The paper does
  // not balance (units 282) and 3 × 16.03 ≠ 96.18, while read 2's reading (6 × 16.03) holds.
  const { c } = setup();
  c.run(`const r=${row(c, 5)};r.quantity=3;r.modelVerification.evidence.quantity=3;r.modelVerification.readings[0].values.quantity=3;
    r.modelVerification.readings[2].values.quantity=6;aiScanResponse.scan.documents[0].__pricePaper.rows[5].quantity=3;renderReceiving()`);
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', false).reasons'), ['arithmetic', 'paper']);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), ['quantity']);
  const h = html(c);
  assert.match(h, /הקריאות לא הסכימו על הכמות: קריאה 1 – 3 · קריאה 2 – 3 · קריאה 3 \(המודל החזק\) – 6\./);
  assert.match(h, /החשבון לא מכריע: מחיר היחידה × הכמות לא יוצא סכום השורה בקריאה שנבחרה · התעודה לא מתאזנת מול הסיכום המודפס\./);
  assert.equal(c.run(row(c, 5) + '.quantity'), 3, 'the OCR value is never changed');
});

test('an unsupported unit price keeps the row pending: both fields are named, each with its readings, and the reason is the unit price', () => {
  const { c } = setup({ unitUnsupported: true });
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', true).reasons'), ['unit']);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), ['quantity', 'unitPriceExVat']);
  assert.deepEqual(pending(c).map(r => r.rowIndex), [5]);
  const h = html(c);
  assert.match(h, /<p>הקריאות לא הסכימו על הכמות ועל מחיר היחידה\. גם הקריאה השלישית \(המודל החזק\) קראה את הנייר, ועדיין אין שתי קריאות שמסכימות\.<\/p>/);
  assert.match(h, new RegExp('<p class="mt-1" data-row-dispute-field="quantity">הכמות: ' + READINGS + '</p>'));
  assert.match(h, /<p class="mt-1" data-row-dispute-field="unitPriceExVat">מחיר היחידה: קריאה 1 – 16\.30 · קריאה 2 – 16\.03 · קריאה 3 \(המודל החזק\) – 16\.30<\/p>/);
  assert.match(h, /החשבון לא מכריע: מחיר היחידה לא מוסכם בין הקריאות\./);
  assert.match(h, /data-role="price-confirm-values"/);
});

test('an unbalanced paper keeps the row pending and says the paper does not balance', () => {
  const { c } = setup({ printedUnits: 284 });
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 3).ok'), false);
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', false).reasons'), ['paper']);
  assert.equal(c.run('priceAuditQuantityProvenByArithmetic(aiScanResponse.scan.documents[0], ' + row(c, 5) + ')'), false);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), ['quantity']);
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 17) + ')'), ['quantity']);
  assert.ok(pending(c).some(r => r.rowIndex === 5) && pending(c).some(r => r.rowIndex === 17));
  assert.equal(report(c).complete, false);
  assert.match(html(c), /החשבון לא מכריע: התעודה לא מתאזנת מול הסיכום המודפס\./);
  assert.match(html(c), new RegExp('הקריאות לא הסכימו על הכמות: ' + READINGS));
});

test('when the verifier failed the card says so, with two readings and the technical reason as a small ltr line', () => {
  const { c, data } = setup({ unit: 16.04, verifier: 'failed' });
  assert.deepEqual(pending(c).map(r => r.rowIndex), [5]);
  const h = html(c);
  assert.match(h, /<p data-row-dispute-field="quantity">הקריאות לא הסכימו על הכמות: קריאה 1 – 3 · קריאה 2 – 6\. הקריאה השלישית \(המודל החזק\) נכשלה, לכן נשארו שתי קריאות שלא הסכימו\.<\/p>/);
  assert.match(h, /<p class="mt-1 text-\[11px\] text-slate-400" dir="ltr">timeout<\/p>/);
  assert.doesNotMatch(h, /קראה את הנייר/);
  // The verifier record lives with the document's metadata, so a reload explains the same.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.match(html(reloaded), /הקריאה השלישית \(המודל החזק\) נכשלה/);
  // A lone reading (the service's real shape: no field supported by another read): no dispute is claimed,
  // neither by the sentence nor by the reasons — only the arithmetic of the single read is left.
  c.run(`${row(c, 5)}.modelVerification.readings.splice(1);for (const f in ${row(c, 5)}.modelVerification.fieldSupport) ${row(c, 5)}.modelVerification.fieldSupport[f] = [];renderReceiving()`);
  assert.match(html(c), /<p>רק קריאה אחת קראה את השורה הזאת \(הקריאה השלישית, המודל החזק, נכשלה\), ולכן אין קריאה נוספת שמאשרת את הכמות\.<\/p>/);
  assert.match(html(c), /<p class="mt-1">החשבון לא מכריע: מחיר היחידה × הכמות לא יוצא סכום השורה בקריאה היחידה\.<\/p>/);
  assert.doesNotMatch(html(c), /לא הסכימו|לא מוסכם|באף אחת מהקריאות/);
  // Without readings at all (service v148) the sentence is generic but names the field.
  c.run(`delete ${row(c, 5)}.modelVerification.readings;renderReceiving()`);
  assert.match(html(c), /<p>הקריאות לא הסכימו על הכמות\. הקריאה השלישית \(המודל החזק\) נכשלה, לכן נשארו שתי קריאות שלא הסכימו\.<\/p>/);
});

test('the service v150 answer (status verified, fieldSupport.quantity [\'arithmetic\'], modelVerification.arithmetic) is accepted as it is', () => {
  const { c, data } = setup({ server: 150 });
  assert.deepEqual(json(c, row(c, 5) + '.modelVerification.fieldSupport.quantity'), ['arithmetic']);
  assert.equal(c.run(row(c, 5) + '.modelVerification.status'), 'verified');
  assert.deepEqual(json(c, 'priceAuditQuantityArithmetic(' + row(c, 5) + ', false)'), { proven: true, server: true, reasons: [], unit: 16.03, gross: 96.18, net: 96.18, printedUnitsBalanced: true });
  assert.deepEqual(pending(c), []);
  assert.equal(report(c).complete, true);
  assert.equal(c.run('priceAuditConsensusConfirmed(' + row(c, 5) + ')'), true);
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true);
  assert.deepEqual(pending(runtime('yotvata', { data, storage: c.storage })), []);
  // The identity still has to be sound: a marker cannot vouch for a row whose product changed.
  c.run(`${row(c, 5)}.description='changed'`);
  assert.equal(report(c).rows[5].capability, 'unidentified');
});

test('the manual "כן, הכמות והמחיר נכונים לפי הנייר" flow is unchanged for a row the arithmetic does not prove', async () => {
  const { c, data } = setup({ unit: 16.04 });
  const before = values(c);
  assert.match(html(c), /data-role="price-confirm-values"/);
  const token = c.run('priceAuditValuesReviewToken(aiSourceRow(0,5))');
  await c.click('price-confirm-values', '', { doc: '0', row: '5', reviewToken: token });
  assert.equal(values(c), before, 'the OCR values are kept');
  assert.ok(c.run('aiSourceRow(0,5).mapped.paperValuesReview'));
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), []);
  assert.deepEqual(pending(c), []);
  assert.equal(report(c).complete, true);
  assert.equal(c.run('aiScanEvaluation.valid'), true);
  assert.deepEqual(pending(runtime('yotvata', { data, storage: c.storage })), []);
  // A stale token cannot approve changed data.
  const { c: stale } = setup({ unit: 16.04 });
  const staleToken = stale.run('priceAuditValuesReviewToken(aiSourceRow(0,5))');
  stale.run(`${row(stale, 5)}.description='changed'`);
  await stale.click('price-confirm-values', '', { doc: '0', row: '5', reviewToken: staleToken });
  assert.equal(stale.run('aiSourceRow(0,5).mapped.paperValuesReview'), undefined);
});

test('the paper-correction flow is unchanged for a row the arithmetic does not prove', async () => {
  const { c } = setup({ unit: 16.04 });
  assert.match(html(c), /data-role="paper-row-edit"/);
  await c.click('paper-row-edit', '', { doc: '0', row: '5' });
  c.node('paperRowQty').value = '6'; c.node('paperRowUnit').value = '16.03'; c.node('paperRowTotal').value = '96.18';
  await c.events.get('paperRowSave:click')();
  assert.ok(c.run(row(c, 5) + '.paperValuesCorrection'));
  assert.equal(c.run('paperRowCorrectionValid(aiScanResponse.scan.documents[0], 5)'), true);
  assert.deepEqual(json(c, 'paperRowValues(' + row(c, 5) + ')'), { quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: 96.18, lineDiscountExVat: 0, lineTotalExVat: 96.18 });
  assert.equal(c.run('aiScanResponse.scan.documents[0].__pricePaper.rows[5].unitPriceExVat'), 16.04, 'the original paper record is kept');
  assert.deepEqual(json(c, 'aiModelReviewIssues(' + row(c, 5) + ')'), []);
  assert.deepEqual(pending(c), []);
  assert.equal(report(c).rows[5].result, 'match');
});

test('the rule itself: gross null, a row discount, credit magnitudes, a string marker is not a read, and each refusal reason', () => {
  const { c } = setup();
  const support = { quantity: [], unitPriceExVat: [0], grossLineTotalExVat: [0], lineDiscountExVat: [0], lineTotalExVat: [0] };
  const check = (values, balanced = true, credit = false, fieldSupport = support) => json(c, 'priceAuditQuantityArithmetic(' +
    JSON.stringify({ ...values, modelVerification: { version: 1, fieldSupport } }) + ', ' + balanced + ', ' + credit + ')');
  const ok = { quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: 96.18, lineDiscountExVat: 0, lineTotalExVat: 96.18 };
  assert.equal(check(ok).proven, true);
  // Without a gross: round(qty × unit) = net + |discount|.
  assert.equal(check({ quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: null, lineDiscountExVat: null, lineTotalExVat: 96.18 }).proven, true);
  assert.equal(check({ quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: null, lineDiscountExVat: -6.18, lineTotalExVat: 90 }).proven, true);
  assert.deepEqual(check({ quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: null, lineDiscountExVat: null, lineTotalExVat: 90 }).reasons, ['arithmetic']);
  // With a gross: round(qty × unit) = gross and gross − |discount| = net; a null discount means gross = net.
  assert.equal(check({ ...ok, lineDiscountExVat: 6.18, lineTotalExVat: 90 }).proven, true);
  assert.deepEqual(check({ ...ok, lineDiscountExVat: null, lineTotalExVat: 90 }).reasons, ['arithmetic']);
  assert.deepEqual(check({ ...ok, quantity: 5 }).reasons, ['arithmetic']);
  assert.deepEqual(check({ ...ok, quantity: 6.5 }).reasons, ['values']);
  assert.deepEqual(check({ ...ok, quantity: 0 }).reasons, ['values']);
  assert.deepEqual(check({ ...ok, unitPriceExVat: 0, grossLineTotalExVat: 0, lineTotalExVat: 0 }).reasons, ['values']);
  assert.deepEqual(check(ok, false).reasons, ['paper']);
  // Credit mode: magnitudes; in invoice mode a negative row is not proven.
  const credit = { quantity: -6, unitPriceExVat: 16.03, grossLineTotalExVat: -96.18, lineDiscountExVat: null, lineTotalExVat: -96.18 };
  assert.equal(check(credit, true, true).proven, true);
  assert.deepEqual(check(credit, true, false).reasons, ['values']);
  // Support must come from another read; the gross needs support only when it was read.
  assert.deepEqual(check(ok, true, false, { ...support, unitPriceExVat: [] }).reasons, ['unit']);
  assert.deepEqual(check(ok, true, false, { ...support, lineTotalExVat: [] }).reasons, ['net']);
  assert.deepEqual(check(ok, true, false, { ...support, grossLineTotalExVat: [] }).reasons, ['gross']);
  assert.equal(check({ ...ok, grossLineTotalExVat: null }, true, false, { ...support, grossLineTotalExVat: [] }).proven, true);
  assert.deepEqual(check(ok, true, false, { ...support, unitPriceExVat: ['arithmetic'] }).reasons, ['unit'], 'a marker is not a read');
  assert.deepEqual(check(ok, true, false, null).reasons, ['support'], 'a v146 answer has no fieldSupport');
  assert.equal(check(ok, false, false, { ...support, quantity: ['arithmetic'] }).server, true, 'the service marker is accepted as it is');
});

// The credit backstop: the same rule, by magnitude, on a driver credit read by service v149.
const AUTO_TOAST = 'הזיכוי צורף למשלוח. בסיום הספירה נבדוק איזה חוסר הוא מכסה.';
async function readCredit(answer) {
  const data = creditInvoiceData();
  const c = runtime('yotvata', { data });
  c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:9}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  data.paper = answer;
  c.run(`receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  return { c, credit: json(c, 'receiptDeliveryCredits[0]'), reasons: json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[0])').map(r => r.code) };
}

test('a driver credit (service v149): a quantity dispute the arithmetic proves on a balanced slip attaches by itself; one it does not prove stays for review', async () => {
  // 6 × 7.30 = 43.80 exactly, −48.80 / −7 units as printed: proven.
  const data = creditInvoiceData();
  const proven = await readCredit(verifiedCredit(data, { rowOptions: { 0: { issues: ['quantity'] } } }));
  assert.deepEqual(proven.reasons, []);
  assert.equal(proven.credit.status, 'confirmed');
  assert.equal(proven.credit.autoConfirmed, true);
  assert.deepEqual(proven.credit.paper.rows[0].modelVerification.issues, ['quantity'], 'the service record is kept as received');
  assert.equal(proven.credit.paper.rows[0].quantity, -6);
  assert.deepEqual(proven.c.toasts, [AUTO_TOAST]);
  // No printed units total on the slip: the quantity is not corroborated, the dispute stays.
  const noUnits = verifiedCredit(data, { rowOptions: { 0: { issues: ['quantity'] } } });
  noUnits.scan.documents[0].printedUnits = null;
  const unproven = await readCredit(noUnits);
  assert.deepEqual(unproven.reasons, ['disputed']);
  assert.equal(unproven.credit.status, 'review');
  assert.match(unproven.c.run('deliveryCreditsHtml()'), /הקריאות לא הסכימו על הכמות בשורה 1 — בדוק מול הנייר/);
});
