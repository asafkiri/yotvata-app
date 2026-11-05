// v403 — בדיקה שורה-שורה בטלפון, לכל תעודה בנפרד; "התעודה הזאת לא שלנו"; פירוט הקליטה לפי תעודה — לפי מה שסומן.
// כמו בברמן (גרסה 154 שם) ובתנובה (151): שתי תעודות שצולמו לאותה קליטה, ומוצר אחד (חלב) שמופיע בשתיהן — 12 בראשונה
// ו-5 בשנייה, לא 17 בשורה אחת. הנתונים מומצאים, באותו מבנה שמחזיר שירות הסריקה (ברקוד מלא לכל שורה, סיכום וסך יחידות).
// מה שנבדק:
// 1. הכפתור החדש בשני המסכים של הבדיקה הידנית; שני הכפתורים הקיימים — באותם טקסטים ובאותו סדר.
// 2. השורות של כל תעודה בנפרד, בלי "סמן הכל"; "סיום" רק כשכל השורות סומנו.
// 3. "סיום" = בדיוק "יש חוסרים או עודפים" עם אותם הבדלים: אותה ספירה, אותו סיכום, ורק תוספת של מה שסומן בכל תעודה.
// 4. "התעודה הזאת לא שלנו": התעודה יוצאת מהקליטה (קריאה, עוגנים), מה שסומן נשאר; כשל — כלום לא משתנה; תעודה אחת — אין כפתור.
// 5. הבדיקה נשמרת בטיוטה וממשיכה מאותו מקום; החלון חוזר בדיוק לבדיקה הקיימת; "הגיע משהו נוסף".
// 6. "פירוט לפי תעודת ספק" בהיסטוריה: מה שסומן בכל תעודה במקום ההקצאה לפי הסדר; בלעדיו — כמו קודם.
// 7. טלפון בגרסה 402 שממשיך את הקליטה רואה את הבדיקה הרגילה עם מה שכבר סומן.
// 10. (407) חיפוש של מוצר שכבר בבדיקה: "כבר ברשימה" / "כבר בתעודה, שורה N" עם "הצג" — לא "לא נמצא מוצר כזה".
// הרצה: node --test tools/line-check.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7 },
  { id: 'yogurt', name: 'יוגורט טבעי 150 גרם', code: '22', barcode: '7290000000022', price: 3 },
  { id: 'cream', name: 'שמנת חמוצה 15% 200 מ״ל', code: '39', barcode: '7290000000039', price: 2 },
  { id: 'pudding', name: 'מעדן שוקולד 125 גרם', code: '46', barcode: '7290000000046', price: 4 },
  { id: 'butter', name: 'חמאה 100 גרם', code: '53', barcode: '7290000000053', price: 6 }
];
const r2 = n => Math.round(n * 100) / 100;
// תעודה של שירות הסריקה: ברקוד מלא לכל שורה, סיכום וסך יחידות שנסגרים בדיוק
function paper(spec, number) {
  const rows = spec.map(([id, q], i) => { const p = products.find(x => x.id === id);
    return { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: p.price, grossLineTotalExVat: r2(q * p.price), lineTotalExVat: r2(q * p.price), lineDiscountExVat: 0, confidence: .99 }; });
  const gross = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-02', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: gross, netToChargeExVat: gross, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: gross, promoDiscountExVat: 0, documentDiscountExVat: 0, warnings: [] };
}
const BIG = paper([['milk', 12], ['cottage', 6], ['yogurt', 4]], '4471001'), SMALL = paper([['milk', 5], ['cream', 2]], '4471002');
const BIG_AMOUNT = BIG.subtotalExVat, SMALL_AMOUNT = SMALL.subtotalExVat; // 114, 29
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// שתי התעודות צולמו ונקראו (קריאה אחת לכל תעודה), והכמויות נבדקות ידנית — כמו "פענח תעודה — הכמויות נבדקות ידנית"
async function scan(papers, opts = {}) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודות נקראו ואומתו: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  return c;
}
const twoPapers = opts => scan([BIG, SMALL], opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
// כל השורות "הגיע" — חוץ ממה שכבר סומן
function markRestOk(r) {
  review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!l.mark) click(r, { lineMark: di + ':' + li + ':ok' }); }));
}
// מהבדיקה ועד הסיכום, כמו בטלפון: מסך ההשוואה (אם נשאר) → "קלוט" → הסיכום
function closeNormal(r) {
  if (!r.run('!!pendingReceipt')) r.click('ai-apply');
  assert.ok(r.run('!!pendingReceipt'), json(r, 'aiScanEvaluation && aiScanEvaluation.errors')?.join(';'));
}
// ואז השמירה עצמה — התעודה כפי שנכתבה לענן
async function save(r) {
  closeNormal(r);
  await r.run('confirmReceipt()');
  const w = r.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
  assert.ok(w, 'התעודה נשמרה');
  return { id: w.path[w.path.length - 1], ...w.data };
}
const financialFields = ['lines', 'ex', 'calculatedEx', 'receivedEx', 'roundingAdjustment', 'grossEx', 'supplierDiscount', 'supplierPromoItems', 'supplierPromoMismatchItems', 'supplierCreditClaim', 'noteTotal', 'status', 'noteParts', 'unresolvedAmountGap', 'unresolvedUnitsGap'];
function finance(r) { const p = JSON.parse(JSON.stringify(json(r, 'pendingReceipt'), (k, v) => k === 'recordedAt' || k === 'operationId' ? undefined : v)); return Object.fromEntries(financialFields.filter(k => k in p).map(k => [k, p[k]])); }
const items = rc => rc.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const state = r => json(r, `({ docs: aiScanDocuments.map(d => [d.noteIndex, d.amount, d.units, !!d.cachedResult]), nums: aiScanResponse.scan.documents.map(d => [d.noteIndex, d.docNumber]),
  per: (aiScanResponse.perDocument || []).map(p => [p.docIndex, p.ok]), notes: receiptNotes.map(n => normNote(n).amount), st: receiptPaperScanState, problems: receiptPaperScanProblems, source: receiptAnchorSource, list: receiptList })`);

