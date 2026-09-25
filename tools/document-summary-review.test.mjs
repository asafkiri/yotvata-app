// v365: the document-summary review asks only about a real dispute, and says which one.
// Field evidence (the shop's backup, receipt of 2026-09-25, app v364 / service v148):
// invoice 407300217607 was read three times; all three read 311.77 before VAT, 61 units
// and six rows. The verifier (the strong model) also read the printed "total of
// discounts" line (41.90), which is already included in the net rows
// (11.93 + 15.97 + 7 + 7). Consensus flagged documentDiscountExVat, and the app asked
// the worker to confirm a summary that every read agreed on.
// These tests run the complete app module (receipt-scan-harness). No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const report = c => json(c, 'receiptPriceAudit()');
const html = c => c.run('receiptPriceAuditHtml()');
const needed = c => c.run('priceAuditDocumentReviewNeeded(aiScanResponse.scan.documents[0])');
const finishErrors = c => json(c, 'aiEvaluateInvoiceScan(aiScanResponse).errors || []');

// One verified row (10 × milk, 50.00). `issues`, `readings`, `discount` and `rows` shape the
// selected paper; `verification` is what the per-document scan carried (service v149 adds
// verifier { attempted, outcome, model }); `subtotal` overrides the printed summary.
function setup({ issues = [], readings = null, discount = null, subtotal = null, verification = null, rows = null, pageCount = 1 } = {}) {
  const data = fixture('yotvata'), d = data.paper.scan.documents[0], r = d.rows[0];
  r.barcodeMatchMethod = 'model_consensus';
  r.modelVerification = { version: 1, status: 'verified', selectedRead: 2, strongSelected: true, issues: [],
    identity: { productId: 'milk', barcode: r.barcode }, identitySupport: [1],
    evidence: Object.fromEntries(['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
      'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'].map(k => [k, r[k] ?? null])) };
  if (rows) d.rows = rows;
  d.documentDiscountExVat = discount;
  if (subtotal != null) d.subtotalExVat = subtotal;
  d.printedUnits = d.rows.reduce((n, row) => n + row.quantity, 0);
  d.printedLines = d.rows.length;
  d.pageCount = pageCount;
  d.modelVerification = { version: 1, issues, values: { pageCount: d.pageCount, subtotalExVat: d.subtotalExVat, printedUnits: d.printedUnits, documentDiscountExVat: discount },
    ...(readings ? { readings, support: {} } : {}) };
  d.__pricePaper = structuredClone(d); d.__priceSourceId = 'summary-fixture';
  const saved = { ...data.paper, docInputs: [{ amount: d.subtotalExVat, units: d.printedUnits, pageCount }],
    perDocument: [{ docIndex: 0, ok: true, serviceVersion: 148, model: 'fixture', requestId: 'audit-fixture', verification }] };
  const c = runtime('yotvata', { data }); c.context.savedReview = saved;
  c.run("receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedReview);receiptPaperScanState='ok';receiptDocDate='2026-09-20';receiptNotes=[{amount:aiScanResponse.scan.documents[0].subtotalExVat,units:aiScanResponse.scan.documents[0].printedUnits}];recomputeNoteTotal();receiptList=structuredClone(testData.items);saveReceiptDraft();renderReceiving()");
  return { c, data };
}
const reading = (read, values) => ({ read, values: { pageCount: 1, subtotalExVat: 50, printedUnits: 10, printedLines: 1, documentDiscountExVat: null, vatAmount: 9, totalInclVat: 59, ...values } });

test('a disputed "document discount" on a paper that balances without it is informational: no review, the audit proceeds', () => {
  const { c } = setup({ issues: ['documentDiscountExVat'], discount: 10 });
  assert.equal(needed(c), false);
  assert.equal(report(c).documents[0].reviewRequired, false);
  assert.equal(report(c).complete, true);
  assert.doesNotMatch(html(c), /price-confirm-document|אימות סיכום תעודה|צריך לאשר את סיכום התעודה/);
  assert.equal(finishErrors(c).some(e => /לא הסכימו|לא אומת/.test(e)), false);
  assert.equal(c.run('aiScanResponse.scan.documents[0].documentDiscountExVat'), 10, 'the OCR value is never touched');
  assert.equal(c.run('aiScanResponse.scan.documents[0].paperSummaryReview'), undefined, 'no approval record was invented');
});

