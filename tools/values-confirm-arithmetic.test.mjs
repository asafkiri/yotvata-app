// v395: the one-tap approval on the "צריך להשלים את הבדיקה" card ("כן, הכמות והמחיר נכונים לפי הנייר")
// never approves cells that contradict the row's own arithmetic. aiRowArithmeticError deliberately (v183)
// skips unit × quantity against the gross when the net line total was read — the document gate there is
// the paper closing to the agora, and that stays. But the one-tap approval adopts the cells as printed:
// 6 × 16.13 = 96.78 against a gross of 96.18 means one cell was misread, and the worker is sent to
// "הפענוח שגוי — תקן לפי הנייר" instead. The tolerance is aiRowArithmeticError's: half an agora per unit
// when the unit price is printed in agorot, one agora otherwise. Without a gross: unit × quantity minus the
// discount against the net, only when both were read. A printed 0 in the gross column (a deposit row, v181)
// is not a gross that was read. Runs the complete app module (receipt-scan-harness). No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const html = c => c.run('receiptPriceAuditHtml()');
const pending = c => json(c, 'priceAuditPendingRows(receiptPriceAudit())').map(r => r.rowIndex);
const canConfirm = c => c.run('priceAuditCanConfirmValues(aiSourceRow(0,0))');
const token = c => c.run('priceAuditValuesReviewToken(aiSourceRow(0,0))');
const GROSS_HOLD = '<p class="mt-2 font-bold">מחיר × כמות אינו תואם לסכום הברוטו בשורה — תקן לפי הנייר</p>';
const NET_HOLD = '<p class="mt-2 font-bold">מחיר × כמות פחות ההנחה אינו תואם לסכום השורה — תקן לפי הנייר</p>';
const EVIDENCE_KEYS = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
  'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];

// One invoice row the reads did not agree on (issues ['quantity'], as service v149 answers), its paper
// balanced (the subtotal is the row's net, the printed units its quantity — 0 for a deposit row, which the
// printed units total does not count). `values` replaces the row's money cells as read; the catalog price
// is the paper's unit price unless `catalogPrice` says otherwise. `card: false` for a row that is withheld
// for another reason and may not reach the card at all.
function setup(values, { description = null, deposit = false, catalogPrice = values.unitPriceExVat, card = true } = {}) {
  const data = fixture('yotvata'), d = data.paper.scan.documents[0], r = d.rows[0];
  Object.assign(r, values);
  if (description) r.description = description;
  if (catalogPrice > 0) data.products[0].price = catalogPrice;
  if (deposit) Object.assign(data.products[0], { name: description, deposit: Number(r.unitPriceExVat) });
  d.subtotalExVat = d.itemsSectionTotalExVat = r.lineTotalExVat;
  d.printedUnits = deposit ? 0 : r.quantity;
  r.barcodeMatchMethod = 'model_consensus';
  r.modelVerification = { version: 1, status: 'needs_review', selectedRead: 1, strongSelected: false,
    identity: { productId: 'milk', barcode: r.barcode }, identitySupport: [0], issues: ['quantity'],
    evidence: Object.fromEntries(EVIDENCE_KEYS.map(k => [k, r[k] ?? null])) };
  d.__pricePaper = structuredClone(d); d.__priceSourceId = 'values-arithmetic';
  const units = d.printedUnits;
  const saved = { ...data.paper, docInputs: [{ amount: d.subtotalExVat, units, pageCount: 1 }] };
  const c = runtime('yotvata', { data }); c.context.savedReview = saved;
  c.run(`receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedReview);receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-20');
    receiptDocDate='2026-09-20';receiptNotes=[{amount:${d.subtotalExVat},units:${units}}];recomputeNoteTotal();receiptList=structuredClone(testData.items);
    saveReceiptDraft();renderReceiving()`);
  if (card) assert.deepEqual(json(c, 'receiptPriceAudit().rows[0].modelReviewIssues'), ['quantity'], 'the row is on the "בדוק את הכמות מול הנייר" card');
  return { c, data };
}
const row = (quantity, unitPriceExVat, grossLineTotalExVat, lineDiscountExVat, lineTotalExVat) =>
  ({ quantity, unitPriceExVat, grossLineTotalExVat, lineDiscountExVat, lineTotalExVat });

