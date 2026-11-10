// v408 — סריקה בתוך הבדיקה שורה-שורה. בקשת המשתמשים (8.11.2026): לא לבחור בין "לסרוק" ל"לבדוק שורה-שורה" — באותה בדיקה
// סורקים מוצר והשורה שלו מסומנת, או מסמנים ביד; מוצר שאינו בתעודה נכנס ל"הגיע בנוסף". אותם נתונים מומצאים כמו ב-line-check.test.mjs
// (שתי תעודות, חלב בשתיהן). המצלמה מזויפת: BarcodeDetector ו-getUserMedia מדומים, והברקוד "נקרא" דרך onScanned — כמו בבדיקות הסריקה.
// מה שנבדק:
// 1. "סרוק מוצר" בתחתית הקבועה של החלון, ליד "סיום" — רק בבדיקה שורה-שורה; "חוסרים ועודפים" כמו קודם. ההסבר בכותרת.
// 2. פתיחת הסריקה: החלון מוסתר, המצלמה במצב רציף עם "סומנו 0 מתוך 4", הכותרת והרמז; ✕ מחזיר לרשימה בלי לסמן.
// 3. ברקוד של שורה: הכרטיס מעל המצלמה (שורה N, השם, מחיר הקופה, הכמות בתעודה); "הגיע N" מסמן בדיוק כמו לחיצה ברשימה —
//    הטיוטה, השורות לכל מוצר; הלולאה מושהית כשהכרטיס פתוח. 413: הסימון סוגר את המצלמה וחוזר לרשימה, לשורה שסומנה (מודגשת);
//    "סרוק מוצר" שוב — המונה על המצלמה מעודכן.
// 4. "אחרת": שדה כמות, הסיכום תוך כדי הקלדה, כמות לא תקינה לא נשמרת, Enter שומר; "לא הגיע"; ✕ בכרטיס סוגר בלי לסמן — והמצלמה נשארת.
// 5. אותו מוצר בשתי תעודות — 412: קבוצה אחת (כרטיס אחד של 17, "הגיע 17" לשתי השורות); סריקה חוזרת — "סרקת עד עכשיו … — עוד
//    כמה?", "תקן את הסה״כ" מחזיר את שלושת הכפתורים, ו"אחרת" מתחלק אוטומטית (10 בראשונה, 0 בשנייה).
// 6. מוצר שאינו באף תעודה: "לא בתעודה — הגיע בנוסף" עם כמות, נכנס ל"הגיע משהו נוסף"; סריקה חוזרת — "כבר ברשימה", "עדכן".
// 7. ברקוד שאינו במאגר: ההודעה של הקליטה, הסריקה ממשיכה, כלום לא השתנה. אותו ברקוד פעמיים ברצף (אחרי ✕ בכרטיס) — נספר
//    פעם אחת; אחרי סימון וחזרה לרשימה, "סרוק מוצר" פותח מצלמה נקייה — אותו ברקוד הוא סריקה חוזרת (413).
// 8. יחידה מול מארז חיוב: סורקים את המארז כשבתעודה היחידה (ולהפך) — השורה של הקרוב, לא "הגיע בנוסף".
// 9. ברקוד שקיים בשני מוצרים במאגר — נפתר למוצר שבנייר.
// 10. שוויון: אותה תעודה מסומנת פעם בסריקה ופעם ביד — אותן שורות, אותו "סיום", אותה ספירה ואותה תעודה שמורה.
// 11. הקליטה התחלפה (epoch) או מצב קריאה בלבד — המצלמה נסגרת בלי לסמן. הסריקה בחלון המצלמה נחשבת עריכת קליטה (handoff).
// 12. הגרסה.
// הרצה: node --test tools/line-check-scan.test.mjs
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
const beep = (r, code) => r.run(`onScanned(${JSON.stringify(code)})`);
// עברו שתי שניות — אותו ברקוד נחשב סריקה חדשה (בבדיקה הזמן אמיתי, אז מזיזים את השעון של הסריקה האחרונה)
const later = r => r.run('lastScanTime = 0');
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const card = r => r.run(`$('scanLineCard').innerHTML`);
const cardOpen = r => !r.run(`$('scanLineCard').classList.contains('hidden')`);
const overlay = r => r.run(`$('scanOverlayLabel').textContent + ' ' + $('scanOverlayCount').textContent + ' | ' + $('scanOverlayName').textContent`);
const modalHidden = r => r.run(`$('receiptQuantityModal').classList.contains('hidden')`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
// v413: כל סימון מהכרטיס סוגר את המצלמה וחוזר לרשימה, לשורה שסומנה (מודגשת); למוצר הבא — "סרוק מוצר" שוב
function returned(r, id) {
  assert.equal(cardOpen(r), false, 'הכרטיס נסגר'); assert.equal(r.run('receiptLineScanCard'), null);
  assert.equal(r.run('scanPurpose'), 'field'); assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), true, 'המצלמה נסגרה');
  assert.equal(modalHidden(r), false, 'הרשימה חזרה');
  assert.equal(r.run(`$('${id}').classList.contains('ring-4')`), true, id + ' — השורה שסומנה מודגשת');
  assert.equal(r.run('receiptLineScanLast'), null, 'ההדגשה כבר נעשתה');
}
async function rescan(r) { r.events.get('receiptLineScan:click')(); await settle(); assert.equal(r.run('scanPurpose'), 'linecheck', 'המצלמה נפתחה שוב'); return r; }
const draftMarks = r => JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
function markRestOk(r) {
  review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!l.mark) click(r, { lineMark: di + ':' + li + ':ok' }); }));
}
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
const financialFields = ['lines', 'ex', 'calculatedEx', 'receivedEx', 'roundingAdjustment', 'grossEx', 'supplierDiscount', 'supplierPromoItems', 'supplierPromoMismatchItems', 'supplierCreditClaim', 'noteTotal', 'status', 'noteParts', 'unresolvedAmountGap', 'unresolvedUnitsGap'];
function finance(r) { const p = JSON.parse(JSON.stringify(json(r, 'pendingReceipt'), (k, v) => k === 'recordedAt' || k === 'operationId' ? undefined : v)); return Object.fromEntries(financialFields.filter(k => k in p).map(k => [k, p[k]])); }
const items = rc => rc.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

