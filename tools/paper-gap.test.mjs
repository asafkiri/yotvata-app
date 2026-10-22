// v399: a document that does not balance against its printed summary says what is missing, that no page is
// missing, where the gap is and which rows to check — and a correction that balances it releases the receipt.
// From the field (open receipt of 2026-10-22 09:38, service 153, app v397/398): delivery note 9073907315,
// 3 pages, 28 rows, ₪1,816.37 and 348 units printed, read three times and no read balanced. The selected read
// (the strong model) slid page 1's numbers one row: it skipped the labneh line (12 × ₪9.10 = ₪109.20) and counted
// ₪52.80 twice (Σ ₪1,759.97). One cheap read slid the same way from the labneh on, so the vote "verified" the
// wrong numbers; it had put the ₪109.20 on the line before (its page 1 sums right, on the wrong lines). The
// other cheap read had page 1 right (₪527.76) and pages 2–3 wrong. The worker saw "סכום שורות הנטו אינו תואם",
// "בדוק צילומים / הוסף עמוד חסר" and 36 cards "הפענוח חלקי או חסר עמוד", the second note (read perfectly)
// included. Replaying that draft (no row corrected yet) showed a bug too: correcting the three rows by the
// paper balances the note, but the receipt stays blocked ("השלם צילום או הזן ידנית את נתוני התעודה").
// This fixture is synthetic and smaller, with the field's pattern and its gap (₪56.40): page 1 of note 1 has
// five lines, the selected read (2) slides lines 2–4 and repeats line 5's numbers on line 4; read 0 slides the
// same way and puts line 2's numbers on line 1; read 1 reads page 1 right and misreads a page-2 price; read 0
// misreads another page-2 price. Note 2 is read alike by both cheap reads and balances.
// Run: node --test tools/paper-gap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';
import { ean13 } from './quantity-arithmetic-fixture.mjs';

const r2 = n => Math.round(n * 100) / 100;
const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

// [id, name, catalog price, note, page, quantity, unit price, line discount]
const LINES = [
  ['A', 'מעדן בדיקה תות', 4.4, 0, 1, 12, 4.4, 0],
  ['B', 'לאבנה בדיקה', 9.1, 0, 1, 12, 9.1, 0],
  ['C', 'דניאלה בדיקה', 2.89, 0, 1, 24, 2.89, 0],
  ['D', 'סלט בדיקה', 7.8, 0, 1, 12, 7.8, 14.04],
  ['G', 'מעדן בדיקה וניל', 4.4, 0, 1, 12, 4.4, 0],
  ['E', 'חלב בדיקה', 5, 0, 2, 10, 5, 0],
  ['F', 'גבינה בדיקה', 3, 0, 2, 10, 3, 0],
  ['H', 'יוגורט בדיקה', 5.5, 1, 1, 6, 5.5, 0],
  ['I', 'שוקו בדיקה', 3.72, 1, 1, 12, 3.72, 0],
];
const PRODUCTS = LINES.map(([id, name, price], i) => ({ id, name, barcode: ean13('72900077' + String(i + 1).padStart(4, '0')), price }));
const money = (quantity, unit, discount = 0) => { const gross = r2(quantity * unit); return { quantity, unitPriceExVat: unit, grossLineTotalExVat: gross, lineDiscountExVat: discount, lineTotalExVat: r2(gross - discount) }; };
const TRUE = LINES.map(([, , , , , q, u, d]) => money(q, u, d));
const NOTE1 = [0, 1, 2, 3, 4, 5, 6], NOTE2 = [7, 8];
const sum = (idx, f) => r2(idx.reduce((n, i) => n + TRUE[i][f], 0));
const SUBTOTAL1 = sum(NOTE1, 'lineTotalExVat'), UNITS1 = sum(NOTE1, 'quantity'); // 443.72, 92
const SUBTOTAL2 = sum(NOTE2, 'lineTotalExVat'), UNITS2 = sum(NOTE2, 'quantity'); // 77.64, 18
// What each read saw in note 1, line by line (the barcode column is always right: only the numbers slide).
const READS1 = {
  2: [TRUE[0], TRUE[2], TRUE[3], TRUE[4], TRUE[4], TRUE[5], TRUE[6]],     // selected: skips B's numbers, repeats G's
  0: [TRUE[1], TRUE[2], TRUE[3], TRUE[4], TRUE[4], TRUE[5], money(10, 3.3)], // B's numbers on line 1, then the same slide
  1: [TRUE[0], TRUE[1], TRUE[2], TRUE[3], TRUE[4], money(10, 5.3), TRUE[6]], // page 1 right, a page-2 price wrong
};
const FIELDS = ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
const EVIDENCE = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber', ...FIELDS];
const evidence = row => Object.fromEntries(EVIDENCE.map(k => [k, row[k] ?? null]));

