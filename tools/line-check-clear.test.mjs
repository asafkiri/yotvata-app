// v416 — הבדיקה שורה-שורה: "בטל סימון", ומה שהגיע ומחיר הקופה בכתב גדול ועבה יותר (כמו תנובה 162 וברמן 170). בעל העסק, 12.11.2026:
// 1) "הכתב שיהיה קצת יותר עבה וקצת יותר גדול, כדי שיהיה יותר קל לקרוא אותו (כמה הגיע ומה המחיר)."
// 2) "אם בטעות לחצתי 'הגיע' או 'לא הגיע' — שיהיה כפתור ביטול. קורה לי שאני לוחץ בטעות 'הגיע', ואז צריך ללחוץ 'לא הגיע' בינתיים
//    עד שאני אגיע למוצר, וזה סתם עושה לי בלאגן בראש."
// אותם נתונים מומצאים כמו ב-line-check-scan.test.mjs: תעודה של 3 שורות (חלב 12, קוטג׳ 6, יוגורט 4) ותעודה שנייה (חלב 5, שמנת 2).
// מה שנבדק:
// 1. השורה המקופלת: מה שהגיע ומחיר הקופה ב-15px ו-font-black (לא 12px bold), בשני חלקים שאינם נשברים באמצע, עם סמל הקופה
//    ביניהם; "לא הגיע" — אותו דבר באדום; מוצר בלי מחיר קופה — השדה להשלמה, כמו קודם; והסיכום של "אחרת".
// 2. "בטל סימון" מופיע רק בשורה פתוחה שכבר סומנה: לא בשורה שעוד לא נבדקה ולא בשורה מקופלת; אחרי "שנה" — כן; ב"אחרת" — כן.
// 3. הלחיצה: השורה חוזרת להיות "עוד לא נבדקה" — בלי סימון, לבנה ופתוחה, נספרת ב"נשארו", ו"סיום" מחכה לה; נשמר בטיוטה.
//    אחרי הביטול הבדיקה זהה בדיוק למה שהייתה לפני הסימון.
// 4. מוצר בשתי תעודות (קבוצה): הביטול מוחק את הסימון בכל שורותיו, ושורת ההפניה חוזרת להיות בלי סטטוס.
// 5. "אחרת" עם כמות, ועם שדה ריק — הביטול מנקה גם את מה שהוקלד; "הגיע" אחרי הביטול — כרגיל.
// 6. "סיום" אחרי ביטול מביא לשורה שבוטלה; אחרי שסומנה שוב — נשמר כמו בלי הביטול.
// 7. הכרטיס שמעל המצלמה — בלי שינוי (אין בו "בטל סימון"); אחרי ביטול, סריקה של המוצר היא סריקה ראשונה ("הגיע N").
// 8. הגרסה.
// הרצה: node --test tools/line-check-clear.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5, posPrice: 6.9 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7 },
  { id: 'yogurt', name: 'יוגורט טבעי 150 גרם', code: '22', barcode: '7290000000022', price: 3 },
  { id: 'cream', name: 'שמנת חמוצה 15% 200 מ״ל', code: '39', barcode: '7290000000039', price: 2 },
  { id: 'pudding', name: 'מעדן שוקולד 125 גרם', code: '46', barcode: '7290000000046', price: 4, posPrice: 5.5 },
  { id: 'butter', name: 'חמאה 100 גרם', code: '53', barcode: '7290000000053', price: 6 }
];
const r2 = n => Math.round(n * 100) / 100;
function paper(spec, number, catalog = products) {
  const rows = spec.map(([id, q], i) => { const p = catalog.find(x => x.id === id);
    return { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: p.price, grossLineTotalExVat: r2(q * p.price), lineTotalExVat: r2(q * p.price), lineDiscountExVat: 0, confidence: .99 }; });
  const gross = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-02', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: gross, netToChargeExVat: gross, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: gross, promoDiscountExVat: 0, documentDiscountExVat: 0, warnings: [] };
}
const BIG = paper([['milk', 12], ['cottage', 6], ['yogurt', 4]], '4471001'), SMALL = paper([['milk', 5], ['cream', 2]], '4471002');
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
// שתי התעודות צולמו ונקראו, הכמויות נבדקות ידנית — והמצלמה מזויפת: BarcodeDetector מובנה, זרם בלי מסלולים, וידאו שמתנגן
async function scan(papers, opts = {}, catalog = products) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products: catalog, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
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
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) };
    $('scanVideo').play = async () => {};
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודות נקראו ואומתו: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  return c;
}
const twoPapers = opts => scan([BIG, SMALL], opts);
const onePaper = opts => scan([BIG], opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const draftMarks = r => JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
const finish = r => r.run(`$('receiptQuantityConfirm').textContent`);
// ה-HTML של שורה אחת (lineCheck_di_li) מתוך הרשימה — עד השורה הבאה או סוף התעודה
function row(r, di, li) {
  const h = rows(r), i = h.indexOf('<div id="lineCheck_' + di + '_' + li + '"');
  assert.ok(i >= 0, 'שורה ' + di + ':' + li + ' קיימת');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i)].filter(x => x > 0);
  return h.slice(i, ends.length ? Math.min(...ends) : undefined);
}
const ref = (r, di, li) => strip(rows(r).match(new RegExp('<div id="lineCheckRef_' + di + '_' + li + '"[\\s\\S]*?<\\/button><\\/div>'))[0]);
const CLEAR = /<button type="button" data-line-clear="(\d+:\d+)" class="btn-tap min-h-\[44px\] w-full [^"]*"[^>]*>.*? בטל סימון<\/button>/;
const snapshot = r => json(r, '({ docs: receiptQuantityReview.docs, extras: receiptQuantityReview.extras, rows: receiptQuantityReview.rows, products: receiptQuantityReview.products })');