test('1. "סרוק מוצר" בתחתית הקבועה ליד "סיום" — רק בבדיקה שורה-שורה; "חוסרים ועודפים" כמו קודם', async () => {
  const r = await twoPapers();
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // המבנה: התחתית מחוץ לגוף הנגלל (shrink-0, אחרי receiptQuantityBody), ובה "סרוק מוצר" ואז "סיום"
  assert.match(html, /<div id="receiptQuantityBody" class="p-4 overflow-y-auto min-h-0">[\s\S]*?<div id="receiptQuantityFooter" class="[^"]*border-t border-slate-100 shrink-0 grid gap-2"><button id="receiptLineScan"[^>]*>[\s\S]*?סרוק מוצר<\/button><button id="receiptQuantityConfirm"/);
  r.run('startReceiptLineCheck()');
  assert.equal(r.run(`$('receiptLineScan').classList.contains('hidden')`), false, 'הכפתור גלוי');
  assert.equal(r.run(`$('receiptQuantityFooter').classList.contains('grid-cols-[1.15fr_1fr]')`), true, 'שני כפתורים זה לצד זה — "סרוק" רחב יותר');
  assert.equal(r.run(`$('receiptQuantityIntro').textContent`), 'סרוק מוצר מהסחורה, או סמן ביד בכל שורה: הגיע, כמות אחרת או לא הגיע.');
  assert.equal(r.run(`$('receiptQuantityConfirm').textContent`), 'סיום (נשארו 4)');
  assert.match(r.run(`$('receiptQuantityConfirm').className`), /bg-slate-400/);
  // הבדיקה הקיימת — הכפתור היחיד, בדיוק כמו קודם
  r.run('closeReceiptQuantityReview(); startReceiptQuantityReview(false)');
  assert.equal(r.run(`$('receiptLineScan').classList.contains('hidden')`), true);
  assert.equal(r.run(`$('receiptQuantityFooter').classList.contains('grid-cols-[1.15fr_1fr]')`), false);
  assert.equal(r.run(`$('receiptQuantityIntro').textContent`), 'סמן רק את ההפרשים שמצאת. בסיום תאשר ששאר הכמויות תואמות.');
  assert.equal(r.run(`$('receiptQuantityConfirm').className`), 'btn-tap w-full bg-blue-600 text-white rounded-xl py-3 font-black text-base');
  assert.equal(r.run(`$('receiptQuantityConfirm').textContent`), 'אשר הפרשים — שאר הכמויות תואמות');
});

