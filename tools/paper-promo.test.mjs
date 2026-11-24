// v418 — מבצע שבתעודה ואינו במערכת: כתוב על המוצר, עם "פתח מבצע" — בקליטה ובתעודה השמורה. בעל העסק, 15.11.2026 (תעודה 407300217817,
// "ממרח אבוקדו אחלה 200": בנייר 8 × ₪11.89 = ₪95.12 וחיוב של ₪57.07 — 40% הנחה; במערכת המבצע האחרון על המוצר נגמר ב-31.10):
// "יש מבצע בתעודה שלא קיים במערכת. זה לא הציג את זה בצורה ברורה גם במהלך קליטת התעודה וגם עכשיו אחרי שקלטתי את התעודה. צריך להיות
// מוצג על המוצר: בתעודה קיים מבצע כזה וכזה עם כזה אחוז הנחה, וכפתור 'פתח מבצע' — זה לא קיים במערכת, פתח אותו עכשיו במהירות, אפילו
// עוד במהלך הקליטה. ואם המשתמש לא פתח במהלך הקליטה — אז אחרי שהיא נסגרה."
// נתונים מומצאים עם המספרים של השורה ההיא: תעודה של 4 שורות — חלב 12, קוטג׳ 6, שוקו 12 (15% — מבצע שקיים במערכת) וממרח אבוקדו 8
// (40% — בנייר בלבד). במערכת שלושה מבצעים בתוקף ב-15.11 (שלושתם 1.11–30.11), ומבצע ישן על האבוקדו שנגמר ב-31.10.
// מה שנבדק:
// 1. הזיהוי בקליטה (receiptPaperPromos): רק האבוקדו, 40%, עם המספרים מהנייר; האחוז (paperPromoPct); ומה אינו "מבצע שלא קיים במערכת" —
//    מחיר מודפס שאינו מחיר המאגר, בלי הנחה מודפסת, מבצע שכבר קיים באותו יום, שורות שאינן מסכימות, ושורה שלא נבדקה.
// 2. הבדיקה שורה-שורה: ההודעה והכפתור על שורת המוצר — פתוחה ומקופלת; שורות אחרות בדיוק כמו ב-417; הכרטיס שמעל המצלמה.
// 3. החלון "פתח מבצע": ממולא מראש (40%, התקופה של שאר המבצעים, שם המוצר); בדיקת השדות; אזהרה ו"פתח בכל זאת"; "ביטול".
// 4. "פתח מבצע" מהרשימה, בזמן הקליטה: המבצע נשמר, ההודעה מתחלפת באישור, הסימונים לא משתנים — והקליטה נשמרת בדיוק כמו קליטה
//    שבה המבצע היה קיים מראש (שורת מבצע 40%, "אומתה", בלי ממצא מחיר).
// 5. בלי לפתוח: מסך ההשוואה אומר זאת (בדיקת המחירים והתוצאות), כפתור אחד "המשך בלי לפתוח את המבצע"; חלון הסיכום; ו"פתח מבצע"
//    מחלון הסיכום וממסך ההשוואה — חוזרים ל"הכול תואם — המשך", והשורה נקלטת כמבצע.
// 6. התעודה השמורה: המשפט, "מה לעשות עכשיו", ההודעה על שורת המוצר, הקופסה הסגולה, ובלי קופסת הפרשים ריקה; "פתח מבצע" — הממצא
//    נחתם, הסטטוס השמור נסגר, שום שורה שמורה לא משתנה; החתימה שורדת את מחיקת המבצע; תעודה נוספת מאותה תקופה נסגרת איתה.
// 7. הזיהוי בתעודה שמורה (savedReceiptPaperPromos): תעודה ישנה בלי בדיקת מחירים — לפי הכוכבית; ומה אינו כזה.
// 8. התקופה (paperPromoPeriod): של שאר המבצעים; החודש של התעודה; בלי להיכנס למבצע אחר של אותו מוצר; והאזהרה על חפיפה.
// 9. שורה שהקריאות לא הסכימו עליה (מחכה לאישור העובד): אותו כרטיס שאלה, עם ההודעה ו"פתח מבצע"; אחרי האישור ביד — הכרטיס הפתוח.
// 10. טלפון שהקליטה אינה שלו כרגע: המבצע נפתח (הוא שייך למאגר), המסך מחושב מחדש — והקליטה עצמה אינה נערכת מכאן.
// 11. הרשימה אינה מריצה את בדיקת המחירים המלאה בכל סימון: המבצעים שלה מחושבים פעם אחת, ושוב רק כשמבצע או מחיר במאגר משתנים.
// 12. הגרסה.
// הרצה: node --test tools/paper-promo.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5, posPrice: 6.9 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7, posPrice: 9.9 },
  { id: 'choco', name: 'שוקו 1 ליטר', code: '22', barcode: '7290000000022', price: 8.86, posPrice: 12.9 },
  { id: 'avocado', name: 'ממרח אבוקדו 200', code: '39', barcode: '7290000000039', price: 11.89, posPrice: 19.9, boxSize: 8 },
  { id: 'tahini', name: 'טחינה 400 גרם', code: '46', barcode: '7290000000046', price: 8.17, posPrice: 12.9 },
  { id: 'salad', name: 'סלט כרוב 400 גרם', code: '53', barcode: '7290000000053', price: 7.78, posPrice: 11.9 }
];
const NOV = { start: '2026-11-01', end: '2026-11-30', minUnit: 'unit', cartonSize: null, type: 'receipt' };
const promos = [
  { id: 'p-choco', name: 'משקאות חלב ליטר', pct: 15, minQty: 12, productIds: ['choco'], ...NOV },
  { id: 'p-tahini', name: 'טחינה 400', pct: 18, minQty: 6, productIds: ['tahini'], ...NOV },
  { id: 'p-salad', name: 'סלטי 400', pct: 15, minQty: 6, productIds: ['salad'], ...NOV },
  { id: 'p-avocado-oct', name: 'מטבלים אבוקדו', pct: 18, minQty: 8, productIds: ['avocado'], ...NOV, start: '2026-10-04', end: '2026-10-31' }
];
const AVOCADO_PROMO = { id: 'p-avocado-nov', name: 'ממרח אבוקדו 200', pct: 40, minQty: 1, productIds: ['avocado'], ...NOV };
const r2 = n => Math.round(n * 100) / 100;
// שורה בנייר כמו שיטבתה מדפיסה: מחיר היחידה המלא, סכום ברוטו, וסכום נטו אחרי ההנחה — עם כוכבית ליד שורת מבצע.
// agreed (ברירת המחדל, כמו בתעודה ההיא): השורה כפי שהשירות מחזיר אותה כשהקריאות הסכימו עליה (model_consensus, modelVerification
// "verified") — אז פער מחיר נחשב "אומת מול הנייר" בלי שאלה. agreed: false — שורה בלי הסכמה, שמחכה לאישור העובד.
const EVIDENCE = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber', 'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
function paper(spec, { number = '407300217817', agreed = true, catalog = products } = {}) {
  const rows = spec.map(([id, q, pct = 0, unit], i) => { const p = catalog.find(x => x.id === id), price = unit == null ? p.price : unit, gross = r2(q * price);
    const row = { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: price, grossLineTotalExVat: gross, lineTotalExVat: r2(gross * (1 - pct / 100)), lineDiscountExVat: null, promotionText: pct ? '*' : null, confidence: .99 };
    if (agreed) {
      row.barcodeMatchMethod = 'model_consensus';
      row.modelVerification = { version: 1, status: 'verified', selectedRead: 2, strongSelected: true, identity: { productId: p.id, barcode: p.barcode }, identitySupport: [0, 1], issues: [],
        evidence: Object.fromEntries(EVIDENCE.map(k => [k, row[k] ?? null])) };
    }
    return row; });
  const net = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-15', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: net, netToChargeExVat: net, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: net, promoDiscountExVat: 0, documentDiscountExVat: null, warnings: [] };
}
const NOTE = [['milk', 12], ['cottage', 6], ['choco', 12, 15], ['avocado', 8, 40]];
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
async function scan(papers, { catalog = products, system = promos, ...opts } = {}) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products: catalog, promos: structuredClone(system), items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-15'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    runCloudTaskSilent = async (label, task) => { testWrites.push({ label, ...structuredClone(task) }); return true; };
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) };
    $('scanVideo').play = async () => {};
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודה נקראה ואומתה: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  return c;
}
const note = ({ agreed = true, ...opts } = {}) => scan([paper(NOTE, { agreed })], opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
const marks = r => json(r, 'receiptQuantityReview').docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
function row(r, di, li) {
  const h = rows(r), i = h.indexOf('<div id="lineCheck_' + di + '_' + li + '"');
  assert.ok(i >= 0, 'שורה ' + di + ':' + li + ' קיימת');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i)].filter(x => x > 0);
  return h.slice(i, ends.length ? Math.min(...ends) : undefined);
}
const markAll = (r, n = NOTE.length) => { for (let k = 0; k < n; k++) click(r, { lineMark: '0:' + k + ':ok' }); };
// החלון "פתח מבצע"
const sheet = r => json(r, 'paperPromoSheet');
const sheetShown = r => !r.run(`$('paperPromoModal').classList.contains('hidden')`);
const sheetHtml = r => r.run(`$('paperPromoBody').innerHTML`);
const sheetType = (r, field, value) => r.run(`paperPromoSheetInput({ target: { dataset: { ppField: ${JSON.stringify(field)} }, value: ${JSON.stringify(value)} } })`);
const sheetClick = async (r, action) => { r.run(`paperPromoSheetClick({ target: { closest: () => ({ dataset: { ppAction: ${JSON.stringify(action)} } }) } })`); await settle(); };
const sheetMsg = r => strip(r.run(`$('paperPromoMsg').innerHTML`)).replace(/&quot;/g, '"');
const saveLabel = r => r.run(`$('paperPromoSave').textContent`);
const promoWrites = r => r.writes.filter(w => w.op === 'set' && w.path.includes('promos'));
const app = r => r.run('app.innerHTML');
const summaryShown = r => !r.run(`$('receiptSummaryModal').classList.contains('hidden')`);
const NOTICE = /<div data-paper-promo="avocado" class="mt-2 rounded-xl border-2 border-rose-300 bg-white p-2\.5 text-right"><div class="text-sm font-black text-rose-700"><i class="fa-solid fa-tag" aria-hidden="true"><\/i> בתעודה קיים מבצע: 40% הנחה<\/div><div class="text-xs font-bold text-slate-700 mt-0\.5">₪7\.13 ליח׳ במקום ₪11\.89 · המבצע לא קיים במערכת<\/div><button type="button" data-role="paper-promo-open" data-id="avocado" aria-label="פתח מבצע: ממרח אבוקדו 200" class="btn-tap w-full min-h-\[44px\] mt-2 rounded-xl bg-rose-600 text-white font-black text-sm flex items-center justify-center gap-2"><i class="fa-solid fa-plus" aria-hidden="true"><\/i> פתח מבצע<\/button><\/div>/;
const COMPACT = /<div data-paper-promo="avocado" class="mt-1\.5 rounded-xl border-2 border-rose-300 bg-white px-2\.5 py-1\.5 flex items-center justify-between gap-2 text-right"><div class="min-w-0"><div class="text-\[13px\] font-black text-rose-700 leading-tight"><i class="fa-solid fa-tag" aria-hidden="true"><\/i> בתעודה קיים מבצע 40%<\/div><div class="text-\[11px\] font-bold text-slate-600 leading-tight mt-0\.5">₪7\.13 במקום ₪11\.89 · לא קיים במערכת<\/div><\/div><button type="button" data-role="paper-promo-open" data-id="avocado"( data-receipt="[^"]+")? aria-label="פתח מבצע: ממרח אבוקדו 200" class="btn-tap shrink-0 min-h-\[44px\] px-3 rounded-lg bg-rose-600 text-white text-xs font-black whitespace-nowrap">פתח מבצע<\/button><\/div>/;
// הקליטה עד התעודה השמורה (כמו ב-line-check-pending): "סיום", ההחלה אם היא עוד לא נעשתה לבד, ו"אשר וקלוט"
async function finishAndSave(r) {
  assert.equal(r.run('finishReceiptLineCheck()'), true); await settle();
  if (!r.run('!!pendingReceipt')) { r.click('ai-apply'); await settle(); }
  assert.ok(r.run('!!pendingReceipt'), json(r, 'aiScanEvaluation && aiScanEvaluation.errors')?.join(';'));
  await r.run('confirmReceipt()'); await settle();
  const w = r.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
  assert.ok(w, 'התעודה נשמרה');
  return { id: w.path[w.path.length - 1], ...w.data };
}
// התעודה השמורה במסך ההיסטוריה (בלי קליטה פתוחה)
function history(r, list) {
  r.context.testReceipts = structuredClone(list);
  r.run(`receipts = testReceipts; returns = []; currentView = 'receiptsHistory'; renderReceiptsHistory();`);
}
function card(r, id) {
  const h = app(r), a = h.indexOf('<details data-receipt-card="' + id + '"');
  assert.ok(a >= 0, 'הכרטיס של ' + id);
  const next = h.indexOf('<details data-receipt-card="', a + 10);
  return h.slice(a, next > 0 ? next : undefined);
}
const plain = (r, id) => json(r, `receiptPlainStatus(receipts.find(x => x.id === ${JSON.stringify(id)}))`);

