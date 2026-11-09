// v405 — בחירה אחת במסך הצילום, והרשימה שורה-שורה כמו במסך הסריקה (כמו ברמן 159).
// 4.11.2026, בעל העסק: ביטבתה ובתנובה בוחרים פעמיים — "סריקה או ידני" במסך הצילום, ואחרי ההמתנה לפענוח שוב איך בודקים;
// וברשימה שורה-שורה אין מחיר קופה, אין הפרדה בין המוצרים, והחוויה לא נוחה. אותם נתונים מומצאים כמו ב-line-check.test.mjs.
// מה שנבדק:
// 1. מסך הצילום: הסריקה כמו שהייתה, ומתחתיה שלוש הבדיקות הידניות (שורה-שורה / הכל הגיע / חוסרים ועודפים) במקום
//    "פענח תעודה — הכמויות נבדקות ידנית"; כבויות עד שהצילום מוכן.
// 2. הבחירה נפתחת לבד כשהפענוח מסתיים: שורה-שורה — החלון; "הכל הגיע" — שאלה אחת עם מה שנקרא, ואחריה אותו "כל הכמויות
//    תואמות"; חוסרים ועודפים — החלון הקיים. פעם אחת (הבחירה נמחקת), עם רטט.
// 3. מסך ההמתנה אומר מה נבחר; "שנה את הבדיקה" מבטל, ואז אחרי הפענוח שלושת הכפתורים כמו קודם. rc-photo-quantity (בלי
//    בחירה) — כמו קודם; "מעבר לקליטה בסריקת מוצרים" מבטל את הבחירה.
// 4. הבחירה מחכה: למסך הקליטה (נפתחת כשחוזרים), לפענוח שנכשל (נפתחת אחרי התיקון), ולרענון או טלפון אחר (מהטיוטה).
// 5. השורה: מחיר הקופה בדיוק כמו בשורת הסריקה (posPriceLineHtml משותפת), "אין מחיר קופה", ברקוד ומחיר ליחידה,
//    "שורה N בתעודה", הכמות גדולה, "2 ארגזים × 6", "הגיע N"; כותרת התעודה sticky באותו סדר טקסט; גוף החלון אפור.
// 6. קיפול: "הגיע"/"לא הגיע" מקפלים (בלי כפתורי סימון, עם "שנה"); "שנה" פותח; "אחרת" נשארת פתוחה; פתיחה מחדש — מקופל;
//    המונה "סומנו X מתוך Y שורות · חוסר N יח׳ · עודף M יח׳"; "חוסרים ועודפים" — לבן ובלי שינוי.
// הרצה: node --test tools/line-check-v405.test.mjs
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
const DATA = { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } };
// הקליטה פתוחה במסך הצילום עם התעודות; שירות הפענוח עונה לכל תעודה (ואפשר לעכב אותו: gate)
function ready(papers, opts = {}) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: DATA, ...opts });
  const original = c.context.fetch;
  let gate = null;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    if (gate) await gate;
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.hold = () => { let release; gate = new Promise(res => release = res); return () => { gate = null; release(); }; };
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    globalThis.buzzes = []; navigator.vibrate = ms => buzzes.push(ms);
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  c.cloud = cloud;
  return c;
}
async function start(papers, intent, opts = {}, before = '') {
  const c = ready(papers, opts);
  await c.cloud.tick();
  if (before) c.run(before);
  await c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: ${JSON.stringify(intent)} })`);
  return c;
}
const twoPapers = (intent = null, opts = {}) => start([BIG, SMALL], intent, opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const review = r => json(r, 'receiptQuantityReview');
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
const modalOpen = r => r.run(`!$('receiptQuantityModal').classList.contains('hidden')`);
const app = r => r.node('app').innerHTML;
const draft = r => JSON.parse(r.storage.get('yt_receipt_draft'));
// ה-HTML של שורה אחת (lineCheck_di_li) מתוך הרשימה — עד השורה הבאה או סוף התעודה
function row(r, di, li) {
  const h = rows(r), i = h.indexOf('<div id="lineCheck_' + di + '_' + li + '"');
  assert.ok(i >= 0, 'שורה ' + di + ':' + li + ' קיימת');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i)].filter(x => x > 0);
  return h.slice(i, ends.length ? Math.min(...ends) : undefined);
}
const markRestOk = r => review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!l.mark) click(r, { lineMark: di + ':' + li + ':ok' }); }));
// הקריאות שעובדות על הפתיחה שנדחתה (setTimeout בחלון) — בהרצה: מה שנצבר בתור
function runQueued(r) { const fns = r.callbacks.splice(0); fns.forEach(fn => fn()); return fns.length; }

test('1. מסך הצילום: סריקה כמו שהייתה, ומתחתיה שלוש הבדיקות הידניות — כבויות עד שהצילום מוכן', async () => {
  const c = ready([BIG]);
  await c.cloud.tick();
  c.run('receiptEntryMode = "photo"; receiptOpened = false; renderReceiving()');
  const html = app(c);
  assert.match(html, /<button data-role="rc-photo-start"  class="[^"]*bg-blue-600 text-white"/, 'הסריקה — אותו כפתור');
  assert.match(strip(html), /התחל קליטת מוצרים בלי סריקה — בדיקה מול התעודה בדוק שורה-שורה בטלפון הכל הגיע כמו בתעודה יש חוסרים או עודפים הבדיקה שתבחר תיפתח לבד כשהפענוח יסתיים הקלדת סכום ויחידות ידנית/);
  for (const role of ['rc-photo-lines', 'rc-photo-all', 'rc-photo-differences']) assert.match(html, new RegExp('<button data-role="' + role + '"  class='), role + ' פעיל');
  assert.doesNotMatch(html, /rc-photo-quantity|הכמויות נבדקות ידנית/, 'הכפתור הישן ירד');
  // עמוד שהכיוון שלו לא אושר — הכל כבוי
  c.run('aiScanDocuments[0].pages[0].orientationConfirmed = false; renderReceiving()');
  const off = app(c);
  for (const role of ['rc-photo-start', 'rc-photo-lines', 'rc-photo-all', 'rc-photo-differences']) assert.match(off, new RegExp('<button data-role="' + role + '" disabled class='), role + ' כבוי');
});

test('2. הבחירה נפתחת לבד כשהפענוח מסתיים — שורה-שורה, "הכל הגיע" (שאלה אחת), חוסרים ועודפים; פעם אחת, עם רטט', async () => {
  const a = await twoPapers('lines');
  assert.equal(a.run('receiptPaperScanState'), 'ok'); assert.equal(a.run('receiptCountingMode'), 'manual');
  assert.equal(modalOpen(a), true, 'החלון נפתח לבד'); assert.equal(review(a).mode, 'lines');
  assert.equal(a.run(`$('receiptQuantityTitle').textContent`), 'בדיקה שורה-שורה');
  assert.equal(a.run('receiptQuantityIntent'), null, 'הבחירה נמחקה'); assert.equal(draft(a).quantityIntent, null);
  assert.deepEqual(json(a, 'buzzes'), [[60, 40, 60]], 'רטט אחד');
  assert.deepEqual(review(a).docs.map(d => d.lines.length), [3, 2]);
  // "הכל הגיע" — שאלה אחת עם מה שנקרא, ואחריה בדיוק "כל הכמויות תואמות"
  const b = await twoPapers('all');
  assert.equal(modalOpen(b), false);
  const q = json(b, 'testConfirms');
  assert.equal(q.length, 1); assert.equal(q[0].title, 'הכל הגיע כמו בתעודה'); assert.equal(q[0].label, 'כן, הכל הגיע');
  assert.equal(q[0].message, 'נקרא: תעודת ספק 4471001 · ₪114.00 · 3 שורות · 22 יח׳ | תעודת ספק 4471002 · ₪29.00 · 2 שורות · 7 יח׳. לאשר שכל הכמויות תואמות את התעודה?');
  assert.equal(b.run('receiptQuantityIntent'), null); assert.deepEqual(json(b, 'receiptList'), [], 'לפני האישור — כלום');
  b.run('testConfirms[0].cb()');
  assert.deepEqual(json(b, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 2', 'milk 17', 'yogurt 4']);
  assert.equal(b.run('receiptQuantityCheckAudit().method'), 'manual');
  assert.ok(b.run('!!pendingReceipt || currentView === "reconcile"'), 'ממשיך כמו "כל הכמויות תואמות"');
  // חוסרים ועודפים — החלון הקיים
  const d = await twoPapers('differences');
  assert.equal(modalOpen(d), true); assert.equal(d.run(`$('receiptQuantityTitle').textContent`), 'חוסרים ועודפים');
  assert.equal(review(d).mode, undefined); assert.match(rows(d), /data-quantity-kind=/);
  assert.equal(d.run('receiptQuantityIntent'), null);
  // בלי בחירה (rc-photo-quantity, כמו קודם) — כלום לא נפתח, ושלושת הכפתורים
  const n = await twoPapers(null);
  assert.equal(modalOpen(n), false); assert.deepEqual(json(n, 'buzzes'), []); assert.equal(n.run('testConfirms.length'), 0);
  assert.match(app(n), /data-role="rc-quantity-lines"[\s\S]*data-role="rc-quantity-all"[\s\S]*data-role="rc-quantity-differences"/);
});

test('3. מסך ההמתנה אומר מה נבחר; "שנה את הבדיקה" מבטל; "מעבר לקליטה בסריקת מוצרים" מבטל', async () => {
  const c = ready([BIG, SMALL]);
  await c.cloud.tick();
  const release = c.hold();
  const run = c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`);
  await settle();
  assert.equal(c.run('receiptPaperScanState'), 'running');
  let html = app(c);
  assert.match(html, /data-manual-receiving/);
  assert.match(strip(html), /בסיום הפענוח תיפתח לבד הבדיקה שורה-שורה, והטלפון ירטוט\. אפשר להניח את הטלפון בצד\. שנה את הבדיקה/);
  assert.equal(draft(c).quantityIntent, 'lines', 'הבחירה בטיוטה');
  c.click('rc-intent-clear');
  assert.equal(c.run('receiptQuantityIntent'), null); assert.equal(draft(c).quantityIntent, null);
  html = app(c);
  assert.doesNotMatch(html, /rc-intent-clear|תיפתח לבד/);
  assert.match(strip(html), /בסיום הפענוח אפשר לאשר את הכמויות או לדווח על חוסרים ועודפים/);
  release(); await run; await settle();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(modalOpen(c), false, 'בלי בחירה — לא נפתח'); assert.deepEqual(json(c, 'buzzes'), []);
  assert.match(app(c), /data-role="rc-quantity-lines"/);
  // הטקסט לכל בחירה
  for (const [intent, text] of [['all', 'תופיע לבד השאלה "הכל הגיע כמו בתעודה?"'], ['differences', 'תיפתח לבד רשימת החוסרים והעודפים']]) {
    c.run(`receiptQuantityIntent = ${JSON.stringify(intent)}; receiptPaperScanState = 'running'`);
    assert.ok(strip(c.run('receiptManualStatusHtml()')).includes(text), intent + ': ' + text);
  }
  // "מעבר לקליטה בסריקת מוצרים" — הבחירה יורדת
  c.run(`receiptQuantityIntent = 'lines'; receiptPaperScanState = 'ok'; saveReceiptDraft()`);
  c.click('rc-count-by-scan');
  assert.equal(c.run('receiptCountingMode'), 'scan'); assert.equal(c.run('receiptQuantityIntent'), null); assert.equal(draft(c).quantityIntent, null);
});