test('2. פתיחת הסריקה: החלון מוסתר והמצלמה רציפה עם "סומנו 0 מתוך 4"; ✕ מחזיר לרשימה בלי לסמן', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  assert.equal(modalHidden(r), false);
  r.events.get('receiptLineScan:click')();
  assert.equal(r.run('scanPurpose'), 'linecheck');
  assert.equal(modalHidden(r), true, 'החלון מוסתר — המצלמה בשכבה שמתחתיו');
  await settle();
  assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), false, 'המצלמה פתוחה');
  assert.equal(r.run('!!scanStream'), true, 'הזרם התקבל (מזויף)');
  assert.equal(r.run(`$('scanOverlay').classList.contains('hidden')`), false, 'מצב רציף — המונה מוצג');
  assert.equal(overlay(r), 'סומנו 0 מתוך 4 | ');
  assert.equal(r.run(`$('scanTitle').textContent`), 'בדיקה שורה-שורה — סריקה');
  assert.equal(r.run(`$('scanHint').textContent`), 'סרוק מוצר מהסחורה — ✕ חוזר לרשימה');
  assert.equal(r.run(`$('scanPriceNotice').classList.contains('hidden')`), true, 'הודעת המחירים של הקליטה בסריקה — לא כאן');
  assert.equal(cardOpen(r), false);
  // סורקים — הכרטיס פתוח — ואז ✕ במצלמה: חזרה לרשימה בלי לסמן, ובלי שורה מודגשת
  beep(r, '7290000000015');
  assert.equal(cardOpen(r), true);
  r.events.get('scanClose:click')();
  assert.equal(r.run('scanPurpose'), 'field');
  assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), true);
  assert.equal(modalHidden(r), false, 'החלון חזר');
  assert.equal(r.run(`$('receiptQuantityTitle').textContent`), 'בדיקה שורה-שורה');
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות');
  assert.deepEqual(marks(r), [',,', ',']);
  assert.equal(r.run(`$('lineCheck_0_1').classList.contains('ring-4')`), false, 'כלום לא סומן — שום שורה לא מודגשת');
  assert.equal(cardOpen(r), false);
  assert.equal(r.run('receiptLineScanCard'), null);
  // v413: סימון מהכרטיס — המצלמה נסגרת לבד, והרשימה חוזרת על השורה שסומנה
  await rescan(r);
  beep(r, '7290000000015'); cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_1');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  // המצלמה של הקליטה בסריקה — הכותרת והמונה כמו קודם
  r.run("scanPurpose = 'receiving'"); await r.run('openScanner()'); await settle();
  assert.equal(r.run(`$('scanTitle').textContent`), 'סריקת ברקוד');
  assert.equal(r.run(`$('scanOverlayLabel').textContent`), 'פריטים:');
  assert.equal(r.run(`$('scanHint').textContent`), 'סרוק פריטים — לחץ ✕ לסיום');
  r.run('closeScanner()');
});