function readRow(i, line, values) {
  const [, name, , , page] = LINES[i];
  return { sourcePage: page, lineNumber: line, rowRegion: null, barcode: PRODUCTS[i].barcode, barcodeReadType: 'full', catalogHintId: null,
    catalogCandidateHintIds: [], supplierItemCode: null, description: name, ...values, promotionText: null, confidence: 0.8 };
}
// The selected read's rows with the vote of the service (applyVotes: by position, equal row counts).
function votedRows(indices, selected, others) {
  return indices.map((i, k) => {
    const row = readRow(i, k + 1, selected.values[k]), identity = { productId: PRODUCTS[i].id, barcode: PRODUCTS[i].barcode };
    const peers = others.map(o => ({ read: o.read, row: readRow(i, k + 1, o.values[k]) }));
    const fieldSupport = Object.fromEntries(FIELDS.map(f => [f, peers.filter(p => p.row[f] === row[f]).map(p => p.read)]));
    const issues = FIELDS.filter(f => !fieldSupport[f].length);
    return { ...row, barcodeObserved: row.barcode, barcodeMatchMethod: 'model_consensus', barcodeResolvedProductId: PRODUCTS[i].id, barcodeRetryConflict: false,
      modelVerification: { version: 1, status: issues.length ? 'needs_review' : selected.strong ? 'verified' : 'agreed', selectedRead: selected.read, strongSelected: !!selected.strong,
        issues, identity, identitySupport: peers.map(p => p.read), candidates: [identity], fieldSupport,
        readings: [{ read: selected.read, identity, values: evidence(row) }, ...peers.map(p => ({ read: p.read, identity, values: evidence(p.row) }))], evidence: evidence(row) } };
  });
}
function note(noteIndex, number, pageCount, rows, subtotal, units, reads, { printedLines = rows.length } = {}) {
  const summary = { pageCount, subtotalExVat: subtotal, printedUnits: units, printedLines, documentDiscountExVat: null, vatAmount: r2(subtotal * 0.18), totalInclVat: r2(subtotal * 1.18) };
  const doc = { noteIndex, invoiceNumber: number, ...summary, confidence: 0.8, warnings: [], rows, documentType: 'delivery', printedTitle: 'תעודת משלוח',
    modelVerification: { version: 1, issues: [], values: { pageCount, subtotalExVat: subtotal, printedUnits: units, documentDiscountExVat: null },
      readings: reads.map(read => ({ read, values: summary, discountSeparate: false })),
      support: Object.fromEntries(['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount'].map(f => [f, reads.slice(1)])) } };
  doc.__pricePaper = structuredClone(doc); doc.__priceSourceId = 'paper_price_gap_' + noteIndex;
  return doc;
}
// The receipt draft as the phone stored it after the scan: paper state 'failed', the worker started counting.
function fieldDraft({ printedLines1 } = {}) {
  const rows1 = votedRows(NOTE1, { read: 2, strong: true, values: READS1[2] }, [{ read: 0, values: READS1[0] }, { read: 1, values: READS1[1] }]);
  const rows2 = votedRows(NOTE2, { read: 0, values: NOTE2.map(i => TRUE[i]) }, [{ read: 1, values: NOTE2.map(i => TRUE[i]) }]);
  const doc1 = note(0, 'TEST-GAP-1', 2, rows1, SUBTOTAL1, UNITS1, [2, 0, 1], { printedLines: printedLines1 ?? rows1.length });
  const doc2 = note(1, 'TEST-GAP-2', 1, rows2, SUBTOTAL2, UNITS2, [0, 1]);
  const verification = (status, selectedRead, verifier) => ({ version: 1, status, primaryReads: 2, escalationAttempted: !!verifier, selectedRead, readCount: verifier ? 3 : 2,
    verifier: verifier ? { attempted: true, model: 'gpt-5.6-terra', requestId: 'resp-gap-verifier', outcome: 'disagreed', error: null, selected: true } : { attempted: false, outcome: 'not_needed' } });
  const docInputs = [{ scanId: 'paper_gap_0', amount: null, units: null, pageCount: 2 }, { scanId: 'paper_gap_1', amount: null, units: null, pageCount: 1 }];
  const aiScan = { schemaVersion: 2, ok: true, serviceVersion: 153, model: 'gpt-5.6-terra · gpt-5.6-luna', requestId: 'resp-gap-1 · resp-gap-2',
    scan: { documents: [doc1, doc2], warnings: [] }, docInputs, pageCounts: [2, 1],
    perDocument: [{ docIndex: 0, ok: true, pageCount: 2, serviceVersion: 153, model: 'gpt-5.6-terra', requestId: 'resp-gap-1', verification: verification('needs_review', 2, true) },
      { docIndex: 1, ok: true, pageCount: 1, serviceVersion: 153, model: 'gpt-5.6-luna', requestId: 'resp-gap-2', verification: verification('agreed', 0, false) }] };
  return { schemaVersion: 4, draftId: 'receipt_gap_test', items: LINES.map(([id, name], i) => ({ productId: id, name, barcode: PRODUCTS[i].barcode, qty: TRUE[i].quantity })),
    notes: [], opened: true, docDate: null, dw: false, uw: false, noDoc: false, attach: null, entryMode: 'photo', anchorSource: null, countingMode: 'scan',
    quantityReview: null, manualInput: null, photoCaptureOpen: false, paperState: 'failed', paperProblems: ['תעודה 1: סכום שורות הנטו אינו תואם בדיוק לסיכום המודפס'],
    scanHistory: [], deliveryCredits: [], photoInputs: docInputs, analysisCache: null, aiScan };
}
function open(draft = fieldDraft(), storage = new Map()) {
  const data = harness.fixture('yotvata');
  data.products = PRODUCTS; data.items = [];
  if (draft) storage.set('yt_receipt_draft', JSON.stringify(draft));
  const c = harness.runtime('yotvata', { data, storage });
  c.run("receiptDocDate = '2026-10-22'; renderReceiving();");
  return c;
}
const banner = c => strip(c.run('yotvataPaperStatusHtml()'));
const panel = c => c.run('receiptPriceAuditHtml()');
const gapCard = html => (html.match(/<div data-paper-gap="0"[\s\S]*?נבדקת שוב, וכשהיא מתאזנת הקליטה ממשיכה\.<\/p><\/div>/) || [''])[0];
const gapRows = html => [...gapCard(html).matchAll(/data-paper-gap-row="0:(\d+)"/g)].map(m => Number(m[1]));
function suggestion(html, row) {
  const m = html.match(new RegExp('data-role="paper-row-suggest" data-doc="0" data-row="' + row + '" data-qty="([^"]+)" data-unit="([^"]+)" data-total="([^"]+)"'));
  return m ? { qty: m[1], unit: m[2], total: m[3] } : null;
}
// The worker taps "בנייר כתוב …": the correction window opens prefilled; the worker compares and approves.
function takeSuggestion(c, row) {
  const s = suggestion(panel(c), row);
  assert.ok(s, 'a suggestion for row ' + (row + 1));
  c.click('paper-row-suggest', '', { doc: '0', row: String(row), ...s });
  const modal = c.node('new-div').innerHTML;
  const value = id => (modal.match(new RegExp('id="' + id + '"[^>]*value="([^"]*)"')) || [])[1];
  for (const id of ['paperRowQty', 'paperRowUnit', 'paperRowTotal']) c.node(id).value = value(id);
  c.events.get('paperRowSave:click')();
  return { modal, values: [value('paperRowQty'), value('paperRowUnit'), value('paperRowTotal')] };
}