// The field case: the paper says 6 × 16.03 = 96.18 (the catalog price 16.03); the read unit price is 16.13.
const FIELD = [row(6, 16.13, 96.18, 0, 96.18), { catalogPrice: 16.03 }];

test('the field case: 6 × 16.13 = 96.78 against a gross of 96.18 — no one-tap approval, one reason line, the correction stays', async () => {
  const { c, data } = setup(...FIELD);
  // v183 stays: the evaluator's row check still skips unit × quantity against the gross when the net was read.
  assert.equal(c.run('aiRowArithmeticError(aiSourceRow(0,0).row, 6)'), '');
  assert.equal(canConfirm(c), false);
  assert.deepEqual(json(c, 'priceAuditValuesConfirmation(aiSourceRow(0,0))'), { ok: false, hold: 'מחיר × כמות אינו תואם לסכום הברוטו בשורה' });
  const h = html(c);
  assert.match(h, /בדוק את הכמות מול הנייר/); // v398: the card title says what to check
  assert.doesNotMatch(h, /data-role="price-confirm-values"|כן, הכמות והמחיר נכונים לפי הנייר/);
  assert.equal(h.split(GROSS_HOLD).length - 1, 1, 'exactly one reason line');
  assert.match(h, /data-role="paper-row-edit"[^>]*>הפענוח שגוי — תקן לפי הנייר<\/button>/);
  assert.doesNotMatch(h, /הסריקות לא הסכימו על נתוני השורה\. בדוק ואשר/, 'no "approve" wording without an approve button');
  assert.deepEqual(pending(c), [0]);
  // The token path refuses too: a valid token of the current row cannot approve it.
  const before = c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))');
  assert.equal(c.run(`priceAuditConfirmValues(0, 0, ${JSON.stringify(token(c))})`), false);
  await c.click('price-confirm-values', '', { doc: '0', row: '0', reviewToken: token(c) });
  assert.equal(c.run('aiSourceRow(0,0).mapped.paperValuesReview'), undefined);
  assert.deepEqual(pending(c), [0]);
  assert.equal(c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))'), before, 'nothing altered');
  // The same after a reload.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.equal(reloaded.run('priceAuditCanConfirmValues(aiSourceRow(0,0))'), false);
  assert.ok(reloaded.run('receiptPriceAuditHtml()').includes(GROSS_HOLD));
  assert.equal(c.requests.length + reloaded.requests.length, 0);
});

test('the worker corrects the row from the paper: the arithmetic agrees and the row is settled', async () => {
  const { c } = setup(...FIELD);
  await c.click('paper-row-edit', '', { doc: '0', row: '0' });
  c.node('paperRowQty').value = '6'; c.node('paperRowUnit').value = '16.03'; c.node('paperRowTotal').value = '96.18';
  await c.events.get('paperRowSave:click')();
  assert.equal(c.run('paperRowCorrectionValid(aiScanResponse.scan.documents[0], 0)'), true);
  assert.deepEqual(json(c, 'paperRowValues(aiSourceRow(0,0).row)'), { quantity: 6, unitPriceExVat: 16.03, grossLineTotalExVat: 96.18, lineDiscountExVat: 0, lineTotalExVat: 96.18 });
  assert.deepEqual(pending(c), []);
  assert.equal(json(c, 'receiptPriceAudit()').rows[0].result, 'match');
  assert.doesNotMatch(html(c), /אינו תואם לסכום/);
});