test('3. ברקוד של שורה: הכרטיס מעל המצלמה, ו"הגיע N" מסמן בדיוק כמו לחיצה ברשימה — וחוזר לשורה שלה (413)', async () => {
  const r = await scanning(await twoPapers());
  const ticks = r.callbacks.length;
  beep(r, '7290000000015'); // קוטג׳ — שורה 2 בתעודה 1
  assert.equal(cardOpen(r), true);
  const c = card(r);
  assert.match(strip(c), /^שורה 2 בתעודה 1 מתוך 2 קוטג׳ 5% 250 גרם אין מחיר קופה — בדוק בקופה ועדכן 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.match(c, /data-scan-dismiss/); assert.match(c, /data-scan-mark="ok"[\s\S]*data-scan-mark="qty"[\s\S]*data-scan-mark="none"/);
  assert.doesNotMatch(c, /data-scan-got|כבר סומנה/);
  assert.deepEqual(json(r, '({ kind: receiptLineScanCard.kind, di: receiptLineScanCard.di, li: receiptLineScanCard.li })'), { kind: 'line', di: 0, li: 1 });
  assert.equal(r.callbacks.length, ticks, 'כרטיס פתוח — לא תוזמן טיק (הלולאה מושהית)');
  assert.equal(r.run("lastScanCode"), '7290000000015');
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_1'); // v413: המצלמה נסגרה, הרשימה חזרה, והשורה שסומנה מודגשת
  assert.deepEqual(marks(r), [',ok,', ',']);
  assert.deepEqual(draftMarks(r), [',ok,', ','], 'נשמר בטיוטה כמו סימון ביד');
  assert.equal(review(r).confirmedAt, null);
  assert.equal(json(r, 'receiptQuantityReview.rows.map(x => x.productId + " " + x.kind + " " + x.difference).sort().join(" | ")'), 'cottage match 0 | cream match 0 | milk match 0 | yogurt match 0');
  assert.equal(r.callbacks.length, ticks, 'המצלמה נסגרה — לא תוזמן טיק של סריקה');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  assert.match(strip(r.run(`$('receiptQuantityRows').innerHTML`)), /קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה/, 'מקופלת וירוקה, כמו "הגיע" ביד');
  // "סרוק מוצר" שוב — המונה על המצלמה מעודכן, בלי כרטיס ובלי "מה סומן זה עתה"
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 1 מתוך 4 | ');
  assert.equal(cardOpen(r), false);
  // מחיר קופה וארגזים בכרטיס — כמו בשורה ברשימה
  r.run(`products.find(p => p.id === 'yogurt').boxSize = 2;`);
  beep(r, '7290000000022');
  assert.match(strip(card(r)), /^שורה 3 בתעודה 1 מתוך 2 יוגורט טבעי 150 גרם אין מחיר קופה — בדוק בקופה ועדכן 4 יח׳ בתעודה 2 ארגזים × 2 הגיע 4 אחרת לא הגיע$/);
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_2');
  await rescan(r);
  beep(r, '7290000000039'); // שמנת — תעודה 2
  assert.match(strip(card(r)), /^שורה 2 בתעודה 2 מתוך 2 שמנת חמוצה/);
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_1_1');
  assert.equal(progress(r), 'סומנו 3 מתוך 4 שורות');
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 3 מתוך 4 | ');
  // תעודה אחת — "שורה 2 בתעודה", בלי "מתוך"
  const one = await scanning(await scan([BIG]));
  one.run(`products.find(p => p.id === 'cottage').posPrice = 12.9;`);
  beep(one, '7290000000015');
  assert.match(strip(card(one)), /^שורה 2 בתעודה קוטג׳ 5% 250 גרם בקופה: ₪12\.90 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.ok(card(one).includes(one.run(`posPriceLineHtml(products.find(p => p.id === 'cottage'))`)), 'מחיר הקופה — אותה שורה כמו ברשימה ובסריקה');
});

test('4. "אחרת" עם כמות, "לא הגיע", ו-✕ בכרטיס שסוגר בלי לסמן', async () => {
  const r = await scanning(await twoPapers());
  beep(r, '7290000000015');
  cardClick(r, { scanMark: 'qty' });
  assert.equal(cardOpen(r), true);
  const c = card(r);
  assert.match(c, /id="scanLineGot" data-scan-got[^>]*value=""/); assert.match(c, /data-scan-save[^>]*>שמור</);
  assert.doesNotMatch(c, /data-scan-mark=/);
  assert.match(c, /id="scanLineSum"[^>]*>הקלד כמה יחידות הגיעו</);
  // כמות לא תקינה — לא נשמר, הכרטיס אומר
  cardType(r, 'x');
  assert.equal(r.run('receiptLineScanSave()'), false);
  assert.equal(cardOpen(r), true);
  assert.match(strip(card(r)), /הקלד מספר — כמה יחידות הגיעו/);
  assert.deepEqual(marks(r), [',,', ',']);
  // כמות תקינה — הסיכום תוך כדי הקלדה, והשמירה (Enter) מסמנת "אחרת" עם הכמות
  cardType(r, '4');
  assert.equal(r.run(`$('scanLineSum').textContent`), 'התקבלו 4 · חוסר 2');
  cardType(r, '6'); assert.equal(r.run(`$('scanLineSum').textContent`), 'כמו בתעודה');
  cardType(r, '4');
  r.events.get('scanLineCard:keydown')({ key: 'Enter', target: { dataset: { scanGot: '' } }, preventDefault() {} });
  returned(r, 'lineCheck_0_1'); // v413: חזרה לרשימה — השורה של "אחרת" פתוחה עם הכמות, מודגשת
  assert.deepEqual(marks(r), [',qty:4,', ',']);
  assert.equal(json(r, 'receiptQuantityReview.rows.find(x => x.productId === "cottage")').kind, 'shortage');
  assert.match(r.run(`$('receiptQuantityRows').innerHTML`), /data-line-got="0:1"[^>]*value="4"/);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות · חוסר 2 יח׳');
  // "לא הגיע"
  await rescan(r); beep(r, '7290000000039');
  cardClick(r, { scanMark: 'none' });
  returned(r, 'lineCheck_1_1');
  assert.deepEqual(marks(r), [',qty:4,', ',none']);
  assert.match(strip(r.run(`$('receiptQuantityRows').innerHTML`)), /שמנת חמוצה 15% 200 מ״ל לא הגיע · 0 מתוך 2 שנה/, '"לא הגיע" מקופלת');
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 4 יח׳');
  // ✕ בכרטיס — כלום לא משתנה, המצלמה נשארת והסריקה ממשיכה
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 2 מתוך 4 | ');
  const ticks = r.callbacks.length;
  beep(r, '7290000000022');
  assert.equal(cardOpen(r), true);
  cardClick(r, { scanDismiss: '' });
  assert.equal(cardOpen(r), false);
  assert.equal(r.run('scanPurpose'), 'linecheck'); assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), false, '✕ בכרטיס — המצלמה נשארת');
  assert.equal(modalHidden(r), true);
  assert.deepEqual(marks(r), [',qty:4,', ',none']);
  assert.equal(r.callbacks.length, ticks + 1, 'טיק אחד — הסריקה ממשיכה');
  assert.equal(overlay(r), 'סומנו 2 מתוך 4 | ', 'המונה כמו שהיה');
  // ✕ במצלמה — חזרה לרשימה כמו שהיא
  r.run('closeScanner()');
  assert.equal(modalHidden(r), false);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 4 יח׳');
});

