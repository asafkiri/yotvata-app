// v415 — בדיקה שורה-שורה: מוצר בלי מחיר קופה — השדה להשלמת המחיר בשורה עצמה (כמו תנובה 161 וברמן 167).
// 10.11.2026, בעל העסק: "כאשר יש מוצר שאין לו מחיר קופה באפליקציה — אפשר שיהיה ישירות מהשורה להכניס את המחיר של הקופה?"
// עד כאן השורה אמרה "אין מחיר קופה — בדוק בקופה ועדכן" ושלחה למסך המחירים. אותם נתונים מומצאים כמו ב-line-check.test.mjs.
// מה שנבדק:
// 1. השורה: בלי מחיר קופה — שדה ההשלמה (receiptLinePosHtml) במקום האזהרה; עם מחיר — "בקופה: ₪X" בלי שדה; שורת הסריקה
//    (buildReceiptRow) והכרטיס שמעל המצלמה (receiptLineScanCardHtml) — האזהרה כמו קודם, בלי שדה.
// 2. הקלדה: נשמר מיד דרך savePosPrice (posPrice, posPriceAt, אותה כתיבה מושהית לענן כמו מסך המחירים), "נשמר — ₪X בקופה",
//    בלי לצייר מחדש; פסיק כנקודה; בציור הבא (סימון, "שנה") — "בקופה ₪X" כמו כל שורה, בלי שדה.
// 3. קלט לא תקין: ריק — המחיר נמחק והרמז נעלם; אותיות, אפס או שלילי — "הזן מחיר חיובי", ומחיר שנשמר מהשדה רגע קודם נמחק.
// 4. מתחת לעלות כולל מע״מ — נשמר, עם אזהרה אדומה (לא חסימה).
// 5. שורה מקופלת ("הגיע") בלי מחיר קופה — השדה גם בה; "הגיע משהו נוסף" — גם שם; Enter בשדה סוגר את המקלדת (blur), Escape עדיין סוגר את החלון.
// 6. הגרסה עלתה ל-417, כולל ה-service worker.
// הרצה: node --test tools/line-check-pos-price.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7 },
  { id: 'yogurt', name: 'יוגורט טבעי 150 גרם', code: '22', barcode: '7290000000022', price: 3 },
  { id: 'cream', name: 'שמנת חמוצה 15% 200 מ״ל', code: '39', barcode: '7290000000039', price: 2 },
  { id: 'pudding', name: 'מעדן שוקולד 125 גרם', code: '46', barcode: '7290000000046', price: 4 }
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
// שתי התעודות צולמו ונקראו, הכמויות נבדקות ידנית, והבדיקה שורה-שורה פתוחה. הכתיבה השקטה לענן (savePosPrice) נרשמת ב-writes
async function open() {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = [BIG, SMALL].findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: [BIG, SMALL][index] ? [structuredClone([BIG, SMALL][index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    runCloudTaskSilent = async (label, task) => { testWrites.push({ label, ...structuredClone(task) }); return true; };
    aiScanDocuments = ${JSON.stringify([BIG, SMALL].map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודות נקראו ואומתו: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  c.run(`products.find(p => p.id === 'milk').posPrice = 6.9; startReceiptLineCheck()`);
  assert.equal(json(c, 'receiptQuantityReview.mode'), 'lines');
  c.callbacks.splice(0); // מה שנצבר בתור עד כאן אינו של הבדיקה
  return c;
}
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const product = (r, id) => json(r, `products.find(p => p.id === ${JSON.stringify(id)})`);
const hint = (r, id) => r.node('linePosHint_' + id);
// ה-HTML של כרטיס אחד (lineCheck_di_li / lineExtra_k) מתוך הרשימה — עד הכרטיס הבא או סוף התעודה
function card(r, id) {
  const h = rows(r), i = h.indexOf('<div id="' + id + '"');
  assert.ok(i >= 0, 'כרטיס ' + id + ' קיים');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<div id="lineExtra_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i), h.indexOf('<input data-line-search', i)].filter(x => x > 0);
  return h.slice(i, ends.length ? Math.min(...ends) : undefined);
}
const row = (r, di, li) => card(r, 'lineCheck_' + di + '_' + li);
// הכתיבות המושהות לענן (setTimeout של savePosPrice) — בהרצה: מה שנצבר בתור
function flush(r) { const fns = r.callbacks.splice(0); fns.forEach(fn => fn()); return r.writes.splice(0); }
const EDITOR = 'אין מחיר קופה — אפשר להשלים כאן כמה עובר בקופה (כולל מע״מ) ₪';

test('1. השורה: בלי מחיר קופה — שדה ההשלמה במקום האזהרה; עם מחיר — "בקופה: ₪X" בלי שדה; הסריקה והכרטיס שמעל המצלמה — כמו קודם', async () => {
  const r = await open();
  const b = row(r, 0, 1);
  assert.equal(strip(b), 'שורה 2 בתעודה קוטג׳ 5% 250 גרם ' + EDITOR + ' 7290000000015 · ₪7.00 ליח׳ 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע');
  assert.match(b, /<input id="linePos_cottage" data-line-pos="cottage" type="text" inputmode="decimal" autocomplete="off" placeholder="0\.00" aria-label="מחיר קופה: קוטג׳ 5% 250 גרם"/);
  assert.match(b, /<label for="linePos_cottage"/); assert.match(b, /<div id="linePosHint_cottage" class="hidden" aria-live="polite"><\/div>/);
  assert.match(b, /fa-triangle-exclamation/); assert.match(b, /fa-cash-register/);
  assert.doesNotMatch(b, /בדוק בקופה ועדכן/);
  // עם מחיר קופה — כמו קודם, בלי שדה
  const a = row(r, 0, 0);
  assert.match(a, /fa-cash-register text-xs"><\/i> בקופה: ₪6\.90/); assert.doesNotMatch(a, /data-line-pos|אין מחיר קופה/);
  // שורת הסריקה והכרטיס שמעל המצלמה — האזהרה הישנה, בלי שדה (שם אין איפה להקליד)
  const scanRow = r.run(`buildReceiptRow({ productId: 'cottage', name: 'קוטג׳ 5% 250 גרם', barcode: '7290000000015', qty: 1 })`);
  assert.match(scanRow, /אין מחיר קופה — בדוק בקופה ועדכן/); assert.doesNotMatch(scanRow, /data-line-pos/);
  const cardHtml = r.run(`receiptLineScanCardHtml({ kind: 'line', di: 0, li: 1, scanned: products.find(p => p.id === 'cottage'), related: null, askQty: false, addQty: false, got: '' })`);
  assert.match(strip(cardHtml), /^שורה 2 בתעודה 1 מתוך 2 קוטג׳ 5% 250 גרם אין מחיר קופה — בדוק בקופה ועדכן 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.doesNotMatch(cardHtml, /data-line-pos/);
  // אותה פונקציה — הדגל מחליט
  assert.match(r.run(`posPriceLineHtml(products.find(p => p.id === 'cottage'))`), /^<div class="text-\[11px\] font-black text-amber-600 mt-0\.5">.*בדוק בקופה ועדכן<\/div>$/);
  assert.equal(r.run(`posPriceLineHtml(products.find(p => p.id === 'cottage'), true)`), r.run(`receiptLinePosHtml(products.find(p => p.id === 'cottage'))`));
  assert.equal(r.run(`posPriceLineHtml(null, true)`), '');
});

test('2. הקלדה: נשמר מיד דרך savePosPrice (posPrice, posPriceAt, הכתיבה לענן), "נשמר — ₪X בקופה", בלי ציור מחדש; בציור הבא — "בקופה ₪X" בלי שדה', async () => {
  const r = await open();
  const before = rows(r);
  type(r, { linePos: 'cottage' }, '9.90'); // עלות 7 + מע״מ = 8.26 — מעל העלות
  const p = product(r, 'cottage');
  assert.equal(p.posPrice, 9.9); assert.ok(Number(p.posPriceAt) > 0, 'posPriceAt — מגן מפני דריסה בייבוא דוח ישן');
  assert.equal(hint(r, 'cottage').className, 'text-[11px] font-black mt-1.5 text-emerald-700');
  assert.equal(strip(hint(r, 'cottage').innerHTML), 'נשמר — ₪9.90 בקופה'); assert.match(hint(r, 'cottage').innerHTML, /fa-check/);
  assert.equal(rows(r), before, 'בלי ציור מחדש — השדה, הפוקוס והמקלדת נשארים');
  // הכתיבה המושהית לענן — בדיוק מה שמסך המחירים כותב (savePosPrice)
  const writes = flush(r).filter(w => w.label === 'save pos price');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, 'update'); assert.deepEqual(writes[0].path.slice(-2), ['products', 'cottage']);
  assert.deepEqual(writes[0].data, { posPrice: 9.9, posPriceAt: p.posPriceAt });
  assert.match(writes[0].operationId || '', /pos/);
  // פסיק כנקודה
  type(r, { linePos: 'cottage' }, '10,50');
  assert.equal(product(r, 'cottage').posPrice, 10.5); assert.equal(strip(hint(r, 'cottage').innerHTML), 'נשמר — ₪10.50 בקופה');
  assert.equal(flush(r).filter(w => w.label === 'save pos price').pop().data.posPrice, 10.5);
  // הציור הבא — הסימון: השורה מקופלת עם המחיר, בלי שדה; "שנה" — הכרטיס הפתוח עם "בקופה: ₪10.50", בלי שדה
  click(r, { lineMark: '0:1:ok' });
  let b = row(r, 0, 1);
  assert.equal(strip(b), 'קוטג׳ 5% 250 גרם הגיע · 6 יח׳ בקופה ₪10.50 שנה'); assert.doesNotMatch(b, /data-line-pos|flex-1/);
  click(r, { lineOpen: '0:1' });
  b = row(r, 0, 1);
  assert.match(b, /בקופה: ₪10\.50/); assert.doesNotMatch(b, /data-line-pos|אין מחיר קופה/);
  assert.equal(json(r, 'receiptQuantityReview.docs[0].lines[1].mark'), 'ok', 'הסימון לא נגע במחיר ולהפך');
});

test('3. קלט לא תקין: ריק — המחיר נמחק והרמז נעלם; אותיות, אפס או שלילי — "הזן מחיר חיובי", ומחיר שנשמר רגע קודם נמחק', async () => {
  const r = await open();
  type(r, { linePos: 'cottage' }, '7');
  assert.equal(product(r, 'cottage').posPrice, 7);
  type(r, { linePos: 'cottage' }, '');
  assert.equal(product(r, 'cottage').posPrice, null); assert.equal(hint(r, 'cottage').className, 'hidden'); assert.equal(hint(r, 'cottage').innerHTML, '');
  assert.equal(flush(r).filter(w => w.label === 'save pos price').pop().data.posPrice, null, 'המחיקה נכתבת לענן');
  type(r, { linePos: 'cottage' }, '7');
  for (const bad of ['abc', '0', '-3', '0,00']) {
    type(r, { linePos: 'cottage' }, bad);
    assert.equal(product(r, 'cottage').posPrice, null, bad + ': המחיר שנשמר מהשדה נמחק');
    assert.equal(hint(r, 'cottage').className, 'text-[11px] font-black mt-1.5 text-rose-600'); assert.equal(hint(r, 'cottage').innerHTML, 'הזן מחיר חיובי');
  }
  // ריק כשלא נשמר כלום — בלי כתיבה מיותרת
  r.callbacks.splice(0); r.writes.splice(0);
  type(r, { linePos: 'cottage' }, '');
  assert.equal(flush(r).filter(w => w.label === 'save pos price').length, 0);
  // מוצר שאינו במאגר — כלום
  type(r, { linePos: 'nobody' }, '5');
  assert.equal(flush(r).filter(w => w.label === 'save pos price').length, 0);
});

test('4. מתחת לעלות כולל מע״מ — נשמר, עם אזהרה אדומה (לא חסימה)', async () => {
  const r = await open();
  type(r, { linePos: 'cottage' }, '5'); // עלות 7 + 18% מע״מ = 8.26
  assert.equal(product(r, 'cottage').posPrice, 5);
  assert.equal(hint(r, 'cottage').className, 'text-[11px] font-black mt-1.5 text-rose-600');
  assert.equal(strip(hint(r, 'cottage').innerHTML), 'נשמר — ₪5.00 בקופה · נמוך מהעלות כולל מע״מ (₪8.26)'); assert.match(hint(r, 'cottage').innerHTML, /fa-triangle-exclamation/);
  type(r, { linePos: 'cottage' }, '8.26');
  assert.equal(hint(r, 'cottage').className, 'text-[11px] font-black mt-1.5 text-emerald-700'); assert.equal(strip(hint(r, 'cottage').innerHTML), 'נשמר — ₪8.26 בקופה');
  // בלי מחיר עלות — אין מול מה להשוות
  r.run(`products.find(p => p.id === 'yogurt').price = null`);
  type(r, { linePos: 'yogurt' }, '1');
  assert.equal(strip(hint(r, 'yogurt').innerHTML), 'נשמר — ₪1.00 בקופה');
});

test('5. שורה מקופלת בלי מחיר קופה — השדה גם בה; "הגיע משהו נוסף" — גם שם; Enter בשדה סוגר את המקלדת, Escape עדיין סוגר את החלון', async () => {
  const r = await open();
  click(r, { lineMark: '0:2:ok' }); // יוגורט — בלי מחיר קופה
  let c = row(r, 0, 2);
  assert.doesNotMatch(c, /data-line-mark=/, 'מקופלת');
  assert.equal(strip(c), 'יוגורט טבעי 150 גרם הגיע · 4 יח׳ ' + EDITOR + ' שנה');
  assert.match(c, /<div class="min-w-0 flex-1">/, 'הטקסט תופס את הרוחב — לשדה'); assert.match(c, /data-line-pos="yogurt"/); assert.match(c, /data-line-open="0:2"/);
  type(r, { linePos: 'yogurt' }, '4.5');
  assert.equal(product(r, 'yogurt').posPrice, 4.5);
  click(r, { lineOpen: '0:2' });
  c = row(r, 0, 2);
  assert.match(c, /בקופה: ₪4\.50/); assert.doesNotMatch(c, /data-line-pos/);
  click(r, { lineMark: '0:2:ok' });
  c = row(r, 0, 2);
  assert.equal(strip(c), 'יוגורט טבעי 150 גרם הגיע · 4 יח׳ בקופה ₪4.50 שנה'); assert.match(c, /<div class="min-w-0">/, 'עם מחיר — כמו קודם');
  // "לא הגיע" — גם מקופלת עם השדה
  click(r, { lineMark: '1:1:none' }); // שמנת — בלי מחיר קופה
  const d = row(r, 1, 1);
  assert.equal(strip(d), 'שמנת חמוצה 15% 200 מ״ל לא הגיע · 0 מתוך 2 ' + EDITOR + ' שנה'); assert.match(d, /data-line-pos="cream"/);
  // "הגיע משהו נוסף" — הכרטיס הצהוב עם השדה, ואחרי הקלדה וציור — המחיר
  click(r, { extraAdd: 'pudding' });
  let x = card(r, 'lineExtra_0');
  assert.equal(strip(x), 'לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם ' + EDITOR + ' 7290000000046 · ₪4.00 ליח׳ יח׳ הגיעו התקבלו 1 · עודף 1 הסר');
  assert.match(x, /data-line-pos="pudding"/);
  type(r, { linePos: 'pudding' }, '6');
  assert.equal(product(r, 'pudding').posPrice, 6);
  r.run('renderReceiptLineRows()');
  x = card(r, 'lineExtra_0');
  assert.match(x, /בקופה: ₪6\.00/); assert.doesNotMatch(x, /data-line-pos/);
  // Enter בשדה — blur (המקלדת נסגרת), בלי לסגור את החלון; Escape — כמו קודם
  const keydown = r.events.get('receiptQuantityModal:keydown');
  let blurred = 0, prevented = 0;
  keydown({ key: 'Enter', target: { dataset: { linePos: 'cottage' }, blur: () => blurred++ }, preventDefault: () => prevented++ });
  assert.equal(blurred, 1); assert.equal(prevented, 1);
  assert.equal(r.run(`!$('receiptQuantityModal').classList.contains('hidden')`), true, 'החלון פתוח');
  keydown({ key: 'Enter', target: { dataset: { lineGot: '0:1' }, blur: () => blurred++ }, preventDefault: () => prevented++ });
  assert.equal(blurred, 1, 'Enter בשדה אחר — כלום');
  keydown({ key: 'Escape', target: { dataset: {} } });
  assert.equal(r.run(`$('receiptQuantityModal').classList.contains('hidden')`), true, 'Escape סוגר');
});

test('6. הגרסה עלתה ל-417, כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '417'/);
  assert.match(html, /APP_VERSION_LABEL = 'v' \+ APP_VERSION \+ '_line_clear'/);
  assert.match(html, /<title>הזמנות יטבתה - v417 בדיקה שורה-שורה מיד, גם בלי תעודה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v417 בדיקה שורה-שורה מיד, גם בלי תעודה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v417/);
});