test('1. הכפתור החדש בשני המסכים של הבדיקה הידנית — והכפתורים הקיימים כמו שהיו', async () => {
  const r = await twoPapers();
  assert.equal(r.run('receiptCountingMode'), 'manual');
  const manual = r.run('receiptQuantityButtonsHtml()');
  assert.deepEqual([...manual.matchAll(/data-role="(rc-quantity-[a-z]+)"/g)].map(m => m[1]), ['rc-quantity-lines', 'rc-quantity-all', 'rc-quantity-differences'], 'החדש ראשון, ואחריו שני הקיימים');
  assert.match(strip(manual), /^בדוק שורה-שורה בטלפון בדקתי ידנית — כל הכמויות תואמות, המשך לקליטה בדקתי ידנית — יש חוסרים או עודפים$/);
  // בקליטה בסריקה — בתוך "בדקת ידנית את הכמויות מול התעודה?"
  r.run(`receiptCountingMode = 'scan'`);
  const folded = r.run('receiptQuantityButtonsHtml()');
  assert.match(folded, /<details data-quantity-picker/);
  assert.deepEqual([...folded.matchAll(/data-role="(rc-quantity-[a-z]+)"/g)].map(m => m[1]), ['rc-quantity-toggle', 'rc-quantity-lines', 'rc-quantity-all', 'rc-quantity-differences']);
  assert.match(strip(folded), /בדקת ידנית את הכמויות מול התעודה\? בדוק שורה-שורה בטלפון כל הכמויות תואמות יש חוסרים או עודפים$/);
  // הלחיצה במסך — פותחת את הבדיקה
  r.click('rc-quantity-lines');
  assert.equal(review(r).mode, 'lines'); assert.equal(r.run('receiptCountingMode'), 'manual');
  assert.equal(r.run(`$('receiptQuantityModal').classList.contains('hidden')`), false, 'החלון פתוח');
});

test('2. השורות של כל תעודה בנפרד; בלי "סמן הכל"; "סיום" רק כשכל השורות סומנו', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  const rv = review(r);
  assert.equal(rv.mode, 'lines');
  assert.deepEqual(rv.docs.map(d => [d.doc, d.number, d.amount, d.lines.map(l => l.productId + '×' + l.paperQty).join(' ')]), [
    [0, '4471001', BIG_AMOUNT, 'milk×12 cottage×6 yogurt×4'],
    [1, '4471002', SMALL_AMOUNT, 'milk×5 cream×2']], 'חלב: 12 בתעודה הראשונה ו-5 בשנייה — לא 17 בשורה אחת');
  assert.equal(r.run(`$('receiptQuantityTitle').textContent`), 'בדיקה שורה-שורה');
  assert.equal(r.run(`$('receiptQuantitySearch').classList.contains('hidden')`), true);
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'סומנו 0 מתוך 5 שורות');
  assert.equal(r.run(`$('receiptQuantityConfirm').textContent`), 'סיום (נשארו 5)');
  assert.match(r.run(`$('receiptQuantityConfirm').className`), /bg-slate-400/, 'אפור, לא מושבת');
  const html = r.run(`$('receiptQuantityRows').innerHTML`);
  assert.match(strip(html), /^תעודה 1 מתוך 2 תעודת ספק 4471001 · ₪114\.00 · 3 שורות · 22 יח׳ התעודה הזאת לא שלנו/);
  assert.match(strip(html), /תעודה נפרדת תעודה 2 מתוך 2 תעודת ספק 4471002 · ₪29\.00 · 2 שורות · 7 יח׳ התעודה הזאת לא שלנו/);
  assert.equal((html.match(/data-line-mark="\d+:\d+:ok"/g) || []).length, 5, 'שלוש בחירות לכל אחת מ-5 השורות');
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 0, 'אף שורה לא מסומנת מראש');
  assert.doesNotMatch(strip(html), /סמן הכל|הכל הגיע/);
  assert.match(strip(html), /הגיע משהו נוסף\?/);
  // "סיום" לפני שהכל סומן — לא נשמר כלום, ואומר מה נשאר (בחלון עצמו)
  click(r, { lineMark: '0:0:ok' });
  assert.equal(r.run('finishReceiptLineCheck()'), false);
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'נשארו 4 שורות בלי סימון — סמן בכל שורה: הגיע, כמות אחרת או לא הגיע');
  assert.equal(r.run(`$('lineCheck_0_1').classList.contains('ring-4')`), true, 'השורה הראשונה שנשארה — מסומנת');
  assert.equal(r.run('receiptList.length'), 0, 'הספירה לא השתנתה'); assert.equal(review(r).confirmedAt, null);
  // כמות אחרת בלי מספר — עדיין לא סומנה; עם מספר — כן
  click(r, { lineMark: '0:1:qty' });
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'סומנו 1 מתוך 5 שורות');
  type(r, { lineGot: '0:1' }, '4');
  assert.equal(r.run(`$('lineCheckSum_0_1').textContent`), 'התקבלו 4 · חוסר 2');
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'סומנו 2 מתוך 5 שורות · חוסר 2 יח׳', 'v405: המונה אומר גם מה סומן');
  type(r, { lineGot: '0:1' }, 'x'); assert.equal(r.run(`receiptLineGot(receiptQuantityReview.docs[0].lines[1])`), null, 'לא מספר — לא סומנה');
  type(r, { lineGot: '0:1' }, '6'); assert.equal(r.run(`$('lineCheckSum_0_1').textContent`), 'כמו בתעודה');
  type(r, { lineGot: '0:1' }, '8'); assert.equal(r.run(`$('lineCheckSum_0_1').textContent`), 'התקבלו 8 · עודף 2');
  // תעודה אחת — בלי "תעודה נפרדת" ובלי "לא שלנו"
  const one = await scan([BIG]);
  one.run('startReceiptLineCheck()');
  assert.equal(review(one).docs.length, 1);
  const single = one.run(`$('receiptQuantityRows').innerHTML`);
  assert.doesNotMatch(single, /data-line-drop=|לא שלנו|תעודה נפרדת|מתוך/);
  assert.match(strip(single), /^התעודה תעודת ספק 4471001 · ₪114\.00 · 3 שורות · 22 יח׳/);
  assert.equal(one.run('receivingDropScanDoc(0)'), null, 'התעודה היחידה — לא יוצאת (מבטלים את הקליטה)');
});