test('the field case: one card says what is missing, that no page is missing, where the gap is and which rows to check; nothing else is a card', () => {
  const c = open();
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(c, 'yotvataPaperCheck(aiScanResponse.scan.documents[0], 2)'), { ok: false, problems: ['סכום שורות הנטו אינו תואם בדיוק לסיכום המודפס'],
    missingSummary: false, retryable: true, amount: SUBTOTAL1, units: UNITS1, rowAmount: r2(SUBTOTAL1 - 56.4), rowUnits: UNITS1, discountSeparate: false });
  const gap = json(c, 'yotvataPaperGaps()');
  assert.equal(gap.length, 1, 'only note 1: note 2 balances');
  assert.deepEqual({ ...gap[0].gap, rows: undefined }, { gapCents: 5640, subtotal: 44372, rowCents: 38732, unitsGap: 0, rowUnits: 92, page: 1, pageSum: 30732,
    readPageSum: 36372, pageUnits: 72, readPageUnits: 72, alternatives: true, rows: undefined, more: 0, lines: 7, linesPrinted: true, units: 92 });
  // Line 1: read 0 saw B's numbers there (wrong, catalog 4.40); lines 2–4: read 1 saw the paper. Line 5: both agree.
  assert.deepEqual(gap[0].gap.rows, [
    { rowIndex: 0, suggestions: [{ quantity: 12, unitPriceExVat: 9.1, lineTotalExVat: 109.2 }] },
    { rowIndex: 1, suggestions: [{ quantity: 12, unitPriceExVat: 9.1, lineTotalExVat: 109.2 }] },
    { rowIndex: 2, suggestions: [{ quantity: 24, unitPriceExVat: 2.89, lineTotalExVat: 69.36 }] },
    { rowIndex: 3, suggestions: [{ quantity: 12, unitPriceExVat: 7.8, lineTotalExVat: 79.56 }] }]);
  assert.equal(banner(c), 'תעודה TEST-GAP-1: חסרים ₪56.40 מול הסיכום המודפס כל השורות והיחידות נקראו, אז לא חסר עמוד. כנראה מספר באחת השורות נקרא לא נכון. ההפרש בעמוד 1. ' +
    'בדוק מול הנייר את השורות המסומנות בבדיקת המחירים למטה, ותקן רק שורה שלא תואמת. אפשר להמשיך בספירה בינתיים. או צלם את התעודה מחדש או הקלד סכום ויחידות');
  assert.doesNotMatch(banner(c), /הוסף עמוד חסר/);
  const html = panel(c);
  assert.match(strip(html), /^תעודה TEST-GAP-1 לא מתאזנת · ההפרש בעמוד 1 /);
  assert.equal((html.match(/<article data-price-row=/g) || []).length, 0, 'no card per row: every row only waits for the note to balance');
  assert.match(strip(html), /עוד 9 שורות ייבדקו אחרי שהתעודה תתאזן\. אין בהן מה לעשות עכשיו\./);
  const card = strip(gapCard(html));
  assert.ok(card.startsWith('תעודה TEST-GAP-1: חסרים ₪56.40 מול הסיכום המודפס בסיכום המודפס ₪443.72 ו-92 יחידות. השורות שנקראו: ₪387.32 ו-92 יחידות. ' +
    'כל 7 השורות ו-92 היחידות נקראו, אז לא חסר עמוד. כנראה מספר באחת השורות נקרא לא נכון. ההפרש בעמוד 1: קריאה אחרת של העמוד מסתכמת ל-₪363.72 במקום ₪307.32. ' +
    'בדוק מול הנייר את השורות האלה: כמה קריאות מאזנות את העמוד, כל אחת בשורות אחרות. רק הנייר מכריע ביניהן'), card);
  assert.match(card, /לאבנה בדיקה עמוד 1 מתוך 2 · שורה מודפסת 2 מחיר ליחידה במאגר: ₪9\.10 נקרא: 24 × ₪2\.89 = ₪69\.36 קריאה אחרת ראתה: 12 × ₪9\.10 = ₪109\.20 בנייר כתוב 12 × ₪9\.10 = ₪109\.20 בנייר כתוב משהו אחר/);
  assert.match(card, /סלט בדיקה עמוד 1 מתוך 2 · שורה מודפסת 4 מחיר ליחידה במאגר: ₪7\.80 נקרא: 12 × ₪4\.40 = ₪52\.80 קריאה אחרת ראתה: 12 × ₪7\.80 · אחרי הנחה ₪79\.56/);
  assert.deepEqual(gapRows(html), [0, 1, 2, 3]);
  assert.doesNotMatch(gapCard(html), /מעדן בדיקה וניל/, 'line 5: every read saw the same');
  // The scanner's prompt says the same thing, not "N rows to handle".
  c.run("scanPurpose = 'receiving'; refreshPriceScannerNotice();");
  assert.equal(c.node('scanPriceNotice').classList.contains('hidden'), false);
  assert.equal(c.node('scanPriceNotice').textContent, 'התעודה לא מתאזנת — פתח את הרשימה');
  // Nothing was changed: the OCR values are the selected read's.
  assert.deepEqual(json(c, 'aiScanResponse.scan.documents[0].rows.map(r => r.lineTotalExVat)'), READS1[2].map(v => v.lineTotalExVat));
});