test('1. השורה המקופלת: מה שהגיע ומחיר הקופה גדולים ועבים יותר, בשני חלקים שאינם נשברים; "לא הגיע"; בלי מחיר קופה; "אחרת"', async () => {
  const r = await onePaper();
  r.run(`products.find(p => p.id === 'cottage').posPrice = 8.5`);
  r.run('startReceiptLineCheck()');
  // "אחרת" — הסיכום מתחת לשדה, באותו כתב
  click(r, { lineMark: '0:1:qty' }); type(r, { lineGot: '0:1' }, '4');
  click(r, { lineMark: '0:0:ok' }); // חלב — "הגיע" (והרשימה מצוירת מחדש)
  assert.match(row(r, 0, 1), /<div id="lineCheckSum_0_1" class="text-\[15px\] font-black mt-1 text-amber-800" aria-live="polite">התקבלו 4 · חוסר 2<\/div>/);
  const a = row(r, 0, 0);
  assert.equal(strip(a), 'חלב 3% בקרטון 1 ליטר הגיע · 12 יח׳ בקופה ₪6.90 שנה');
  // 15px ו-font-black (עד עכשיו: text-xs font-bold), ושני חלקים שלמים — מה שהגיע, ומחיר הקופה עם הסמל שלו
  assert.match(a, /<div class="flex flex-wrap items-baseline gap-x-2\.5 text-\[15px\] font-black leading-snug text-emerald-700">/);
  assert.match(a, /<span class="whitespace-nowrap"><i class="fa-solid fa-check" aria-hidden="true"><\/i> הגיע · 12 יח׳<\/span><span class="whitespace-nowrap"><i class="fa-solid fa-cash-register text-xs" aria-hidden="true"><\/i> בקופה ₪6\.90<\/span>/);
  assert.doesNotMatch(a, /text-xs font-bold/, 'לא הכתב הקטן של קודם');
  assert.match(a, /<div class="font-black text-slate-800 truncate">חלב 3% בקרטון 1 ליטר<\/div>/, 'השם — כמו קודם');
  assert.match(a, /<button type="button" data-line-open="0:0" class="btn-tap shrink-0 min-h-\[44px\] px-3 [^"]*"[^>]*>שנה<\/button>/, '"שנה" — כמו קודם, הכפתור היחיד בשורה המקופלת');
  // "לא הגיע" — אותו דבר, באדום
  click(r, { lineMark: '0:1:none' });
  const b = row(r, 0, 1);
  assert.equal(strip(b), 'קוטג׳ 5% 250 גרם לא הגיע · 0 מתוך 6 בקופה ₪8.50 שנה');
  assert.match(b, /text-\[15px\] font-black leading-snug text-rose-700">/);
  assert.match(b, /<span class="whitespace-nowrap"><i class="fa-solid fa-xmark" aria-hidden="true"><\/i> לא הגיע · 0 מתוך 6<\/span><span class="whitespace-nowrap"><i class="fa-solid fa-cash-register text-xs" aria-hidden="true"><\/i> בקופה ₪8\.50<\/span>/);
  // מוצר בלי מחיר קופה — מה שהגיע באותו כתב, ואחריו השדה להשלמת המחיר, בלי "בקופה ₪"
  click(r, { lineMark: '0:2:ok' });
  const d = row(r, 0, 2);
  assert.match(d, /text-\[15px\] font-black leading-snug text-emerald-700"><span class="whitespace-nowrap"><i class="fa-solid fa-check" aria-hidden="true"><\/i> הגיע · 4 יח׳<\/span><\/div>/);
  assert.match(d, /data-line-pos="yogurt"/); assert.doesNotMatch(strip(d), /בקופה ₪/);
});

test('2. "בטל סימון" מופיע רק בשורה פתוחה שכבר סומנה: לא לפני סימון ולא בשורה מקופלת; אחרי "שנה" וב"אחרת" — כן', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  assert.doesNotMatch(rows(r), /data-line-clear|בטל סימון/, 'לפני שסומן משהו — אין מה לבטל');
  click(r, { lineMark: '0:1:ok' }); click(r, { lineMark: '0:2:none' });
  assert.doesNotMatch(rows(r), /data-line-clear|בטל סימון/, 'בשורה מקופלת — רק "שנה"');
  // "שנה" — השורה נפתחת עם הסימון שלה, ומתחת לשלושת הכפתורים "בטל סימון"
  click(r, { lineOpen: '0:1' });
  const a = row(r, 0, 1);
  assert.match(a, /data-line-mark="0:1:ok" aria-pressed="true"/);
  assert.equal(a.match(CLEAR)[1], '0:1');
  assert.match(a, /aria-label="בטל סימון: קוטג׳ 5% 250 גרם"/);
  assert.match(a, /<i class="fa-solid fa-rotate-left" aria-hidden="true"><\/i> בטל סימון<\/button><\/div>$/, 'אחרי הכפתורים, בסוף הכרטיס');
  assert.match(strip(a), / 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע בטל סימון$/);
  assert.equal((rows(r).match(/data-line-clear=/g) || []).length, 1, 'רק בשורה שנפתחה');
  // גם "לא הגיע" שנפתחה
  click(r, { lineOpen: '0:2' });
  assert.equal(row(r, 0, 2).match(CLEAR)[1], '0:2');
  // "אחרת" — פתוחה תמיד, ולכן "בטל סימון" בה מיד, גם לפני שהוקלדה כמות
  click(r, { lineMark: '1:1:qty' });
  const c = row(r, 1, 1);
  assert.equal(c.match(CLEAR)[1], '1:1');
  assert.match(strip(c), / כמה הגיע\? הקלד כמה יחידות הגיעו בטל סימון$/);
  // שורה שעוד לא סומנה — בלי
  assert.doesNotMatch(row(r, 0, 0), /data-line-clear/);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 4 יח׳', 'פתיחה ו"אחרת" בלי כמות אינן סימון — "הגיע" ו"לא הגיע" (4 יח׳) בלבד');
});

test('3. הלחיצה: השורה חוזרת להיות "עוד לא נבדקה" — בלי סימון, לבנה ופתוחה, נספרת ב"נשארו"; הבדיקה זהה למה שהייתה לפני הסימון', async () => {
  const r = await onePaper();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:1:ok' });
  const before = snapshot(r), beforeRow = row(r, 0, 0);
  assert.equal(progress(r), 'סומנו 1 מתוך 3 שורות'); assert.equal(finish(r), 'סיום (נשארו 2)');
  // בטעות "הגיע" על החלב
  click(r, { lineMark: '0:0:ok' });
  assert.deepEqual(marks(r), ['ok,ok,']); assert.equal(progress(r), 'סומנו 2 מתוך 3 שורות'); assert.equal(finish(r), 'סיום (נשארו 1)');
  // "שנה" ← "בטל סימון"
  click(r, { lineOpen: '0:0' });
  assert.equal(r.run('receiptLineOpen.has("0:0")'), true);
  click(r, { lineClear: '0:0' });
  assert.deepEqual(marks(r), [',ok,'], 'בלי סימון — לא "לא הגיע" בינתיים');
  assert.equal(r.run('receiptLineOpen.has("0:0")'), false);
  const a = row(r, 0, 0);
  assert.equal(a, beforeRow, 'השורה בדיוק כמו לפני שנגעו בה');
  assert.match(a, /class="rounded-2xl border-2 p-3 mb-2\.5 shadow-sm border-slate-200 bg-white"/, 'לבנה ופתוחה');
  assert.equal((a.match(/aria-pressed="false"/g) || []).length, 3, 'שום כפתור לא דולק');
  assert.doesNotMatch(a, /data-line-clear/, 'אין יותר מה לבטל');
  assert.equal(progress(r), 'סומנו 1 מתוך 3 שורות'); assert.equal(finish(r), 'סיום (נשארו 2)');
  assert.match(r.run(`$('receiptQuantityConfirm').className`), /bg-slate-400/, '"סיום" אפור — מחכה לשורה');
  assert.deepEqual(snapshot(r), before, 'הבדיקה זהה בדיוק למה שהייתה לפני הסימון');
  assert.deepEqual(draftMarks(r), [',ok,'], 'נשמר בטיוטה');
  assert.equal(r.run('receiptQuantityReview.confirmedAt'), null);
  // שורה אחרת לא הושפעה
  assert.doesNotMatch(row(r, 0, 1), /data-line-mark=/, 'קוטג׳ — עדיין מקופל "הגיע"');
  // מפתח לא תקין — כלום
  click(r, { lineClear: '9:9' });
  assert.deepEqual(marks(r), [',ok,']);
  // "לא הגיע" בטעות — אותו דבר
  click(r, { lineMark: '0:2:none' }); click(r, { lineOpen: '0:2' }); click(r, { lineClear: '0:2' });
  assert.deepEqual(marks(r), [',ok,']); assert.deepEqual(snapshot(r), before);
});

test('4. מוצר בשתי תעודות: הביטול מוחק את הסימון בכל שורותיו, ושורת ההפניה בלי סטטוס', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  const before = snapshot(r);
  click(r, { lineMark: '0:0:ok' }); // חלב — 12 בתעודה הראשונה ו-5 בשנייה
  assert.deepEqual(marks(r), ['ok,,', 'ok,']);
  assert.match(ref(r, 1, 0), /נספר יחד עם תעודה 1, שורה 1 · ✓ הגיע הצג$/);
  click(r, { lineOpen: '0:0' });
  assert.equal(row(r, 0, 0).match(CLEAR)[1], '0:0');
  click(r, { lineClear: '0:0' });
  assert.deepEqual(marks(r), [',,', ','], 'שתי השורות של המוצר');
  assert.deepEqual(snapshot(r), before);
  assert.match(ref(r, 1, 0), /נספר יחד עם תעודה 1, שורה 1 הצג$/, 'ההפניה — בלי סטטוס');
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות');
  // "אחרת" 10 מתוך 17 (מתחלק 10 + 0) — הביטול מנקה את שתיהן
  click(r, { lineMark: '0:0:qty' }); type(r, { lineGot: '0:0' }, '10');
  assert.deepEqual(marks(r), ['qty:10,,', 'qty:0,']);
  click(r, { lineClear: '0:0' });
  assert.deepEqual(marks(r), [',,', ',']); assert.deepEqual(snapshot(r), before);
});