test('3. "סיום" עובר בדיוק כמו "יש חוסרים או עודפים": אותה ספירה, אותו סיכום, ועוד מה שסומן בכל תעודה', async () => {
  // חלב: מהתעודה הראשונה הגיעו 10 מתוך 12; מהשנייה לא הגיע כלום
  const a = await twoPapers();
  a.run('startReceiptLineCheck()');
  click(a, { lineMark: '0:0:qty' }); type(a, { lineGot: '0:0' }, '10'); click(a, { lineMark: '1:0:none' }); markRestOk(a);
  assert.equal(a.run(`$('receiptQuantityConfirm').textContent`), 'סיום — שמור את הבדיקה');
  assert.equal(a.run(`$('receiptQuantityProgress').textContent`), 'כל 5 שורות סומנו — אפשר לסיים · חוסר 7 יח׳');
  assert.equal(a.run('finishReceiptLineCheck()'), true);
  assert.equal(a.run(`$('receiptQuantityModal').classList.contains('hidden')`), true, 'החלון נסגר');
  const listA = json(a, 'receiptList');
  assert.deepEqual(listA.map(l => l.productId + ' ' + l.qty).sort(), ['cottage 6', 'cream 2', 'milk 10', 'yogurt 4']);
  closeNormal(a);
  // אותם הבדלים ב"יש חוסרים או עודפים" (הדרך הקיימת)
  const b = await twoPapers();
  b.run('startReceiptQuantityReview(false)');
  assert.equal(b.run(`$('receiptQuantityTitle').textContent`), 'חוסרים ועודפים');
  b.run(`const row = receiptQuantityReview.rows.find(x => x.productId === 'milk'); row.kind = 'shortage'; row.difference = '7';`);
  assert.equal(b.run('commitReceiptQuantityReview()'), true);
  assert.deepEqual(json(b, 'receiptList'), listA, 'אותה ספירה');
  closeNormal(b);
  assert.deepEqual(finance(a), finance(b), 'אותו סיכום');
  const qa = json(a, 'receiptQuantityCheckAudit()'), qb = json(b, 'receiptQuantityCheckAudit()');
  assert.deepEqual(qa.differences, qb.differences);
  assert.equal(qa.method, 'manual'); assert.equal(qb.byLine, undefined, 'הדרך הקיימת — בלי תוספת');
  assert.equal(qa.byLine, true);
  assert.deepEqual(qa.papers, [
    { number: '4471001', amount: BIG_AMOUNT, lines: [{ productId: 'milk', paperQty: 12, got: 10 }, { productId: 'cottage', paperQty: 6, got: 6 }, { productId: 'yogurt', paperQty: 4, got: 4 }] },
    { number: '4471002', amount: SMALL_AMOUNT, lines: [{ productId: 'milk', paperQty: 5, got: 0 }, { productId: 'cream', paperQty: 2, got: 2 }] }]);
  assert.ok(!JSON.stringify(qa).includes('[['), 'בלי מערך בתוך מערך (Firestore)');
  // ובתעודה שנשמרה — אותן שורות
  const savedA = await save(a), savedB = await save(b);
  assert.deepEqual(items(savedA), items(savedB));
  assert.deepEqual(items(savedA).find(x => x[0] === 'milk'), ['milk', 10, 17]);
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedA[k], savedB[k], k);
  assert.equal(savedA.quantityCheck.byLine, true); assert.equal(savedB.quantityCheck.byLine, undefined);
});