test('1. הזיהוי בקליטה: רק המוצר שהנייר נותן בו הנחה שאין במערכת, עם האחוז והמספרים מהנייר; ומה אינו "מבצע שלא קיים במערכת"', async () => {
  const r = await note();
  // האבוקדו: 8 × ₪11.89 = ₪95.12 בנייר, חיוב ₪57.07 — 40%. השוקו (15%) קיים במערכת ותואם; חלב וקוטג׳ במחיר מלא.
  assert.deepEqual(json(r, 'receiptPaperPromos()'), [{ productId: 'avocado', name: 'ממרח אבוקדו 200', pct: 40, base: 11.89, charged: 7.13375, qty: 8, saving: 38.05, day: '2026-11-15', lastDay: '2026-11-15' }]);
  assert.deepEqual(json(r, `receiptPriceAudit().rows.map(x => [x.productId, x.result, x.promo ? x.promo.pct : 0])`), [['milk', 'match', 0], ['cottage', 'match', 0], ['choco', 'match', 15], ['avocado', 'difference', 0]]);
  // האחוז: מספר עגול קודם, ואחריו עשירית ומאית — מה שמשחזר את המחיר שחויב; פחות מ-2 אגורות, או מחיר גבוה מהמאגר — לא מבצע
  assert.deepEqual(json(r, `[paperPromoPct(11.89, 57.07 / 8), paperPromoPct(8.86, 90.37 / 12), paperPromoPct(8.17, 6.7), paperPromoPct(10, 8.33), paperPromoPct(100, 87.75),
    paperPromoPct(10, 9.99), paperPromoPct(10, 10), paperPromoPct(10, 10.5), paperPromoPct(0, 5), paperPromoPct(10, 0), paperPromoPct(10, 0.2)]`),
    [40, 15, 18, 16.7, 12.25, null, null, null, null, null, null]);
  // שורה אחת של בדיקת המחירים — מה שהופך אותה ל"מבצע בתעודה שלא קיים במערכת", ומה שלא
  const base = { productId: 'avocado', name: 'ממרח אבוקדו 200', capability: 'checkable', result: 'difference', promo: null, catalogBasePrice: 11.89, comparisonPrice: 7.13375, originalUnitPrice: 11.89, quantity: 8, date: '2026-11-15' };
  const info = over => json(r, `paperPromoRowInfo(${JSON.stringify({ ...base, ...over })})`);
  assert.deepEqual(info({}), { pct: 40, base: 11.89, charged: 7.13375, qty: 8, day: '2026-11-15' });
  assert.equal(info({ originalUnitPrice: 7.13, comparisonPrice: 7.13 }), null, 'המחיר המודפס עצמו נמוך מהמאגר, בלי הנחה בשורה — שינוי מחיר, לא מבצע');
  assert.equal(info({ originalUnitPrice: 12.5, comparisonPrice: 7.5 }), null, 'מחיר מודפס שאינו מחיר המאגר — קודם מעדכנים מחיר');
  assert.equal(info({ originalUnitPrice: null }), null, 'בלי מחיר יחידה מודפס אין ראיה להנחה');
  assert.equal(info({ comparisonPrice: 11.89, result: 'match' }), null);
  assert.equal(info({ comparisonPrice: 12.4 }), null, 'חיוב גבוה מהמאגר');
  assert.equal(info({ capability: 'partial' }), null, 'שורה שלא נבדקה');
  assert.equal(info({ promo: { id: 'x', pct: 18 } }), null, 'מבצע של המערכת חל על השורה — פער מול מבצע קיים, לא מבצע חסר');
  assert.equal(info({ date: '2026-10-20' }), null, 'ב-20.10 היה למוצר מבצע במערכת (18%, מינימום 8) — עורכים אותו, לא פותחים חדש');
  assert.equal(info({ date: null }), null);
  // מוצר בשתי שורות (שתי תעודות): רק כשהן מסכימות על האחוז — והכמות והחיסכון של שתיהן יחד
  const two = (second) => json(r, `receiptPaperPromos({ state: 'ready', rows: ${JSON.stringify([base, { ...base, ...second }])} })`);
  assert.deepEqual(two({ quantity: 16, date: '2026-11-17' }), [{ productId: 'avocado', name: 'ממרח אבוקדו 200', pct: 40, base: 11.89, charged: 7.13375, qty: 24, saving: 114.15, day: '2026-11-15', lastDay: '2026-11-17' }]);
  assert.deepEqual(two({ comparisonPrice: 9.75 }), [], 'שורה ב-40% ושורה ב-18% — לא מציעים אחוז');
  assert.deepEqual(two({ comparisonPrice: 11.89, result: 'match' }), [], 'שורה אחת במחיר מלא');
  assert.deepEqual(json(r, `receiptPaperPromos({ state: 'running', rows: ${JSON.stringify([base])} })`), [], 'בזמן הפענוח — עוד לא');
});

