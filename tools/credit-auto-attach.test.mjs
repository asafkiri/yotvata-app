// v365: a verified driver credit is attached by itself — no per-document confirmation.
// Field evidence (the shop's backup, receipt of 2026-09-25, app v364 / service v148):
// credit 22229080, one slip, two rows. Both cheap reads agreed (rows 'agreed', doc
// issues [], paper_verified, creditSigns negative, subtotal −155.50, printedUnits −12),
// both products were resolved by the server (model_consensus) and the number was
// read — and the app still asked "האם זה זיכוי על חוסר במשלוח הנוכחי?" with a barcode
// field under every row. The owner's decision: a driver credit is always part of the
// current delivery. These tests run the complete app module (receipt-scan-harness);
// only fetch, image preparation and the Firebase boundary are faked. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture, reply } from './receipt-scan-harness.mjs';
import { verifiedCredit } from './credit-verified-fixture.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const uploads = c => c.requests.filter(r => r.url.endsWith('/scan')).length;
const card = c => c.run('deliveryCreditsHtml()');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush(c, rounds = 20) {
  for (let i = 0; i < rounds; i++) { for (const cb of c.callbacks.splice(0)) cb(); await tick(); }
}

// The invoice of delivery-credit.test.mjs: 10 × milk + 6 × coffee. By default 9 milk and
// no coffee were counted, so 1 milk (₪5.00) and 6 coffee (₪43.80) are missing.
function setup({ milk = 9 } = {}) {
  const data = fixture('yotvata');
  data.products[1].price = 7.3;
  const doc = data.paper.scan.documents[0];
  Object.assign(doc, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 93.8, printedUnits: 16,
    printedLines: 2, itemsPrintedLines: 2, itemsSectionTotalExVat: 93.8 });
  doc.rows.push({ ...doc.rows[0], description: 'קפה בדיקה', barcode: '7290000000015',
    barcodeObserved: '7290000000015', itemCode: '222', lineNumber: 2, quantity: 6,
    unitPriceExVat: 7.3, grossLineTotalExVat: 43.8, lineTotalExVat: 43.8 });
  doc.__pricePaper = structuredClone(doc);
  const c = runtime('yotvata', { data });
  c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:${milk}}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  return { c, data };
}

