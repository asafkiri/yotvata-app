// v410 — מעבר מסריקה לבדיקה שורה-שורה: מה שנסרק עובר לרשימה. 8.11.2026, בעל העסק באמצע קליטה אמיתית (99 מתוך 269 יח׳ נסרקו):
// "אם כבר התחלתי סריקת מוצרים אני יכול לעבור לבדיקת שורה-שורה והמוצרים שסרקתי יעברו לרשימה?" עד כאן השורות נפתחו ריקות
// והספירה הוחלפה ב"סיום". אותם נתונים כמו ב-line-check.test.mjs (שתי תעודות, חלב בשתיהן: 12 + 5).
// מה שנבדק:
// 1. הכלל: נסרק בדיוק כמו בתעודה — "הגיע" (גם מוצר בשתי תעודות שנסרק בסך שתיהן); שורה אחת בכמות אחרת — "אחרת" עם המספר (חוסר
//    או עודף מול העיניים); מוצר שאינו בתעודות — "הגיע משהו נוסף" כמו קודם; המונה, השורות המקופלות והפתוחות, ושאלת האישור.
// 2. מוצר בשתי תעודות שנסרק בכמות שאינה הסך — נשאר פתוח, בלי ניחוש, עם ההערה כמה נסרק; אחרי "התעודה הזאת לא שלנו" הוא
//    שורה אחת, והסימון מתיישב לבד.
// 3. מה שכבר סומן לא נדרס: חזרה לבדיקה (resume) ובדיקה חדשה אחרי שהקליטה השתנתה שומרות את הסימונים; רק שורות פתוחות
//    מקבלות את מה שנסרק. בלי סריקה — כלום לא מסומן מראש (כמו קודם).
// 4. שוויון: בדיקה שהתחילה מסריקה ובדיקה שסומנה כולה ביד — אותן שורות, אותה ספירה ואותה תעודה שמורה.
// 5. הגרסה.
// הרצה: node --test tools/line-check-carry.test.mjs
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
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
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
// מה שנסרק בקליטה בסריקה (כמה מכל מוצר), ואז "בדוק שורה-שורה בטלפון" עם אישור השאלה
function scannedThen(r, list) {
  r.run(`receiptList = ${JSON.stringify(list.map(([id, qty]) => { const p = products.find(x => x.id === id); return { productId: id, name: p.name, barcode: p.barcode, qty }; }))}; saveReceiptDraft(); receiptCountingMode = 'scan';`);
  r.run('startReceiptLineCheck()');
  const confirms = json(r, 'testConfirms');
  assert.equal(confirms.length, 1, 'שאלה אחת'); assert.equal(r.run('receiptQuantityReview'), null, 'לפני האישור — כלום');
  r.run('testConfirms[testConfirms.length - 1].cb()');
  return confirms[0];
}
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
function markRestOk(r) { review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!l.mark) click(r, { lineMark: di + ':' + li + ':ok' }); })); }
function closeNormal(r) {
  if (!r.run('!!pendingReceipt')) r.click('ai-apply');
  assert.ok(r.run('!!pendingReceipt'), json(r, 'aiScanEvaluation && aiScanEvaluation.errors')?.join(';'));
}
async function save(r) {
  closeNormal(r);
  await r.run('confirmReceipt()');
  const w = r.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
  assert.ok(w, 'התעודה נשמרה');
  return { id: w.path[w.path.length - 1], ...w.data };
}
const items = rc => rc.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