test('4. "התעודה הזאת לא שלנו": התעודה יוצאת מהקליטה, העוגנים מהתעודה שנשארה, ומה שסומן נשאר', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' }); click(r, { lineMark: '0:1:qty' }); type(r, { lineGot: '0:1' }, '5'); click(r, { lineMark: '1:1:ok' });
  // שאלה בתוך החלון (חלון האישור הרגיל נפתח מתחת לבדיקה)
  click(r, { lineDrop: '1' });
  assert.match(strip(r.run(`$('receiptQuantityRows').innerHTML`)), /להוציא את תעודת ספק 4471002 מהקליטה\? השורות שלה לא ייספרו, והצילום והקריאה שלה נמחקים מהטלפון — כמו "הסר תעודה" במסך הצילום\. אם זו התעודה שלך, לחץ "ביטול"\. הוצא מהקליטה ביטול/);
  assert.equal(r.run('testConfirms.length'), 0);
  click(r, { lineDropNo: '1' });
  assert.doesNotMatch(r.run(`$('receiptQuantityRows').innerHTML`), /להוציא את/, '"ביטול" — כלום לא השתנה');
  assert.deepEqual(state(r).nums, [[0, '4471001'], [1, '4471002']]);
  click(r, { lineDrop: '1' }); click(r, { lineDropYes: '1' });
  const s = state(r);
  assert.deepEqual(s.nums, [[0, '4471001']], 'רק התעודה שלנו בקליטה');
  assert.deepEqual(s.notes, [BIG_AMOUNT], 'העוגנים — מהתעודה שנשארה');
  assert.deepEqual(s.per, [[0, true]]);
  assert.deepEqual(s.docs, [[0, BIG_AMOUNT, 22, true]]);
  assert.equal(s.st, 'ok'); assert.deepEqual(s.problems, []); assert.equal(s.source, 'paper');
  assert.equal(r.run('receiptCountingMode'), 'manual');
  assert.deepEqual(marks(r), ['ok,qty:5,'], 'מה שסומן בתעודה שנשארה — נשאר');
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'תעודת ספק 4471002 יצאה מהקליטה, והצילום שלה נמחק מהטלפון');
  assert.doesNotMatch(r.run(`$('receiptQuantityRows').innerHTML`), /data-line-drop=/, 'תעודה אחת — בלי "לא שלנו"');
  assert.equal(r.run('receiptQuantityPaperRows().length'), 3);
  // הטיוטה — עם תעודה אחת (גם אחרי פתיחה מחדש)
  const draft = JSON.parse(r.storage.get('yt_receipt_draft'));
  assert.deepEqual(draft.aiScan.scan.documents.map(d => d.noteIndex), [0]); assert.equal(draft.photoInputs.length, 1); assert.equal(draft.quantityReview.mode, 'lines');
  // ומשם — רגיל: סיום ושמירה, עם תעודה אחת
  markRestOk(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty)'), ['milk 12', 'cottage 5', 'yogurt 4']);
  const saved = await save(r);
  assert.deepEqual(saved.noteParts.map(n => n.amount), [BIG_AMOUNT]);
  assert.equal(saved.count, 3);
  assert.deepEqual(items(saved).find(x => x[0] === 'cottage'), ['cottage', 5, 6], 'מה שסומן לפני שהתעודה יצאה — נשמר');
  r.context.packed = saved.paperScan;
  const scan = JSON.parse(JSON.stringify(await r.run('unpackReceiptValue(packed)')));
  assert.deepEqual(scan.scan.documents.map(d => d.docNumber), ['4471001']);
  assert.deepEqual(scan.perDocument.map(p => p.docIndex), [0]);
});

test('4ב. "לא שלנו" שנכשל — הקליטה בדיוק כמו שהייתה', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' });
  const before = state(r), draftBefore = r.storage.get('yt_receipt_draft');
  // התעודה שנשארת לא עוברת את בדיקת הנייר — העוגנים לא נקראים ממנה
  r.run(`const realCheck = yotvataPaperCheck; yotvataPaperCheck = (doc, pages) => ({ ...realCheck(doc, pages), ok: false, problems: ['boom'] });`);
  assert.equal(r.run('receivingDropScanDoc(1)'), null);
  assert.deepEqual(state(r), before, 'בלי שינוי');
  assert.equal(r.storage.get('yt_receipt_draft'), draftBefore, 'הטיוטה — כמו שהייתה');
  assert.deepEqual(marks(r), ['ok,,', ',']);
  // דרך החלון — הודעה בראש החלון, והבדיקה נשארת
  click(r, { lineDrop: '1' }); click(r, { lineDropYes: '1' });
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'לא הצלחתי להוציא את התעודה מהקליטה — נסה שוב');
  assert.deepEqual(state(r), before);
  assert.equal(review(r).docs.length, 2);
});