test('2. הבדיקה שורה-שורה: ההודעה ו"פתח מבצע" על שורת המוצר — פתוחה ומקופלת; שאר השורות כמו קודם; הכרטיס שמעל המצלמה אומר זאת', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()');
  const open = row(r, 0, 3);
  // מתחת לפרטי המוצר והמחיר, מעל כפתורי הסימון
  assert.match(open, NOTICE);
  assert.ok(open.indexOf('data-paper-promo=') > open.indexOf('₪11.89 ליח׳') && open.indexOf('data-paper-promo=') < open.indexOf('data-line-mark="0:3:ok"'));
  assert.equal(strip(open), 'שורה 4 בתעודה ממרח אבוקדו 200 בקופה: ₪19.90 7290000000039 · ₪11.89 ליח׳ 8 יח׳ בתעודה ארגז אחד של 8 בתעודה קיים מבצע: 40% הנחה ₪7.13 ליח׳ במקום ₪11.89 · המבצע לא קיים במערכת פתח מבצע הגיע 8 אחרת לא הגיע');
  assert.equal((rows(r).match(/data-paper-promo=/g) || []).length, 1, 'רק על המוצר הזה — לא על השוקו (המבצע שלו קיים במערכת) ולא על השאר');
  assert.equal(strip(row(r, 0, 2)), 'שורה 3 בתעודה שוקו 1 ליטר בקופה: ₪12.90 7290000000022 · ₪8.86 ליח׳ 12 יח׳ בתעודה הגיע 12 אחרת לא הגיע');
  // מקופלת ("הגיע" / "לא הגיע"): מה שהגיע ו"שנה" למעלה, וההודעה המקוצרת מתחת, ברוחב מלא
  click(r, { lineMark: '0:3:ok' }); click(r, { lineMark: '0:0:ok' });
  const folded = row(r, 0, 3);
  assert.match(folded, /^<div id="lineCheck_0_3" class="rounded-2xl border-2 px-3 py-2 mb-2\.5 border-emerald-300 bg-emerald-50"><div class="flex items-center justify-between gap-2"><div class="min-w-0">/);
  assert.match(folded, COMPACT);
  assert.match(folded, /שנה<\/button><\/div><div data-paper-promo="avocado"/, 'אחרי "שנה", בקומה משלה');
  assert.equal(strip(folded), 'ממרח אבוקדו 200 הגיע · 8 יח׳ בקופה ₪19.90 שנה בתעודה קיים מבצע 40% ₪7.13 במקום ₪11.89 · לא קיים במערכת פתח מבצע');
  click(r, { lineMark: '0:3:none' });
  assert.match(row(r, 0, 3), /^<div id="lineCheck_0_3" class="rounded-2xl border-2 px-3 py-2 mb-2\.5 border-rose-300 bg-rose-50"><div class="flex items-center justify-between gap-2">/);
  assert.match(row(r, 0, 3), COMPACT);
  // שורה מקופלת בלי מבצע כזה — בדיוק כמו ב-417
  assert.match(row(r, 0, 0), /^<div id="lineCheck_0_0" class="rounded-2xl border-2 px-3 py-2 mb-2\.5 flex items-center justify-between gap-2 border-emerald-300 bg-emerald-50"><div class="min-w-0"><div class="font-black text-slate-800 truncate">חלב 3% בקרטון 1 ליטר<\/div>/);
  assert.match(row(r, 0, 0), /שנה<\/button><\/div>$/);
  // "שנה" — נפתחת שוב עם ההודעה המלאה; "אחרת" — גם
  click(r, { lineOpen: '0:3' });
  assert.match(row(r, 0, 3), NOTICE);
  click(r, { lineMark: '0:3:qty' });
  assert.match(row(r, 0, 3), NOTICE);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות', 'ההודעה אינה סימון ואינה משנה את המונה');
  // הכרטיס שמעל המצלמה: נאמר, בלי כפתור — "פתח מבצע" על השורה ברשימה, שאליה חוזרים אחרי הסימון
  r.events.get('receiptLineScan:click')(); await settle();
  r.run(`onScanned('7290000000039')`);
  const scanCard = r.run(`$('scanLineCard').innerHTML`);
  assert.match(scanCard, /<div data-paper-promo-info="avocado" class="text-xs font-black text-rose-700 mt-1"><i class="fa-solid fa-tag" aria-hidden="true"><\/i> בתעודה קיים מבצע: 40% הנחה — לא קיים במערכת\. "פתח מבצע" בשורה שברשימה\.<\/div>/);
  assert.doesNotMatch(scanCard, /paper-promo-open/);
  r.run('closeScanner()');
  r.events.get('receiptLineScan:click')(); await settle();
  r.run(`lastScanTime = 0; onScanned('7290000000008')`);
  assert.doesNotMatch(r.run(`$('scanLineCard').innerHTML`), /data-paper-promo/, 'מוצר אחר — בלי');
});

test('3. החלון "פתח מבצע": ממולא מראש מהנייר; שדה ריק ותאריכים הפוכים נעצרים; אחוז אחר — אזהרה ו"פתח בכל זאת"; "ביטול" לא שומר', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()');
  assert.equal(sheetShown(r), false);
  click(r, { role: 'paper-promo-open', id: 'avocado' });
  assert.equal(sheetShown(r), true);
  // 40% מהנייר; 1.11–30.11 — התקופה ששלושת המבצעים שבתוקף ב-15.11 חולקים (לא "מהיום"); והשם של המוצר
  const s = sheet(r);
  assert.deepEqual([s.productId, s.receiptId, s.pct, s.start, s.end, s.name, s.from], ['avocado', null, '40', '2026-11-01', '2026-11-30', 'ממרח אבוקדו 200', 'promos']);
  const h = sheetHtml(r);
  assert.equal(strip(h), 'פתיחת מבצע מהתעודה ממרח אבוקדו 200 בתעודה: 8 יח׳ ב-₪7.13 ליח׳ במקום ₪11.89 40% הנחה · ₪38.05 פחות בשורה אחוז הנחה % מתאריך עד תאריך כמו שאר המבצעים שבתוקף ביום התעודה (15.11.2026) — אפשר לשנות. שם המבצע המבצע נפתח למוצר הזה בלבד, בלי מינימום. מוצרים נוספים, מינימום ושלט — במסך המבצעים. ביטול פתח מבצע');
  assert.match(h, /<input id="paperPromoPct" data-pp-field="pct" type="text" inputmode="decimal" autocomplete="off" value="40"/);
  assert.match(h, /<input id="paperPromoStart" data-pp-field="start" type="date" value="2026-11-01"/);
  assert.match(h, /<input id="paperPromoEnd" data-pp-field="end" type="date" value="2026-11-30"/);
  assert.match(h, /<input id="paperPromoName" data-pp-field="name" type="text" autocomplete="off" value="ממרח אבוקדו 200"/);
  // שדה חסר / תאריכים הפוכים — נעצר, עם הסיבה; ההקלדה הבאה מנקה את ההודעה (בלי לצייר מחדש את השדות)
  sheetType(r, 'pct', '');
  await sheetClick(r, 'save');
  assert.equal(sheetMsg(r), 'מלא אחוז הנחה, תאריך התחלה ותאריך סיום'); assert.equal(promoWrites(r).length, 0); assert.equal(sheetShown(r), true);
  sheetType(r, 'pct', '40'); assert.equal(sheetMsg(r), '');
  for (const bad of ['0', '100', 'abc', '-5']) { sheetType(r, 'pct', bad); await sheetClick(r, 'save'); assert.equal(sheetMsg(r), 'מלא אחוז הנחה, תאריך התחלה ותאריך סיום', bad); }
  sheetType(r, 'pct', '40'); sheetType(r, 'end', '2026-10-01');
  await sheetClick(r, 'save');
  assert.equal(sheetMsg(r), 'תאריך הסיום חייב להיות אחרי ההתחלה');
  sheetType(r, 'end', '');
  await sheetClick(r, 'save');
  assert.equal(sheetMsg(r), 'מלא אחוז הנחה, תאריך התחלה ותאריך סיום');
  sheetType(r, 'end', '2026-11-30');
  // אחוז שאינו נותן את המחיר שבתעודה, ותקופה שאינה כוללת את יום התעודה — אזהרה, לא חסימה: הלחיצה הבאה שומרת
  sheetType(r, 'pct', '35'); sheetType(r, 'start', '2026-11-20');
  await sheetClick(r, 'save');
  assert.equal(sheetMsg(r), '35% לא נותן את המחיר שבתעודה (₪7.13 ליח׳) — בתעודה ההנחה היא 40%, והשורה תישאר הפרש מחיר. יום התעודה (15.11.2026) אינו בתוך התקופה — המבצע לא יחול על התעודה הזאת. אפשר לתקן, או ללחוץ "פתח בכל זאת".');
  assert.equal(saveLabel(r), 'פתח בכל זאת'); assert.equal(promoWrites(r).length, 0);
  // תיקון בשדה — האזהרה יורדת, והכפתור חוזר ל"פתח מבצע"
  sheetType(r, 'pct', '40,0'); sheetType(r, 'start', '2026-11-01');
  assert.equal(sheetMsg(r), ''); assert.equal(saveLabel(r), 'פתח מבצע'); assert.equal(sheet(r).force, false);
  // "ביטול" — החלון נסגר, שום דבר לא נשמר, וההודעה נשארת על השורה
  await sheetClick(r, 'cancel');
  assert.equal(sheetShown(r), false); assert.equal(r.run('paperPromoSheet'), null); assert.equal(promoWrites(r).length, 0);
  assert.match(row(r, 0, 3), NOTICE);
  // לחיצה על כפתור של מבצע שכבר אינו חסר (נפתח ממכשיר אחר בינתיים) — בלי חלון, והרשימה מתעדכנת
  r.context.late = structuredClone(AVOCADO_PROMO); r.run('promos.push(late)');
  click(r, { role: 'paper-promo-open', id: 'avocado' });
  assert.equal(sheetShown(r), false);
  assert.equal(progress(r), 'המבצע כבר קיים במערכת, או שנתוני התעודה השתנו');
  assert.doesNotMatch(rows(r), /data-paper-promo=/);
});

