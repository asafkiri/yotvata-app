// גרסה 411 — בדיקה שורה-שורה: סריקה חוזרת שואלת "עוד כמה?", והמספר קובע את הסימון (כמו ברמן 163 ותנובה 156).
// 9.11.2026, בעל העסק, מתוך בדיקה אמיתית: (א) "הייתי רוצה שסריקה כזאת תגיד: סרקת עד עכשיו 1 — עוד כמה תרצה לסרוק? ובצד
// עדיין להשאיר כמה יש בתעודה"; (ב) "אני רושם ב'אחרת' את הכמות המדויקת שהבאתי, והוא לא משנה ל'הגיע' — זה לא אמור להיות ככה".
// אותם נתונים כמו בבדיקות הסריקה (408): תעודה 4471001 (חלב 12, קוטג׳ 6, יוגורט 4) ותעודה 4471002 (חלב 5, שמנת 2); מעדן — לא בתעודות.
// המצלמה מזויפת, הברקוד דרך onScanned.
// מה שנבדק:
// 1. סריקה חוזרת של שורה שסומנה "אחרת" חלקית: "סרקת עד עכשיו 4 מתוך 6", הכמות בתעודה בצד, מה שחסר (2) כבר בשדה, "הוסף";
//    הסיכום "סה״כ 6 · כמו בתעודה" ומשתנה בהקלדה; מספר לא תקין לא נשמר; "הוסף" משלים ל"הגיע" (לא "אחרת" עם 6); המצלמה, הטיוטה, הרשימה.
// 2. שורה שכבר "הגיע" כולה: "— הכל הגיע", השדה ריק; "הוסף" בלי מספר — לא; ✕ לא משנה; עוד 1 (Enter) — עודף; ואז "— עודף 1".
// 3. שורה שסומנה "לא הגיע": "סרקת עד עכשיו 0 מתוך 4", כל הכמות בשדה; Enter — "הגיע".
// 4. "לא נכון? תקן את הסה״כ": הכרטיס הקודם ("כבר סומנה: הגיעו 4 — אפשר לשנות", שלושת הכפתורים); "אחרת" שם מקליד סה״כ, לא תוספת; "לא הגיע".
// 5. "אחרת" במצלמה עם הכמות שבתעודה בדיוק — "הגיע"; עם אפס — "לא הגיע"; מספר אחר — "אחרת" כמו קודם.
// 6. ברשימה: הקלדת הכמות שבתעודה — הכרטיס ירוק ו"הגיע 6" דולק תוך כדי הקלדה, בלי ציור מחדש; 60 — כתום; 0 — אדום; יציאה
//    מהשדה — "הגיע" בנתונים ובטיוטה בלי ציור מחדש; הציור הבא מקפל; הקלדה אחרי שהתיישבה — שוב "אחרת"; אפס — "לא הגיע".
// 7. בלי יציאה מהשדה: "סיום" ו"סרוק מוצר" מיישבים; שוויון מלא מול "הגיע" ביד — עד התעודה השמורה.
// 8. המקרה מהטלפון: מוצר שנסרק חלקית בקליטה (410) ואז נסרק שוב בבדיקה — "סרקת עד עכשיו 3 מתוך 4", "הוסף" משלים.
// 9. הקליטה התחלפה או קריאה בלבד — "הוסף" סוגר את המצלמה בלי לסמן.
// 10. הגרסה.
// הרצה: node --test tools/line-check-scan-add.test.mjs
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
// יציאה משדה הכמות של שורה (focusout על הרשימה)
const blur = (r, lineGot) => r.events.get('receiptQuantityRows:focusout')({ target: { dataset: { lineGot } } });
const cardClick = (r, dataset) => r.run(`receiptLineScanCardClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const cardType = (r, value) => r.run(`receiptLineScanCardInput({ target: { dataset: { scanGot: '' }, value: ${JSON.stringify(value)} } })`);
const cardEnter = r => r.events.get('scanLineCard:keydown')({ key: 'Enter', target: { dataset: { scanGot: '' } }, preventDefault() {} });
const beep = (r, code) => r.run(`onScanned(${JSON.stringify(code)})`);
const later = r => r.run('lastScanTime = 0'); // עברו שתי שניות — אותו ברקוד נחשב סריקה חדשה
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const card = r => r.run(`$('scanLineCard').innerHTML`);
const cardOpen = r => !r.run(`$('scanLineCard').classList.contains('hidden')`);
const overlay = r => r.run(`$('scanOverlayLabel').textContent + ' ' + $('scanOverlayCount').textContent + ' | ' + $('scanOverlayName').textContent`);
const draftMarks = r => JSON.parse(r.storage.get('yt_receipt_draft')).quantityReview.docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
const sum = r => r.run(`$('scanLineSum').textContent`);
const tone = (r, di, li) => r.run(`$('lineCheck_${di}_${li}').className`);
// ה-HTML של שורה אחת (lineCheck_di_li) מתוך הרשימה — עד השורה הבאה או סוף התעודה
function row(r, di, li) {
  const h = rows(r), i = h.indexOf('<div id="lineCheck_' + di + '_' + li + '"');
  assert.ok(i >= 0, 'שורה ' + di + ':' + li + ' קיימת');
  const ends = [h.indexOf('<div id="lineCheck_', i + 10), h.indexOf('<section', i), h.indexOf('</section>', i)].filter(x => x > 0);
  return h.slice(i, Math.min.apply(null, ends));
}
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

test('1. סריקה חוזרת של שורה שסומנה "אחרת" חלקית: "סרקת עד עכשיו 4 מתוך 6", מה שחסר בשדה, ו"הוסף" משלים ל"הגיע"', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, '4'); cardClick(r, { scanSave: '' });
  assert.deepEqual(marks(r), [',qty:4,', ',']);
  later(r); beep(r, BC.cottage);
  assert.equal(cardOpen(r), true);
  assert.deepEqual(json(r, '({ di: receiptLineScanCard.di, li: receiptLineScanCard.li, addQty: receiptLineScanCard.addQty, askQty: receiptLineScanCard.askQty, got: receiptLineScanCard.got })'),
    { di: 0, li: 1, addQty: true, askQty: false, got: '2' });
  const c = card(r);
  assert.match(strip(c), /^שורה 2 בתעודה 1 מתוך 2 קוטג׳ 5% 250 גרם אין מחיר קופה — בדוק בקופה ועדכן סרקת עד עכשיו 4 מתוך 6 6 יח׳ בתעודה עוד כמה\? הוסף סה״כ 6 · כמו בתעודה לא נכון\? תקן את הסה״כ$/);
  assert.match(c, /text-amber-700[^>]*>סרקת עד עכשיו 4 מתוך 6</, 'חלקי — כתום');
  assert.match(c, /id="scanLineGot" data-scan-got[^>]*value="2"/, 'מה שחסר — בשדה');
  assert.match(c, /data-scan-save[^>]*>הוסף</); assert.match(c, /data-scan-mark="fix"/); assert.match(c, /data-scan-dismiss/);
  assert.doesNotMatch(c, /data-scan-mark="(ok|qty|none)"|כבר סומנה|כמה הגיע\?/);
  assert.match(c, /text-3xl[^>]*>6<\/div><div[^>]*>יח׳ בתעודה</, 'הכמות בתעודה נשארת בצד, גדולה');
  // הסיכום תוך כדי הקלדה — הסה״כ אחרי ההוספה; מספר לא תקין לא נשמר
  cardType(r, '1'); assert.equal(sum(r), 'סה״כ 5 · חוסר 1');
  cardType(r, '3'); assert.equal(sum(r), 'סה״כ 7 · עודף 1');
  cardType(r, 'x'); assert.equal(sum(r), 'הקלד כמה עוד הגיעו');
  assert.equal(r.run('receiptLineScanSave()'), false); assert.equal(cardOpen(r), true);
  assert.match(strip(card(r)), /הקלד מספר — כמה עוד הגיעו/); assert.deepEqual(marks(r), [',qty:4,', ','], 'לא נשמר');
  // "הוסף" — 4 + 2 = 6: "הגיע", לא "אחרת" עם 6
  const ticks = r.callbacks.length;
  cardType(r, '2'); cardClick(r, { scanSave: '' });
  assert.equal(cardOpen(r), false);
  assert.deepEqual(marks(r), [',ok,', ',']);
  assert.deepEqual(draftMarks(r), [',ok,', ','], 'נשמר בטיוטה');
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✓ קוטג׳ 5% 250 גרם · עוד 2 — הגיע 6');
  assert.equal(json(r, 'receiptQuantityReview.rows.find(x => x.productId === "cottage")').kind, 'match');
  assert.equal(r.callbacks.length, ticks + 1, 'הסריקה ממשיכה');
  assert.equal(r.run('receiptLineScanLast'), 'lineCheck_0_1');
  // חזרה לרשימה — מקופלת וירוקה, כמו "הגיע" ביד
  r.run('closeScanner()');
  assert.match(strip(row(r, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה$/);
  assert.equal(r.run(`$('lineCheck_0_1').classList.contains('ring-4')`), true, 'מודגשת');
  assert.equal(progress(r), 'סומנו 1 מתוך 5 שורות');
});

test('2. שורה שכבר "הגיע" כולה: "— הכל הגיע" והשדה ריק; ✕ לא משנה; עוד 1 — עודף, ואז "— עודף 1"', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'ok' });
  later(r); beep(r, BC.cottage);
  const c = card(r);
  assert.match(strip(c), /סרקת עד עכשיו 6 מתוך 6 — הכל הגיע 6 יח׳ בתעודה עוד כמה\? הוסף הקלד כמה עוד הגיעו לא נכון\? תקן את הסה״כ$/);
  assert.match(c, /text-emerald-700[^>]*>סרקת עד עכשיו 6 מתוך 6 — הכל הגיע</);
  assert.match(c, /data-scan-got[^>]*value=""/, 'כלום לא חסר — השדה ריק');
  assert.equal(r.run('receiptLineScanSave()'), false, '"הוסף" בלי מספר — לא');
  assert.match(strip(card(r)), /הקלד מספר — כמה עוד הגיעו/);
  const ticks = r.callbacks.length;
  cardClick(r, { scanDismiss: '' });
  assert.equal(cardOpen(r), false); assert.deepEqual(marks(r), [',ok,', ',']); assert.equal(r.callbacks.length, ticks + 1);
  // עוד אחת — עודף
  later(r); beep(r, BC.cottage); cardType(r, '1');
  assert.equal(sum(r), 'סה״כ 7 · עודף 1');
  cardEnter(r);
  assert.equal(cardOpen(r), false);
  assert.deepEqual(marks(r), [',qty:7,', ',']);
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✎ קוטג׳ 5% 250 גרם · עוד 1 — הגיעו 7 מתוך 6');
  assert.equal(json(r, 'receiptQuantityReview.rows.find(x => x.productId === "cottage")').kind, 'surplus');
  later(r); beep(r, BC.cottage);
  assert.match(strip(card(r)), /סרקת עד עכשיו 7 מתוך 6 — עודף 1 6 יח׳ בתעודה עוד כמה\?/);
  assert.match(card(r), /text-amber-700[^>]*>סרקת עד עכשיו 7/); assert.match(card(r), /data-scan-got[^>]*value=""/);
  cardClick(r, { scanDismiss: '' });
});

test('3. שורה שסומנה "לא הגיע" ואז נסרקה: "סרקת עד עכשיו 0 מתוך 4", כל הכמות בשדה; Enter — "הגיע"', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.yogurt); cardClick(r, { scanMark: 'none' });
  assert.deepEqual(marks(r), [',,none', ',']);
  later(r); beep(r, BC.yogurt);
  const c = card(r);
  assert.match(strip(c), /סרקת עד עכשיו 0 מתוך 4 4 יח׳ בתעודה עוד כמה\? הוסף סה״כ 4 · כמו בתעודה/);
  assert.match(c, /text-rose-700[^>]*>סרקת עד עכשיו 0 מתוך 4</); assert.match(c, /data-scan-got[^>]*value="4"/);
  cardEnter(r);
  assert.deepEqual(marks(r), [',,ok', ',']);
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✓ יוגורט טבעי 150 גרם · עוד 4 — הגיע 4');
});

test('4. "לא נכון? תקן את הסה״כ" — הכרטיס הקודם עם שלושת הכפתורים; "אחרת" שם מקליד סה״כ, לא תוספת; "לא הגיע"', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, '4'); cardClick(r, { scanSave: '' });
  later(r); beep(r, BC.cottage);
  cardClick(r, { scanMark: 'fix' });
  assert.equal(cardOpen(r), true);
  const c = card(r);
  assert.match(strip(c), /כבר סומנה: הגיעו 4 — אפשר לשנות 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.match(c, /data-scan-mark="ok"[\s\S]*data-scan-mark="qty"[\s\S]*data-scan-mark="none"/);
  assert.doesNotMatch(c, /data-scan-got|עוד כמה|data-scan-mark="fix"|סרקת עד עכשיו/);
  assert.deepEqual(json(r, '[receiptLineScanCard.addQty, receiptLineScanCard.askQty, receiptLineScanCard.got]'), [false, false, '']);
  // "אחרת" — שדה ריק, "כמה הגיע?", סה״כ: 3 הם 3 (לא 4 + 3)
  cardClick(r, { scanMark: 'qty' });
  assert.match(card(r), /כמה הגיע\?<input id="scanLineGot" data-scan-got[^>]*value=""/); assert.match(card(r), /data-scan-save[^>]*>שמור</);
  cardType(r, '3'); assert.equal(sum(r), 'התקבלו 3 · חוסר 3');
  cardClick(r, { scanSave: '' });
  assert.deepEqual(marks(r), [',qty:3,', ',']);
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✎ קוטג׳ 5% 250 גרם · הגיעו 3 מתוך 6');
  // "לא הגיע" מהכרטיס הקודם
  later(r); beep(r, BC.cottage);
  assert.match(strip(card(r)), /סרקת עד עכשיו 3 מתוך 6/);
  cardClick(r, { scanMark: 'fix' }); cardClick(r, { scanMark: 'none' });
  assert.deepEqual(marks(r), [',none,', ',']);
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✗ קוטג׳ 5% 250 גרם · לא הגיע');
});

test('5. "אחרת" במצלמה עם הכמות שבתעודה בדיוק — "הגיע"; עם אפס — "לא הגיע"; מספר אחר — "אחרת" כמו קודם', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, '6');
  assert.equal(sum(r), 'כמו בתעודה');
  cardClick(r, { scanSave: '' });
  assert.deepEqual(marks(r), [',ok,', ','], '6 מתוך 6 — "הגיע"');
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✓ קוטג׳ 5% 250 גרם · הגיע 6');
  later(r); beep(r, BC.yogurt); cardClick(r, { scanMark: 'qty' }); cardType(r, '0'); cardEnter(r);
  assert.deepEqual(marks(r), [',ok,none', ','], 'אפס — "לא הגיע"');
  assert.equal(overlay(r), 'סומנו 2 מתוך 5 | ✗ יוגורט טבעי 150 גרם · לא הגיע');
  later(r); beep(r, BC.cream); cardClick(r, { scanMark: 'qty' }); cardType(r, '1'); cardClick(r, { scanSave: '' });
  assert.deepEqual(marks(r), [',ok,none', ',qty:1'], 'מספר אחר — "אחרת" עם המספר, כמו קודם');
  assert.equal(overlay(r), 'סומנו 3 מתוך 5 | ✎ שמנת חמוצה 15% 200 מ״ל · הגיעו 1 מתוך 2');
  r.run('closeScanner()');
  assert.match(strip(row(r, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה$/);
  assert.match(strip(row(r, 0, 2)), /^יוגורט טבעי 150 גרם לא הגיע · 0 מתוך 4 שנה$/);
  assert.match(row(r, 1, 1), /data-line-got="1:1"[^>]*value="1"/);
  assert.equal(progress(r), 'סומנו 3 מתוך 5 שורות · חוסר 5 יח׳');
});

test('6. ברשימה: הכמות שבתעודה — ירוק ו"הגיע" דולק תוך כדי הקלדה בלי ציור מחדש; יציאה מהשדה — "הגיע"; הציור הבא מקפל', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:1:qty' });
  assert.match(row(r, 0, 1), /data-line-mark="0:1:qty" aria-pressed="true"/);
  assert.match(row(r, 0, 1), /class="rounded-2xl border-2 p-3 mb-2\.5 shadow-sm border-amber-300 bg-amber-50"/);
  const before = rows(r);
  type(r, { lineGot: '0:1' }, '6');
  assert.equal(rows(r), before, 'בלי ציור מחדש תוך כדי הקלדה — השדה והמקלדת נשארים');
  assert.deepEqual(marks(r), [',qty:6,', ','], 'בנתונים עדיין "אחרת" עם 6 — עד שעוזבים את השדה');
  assert.equal(tone(r, 0, 1), 'rounded-2xl border-2 p-3 mb-2.5 shadow-sm border-emerald-300 bg-emerald-50', 'הכרטיס ירוק');
  assert.equal(r.run(`$('lineCheckSum_0_1').textContent`), 'כמו בתעודה');
  assert.equal(progress(r), 'סומנו 1 מתוך 5 שורות');
  // ממשיכים להקליד: 60 — שוב כתום ו"אחרת"; 0 — אדום; ריק — כתום ולא סומנה
  type(r, { lineGot: '0:1' }, '60');
  assert.match(tone(r, 0, 1), /border-amber-300 bg-amber-50$/); assert.deepEqual(marks(r), [',qty:60,', ',']);
  assert.equal(progress(r), 'סומנו 1 מתוך 5 שורות · עודף 54 יח׳');
  type(r, { lineGot: '0:1' }, '0');
  assert.match(tone(r, 0, 1), /border-rose-300 bg-rose-50$/, 'אפס — אדום');
  type(r, { lineGot: '0:1' }, '');
  assert.match(tone(r, 0, 1), /border-amber-300 bg-amber-50$/); assert.equal(progress(r), 'סומנו 0 מתוך 5 שורות');
  type(r, { lineGot: '0:1' }, '6');
  // יציאה מהשדה — "הגיע" בנתונים ובטיוטה; הרשימה לא צוירה מחדש (הלחיצה שגרמה ליציאה לא נבלעת)
  const shown = rows(r);
  blur(r, '0:1');
  assert.deepEqual(marks(r), [',ok,', ',']);
  assert.deepEqual(draftMarks(r), [',ok,', ',']);
  assert.equal(rows(r), shown, 'בלי ציור מחדש ביציאה מהשדה');
  // הקלדה אחרי שהתיישבה (השדה עדיין על המסך) — שוב "אחרת" עם המספר; ושוב יציאה
  type(r, { lineGot: '0:1' }, '60'); assert.deepEqual(marks(r), [',qty:60,', ',']);
  type(r, { lineGot: '0:1' }, '6'); blur(r, '0:1'); assert.deepEqual(marks(r), [',ok,', ',']);
  // הפעולה הבאה מציירת — מקופלת וירוקה, בדיוק כמו "הגיע" ביד
  click(r, { lineMark: '0:0:ok' });
  assert.match(strip(row(r, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה$/);
  assert.equal(progress(r), 'סומנו 2 מתוך 5 שורות');
  // "שנה" פותח אותה כמו שורת "הגיע": "הגיע 6" דולק, בלי שדה
  click(r, { lineOpen: '0:1' });
  assert.match(row(r, 0, 1), /data-line-mark="0:1:ok" aria-pressed="true"/); assert.doesNotMatch(row(r, 0, 1), /data-line-got/);
  // אפס ויציאה — "לא הגיע"
  click(r, { lineMark: '0:2:qty' }); type(r, { lineGot: '0:2' }, '0'); blur(r, '0:2');
  assert.deepEqual(marks(r), ['ok,ok,none', ',']);
  click(r, { lineOpen: '0:0' });
  assert.match(strip(row(r, 0, 2)), /^יוגורט טבעי 150 גרם לא הגיע · 0 מתוך 4 שנה$/);
  // מספר אחר — נשאר "אחרת" פתוח, כמו קודם
  click(r, { lineMark: '1:1:qty' }); type(r, { lineGot: '1:1' }, '1'); blur(r, '1:1');
  assert.deepEqual(marks(r), ['ok,ok,none', ',qty:1']);
  click(r, { lineOpen: '0:0' });
  assert.match(row(r, 1, 1), /data-line-got="1:1"[^>]*value="1"/); assert.match(row(r, 1, 1), /data-line-mark="1:1:qty" aria-pressed="true"/);
  assert.equal(progress(r), 'סומנו 4 מתוך 5 שורות · חוסר 5 יח׳');
});

test('7. בלי יציאה מהשדה: "סיום" ו"סרוק מוצר" מיישבים; שוויון מלא מול "הגיע" ביד — עד התעודה השמורה', async () => {
  // א: הכול "הגיע" ביד חוץ מקוטג׳ — "אחרת" עם 6, והשדה לא ננטש; "סיום" מיישב ושומר
  const a = await twoPapers();
  a.run('startReceiptLineCheck()');
  review(a).docs.forEach((d, di) => d.lines.forEach((l, li) => { if (!(di === 0 && li === 1)) click(a, { lineMark: di + ':' + li + ':ok' }); }));
  click(a, { lineMark: '0:1:qty' }); type(a, { lineGot: '0:1' }, '6');
  assert.deepEqual(marks(a), ['ok,qty:6,ok', 'ok,ok']);
  assert.equal(a.run(`$('receiptQuantityConfirm').textContent`), 'סיום — שמור את הבדיקה');
  const rowsA = json(a, 'receiptQuantityReview.rows');
  assert.equal(a.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(marks(a), ['ok,ok,ok', 'ok,ok'], '"סיום" יישב את השורה');
  // ב: הכול ביד
  const b = await twoPapers();
  b.run('startReceiptLineCheck()'); markRestOk(b);
  assert.deepEqual(rowsA, json(b, 'receiptQuantityReview.rows'), 'אותן שורות לכל מוצר עוד לפני "סיום"');
  assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(a, 'receiptList'), json(b, 'receiptList'));
  assert.deepEqual(json(a, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 2', 'milk 17', 'yogurt 4']);
  const audit = r => json(r, '({ ...receiptQuantityCheckAudit(), confirmedAt: null })');
  assert.deepEqual(audit(a), audit(b), 'מה שנשמר בקליטה — זהה');
  const savedA = await save(a), savedB = await save(b);
  assert.deepEqual(items(savedA), items(savedB));
  assert.deepEqual({ ...savedA.quantityCheck, confirmedAt: null }, { ...savedB.quantityCheck, confirmedAt: null });
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedA[k], savedB[k], k);
  // "סרוק מוצר" מיישב לפני שהרשימה מתחבאת — המונה על המצלמה כבר סופר את השורה, ובחזרה היא מקופלת
  const c = await twoPapers();
  c.run('startReceiptLineCheck()');
  click(c, { lineMark: '0:1:qty' }); type(c, { lineGot: '0:1' }, '6');
  c.events.get('receiptLineScan:click')(); await settle();
  assert.deepEqual(marks(c), [',ok,', ',']);
  assert.equal(c.run(`$('scanOverlayCount').textContent`), '1 מתוך 5');
  c.run('closeScanner()');
  assert.match(strip(row(c, 0, 1)), /^קוטג׳ 5% 250 גרם הגיע · 6 יח׳ שנה$/);
});

test('8. המקרה מהטלפון: מוצר שנסרק חלקית בקליטה (410) ואז נסרק שוב בבדיקה — "סרקת עד עכשיו 3 מתוך 4", "הוסף" משלים', async () => {
  const r = await twoPapers();
  r.run(`receiptList = [{ productId: 'yogurt', name: 'יוגורט טבעי 150 גרם', barcode: '7290000000022', qty: 3 }]; saveReceiptDraft(); receiptCountingMode = 'scan'; testConfirms = [];`);
  r.run('startReceiptLineCheck()');
  assert.equal(r.run('testConfirms.length'), 1); r.run('testConfirms[0].cb()');
  assert.deepEqual(marks(r), [',,qty:3', ','], 'מה שנסרק עבר לרשימה כ"אחרת" עם 3');
  r.events.get('receiptLineScan:click')(); await settle();
  assert.equal(r.run(`$('scanOverlayCount').textContent`), '1 מתוך 5');
  beep(r, BC.yogurt);
  assert.match(strip(card(r)), /^שורה 3 בתעודה 1 מתוך 2 יוגורט טבעי 150 גרם אין מחיר קופה — בדוק בקופה ועדכן סרקת עד עכשיו 3 מתוך 4 4 יח׳ בתעודה עוד כמה\? הוסף סה״כ 4 · כמו בתעודה לא נכון\? תקן את הסה״כ$/);
  assert.match(card(r), /data-scan-got[^>]*value="1"/);
  cardClick(r, { scanSave: '' });
  assert.deepEqual(marks(r), [',,ok', ',']);
  assert.equal(overlay(r), 'סומנו 1 מתוך 5 | ✓ יוגורט טבעי 150 גרם · עוד 1 — הגיע 4');
  r.run('closeScanner()');
  assert.match(strip(row(r, 0, 2)), /^יוגורט טבעי 150 גרם הגיע · 4 יח׳ שנה$/);
});

test('9. הקליטה התחלפה או קריאה בלבד — "הוסף" בכרטיס של סריקה חוזרת סוגר את המצלמה בלי לסמן', async () => {
  const r = await scanning(await twoPapers());
  beep(r, BC.cottage); cardClick(r, { scanMark: 'qty' }); cardType(r, '4'); cardClick(r, { scanSave: '' });
  later(r); beep(r, BC.cottage);
  assert.equal(cardOpen(r), true);
  r.run('canEditDraft = () => false');
  cardClick(r, { scanSave: '' });
  assert.equal(cardOpen(r), false); assert.equal(r.run('scanPurpose'), 'field');
  assert.equal(r.run(`$('scanModal').classList.contains('hidden')`), true);
  assert.deepEqual(marks(r), [',qty:4,', ',']);
  // הקליטה התחלפה בזמן שהכרטיס פתוח (טלפון אחר סגר אותה)
  const q = await scanning(await twoPapers());
  beep(q, BC.cottage); cardClick(q, { scanMark: 'qty' }); cardType(q, '4'); cardClick(q, { scanSave: '' });
  later(q); beep(q, BC.cottage);
  q.run('receiptLocalEpoch++');
  cardEnter(q);
  assert.equal(cardOpen(q), false); assert.equal(q.run('scanPurpose'), 'field'); assert.deepEqual(marks(q), [',qty:4,', ',']);
});

test('10. הגרסה (411 ומעלה), כולל הכותרת ו-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = html.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.ok(Number(v) >= 411, v);
  assert.match(html, new RegExp('<title>הזמנות יטבתה - v' + v + ' ')); assert.match(html, new RegExp('id="verBadge"[^>]*>v' + v + ' '));
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp('yotvata-v' + v));
});