test('5. אותו מוצר בשתי תעודות — קבוצה אחת (412): כרטיס אחד של 17, "הגיע 17" לשתי השורות, סריקה חוזרת "סרקת עד עכשיו … — עוד כמה?", ו"תקן את הסה״כ" מחלק 10 + 0', async () => {
  const r = await scanning(await twoPapers());
  beep(r, '7290000000008'); // חלב — 12 בתעודה 1, 5 בתעודה 2: קבוצה אחת של 17
  assert.deepEqual(json(r, '[receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.addQty]'), [0, 0, false]);
  assert.match(strip(card(r)), /^שורה 1 בתעודה 1 מתוך 2 · גם בתעודה 2 \(5 יח׳\) חלב 3% בקרטון 1 ליטר בקופה: ₪6\.90 17 יח׳ ב-2 תעודות 12 \+ 5 הגיע 17 אחרת לא הגיע$/);
  assert.doesNotMatch(strip(card(r)), /שורה נוספת|סרוק שוב/);
  cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_0'); // v413: חזרה לכרטיס של הקבוצה ברשימה
  assert.deepEqual(marks(r), ['ok,,', 'ok,'], '"הגיע 17" — שתי השורות');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  // "סרוק מוצר" ואותו ברקוד שוב — סריקה חוזרת של אותה קבוצה
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 1 מתוך 4 | ');
  beep(r, '7290000000008');
  assert.deepEqual(json(r, '[receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.addQty]'), [0, 0, true]);
  assert.match(strip(card(r)), /סרקת עד עכשיו 17 מתוך 17 — הכל הגיע 17 יח׳ ב-2 תעודות 12 \+ 5 עוד כמה\? הוסף הקלד כמה עוד הגיעו לא נכון\? תקן את הסה״כ$/);
  assert.doesNotMatch(card(r), /data-scan-mark="(ok|qty|none)"/);
  cardClick(r, { scanMark: 'fix' });
  assert.match(strip(card(r)), /כבר סומנה: הגיע — אפשר לשנות 17 יח׳ ב-2 תעודות 12 \+ 5 הגיע 17 אחרת לא הגיע$/);
  cardClick(r, { scanMark: 'none' });
  returned(r, 'lineCheck_0_0');
  assert.deepEqual(marks(r), ['none,,', 'none,']);
  // "לא הגיע" ואז סריקה — "סרקת עד עכשיו 0 מתוך 17", וכל הכמות כבר בשדה
  await rescan(r); beep(r, '7290000000008');
  assert.match(strip(card(r)), /סרקת עד עכשיו 0 מתוך 17 .* עוד כמה\? הוסף סה״כ 17 · כמו בתעודה/);
  assert.match(card(r), /data-scan-got[^>]*value="17"/);
  // "תקן את הסה״כ" → "אחרת" 10: החלוקה אוטומטית — 10 בתעודה הראשונה, 0 בשנייה ("לא הגיע")
  cardClick(r, { scanMark: 'fix' }); cardClick(r, { scanMark: 'qty' }); cardType(r, '10'); cardClick(r, { scanSave: '' });
  returned(r, 'lineCheck_0_0');
  assert.deepEqual(marks(r), ['qty:10,,', 'none,']);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות · חוסר 7 יח׳');
  await rescan(r); beep(r, '7290000000008');
  assert.match(strip(card(r)), /סרקת עד עכשיו 10 מתוך 17 .* עוד כמה\? הוסף סה״כ 17 · כמו בתעודה/);
  assert.match(card(r), /data-scan-got[^>]*value="7"/, 'מה שחסר — בשדה');
  // "הוסף" 7 — 17: "הגיע", ומתחלק 12 + 5
  cardClick(r, { scanSave: '' });
  returned(r, 'lineCheck_0_0');
  assert.deepEqual(marks(r), ['ok,,', 'ok,']);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
});