test('5. "אחרת": הביטול מנקה גם את מה שהוקלד; "הגיע" אחרי הביטול — כרגיל', async () => {
  const r = await onePaper();
  r.run('startReceiptLineCheck()');
  const before = snapshot(r);
  click(r, { lineMark: '0:2:qty' }); type(r, { lineGot: '0:2' }, '3');
  assert.deepEqual(marks(r), [',,qty:3']); assert.equal(progress(r), 'סומנו 1 מתוך 3 שורות · חוסר 1 יח׳');
  click(r, { lineClear: '0:2' });
  assert.deepEqual(marks(r), [',,']); assert.equal(progress(r), 'סומנו 0 מתוך 3 שורות', 'גם החוסר ירד מהמונה');
  assert.doesNotMatch(row(r, 0, 2), /data-line-got|data-line-clear/, 'בלי שדה הכמות');
  assert.deepEqual(snapshot(r), before);
  // שדה ריק (לחצו "אחרת" ולא הקלידו), ואותיות
  click(r, { lineMark: '0:2:qty' }); click(r, { lineClear: '0:2' });
  assert.deepEqual(marks(r), [',,']);
  click(r, { lineMark: '0:2:qty' }); type(r, { lineGot: '0:2' }, 'אב'); click(r, { lineClear: '0:2' });
  assert.deepEqual(marks(r), [',,']); assert.deepEqual(snapshot(r), before);
  // אחרי הביטול — "אחרת" נפתחת עם שדה ריק (לא עם מה שהוקלד קודם), ו"הגיע" מקפל כרגיל
  click(r, { lineMark: '0:2:qty' });
  assert.match(row(r, 0, 2), /data-line-got="0:2"[^>]*value=""/);
  click(r, { lineMark: '0:2:ok' });
  assert.deepEqual(marks(r), [',,ok']); assert.doesNotMatch(row(r, 0, 2), /data-line-mark=/);
});