test('the field evidence: 311.77 / 61 units / six rows agreed, only the printed total of discounts (41.90) disputed — no review', () => {
  const rows = [[5, 67.62], [12, 46.32], [12, 90.47], [6, 39.68], [6, 39.68], [20, 28]].map(([quantity, lineTotalExVat], i) => ({
    section: 'items', description: 'שורה ' + (i + 1), barcode: null, barcodeObserved: null, lineNumber: i + 1, sourcePage: 1, quantity,
    unitPriceExVat: Math.round(lineTotalExVat / quantity * 100) / 100, grossLineTotalExVat: lineTotalExVat, lineTotalExVat, lineDiscountExVat: null }));
  const { c } = setup({ rows, subtotal: 311.77, discount: 41.9, issues: ['documentDiscountExVat'] });
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 1).ok'), true);
  assert.equal(c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 1).discountSeparate'), false);
  assert.equal(needed(c), false);
  assert.doesNotMatch(html(c), /price-confirm-document/);
});

test('a document discount that the arithmetic really needs, or an unbalanced paper, still asks for the summary review', () => {
  // rows 60, discount 10, subtotal 50: the discount is separate — a real dispute about it matters.
  const separate = setup({ issues: ['documentDiscountExVat'], discount: 10, subtotal: 50,
    rows: [{ ...fixture('yotvata').paper.scan.documents[0].rows[0], grossLineTotalExVat: 60, lineTotalExVat: 60, unitPriceExVat: 6 }] });
  assert.equal(separate.c.run('yotvataPaperCheck(aiScanResponse.scan.documents[0], 1).discountSeparate'), true);
  assert.equal(needed(separate.c), true);
  assert.match(html(separate.c), /הקריאות לא הסכימו על הנחת המסמך\./);
  // rows 50 but subtotal 55: not balanced — the discount dispute is not waved through.
  const unbalanced = setup({ issues: ['documentDiscountExVat'], discount: 5, subtotal: 55 });
  assert.equal(needed(unbalanced.c), true);
});

test('a genuine subtotal dispute names the field and lists what each read saw (service v149 readings)', async () => {
  const { c, data } = setup({ issues: ['subtotalExVat'], readings: [reading(0, { subtotalExVat: 50 }), reading(1, { subtotalExVat: 55 }), reading(2, { subtotalExVat: 50 })] });
  assert.equal(needed(c), true);
  assert.equal(report(c).complete, false);
  const h = html(c);
  assert.match(h, /צריך לאשר את סיכום התעודה/);
  assert.match(h, /אימות סיכום תעודה/);
  assert.match(h, /הקריאות לא הסכימו על הסכום לפני מע״מ\./);
  assert.match(h, /<p[^>]*data-dispute-field="subtotalExVat">הסכום לפני מע״מ: קריאה 1: 50\.00 · קריאה 2: 55\.00 · קריאה 3 \(המודל החזק\): 50\.00<\/p>/);
  assert.doesNotMatch(h, /data-dispute-field="printedUnits"/, 'only the disputed field is listed');
  assert.doesNotMatch(h, /הקריאה השלישית \(המודל החזק\) נכשלה/);
  assert.match(h, /בדוק מול הנייר: ₪50\.00 לפני מע״מ · 10 יחידות · 1 שורות שנקראו\./);
  assert.equal((h.match(/data-role="price-confirm-document"/g) || []).length, 1);
  assert.ok(finishErrors(c).some(e => e === 'תעודה 1: הקריאות לא הסכימו על הסכום לפני מע״מ — צריך לאשר את הסיכום מול הנייר'), finishErrors(c).join(' | '));
  // The worker checks the paper and confirms; the approval survives a reload.
  const token = c.run('priceAuditDocumentReviewToken(aiScanResponse.scan.documents[0])');
  await c.click('price-confirm-document', '', { doc: '0', reviewToken: token });
  assert.equal(needed(c), false);
  assert.equal(report(c).complete, true);
  assert.equal(runtime('yotvata', { data, storage: c.storage }).run('receiptPriceAudit().complete'), true);
});

test('two disputed fields are both named; a missing reading value says so', () => {
  const { c } = setup({ issues: ['subtotalExVat', 'printedUnits'], readings: [reading(0, {}), reading(1, { subtotalExVat: 52, printedUnits: null })] });
  const h = html(c);
  assert.match(h, /הקריאות לא הסכימו על הסכום לפני מע״מ ועל סך היחידות\./);
  assert.match(h, /data-dispute-field="printedUnits">סך היחידות: קריאה 1: 10 · קריאה 2: לא נקרא</);
});