test('the worker takes the suggestions for lines 2–4: each opens the correction prefilled, each save re-checks, and the third releases the receipt', () => {
  const c = open();
  c.run("scanPurpose = 'receiving'; refreshPriceScannerNotice();");
  let step = takeSuggestion(c, 1);
  assert.deepEqual(step.values, ['12', '9.1', '109.2']);
  assert.match(step.modal, /data-paper-row-prefill[^>]*>המספרים מולאו לפי קריאה אחרת של השורה\. השווה אותם לנייר לפני האישור\.</);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.equal(c.toasts.at(-1), 'השורה תוקנה. התעודה עוד לא מתאזנת — המשך לשורות שנשארו בכרטיס.');
  // The labneh line went from 24 to 12 units: until the slide is undone the units are short too.
  assert.match(banner(c), /^תעודה TEST-GAP-1: חסרים ₪16\.56 וחסרות 12 יחידות מול הסיכום המודפס כל השורות נקראו, אז לא חסר עמוד\./);
  assert.deepEqual(gapRows(panel(c)), [0, 2, 3], 'the corrected line is not offered again');
  step = takeSuggestion(c, 2);
  assert.deepEqual(step.values, ['24', '2.89', '69.36']);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  step = takeSuggestion(c, 3);
  assert.deepEqual(step.values, ['12', '7.8', '79.56']);
  assert.equal(c.toasts.at(-1), 'השורה תוקנה והתעודה מתאזנת מול הסיכום המודפס ✓');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: SUBTOTAL1, units: UNITS1 }, { amount: SUBTOTAL2, units: UNITS2 }], 'the printed anchors of both notes');
  assert.match(banner(c), /התעודה נקראה ואומתה/);
  assert.equal(json(c, 'yotvataPaperGaps()').length, 0);
  assert.doesNotMatch(panel(c), /data-paper-gap|לא מתאזנת/);
  const notice = c.node('scanPriceNotice');
  assert.ok(notice.classList.contains('hidden') || !/לא מתאזנת/.test(notice.textContent), 'the scanner prompt follows: ' + notice.textContent);
  assert.deepEqual(json(c, 'aiScanResponse.scan.documents[0].rows.slice(0, 5).map(r => [r.quantity, r.unitPriceExVat, r.lineTotalExVat])'),
    [0, 1, 2, 3, 4].map(i => [TRUE[i].quantity, TRUE[i].unitPriceExVat, TRUE[i].lineTotalExVat]));
  assert.equal(c.run('aiEvaluateInvoiceScan(aiScanResponse).valid'), true);
  // The receipt goes on to the comparison, and a reload keeps it released.
  c.run("showConfirm = (title, text, label, fn) => fn(); finishReceipt();");
  assert.equal(c.run('rcStep'), 'ai');
  const reloaded = open(null, c.storage);
  assert.equal(reloaded.run('receiptPaperScanState'), 'ok');
  assert.equal(reloaded.requests.length + c.requests.length, 0, 'no paid read');
});