test('4. "פתח מבצע" מהרשימה, בזמן הקליטה: המבצע נשמר, השורה מאשרת, הסימונים נשארים — והקליטה נשמרת כמו קליטה שבה המבצע היה קיים מראש', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' }); click(r, { lineMark: '0:1:qty' }); r.run(`receiptLineCheckInput({ target: { dataset: { lineGot: '0:1' }, value: '5' } })`);
  const before = marks(r), key = r.run('receiptQuantityReview.key');
  click(r, { role: 'paper-promo-open', id: 'avocado' });
  sheetType(r, 'name', '  אבוקדו נובמבר ');
  await sheetClick(r, 'save');
  // מבצע בתעודה, למוצר הזה בלבד, בלי מינימום — אותו מבנה שמסך המבצעים שומר
  const w = promoWrites(r);
  assert.equal(w.length, 1);
  const id = w[0].path[w[0].path.length - 1];
  assert.match(id, /^promo_/); assert.equal(w[0].operationId, id);
  assert.deepEqual(w[0].data, { name: 'אבוקדו נובמבר', pct: 40, start: '2026-11-01', end: '2026-11-30', minQty: 1, minUnit: 'unit', cartonSize: null, productIds: ['avocado'], type: 'receipt', operationId: id });
  assert.deepEqual(json(r, `promos.find(p => p.id === ${JSON.stringify(id)})`), { id, ...w[0].data }, 'העותק המקומי — מיד, בלי לחכות לסנכרון');
  assert.equal(sheetShown(r), false); assert.equal(r.run('paperPromoSheet'), null);
  // ההודעה בראש החלון (הודעה רגילה נשארת מתחתיו), והשורה: אישור במקום ההודעה והכפתור
  assert.equal(progress(r), 'המבצע נפתח: אבוקדו נובמבר · 40% ✓');
  assert.deepEqual(json(r, 'receiptPaperPromos()'), []);
  assert.doesNotMatch(rows(r), /data-paper-promo=|paper-promo-open/);
  assert.match(row(r, 0, 3), /<div data-paper-promo-done="avocado" class="mt-1\.5 rounded-xl border border-emerald-300 bg-white px-2\.5 py-1\.5 text-\[13px\] font-black text-emerald-800 text-right"><i class="fa-solid fa-circle-check" aria-hidden="true"><\/i> המבצע נפתח במערכת: 40% · 1\.11\.2026 עד 30\.11\.2026<\/div><div class="grid grid-cols-\[1fr_auto_auto\]/);
  assert.equal((rows(r).match(/data-paper-promo-done=/g) || []).length, 1);
  // הבדיקה עצמה לא השתנתה: אותם סימונים, אותה תעודה (המפתח), ובדיקת המחירים רואה עכשיו "מבצע בתוקף"
  assert.deepEqual(marks(r), before); assert.equal(r.run('receiptQuantityReview.key'), key);
  assert.deepEqual(json(r, `receiptPriceAudit().rows.filter(x => x.productId === 'avocado').map(x => [x.result, x.promo.pct, x.matchedForms])`), [['match', 40, ['מבצע בתוקף']]]);
  // גם מקופלת — האישור נשאר
  click(r, { lineMark: '0:3:ok' });
  assert.match(row(r, 0, 3), /שנה<\/button><\/div><div data-paper-promo-done="avocado"/);
  click(r, { lineMark: '0:1:ok' }); click(r, { lineMark: '0:2:ok' });
  const saved = await finishAndSave(r);
  // מול קליטה של אותה תעודה כשהמבצע כבר היה במערכת
  const b = await note({ system: promos.concat([{ ...AVOCADO_PROMO, id }]) });
  b.run('startReceiptLineCheck()'); markAll(b);
  assert.doesNotMatch(rows(b), /data-paper-promo/);
  const expected = await finishAndSave(b);
  assert.deepEqual(saved.items, expected.items, 'אותן שורות בדיוק');
  assert.deepEqual(saved.items.find(l => l.productId === 'avocado'), { productId: 'avocado', name: 'ממרח אבוקדו 200', barcode: '7290000000039', qty: 8, unitPrice: 7.13375, basePrice: 11.89, lineTotal: 57.07, promoPct: 40 });
  assert.equal(saved.status, 'ok'); assert.equal(expected.status, 'ok');
  assert.deepEqual(saved.aiAudit.findings.filter(f => f.type !== 'printed_promo'), [], 'בלי ממצא מחיר');
  assert.equal(saved.aiAudit.hasDiscrepancy, false);
  assert.deepEqual([saved.totalExVat, saved.noteTotalInc, saved.supplierCreditClaim], [expected.totalExVat, expected.noteTotalInc, expected.supplierCreditClaim]);
});