test('when the verifier failed the panel says so; without verifier data (service v148) it keeps a field-specific sentence', () => {
  // Service v149: verifier { attempted, model, requestId, outcome: not_needed|failed|agreed|disagreed, error, selected }.
  const failed = setup({ issues: ['printedUnits'], verification: { version: 1, status: 'needs_review', primaryReads: 2, escalationAttempted: true, selectedRead: 0, readCount: 2,
    verifier: { attempted: true, outcome: 'failed', error: 'timeout', model: 'gpt-5.6-terra', requestId: null, selected: false } } });
  const h = html(failed.c);
  assert.match(h, /הקריאות לא הסכימו על סך היחידות\. הקריאה השלישית \(המודל החזק\) נכשלה, לכן נשארו שתי קריאות שלא הסכימו\./);
  assert.match(h, /<p class="[^"]*text-slate-400" dir="ltr">timeout<\/p>/, 'the technical reason is a small ltr line');
  assert.doesNotMatch(h, /data-dispute-field/, 'no readings, no per-read list');
  assert.match(h, /data-role="price-confirm-document"/);
  // The verifier record is kept with the document's metadata, so a reload explains the same.
  const reloaded = runtime('yotvata', { data: failed.data, storage: failed.c.storage });
  assert.match(html(reloaded), /הקריאה השלישית \(המודל החזק\) נכשלה/);
  assert.equal(json(reloaded, 'aiScanResponse.perDocument[0].verification.verifier.error'), 'timeout');
  // A verifier that read the paper and still left no two reads agreeing says so, and is not "failed".
  const disagreed = setup({ issues: ['printedUnits'], verification: { version: 1, status: 'needs_review', escalationAttempted: true, verifier: { attempted: true, outcome: 'disagreed', error: null, model: 'gpt-5.6-terra', selected: true } } });
  assert.match(html(disagreed.c), /גם הקריאה השלישית \(המודל החזק\) קראה את הנייר, ועדיין אין שתי קריאות שמסכימות\./);
  assert.doesNotMatch(html(disagreed.c), /נכשלה|text-slate-400" dir="ltr"/);
  const ran = setup({ issues: ['printedUnits'], verification: { version: 1, status: 'needs_review', escalationAttempted: true, verifier: { attempted: true, outcome: 'agreed', error: null, model: 'gpt-5.6-terra' } } });
  assert.doesNotMatch(html(ran.c), /נכשלה|קראה את הנייר/);
  // v148: no verifier field at all.
  const old = setup({ issues: ['printedUnits'] });
  assert.match(html(old.c), /הקריאות לא הסכימו על סך היחידות\./);
  assert.doesNotMatch(html(old.c), /נכשלה/);
  assert.match(html(old.c), /בדוק מול הנייר: ₪50\.00 לפני מע״מ · 10 יחידות · 1 שורות שנקראו\./);
});

test('a scan result carries scan.verification into the per-document metadata and the draft', async () => {
  const data = fixture('yotvata');
  data.paper.scan.verification = { version: 1, status: 'verified', primaryReads: 2, escalationAttempted: false, selectedRead: 0, readCount: 2, verifier: { attempted: false, outcome: null, model: null } };
  const c = runtime('yotvata', { data });
  await c.scan();
  assert.equal(json(c, 'aiScanResponse.perDocument[0].verification.status'), 'verified');
  assert.equal(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY)).aiScan.perDocument[0].verification.verifier.attempted'), false);
  assert.equal(c.run('priceAuditVerifierFailed(priceAuditDocumentVerification(aiScanResponse.scan.documents[0]))'), false);
});

test('the approval token still invalidates on value changes, and the confirm button obeys it', async () => {
  const { c } = setup({ issues: ['subtotalExVat'] });
  const token = c.run('priceAuditDocumentReviewToken(aiScanResponse.scan.documents[0])');
  assert.equal(c.run(`priceAuditConfirmDocument(0, ${JSON.stringify(token + 'x')})`), false, 'a stale token is refused');
  assert.equal(needed(c), true);
  await c.click('price-confirm-document', '', { doc: '0', reviewToken: token });
  assert.equal(needed(c), false);
  for (const change of ['aiScanResponse.scan.documents[0].__pricePaper.rows[0].quantity=11',
    'aiScanResponse.scan.documents[0].__pricePaper.subtotalExVat=55',
    "aiScanResponse.scan.documents[0].modelVerification.issues=['subtotalExVat','printedUnits']"]) {
    const { c: d } = setup({ issues: ['subtotalExVat'] });
    await d.click('price-confirm-document', '', { doc: '0', reviewToken: d.run('priceAuditDocumentReviewToken(aiScanResponse.scan.documents[0])') });
    assert.equal(needed(d), false, change);
    d.run(change);
    assert.equal(needed(d), true, change);
  }
});