test('5. נשמר בטיוטה וממשיך מאותו מקום; החלון חוזר בדיוק לבדיקה הקיימת; "הגיע משהו נוסף"', async () => {
  const storage = new Map();
  const r = await twoPapers({ storage });
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' }); click(r, { lineMark: '1:0:none' });
  // פתיחה מחדש של האפליקציה באותו טלפון — הקריאה מהטיוטה, בלי סריקה
  const again = runtime('yotvata', { storage, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  again.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });`);
  assert.equal(again.run(`receiptQuantityReview && receiptQuantityReview.mode`), 'lines');
  assert.equal(again.run('receiptPaperScanState'), 'ok');
  again.run('startReceiptLineCheck()');
  assert.equal(again.run('testConfirms.length'), 0, 'בלי שאלה');
  assert.equal(again.requests.length, 0, 'בלי קריאה נוספת לשירות');
  assert.deepEqual(marks(again), ['ok,,', 'none,'], 'מה שסומן — נשאר');
  assert.equal(again.run(`$('receiptQuantityProgress').textContent`), 'סומנו 2 מתוך 5 שורות · חוסר 5 יח׳');
  // "חזרה" ו"יש חוסרים או עודפים" — החלון כמו שהיה תמיד
  again.run('closeReceiptQuantityReview(); startReceiptQuantityReview(false)');
  assert.equal(again.run(`$('receiptQuantityTitle').textContent`), 'חוסרים ועודפים');
  assert.equal(again.run(`$('receiptQuantityIntro').textContent`), 'סמן רק את ההפרשים שמצאת. בסיום תאשר ששאר הכמויות תואמות.');
  assert.equal(again.run(`$('receiptQuantitySearch').classList.contains('hidden')`), false);
  assert.equal(again.run(`$('receiptQuantityProgress').className`), 'hidden text-sm font-black text-slate-700 mt-2');
  assert.equal(again.run(`$('receiptQuantityConfirm').textContent`), 'אשר הפרשים — שאר הכמויות תואמות');
  assert.equal(again.run(`$('receiptQuantityConfirm').className`), 'btn-tap w-full bg-blue-600 text-white rounded-xl py-3 font-black text-base');
  assert.match(again.run(`$('receiptQuantityRows').innerHTML`), /data-quantity-kind=/, 'השורות של הבדיקה הקיימת');
  assert.equal(again.run('receiptQuantityReview.mode'), undefined);
  // "הגיע משהו נוסף": מה שנספר ואינו בתעודות נכנס לבד (אחרי שאלה), ומוצר נוסף מהחיפוש
  const x = await twoPapers();
  x.run(`receiptList = [{ productId: 'cottage', name: 'קוטג׳ 5% 250 גרם', barcode: '7290000000015', qty: 6 }, { productId: 'pudding', name: 'מעדן שוקולד 125 גרם', barcode: '7290000000046', qty: 2 }]; saveReceiptDraft();`);
  x.run('startReceiptLineCheck()');
  assert.match(json(x, 'testConfirms.map(c => c.message)').join(' '), /כבר נספרו 8 יח׳/);
  assert.equal(x.run('receiptQuantityReview'), null, 'לפני האישור — כלום');
  x.run('testConfirms[testConfirms.length - 1].cb()');
  assert.deepEqual(review(x).extras.map(e => [e.productId, e.got]), [['pudding', '2']], 'רק מה שאינו בתעודות');
  // 407: הכרטיס כמו שורת תעודה — "לא בתעודה", מחיר קופה, ברקוד ומחיר ליחידה, הכמות, הסיכום ו"הסר"
  assert.match(strip(x.run(`$('receiptQuantityRows').innerHTML`)), /הגיע משהו נוסף\? .* לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם אין מחיר קופה — בדוק בקופה ועדכן 7290000000046 · ₪4\.00 ליח׳ יח׳ הגיעו התקבלו 2 · עודף 2 הסר/);
  type(x, { lineSearch: '' }, 'חמאה');
  assert.match(x.run(`$('receiptLineSearchResults').innerHTML`), /data-extra-add="butter"/);
  click(x, { extraAdd: 'butter' }); type(x, { extraGot: '1' }, '3');
  markRestOk(x);
  assert.equal(x.run('finishReceiptLineCheck()'), true);
  const rows = json(x, 'receiptQuantityReview.rows.filter(r => r.paperQty === 0).map(r => [r.productId, r.kind, r.difference])');
  assert.deepEqual(rows, [['pudding', 'surplus', '2'], ['butter', 'surplus', '3']]);
  assert.deepEqual(json(x, 'receiptList.filter(l => ["pudding", "butter"].includes(l.productId)).map(l => l.productId + " " + l.qty)'), ['pudding 2', 'butter 3']);
});

test('6. "פירוט לפי תעודת ספק" בהיסטוריה: מה שסומן בכל תעודה במקום ההקצאה לפי הסדר — ובלעדיו, כמו קודם', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  // חלב: מהתעודה הראשונה לא הגיע כלום, מהשנייה הגיעו כל ה-5
  click(r, { lineMark: '0:0:none' }); markRestOk(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  const saved = await save(r);
  r.context.SAVED = saved;
  const split = json(r, 'receiptDocSplit(SAVED)');
  assert.deepEqual(split.map(d => [d.number, d.assumed, d.byLine, d.rows.map(x => x.name + ' ' + x.received + '/' + x.paperQty + (x.spans ? '*' : '')).join(' | ')]), [
    ['4471001', false, true, 'חלב 3% בקרטון 1 ליטר 0/12 | קוטג׳ 5% 250 גרם 6/6 | יוגורט טבעי 150 גרם 4/4'],
    ['4471002', false, true, 'חלב 3% בקרטון 1 ליטר 5/5 | שמנת חמוצה 15% 200 מ״ל 2/2']], 'מה שסומן בכל תעודה — בלי שיוך משוער');
  const html = strip(r.run('receiptDocSplitHtml(SAVED)'));
  assert.match(html, /תעודת ספק 4471001 .* 0 נספרו .* תעודת ספק 4471002 .* 5 נספרו/);
  assert.match(html, /הכמויות לפי הבדיקה שורה-שורה בטלפון/);
  assert.doesNotMatch(html, /שיוך משוער|\*/);
  // בלי מה שסומן (קליטה ישנה): ההקצאה לפי הסדר — תעודה 1 מתמלאת ראשונה, בניגוד למה שקרה באמת — ומסומנת "שיוך משוער"
  r.context.OLD = { ...saved, quantityCheck: { method: 'manual', confirmedAt: 1, differences: [] } };
  const old = json(r, 'receiptDocSplit(OLD)');
  assert.deepEqual(old.map(d => [d.assumed, d.byLine, d.rows[0].received]), [[true, undefined, 5], [true, undefined, 0]]);
  assert.match(strip(r.run('receiptDocSplitHtml(OLD)')), /שיוך משוער/);
  assert.doesNotMatch(strip(r.run('receiptDocSplitHtml(OLD)')), /הבדיקה שורה-שורה/);
  // מה שסומן אינו מתאים לספירה שנשמרה (תיקון אחרי השמירה) — ההנחה כמו קודם
  r.context.EDITED = { ...saved, items: saved.items.map(l => l.productId === 'milk' ? { ...l, qty: 6 } : l) };
  assert.deepEqual(json(r, 'receiptDocSplit(EDITED).map(d => [d.assumed, !!d.byLine])'), [[true, false], [true, false]]);
  // מה שסומן אינו מתאים לשורות הנייר (תעודה שונה) — ההנחה כמו קודם
  r.context.OTHER = { ...saved, quantityCheck: { ...saved.quantityCheck, papers: [saved.quantityCheck.papers[1], saved.quantityCheck.papers[0]] } };
  assert.deepEqual(json(r, 'receiptDocSplit(OTHER).map(d => !!d.byLine)'), [false, false]);
  // מה שהכרטיס מציג
  r.run(`receipts = [SAVED]; receiptHistoryFilter = 'all'; renderReceiptsHistory();`);
  const card = strip(r.run('app.innerHTML'));
  assert.match(card, /הכמויות נבדקו שורה-שורה/);
  assert.match(card, /פירוט לפי תעודת ספק .* הכמויות לפי הבדיקה שורה-שורה בטלפון/);
  r.run(`receipts = [OLD]; renderReceiptsHistory();`);
  assert.match(strip(r.run('app.innerHTML')), /הכמויות אושרו ידנית/);
});

test('7. טלפון בגרסה 402 שממשיך את הקליטה: השורות לכל מוצר (rows) מעודכנות עם כל סימון — שורה שלא סומנה נחשבת "הגיע"', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  const rows = () => json(r, 'receiptQuantityReview.rows.map(x => x.productId + " " + x.kind + " " + x.difference + "/" + x.paperQty).sort().join(" | ")');
  assert.equal(rows(), 'cottage match 0/6 | cream match 0/2 | milk match 0/17 | yogurt match 0/4', 'עוד לא סומן כלום — כמו "יש חוסרים או עודפים" בפתיחה');
  click(r, { lineMark: '1:0:none' }); click(r, { lineMark: '0:1:qty' }); type(r, { lineGot: '0:1' }, '4');
  assert.equal(rows(), 'cottage shortage 2/6 | cream match 0/2 | milk shortage 5/17 | yogurt match 0/4');
  // מה שטלפון ב-402 עושה עם הבדיקה הזו: החלון הרגיל, "אשר הפרשים — שאר הכמויות תואמות"
  assert.equal(r.run('commitReceiptQuantityReview()'), true);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 4', 'cream 2', 'milk 12', 'yogurt 4'], 'מה שסומן, והשאר — הגיע; לא רשימה ריקה');
});

test('8. מה שנספר אחרי שהבדיקה כבר התחילה — גם הוא ב"הגיע משהו נוסף"; מה שהוסף שם קודם — נשאר', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { extraAdd: 'butter' });
  // "חזרה" → סורקים מוצר שאינו בתעודות → שוב "בדוק שורה-שורה"
  r.run(`closeReceiptQuantityReview(); receiptList = [{ productId: 'pudding', name: 'מעדן שוקולד 125 גרם', barcode: '', qty: 2 }]; saveReceiptDraft(); startReceiptLineCheck();`);
  r.run('testConfirms[testConfirms.length - 1].cb()');
  assert.deepEqual(review(r).extras.map(e => [e.productId, e.got]), [['butter', '1'], ['pudding', '2']]);
  markRestOk(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(r, 'receiptList.filter(l => ["pudding", "butter"].includes(l.productId)).map(l => l.productId + " " + l.qty)'), ['butter 1', 'pudding 2']);
});

test('9. שורת פיקדון אינה שורה לסימון — כמו בהשוואה', async () => {
  // שמנת עם פיקדון ליחידה; בתעודה גם שורת "פיקדון" שלה (בכסף בלבד — לא בסך היחידות)
  const withDeposit = products.map(p => p.id === 'cream' ? { ...p, deposit: 1.2 } : p);
  const doc = paper([['cream', 2], ['milk', 3]], '4471003');
  const cream = products.find(p => p.id === 'cream');
  doc.rows.push({ section: 'items', code: cream.code, itemCode: cream.code, supplierItemCode: cream.code, description: 'פיקדון שמנת', barcode: cream.barcode, barcodeObserved: cream.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
    sourcePage: 1, lineNumber: 3, quantity: 2, unitPriceExVat: 1.2, grossLineTotalExVat: 2.4, lineTotalExVat: 2.4, lineDiscountExVat: 0, confidence: .99 });
  doc.itemsPrintedLines = 3; doc.printedLines = 3; doc.itemsSectionTotalExVat = r2(doc.itemsSectionTotalExVat + 2.4); doc.subtotalExVat = doc.netToChargeExVat = doc.itemsSectionTotalExVat;
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products: withDeposit, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [doc] } } } });
  await cloud.tick();
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true; showConfirm = (t, m, l, cb) => cb();
    aiScanDocuments = [{ noteIndex: 0, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI0', orientationConfirmed: true }] }];`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  assert.deepEqual(json(c, 'receiptQuantityPaperRows().map(r => r.productId + "×" + r.paperQty)'), ['cream×2', 'milk×3']);
  c.run('startReceiptLineCheck()');
  assert.deepEqual(review(c).docs.map(d => d.lines.map(l => l.productId + '×' + l.paperQty).join(' ')), ['cream×2 milk×3'], 'שתי שורות סחורה, בלי הפיקדון');
  markRestOk(c);
  assert.equal(c.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(c, 'receiptList.map(l => l.productId + " " + l.qty)'), ['cream 2', 'milk 3']);
});