test('a consistent row keeps the one-tap approval exactly as before', async () => {
  const { c } = setup(row(6, 16.03, 96.18, 0, 96.18));
  assert.equal(canConfirm(c), true);
  assert.deepEqual(json(c, 'priceAuditValuesConfirmation(aiSourceRow(0,0))'), { ok: true, hold: '' });
  const h = html(c);
  assert.match(h, /<p class="mt-2 font-bold">בדוק את הכמות, מחיר היחידה וסכום השורה מול הנייר\.<\/p>/);
  assert.match(h, /data-role="price-confirm-values"[^>]*>כן, הכמות והמחיר נכונים לפי הנייר<\/button>/);
  assert.match(h, /data-role="paper-row-edit"/);
  assert.doesNotMatch(h, /אינו תואם לסכום/);
  const before = c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))');
  await c.click('price-confirm-values', '', { doc: '0', row: '0', reviewToken: token(c) });
  assert.ok(c.run('aiSourceRow(0,0).mapped.paperValuesReview'));
  assert.deepEqual(pending(c), []);
  assert.equal(c.run('aiScanEvaluation.valid'), true);
  assert.equal(c.run('JSON.stringify(paperRowValues(aiSourceRow(0,0).mapped))'), before, 'the values are kept as read');
});

test('the tolerance is aiRowArithmeticError\'s: half an agora per unit for a price printed in agorot, one agora otherwise', () => {
  const cases = [
    // 6 units, price in agorot: up to 4 agorot (ceil(6 × 0.5 + 0.5)).
    [row(6, 16.03, 96.22, 0, 96.22), true],
    [row(6, 16.03, 96.14, 0, 96.14), true],
    [row(6, 16.03, 96.23, 0, 96.23), false],
    [row(6, 16.03, 96.13, 0, 96.13), false],
    // A rounded printed price (1.79 for 1.79333): 24 × 1.79 = 42.96 against 43.04 is within 13 agorot.
    [row(24, 1.79, 43.04, 0, 43.04), true],
    [row(24, 1.79, 43.10, 0, 43.10), false],
    // A price with more decimals is exact: one agora. 24 × 1.79333 = 43.04.
    [row(24, 1.79333, 43.04, 0, 43.04), true],
    [row(24, 1.79333, 43.05, 0, 43.05), true],
    [row(24, 1.79333, 43.06, 0, 43.06), false],
    // A row discount: the gross is checked against unit × quantity, gross − discount against the net as before.
    [row(10, 5, 50, 5, 45), true],
    [row(10, 5, 50, -5, 45), true],
    [row(10, 5.2, 50, 5, 45), false]
  ];
  for (const [values, ok] of cases) {
    const { c } = setup(values);
    assert.equal(c.run('aiRowArithmeticError(aiSourceRow(0,0).row, ' + values.quantity + ')'), '', 'v183: no row error in the evaluator · ' + JSON.stringify(values));
    assert.equal(canConfirm(c), ok, JSON.stringify(values));
    const h = html(c);
    assert.equal(/data-role="price-confirm-values"/.test(h), ok, JSON.stringify(values));
    assert.equal(h.includes(GROSS_HOLD), !ok, JSON.stringify(values));
  }
});

test('without a gross: unit × quantity − discount against the net, both ways; nothing to check without a discount', async () => {
  // 6 × 16.03 = 96.18 − 6.18 = 90.00.
  const consistent = setup(row(6, 16.03, null, 6.18, 90)).c;
  assert.equal(canConfirm(consistent), true);
  assert.match(html(consistent), /data-role="price-confirm-values"/);
  assert.equal(setup(row(6, 16.03, null, -6.18, 90)).c.run('priceAuditCanConfirmValues(aiSourceRow(0,0))'), true, 'a discount printed with a minus (v180)');
  assert.equal(setup(row(6, 16.03, null, 6.14, 90.04)).c.run('priceAuditCanConfirmValues(aiSourceRow(0,0))'), true, 'within 4 agorot');
  // 96.18 − 6.18 = 90.00, not 89.00.
  const { c } = setup(row(6, 16.03, null, 6.18, 89));
  assert.equal(canConfirm(c), false);
  assert.deepEqual(json(c, 'priceAuditValuesConfirmation(aiSourceRow(0,0))'), { ok: false, hold: 'מחיר × כמות פחות ההנחה אינו תואם לסכום השורה' });
  const h = html(c);
  assert.doesNotMatch(h, /data-role="price-confirm-values"/);
  assert.equal(h.split(NET_HOLD).length - 1, 1);
  assert.match(h, /data-role="paper-row-edit"/);
  await c.click('price-confirm-values', '', { doc: '0', row: '0', reviewToken: token(c) });
  assert.equal(c.run('aiSourceRow(0,0).mapped.paperValuesReview'), undefined);
  // Neither gross nor discount read: no relation between the cells to check, the approval is offered as before.
  const bare = setup(row(6, 16.13, null, null, 96.18)).c;
  assert.equal(canConfirm(bare), true);
  assert.doesNotMatch(html(bare), /אינו תואם לסכום/);
});