test('1. הכלל: כמו בתעודה — "הגיע" (גם בשתי תעודות יחד); שורה אחת בכמות אחרת — "אחרת" עם המספר; לא בתעודה — "נוסף"', async () => {
  const r = await twoPapers();
  // חלב 17 = 12 + 5 בשתי התעודות; קוטג׳ 6 = 6; יוגורט 3 מתוך 4; שמנת 3 מתוך 2; מעדן — לא בתעודות
  const ask = scannedThen(r, [['milk', 17], ['cottage', 6], ['yogurt', 3], ['cream', 3], ['pudding', 2]]);
  assert.equal(ask.title, 'בדיקה שורה-שורה'); assert.equal(ask.label, 'התחל בדיקה');
  assert.equal(ask.message, 'כבר נספרו 31 יח׳ — הם עוברים לרשימה: מוצר שנסרק בדיוק כמו בתעודה מסומן "הגיע", כמות אחרת מסומנת "אחרת" עם המספר, והשאר ממתינים לסימון. מה שנספר ואינו בתעודות יופיע ב"הגיע משהו נוסף". בסיום, הספירה היא מה שסומן בשורות.');
  assert.equal(review(r).mode, 'lines');
  assert.deepEqual(marks(r), ['ok,ok,qty:3', 'ok,qty:3'], 'חלב בשתי התעודות — "הגיע" בשתיהן; יוגורט ושמנת — "אחרת" עם מה שנסרק');
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '2']]);
  assert.equal(progress(r), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 1 יח׳ · עודף 3 יח׳');
  const html = rows(r);
  assert.match(strip(html), /חלב 3% בקרטון 1 ליטר הגיע · 17 יח׳ ב-2 תעודות שנה/, 'שורה שסומנה "הגיע" — מקופלת, כמו סימון ביד; 412: הקבוצה של שתי התעודות');
  assert.match(strip(html), /קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה/);
  assert.match(html, /data-line-got="0:2"[^>]*value="3"/, '"אחרת" פתוחה עם המספר שנסרק');
  assert.match(html, /id="lineCheckSum_0_2"[^>]*>התקבלו 3 · חוסר 1</);
  assert.match(html, /id="lineCheckSum_1_1"[^>]*>התקבלו 3 · עודף 1</);
  assert.doesNotMatch(strip(html), /נסרקו \d+ יח׳ מהמוצר/, 'ההערה — רק למוצר בכמה תעודות שלא התיישב');
  assert.equal(r.run('receiptList.length'), 5, 'הספירה עצמה לא השתנתה עד "סיום"');
  // אפשר לשנות כל סימון שהגיע מהסריקה, כמו כל סימון (412: חלב — קבוצה אחת; "אחרת" 5 מתחלקת 5 בתעודה הראשונה, 0 בשנייה)
  click(r, { lineMark: '0:0:qty' }); type(r, { lineGot: '0:0' }, '5');
  assert.deepEqual(marks(r), ['qty:5,ok,qty:3', 'qty:0,qty:3']);
  // "סיום" — מה שסומן (כולל מה שהגיע מהסריקה), ואותה דרך כמו תמיד
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 3', 'milk 5', 'pudding 2', 'yogurt 3']);
  // בלי סריקה — כלום לא מסומן מראש ובלי שאלה, כמו קודם
  const plain = await twoPapers();
  plain.run('startReceiptLineCheck()');
  assert.equal(plain.run('testConfirms.length'), 0);
  assert.deepEqual(marks(plain), [',,', ',']);
  assert.equal(progress(plain), 'סומנו 0 מתוך 4 שורות');
});

test('2. מוצר בשתי תעודות שנסרק בכמות שאינה הסך — 412: קבוצה אחת "אחרת" עם המספר, מחולק לפי הסדר; אחרי "לא שלנו" הוא שורה אחת ומתיישב לבד', async () => {
  const r = await twoPapers();
  scannedThen(r, [['milk', 12], ['cottage', 6]]); // חלב: 12 מול 12 + 5
  assert.deepEqual(marks(r), ['ok,ok,', 'none,'], 'חלב: 12 בתעודה הראשונה (מלאה — "הגיע"), 0 בשנייה ("לא הגיע"); הקבוצה — 12 מתוך 17');
  const html = rows(r);
  assert.match(strip(html), /חלב 3% בקרטון 1 ליטר .* 17 יח׳ ב-2 תעודות 12 \+ 5 הגיע 17 אחרת לא הגיע כמה הגיע\? התקבלו 12 · חוסר 5/, 'הקבוצה פתוחה — "אחרת" עם 12, והחוסר מול העיניים');
  assert.match(html, /data-line-got="0:0"[^>]*value="12"/);
  assert.match(strip(html), /שורה 1 בתעודה חלב 3% בקרטון 1 ליטר · 5 יח׳ נספר יחד עם תעודה 1, שורה 1 · התקבלו 12 מתוך 17 הצג/, 'בתעודה השנייה — שורת הפניה, לא כרטיס');
  assert.doesNotMatch(strip(html), /נסרקו \d+ יח׳ מהמוצר/);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 5 יח׳');
  // "התעודה הזאת לא שלנו" על התעודה הקטנה — חלב נשאר בשורה אחת של 12, והסריקה (12) מתיישבת: "הגיע"
  click(r, { lineDrop: '1' }); click(r, { lineDropYes: '1' });
  assert.equal(review(r).docs.length, 1);
  assert.deepEqual(marks(r), ['ok,ok,']);
  assert.doesNotMatch(strip(rows(r)), /נספר יחד עם|data-line-show/);
  assert.equal(progress(r), 'תעודת ספק 4471002 יצאה מהקליטה, והצילום שלה נמחק מהטלפון');
});