test('6. מוצר שאינו באף תעודה: "לא בתעודה — הגיע בנוסף" עם כמות, נכנס ל"הגיע משהו נוסף"; סריקה חוזרת מעדכנת', async () => {
  const r = await scanning(await twoPapers());
  beep(r, '7290000000046'); // מעדן — לא בתעודות
  assert.equal(cardOpen(r), true);
  assert.deepEqual(json(r, '({ kind: receiptLineScanCard.kind, k: receiptLineScanCard.k, got: receiptLineScanCard.got })'), { kind: 'extra', k: -1, got: '1' });
  const c = card(r);
  assert.match(strip(c), /^לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם בקופה: ₪5\.50 7290000000046 כמה הגיע\? הוסף התקבלו 1 · עודף 1$/);
  assert.match(c, /border-amber-300/); assert.match(c, /data-scan-got[^>]*value="1"/); assert.doesNotMatch(c, /data-scan-mark=/);
  cardType(r, '0'); assert.equal(r.run(`$('scanLineSum').textContent`), 'הקלד כמה יחידות הגיעו', '"נוסף" בלי כמות — אין מה להוסיף');
  assert.equal(r.run('receiptLineScanSave()'), false); assert.equal(cardOpen(r), true);
  cardType(r, '3'); assert.equal(r.run(`$('scanLineSum').textContent`), 'התקבלו 3 · עודף 3');
  cardClick(r, { scanSave: '' });
  returned(r, 'lineExtra_0'); // v413: גם מוצר שאינו בתעודה — חזרה לרשימה, לכרטיס הצהוב שלו (מודגש)
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '3']]);
  assert.deepEqual(JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.extras.map(x => [x.productId, x.got]), [['pudding', '3']]);
  assert.deepEqual(json(r, 'receiptQuantityReview.rows.filter(x => x.paperQty === 0).map(x => [x.productId, x.kind, x.difference])'), [['pudding', 'surplus', '3']]);
  assert.match(strip(r.run(`$('receiptQuantityRows').innerHTML`)), /לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם בקופה: ₪5\.50/, 'הכרטיס הצהוב כמו מהחיפוש');
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות · עודף 3 יח׳');
  // שוב — "כבר ברשימה", עם הכמות הנוכחית, "עדכן"; לא נוסף פעמיים
  await rescan(r);
  assert.equal(overlay(r), 'סומנו 0 מתוך 4 | ');
  beep(r, '7290000000046');
  assert.deepEqual(json(r, '({ k: receiptLineScanCard.k, got: receiptLineScanCard.got })'), { k: 0, got: '3' });
  assert.match(strip(card(r)), /^כבר ברשימה ״הגיע משהו נוסף״ מעדן שוקולד 125 גרם .* עדכן התקבלו 3 · עודף 3$/);
  cardType(r, '5'); cardClick(r, { scanSave: '' });
  returned(r, 'lineExtra_0');
  assert.deepEqual(review(r).extras.map(x => [x.productId, x.got]), [['pudding', '5']]);
  assert.match(r.run(`$('receiptQuantityRows').innerHTML`), /data-extra-got="0"[^>]*value="5"/);
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות · עודף 5 יח׳');
});

test('7. ברקוד שאינו במאגר — ההודעה של הקליטה והסריקה ממשיכה; אותו ברקוד פעמיים ברצף — פעם אחת', async () => {
  const r = await scanning(await twoPapers());
  const ticks = r.callbacks.length;
  beep(r, '7290119390519');
  assert.equal(cardOpen(r), false);
  assert.equal(r.toasts[r.toasts.length - 1], '❌ ברקוד לא קיים במערכת — הוסף את המוצר במסך מוצרים ומחירים וסרוק שוב');
  assert.equal(r.callbacks.length, ticks + 1, 'הסריקה ממשיכה');
  assert.equal(r.run('scanPurpose'), 'linecheck', 'המצלמה נשארת — אין שורה לחזור אליה');
  assert.deepEqual(marks(r), [',,', ',']); assert.deepEqual(review(r).extras, []);
  assert.equal(overlay(r), 'סומנו 0 מתוך 4 | ');
  // אותו ברקוד מיד שוב — אחרי שהכרטיס הקודם נסגר ב-✕ בלי לסמן — לא נספר (המוצר עדיין מול המצלמה)
  beep(r, '7290000000015'); cardClick(r, { scanDismiss: '' });
  assert.ok(r.run('Date.now() - lastScanTime') < 1000, 'השעון של הסריקה האחרונה מתחדש בסגירת הכרטיס');
  beep(r, '7290000000015');
  assert.equal(cardOpen(r), false, 'קריאה כפולה של אותו ברקוד תוך 2 שניות — מתעלמים');
  // קריאה נוספת בזמן שכרטיס פתוח — מתעלמים ולא מתזמנים טיק
  later(r); beep(r, '7290000000022');
  assert.equal(cardOpen(r), true);
  const t2 = r.callbacks.length;
  beep(r, '7290000000039');
  assert.deepEqual(json(r, '[receiptLineScanCard.di, receiptLineScanCard.li]'), [0, 2], 'הכרטיס של היוגורט נשאר');
  assert.equal(r.callbacks.length, t2);
  cardClick(r, { scanDismiss: '' });
  // v413: אחרי סימון וחזרה לרשימה, "סרוק מוצר" פותח מצלמה נקייה — אותו ברקוד מיד הוא סריקה חוזרת של השורה, לא "קריאה כפולה"
  later(r); beep(r, '7290000000015'); cardClick(r, { scanMark: 'ok' });
  returned(r, 'lineCheck_0_1');
  await rescan(r);
  assert.equal(r.run('lastScanCode'), '');
  beep(r, '7290000000015');
  assert.equal(cardOpen(r), true); assert.equal(json(r, 'receiptLineScanCard.addQty'), true, 'סריקה חוזרת — "עוד כמה?"');
  cardClick(r, { scanDismiss: '' });
});