test('deposit and edge rows are unchanged', () => {
  // A deposit row whose cells agree (24 × 4.50 = 108.00): the worker's one-tap approval as before.
  const deposit = setup(row(24, 4.5, 108, 0, 108), { description: 'פיקדון בקבוק', deposit: true }).c;
  assert.equal(canConfirm(deposit), true);
  assert.match(html(deposit), /data-role="price-confirm-values"/);
  // A deposit row printed with 0 in the gross column and the money only in the net (v181): a printed 0 is not
  // a gross that was read, so it does not contradict 24 × 4.50 — the approval is offered as before.
  const zeroGross = setup(row(24, 4.5, 0, null, 108), { description: 'פיקדון בקבוק', deposit: true }).c;
  assert.equal(zeroGross.run('aiRowArithmeticError(aiSourceRow(0,0).row, 24)'), '');
  assert.equal(canConfirm(zeroGross), true);
  assert.match(html(zeroGross), /data-role="price-confirm-values"/);
  assert.doesNotMatch(html(zeroGross), /אינו תואם לסכום/);
  // The same row with a discount of 0 read was refused before v395 (0 − 0 ≠ 108) and is refused the same
  // way: no approval and no new reason line — the card keeps its general wording.
  const zeroGrossDiscount = setup(row(24, 4.5, 0, 0, 108), { description: 'פיקדון בקבוק', deposit: true }).c;
  assert.notEqual(zeroGrossDiscount.run('aiRowArithmeticError(aiSourceRow(0,0).row, 24)'), '');
  assert.deepEqual(json(zeroGrossDiscount, 'priceAuditValuesConfirmation(aiSourceRow(0,0))'), { ok: false, hold: '' });
  assert.doesNotMatch(html(zeroGrossDiscount), /data-role="price-confirm-values"|אינו תואם לסכום/);
  assert.match(html(zeroGrossDiscount), /הסריקות לא הסכימו על נתוני השורה/);
  // Rows withheld for another reason keep their card: no reason line for the arithmetic is added.
  for (const values of [row(6.5, 16.03, 104.2, 0, 104.2), row(6, null, 96.18, 0, 96.18), row(6, 16.13, 96.18, 0, null)]) {
    const { c } = setup(values, { card: false });
    assert.equal(json(c, 'priceAuditValuesConfirmation(aiSourceRow(0,0))').hold, '', JSON.stringify(values));
    assert.doesNotMatch(html(c), /data-role="price-confirm-values"|אינו תואם לסכום/, JSON.stringify(values));
  }
});

test('the document gate is unchanged: the same contradiction on a row the reads agreed on is a warning, not a row error', () => {
  const { c } = setup(...FIELD);
  c.run(`const r=aiScanResponse.scan.documents[0].rows[0];r.modelVerification.issues=[];r.modelVerification.status='agreed';renderReceiving()`);
  const evaluation = json(c, 'aiEvaluateInvoiceScan(aiScanResponse)');
  assert.equal(evaluation.errors.some(e => /אינו תואם/.test(e)), false, evaluation.errors.join(' | '));
  assert.ok(evaluation.warnings.some(e => /מחיר × כמות \(₪96\.78\) אינו תואם לברוטו שנקרא \(₪96\.18\)/.test(e)), evaluation.warnings.join(' | '));
  assert.doesNotMatch(html(c), /data-role="price-confirm-values"|אינו תואם לסכום הברוטו בשורה — תקן/);
});