test('4. הבחירה מחכה: למסך הקליטה, לפענוח שנכשל (ואחרי התיקון נפתחת), ולרענון מהטיוטה', async () => {
  // מסך אחר בזמן הפענוח — נפתחת כשחוזרים לקליטה
  const a = await start([BIG, SMALL], 'lines', {}, `currentView = 'history'`);
  assert.equal(a.run('receiptPaperScanState'), 'ok'); assert.equal(modalOpen(a), false); assert.equal(a.run('receiptQuantityIntent'), 'lines', 'מחכה');
  a.run(`currentView = 'receiving'; renderReceiving()`);
  assert.equal(modalOpen(a), false, 'לא בתוך הציור');
  assert.ok(runQueued(a) >= 1); assert.equal(modalOpen(a), true); assert.equal(review(a).mode, 'lines'); assert.equal(a.run('receiptQuantityIntent'), null);
  // פענוח שנכשל — הבחירה נשארת, והכרטיס הצהוב; אחרי התיקון (yotvataRecheckFailedPaper) נפתחת
  const f = ready([BIG, SMALL]);
  await f.cloud.tick();
  f.run(`const realCheck = yotvataPaperCheck; yotvataPaperCheck = (doc, pages) => ({ ...realCheck(doc, pages), ok: false, problems: ['boom'] }); globalThis.realCheck = realCheck;`);
  await f.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`);
  assert.equal(f.run('receiptPaperScanState'), 'failed'); assert.equal(f.run('receiptQuantityIntent'), 'lines'); assert.equal(modalOpen(f), false);
  assert.match(strip(app(f)), /צריך להשלים את פענוח התעודה/);
  f.run('yotvataPaperCheck = realCheck');
  assert.equal(f.run('yotvataRecheckFailedPaper()'), true);
  // אחרי התיקון הבחירה רצה פעם אחת: כאן (נתוני הבדיקה) המוצרים עוד לא זוהו, ולכן נפתח קודם מסך הזיהוי — ולא לולאה
  assert.equal(f.run('receiptQuantityIntent'), null, 'הבחירה נוצלה');
  assert.equal(f.run('currentView'), 'reconcile', 'מסך הזיהוי לפני הבדיקה');
  assert.equal(f.toasts.some(t => /צריך להשלים את זיהוי המוצרים/.test(JSON.stringify(t))), true);
  assert.deepEqual(json(f, 'buzzes'), [[60, 40, 60]]);
  // רענון: הבחירה בטיוטה, והחלון נפתח אחרי הציור, בלי קריאה נוספת לשירות
  const storage = new Map();
  const s = await start([BIG, SMALL], 'lines', { storage }, `currentView = 'history'`);
  assert.equal(draft(s).quantityIntent, 'lines');
  const again = runtime('yotvata', { storage, data: DATA });
  again.run(`todayStr = () => '2026-11-03'; testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb }); globalThis.buzzes = []; navigator.vibrate = ms => buzzes.push(ms);`);
  assert.equal(again.run('receiptQuantityIntent'), 'lines'); assert.equal(again.run('receiptPaperScanState'), 'ok');
  again.run(`currentView = 'receiving'; mainMode = 'receiving'; renderReceiving()`);
  assert.ok(runQueued(again) >= 1);
  assert.equal(modalOpen(again), true); assert.equal(review(again).mode, 'lines'); assert.equal(again.run('receiptQuantityIntent'), null);
  assert.equal(again.requests.length, 0); assert.deepEqual(json(again, 'buzzes'), [[60, 40, 60]]);
});

test('5. השורה כמו במסך הסריקה: מחיר קופה, ברקוד ומחיר ליחידה, מספר השורה, הכמות גדולה, "הגיע N"; כותרת sticky; גוף אפור', async () => {
  const r = await twoPapers();
  r.run(`products.find(p => p.id === 'milk').posPrice = 6.9; products.find(p => p.id === 'milk').boxSize = 6;`);
  r.run('startReceiptLineCheck()');
  assert.equal(r.run(`$('receiptQuantityBody').classList.contains('bg-slate-50')`), true, 'גוף החלון אפור');
  const a = row(r, 0, 0);
  assert.equal(strip(a), 'שורה 1 בתעודה · גם בתעודה 2 (5 יח׳) חלב 3% בקרטון 1 ליטר בקופה: ₪6.90 7290000000008 · ₪5.00 ליח׳ 17 יח׳ ב-2 תעודות 12 + 5 הגיע 17 אחרת לא הגיע');
  const pos = r.run(`posPriceLineHtml(products.find(p => p.id === 'milk'))`);
  assert.match(pos, /fa-cash-register.*בקופה: ₪6\.90/);
  assert.ok(a.includes(pos), 'בבדיקה שורה-שורה');
  assert.ok(r.run(`buildReceiptRow({ productId: 'milk', name: 'חלב 3% בקרטון 1 ליטר', barcode: '7290000000008', qty: 1 })`).includes(pos), 'ובסריקה — אותה שורה');
  const b = row(r, 0, 1);
  assert.match(strip(b), /^שורה 2 בתעודה קוטג׳ 5% 250 גרם אין מחיר קופה — בדוק בקופה ועדכן 7290000000015 · ₪7\.00 ליח׳ 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.match(b, /fa-triangle-exclamation/);
  assert.equal(r.run(`receiptLineBoxText({ boxSize: 6 }, 6)`), 'ארגז אחד של 6');
  assert.equal(r.run(`receiptLineBoxText({ boxSize: 4 }, 6)`), '', 'לא מתחלק — בלי ארגזים');
  const all = rows(r);
  assert.equal((all.match(/data-line-mark="\d+:\d+:ok"/g) || []).length, 4); // v412: 4 מוצרים — 4 שורות
  assert.equal((all.match(/aria-pressed="true"/g) || []).length, 0);
  assert.doesNotMatch(strip(all), /סמן הכל|הכל הגיע/);
  assert.match(a, /data-line-mark="0:0:ok"[^>]*class="[^"]*text-base[^"]*bg-emerald-50 border-2 border-emerald-500/, '"הגיע" רחב ומודגש');
  assert.match(all, /sticky top-0 z-10 bg-white border-r-4 border-blue-500/);
  assert.match(strip(all), /^תעודה 1 מתוך 2 תעודת ספק 4471001 · ₪114\.00 · 3 שורות · 22 יח׳ התעודה הזאת לא שלנו/);
  // "חוסרים ועודפים" — לבן ובלי שינוי
  r.run('closeReceiptQuantityReview(); startReceiptQuantityReview(false)');
  assert.equal(r.run(`$('receiptQuantityTitle').textContent`), 'חוסרים ועודפים');
  assert.equal(r.run(`$('receiptQuantityBody').classList.contains('bg-slate-50')`), false);
  assert.doesNotMatch(rows(r), /בקופה|data-line-open|data-line-mark/);
  assert.equal(r.run(`$('receiptQuantityConfirm').className`), 'btn-tap w-full bg-blue-600 text-white rounded-xl py-3 font-black text-base');
});

test('6. קיפול: "הגיע"/"לא הגיע" מקפלים, "שנה" פותח, "אחרת" פתוחה, פתיחה מחדש מקופלת; המונה עם החוסרים והעודפים', async () => {
  const r = await twoPapers();
  r.run(`products.find(p => p.id === 'milk').posPrice = 6.9`);
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' });
  let a = row(r, 0, 0);
  assert.doesNotMatch(a, /data-line-mark=/, 'מקופלת — בלי כפתורי סימון');
  assert.equal(strip(a), 'חלב 3% בקרטון 1 ליטר הגיע · 17 יח׳ ב-2 תעודות · בקופה ₪6.90 שנה');
  assert.match(a, /data-line-open="0:0"/); assert.match(a, /border-emerald-300 bg-emerald-50/);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  assert.equal(json(r, 'receiptQuantityReview.docs[1].lines[0].mark'), 'ok', 'v412: גם השורה בתעודה השנייה');
  assert.equal(json(r, 'receiptQuantityReview.docs[0].lines[0].mark'), 'ok', 'הסימון נשמר כמו ב-v403');
  click(r, { lineOpen: '0:0' });
  a = row(r, 0, 0);
  assert.match(a, /data-line-mark="0:0:ok" aria-pressed="true"/); assert.equal((a.match(/data-line-mark=/g) || []).length, 3);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות', 'פתיחה אינה סימון');
  click(r, { lineMark: '0:0:ok' });
  assert.doesNotMatch(row(r, 0, 0), /data-line-mark=/, 'מתקפלת שוב');
  click(r, { lineMark: '0:2:none' }); // v412: החלב הוא קבוצה אחת לשתי התעודות — השורה האדומה כאן היא היוגורט
  const c = row(r, 0, 2);
  assert.equal(strip(c), 'יוגורט טבעי 150 גרם לא הגיע · 0 מתוך 4 שנה');
  assert.match(c, /border-rose-300 bg-rose-50/);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 4 יח׳');
  click(r, { lineMark: '0:1:qty' }); type(r, { lineGot: '0:1' }, '4');
  const b = row(r, 0, 1);
  assert.match(b, /data-line-got="0:1"/); assert.match(b, /data-line-mark="0:1:qty" aria-pressed="true"/);
  assert.equal(r.run(`$('lineCheckSum_0_1').textContent`), 'התקבלו 4 · חוסר 2');
  assert.equal(progress(r), 'סומנו 3 מתוך 4 שורות · חוסר 6 יח׳');
  type(r, { lineGot: '0:1' }, '8');
  assert.equal(progress(r), 'סומנו 3 מתוך 4 שורות · חוסר 4 יח׳ · עודף 2 יח׳');
  type(r, { lineGot: '0:1' }, 'x');
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 4 יח׳', 'כמות לא תקינה — השורה לא נספרת');
  type(r, { lineGot: '0:1' }, '4');
  click(r, { extraAdd: 'butter' }); type(r, { extraGot: '0' }, '3');
  assert.equal(progress(r), 'סומנו 3 מתוך 4 שורות · חוסר 6 יח׳ · עודף 3 יח׳');
  // פתיחה מחדש של החלון: מה שסומן מקופל, גם מה שנפתח ב"שנה"; "אחרת" פתוחה
  click(r, { lineOpen: '0:0' }); assert.match(row(r, 0, 0), /data-line-mark=/);
  r.run('closeReceiptQuantityReview(); startReceiptLineCheck()');
  assert.equal(r.run('testConfirms.length'), 0, 'בלי שאלה — ממשיכים מאותו מקום');
  assert.doesNotMatch(row(r, 0, 0), /data-line-mark=/); assert.match(row(r, 0, 1), /data-line-got="0:1"/);
  // "סיום" לפני הזמן — השורה הפתוחה הראשונה שנשארה מסומנת; ואז הכל "הגיע" — אותה ספירה כמו ב-v403
  assert.equal(r.run('finishReceiptLineCheck()'), false);
  assert.equal(r.run(`$('lineCheck_1_1').classList.contains('ring-4')`), true, 'השורה הפתוחה הראשונה — השמנת');
  markRestOk(r);
  assert.equal(progress(r), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 6 יח׳ · עודף 3 יח׳');
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.equal(modalOpen(r), false);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['butter 3', 'cottage 4', 'cream 2', 'milk 17', 'yogurt 0']);
});
