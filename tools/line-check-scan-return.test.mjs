// גרסה 413 — בדיקה שורה-שורה: הסימון מהכרטיס שמעל המצלמה מחזיר לשורה של המוצר ברשימה.
// 10.11.2026, בעל העסק, מתוך בדיקה אמיתית בטלפון: "אחרי שאני מסמן מוצר ומאשר, או רושם 'לא קיבלתי' או 'קיבלתי אחרת', הוא נשאר
// במצלמה וכביכול ממשיך למוצר הבא. אני רוצה שאחרי שאישרת מוצר, או רשמת כמות אחרת, או 'לא הגיע' — וגם אם המוצר הוא פלוס
// בכלל — שיצא מהמוצר וילך לשורה של המוצר". עד 412 הכרטיס נסגר והמצלמה המשיכה לסרוק (עם "✓ שם · הגיע 6" מעליה); מעכשיו כל
// סימון סוגר את המצלמה, הרשימה חוזרת, והשורה שסומנה מודגשת ונגללת למרכז (receiptLineScanReturn → closeScanner →
// receiptLineScanClosed → receiptLineReveal). לסריקה הבאה — "סרוק מוצר" שבתחתית הקבועה.
// אותם נתונים כמו בבדיקות הסריקה (408): תעודה 4471001 (חלב 12, קוטג׳ 6, יוגורט 4) ותעודה 4471002 (חלב 5, שמנת 2); מעדן — לא בתעודות.
// המצלמה מזויפת, הברקוד דרך onScanned.
// מה שנבדק:
// 1. "הגיע N": המצלמה נסגרת, הרשימה חוזרת, רק השורה שסומנה מודגשת ונגללת; הטיוטה כמו ביד; בלי טיק של סריקה.
// 2. "אחרת" עם כמות (שמור / Enter): חזרה לשורה — פתוחה עם הכמות; "לא הגיע": חזרה לשורה — מקופלת ואדומה.
// 3. סריקה חוזרת — "עוד כמה?" + "הוסף": חזרה לשורה שהושלמה.
// 4. מוצר שאינו בתעודה ("פלוס"): "הוסף" — חזרה לכרטיס הצהוב שלו ב"הגיע משהו נוסף"; סריקה חוזרת — "עדכן" — שוב אליו.
// 5. מה שאינו סימון משאיר את המצלמה: ✕ בכרטיס (והסריקה ממשיכה), "תקן את הסה״כ", כמות לא תקינה, ברקוד לא מוכר.
// 6. "סרוק מוצר" שוב: המצלמה נפתחת נקייה — המונה מעודכן, בלי כרטיס ובלי "מה סומן זה עתה", ואותו ברקוד הוא סריקה חוזרת.
// 7. מוצר בשתי תעודות (412): "הגיע 17" מחזיר לכרטיס של הקבוצה (השורה הראשונה), גם כשנסרק אחרי שהרשימה הייתה גלולה.
// 8. שוויון: תעודה שסומנה כולה בסריקה (סריקה לכל מוצר) זהה לסימון ביד — השורות, הספירה, התעודה השמורה.
// 9. הגרסה.
// הרצה: node --test tools/line-check-scan-return.test.mjs
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
const BC = { milk: '7290000000008', cottage: '7290000000015', yogurt: '7290000000022', cream: '7290000000039', pudding: '7290000000046' };
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
// הבדיקה פתוחה, ו"סרוק מוצר" נלחץ — המצלמה (המזויפת) נפתחת עד הסוף
async function scanning(r) {
  r.run('startReceiptLineCheck()');
  r.events.get('receiptLineScan:click')();
  await settle();
  return r;
}
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const cardClick = (r, dataset) => r.run(`receiptLineScanCardClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const cardType = (r, value) => r.run(`receiptLineScanCardInput({ target: { dataset: { scanGot: '' }, value: ${JSON.stringify(value)} } })`);
const cardEnter = r => r.events.get('scanLineCard:keydown')({ key: 'Enter', target: { dataset: { scanGot: '' } }, preventDefault() {} });
const beep = (r, code) => r.run(`onScanned(${JSON.stringify(code)})`);
const later = r => r.run('lastScanTime = 0'); // עברו שתי שניות — אותו ברקוד נחשב סריקה חדשה
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const card = r => r.run(`$('scanLineCard').innerHTML`);
const cardOpen = r => !r.run(`$('scanLineCard').classList.contains('hidden')`);
const cameraOpen = r => !r.run(`$('scanModal').classList.contains('hidden')`);
const listOpen = r => !r.run(`$('receiptQuantityModal').classList.contains('hidden')`);
const overlay = r => r.run(`$('scanOverlayLabel').textContent + ' ' + $('scanOverlayCount').textContent + ' | ' + $('scanOverlayName').textContent`);
const draftMarks = r => JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
// ה-HTML של שורה אחת (lineCheck_di_li) מתוך הרשימה — עד השורה הבאה או סוף התעודה
function row(r, di, li) {
  const h = rows(r), i = h.indexOf('<div id="lineCheck_' + di + '_' + li + '"');
  assert.ok(i >= 0, 'שורה ' + di + ':' + li + ' קיימת');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i)].filter(x => x > 0);
  return h.slice(i, Math.min.apply(null, ends));
}
// ההדגשה (ring-4) מוסרת מהצומת לפני הפעולה — בדום המזויף querySelectorAll אינו מסיר אותה, ולכן ההדגשה שנבדקת היא של הפעולה הזאת
const unring = (r, id) => r.run(`$('${id}').classList.remove('ring-4', 'ring-blue-300')`);
const ringed = (r, id) => r.run(`$('${id}').classList.contains('ring-4') && $('${id}').classList.contains('ring-blue-300')`);
// הסימון חזר לרשימה: המצלמה סגורה, הכרטיס סגור, הרשימה פתוחה, והשורה מודגשת
function returned(r, id) {
  assert.equal(cardOpen(r), false, 'הכרטיס נסגר'); assert.equal(r.run('receiptLineScanCard'), null);
  assert.equal(cameraOpen(r), false, 'המצלמה נסגרה'); assert.equal(r.run('scanPurpose'), 'field');
  assert.equal(r.run('!!scanStream'), false, 'הזרם נעצר');
  assert.equal(listOpen(r), true, 'הרשימה חזרה');
  assert.equal(ringed(r, id), true, id + ' — השורה שסומנה מודגשת');
  assert.equal(r.run('receiptLineScanLast'), null); assert.equal(r.run('receiptLineScanEpoch'), null);
}
// המצלמה נשארה: הרשימה מוסתרת, המצלמה פתוחה, הסריקה במצב שורה-שורה
function stayed(r) {
  assert.equal(cameraOpen(r), true, 'המצלמה נשארת'); assert.equal(r.run('scanPurpose'), 'linecheck');
  assert.equal(listOpen(r), false, 'הרשימה עדיין מוסתרת');
}
async function rescan(r) { r.events.get('receiptLineScan:click')(); await settle(); assert.equal(r.run('scanPurpose'), 'linecheck', 'המצלמה נפתחה שוב'); return r; }
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

test('1. "הגיע N" מהכרטיס: המצלמה נסגרת, הרשימה חוזרת, והשורה שסומנה מודגשת — בלי טיק של סריקה; הטיוטה כמו ביד', async () => {
  const r = await scanning(await twoPapers());
  assert.equal(cameraOpen(r), true); assert.equal(listOpen(r), false);
  unring(r, 'lineCheck_0_1');
  beep(r, BC.cottage); // קוטג׳ — שורה 2 בתעודה 1
  assert.equal(cardOpen(r), true);
  stayed(r);
  const ticks = r.callbacks.length;
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_1');
  assert.equal(r.callbacks.length, ticks, 'המצלמה נסגרה — לא תוזמן טיק של סריקה');
  assert.deepEqual(marks(r), [',ok,', ',']);
  assert.deepEqual(draftMarks(r), [',ok,', ','], 'נשמר בטיוטה כמו סימון ביד');
  assert.match(strip(row(r, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ אין מחיר קופה — אפשר להשלים כאן כמה עובר בקופה \(כולל מע״מ\) ₪ שנה$/, 'מקופלת וירוקה, כמו "הגיע" ביד');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  assert.equal(r.run(`$('receiptQuantityTitle').textContent`), 'בדיקה שורה-שורה');
  // שאר השורות — לא מודגשות
  for (const id of ['lineCheck_0_0', 'lineCheck_0_2', 'lineCheck_1_1']) assert.equal(ringed(r, id), false, id);
  // ברשימה אפשר להמשיך ביד — והסימון מהסריקה נשאר
  click(r, { lineMark: '0:2:none' });
  assert.deepEqual(marks(r), [',ok,none', ',']);
});

test('2. "אחרת" עם כמות (שמור / Enter) — חזרה לשורה פתוחה עם הכמות; "לא הגיע" — חזרה לשורה מקופלת ואדומה', async () => {
  const r = await scanning(await twoPapers());
  unring(r, 'lineCheck_0_1');
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' });
  stayed(r); // "אחרת" פותחת את שדה הכמות — עדיין לא סימון
  assert.equal(cardOpen(r), true); assert.match(card(r), /id="scanLineGot"/);
  cardType(r, '4'); cardClick(r, { scanSave: '' });
  returned(r, 'lineCheck_0_1');
  assert.deepEqual(marks(r), [',qty:4,', ',']);
  assert.match(row(r, 0, 1), /data-line-got="0:1"[^>]*value="4"/, 'השורה פתוחה עם הכמות');
  assert.match(row(r, 0, 1), /data-line-mark="0:1:qty" aria-pressed="true"/);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות · חוסר 2 יח׳');
  // Enter — אותו דבר
  await rescan(r); unring(r, 'lineCheck_0_2');
  beep(r, BC.yogurt); cardClick(r, { scanMark: 'qty' }); cardType(r, '1'); cardEnter(r);
  returned(r, 'lineCheck_0_2');
  assert.deepEqual(marks(r), [',qty:4,qty:1', ',']);
  assert.match(row(r, 0, 2), /data-line-got="0:2"[^>]*value="1"/);
  // "לא הגיע"
  await rescan(r); unring(r, 'lineCheck_1_1');
  beep(r, BC.cream); cardClick(r, { scanMark: 'none' });
  returned(r, 'lineCheck_1_1');
  assert.deepEqual(marks(r), [',qty:4,qty:1', ',none']);
  assert.match(strip(row(r, 1, 1)), /^שמנת חמוצה 15% 200 מ״ל לא הגיע · 0 מתוך 2 אין מחיר קופה — אפשר להשלים כאן כמה עובר בקופה \(כולל מע״מ\) ₪ שנה$/, 'מקופלת');
  assert.match(row(r, 1, 1), /border-rose-300 bg-rose-50/, 'אדומה');
  assert.equal(progress(r), 'סומנו 3 מתוך 4 שורות · חוסר 7 יח׳');
  // "אחרת" עם הכמות שבתעודה בדיוק — "הגיע" (411), וגם היא חוזרת לשורה
  await rescan(r); unring(r, 'lineCheck_0_0');
  beep(r, BC.milk); cardClick(r, { scanMark: 'qty' }); cardType(r, '17'); cardClick(r, { scanSave: '' });
  returned(r, 'lineCheck_0_0');
  assert.deepEqual(marks(r), ['ok,qty:4,qty:1', 'ok,none']);
  assert.equal(progress(r), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 7 יח׳');
});

test('3. סריקה חוזרת — "עוד כמה?" ו"הוסף" — חזרה לשורה שהושלמה', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, '4'); cardClick(r, { scanSave: '' });
  returned(r, 'lineCheck_0_1');
  await rescan(r); unring(r, 'lineCheck_0_1');
  beep(r, BC.cottage);
  assert.equal(json(r, 'receiptLineScanCard.addQty'), true);
  assert.match(strip(card(r)), /סרקת עד עכשיו 4 מתוך 6 .* עוד כמה\? הוסף סה״כ 6 · כמו בתעודה/);
  stayed(r);
  cardClick(r, { scanSave: '' }); // "הוסף" 2 — 6: "הגיע"
  returned(r, 'lineCheck_0_1');
  assert.deepEqual(marks(r), [',ok,', ',']);
  assert.match(strip(row(r, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ אין מחיר קופה — אפשר להשלים כאן כמה עובר בקופה \(כולל מע״מ\) ₪ שנה$/);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  // עוד אחת מעבר — עודף; גם זה חוזר לשורה
  await rescan(r); unring(r, 'lineCheck_0_1');
  beep(r, BC.cottage); cardType(r, '1'); cardEnter(r);
  returned(r, 'lineCheck_0_1');
  assert.deepEqual(marks(r), [',qty:7,', ',']);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות · עודף 1 יח׳');
});

test('4. מוצר שאינו בתעודה ("פלוס"): "הוסף" — חזרה לכרטיס הצהוב שלו; סריקה חוזרת — "עדכן" — שוב אליו', async () => {
  const r = await scanning(await twoPapers());
  unring(r, 'lineExtra_0');
  beep(r, BC.pudding); // מעדן — לא בתעודות
  assert.deepEqual(json(r, '({ kind: receiptLineScanCard.kind, k: receiptLineScanCard.k, got: receiptLineScanCard.got })'), { kind: 'extra', k: -1, got: '1' });
  stayed(r);
  cardType(r, '3'); cardClick(r, { scanSave: '' });
  returned(r, 'lineExtra_0');
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '3']]);
  assert.deepEqual(JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.extras.map(x => [x.productId, x.got]), [['pudding', '3']]);
  assert.match(strip(rows(r)), /לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם בקופה: ₪5\.50/, 'הכרטיס הצהוב ברשימה');
  assert.match(rows(r), /data-extra-got="0"[^>]*value="3"/);
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות · עודף 3 יח׳');
  // שוב — "כבר ברשימה", "עדכן" — וחזרה לאותו כרטיס
  await rescan(r); unring(r, 'lineExtra_0');
  beep(r, BC.pudding);
  assert.deepEqual(json(r, '({ k: receiptLineScanCard.k, got: receiptLineScanCard.got })'), { k: 0, got: '3' });
  assert.match(strip(card(r)), /^כבר ברשימה ״הגיע משהו נוסף״ מעדן שוקולד/);
  cardType(r, '5'); cardClick(r, { scanSave: '' });
  returned(r, 'lineExtra_0');
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '5']]);
  assert.match(rows(r), /data-extra-got="0"[^>]*value="5"/);
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות · עודף 5 יח׳');
  // מוצר "פלוס" שני — הכרטיס השני
  await rescan(r); unring(r, 'lineExtra_0'); unring(r, 'lineExtra_1');
  beep(r, '7290000000053'); cardType(r, '2'); cardClick(r, { scanSave: '' });
  returned(r, 'lineExtra_1');
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '5'], ['butter', '2']]);
  assert.equal(ringed(r, 'lineExtra_0'), false, 'רק הכרטיס שסומן עכשיו מודגש');
});

test('5. מה שאינו סימון משאיר את המצלמה: ✕ בכרטיס (והסריקה ממשיכה), "תקן את הסה״כ", כמות לא תקינה, ברקוד לא מוכר', async () => {
  const r = await scanning(await twoPapers());
  // ✕ בכרטיס — כלום לא משתנה, המצלמה נשארת, טיק אחד והסריקה ממשיכה
  let ticks = r.callbacks.length;
  beep(r, BC.cottage); assert.equal(cardOpen(r), true);
  cardClick(r, { scanDismiss: '' });
  assert.equal(cardOpen(r), false); stayed(r);
  assert.equal(r.callbacks.length, ticks + 1, 'טיק אחד — הסריקה ממשיכה');
  assert.deepEqual(marks(r), [',,', ',']); assert.deepEqual(review(r).extras, []);
  // כמות לא תקינה — הכרטיס נשאר ואומר
  later(r); beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, 'x');
  assert.equal(r.run('receiptLineScanSave()'), false);
  assert.equal(cardOpen(r), true); stayed(r);
  assert.match(strip(card(r)), /הקלד מספר — כמה יחידות הגיעו/);
  cardClick(r, { scanDismiss: '' });
  // "תקן את הסה״כ" — מהכרטיס של "עוד כמה?" לכרטיס הקודם, בלי לסמן
  later(r); beep(r, BC.yogurt); cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_2');
  await rescan(r);
  beep(r, BC.yogurt); assert.equal(json(r, 'receiptLineScanCard.addQty'), true);
  cardClick(r, { scanMark: 'fix' });
  assert.equal(cardOpen(r), true); stayed(r);
  assert.match(strip(card(r)), /כבר סומנה: הגיע — אפשר לשנות/);
  cardClick(r, { scanDismiss: '' });
  // ברקוד לא מוכר — ההודעה, המצלמה נשארת והסריקה ממשיכה
  ticks = r.callbacks.length;
  later(r); beep(r, '7290119390519');
  assert.equal(cardOpen(r), false); stayed(r);
  assert.equal(r.toasts[r.toasts.length - 1], '❌ ברקוד לא קיים במערכת — הוסף את המוצר במסך מוצרים ומחירים וסרוק שוב');
  assert.equal(r.callbacks.length, ticks + 1);
  assert.deepEqual(marks(r), [',,ok', ',']);
  // ✕ במצלמה — חזרה לרשימה כמו שהיא, בלי שורה מודגשת חדשה
  unring(r, 'lineCheck_0_2');
  r.events.get('scanClose:click')();
  assert.equal(cameraOpen(r), false); assert.equal(listOpen(r), true);
  assert.equal(ringed(r, 'lineCheck_0_2'), false, 'כלום לא סומן מאז — שום שורה לא מודגשת');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
});

test('6. "סרוק מוצר" שוב: המצלמה נפתחת נקייה — המונה מעודכן, בלי כרטיס ובלי "מה סומן זה עתה"; אותו ברקוד מיד הוא סריקה חוזרת', async () => {
  const r = await scanning(await twoPapers());
  assert.equal(overlay(r), 'סומנו 0 מתוך 4 | ');
  beep(r, BC.cottage); cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_1');
  assert.equal(r.run('lastScanCode'), BC.cottage);
  await rescan(r);
  assert.equal(cameraOpen(r), true); assert.equal(listOpen(r), false);
  assert.equal(overlay(r), 'סומנו 1 מתוך 4 | ', 'המונה מעודכן, ומתחתיו כלום');
  assert.equal(cardOpen(r), false); assert.equal(r.run('receiptLineScanCard'), null);
  assert.equal(r.run('lastScanCode'), '', 'הברקוד האחרון נמחק — המצלמה נקייה');
  assert.equal(r.run(`$('scanTitle').textContent`), 'בדיקה שורה-שורה — סריקה');
  assert.equal(r.run(`$('scanHint').textContent`), 'סרוק מוצר מהסחורה — ✕ חוזר לרשימה');
  // אותו ברקוד מיד — סריקה חוזרת ("עוד כמה?"), לא "קריאה כפולה" שמתעלמים ממנה
  beep(r, BC.cottage);
  assert.equal(cardOpen(r), true); assert.equal(json(r, 'receiptLineScanCard.addQty'), true);
  assert.match(strip(card(r)), /סרקת עד עכשיו 6 מתוך 6 — הכל הגיע/);
  cardClick(r, { scanDismiss: '' });
  // "סרוק מוצר" מיישב "אחרת" עם הכמות המדויקת שהוקלדה ברשימה (411) לפני שהרשימה מתחבאת — ועדיין המונה נכון
  r.run('closeScanner()');
  click(r, { lineMark: '0:2:qty' }); type(r, { lineGot: '0:2' }, '4');
  await rescan(r);
  assert.deepEqual(marks(r), [',ok,ok', ',']);
  assert.equal(overlay(r), 'סומנו 2 מתוך 4 | ');
});

test('7. מוצר בשתי תעודות (412): "הגיע 17" מחזיר לכרטיס של הקבוצה — השורה הראשונה, גם מתוך רשימה גלולה', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  // מסמנים קודם את השורות האחרות, "סרוק מוצר" (הרשימה גלולה למטה — בדום המזויף אין גלילה, אבל ההדגשה והיעד נבדקים)
  click(r, { lineMark: '0:1:ok' }); click(r, { lineMark: '0:2:ok' }); click(r, { lineMark: '1:1:ok' });
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 3 מתוך 4 | ');
  unring(r, 'lineCheck_0_0'); unring(r, 'lineCheckRef_1_0');
  beep(r, BC.milk);
  assert.match(strip(card(r)), /^שורה 1 בתעודה 1 מתוך 2 · גם בתעודה 2 \(5 יח׳\) חלב 3% בקרטון 1 ליטר .* 17 יח׳ ב-2 תעודות 12 \+ 5 הגיע 17 אחרת לא הגיע$/);
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_0');
  assert.equal(ringed(r, 'lineCheckRef_1_0'), false, 'שורת ההפניה בתעודה השנייה — לא היא המודגשת');
  assert.deepEqual(marks(r), ['ok,ok,ok', 'ok,ok'], '"הגיע 17" — שתי השורות');
  assert.match(strip(row(r, 0, 0)), /חלב 3% בקרטון 1 ליטר הגיע · 17 יח׳ ב-2 תעודות · בקופה ₪6\.90 שנה/);
  assert.match(strip(rows(r)), /נספר יחד עם תעודה 1, שורה 1 · ✓ הגיע/);
  assert.equal(progress(r), 'כל 4 שורות סומנו — אפשר לסיים');
  assert.equal(r.run(`$('receiptQuantityConfirm').textContent`), 'סיום — שמור את הבדיקה');
});

test('8. שוויון: תעודה שסומנה כולה בסריקה — סריקה לכל מוצר, עם חזרה לרשימה בין לבין — זהה לסימון ביד, עד התעודה השמורה', async () => {
  // בסריקה: חלב "אחרת" 10 מתוך 17; מעדן 2 בנוסף; השאר הגיע — "סרוק מוצר" לפני כל מוצר
  const a = await twoPapers();
  a.run('startReceiptLineCheck()');
  await rescan(a); beep(a, BC.milk); cardClick(a, { scanMark: 'qty' }); cardType(a, '10'); cardClick(a, { scanSave: '' }); returned(a, 'lineCheck_0_0');
  await rescan(a); beep(a, BC.pudding); cardType(a, '2'); cardClick(a, { scanSave: '' }); returned(a, 'lineExtra_0');
  await rescan(a); beep(a, BC.cottage); cardClick(a, { scanMark: 'ok' }); returned(a, 'lineCheck_0_1');
  await rescan(a); beep(a, BC.yogurt); cardClick(a, { scanMark: 'ok' }); returned(a, 'lineCheck_0_2');
  await rescan(a); beep(a, BC.cream); cardClick(a, { scanMark: 'ok' }); returned(a, 'lineCheck_1_1');
  assert.equal(progress(a), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 7 יח׳ · עודף 2 יח׳');
  // ביד — אותם סימונים
  const b = await twoPapers();
  b.run('startReceiptLineCheck()');
  click(b, { lineMark: '0:0:qty' }); type(b, { lineGot: '0:0' }, '10');
  type(b, { lineSearch: '' }, 'מעדן'); click(b, { extraAdd: 'pudding' }); type(b, { extraGot: '0' }, '2');
  markRestOk(b);
  const pick = r => json(r, '({ docs: receiptQuantityReview.docs.map(d => ({ ...d, scanId: null })), extras: receiptQuantityReview.extras, rows: receiptQuantityReview.rows, products: receiptQuantityReview.products })');
  assert.deepEqual(pick(a), pick(b), 'אותה בדיקה בדיוק');
  assert.deepEqual(draftMarks(a), draftMarks(b));
  assert.equal(a.run('finishReceiptLineCheck()'), true); assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(a, 'receiptList'), json(b, 'receiptList'));
  assert.deepEqual(json(a, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 2', 'milk 10', 'pudding 2', 'yogurt 4']);
  closeNormal(a); closeNormal(b);
  const audit = r => json(r, '({ ...receiptQuantityCheckAudit(), confirmedAt: null })');
  assert.deepEqual(audit(a), audit(b), 'מה שנשמר בקליטה — זהה, בלי שדה חדש');
  const savedA = await save(a), savedB = await save(b);
  assert.deepEqual(items(savedA), items(savedB));
  assert.deepEqual({ ...savedA.quantityCheck, confirmedAt: null }, { ...savedB.quantityCheck, confirmedAt: null });
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedA[k], savedB[k], k);
});

test('9. הגרסה (413 ומעלה), כולל הכותרת ו-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = html.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.ok(Number(v) >= 413, v);
  assert.match(html, new RegExp('<title>הזמנות יטבתה - v' + v + ' ')); assert.match(html, new RegExp('id="verBadge"[^>]*>v' + v + ' '));
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp('yotvata-v' + v));
  // הסימון מהכרטיס חוזר לרשימה — דרך closeScanner, לא דרך סגירת הכרטיס בלבד
  assert.match(html, /function receiptLineScanReturn\(id\) \{\s*receiptLineScanLast = id;\s*closeScanner\(\);/);
  assert.match(html, /receiptLineScanReturn\('lineCheck_' \+ g\.di \+ '_' \+ g\.li\)/);
  assert.match(html, /receiptLineScanReturn\('lineExtra_' \+ k\)/);
});