test('3. מה שכבר סומן לא נדרס: חזרה לבדיקה ובדיקה חדשה אחרי שינוי בקליטה שומרות את הסימונים; רק שורות פתוחות מקבלות את הסריקה', async () => {
  const storage = new Map();
  const r = await twoPapers({ storage });
  scannedThen(r, [['cottage', 6], ['cream', 1]]);
  assert.deepEqual(marks(r), [',ok,', ',qty:1']);
  // המשתמש משנה: קוטג׳ "לא הגיע", שמנת "הגיע"; "חזרה" ופתיחה מחדש — המשך מאותו מקום (resume), בלי שאלה ובלי דריסה
  click(r, { lineMark: '0:1:none' }); click(r, { lineMark: '1:1:ok' });
  r.run('closeReceiptQuantityReview(); startReceiptLineCheck()');
  assert.equal(r.run('testConfirms.length'), 1, 'בלי שאלה נוספת');
  assert.deepEqual(marks(r), [',none,', ',ok']);
  // פתיחה מחדש של האפליקציה — מהטיוטה
  const again = runtime('yotvata', { storage, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  again.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; testConfirms = []; showConfirm = (t, m, l, cb) => testConfirms.push({ t, m, l, cb });`);
  again.run('startReceiptLineCheck()');
  assert.equal(again.run('testConfirms.length'), 0);
  assert.deepEqual(marks(again), [',none,', ',ok'], 'מהטיוטה — מה שסומן');
  // בדיקה חדשה כי הקליטה השתנתה (מוצר נוסף נסרק בינתיים): הסימונים נשארים, ורק שורות פתוחות מקבלות את מה שנסרק
  r.run(`closeReceiptQuantityReview(); receiptList = receiptList.concat([{ productId: 'yogurt', name: 'יוגורט טבעי 150 גרם', barcode: '7290000000022', qty: 4 }]); saveReceiptDraft(); startReceiptLineCheck();`);
  assert.equal(r.run('testConfirms.length'), 2, 'הקליטה השתנתה — שאלה חדשה');
  r.run('testConfirms[testConfirms.length - 1].cb()');
  assert.deepEqual(marks(r), [',none,ok', ',ok'], 'קוטג׳ ושמנת כמו שסומנו ביד (גם ששמנת נסרקה 1 ועכשיו מסומנת "הגיע"); יוגורט 4 = 4 — "הגיע"');
});

test('4. שוויון: בדיקה שהתחילה מסריקה ובדיקה שסומנה כולה ביד — אותן שורות, אותה ספירה ואותה תעודה שמורה', async () => {
  // א: נסרקו קוטג׳ 4 (מתוך 6), יוגורט 4, שמנת 2; חלב סומן ביד "הגיע" בשתי התעודות
  const a = await twoPapers();
  scannedThen(a, [['cottage', 4], ['yogurt', 4], ['cream', 2]]);
  assert.deepEqual(marks(a), [',qty:4,ok', ',ok']);
  markRestOk(a);
  // ב: הכול ביד
  const b = await twoPapers();
  b.run('startReceiptLineCheck()');
  click(b, { lineMark: '0:1:qty' }); type(b, { lineGot: '0:1' }, '4'); markRestOk(b);
  const pick = r => json(r, '({ docs: receiptQuantityReview.docs.map(d => ({ ...d, scanId: null })), extras: receiptQuantityReview.extras, rows: receiptQuantityReview.rows, products: receiptQuantityReview.products })');
  assert.deepEqual(pick(a), pick(b), 'אותה בדיקה בדיוק');
  assert.equal(a.run('finishReceiptLineCheck()'), true); assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(a, 'receiptList'), json(b, 'receiptList'));
  assert.deepEqual(json(a, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 4', 'cream 2', 'milk 17', 'yogurt 4']);
  const savedA = await save(a), savedB = await save(b);
  assert.deepEqual(items(savedA), items(savedB));
  assert.deepEqual({ ...savedA.quantityCheck, confirmedAt: null }, { ...savedB.quantityCheck, confirmedAt: null }, 'מה שנשמר בקליטה — זהה, בלי שדה חדש');
  assert.ok(!JSON.stringify(savedA).includes('"scanned"'), 'ההערה (scanned) אינה נשמרת בקליטה');
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedA[k], savedB[k], k);
});

test('5. הגרסה עלתה ל-412, כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '412'/);
  assert.match(html, /APP_VERSION_LABEL = 'v' \+ APP_VERSION \+ '_line_groups'/);
  assert.match(html, /<title>הזמנות יטבתה - v412 /); assert.match(html, /id="verBadge"[^>]*>v412 /);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v412/);
});