test('8. יחידה מול מארז חיוב: סורקים את המארז כשבתעודה היחידה (ולהפך) — השורה של הקרוב, לא "הגיע בנוסף"', async () => {
  const catalog = products.map(p => p.id === 'milk' ? { ...p, billingPackId: 'milkpack', billingPackSize: 6 } : p)
    .concat([{ id: 'milkpack', name: 'חלב 3% — מארז 6', code: '60', barcode: '7290000000060', price: 30 }]);
  // בתעודה היחידה (חלב), סורקים את המארז
  const a = await scanning(await scan([BIG], {}, catalog));
  beep(a, '7290000000060');
  assert.equal(cardOpen(a), true);
  assert.equal(json(a, 'receiptLineScanCard.kind'), 'line');
  assert.deepEqual(json(a, '[receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.scanned.id, receiptLineScanCard.related.id]'), [0, 0, 'milkpack', 'milk']);
  assert.match(strip(card(a)), /^סרקת חלב 3% — מארז 6 — בתעודה היחידה הבודדת שלו: שורה 1 בתעודה חלב 3% בקרטון 1 ליטר בקופה: ₪6\.90 12 יח׳ בתעודה הגיע 12 אחרת לא הגיע$/);
  cardClick(a, { scanMark: 'ok' });
  returned(a, 'lineCheck_0_0');
  assert.deepEqual(marks(a), ['ok,,']); assert.deepEqual(review(a).extras, [], 'לא נוסף "הגיע בנוסף"');
  // בתעודה המארז, סורקים את היחידה
  const b = await scanning(await scan([paper([['milkpack', 2], ['cottage', 6]], '4471005', catalog)], {}, catalog));
  beep(b, '7290000000008');
  assert.deepEqual(json(b, '[receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.scanned.id, receiptLineScanCard.related.id]'), [0, 0, 'milk', 'milkpack']);
  assert.match(strip(card(b)), /^סרקת חלב 3% בקרטון 1 ליטר — בתעודה מארז החיוב שלו: שורה 1 בתעודה חלב 3% — מארז 6 .* 2 יח׳ בתעודה הגיע 2 אחרת לא הגיע$/);
  cardClick(b, { scanMark: 'qty' }); cardType(b, '1'); cardClick(b, { scanSave: '' });
  returned(b, 'lineCheck_0_0');
  assert.deepEqual(marks(b), ['qty:1,']);
  // המוצר עצמו בתעודה — קודם הוא, בלי הסבר על קרוב
  await rescan(b);
  beep(b, '7290000000015');
  assert.doesNotMatch(strip(card(b)), /סרקת/);
  assert.equal(json(b, 'receiptLineScanCard.related'), null);
  cardClick(b, { scanDismiss: '' });
});

test('9. ברקוד שקיים בשני מוצרים במאגר — נפתר למוצר שבנייר', async () => {
  const catalog = products.concat([{ id: 'cottage_old', name: 'קוטג׳ (פריט ישן)', code: '15', barcode: '7290000000015', price: 7 }]);
  const r = await scanning(await scan([BIG], {}, catalog));
  assert.equal(r.run(`findProductByBarcode('7290000000015').id`), 'cottage', 'הראשון במאגר הוא עדיין הקוטג׳ — ולכן בודקים גם כשהישן ראשון');
  r.run(`products.unshift(products.pop());`); // הפריט הישן ראשון במאגר
  assert.equal(r.run(`findProductByBarcode('7290000000015').id`), 'cottage_old');
  beep(r, '7290000000015');
  assert.deepEqual(json(r, '[receiptLineScanCard.kind, receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.scanned.id]'), ['line', 0, 1, 'cottage']);
  cardClick(r, { scanMark: 'ok' });
  assert.deepEqual(marks(r), [',ok,']); assert.deepEqual(review(r).extras, []);
});