test('6. "סיום" אחרי ביטול מביא לשורה שבוטלה; אחרי שסומנה שוב — נשמר כמו בלי הביטול', async () => {
  const markAll = r => review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!l.mark) click(r, { lineMark: di + ':' + li + ':ok' }); }));
  const a = await onePaper();
  a.run('startReceiptLineCheck()');
  markAll(a);
  assert.equal(finish(a), 'סיום — שמור את הבדיקה');
  click(a, { lineOpen: '0:1' }); click(a, { lineClear: '0:1' });
  assert.equal(finish(a), 'סיום (נשארו 1)');
  assert.equal(a.run('finishReceiptLineCheck()'), false, 'אי אפשר לסיים עם שורה שבוטלה');
  assert.equal(progress(a), 'נשארה שורה אחת בלי סימון — סמן בכל שורה: הגיע, כמות אחרת או לא הגיע');
  assert.equal(a.run(`$('lineCheck_0_1').classList.contains('ring-4')`), true, 'השורה שבוטלה מודגשת');
  // סומנה שוב ("אחרת" 5 מתוך 6) — מול בדיקה שבה סומנה כך מההתחלה
  click(a, { lineMark: '0:1:qty' }); type(a, { lineGot: '0:1' }, '5');
  const b = await onePaper();
  b.run('startReceiptLineCheck()');
  click(b, { lineMark: '0:1:qty' }); type(b, { lineGot: '0:1' }, '5'); markAll(b);
  // בין שתי קליטות נפרדות משווים את הסימונים, השורות לכל מוצר וה"נוסף" (לכל קליטה מזהה סריקה משלה)
  const core = r => ({ marks: marks(r), rows: review(r).rows, extras: review(r).extras, products: review(r).products });
  assert.deepEqual(core(a), core(b), 'אותה בדיקה בדיוק');
  assert.equal(a.run('finishReceiptLineCheck()'), true); assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(a, 'receiptList'), json(b, 'receiptList'));
  assert.deepEqual(json(a, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 5', 'milk 12', 'yogurt 4']);
});

test('7. הכרטיס שמעל המצלמה — בלי "בטל סימון"; אחרי ביטול, סריקה של המוצר היא סריקה ראשונה', async () => {
  const r = await onePaper();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:1:ok' }); click(r, { lineOpen: '0:1' }); click(r, { lineClear: '0:1' });
  r.events.get('receiptLineScan:click')(); await settle();
  assert.equal(r.run('scanPurpose'), 'linecheck');
  r.run(`onScanned('7290000000015')`); // קוטג׳
  const card = r.run(`$('scanLineCard').innerHTML`);
  assert.deepEqual(json(r, '[receiptLineScanCard.kind, receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.addQty]'), ['line', 0, 1, false], 'לא "עוד כמה?" — השורה אינה מסומנת');
  assert.match(strip(card), /6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.doesNotMatch(card, /data-line-clear|בטל סימון/);
});

test('8. הגרסה עלתה ל-417, כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '417'/);
  assert.match(html, /APP_VERSION_LABEL = 'v' \+ APP_VERSION \+ '_line_clear'/);
  assert.match(html, /<title>הזמנות יטבתה - v417 בדיקה שורה-שורה מיד, גם בלי תעודה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v417 בדיקה שורה-שורה מיד, גם בלי תעודה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v417/);
});