test('5. בלי לפתוח: מסך ההשוואה אומר מה הבעיה, עם כפתור אחד להמשך; "פתח מבצע" מחלון הסיכום וממסך ההשוואה מחזיר ל"הכול תואם"', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()'); markAll(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true); await settle();
  // לא נסגר לבד: יש מה להחליט
  assert.equal(r.run('currentView'), 'reconcile'); assert.equal(r.run('rcStep'), 'ai'); assert.equal(summaryShown(r), false);
  const screen = app(r);
  // בדיקת המחירים שבראש המסך: הכותרת, וכרטיס פתוח למוצר (עד 417: "הבדיקה הושלמה · 1 פערי מחיר נשמרו", מקופל)
  assert.match(screen, /<span role="status" aria-live="polite">בתעודה קיים מבצע שלא קיים במערכת<\/span>/);
  assert.match(screen, /<article data-price-paper-promo="avocado" class="rounded-xl border-2 border-rose-300 p-3 mt-3 bg-white"><div class="font-black text-lg">ממרח אבוקדו 200<\/div><div data-paper-promo="avocado" class="mt-2 /);
  assert.match(screen, /8 יח׳ בתעודה · ₪38\.05 פחות ממחיר המאגר\. בלי המבצע השורה נשמרת כפער מחיר, והתעודה נשארת פתוחה עד שהוא ייפתח\./);
  assert.doesNotMatch(screen, /data-price-reviewed|פערי מחיר שאומתו ונשמרו/, 'השורה אינה מקופלת עוד בין פערי המחיר שאומתו');
  // תוצאות הסריקה: הקבוצה, ראשונה, עם שורה קצרה וכפתור; ובמקום "אלה אכן הבעיות — אשר" — כפתור אחד שאומר מה יקרה
  const group = screen.slice(screen.indexOf('<div data-paper-promo-group'), screen.indexOf('data-role="ai-apply"'));
  assert.match(group, /<i class="fa-solid fa-tags ml-1"><\/i>מבצע בתעודה שלא קיים במערכת<\/div><span class="rounded-full px-2 py-0\.5 text-\[10px\] font-black bg-rose-100 text-rose-800">1<\/span>/);
  assert.match(group, COMPACT);
  assert.match(strip(group), /^מבצע בתעודה שלא קיים במערכת 1 ממרח אבוקדו 200 בתעודה קיים מבצע 40% ₪7\.13 במקום ₪11\.89 · לא קיים במערכת פתח מבצע אחרי "פתח מבצע" השורה נקלטת כמבצע, בלי הפרש מחיר\. בלי המבצע התעודה נקלטת כפתוחה, ואפשר לפתוח אותו אחר כך מכרטיס התעודה\./);
  assert.match(screen, /<button data-role="ai-apply" class="btn-tap w-full bg-white border-2 border-violet-300 text-violet-700 rounded-xl py-3 px-2 leading-tight font-black">המשך בלי לפתוח את המבצע — התעודה תיקלט כפתוחה<\/button>/);
  assert.doesNotMatch(screen, /ai-confirm-findings|אלה אכן הבעיות|סגור תעודה עם החוסרים|הכול תואם — המשך/);
  // ממשיכים בלי המבצע: חלון הסיכום אומר זאת שוב, עם הכפתור
  r.click('ai-apply'); await settle();
  assert.equal(summaryShown(r), true);
  const summary = r.run(`$('rsBody').innerHTML`);
  assert.match(summary, /<div class="font-black">בתעודה קיים מבצע שלא קיים במערכת<\/div><div class="mt-2"><div class="text-sm font-black text-slate-800">ממרח אבוקדו 200<\/div><div data-paper-promo="avocado" class="mt-1\.5 /);
  assert.match(summary, COMPACT);
  assert.match(summary, /נשמר עם הפרשים — התעודה תסומן כפתוחה עד שתתוקן/);
  assert.deepEqual(json(r, `[pendingReceipt.status, pendingReceipt.lines.find(l => l.productId === 'avocado').promoPct]`), ['open', 0]);
  // "פתח מבצע" מחלון הסיכום: החלון של המבצע מעליו; אחרי השמירה הסיכום נסגר, וההשוואה חוזרת לתוצאות — עכשיו "הכול תואם"
  r.events.get('rsBody:click')({ target: { closest: () => ({ dataset: { role: 'paper-promo-open', id: 'avocado' } }) } });
  assert.equal(sheetShown(r), true);
  await sheetClick(r, 'save');
  assert.equal(promoWrites(r).length, 1); assert.equal(sheetShown(r), false);
  assert.equal(summaryShown(r), false, 'הסיכום חושב לפני המבצע'); assert.equal(r.run('pendingReceipt'), null);
  assert.equal(r.run('currentView'), 'reconcile'); assert.equal(r.run('rcStep'), 'ai');
  assert.equal(r.toasts.at(-1), 'המבצע נפתח: ממרח אבוקדו 200 · 40% ✓');
  const after = app(r);
  assert.doesNotMatch(after, /data-paper-promo|paper-promo-open|המשך בלי לפתוח/);
  assert.match(after, /הכול תואם — לא נמצאו חוסר, עודף או בעיית מחיר\/מבצע\./);
  assert.match(after, /<span role="status" aria-live="polite">המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר<\/span>/);
  assert.match(strip(after), /תעודת הספק ₪249\.44 סכום הפריטים שנסרקו ₪249\.44 מאוזן ✓/);
  r.click('ai-apply'); await settle();
  assert.equal(summaryShown(r), true);
  assert.deepEqual(json(r, `[pendingReceipt.status, pendingReceipt.lines.find(l => l.productId === 'avocado')]`),
    ['ok', { productId: 'avocado', name: 'ממרח אבוקדו 200', barcode: '7290000000039', qty: 8, unitPrice: 7.13375, basePrice: 11.89, lineTotal: 57.07, promoPct: 40 }]);
  assert.doesNotMatch(r.run(`$('rsBody').innerHTML`), /data-paper-promo|נשמר עם הפרשים/);

  // ממסך ההשוואה עצמו, לפני ההחלה: גם סרגל הסכומים מתאזן מיד (השורה שנבנתה במחיר המלא מקבלת את מחיר המבצע)
  const b = await note();
  b.run('startReceiptLineCheck()'); markAll(b);
  b.run('finishReceiptLineCheck()'); await settle();
  assert.match(strip(app(b)), /תעודת הספק ₪249\.44 סכום הפריטים שנסרקו ₪287\.49 עודף ₪38\.05/, 'לפני: הפער הוא בדיוק ההנחה');
  b.click('paper-promo-open', 'avocado'); // הכפתור בכרטיס שבבדיקת המחירים / בתוצאות
  assert.equal(sheetShown(b), true);
  await sheetClick(b, 'save');
  assert.equal(b.run('rcStep'), 'ai');
  assert.match(strip(app(b)), /תעודת הספק ₪249\.44 סכום הפריטים שנסרקו ₪249\.44 מאוזן ✓/);
  assert.match(app(b), /הכול תואם — המשך/);
  assert.deepEqual(json(b, `reconcileData.filter(l => l.productId === 'avocado').map(l => [l.promoOn, l.promoPct, Math.round(l.price * 1000) / 1000])`), [[true, 40, 7.134]]);
  b.click('ai-apply'); await settle();
  assert.deepEqual(json(b, `[pendingReceipt.status, pendingReceipt.lines.find(l => l.productId === 'avocado').promoPct, pendingReceipt.lines.find(l => l.productId === 'avocado').lineTotal]`), ['ok', 40, 57.07]);
});

test('6. התעודה השמורה: כתוב על המוצר, עם "פתח מבצע"; אחריו הממצא נחתם והתעודה נסגרת — בלי לשנות שורה שמורה; גם תעודה נוספת מאותה תקופה', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()'); markAll(r);
  const rc = await finishAndSave(r);
  // נשמרה כמו עד היום: פתוחה, עם ממצא "מחיר שונה", והשורה בלי מבצע
  assert.equal(rc.status, 'open');
  assert.deepEqual(rc.aiAudit.findings.filter(f => f.type === 'price'), [{ type: 'price', productId: 'avocado', name: 'ממרח אבוקדו 200', qty: 8, amount: -38.05, expectedPrice: 11.89, paperPrice: 7.13375, text: 'מחיר שונה: ממרח אבוקדו 200 — במערכת ₪11.89, בנייר ₪7.13' }]);
  assert.equal(rc.items.find(l => l.productId === 'avocado').promoPct, 0);
  // תעודה נוספת מה-10.11 עם אותו מוצר באותו מחיר — בלי בדיקת מחירים שמורה, עם הכוכבית שנקראה
  const older = { id: 'rc-older', timestamp: Date.parse('2026-11-10T09:00:00'), date: '2026-11-10', status: 'open', count: 1, totalExVat: 57.07, noteTotalInc: 57.07, noteParts: [{ amount: 57.07, units: 8 }],
    items: [{ productId: 'avocado', name: 'ממרח אבוקדו 200', barcode: '7290000000039', qty: 8, unitPrice: 7.13375, basePrice: 11.89, lineTotal: 57.07, promoPct: 0 }],
    aiAudit: { version: 6, hasDiscrepancy: true, findings: [{ type: 'price', productId: 'avocado', name: 'ממרח אבוקדו 200', qty: 8, amount: -38.05, expectedPrice: 11.89, paperPrice: 7.13375, text: 'מחיר שונה: ממרח אבוקדו 200 — במערכת ₪11.89, בנייר ₪7.13' },
      { type: 'printed_promo', productId: 'avocado', name: 'ממרח אבוקדו 200', text: 'מבצע מודפס ליד ממרח אבוקדו 200: *' }] } };
  history(r, [rc, older]);
  assert.deepEqual(json(r, `savedReceiptPaperPromos(receipts[0])`), [{ productId: 'avocado', name: 'ממרח אבוקדו 200', pct: 40, base: 11.89, charged: 7.13375, qty: 8, saving: 38.05, day: '2026-11-15', lastDay: '2026-11-15' }]);
  // המשפט (גם בסיכום שבראש קובץ הגיבוי) והפעולה
  assert.deepEqual(plain(r, rc.id), { state: 'paper_promo', text: 'בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40%', action: 'פתח מבצע', role: 'paper-promo-open', open: true, productId: 'avocado' });
  assert.deepEqual(json(r, `backupPlainSummary({ collections: { receipts: { [receipts[0].id]: receipts[0] } } }).receipts.map(x => [x.state, x.status, x.action])`), [['paper_promo', 'בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40%', 'פתח מבצע']]);
  const c = card(r, rc.id);
  assert.match(c, /data-plain-status="paper_promo">בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40%<\/div>/);
  // "מה לעשות עכשיו": הכפתור נושא את המוצר ואת התעודה
  assert.match(c, new RegExp('<div class="mt-2 bg-rose-50 border-2 border-rose-300 rounded-xl p-3" data-plain-action="paper_promo"><div class="text-\\[11px\\] font-black text-rose-600">מה לעשות עכשיו</div><div class="font-black text-slate-900 text-sm mt-0\\.5">בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40%</div><button data-role="paper-promo-open" data-id="avocado" data-receipt="' + rc.id + '" class="btn-tap w-full mt-2 bg-rose-600 text-white rounded-xl py-2\\.5 font-black text-sm">פתח מבצע</button></div>'));
  // על שורת המוצר; שורה רגילה — בדיוק כמו קודם
  assert.match(c, /<div class="py-1 border-b border-slate-100 last:border-0"><div class="flex items-center justify-between gap-2"><div class="min-w-0"><div class="text-sm font-bold text-slate-700 truncate">ממרח אבוקדו 200<\/div><div class="text-\[11px\] text-slate-400">8 × ₪7\.13<\/div><\/div><div class="text-sm font-black text-slate-600 shrink-0">₪57\.07<\/div><\/div><div data-paper-promo="avocado" /);
  assert.match(c, COMPACT); assert.equal(c.match(COMPACT)[1], ' data-receipt="' + rc.id + '"');
  assert.match(c, /<div class="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-0"><div class="min-w-0"><div class="text-sm font-bold text-slate-700 truncate">שוקו 1 ליטר<\/div><div class="text-\[11px\] text-slate-400">12 × ₪7\.53083 · מבצע 15%<\/div><\/div><div class="text-sm font-black text-slate-600 shrink-0">₪90\.37<\/div><\/div>/);
  // הקופסה הסגולה: לא "מחיר שונה: במערכת…, בנייר…"; ואין קופסת "הפרשים מול התעודה" ריקה
  assert.match(c, /<div data-paper-promo-finding="avocado" class="font-black mt-1 text-rose-700">• ממרח אבוקדו 200 — בתעודה קיים מבצע: 40% הנחה \(₪7\.13 ליח׳ במקום ₪11\.89\)\. המבצע לא קיים במערכת\.<\/div>/);
  assert.doesNotMatch(c, /מחיר שונה:|הפרשים מול התעודה/);
  // הכפתור שבתחתית הכרטיס: "ערוך תעודה" הרגיל (אותו מסך) ולא "תקן הפרשים" — אין הפרשים לתקן, והפעולה היא "פתח מבצע"
  assert.match(c, /<button data-role="rc-fix-open" data-id="[^"]+" class="btn-tap mt-2 w-full font-black py-2\.5 rounded-xl text-sm flex items-center justify-center gap-2 bg-slate-100 text-slate-700"><i class="fa-solid fa-pen"><\/i> ערוך תעודה<\/button>/);
  assert.doesNotMatch(c, /תקן הפרשים/);
  assert.match(card(r, 'rc-older'), COMPACT, 'גם בתעודה הישנה — לפי הכוכבית');

  // "פתח מבצע" מהשורה שבכרטיס
  const itemsBefore = json(r, 'receipts.map(x => x.items)'), writesBefore = r.writes.length;
  r.click('paper-promo-open', 'avocado', { receipt: rc.id });
  assert.equal(sheetShown(r), true);
  assert.deepEqual([sheet(r).receiptId, sheet(r).pct, sheet(r).start, sheet(r).end], [rc.id, '40', '2026-11-01', '2026-11-30']);
  await sheetClick(r, 'save');
  const added = r.writes.slice(writesBefore);
  assert.deepEqual(added.map(w => [w.label || 'create promo', w.op]), [['create promo', 'set'], ['stamp resolved price finding', 'batch']]);
  const promoId = added[0].path.at(-1);
  // שתי התעודות נחתמות: הממצא נשאר כמו שהוא, עם promoResolved; הסטטוס השמור נסגר (v398)
  assert.deepEqual(added[1].writes.map(w => [w.op, w.path.at(-1), w.data.status, w.data.aiAudit.hasDiscrepancy, w.data.aiAudit.resolvedAt > 0, Object.keys(w.data).sort()]),
    [['update', rc.id, 'ok', false, true, ['aiAudit', 'status']], ['update', 'rc-older', 'ok', false, true, ['aiAudit', 'status']]]);
  const stamped = added[1].writes[0].data.aiAudit.findings.find(f => f.type === 'price');
  assert.deepEqual({ ...stamped, promoResolved: { ...stamped.promoResolved, at: 0 } }, { ...rc.aiAudit.findings.find(f => f.type === 'price'), promoResolved: { promoId, promoName: 'ממרח אבוקדו 200', pct: 40, at: 0 } });
  assert.deepEqual(json(r, 'receipts.map(x => x.items)'), itemsBefore, 'שום שורה שמורה לא השתנתה');
  assert.deepEqual(json(r, 'receipts.map(x => [x.status, x.aiAudit.hasDiscrepancy])'), [['ok', false], ['ok', false]]);
  assert.equal(r.toasts.at(-1), 'המבצע נפתח: ממרח אבוקדו 200 · 40% · 2 תעודות אומתו ✓');
  // הכרטיס שממנו נפתח המבצע נשאר פתוח — גם בציור הבא (הסנכרון מהענן מצייר את המסך מחדש רגע אחר כך); האחר — סגור כרגיל
  assert.match(card(r, rc.id), /^<details data-receipt-card="[^"]+" open class="bg-white rounded-2xl border-2 border-emerald-300 /);
  assert.match(card(r, 'rc-older'), /^<details data-receipt-card="rc-older" class="bg-white rounded-2xl border-2 border-emerald-300 /);
  r.run('renderReceiptsHistory()');
  assert.match(card(r, rc.id), /^<details data-receipt-card="[^"]+" open class=/);
  r.run('paperPromoCardOpen.until = Date.now() - 1; renderReceiptsHistory()');
  assert.match(card(r, rc.id), /^<details data-receipt-card="[^"]+" class=/, 'לזמן קצר בלבד');
  // הכרטיס אחרי: אומתה, השורה מראה את המבצע (תצוגה), והקופסה הסגולה מאשרת
  const done = card(r, rc.id);
  assert.match(done, /<i class="fa-solid fa-circle-check"><\/i> אומתה<\/span>/);
  assert.match(done, /data-plain-status="balanced">נקלטה ומאוזנת ✓<\/div>/);
  assert.match(done, /<div class="text-sm font-bold text-slate-700 truncate">ממרח אבוקדו 200<\/div><div class="text-\[11px\] text-slate-400">8 × ₪7\.13375 · מבצע 40%<\/div>/);
  assert.match(done, /<div class="font-black mt-1 text-emerald-700">• ממרח אבוקדו 200 — מבצע 40%: המחיר בנייר תואם למבצע ✓<\/div>/);
  assert.doesNotMatch(done, /data-paper-promo|paper-promo-open|data-plain-action/);
  assert.deepEqual(json(r, 'receipts.map(x => savedReceiptPaperPromos(x).length)'), [0, 0]);
  // החתימה שורדת את מחיקת המבצע (כמו v202): התעודה נשארת מאוזנת, ואין הצעה לפתוח אותו שוב
  r.run(`promos = promos.filter(p => p.id !== ${JSON.stringify(promoId)}); renderReceiptsHistory();`);
  assert.equal(plain(r, rc.id).state, 'balanced');
  assert.doesNotMatch(card(r, rc.id), /data-paper-promo|paper-promo-open/);
});