test('10. שוויון: אותה תעודה מסומנת פעם בסריקה ופעם ביד — אותן שורות, אותה ספירה, אותו סיכום ואותה תעודה שמורה', async () => {
  // בסריקה: חלב "אחרת" 10 מתוך 17 בשתי התעודות (412: קבוצה אחת — 10 בראשונה, 0 בשנייה); מעדן 2 בנוסף; השאר הגיע
  const a = await scanning(await twoPapers());
  beep(a, '7290000000008'); cardClick(a, { scanMark: 'qty' }); cardType(a, '10'); cardClick(a, { scanSave: '' });
  returned(a, 'lineCheck_0_0');
  assert.deepEqual(marks(a), ['qty:10,,', 'none,'], 'החלוקה: 10 בראשונה, והשארית (0) בשנייה');
  await rescan(a); beep(a, '7290000000046'); cardType(a, '2'); cardClick(a, { scanSave: '' });
  returned(a, 'lineExtra_0');
  for (const code of ['7290000000015', '7290000000022', '7290000000039']) { await rescan(a); beep(a, code); cardClick(a, { scanMark: 'ok' }); } // v413: כל סימון חוזר לרשימה — "סרוק מוצר" לכל מוצר
  returned(a, 'lineCheck_1_1');
  assert.equal(progress(a), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 7 יח׳ · עודף 2 יח׳');
  assert.equal(a.run(`$('receiptQuantityConfirm').textContent`), 'סיום — שמור את הבדיקה');
  // ביד — אותם סימונים
  const b = await twoPapers();
  b.run('startReceiptLineCheck()');
  click(b, { lineMark: '0:0:qty' }); type(b, { lineGot: '0:0' }, '10'); // "אחרת" 10 על הקבוצה מחלקת בדיוק כך
  type(b, { lineSearch: '' }, 'מעדן'); click(b, { extraAdd: 'pudding' }); type(b, { extraGot: '0' }, '2');
  markRestOk(b);
  // (scanId — מזהה מקומי אקראי של הצילום, שונה בכל הרצה)
  const pick = r => json(r, '({ docs: receiptQuantityReview.docs.map(d => ({ ...d, scanId: null })), extras: receiptQuantityReview.extras, rows: receiptQuantityReview.rows, products: receiptQuantityReview.products })');
  assert.deepEqual(pick(a), pick(b), 'אותה בדיקה בדיוק');
  assert.deepEqual(draftMarks(a), draftMarks(b));
  assert.equal(a.run('finishReceiptLineCheck()'), true); assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(a, 'receiptList'), json(b, 'receiptList'));
  assert.deepEqual(json(a, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 2', 'milk 10', 'pudding 2', 'yogurt 4']);
  closeNormal(a); closeNormal(b);
  assert.deepEqual(finance(a), finance(b));
  const audit = r => json(r, '({ ...receiptQuantityCheckAudit(), confirmedAt: null })'); // (confirmedAt — השעה)
  assert.deepEqual(audit(a), audit(b), 'מה שנשמר בקליטה — זהה, בלי שדה חדש');
  const savedA = await save(a), savedB = await save(b);
  assert.deepEqual(items(savedA), items(savedB));
  assert.deepEqual({ ...savedA.quantityCheck, confirmedAt: null }, { ...savedB.quantityCheck, confirmedAt: null });
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedA[k], savedB[k], k);
});

test('11. הקליטה התחלפה או קריאה בלבד — המצלמה נסגרת בלי לסמן; הכרטיס שמעל המצלמה נחשב עריכת קליטה', async () => {
  const r = await scanning(await twoPapers());
  assert.equal(r.run(`handoffEventKind({ closest: s => s.includes('#scanModal') ? {} : null })`), 'receiving', 'לחיצה בחלון המצלמה בבדיקה שורה-שורה — עריכת קליטה (handoff)');
  // הקליטה התחלפה בזמן שהמצלמה פתוחה (טלפון אחר סגר אותה) — הסריקה הבאה סוגרת את המצלמה, כלום לא מסומן
  r.run('receiptLocalEpoch++');
  beep(r, '7290000000015');
  assert.equal(cardOpen(r), false);
  assert.equal(r.run('scanPurpose'), 'field');
  assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), true);
  assert.deepEqual(marks(r), [',,', ',']);
  // כרטיס פתוח, ואז קריאה בלבד — הלחיצה סוגרת את המצלמה בלי לסמן
  const q = await scanning(await twoPapers());
  beep(q, '7290000000015');
  assert.equal(cardOpen(q), true);
  q.run('canEditDraft = () => false');
  cardClick(q, { scanMark: 'ok' });
  assert.equal(cardOpen(q), false);
  assert.equal(q.run('scanPurpose'), 'field');
  assert.deepEqual(marks(q), [',,', ',']);
  // קריאה בלבד — "סרוק מוצר" לא פותח את המצלמה
  q.run('closeReceiptQuantityReview()'); q.run('receiptQuantityReview = null');
  q.run('canEditDraft = () => true; startReceiptLineCheck(); canEditDraft = () => false');
  q.events.get('receiptLineScan:click')();
  assert.equal(q.run('scanPurpose'), 'field');
  assert.equal(modalHidden(q), false, 'החלון נשאר');
});

test('12. הגרסה (408 ומעלה), כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = html.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.ok(Number(v) >= 408, v);
  assert.match(html, new RegExp('<title>הזמנות יטבתה - v' + v + ' ')); assert.match(html, new RegExp('id="verBadge"[^>]*>v' + v + ' '));
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp('yotvata-v' + v));
});