test('an effect-based discount dispute (service v149) explains the effect, not just identical digits', () => {
  // selected: rows 50, discount 5, subtotal 45 (the discount comes off the total); peer: rows 50, discount 5,
  // subtotal 50 (informational) — same digits, different effect. scan-consensus.js runConsensus emits exactly
  // this when the verifier fails, and the review is rightly still required (the subtotal is disputed too).
  const readings = [{ ...reading(0, { subtotalExVat: 45, documentDiscountExVat: 5 }), discountSeparate: true },
    { ...reading(1, { documentDiscountExVat: 5 }), discountSeparate: false }];
  const { c } = setup({ issues: ['subtotalExVat', 'documentDiscountExVat'], discount: 5, subtotal: 45, readings });
  assert.equal(needed(c), true);
  assert.match(html(c), /הקריאות לא הסכימו על הסכום לפני מע״מ ועל הנחת המסמך\./);
  assert.match(html(c), /data-dispute-field="documentDiscountExVat">הנחת המסמך: קריאה 1: 5\.00 \(יורדת מהסכום\) · קריאה 2: 5\.00 \(לא יורדת מהסכום\)</);
  assert.doesNotMatch(html(c), /data-dispute-field="subtotalExVat">[^<]*יורדת/, 'the effect is written on the discount line only');
  assert.equal(c.run('aiScanResponse.scan.documents[0].documentDiscountExVat'), 5, 'the OCR value is never touched');
  // Without the v149 flag (service v148) or without a value, the line reads as before.
  const plain = setup({ issues: ['documentDiscountExVat'], discount: 10, subtotal: 50,
    rows: [{ ...fixture('yotvata').paper.scan.documents[0].rows[0], grossLineTotalExVat: 60, lineTotalExVat: 60, unitPriceExVat: 6 }],
    readings: [reading(0, { documentDiscountExVat: 10 }), { ...reading(1, {}), discountSeparate: false }] });
  assert.match(html(plain.c), /data-dispute-field="documentDiscountExVat">הנחת המסמך: קריאה 1: 10\.00 · קריאה 2: לא נקרא</);
});

// v365: only one read parsed — a dropped connection failed cheap read B and the verifier (service v149:
// verifier { outcome: 'failed', error: 'network_error' }, readings for read 0 only, every summary field
// in issues because no other read supports it). Nothing disagreed, so the panel must not say the reads
// did not agree, nor that two reads remained; it says one read succeeded and asks for the paper.
test('when only one read parsed (the other cheap read and the verifier failed) the panel says so instead of claiming two reads disagreed', () => {
  const verification = { version: 1, status: 'needs_review', primaryReads: 2, escalationAttempted: true, selectedRead: 0, readCount: 3,
    verifier: { attempted: true, outcome: 'failed', error: 'network_error', model: 'gpt-5.6-terra', requestId: null, selected: false } };
  const { c, data } = setup({ issues: ['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount'], readings: [reading(0, {})], verification });
  const h = html(c);
  assert.equal(needed(c), true, 'a single read still needs the summary confirmed against the paper');
  assert.match(h, /רק קריאה אחת של הנייר הצליחה \(גם הקריאה השלישית, המודל החזק, נכשלה\), ולכן אין קריאה נוספת שמאשרת את הסיכום\./);
  assert.doesNotMatch(h, /לא הסכימו|נשארו שתי קריאות|data-dispute-field/, 'no dispute claimed, no per-read list for a single read');
  assert.match(h, /<p class="[^"]*text-slate-400" dir="ltr">network_error<\/p>/);
  assert.match(h, /בדוק מול הנייר: ₪50\.00 לפני מע״מ · 10 יחידות · 1 שורות שנקראו\./);
  assert.match(h, /data-role="price-confirm-document"/);
  assert.ok(finishErrors(c).some(e => e === 'תעודה 1: רק קריאה אחת של הנייר הצליחה — צריך לאשר את הסיכום מול הנייר'), finishErrors(c).join('\n'));
  assert.equal(finishErrors(c).some(e => /תעודה 1: הקריאות לא הסכימו/.test(e)), false);
  // After a reload the same explanation comes back from the draft.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.match(html(reloaded), /רק קריאה אחת של הנייר הצליחה/);
  // The same lone read without a verifier record (no scan.verification) still does not claim a dispute.
  const bare = setup({ issues: ['subtotalExVat', 'printedUnits'], readings: [reading(1, {})] });
  assert.match(html(bare.c), /רק קריאה אחת של הנייר הצליחה, ולכן אין קריאה נוספת שמאשרת את הסיכום\./);
  assert.doesNotMatch(html(bare.c), /נכשלה|לא הסכימו/);
  // Two parsed reads that really disagreed while the verifier failed keep the two-reads sentence.
  const two = setup({ issues: ['printedUnits'], readings: [reading(0, {}), reading(1, { printedUnits: 11 })], verification });
  assert.match(html(two.c), /הקריאות לא הסכימו על סך היחידות\. הקריאה השלישית \(המודל החזק\) נכשלה, לכן נשארו שתי קריאות שלא הסכימו\./);
  assert.match(html(two.c), /data-dispute-field="printedUnits"/);
  // Without readings at all (service v148) nothing is known about the read count: the field-specific sentence, as before.
  const old = setup({ issues: ['printedUnits'], verification });
  assert.match(html(old.c), /הקריאות לא הסכימו על סך היחידות\. הקריאה השלישית \(המודל החזק\) נכשלה, לכן נשארו שתי קריאות שלא הסכימו\./);
});