test('7. הזיהוי בתעודה שמורה: לפי בדיקת המחירים השמורה, ובתעודה ישנה — לפי הכוכבית; ומה אינו "מבצע שלא קיים במערכת"', async () => {
  const cloud = fakeCloud();
  const r = runtime('yotvata', { cloud, handoff: false, data: { products, promos: structuredClone(promos), items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  r.run(`todayStr = () => '2026-11-15'`);
  const finding = { type: 'price', productId: 'avocado', name: 'ממרח אבוקדו 200', qty: 8, amount: -38.05, expectedPrice: 11.89, paperPrice: 7.13375, text: 'מחיר שונה: ממרח אבוקדו 200 — במערכת ₪11.89, בנייר ₪7.13' };
  const star = { type: 'printed_promo', productId: 'avocado', name: 'ממרח אבוקדו 200', text: 'מבצע מודפס ליד ממרח אבוקדו 200: *' };
  const item = { productId: 'avocado', name: 'ממרח אבוקדו 200', qty: 8, unitPrice: 7.13375, basePrice: 11.89, lineTotal: 57.07, promoPct: 0 };
  const auditRow = { productId: 'avocado', capability: 'checkable', result: 'difference', promo: null, catalogBasePrice: 11.89, comparisonPrice: 7.13375, originalUnitPrice: 11.89, quantity: 8, date: '2026-11-15' };
  const found = rc => json(r, `savedReceiptPaperPromos(${JSON.stringify({ id: 'x', date: '2026-11-15', status: 'open', items: [item], ...rc })}).map(x => [x.productId, x.pct, x.qty, x.saving])`);
  const audit = (findings, more) => ({ aiAudit: { hasDiscrepancy: true, findings }, ...more });
  const HIT = [['avocado', 40, 8, 38.05]];
  // עם בדיקת המחירים השמורה: הנייר הדפיס את מחיר המאגר וחייב פחות — גם בלי כוכבית
  assert.deepEqual(found(audit([finding], { priceAudit: { rows: [auditRow] } })), HIT);
  // תעודה ישנה, בלי בדיקת מחירים: הכוכבית שנקראה ליד המוצר; בלי כוכבית — אין ראיה שזו הנחה ולא שינוי מחיר
  assert.deepEqual(found(audit([finding, star])), HIT);
  assert.deepEqual(found(audit([finding])), []);
  assert.deepEqual(found(audit([finding, { ...star, productId: 'milk' }])), []);
  // הנייר הדפיס מחיר יחידה אחר ממחיר המאגר, או שלא הדפיס הנחה — שינוי מחיר
  assert.deepEqual(found(audit([finding, star], { priceAudit: { rows: [{ ...auditRow, originalUnitPrice: 7.13 }] } })), []);
  assert.deepEqual(found(audit([finding, star], { priceAudit: { rows: [{ ...auditRow, originalUnitPrice: 12.5 }] } })), []);
  // שתי שורות שאינן מסכימות; שורה שלא נבדקה; מבצע של המערכת שחל אז על השורה
  assert.deepEqual(found(audit([finding], { priceAudit: { rows: [auditRow, { ...auditRow, comparisonPrice: 9.75 }] } })), []);
  assert.deepEqual(found(audit([finding], { priceAudit: { rows: [auditRow, { ...auditRow }] } })), HIT);
  assert.deepEqual(found(audit([finding], { priceAudit: { rows: [{ ...auditRow, comparisonPrice: null }] } })), []);
  assert.deepEqual(found(audit([finding], { priceAudit: { rows: [{ ...auditRow, promo: { id: 'x', pct: 18 } }] } })), []);
  // המחיר הצפוי שנשמר היה מחיר של מבצע שהיה אז במערכת (18%) — זה פער מול מבצע קיים, לא מבצע חסר
  assert.deepEqual(found(audit([{ ...finding, expectedPrice: 9.7498 }, star])), []);
  // הנייר יקר מהמאגר; ממצא "מבצע קיים במערכת אך לא בתעודה"; "אותו מוצר חויב ביותר ממחיר אחד"; שני ממצאי מחיר לאותו מוצר
  assert.deepEqual(found(audit([{ ...finding, paperPrice: 12.5, amount: 4.88 }, star])), []);
  assert.deepEqual(found(audit([{ ...finding, type: 'promo_missing' }, star])), []);
  assert.deepEqual(found(audit([{ ...finding, text: 'אותו מוצר חויב ביותר ממחיר אחד: ממרח אבוקדו 200 — ₪7.13 · ₪11.89' }, star])), []);
  assert.deepEqual(found(audit([finding, { ...finding }, star])), []);
  // במערכת כבר יש מבצע על המוצר ביום התעודה (ב-20.10: 18%) — לא מציעים לפתוח חדש; ומבצע שמסביר את המחיר — אין מה להציע
  assert.deepEqual(found({ date: '2026-10-20', ...audit([finding, star]) }), []);
  r.context.late = structuredClone(AVOCADO_PROMO); r.run('promos.push(late)');
  assert.deepEqual(found(audit([finding, star])), []);
  r.run(`promos = promos.filter(p => p.id !== 'p-avocado-nov')`);
  // ממצא שכבר נחתם (v202), תעודה בלי סריקה, ורשומה ריקה
  assert.deepEqual(found(audit([{ ...finding, promoResolved: { promoId: 'gone', promoName: 'x', pct: 40, at: 1 } }, star])), []);
  assert.deepEqual(found({}), []);
  assert.deepEqual(json(r, 'savedReceiptPaperPromos(null)'), []);
  // המשפט: כשיש לצדו ממצא מחיר אמיתי, נשאר המשפט הכללי (וההודעה על השורה עדיין מוצגת)
  const mixed = { id: 'm', date: '2026-11-15', status: 'open', items: [item, { productId: 'milk', name: 'חלב', qty: 12, unitPrice: 5.5, basePrice: 5, lineTotal: 66, promoPct: 0 }],
    ...audit([finding, star, { type: 'price', productId: 'milk', name: 'חלב', qty: 12, amount: 6, expectedPrice: 5, paperPrice: 5.5, text: 'מחיר שונה: חלב — במערכת ₪5.00, בנייר ₪5.50' }]) };
  assert.equal(json(r, `receiptPlainStatus(${JSON.stringify(mixed)})`).state, 'price_finding');
  assert.equal(json(r, `savedReceiptPaperPromos(${JSON.stringify(mixed)})`).length, 1);
  // שני מבצעים חסרים באותה תעודה — המשפט מונה אותם, והפעולה פותחת את הראשון
  const twoItems = { id: 't', date: '2026-11-15', status: 'open', items: [item, { productId: 'cottage', name: 'קוטג׳ 5% 250 גרם', qty: 6, unitPrice: 5.6, basePrice: 7, lineTotal: 33.6, promoPct: 0 }],
    ...audit([finding, star, { type: 'price', productId: 'cottage', name: 'קוטג׳ 5% 250 גרם', qty: 6, amount: -8.4, expectedPrice: 7, paperPrice: 5.6, text: 'מחיר שונה' }, { ...star, productId: 'cottage' }]) };
  assert.deepEqual(json(r, `(p => [p.state, p.text, p.productId])(receiptPlainStatus(${JSON.stringify(twoItems)}))`), ['paper_promo', 'בתעודה 2 מבצעים שלא קיימים במערכת · ממרח אבוקדו 200 · 40% · קוטג׳ 5% 250 גרם · 20%', 'avocado']);
  // הכרטיס של התעודה שיש בה גם ממצא מחיר אמיתי: "תקן הפרשים" הכחול נשאר (יש מה לתקן), וההודעה על שורת המוצר מוצגת עם "פתח מבצע"
  history(r, [{ ...mixed, timestamp: Date.parse('2026-11-15T09:00:00'), count: 2, totalExVat: 123.07, noteTotalInc: 123.07, noteParts: [{ amount: 123.07, units: 20 }] }]);
  const mixedCard = card(r, 'm');
  assert.match(mixedCard, /data-plain-status="price_finding"/);
  assert.match(mixedCard, /<button data-role="rc-fix-open" data-id="m" class="btn-tap mt-2 w-full font-black py-2\.5 rounded-xl text-sm flex items-center justify-center gap-2 bg-blue-600 text-white"><i class="fa-solid fa-wrench"><\/i> תקן הפרשים<\/button>/);
  assert.match(mixedCard, COMPACT); assert.equal(mixedCard.match(COMPACT)[1], ' data-receipt="m"');
});

test('8. התקופה: זו ששאר המבצעים שבתוקף ביום התעודה חולקים; בלעדיהם — החודש של התעודה; בלי להיכנס למבצע אחר של המוצר; ואזהרת חפיפה', async () => {
  const cloud = fakeCloud();
  const r = runtime('yotvata', { cloud, handoff: false, data: { products, promos: structuredClone(promos), items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  const period = (day, pid) => json(r, `paperPromoPeriod(${JSON.stringify(day)}, ${JSON.stringify(pid || null)})`);
  assert.deepEqual(period('2026-11-15', 'avocado'), { start: '2026-11-01', end: '2026-11-30', from: 'promos' });
  // דף הפעילות אינו תמיד חודש קלנדרי: שני מבצעים 4.10–31.10 → התקופה שלהם
  r.run(`promos.push({ id: 'o1', name: 'א', pct: 15, minQty: 1, productIds: ['milk'], type: 'receipt', start: '2026-10-04', end: '2026-10-31' })`);
  assert.deepEqual(period('2026-10-20', 'cottage'), { start: '2026-10-04', end: '2026-10-31', from: 'promos' });
  // מבצע יחיד בתוקף אינו "תקופה" — החודש של התעודה; וגם כשאין מבצעים בכלל (כולל פברואר)
  assert.deepEqual(period('2026-10-02', 'cottage'), { start: '2026-10-01', end: '2026-10-31', from: 'month' });
  assert.deepEqual(period('2026-12-05', 'cottage'), { start: '2026-12-01', end: '2026-12-31', from: 'month' });
  assert.deepEqual(period('2027-02-10', 'cottage'), { start: '2027-02-01', end: '2027-02-28', from: 'month' });
  assert.deepEqual(period('2028-02-10', 'cottage'), { start: '2028-02-01', end: '2028-02-29', from: 'month' });
  assert.deepEqual(period('', 'cottage'), { start: '', end: '', from: 'month' });
  // מבצעי מרכזת אינם נספרים; ושתי תקופות שוות — המאוחרת
  r.run(`promos.push({ id: 'me1', name: 'מ', pct: 5, productIds: ['milk'], type: 'monthEnd', start: '2026-12-01', end: '2026-12-20' }, { id: 'me2', name: 'מ', pct: 5, productIds: ['milk'], type: 'monthEnd', start: '2026-12-01', end: '2026-12-20' })`);
  assert.deepEqual(period('2026-12-05', 'cottage'), { start: '2026-12-01', end: '2026-12-31', from: 'month' });
  // התקופה אינה נכנסת למבצע אחר של אותו מוצר: מתחילה אחרי מבצע שנגמר בתוכה לפני יום התעודה, ונגמרת לפני מבצע שמתחיל בתוכה אחריו
  r.run(`promos.push({ id: 'c-early', name: 'קוטג׳ תחילת חודש', pct: 10, minQty: 1, productIds: ['cottage'], type: 'receipt', start: '2026-10-25', end: '2026-11-07' },
    { id: 'c-late', name: 'קוטג׳ סוף חודש', pct: 12, minQty: 1, productIds: ['cottage'], type: 'receipt', start: '2026-11-24', end: '2026-12-10' })`);
  assert.deepEqual(period('2026-11-15', 'cottage'), { start: '2026-11-08', end: '2026-11-23', from: 'promos' });
  assert.deepEqual(period('2026-11-15', 'avocado'), { start: '2026-11-01', end: '2026-11-30', from: 'promos' }, 'מוצר אחר — בלי קיצור');
  assert.deepEqual(json(r, `[paperPromoShiftDay('2026-10-31', 1), paperPromoShiftDay('2026-03-01', -1), paperPromoShiftDay('2028-02-28', 1), paperPromoShiftDay('2026-12-31', 1)]`), ['2026-11-01', '2026-02-28', '2028-02-29', '2027-01-01']);

  // בחלון: תקופה שהוארכה לתוך מבצע אחר של המוצר — אזהרה עם שם המבצע, ו"פתח בכל זאת" שומר
  const c = await scan([paper([['milk', 12], ['cottage', 6, 20]])], { system: promos.concat([{ id: 'c-late', name: 'קוטג׳ סוף חודש', pct: 12, minQty: 1, productIds: ['cottage'], type: 'receipt', start: '2026-11-24', end: '2026-12-10' }]) });
  c.run('startReceiptLineCheck()');
  assert.deepEqual(json(c, 'receiptPaperPromos().map(x => [x.productId, x.pct, Math.round(x.charged * 1e6) / 1e6, x.saving])'), [['cottage', 20, 5.6, 8.4]]);
  click(c, { role: 'paper-promo-open', id: 'cottage' });
  assert.deepEqual([sheet(c).pct, sheet(c).start, sheet(c).end], ['20', '2026-11-01', '2026-11-23'], 'ברירת המחדל נעצרת לפני המבצע שכבר הוגדר להמשך');
  sheetType(c, 'end', '2026-11-30');
  await sheetClick(c, 'save');
  assert.equal(sheetMsg(c), 'למוצר כבר יש מבצע בתקופה הזאת: "קוטג׳ סוף חודש" (24.11.2026 עד 10.12.2026). כשמוצר נמצא בשני מבצעים חופפים, רק אחד מהם יחול. אפשר לתקן, או ללחוץ "פתח בכל זאת".');
  assert.equal(saveLabel(c), 'פתח בכל זאת'); assert.equal(promoWrites(c).length, 0);
  await sheetClick(c, 'save');
  assert.deepEqual(promoWrites(c).map(w => [w.data.name, w.data.pct, w.data.start, w.data.end, w.data.productIds]), [['קוטג׳ 5% 250 גרם', 20, '2026-11-01', '2026-11-30', ['cottage']]]);
  assert.equal(sheetShown(c), false);
  // שמירה שנכשלה (אין חיבור): החלון נשאר פתוח עם ההסבר, שום מבצע לא נוסף, וההודעה נשארת על השורה
  const d = await note();
  d.run('startReceiptLineCheck()');
  click(d, { role: 'paper-promo-open', id: 'avocado' });
  d.run('runCloudTask = async () => false');
  await sheetClick(d, 'save');
  assert.equal(sheetShown(d), true);
  assert.equal(sheetMsg(d), 'המבצע לא נשמר — אין חיבור לענן, או שפעולה קודמת עדיין נשמרת. נסה שוב.');
  assert.equal(saveLabel(d), 'פתח מבצע'); assert.equal(d.run(`promos.some(p => p.productIds.includes('avocado') && p.end >= '2026-11-15')`), false);
  await sheetClick(d, 'cancel');
  assert.match(row(d, 0, 3), NOTICE);
});

test('9. שורה שהקריאות לא הסכימו עליה: כרטיס השאלה אומר שזה מבצע שלא קיים במערכת, עם "פתח מבצע"; אפשר לאשר את הפער ביד, ואפשר לפתוח', async () => {
  const r = await note({ agreed: false });
  assert.deepEqual(json(r, 'receiptPaperPromos().map(x => [x.productId, x.pct])'), [['avocado', 40]]);
  assert.deepEqual(json(r, `receiptPriceAudit().rows.map(x => [x.productId, x.result, x.paperConfirmed])`), [['milk', 'match', false], ['cottage', 'match', false], ['choco', 'match', false], ['avocado', 'difference', false]]);
  // הכותרת קוראת לזה בשמו (עד 417: "נשארה שורה אחת עם פער מחיר"), גם בכפתור הקטן שבמסך הסריקה
  const panel = r.run('receiptPriceAuditHtml()');
  assert.match(panel, /<span role="status" aria-live="polite">נשארה שורה אחת עם מבצע שלא קיים במערכת<\/span>/);
  assert.equal(r.run('priceAuditPendingTitle(priceAuditPendingRows(receiptPriceAudit()), true, receiptPaperPromoMap())'), 'שורה אחת עם מבצע שלא קיים במערכת');
  assert.equal(r.run('priceAuditPendingTitle(priceAuditPendingRows(receiptPriceAudit()), true)'), 'שורה אחת עם פער מחיר', 'בלי המפה — כמו קודם');
  // כרטיס השאלה: הכותרת, ההודעה והכפתור במקום "מחיר בתעודה / מחיר צפוי / הפרש", והשאלה על הנייר נשארת
  assert.match(panel, /<article data-price-row="[^"]+" data-price-result="difference" class="rounded-xl border-2 border-rose-200 p-3 mt-3 bg-white"><div class="font-black text-base text-rose-800">בתעודה קיים מבצע שלא קיים במערכת<\/div><div class="font-black text-lg mt-2">ממרח אבוקדו 200<\/div><div data-paper-promo="avocado" class="mt-2 /);
  assert.match(panel, NOTICE);
  assert.match(panel, /<p class="mt-2 font-bold">לא פותחים מבצע\? האם המחיר והכמות כאן הם מה שמודפס בשורה\?<\/p><button data-role="price-confirm-paper" data-doc="0" data-row="3"/);
  assert.match(panel, /כן, כך כתוב בתעודה — שמור את הפער/);
  assert.match(panel, /<summary class="cursor-pointer font-bold">פירוט חישוב המחיר<\/summary>/, 'המספרים המלאים — בפירוט');
  assert.doesNotMatch(panel, /data-price-paper-promo|מחיר צפוי · מחיר רגיל|המחיר בתעודה שונה מהמחיר שבמאגר/);
  // הרשימה שורה-שורה — אותה הודעה
  r.run('startReceiptLineCheck()');
  assert.match(row(r, 0, 3), NOTICE);
  // "כן, כך כתוב בתעודה — שמור את הפער": השורה אומתה, והמבצע עדיין מוצע — בכרטיס הפתוח, לא בין פערי המחיר המקופלים
  r.click('price-confirm-paper', '', { doc: '0', row: '3', reviewToken: r.run('priceAuditPaperReviewToken(receiptPriceAudit().rows[3])') });
  const confirmed = r.run('receiptPriceAuditHtml()');
  assert.match(confirmed, /<span role="status" aria-live="polite">בתעודה קיים מבצע שלא קיים במערכת<\/span>/);
  assert.match(confirmed, /<article data-price-paper-promo="avocado"/);
  assert.doesNotMatch(confirmed, /data-price-reviewed|data-price-row=/);
  // "פתח מבצע" — השורה תואמת, ואין מה לאשר
  r.click('paper-promo-open', 'avocado');
  assert.equal(sheetShown(r), true);
  await sheetClick(r, 'save');
  assert.deepEqual(json(r, 'receiptPriceAudit().rows.map(x => x.result)'), ['match', 'match', 'match', 'match']);
  assert.match(r.run('receiptPriceAuditHtml()'), /<span role="status" aria-live="polite">המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר<\/span>/);
});

test('10. טלפון שהקליטה אינה שלו כרגע (נמשכת בטלפון אחר): המבצע נפתח והמסך מחושב מחדש — אבל הקליטה עצמה אינה נערכת מכאן', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()'); markAll(r);
  r.run('finishReceiptLineCheck()'); await settle();
  assert.equal(r.run('currentView'), 'reconcile');
  const rowsBefore = json(r, 'reconcileData'), draftBefore = r.storage.get('yt_receipt_draft');
  r.run('canEditDraft = () => false');
  r.click('paper-promo-open', 'avocado');
  assert.equal(sheetShown(r), true);
  await sheetClick(r, 'save');
  assert.deepEqual(promoWrites(r).map(w => [w.data.pct, w.data.productIds]), [[40, ['avocado']]], 'המבצע נשמר — הוא שייך למאגר, לא לקליטה');
  assert.deepEqual(json(r, 'reconcileData'), rowsBefore, 'שורות ההשוואה לא נערכו');
  assert.equal(r.storage.get('yt_receipt_draft'), draftBefore, 'הטיוטה לא נכתבה');
  assert.equal(r.run('rcStep'), 'ai');
  // מה שעל המסך כבר רואה את המבצע
  assert.doesNotMatch(app(r), /data-paper-promo|paper-promo-open/);
  assert.match(app(r), /הכול תואם — לא נמצאו חוסר, עודף או בעיית מחיר\/מבצע\./);
  assert.equal(r.toasts.at(-1), 'המבצע נפתח: ממרח אבוקדו 200 · 40% ✓');
});

test('11. הרשימה אינה מריצה את בדיקת המחירים המלאה בכל סימון — רק כשמבצע או מחיר מאגר של מוצר בתעודה משתנים', async () => {
  const r = await note();
  r.run('startReceiptLineCheck()');
  r.run('auditCalls = 0; const auditOriginal = receiptPriceAudit; receiptPriceAudit = function () { auditCalls++; return auditOriginal.apply(this, arguments); };');
  // סימונים, "שנה", "בטל סימון", חיפוש — הרשימה מצוירת מחדש בכל אחד מהם, בלי בדיקת מחירים
  click(r, { lineMark: '0:0:ok' }); click(r, { lineMark: '0:1:none' }); click(r, { lineMark: '0:3:ok' }); click(r, { lineOpen: '0:3' }); click(r, { lineClear: '0:3' }); click(r, { lineMark: '0:2:qty' });
  for (let i = 0; i < 5; i++) r.run('renderReceiptLineRows()');
  assert.equal(r.run('auditCalls'), 0);
  assert.match(row(r, 0, 3), NOTICE, 'ההודעה עדיין מוצגת');
  // מבצע שהשתנה (נפתח ממכשיר אחר, למשל) — חישוב אחד, וההודעה יורדת; ושוב לא מחשבים
  r.context.late = structuredClone(AVOCADO_PROMO); r.run('promos = promos.concat([late]); renderReceiptLineRows()');
  assert.equal(r.run('auditCalls'), 1);
  assert.doesNotMatch(rows(r), /data-paper-promo=/);
  r.run('renderReceiptLineRows(); renderReceiptLineRows()');
  assert.equal(r.run('auditCalls'), 1);
  // המבצע נמחק — ההודעה חוזרת; מחיר מאגר של מוצר בתעודה השתנה — מחושב מחדש (עכשיו זה שינוי מחיר, לא מבצע)
  r.run(`promos = promos.filter(p => p.id !== 'p-avocado-nov'); renderReceiptLineRows()`);
  assert.equal(r.run('auditCalls'), 2); assert.match(row(r, 0, 3), NOTICE);
  r.run(`products.find(p => p.id === 'avocado').price = 12.5; renderReceiptLineRows()`);
  assert.equal(r.run('auditCalls'), 3); assert.doesNotMatch(rows(r), /data-paper-promo=/);
  // מוצר שאינו בתעודה — אינו משנה דבר
  r.run(`products.find(p => p.id === 'tahini').price = 9; renderReceiptLineRows()`);
  assert.equal(r.run('auditCalls'), 3);
});

test('12. הגרסה עלתה ל-420, כולל ה-service worker; החלון החדש בדף, מעל חלון הבדיקה ומתחת לחיווי השמירה', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '420'/);
  assert.match(html, /<title>הזמנות יטבתה - v420 מבצע שניתן בלי המינימום — כבר בקליטה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v420 מבצע שניתן בלי המינימום — כבר בקליטה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v420/);
  assert.match(html, /<div id="paperPromoModal" role="dialog" aria-modal="true" aria-label="פתיחת מבצע מהתעודה" class="hidden fixed inset-0 bg-slate-900\/60 backdrop-blur-sm items-center justify-center p-4 z-\[90\]" dir="rtl">/);
  assert.match(html, /<div id="receiptQuantityModal"[^>]* z-\[70\]"/); assert.match(html, /cloudBusyEl\.className = 'fixed inset-0 bg-black\/40 z-\[100\]/);
});