// 407, מהשטח (5.11.2026): "משקה פרו ויגן" 7290119390519 כבר היה ב"הגיע משהו נוסף" עם 8 יח׳, וסריקת הברקוד שלו לשדה
// החיפוש ענתה "לא נמצא מוצר כזה" — כי מי שכבר בבדיקה מסונן מהתוצאות, ורשימה ריקה הציגה את ההודעה של "אין מוצר כזה"
test('10. חיפוש של מוצר שכבר בבדיקה: "כבר ברשימה" / "כבר בתעודה, שורה N" עם "הצג" — לא "לא נמצא מוצר כזה"', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { extraAdd: 'butter' }); type(r, { extraGot: '0' }, '8');
  const results = () => r.run(`$('receiptLineSearchResults').innerHTML`);
  // הברקוד של מוצר שכבר ב"הגיע משהו נוסף" — איפה הוא וכמה, לא "לא נמצא מוצר כזה", ולא מוצע להוסיף שוב
  type(r, { lineSearch: '' }, '7290000000053');
  assert.doesNotMatch(results(), /לא נמצא מוצר כזה|data-extra-add=/);
  assert.equal(strip(results()), 'כבר ברשימה ״הגיע משהו נוסף״ חמאה 100 גרם 8 יח׳ · 7290000000053 · הצג');
  assert.match(results(), /data-line-show="lineExtra_0"/);
  // "הצג" — השורה מודגשת; החיפוש והבדיקה כמו שהיו
  click(r, { lineShow: 'lineExtra_0' });
  assert.equal(r.run(`$('lineExtra_0').classList.contains('ring-4')`), true);
  assert.equal(r.run('receiptLineSearchTerm'), '7290000000053');
  assert.deepEqual(review(r).extras.map(e => [e.productId, e.got]), [['butter', '8']]);
  assert.equal(r.run('receiptQuantityReview.rows.length'), 5);
  // בלי כמות ב"נוסף" — אומרים גם את זה
  type(r, { extraGot: '0' }, '');
  type(r, { lineSearch: '' }, 'חמאה');
  assert.equal(strip(results()), 'כבר ברשימה ״הגיע משהו נוסף״ חמאה 100 גרם עוד לא הוקלד כמה הגיע · 7290000000053 · הצג');
  // מוצר בשורת תעודה — חלב בשתי התעודות: שורה לכל תעודה, עם מספר השורה בנייר ומה שסומן בה
  click(r, { lineMark: '0:0:ok' });
  type(r, { lineSearch: '' }, 'חלב');
  assert.equal(strip(results()), 'כבר בתעודה 1 מתוך 2, שורה 1 חלב 3% בקרטון 1 ליטר 12 יח׳ בתעודה · סומנה: הגיע · 7290000000008 · הצג ' +
    'כבר בתעודה 2 מתוך 2, שורה 1 חלב 3% בקרטון 1 ליטר 5 יח׳ בתעודה · עוד לא סומנה · 7290000000008 · הצג');
  assert.match(results(), /data-line-show="lineCheck_0_0"[\s\S]*data-line-show="lineCheck_1_0"/);
  click(r, { lineShow: 'lineCheck_1_0' });
  assert.equal(r.run(`$('lineCheck_1_0').classList.contains('ring-4')`), true);
  assert.deepEqual(marks(r), ['ok,,', ','], 'שום דבר לא סומן בגלל "הצג"');
  // "לא הגיע" ו"אחרת" עם כמות
  click(r, { lineMark: '1:1:none' });
  type(r, { lineSearch: '' }, 'שמנת');
  assert.equal(strip(results()), 'כבר בתעודה 2 מתוך 2, שורה 2 שמנת חמוצה 15% 200 מ״ל 2 יח׳ בתעודה · סומנה: לא הגיע · 7290000000039 · הצג');
  click(r, { lineMark: '0:1:qty' }); type(r, { lineGot: '0:1' }, '4');
  type(r, { lineSearch: '' }, 'קוטג');
  assert.equal(strip(results()), 'כבר בתעודה 1 מתוך 2, שורה 2 קוטג׳ 5% 250 גרם 6 יח׳ בתעודה · סומנה: הגיעו 4 · 7290000000015 · הצג');
  // מונח שמתאים גם למוצר שכבר בבדיקה וגם למוצר שאפשר להוסיף: קודם איפה שכבר נמצא, ואחריו "+ להוספה" — עם הברקוד
  type(r, { lineSearch: '' }, '72900000000');
  const mixed = results();
  assert.match(mixed, /data-line-show="lineCheck_0_0"/); assert.match(mixed, /data-extra-add="pudding"/);
  assert.ok(mixed.indexOf('data-line-show=') < mixed.indexOf('data-extra-add='), 'קודם מה שכבר בבדיקה');
  assert.match(strip(mixed), /\+ מעדן שוקולד 125 גרם 7290000000046$/);
  // ההוספה עצמה — כמו קודם
  click(r, { extraAdd: 'pudding' });
  assert.deepEqual(review(r).extras.map(e => [e.productId, e.got]), [['butter', ''], ['pudding', '1']]);
  assert.equal(r.run('receiptLineSearchTerm'), '');
  // באמת אין מוצר כזה במאגר — כמו קודם
  type(r, { lineSearch: '' }, '7290119390519');
  assert.equal(strip(results()), 'לא נמצא מוצר כזה');
  // תעודה אחת — "כבר בתעודה, שורה 2", בלי "מתוך"
  const one = await scan([BIG]);
  one.run('startReceiptLineCheck()');
  type(one, { lineSearch: '' }, 'קוטג');
  assert.equal(strip(one.run(`$('receiptLineSearchResults').innerHTML`)), 'כבר בתעודה, שורה 2 קוטג׳ 5% 250 גרם 6 יח׳ בתעודה · עוד לא סומנה · 7290000000015 · הצג');
});