test('a note that already balances but stayed blocked (corrected under v398) is released by "המשך" or by the finish itself', () => {
  for (const release of ['button', 'finish']) {
    const c = open();
    // The v398 situation: the three lines corrected, the state left 'failed'.
    for (const row of [1, 2, 3]) takeSuggestion(c, row);
    c.run("receiptPaperScanState = 'failed'; receiptPaperScanProblems = ['תעודה 1: סכום שורות הנטו אינו תואם בדיוק לסיכום המודפס']; renderReceiving();");
    assert.equal(banner(c), 'כל התעודות מתאזנות עכשיו מול הסיכום המודפס. המשך');
    if (release === 'button') { c.click('rc-paper-recheck', ''); assert.equal(c.toasts.at(-1), 'התעודה מתאזנת מול הסיכום המודפס ✓'); }
    else c.run("showConfirm = (title, text, label, fn) => fn(); finishReceipt();");
    assert.equal(c.run('receiptPaperScanState'), 'ok', release);
    if (release === 'finish') assert.equal(c.run('rcStep'), 'ai');
  }
});

test('a suggestion that balances the paper on the wrong line is the worker\'s call: the card warned, and the price check then shows the gap on that line', () => {
  const c = open();
  // Line 1's suggestion comes from the read that put the labneh's numbers on line 1. It closes the gap alone.
  takeSuggestion(c, 0);
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'the paper alone cannot tell the two readings apart');
  const pending = json(c, 'priceAuditPendingRows(receiptPriceAudit()).map(r => [r.rowIndex, r.result, r.capability])');
  assert.ok(pending.some(([row, result]) => row === 0 && result === 'difference'), JSON.stringify(pending));
  assert.match(strip(panel(c)), /המחיר בתעודה שונה מהמחיר שבמאגר מעדן בדיקה תות/);
});

test('other paper problems keep the existing message: a row count that does not match is not this card', () => {
  const c = open(fieldDraft({ printedLines1: 8 }));
  assert.equal(c.run('yotvataPaperGaps()'), null);
  assert.match(banner(c), /^אפשר להמשיך בספירה\. לפני הסיום צריך להשלים את נתוני התעודה\./);
  assert.doesNotMatch(panel(c), /data-paper-gap/);
});

test('the correction window without a suggestion is the manual one, as before', () => {
  const c = open();
  c.click('paper-row-edit', '', { doc: '0', row: '1' });
  const modal = c.node('new-div').innerHTML;
  assert.doesNotMatch(modal, /data-paper-row-prefill/);
  assert.match(modal, /id="paperRowQty"[^>]*value="24"/, 'the values read, as before');
});