// v366: the verified fixture (verifiedCredit / verifiedRow) moved to credit-verified-fixture.mjs,
// shared with credit-on-gate.test.mjs. Shape and values are unchanged.
// Runs the read exactly as the automatic trigger does after the last photo is confirmed.
async function readCredit(c, data, answer, id = 'credit-1') {
  const original = data.paper;
  data.paper = answer;
  c.context.creditTestId = id;
  c.run(`receiptDeliveryCredits.push({id:creditTestId,status:'capture',pageCount:1,
    pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  const result = await c.run('deliveryCreditRead(creditTestId)');
  data.paper = original;
  assert.equal(result, true, c.toasts.join('\n') + c.run('receiptDeliveryCredits.at(-1).error'));
}
function finish(c) {
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  return json(c, 'pendingReceipt');
}
const credit = (c, i = 0) => json(c, 'receiptDeliveryCredits[' + i + ']');
const reasons = (c, i = 0) => json(c, 'deliveryCreditReviewReasons(receiptDeliveryCredits[' + i + '])').map(r => r.code);
const barcodeInputs = html => [...html.matchAll(/<input data-role="delivery-credit-barcode"[^>]*data-row="(\d+)"[^>]*>/g)].map(m => Number(m[1]));
const AUTO_TOAST = 'הזיכוי צורף למשלוח. בסיום הספירה נבדוק איזה חוסר הוא מכסה.';

test('a verified credit (two agreed rows, resolved products, a number, negative sums) is attached by itself after the automatic read', async () => {
  const { c, data } = setup();
  // The bar and totals nodes hold what setup wrote; only a rewrite during the read can fill them again.
  c.node('rcProgress').outerHTML = ''; c.node('rcTotals').outerHTML = '';
  await readCredit(c, data, verifiedCredit(data));
  const x = credit(c);
  assert.equal(x.status, 'confirmed');
  assert.equal(x.autoConfirmed, true);
  assert.ok(x.confirmedAt > 0);
  // v365: the sticky bar and the totals were rendered when the read started (gap ₪48.80, a credit
  // awaiting confirmation); the automatic attach must refresh them in place, without a full render.
  // In the harness renderReceiving() writes app.innerHTML, while refreshReceiptTotals() writes the
  // rcProgress / rcTotals nodes — so the two are distinguishable.
  assert.match(c.node('app').innerHTML, /יש זיכוי שעדיין דורש אישור או תיקון/, 'the screen built at the start of the read showed the pending credit');
  const bar = c.node('rcProgress').outerHTML;
  assert.match(bar, /החוסר מכוסה בזיכוי ✓/, 'the on-screen bar was refreshed after the automatic attach');
  assert.doesNotMatch(bar, /דורש אישור|פער ₪/);
  assert.match(c.node('rcTotals').outerHTML, /7 בזיכוי/);
  assert.equal(x.confirmedSignature, c.run('deliveryCreditSignature(receiptDeliveryCredits[0])'));
  assert.equal(x.number, '22229080');
  assert.equal(x.paper.subtotalExVat, -48.8, 'the OCR paper is kept as read, signed');
  assert.equal(c.run('deliveryCreditReady()'), true);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1, 'one toast for the automatic attach');
  const html = card(c);
  assert.match(html, /<details data-delivery-credit="credit-1"[^>]*><summary[^>]*>זיכוי שאושר · ₪48\.80 לפני מע״מ · פרטים/);
  assert.doesNotMatch(html, /data-role="delivery-credit-confirm"/, 'nothing to confirm');
  assert.doesNotMatch(html, /data-role="delivery-credit-barcode"/, 'no barcode fields on an attached credit');
  assert.match(html, /<p data-credit-auto-note[^>]*>צורף אוטומטית — לא של המשלוח הזה\? <button data-role="delivery-credit-remove" data-id="credit-1"[^>]*>הסר זיכוי<\/button><\/p>/);
  assert.match(html, /data-role="delivery-credit-edit" data-id="credit-1"[^>]*>תקן פרטי זיכוי</);
  // Re-render, save, refresh: nothing fires again, no second toast, one paid read.
  c.run('renderReceiving(); saveReceiptDraft(); deliveryCreditRefreshCards(); deliveryCreditsHtml()');
  await flush(c);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
  assert.equal(uploads(c), 1);
  // Live coverage and finish work exactly as for a credit confirmed by hand.
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  const p = finish(c);
  assert.ok(p); assert.equal(p.status, 'ok'); assert.equal(p.ex, 45);
  assert.equal(p.lines.find(x => x.productId === 'coffee').qty, 0);
  assert.equal(p.shortCreditNotes.length, 1);
  assert.equal(p.shortCreditNotes[0].number, '22229080');
  assert.equal(p.shortCreditNotes[0].amount, 48.8);
  assert.equal(p.shortCreditNotes[0].autoConfirmed, true, 'the saved note says it was attached automatically');
  assert.equal(p.shortCreditNotes[0].paper.subtotalExVat, -48.8);
  c.context.pendingFixture = p;
  const di = json(c, 'receiptDiscrepancyInfo({...pendingFixture,items:pendingFixture.lines})');
  assert.equal(di.shortValRaw, 48.8); assert.equal(di.shortVal, 0); assert.equal(di.shortFullyCredited, true);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.ok(saved); assert.equal(saved.shortCreditNotes.length, 1); assert.equal(saved.shortCreditNotes[0].autoConfirmed, true);
  c.context.savedCreditReceipt = saved;
  assert.equal(c.run('receiptPayableBaseEx(savedCreditReceipt)'), 45);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(uploads(c), 1);
});

test('the automatic trigger itself (confirming the last photo) attaches a verified credit — one paid read', async () => {
  const { c, data } = setup();
  data.paper = verifiedCredit(data);
  c.run(`aiRenderInvoiceRotation = async () => ({ dataUrl: 'data:image/jpeg;base64,AQ==', bytes: 1 });
    receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',baseDataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',rotation:0,orientationConfirmed:false}]});
    renderReceiving();`);
  assert.equal(c.run("deliveryCreditOpenPage('credit-1', 0)"), true);
  assert.equal(c.run("deliveryCreditOpenPage('credit-1', 0); aiOrientationSession && aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]"), true);
  c.node('rcProgress').outerHTML = '';
  await c.run('aiConfirmOrientationReview()');
  await flush(c);
  assert.equal(credit(c).status, 'confirmed', credit(c).error);
  assert.equal(credit(c).autoConfirmed, true);
  assert.equal(uploads(c), 1);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
  assert.doesNotMatch(card(c), /data-role="delivery-credit-confirm"/);
  // v365: the bar the trigger's render left on screen is refreshed once the read lands.
  const bar = c.node('rcProgress').outerHTML;
  assert.match(bar, /החוסר מכוסה בזיכוי/);
  assert.doesNotMatch(bar, /יש זיכוי שעדיין דורש אישור/);
});

test('the sticky bar is rewritten only by an automatic attach on the receiving screen', async () => {
  // A read that ends in review changes nothing about the bar: it already said a credit is waiting.
  const { c, data } = setup();
  c.node('rcProgress').outerHTML = '';
  await readCredit(c, data, verifiedCredit(data, { number: '' }));
  assert.equal(credit(c).status, 'review');
  assert.equal(c.node('rcProgress').outerHTML, '', 'no rewrite when nothing about the bar changed');
  // On another screen there is no bar to refresh (the same guard as the credit cards).
  const o = setup();
  o.c.node('rcProgress').outerHTML = '';
  o.c.run("currentView='sales'");
  await readCredit(o.c, o.data, verifiedCredit(o.data));
  assert.equal(credit(o.c).status, 'confirmed');
  assert.equal(o.c.node('rcProgress').outerHTML, '', 'guarded by currentView');
});

test('an auto-attached credit that covers no shortage is still blocked at finish with the existing explanation', async () => {
  const { c, data } = setup({ milk: 10 });
  c.run("receiptList.push({productId:'coffee',name:'קפה בדיקה',barcode:'7290000000015',qty:6})");
  await readCredit(c, data, verifiedCredit(data));
  assert.equal(credit(c).status, 'confirmed');
  assert.equal(credit(c).autoConfirmed, true);
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /הזיכוי אינו תואם לחוסר/);
  assert.equal(finish(c), null);
  assert.match(c.toasts.at(-1), /הזיכוי אינו תואם לחוסר שנספר/);
  assert.equal(c.run('receiptNoteTotal'), 93.8);
});

test('one refused row: the credit stays in review, the reason names it, and only that row has a barcode field', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { rowOptions: { 1: { refused: true } } }));
  assert.equal(credit(c).status, 'review');
  assert.equal(credit(c).autoConfirmed, false);
  assert.deepEqual(reasons(c), ['product']);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 0);
  const html = card(c);
  assert.match(html, /<p data-credit-review-reason[^>]*>מוצר אחד לא זוהה — הקלד את הברקוד מהנייר<\/p>/);
  assert.doesNotMatch(html, /הקריאות לא הסכימו/, 'the unidentified row is not reported twice');
  assert.deepEqual(barcodeInputs(html), [1], 'only the refused row has a field');
  assert.match(html, /data-role="delivery-credit-edit-barcode" data-id="credit-1" data-row="0"[^>]*>תקן ברקוד</);
  assert.match(html, /המוצר לא זוהה\. הקלד את הברקוד מהנייר/);
  assert.match(html, /נקרא בצילום: <span dir="ltr">7290000000008<\/span>/);
  assert.match(html, /data-role="delivery-credit-confirm"/);
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), false);
  // The worker types the barcode from the paper: the row is identified and the credit can be attached by hand.
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-barcode', id: 'credit-1', row: '1' }, value: '7290000000008' } });
  assert.equal(c.node('creditName_credit-1_1').textContent, 'חלב בדיקה');
  assert.deepEqual(reasons(c), []);
  assert.equal(credit(c).status, 'review', 'typing never attaches on its own');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(c).autoConfirmed, false, 'a credit confirmed by the worker is not marked automatic');
  assert.equal(finish(c).status, 'ok');
});

test('a credit number that was not read: review with its reason; the typed number is confirmed by hand', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { number: '' }));
  assert.equal(credit(c).status, 'review');
  assert.deepEqual(reasons(c), ['number']);
  const html = card(c);
  assert.match(html, /<p data-credit-review-reason[^>]*>מספר הזיכוי לא נקרא — הקלד אותו מהנייר<\/p>/);
  assert.match(html, /<input data-role="delivery-credit-number" data-id="credit-1" value=""/);
  assert.deepEqual(barcodeInputs(html), [], 'identified rows have no barcode field');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), false);
  assert.match(c.toasts.at(-1), /השלם את מספר תעודת הזיכוי/);
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-number', id: 'credit-1' }, value: ' 22229080 ' } });
  assert.equal(credit(c).number, '22229080');
  assert.equal(credit(c).status, 'review');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(c).autoConfirmed, false);
});

test('a duplicate number (this delivery or receipt history) is never attached by itself', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data));
  assert.equal(credit(c).status, 'confirmed');
  await readCredit(c, data, verifiedCredit(data), 'credit-2');
  assert.equal(credit(c, 1).status, 'review');
  assert.equal(credit(c, 1).autoConfirmed, false);
  assert.deepEqual(reasons(c, 1), ['duplicate']);
  assert.equal(c.run('deliveryCreditReady()'), false);
  const html = card(c);
  assert.match(html, /מספר הזיכוי הזה כבר צורף\. בדוק את המספר או הסר את הכפילות\./);
  // Both cards carry the same number, so each shows the duplicate line once — and the
  // reason line does not repeat it.
  assert.equal((html.match(/כבר צורף/g) || []).length, 2, 'the duplicate is explained once per card');
  assert.doesNotMatch(html, /data-credit-review-reason[^>]*>[^<]*כבר צורף/);
  assert.equal(c.run("deliveryCreditConfirm('credit-2')"), false);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1, 'only the first credit toasted');
  // Receipt history.
  const other = setup();
  other.c.run("receipts=[{id:'old',shortCreditNotes:[{number:'22229080',amount:48.8}]}]");
  await readCredit(other.c, other.data, verifiedCredit(other.data));
  assert.equal(credit(other.c).status, 'review');
  assert.deepEqual(reasons(other.c), ['duplicate']);
});

test('a response without consensus evidence (v147 shape) or with a dispute stays in review and says which field', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { verification: false }));
  assert.equal(credit(c).status, 'review');
  assert.deepEqual(reasons(c), ['unverified']);
  assert.match(card(c), /<p data-credit-review-reason[^>]*>הקריאה לא אומתה בשרת — בדוק את המוצרים, הכמויות והסכומים מול הנייר<\/p>/);
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true, 'the worker can still attach it by hand');
  assert.equal(credit(c).autoConfirmed, false);
  // A summary the reads did not agree on.
  const b = setup();
  await readCredit(b.c, b.data, verifiedCredit(b.data, { docIssues: ['subtotalExVat'] }));
  assert.equal(credit(b.c).status, 'review');
  assert.deepEqual(reasons(b.c), ['disputed']);
  assert.match(card(b.c), /הקריאות לא הסכימו על הסכום לפני מע״מ — בדוק מול הנייר/);
  // A row the reads did not agree on. v367: a quantity the arithmetic proves on a balanced slip is no longer
  // a dispute (quantity-arithmetic.test.mjs), so this row's unit price is read as 7.31 (6 × 7.31 ≠ 43.80).
  const d = setup();
  const disputedQuantity = verifiedCredit(d.data, { rowOptions: { 0: { issues: ['quantity'] } } }), disputedRow = disputedQuantity.scan.documents[0].rows[0];
  disputedRow.unitPriceExVat = disputedRow.modelVerification.evidence.unitPriceExVat = 7.31;
  disputedRow.modelVerification.readings.forEach(r => { r.values.unitPriceExVat = 7.31; });
  await readCredit(d.c, d.data, disputedQuantity);
  assert.equal(credit(d.c).status, 'review');
  assert.match(card(d.c), /הקריאות לא הסכימו על הכמות בשורה 1 — בדוק מול הנייר/);
  assert.deepEqual(barcodeInputs(card(d.c)), [], 'a numeric dispute opens no barcode field');
  // The printed "total of discounts" line, already included in the rows, is not a dispute.
  const e = setup();
  await readCredit(e.c, e.data, verifiedCredit(e.data, { docIssues: ['documentDiscountExVat'], discount: -3 }));
  assert.equal(credit(e.c).status, 'confirmed', credit(e.c).error);
  assert.equal(credit(e.c).autoConfirmed, true);
  assert.equal(credit(e.c).paper.documentDiscountExVat, -3, 'the OCR value is kept as read');
});

test('identified rows have no barcode field; "תקן ברקוד" reveals one row\'s field, typing a different barcode works, and the state is not saved', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { number: '' }));
  assert.deepEqual(barcodeInputs(card(c)), []);
  assert.equal((card(c).match(/data-role="delivery-credit-edit-barcode"/g) || []).length, 2);
  await c.click('delivery-credit-edit-barcode', 'credit-1', { row: '0' });
  let html = card(c);
  assert.deepEqual(barcodeInputs(html), [0], 'only the tapped row opens');
  assert.match(html, /<input data-role="delivery-credit-barcode" data-id="credit-1" data-row="0" value="7290000000015"/);
  assert.match(html, /ברקוד — אפשר לתקן לפי הנייר/);
  assert.equal((html.match(/data-role="delivery-credit-edit-barcode"/g) || []).length, 1);
  assert.equal('editBarcode' in json(c, 'receiptDraftPayload().deliveryCredits[0]'), false, 'display state never enters the draft');
  assert.equal('editBarcode' in json(c, 'deliveryCreditSnapshot()[0]'), false);
  // Typing a different barcode goes through the existing change handler.
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-barcode', id: 'credit-1', row: '0' }, value: '7290000000008' } });
  assert.equal(c.node('creditName_credit-1_0').textContent, 'חלב בדיקה');
  assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, 'milk');
  assert.equal(credit(c).paper.rows[0].barcode, '7290000000015', 'the OCR row is unchanged');
  html = card(c);
  assert.match(html, /<input data-role="delivery-credit-barcode" data-id="credit-1" data-row="0" value="7290000000008"/, 'a typed barcode stays visible');
  // After a reload the revealed-but-untyped row is closed again; the typed one stays open.
  await c.click('delivery-credit-edit-barcode', 'credit-1', { row: '1' });
  assert.deepEqual(barcodeInputs(card(c)), [0, 1]);
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.deepEqual(barcodeInputs(card(reloaded)), [0]);
  assert.equal(uploads(reloaded), 0);
});

test('restore of an auto-attached credit (reload and cloud draft) keeps it confirmed without re-firing anything', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data));
  const expected = json(c, 'deliveryCreditNotes()');
  assert.equal(expected[0].autoConfirmed, true);
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(credit(reloaded).status, 'confirmed');
  assert.equal(credit(reloaded).autoConfirmed, true);
  assert.deepEqual(json(reloaded, 'deliveryCreditNotes()'), expected);
  assert.equal(reloaded.run('deliveryCreditReady()'), true);
  reloaded.run('renderReceiving(); saveReceiptDraft(); deliveryCreditRefreshCards()');
  await flush(reloaded);
  assert.equal(uploads(reloaded), 0);
  assert.equal(reloaded.toasts.length, 0, 'no toast on restore');
  assert.match(card(reloaded), /צורף אוטומטית — לא של המשלוח הזה\?/);
  const remote = runtime('yotvata', { data });
  remote.context.remoteDraft = json(c, 'receiptDraftPayload(true)');
  remote.run('restoreReceiptDraft(remoteDraft)');
  assert.equal(credit(remote).status, 'confirmed');
  assert.equal(credit(remote).autoConfirmed, true);
  assert.deepEqual(json(remote, 'deliveryCreditNotes()'), expected);
  assert.equal(remote.toasts.length, 0);
  assert.equal(finish(remote).status, 'ok');
  assert.equal(uploads(remote), 0);
  // A restored credit that is edited needs the worker's confirmation again, and loses the automatic mark.
  await reloaded.click('delivery-credit-edit', 'credit-1');
  assert.equal(credit(reloaded).status, 'review');
  assert.equal(credit(reloaded).autoConfirmed, false);
  assert.match(card(reloaded), /<p data-credit-review-reason[^>]*>בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר\.<\/p>/);
  // A verified credit that is in review when the draft is restored (reload or cloud) stays
  // in review: the automatic attach lives in the read only, never in a restore.
  const again = runtime('yotvata', { data, storage: reloaded.storage });
  assert.equal(credit(again).status, 'review');
  assert.equal(credit(again).autoConfirmed, false);
  assert.deepEqual(reasons(again), [], 'nothing is unclear — and still nothing is attached without a read');
  assert.equal(again.toasts.length, 0);
  assert.equal(uploads(again), 0);
  const cloudAgain = runtime('yotvata', { data });
  cloudAgain.context.remoteDraft = json(reloaded, 'receiptDraftPayload(true)');
  cloudAgain.run('restoreReceiptDraft(remoteDraft); renderReceiving()');
  assert.equal(credit(cloudAgain).status, 'review');
  assert.equal(cloudAgain.toasts.length, 0);
  assert.match(card(cloudAgain), /data-role="delivery-credit-confirm"/);
  assert.equal(reloaded.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(reloaded).autoConfirmed, false);
});

test('"הסר זיכוי" from the automatic note removes the credit and reopens the gap', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data));
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  await c.click('delivery-credit-remove', 'credit-1');
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /פער ₪48\.80/);
  assert.equal(finish(c).status, 'open');
});

// v365: the credit number is part of the evidence. Service v149 compares it between the reads in
// credit mode and reports support.invoiceNumber; a credit is attached by itself only when at least
// one other read saw the same number. The number is the key of the duplicate guard, so a number
// nobody looked at could let the same slip reduce a later delivery's payable again.
test('a number that no other read saw (read 0: 22229030, read 1: 22229080) is never attached by itself', async () => {
  // Service v149, credit mode: the selected read's number has no support, so invoiceNumber is an issue.
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { number: '22229030', docIssues: ['invoiceNumber'] }));
  assert.equal(credit(c).status, 'review');
  assert.equal(credit(c).autoConfirmed, false);
  assert.deepEqual(reasons(c), ['disputed']);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 0);
  const html = card(c);
  assert.match(html, /<p data-credit-review-reason[^>]*>הקריאות לא הסכימו על מספר הזיכוי — בדוק מול הנייר<\/p>/);
  assert.match(html, /<input data-role="delivery-credit-number" data-id="credit-1" value="22229030"/, 'the field shows the number that was read, for the worker to check');
  assert.deepEqual(barcodeInputs(html), [], 'identified rows keep no barcode field');
  assert.match(html, /data-role="delivery-credit-confirm"/);
  assert.equal(c.run('deliveryCreditReady()'), false);
  assert.equal(finish(c), null, 'nothing is saved before the worker looked at the number');
  // The worker reads the printed number and types it: the reason is gone, the credit still waits for their tap.
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-number', id: 'credit-1' }, value: '22229080' } });
  assert.deepEqual(reasons(c), []);
  assert.equal(credit(c).status, 'review', 'typing never attaches on its own');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(c).autoConfirmed, false);
  assert.equal(credit(c).paper.invoiceNumber, '22229030', 'the OCR value is kept as read');
  const p = finish(c);
  assert.equal(p.status, 'ok'); assert.equal(p.shortCreditNotes[0].number, '22229080'); assert.equal(p.ex, 45);
  // Empty support without the field in issues: the same one-line review. The worker checks the slip,
  // the read number is right after all, and confirms by hand with it.
  const b = setup();
  await readCredit(b.c, b.data, verifiedCredit(b.data, { number: '22229030', numberSupport: [] }));
  assert.equal(credit(b.c).status, 'review');
  assert.deepEqual(reasons(b.c), ['number']);
  assert.match(card(b.c), /<p data-credit-review-reason[^>]*>הקריאות לא הסכימו על מספר הזיכוי — בדוק מול הנייר<\/p>/);
  assert.equal(b.c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(b.c).status, 'confirmed');
  assert.equal(credit(b.c).autoConfirmed, false);
  assert.equal(credit(b.c).number, '22229030');
  // A number that another read saw as well (the field credit on service v149) is attached by itself.
  const d = setup();
  await readCredit(d.c, d.data, verifiedCredit(d.data, { numberSupport: [1] }));
  assert.equal(credit(d.c).status, 'confirmed');
  assert.equal(credit(d.c).autoConfirmed, true);
});

test('a v148 answer (the shape of the shop\'s backup: no support at all) stays in review — the number was not verified', async () => {
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { support: false }));
  assert.equal(credit(c).status, 'review');
  assert.equal(credit(c).autoConfirmed, false);
  assert.deepEqual(reasons(c), ['number']);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 0);
  const html = card(c);
  assert.match(html, /<p data-credit-review-reason[^>]*>מספר הזיכוי לא אומת בשרת — בדוק אותו מול הנייר<\/p>/);
  assert.match(html, /<input data-role="delivery-credit-number" data-id="credit-1" value="22229080"/);
  assert.deepEqual(barcodeInputs(html), [], 'identified rows keep no barcode field');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true, 'one tap after a look at the number, as in v364');
  assert.equal(credit(c).autoConfirmed, false);
  assert.equal(finish(c).status, 'ok');
  // Reload: the restored credit keeps the same reason, and nothing attaches on restore.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(credit(reloaded).status, 'confirmed', 'the worker\'s confirmation survives');
  // A disputed subtotal on a v148 answer is still named on its own, next to the number.
  const d = setup();
  await readCredit(d.c, d.data, verifiedCredit(d.data, { support: false, docIssues: ['subtotalExVat'] }));
  assert.deepEqual(reasons(d.c), ['disputed', 'number']);
  assert.match(card(d.c), /הקריאות לא הסכימו על הסכום לפני מע״מ — בדוק מול הנייר · מספר הזיכוי לא אומת בשרת — בדוק אותו מול הנייר/);
});

// v365: only one read parsed — the other cheap read and the verifier dropped (service v149: readings holds
// read 0 alone, every summary field and the number in issues with empty support, the rows without support
// either). Nothing disagreed, so the card must not say the reads did not agree: it says one read succeeded
// and asks for the slip — one line, no second "number" reason — and one tap attaches, as in v364.
test('when only one read parsed the card says so instead of claiming a dispute, and one tap attaches after a look at the slip', async () => {
  const summary = { pageCount: 1, subtotalExVat: -48.8, printedUnits: -7, printedLines: 2, documentDiscountExVat: null, vatAmount: -8.78, totalInclVat: -57.58 };
  const unsupported = ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
  const { c, data } = setup();
  await readCredit(c, data, verifiedCredit(data, { docIssues: ['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount', 'invoiceNumber'],
    readings: [{ read: 0, values: summary }], rowOptions: { 0: { issues: unsupported }, 1: { issues: unsupported } } }));
  assert.equal(credit(c).status, 'review');
  assert.equal(credit(c).autoConfirmed, false);
  assert.deepEqual(reasons(c), ['disputed']);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 0);
  const html = card(c);
  assert.match(html, /<p data-credit-review-reason[^>]*>רק קריאה אחת של הנייר הצליחה — בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר<\/p>/);
  assert.doesNotMatch(html, /לא הסכימו|לא אומת בשרת/, 'no disagreement is claimed, and the number is not reported a second time');
  assert.deepEqual(barcodeInputs(html), [], 'identified rows keep no barcode field');
  assert.match(html, /data-role="delivery-credit-confirm"/);
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(credit(c).autoConfirmed, false);
  assert.equal(credit(c).paper.subtotalExVat, -48.8, 'the OCR paper is kept as read');
  // Two parsed reads that really disagreed keep the field-specific sentence.
  const b = setup();
  await readCredit(b.c, b.data, verifiedCredit(b.data, { docIssues: ['subtotalExVat'], readings: [{ read: 0, values: summary }, { read: 1, values: { ...summary, subtotalExVat: -46.8 } }] }));
  assert.deepEqual(reasons(b.c), ['disputed']);
  assert.match(card(b.c), /<p data-credit-review-reason[^>]*>הקריאות לא הסכימו על הסכום לפני מע״מ — בדוק מול הנייר<\/p>/);
  assert.doesNotMatch(card(b.c), /רק קריאה אחת/);
});