// 407, בעל העסק: "בשורה הצהובה לא רשום ברקוד, לא מחיר קופה, לא כלום — שורה בודדת מסכנה בצבע צהוב"
test('11. הכרטיס של "הגיע משהו נוסף" כמו שורת תעודה: מחיר קופה, ברקוד ומחיר ליחידה, הכמות גדולה, ארגזים, הסיכום ו"הסר"', async () => {
  const r = await twoPapers();
  r.run(`products.find(p => p.id === 'butter').posPrice = 9.9; products.find(p => p.id === 'butter').boxSize = 4;`);
  r.run('startReceiptLineCheck()');
  click(r, { extraAdd: 'butter' });
  const card = k => (r.run(`$('receiptQuantityRows').innerHTML`).match(new RegExp('<div id="lineExtra_' + k + '"[\\s\\S]*?הסר</button></div></div>')) || [''])[0];
  const a = card(0);
  assert.equal(strip(a), 'לא בתעודה — הגיע בנוסף חמאה 100 גרם בקופה: ₪9.90 7290000000053 · ₪6.00 ליח׳ יח׳ הגיעו התקבלו 1 · עודף 1 הסר');
  assert.match(a, /rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 mb-2\.5 shadow-sm/, 'כרטיס כמו שורת "אחרת"');
  assert.match(a, /data-extra-got="0"[^>]*value="1"[^>]*text-2xl/, 'שדה הכמות גדול, עם מה שהוקלד');
  assert.match(a, /fa-barcode/); assert.match(a, /data-extra-remove="0"/);
  const pos = r.run(`posPriceLineHtml(products.find(p => p.id === 'butter'))`);
  assert.match(pos, /fa-cash-register.*בקופה: ₪9\.90/);
  assert.ok(a.includes(pos), 'מחיר הקופה — אותה שורה כמו בשורת תעודה ובסריקה');
  // הקלדה: הסיכום והארגזים מתעדכנים במקום, בלי ציור מחדש; המונה למעלה כמו קודם
  type(r, { extraGot: '0' }, '8');
  assert.equal(r.run(`$('lineExtraSum_0').textContent`), 'התקבלו 8 · עודף 8');
  assert.equal(r.run(`$('lineExtraBox_0').textContent`), '2 ארגזים × 4');
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'סומנו 0 מתוך 5 שורות · עודף 8 יח׳');
  type(r, { extraGot: '0' }, '4');
  assert.equal(r.run(`$('lineExtraBox_0').textContent`), 'ארגז אחד של 4');
  type(r, { extraGot: '0' }, 'x');
  assert.equal(r.run(`$('lineExtraSum_0').textContent`), 'הקלד כמה יחידות הגיעו');
  assert.equal(r.run(`$('lineExtraBox_0').textContent`), '');
  assert.equal(r.run(`$('receiptQuantityProgress').textContent`), 'סומנו 0 מתוך 5 שורות', 'כמות לא תקינה — לא נספרת');
  type(r, { extraGot: '0' }, '4');
  // ציור מחדש — הכמות, הסיכום והארגזים בכרטיס
  r.run('renderReceiptLineRows()');
  assert.equal(strip(card(0)), 'לא בתעודה — הגיע בנוסף חמאה 100 גרם בקופה: ₪9.90 7290000000053 · ₪6.00 ליח׳ יח׳ הגיעו ארגז אחד של 4 התקבלו 4 · עודף 4 הסר');
  assert.match(card(0), /value="4"/);
  // בלי מחיר קופה ובלי ארגז — "אין מחיר קופה", כמו בשורת תעודה
  click(r, { extraAdd: 'pudding' });
  const b = card(1);
  assert.equal(strip(b), 'לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם אין מחיר קופה — בדוק בקופה ועדכן 7290000000046 · ₪4.00 ליח׳ יח׳ הגיעו התקבלו 1 · עודף 1 הסר');
  assert.match(b, /fa-triangle-exclamation/);
  // "הסר" ו"סיום" — כמו קודם
  click(r, { extraRemove: '1' });
  assert.deepEqual(review(r).extras.map(e => [e.productId, e.got]), [['butter', '4']]);
  assert.equal(card(1), '');
  markRestOk(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['butter 4', 'cottage 6', 'cream 2', 'milk 17', 'yogurt 4']);
});

test('הגרסה עלתה ל-407, כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '407'/);
  assert.match(html, /APP_VERSION_LABEL = 'v' \+ APP_VERSION \+ '_already_in_check'/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v407/);
});
