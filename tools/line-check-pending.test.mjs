// v417 — הבדיקה שורה-שורה היא הדרך היחידה, והיא נפתחת לפני שהתעודה נקראה — וגם בלי תעודה (כמו בתנובה 163 וברמן 171).
// בעל העסק, 12.11.2026: (1) "שהבדיקה שורה-שורה תהיה האופציה היחידה, כלומר לא תהיה האופציה סריקת מוצרים ('הגיע הכל' ו'לא הגיע כלום'
// עדיין יהיו אופציה)"; (2) "כאשר אני בוחר בדיקה שורה-שורה תהיה אופציה להתחיל לסרוק עוד לפני שהאפליקציה מסיימת לקרוא את התעודה — המשתמש
// מתחיל לסרוק, וכשסריקת התעודה נגמרת עולה כל הרשימה והמשתמש מבחינתו ממשיך את הבדיקה"; (3) "עדיין לתת אופציה להתחיל לסרוק ללא תעודה
// כלל, וגם אפשר לסגור אותה ככה — אבל אם הוא מצרף תעודה באמצע הבדיקה, הבדיקה הופכת להיות שורה-שורה". אותם נתונים מומצאים כמו
// ב-line-check-scan.test.mjs (שתי תעודות, חלב בשתיהן), ואותה מצלמה מזויפת (הברקוד "נקרא" דרך onScanned).
// מה שנבדק:
// 1. "התחל בדיקה שורה-שורה" פותח את החלון מיד, בזמן שהתעודה נקראת: בלי רשימה, עם כרטיס מצב, "סרוק מוצר", ו"סיום" אפור שאומר למה.
// 2. סורקים לפני שהרשימה עלתה: הכרטיס שמעל המצלמה שואל כמה הגיע; סריקה חוזרת — "עוד כמה?"; "תקן את הסה״כ"; חיפוש ביד; ברקוד
//    לא מוכר. מה שנסרק נשמר בספירה (receiptList) ובטיוטה.
// 3. התעודה נקראה — הרשימה עולה באותו חלון, בלי שאלה: כמו בתעודה → "הגיע"; כמות אחרת → "אחרת" עם המספר; לא בתעודה → "הגיע משהו
//    נוסף"; רטט אחד, והודעה בראש החלון. "סיום" — אותה תעודה שמורה כמו סימון ביד.
// 4. התעודה נקראה כשהמצלמה פתוחה: המצלמה לא נסגרת, המונה עובר ל"סומנו", סריקה חדשה כבר מגיעה לשורה שלה; כרטיס שפתוח באותו רגע
//    נבנה מחדש מול הרשימה ומה שהוקלד בו נשאר; החלון מוצג כשהמצלמה נסגרת.
// 5. התעודה נקראה אבל צריך להשלים זיהוי מוצרים: בזמן שהמצלמה פתוחה לא קורה דבר; כשהיא נסגרת — מסך ההשוואה, והספירה נשמרת.
// 6. הקריאה נכשלה: החלון אומר זאת וסורקים הלאה; "בדוק את צילום התעודה" חוזר למסך הקליטה; אחרי התיקון — הרשימה עם מה שנסרק.
// 7. בלי תעודה: אותו חלון ("בדיקה בלי תעודה"); "סיום — שמור בלי תעודה" שומר קליטה בלי תעודה, פתוחה, כמו קודם; המסך שמאחורי החלון.
// 8. בלי תעודה, ואז מצלמים אותה באמצע: מה שנסרק נשאר, והבדיקה הופכת לשורה-שורה כשהתעודה נקראת.
// 9. בלי תעודה, מוצר בלי מחיר קנייה: קודם קובעים מחיר (כמו בקליטה בסריקה), וחוזרים לחלון עם המוצר.
// 10. "לא הגיע כלום" (חדש ביטבתה): שאלה אחת, ואז כל השורות חוסר — בדיוק כמו "לא הגיע" בכל שורה ו"סיום".
// 11. יחידה בודדת שנסרקה כשבתעודה מארז החיוב שלה (ולהפך) — עוברת לשורה שבתעודה כשהכמות מתחלקת; אחרת נשארת "נוסף".
// 12. בדיקה שכבר סומנו בה שורות אינה מוחלפת כשהתעודה נקראת מחדש; בדיקה ממתינה שורדת רענון; קריאה בלבד.
// 13. הגרסה.
// 14. הכפתור הכחול שבתחתית ("בדוק וסיים") פותח את הבדיקה עד שהיא אושרה — לא השוואה של ספירה חלקית מול התעודה; "אחת כבר סומנה".
// הרצה: node --test tools/line-check-pending.test.mjs
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
// הרטט של "הרשימה מוכנה" הוא תבנית ([60, 40, 60]); מספר בודד הוא הצפצוף של סריקת ברקוד
const readyBuzzes = r => json(r, 'buzzes.filter(Array.isArray)');
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
const pagesOf = papers => JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })));
// האפליקציה במסך הקליטה, המצלמה מזויפת, ושירות הפענוח עונה לכל תעודה — ואפשר לעכב אותו (hold) או להפיל אותו (fail)
async function open(papers, opts = {}, catalog = products) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products: catalog, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
  await cloud.tick();
  const original = c.context.fetch;
  let gate = null, broken = false;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    if (gate) await gate;
    if (broken) throw new Error('network down');
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.hold = () => { let release; gate = new Promise(res => release = res); return () => { gate = null; release(); }; };
  c.fail = on => { broken = on; };
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    globalThis.buzzes = []; navigator.vibrate = ms => buzzes.push(ms);
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) };
    $('scanVideo').play = async () => {};
    aiScanDocuments = ${pagesOf(papers)}; renderReceiving();`);
  c.cloud = cloud;
  return c;
}
// "התחל בדיקה שורה-שורה" נלחץ, והפענוח מעוכב: החלון כבר פתוח, התעודה עוד נקראת. release() משחרר את הפענוח.
async function reading(papers, opts, catalog) {
  const c = await open(papers, opts, catalog);
  const release = c.hold();
  c.started = c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`);
  await settle();
  assert.equal(c.run('receiptPaperScanState'), 'running');
  c.release = async () => { release(); await c.started; await settle(); };
  return c;
}
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const cardClick = (r, dataset) => r.run(`receiptLineScanCardClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const cardType = (r, value) => r.run(`receiptLineScanCardInput({ target: { dataset: { scanGot: '' }, value: ${JSON.stringify(value)} } })`);
const beep = (r, code) => { r.run('lastScanTime = 0'); r.run(`onScanned(${JSON.stringify(code)})`); };
const camera = async r => { r.events.get('receiptLineScan:click')(); await settle(); assert.equal(r.run('scanPurpose'), 'linecheck', 'המצלמה נפתחה'); return r; };
const finish = r => r.events.get('receiptQuantityConfirm:click')({});
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const extras = r => review(r).extras.map(x => x.productId + ' ' + x.got);
const list = r => json(r, 'receiptList.map(l => l.productId + " " + l.qty)');
const card = r => r.run(`$('scanLineCard').innerHTML`);
const cardOpen = r => !r.run(`$('scanLineCard').classList.contains('hidden')`);
const overlay = r => r.run(`$('scanOverlayLabel').textContent + ' ' + $('scanOverlayCount').textContent + ' | ' + $('scanOverlayName').textContent`);
const modalOpen = r => r.run(`!$('receiptQuantityModal').classList.contains('hidden')`);
const cameraOpen = r => r.run(`!$('scanModal').classList.contains('hidden')`);
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
const title = r => r.run(`$('receiptQuantityTitle').textContent`);
const okText = r => r.run(`$('receiptQuantityConfirm').textContent`);
const okClass = r => r.run(`$('receiptQuantityConfirm').className`);
const app = r => r.node('app').innerHTML;
const draft = r => JSON.parse(r.storage.get('yt_receipt_draft'));
function runQueued(r) { const fns = r.callbacks.splice(0); fns.forEach(fn => { try { fn(); } catch (e) {} }); return fns.length; }
// סריקה של מוצר לפני שהרשימה עלתה: המצלמה, הברקוד, הכמות ו"הוסף" — וחזרה לרשימה
async function scanQty(r, code, qty) {
  await camera(r); beep(r, code);
  assert.equal(cardOpen(r), true, 'כרטיס מעל המצלמה: ' + code);
  cardType(r, String(qty)); cardClick(r, { scanSave: '' });
  assert.equal(r.run('scanPurpose'), 'field', 'המצלמה נסגרה אחרי השמירה'); assert.equal(modalOpen(r), true, 'הרשימה חזרה');
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
const items = rc => rc.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

test('1. "התחל בדיקה שורה-שורה" פותח את החלון מיד, בזמן שהתעודה נקראת — בלי רשימה, ו"סיום" מחכה לתעודה', async () => {
  const c = await open([BIG, SMALL]);
  const release = c.hold();
  c.click('rc-photo-lines'); // הכפתור הראשי במסך הצילום
  await settle();
  assert.equal(c.run('receiptPaperScanState'), 'running');
  assert.equal(c.run('receiptCountingMode'), 'manual'); assert.equal(c.run('receiptQuantityIntent'), 'lines'); assert.equal(draft(c).quantityIntent, 'lines');
  assert.equal(modalOpen(c), true, 'החלון נפתח מיד, בלי לחכות לפענוח');
  const r = review(c);
  assert.equal(r.mode, 'lines'); assert.equal(r.pending, true); assert.deepEqual(r.docs, []); assert.deepEqual(r.extras, []); assert.deepEqual(r.rows, []);
  assert.equal(title(c), 'בדיקה שורה-שורה');
  assert.equal(c.run(`$('receiptQuantityIntro').textContent`), 'התעודה עוד נקראת — אפשר כבר לסרוק מוצרים. הרשימה תעלה כאן לבד, ומה שנסרק יסומן בה.');
  assert.equal(progress(c), 'עוד לא נסרק כלום');
  assert.match(strip(rows(c)), /^קורא את התעודה… אפשר לסרוק בינתיים\. כשהקריאה תסתיים הטלפון ירטוט, והרשימה תעלה כאן עם מה שכבר נסרק\. נסרקו עד עכשיו עוד לא נסרק כלום — "סרוק מוצר" למטה, או חפש מוצר כאן\.$/);
  assert.match(rows(c), /id="receiptLinePaperStatus" data-paper-kind="reading"/);
  // ההתקדמות של הפענוח מתעדכנת בכרטיס המצב במקום — בלי לצייר מחדש את הרשימה (שדה כמות שמקלידים בו לא מאבד את הפוקוס)
  assert.match(strip(c.run(`$('receiptLinePaperStatus').innerHTML`)), /^קורא תעודה 1 מתוך 2… אפשר לסרוק בינתיים\./);
  assert.equal(c.run(`$('receiptLineScan').classList.contains('hidden')`), false, '"סרוק מוצר" בתחתית');
  assert.equal(okText(c), 'סיום — כשהתעודה תיקרא'); assert.match(okClass(c), /bg-slate-400/);
  finish(c);
  assert.equal(progress(c), 'התעודה עוד נקראת — אפשר להמשיך לסרוק. הרשימה תעלה כאן לבד, ואז אפשר לסיים.');
  assert.equal(modalOpen(c), true); assert.equal(c.run('!!pendingReceipt'), false, 'שום דבר לא נסגר');
  // מאחורי החלון — מסך ההמתנה, עם "המשך לסרוק בינתיים"; בלי מסך הסריקה הישן
  assert.match(strip(app(c)), /בסיום הפענוח תיפתח לבד הבדיקה שורה-שורה, והטלפון ירטוט\. אפשר כבר לסרוק מוצרים\. המשך לסרוק בינתיים שנה את הבדיקה/);
  assert.doesNotMatch(app(c), /data-role="rc-scan"|rc-count-by-scan|סריקת מוצרים/);
  // "חזרה" סוגר, ו"המשך לסרוק בינתיים" פותח שוב — אותה בדיקה
  c.run('closeReceiptQuantityReview()'); assert.equal(modalOpen(c), false);
  c.click('rc-quantity-lines');
  assert.equal(modalOpen(c), true); assert.equal(review(c).pending, true);
  release(); await settle(); await settle();
  // התעודה נקראה — הרשימה עלתה באותו חלון; לא נסרק דבר, אז בלי הודעה על סימונים
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  assert.equal(modalOpen(c), true); assert.equal(review(c).pending, undefined); assert.deepEqual(review(c).docs.map(d => d.lines.length), [3, 2]);
  assert.equal(c.run('receiptQuantityIntent'), null); assert.deepEqual(readyBuzzes(c), [[60, 40, 60]], 'רטט אחד');
  assert.equal(c.run(`$('receiptQuantityIntro').textContent`), 'סרוק מוצר מהסחורה, או סמן ביד בכל שורה: הגיע, כמות אחרת או לא הגיע.');
  assert.equal(progress(c), 'התעודה נקראה — 4 שורות');
  assert.equal(okText(c), 'סיום (נשארו 4)'); assert.equal(json(c, 'testConfirms').length, 0, 'בלי שאלה');
});

test('2. סורקים לפני שהרשימה עלתה: כמה הגיע, סריקה חוזרת "עוד כמה?", "תקן את הסה״כ", חיפוש ביד, ברקוד לא מוכר — והכול בספירה', async () => {
  const c = await reading([BIG, SMALL]);
  await camera(c);
  assert.equal(modalOpen(c), false, 'החלון מוסתר מאחורי המצלמה');
  assert.equal(c.run(`$('scanTitle').textContent`), 'בדיקה שורה-שורה — סריקה');
  assert.equal(overlay(c), 'נסרקו: 0 מוצרים | ');
  beep(c, '7290000000008');
  assert.equal(cardOpen(c), true);
  assert.deepEqual(json(c, '[receiptLineScanCard.kind, receiptLineScanCard.k, receiptLineScanCard.addQty, receiptLineScanCard.got]'), ['extra', -1, false, '1']);
  assert.equal(strip(card(c)), 'התעודה עוד נקראת — המוצר יסומן ברשימה כשהיא תעלה חלב 3% בקרטון 1 ליטר בקופה: ₪6.90 7290000000008 כמה הגיע? הוסף נסרקו 1 יח׳');
  assert.doesNotMatch(card(c), /border-amber-300|לא בתעודה|עודף/, 'לא "הגיע בנוסף" — עוד אין תעודה להשוות אליה');
  cardType(c, '12');
  assert.equal(c.run(`$('scanLineSum').textContent`), 'נסרקו 12 יח׳');
  cardClick(c, { scanSave: '' });
  // כמו אחרי סימון ברשימה (160): המצלמה נסגרת, והרשימה חוזרת עם המוצר מודגש
  assert.equal(c.run('scanPurpose'), 'field'); assert.equal(cameraOpen(c), false); assert.equal(modalOpen(c), true);
  assert.equal(c.run(`$('lineExtra_0').classList.contains('ring-4')`), true);
  assert.deepEqual(extras(c), ['milk 12']); assert.deepEqual(list(c), ['milk 12'], 'הספירה היא מה שנסרק');
  assert.deepEqual(draft(c).items.map(l => l.productId + ' ' + l.qty), ['milk 12']); assert.equal(draft(c).quantityReview.pending, true);
  assert.equal(progress(c), 'נסרקו מוצר אחד · 12 יח׳');
  assert.match(strip(rows(c)), /נסרקו עד עכשיו אפשר לתקן כמות, או להסיר\. חלב 3% בקרטון 1 ליטר בקופה: ₪6\.90 7290000000008 הסר כמה הגיע\?/);
  assert.match(rows(c), /<input data-extra-got="0"[^>]*value="12"/);
  // סריקה חוזרת — "סרקת עד עכשיו 12 יח׳", "עוד כמה?" ו"הוסף" מצטבר
  await camera(c);
  assert.equal(overlay(c), 'נסרקו: מוצר אחד | ');
  beep(c, '7290000000008');
  assert.deepEqual(json(c, '[receiptLineScanCard.k, receiptLineScanCard.addQty, receiptLineScanCard.got]'), [0, true, '1']);
  assert.equal(strip(card(c)), 'סרקת עד עכשיו 12 יח׳ חלב 3% בקרטון 1 ליטר בקופה: ₪6.90 7290000000008 עוד כמה? הוסף סה״כ 13 יח׳ לא נכון? תקן את הסה״כ');
  cardType(c, '5');
  assert.equal(c.run(`$('scanLineSum').textContent`), 'סה״כ 17 יח׳');
  cardClick(c, { scanSave: '' });
  assert.deepEqual(extras(c), ['milk 17']); assert.deepEqual(list(c), ['milk 17']);
  // "תקן את הסה״כ" — השדה הוא הסה״כ, "עדכן"
  await camera(c); beep(c, '7290000000008');
  cardClick(c, { scanMark: 'fix' });
  assert.deepEqual(json(c, '[receiptLineScanCard.addQty, receiptLineScanCard.got]'), [false, '17']);
  assert.match(strip(card(c)), /^כבר נסרק: 17 יח׳ — אפשר לשנות חלב 3% בקרטון 1 ליטר .* כמה הגיע\? עדכן נסרקו 17 יח׳$/);
  cardType(c, '16'); cardClick(c, { scanSave: '' });
  assert.deepEqual(list(c), ['milk 16']);
  // כמות לא תקינה לא נשמרת, והכרטיס נשאר; ✕ בכרטיס סוגר בלי לשנות — והמצלמה ממשיכה
  await camera(c); beep(c, '7290000000015');
  cardType(c, 'abc'); cardClick(c, { scanSave: '' });
  assert.equal(cardOpen(c), true); assert.match(strip(card(c)), /הקלד מספר — כמה יחידות הגיעו$/); assert.deepEqual(list(c), ['milk 16']);
  cardClick(c, { scanDismiss: '' });
  assert.equal(cardOpen(c), false); assert.equal(c.run('scanPurpose'), 'linecheck', 'המצלמה נשארת');
  // ברקוד שאינו במאגר — ההודעה של הקליטה, והסריקה ממשיכה
  beep(c, '7290000099999');
  assert.equal(cardOpen(c), false); assert.match(c.toasts.at(-1), /ברקוד לא קיים במערכת/); assert.deepEqual(list(c), ['milk 16']);
  c.run('closeScanner()');
  assert.equal(modalOpen(c), true);
  // ביד: חיפוש, "+ מוצר", והכמות; "הסר"
  type(c, { lineSearch: '' }, 'חמאה');
  assert.match(c.run(`$('receiptLineSearchResults').innerHTML`), /data-extra-add="butter"/);
  click(c, { extraAdd: 'butter' }); type(c, { extraGot: '1' }, '3');
  assert.deepEqual(extras(c), ['milk 16', 'butter 3']); assert.deepEqual(list(c), ['milk 16', 'butter 3']);
  type(c, { extraGot: '1' }, ''); // באמצע הקלדה — לא נספר, והשדה נשאר
  assert.deepEqual(list(c), ['milk 16']); assert.deepEqual(extras(c), ['milk 16', 'butter ']);
  type(c, { extraGot: '1' }, '3');
  click(c, { extraRemove: '0' });
  assert.deepEqual(extras(c), ['butter 3']); assert.deepEqual(list(c), ['butter 3']);
  assert.equal(String(c.run(`$('cartCount').textContent`)), '1', 'גם הכפתור הכחול ("סיים תעודה") יודע');
  await c.release();
});

test('3. התעודה נקראה — הרשימה עולה באותו חלון, בלי שאלה, ומה שנסרק כבר מסומן; "סיום" שומר כמו סימון ביד', async () => {
  const c = await reading([BIG, SMALL]);
  await scanQty(c, '7290000000008', 17); // חלב: 12 + 5 בשתי התעודות — בדיוק
  await scanQty(c, '7290000000015', 4);  // קוטג׳: 6 בתעודה — כמות אחרת
  await scanQty(c, '7290000000053', 3);  // חמאה: אינה באף תעודה
  assert.deepEqual(list(c), ['milk 17', 'cottage 4', 'butter 3']);
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  assert.equal(json(c, 'testConfirms').length, 0, 'בלי "כבר נספרו … — התחל בדיקה": המשתמש כבר בתוך הבדיקה');
  assert.equal(modalOpen(c), true); assert.equal(title(c), 'בדיקה שורה-שורה');
  assert.equal(review(c).pending, undefined);
  assert.deepEqual(marks(c), ['ok,qty:4,', 'ok,'], 'חלב — הגיע בשתי התעודות; קוטג׳ — "אחרת" 4; יוגורט ושמנת — ממתינים');
  assert.deepEqual(extras(c), ['butter 3'], 'מה שאינו בתעודות — "הגיע משהו נוסף"');
  assert.deepEqual(readyBuzzes(c), [[60, 40, 60]]);
  assert.equal(progress(c), 'התעודה נקראה — 4 שורות · 2 כבר סומנו ממה שנסרק · מוצר אחד שאינו בתעודה');
  assert.equal(okText(c), 'סיום (נשארו 2)');
  assert.match(strip(rows(c)), /התעודה 1 מתוך 2|תעודה 1 מתוך 2/); assert.match(rows(c), /id="lineCheck_0_2"/); assert.match(strip(rows(c)), /הגיע משהו נוסף\?/);
  assert.doesNotMatch(rows(c), /receiptLinePaperStatus|נסרקו עד עכשיו/);
  assert.equal(draft(c).quantityReview.pending, undefined); assert.equal(draft(c).quantityIntent, null);
  // ממשיכים: סריקה של יוגורט כבר מגיעה לשורה שלו, עם הכמות בתעודה
  await camera(c);
  assert.equal(overlay(c), 'סומנו 2 מתוך 4 | ');
  beep(c, '7290000000022');
  assert.deepEqual(json(c, '[receiptLineScanCard.kind, receiptLineScanCard.di, receiptLineScanCard.li]'), ['line', 0, 2]);
  cardClick(c, { scanMark: 'ok' });
  click(c, { lineMark: '1:1:ok' });
  assert.deepEqual(marks(c), ['ok,qty:4,ok', 'ok,ok']);
  // אותה בדיקה, מסומנת ביד בלי שום סריקה מוקדמת
  const b = await open([BIG, SMALL]);
  await b.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`); await settle();
  click(b, { lineMark: '0:0:ok' }); click(b, { lineMark: '0:1:qty' }); type(b, { lineGot: '0:1' }, '4'); click(b, { lineMark: '0:2:ok' }); click(b, { lineMark: '1:1:ok' });
  type(b, { lineSearch: '' }, 'חמאה'); click(b, { extraAdd: 'butter' }); type(b, { extraGot: '0' }, '3');
  assert.deepEqual(marks(b), marks(c)); assert.deepEqual(extras(b), extras(c));
  assert.equal(c.run('finishReceiptLineCheck()'), true); assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(c, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['butter 3', 'cottage 4', 'cream 2', 'milk 17', 'yogurt 4']);
  assert.deepEqual(json(c, 'receiptList'), json(b, 'receiptList'));
  const audit = r => json(r, '({ ...receiptQuantityCheckAudit(), confirmedAt: null })');
  assert.deepEqual(audit(c), audit(b), 'מה שנשמר בקליטה — זהה לסימון ביד, בלי שדה חדש');
  const savedC = await save(c), savedB = await save(b);
  assert.deepEqual(items(savedC), items(savedB));
  for (const k of ['noteParts', 'count', 'status', 'noDoc', 'vatPct', 'totalExVat']) assert.deepEqual(savedC[k], savedB[k], k);
  assert.equal(savedC.quantityCheck.byLine, true);
});

test('4. התעודה נקראה כשהמצלמה פתוחה: המצלמה נשארת, המונה עובר ל"סומנו", וכרטיס פתוח נבנה מחדש מול הרשימה עם מה שהוקלד', async () => {
  const c = await reading([BIG, SMALL]);
  await scanQty(c, '7290000000015', 6); // קוטג׳ — בדיוק כמו בתעודה
  await camera(c);
  beep(c, '7290000000022'); cardType(c, '3'); // יוגורט: הכרטיס פתוח, 3 כבר הוקלד (4 בתעודה)
  assert.equal(json(c, 'receiptLineScanCard.kind'), 'extra');
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('scanPurpose'), 'linecheck', 'המצלמה לא נסגרה'); assert.equal(cameraOpen(c), true);
  assert.equal(modalOpen(c), false, 'החלון מחכה מאחורי המצלמה');
  assert.equal(review(c).pending, undefined); assert.deepEqual(marks(c), [',ok,', ','], 'הרשימה כבר נבנתה, עם מה שנסרק');
  assert.equal(overlay(c), 'סומנו 1 מתוך 4 | התעודה נקראה ✓ הרשימה מוכנה');
  assert.deepEqual(readyBuzzes(c), [[60, 40, 60]]);
  // הכרטיס שהיה פתוח — עכשיו של השורה בתעודה, ומה שהוקלד נשאר בשדה ("אחרת")
  assert.equal(cardOpen(c), true);
  assert.deepEqual(json(c, '[receiptLineScanCard.kind, receiptLineScanCard.di, receiptLineScanCard.li, receiptLineScanCard.askQty, receiptLineScanCard.got]'), ['line', 0, 2, true, '3']);
  assert.match(strip(card(c)), /^שורה 3 בתעודה 1 מתוך 2 יוגורט טבעי 150 גרם .* 4 יח׳ בתעודה כמה הגיע\? שמור התקבלו 3 · חוסר 1$/);
  cardClick(c, { scanSave: '' });
  assert.equal(c.run('scanPurpose'), 'field'); assert.equal(modalOpen(c), true, 'אחרי הסימון — הרשימה, עם השורות');
  assert.deepEqual(marks(c), [',ok,qty:3', ',']);
  assert.match(rows(c), /id="lineCheck_0_0"/);
  // בלי כרטיס פתוח: סריקה חדשה אחרי שהרשימה עלתה מגיעה לשורה, ו-✕ במצלמה מציג את הרשימה
  const d = await reading([BIG]);
  await camera(d);
  await d.release();
  assert.equal(d.run('scanPurpose'), 'linecheck'); assert.equal(modalOpen(d), false); assert.equal(cardOpen(d), false);
  assert.equal(overlay(d), 'סומנו 0 מתוך 3 | התעודה נקראה ✓ הרשימה מוכנה');
  beep(d, '7290000000008');
  assert.match(strip(card(d)), /^שורה 1 בתעודה חלב 3% בקרטון 1 ליטר בקופה: ₪6\.90 12 יח׳ בתעודה הגיע 12 אחרת לא הגיע$/);
  cardClick(d, { scanDismiss: '' });
  d.run('closeScanner()');
  assert.equal(modalOpen(d), true); assert.equal(progress(d), 'התעודה נקראה — 3 שורות');
  // "עוד כמה?" שפתוח כשהרשימה עולה: מה שנסרק קודם כבר סומן בשורה, והתוספת שהוקלדה נשארת תוספת
  const e = await reading([BIG]);
  await scanQty(e, '7290000000008', 6);
  await camera(e); beep(e, '7290000000008'); cardType(e, '4');
  assert.equal(json(e, 'receiptLineScanCard.addQty'), true);
  await e.release();
  assert.deepEqual(marks(e), ['qty:6,,']);
  assert.deepEqual(json(e, '[receiptLineScanCard.kind, receiptLineScanCard.addQty, receiptLineScanCard.got]'), ['line', true, '4']);
  assert.match(strip(card(e)), /סרקת עד עכשיו 6 מתוך 12 .* עוד כמה\? הוסף סה״כ 10 · חוסר 2/);
  cardClick(e, { scanSave: '' });
  assert.deepEqual(marks(e), ['qty:10,,']);
});

test('5. התעודה נקראה אבל צריך להשלים זיהוי מוצרים: המצלמה לא נקטעת; כשהיא נסגרת — מסך ההשוואה, והספירה נשמרת', async () => {
  // שורה שהקוד שלה אינו במאגר — אין רשימה עד שמזהים אותה (במסך ההשוואה, כמו קודם)
  const UNKNOWN = paper([['milk', 12], ['cottage', 6]], '4471009');
  UNKNOWN.rows[1] = { ...UNKNOWN.rows[1], code: '99999', itemCode: '99999', supplierItemCode: '99999', barcode: '7290000099990', barcodeObserved: '7290000099990', description: 'מוצר שאינו במאגר' };
  const c = await reading([UNKNOWN]);
  await scanQty(c, '7290000000008', 12);
  await camera(c);
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptLineCheckDocs()'), null, 'אי אפשר לבנות את הרשימה');
  assert.equal(c.run('scanPurpose'), 'linecheck', 'המצלמה נשארת פתוחה'); assert.equal(c.run('currentView'), 'receiving');
  assert.equal(c.run('receiptQuantityIntent'), 'lines', 'הבחירה מחכה'); assert.deepEqual(readyBuzzes(c), []);
  assert.equal(review(c).pending, true);
  c.run('closeScanner()');
  assert.equal(modalOpen(c), true, 'לרגע — החלון, ואז הפתיחה שנדחתה');
  runQueued(c);
  assert.equal(c.run('currentView'), 'reconcile', 'מסך ההשוואה — להשלים את הזיהוי');
  assert.equal(modalOpen(c), false, 'החלון לא נשאר מעל מסך ההשוואה');
  assert.match(c.toasts.at(-1), /צריך להשלים את זיהוי המוצרים/);
  assert.deepEqual(list(c), ['milk 12'], 'מה שנסרק נשמר');
});

test('6. הקריאה נכשלה: החלון אומר זאת וסורקים הלאה; "בדוק את צילום התעודה"; אחרי התיקון — הרשימה, עם מה שנסרק', async () => {
  const c = await reading([BIG]);
  await scanQty(c, '7290000000008', 12);
  c.run(`const realCheck = yotvataPaperCheck; yotvataPaperCheck = (doc, pages) => ({ ...realCheck(doc, pages), ok: false, problems: ['סכום השורות אינו שווה לסיכום'] }); globalThis.realCheck = realCheck;`);
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.equal(modalOpen(c), true); assert.equal(review(c).pending, true); assert.equal(c.run('receiptLinePendingKind()'), 'failed');
  assert.equal(strip(c.run(`$('receiptLinePaperStatus').innerHTML`)), 'קריאת התעודה לא הושלמה תעודה 1: סכום השורות אינו שווה לסיכום מה שנסרק נשמר, ואפשר להמשיך לסרוק — הרשימה תעלה אחרי שהצילום יתוקן. בדוק את צילום התעודה');
  assert.match(c.run(`$('receiptLinePaperStatus').className`), /bg-amber-50/);
  assert.equal(c.run(`$('receiptQuantityIntro').textContent`), 'אפשר להמשיך לסרוק. הרשימה של התעודה תעלה כאן אחרי שהצילום יתוקן.');
  assert.equal(okText(c), 'סיום — אחרי תיקון הצילום');
  finish(c);
  assert.equal(progress(c), 'קריאת התעודה לא הושלמה — בדוק את צילום התעודה. מה שנסרק נשמר.');
  await scanQty(c, '7290000000015', 6); // ממשיכים לסרוק
  assert.deepEqual(list(c), ['milk 12', 'cottage 6']);
  assert.match(rows(c), /data-paper-kind="failed"[\s\S]*data-line-paper="repair"/);
  click(c, { linePaper: 'repair' });
  assert.equal(modalOpen(c), false);
  assert.match(strip(app(c)), /צריך להשלים את פענוח התעודה[\s\S]*בדוק את צילומי התעודה המשך לסרוק בינתיים/);
  // התיקון: "בדוק את צילומי התעודה" מחזיר למסך הצילום, ו"התחל בדיקה שורה-שורה" קורא שוב (כאן: הקריאה חוזרת לעבור) —
  // החלון נפתח שוב עם מה שנסרק, והרשימה עולה לבד
  c.run('yotvataPaperCheck = realCheck');
  c.click('rc-photo-repair');
  assert.match(strip(app(c)), /שלב 1 · צילום תעודה[\s\S]*18 יח׳ כבר נסרקו — הם יסומנו ברשימה כשהתעודה תיקרא\. התחל בדיקה שורה-שורה/);
  await c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`); await settle();
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  assert.equal(modalOpen(c), true); assert.equal(review(c).pending, undefined);
  assert.deepEqual(marks(c), ['ok,ok,']); assert.equal(json(c, 'testConfirms').length, 0);
  assert.equal(progress(c), 'התעודה נקראה — 3 שורות · 2 כבר סומנו ממה שנסרק');
  // רשת שנפלה — אותו דבר: החלון נשאר, והספירה נשמרת
  const n = await open([BIG]);
  n.fail(true);
  await n.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`); await settle();
  assert.equal(n.run('receiptPaperScanState'), 'failed'); assert.equal(modalOpen(n), true); assert.equal(n.run('receiptLinePendingKind()'), 'failed');
  await scanQty(n, '7290000000008', 2);
  assert.deepEqual(list(n), ['milk 2']);
});

test('7. בלי תעודה: אותו חלון, "סיום — שמור בלי תעודה" שומר קליטה פתוחה בלי תעודה; המסך שמאחורי החלון', async () => {
  const c = await open([BIG]);
  c.run('aiScanDocuments = []; renderReceiving()');
  c.click('rc-open-nodoc');
  assert.equal(c.run('receiptNoDoc'), true); assert.equal(c.run('receiptLinePendingKind()'), 'nodoc');
  assert.equal(modalOpen(c), true, 'חלון הבדיקה — במקום המצלמה של הקליטה בסריקה');
  assert.equal(c.run('scanPurpose'), 'field');
  assert.equal(title(c), 'בדיקה בלי תעודה'); assert.equal(review(c).pending, true);
  assert.equal(c.run(`$('receiptQuantityIntro').textContent`), 'סרוק את מה שהגיע, או חפש מוצר והקלד כמה הגיע. אין רשימה להשוות אליה.');
  assert.match(strip(rows(c)), /^אין תעודה — קולטים לפי מה שנסרק "סיום" שומר את הקליטה פתוחה עד שהנייר יגיע\. התעודה הגיעה\? צלם אותה, והבדיקה תהפוך לשורה-שורה עם מה שכבר נסרק\. צלם את התעודה נסרקו עד עכשיו/);
  assert.equal(c.run(`$('receiptQuantityBody').classList.contains('flex-1')`), true, 'גוף החלון ממלא את הגובה — "סרוק מוצר" ו"סיום" צמודים לתחתית');
  assert.equal(okText(c), 'סיום — שמור בלי תעודה'); assert.match(okClass(c), /bg-slate-400/, 'אפור עד שנסרק משהו');
  finish(c);
  assert.equal(progress(c), 'עוד לא נסרק כלום — סרוק מוצר, או חפש אותו והקלד כמה הגיע'); assert.equal(modalOpen(c), true);
  await camera(c);
  assert.equal(c.run(`$('scanTitle').textContent`), 'בדיקה בלי תעודה — סריקה');
  beep(c, '7290000000008');
  assert.match(strip(card(c)), /^קליטה בלי תעודה חלב 3% בקרטון 1 ליטר/);
  cardType(c, '12'); cardClick(c, { scanSave: '' });
  await scanQty(c, '7290000000015', 3);
  assert.deepEqual(list(c), ['milk 12', 'cottage 3']);
  assert.match(okClass(c), /bg-blue-600/); assert.equal(progress(c), 'נסרקו 2 מוצרים · 15 יח׳');
  // שדה ריק — "סיום" עוצר עליו
  type(c, { extraGot: '1' }, '');
  finish(c);
  assert.equal(progress(c), 'הקלד כמה הגיע מכל מוצר, או הסר אותו'); assert.equal(c.run(`$('lineExtra_1').classList.contains('ring-4')`), true); assert.equal(c.run('!!pendingReceipt'), false);
  type(c, { extraGot: '1' }, '3');
  // מאחורי החלון — המסך הקצר של קליטה בלי תעודה, בלי מסך הסריקה הישן ("חזרה" מצייר אותו מחדש, עם מה שנסרק)
  c.events.get('receiptQuantityClose:click')();
  assert.equal(modalOpen(c), false);
  const home = app(c);
  assert.match(home, /data-nodoc-check/);
  assert.match(strip(home), /קליטה בלי תעודה[\s\S]*בדיקה בלי תעודה נסרקו 2 מוצרים · 15 יח׳ [\s\S]*המשך לסרוק יש תעודה\? צלם אותה/);
  assert.doesNotMatch(home, /data-role="rc-scan"|id="rcListEl"|סריקת מוצרים/);
  c.click('rc-nodoc-check');
  assert.equal(modalOpen(c), true); assert.deepEqual(extras(c), ['milk 12', 'cottage 3'], 'אותה בדיקה');
  // "סיום" — הסיכום של קליטה בלי תעודה, כמו קודם
  finish(c);
  assert.equal(modalOpen(c), false);
  assert.equal(json(c, 'pendingReceipt.noDoc'), true); assert.equal(json(c, 'pendingReceipt.status'), 'open');
  assert.equal(c.run(`!$('receiptSummaryModal').classList.contains('hidden')`), true);
  assert.match(strip(c.run(`$('rsBody').innerHTML`)), /אין תעודה — נשמר לפי ספירה/);
  await c.run('confirmReceipt()');
  const w = c.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
  assert.ok(w, 'הקליטה נשמרה');
  assert.equal(w.data.noDoc, true); assert.equal(w.data.status, 'open'); assert.equal(w.data.quantityCheck, null, 'בלי בדיקה ידנית — כמו קליטה בלי תעודה מאז ומעולם');
  assert.deepEqual(w.data.items.map(l => l.productId + ' ' + l.qty).sort(), ['cottage 3', 'milk 12']);
  assert.equal(c.run('receiptQuantityReview'), null); assert.equal(c.run('receiptNoDoc'), false);
});

test('8. בלי תעודה, ומצלמים אותה באמצע: מה שנסרק נשאר, והבדיקה הופכת לשורה-שורה כשהתעודה נקראת', async () => {
  const c = await open([BIG, SMALL]);
  const pages = c.run('JSON.stringify(aiScanDocuments)');
  c.run('aiScanDocuments = []; renderReceiving()');
  c.click('rc-open-nodoc');
  await scanQty(c, '7290000000008', 17);
  await scanQty(c, '7290000000046', 2); // מעדן — לא יהיה בתעודות
  await scanQty(c, '7290000000039', 1); // שמנת — 2 בתעודה
  // "יש תעודה? צלם אותה" — מסך הצילום, והספירה נשמרת
  click(c, { linePaper: 'photo' });
  assert.equal(modalOpen(c), false); assert.equal(c.run('receiptEntryMode'), 'photo'); assert.equal(c.run('receiptPhotoCaptureOpen'), true);
  assert.match(strip(app(c)), /שלב 1 · צילום תעודה[\s\S]*20 יח׳ כבר נסרקו — הם יסומנו ברשימה כשהתעודה תיקרא\. התחל בדיקה שורה-שורה/);
  assert.deepEqual(list(c), ['milk 17', 'pudding 2', 'cream 1']);
  // מצלמים (כאן: הצילומים מוכנים), ו"התחל בדיקה שורה-שורה"
  c.run(`aiScanDocuments = ${pages}; renderReceiving()`);
  const release = c.hold();
  c.click('rc-photo-lines'); await settle();
  assert.equal(c.run('receiptNoDoc'), false, 'כבר לא קליטה בלי תעודה'); assert.equal(c.run('receiptLinePendingKind()'), 'reading');
  assert.equal(modalOpen(c), true); assert.equal(title(c), 'בדיקה שורה-שורה');
  assert.deepEqual(extras(c), ['milk 17', 'pudding 2', 'cream 1'], 'מה שנסרק בלי תעודה — בחלון');
  assert.equal(okText(c), 'סיום — כשהתעודה תיקרא');
  await scanQty(c, '7290000000015', 6); // וממשיכים לסרוק בזמן הקריאה
  release(); await settle(); await settle();
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  assert.equal(review(c).pending, undefined); assert.equal(modalOpen(c), true);
  assert.deepEqual(marks(c), ['ok,ok,', 'ok,qty:1']); assert.deepEqual(extras(c), ['pudding 2']);
  assert.equal(json(c, 'testConfirms').length, 0);
  assert.equal(progress(c), 'התעודה נקראה — 4 שורות · 3 כבר סומנו ממה שנסרק · מוצר אחד שאינו בתעודה');
  // חזרה מ"צלם אותה" בלי לצלם: "אין תעודה בכלל" מחזיר לבדיקה בלי תעודה, עם אותה ספירה
  const d = await open([BIG]);
  d.run('aiScanDocuments = []; renderReceiving()');
  d.click('rc-open-nodoc');
  await scanQty(d, '7290000000008', 5);
  click(d, { linePaper: 'photo' });
  d.click('rc-open-nodoc');
  assert.equal(d.run('receiptNoDoc'), true); assert.equal(modalOpen(d), true); assert.deepEqual(extras(d), ['milk 5']);
});

test('9. בלי תעודה, מוצר בלי מחיר קנייה: קודם קובעים מחיר — וחוזרים לחלון עם המוצר; עם תעודה אין שאלה', async () => {
  const catalog = products.map(p => p.id === 'butter' ? { ...p, price: null } : p);
  const c = await open([BIG], {}, catalog);
  c.run('aiScanDocuments = []; renderReceiving()');
  c.click('rc-open-nodoc');
  await camera(c); beep(c, '7290000000053');
  assert.equal(cardOpen(c), false, 'בלי כרטיס כמות');
  assert.equal(c.run(`!$('newProductModal').classList.contains('hidden')`), true, 'חלון קביעת המחיר');
  assert.equal(c.run('npTarget'), 'linecheck'); assert.equal(c.run('scanPurpose'), 'field');
  assert.equal(modalOpen(c), false, 'חלון הבדיקה מוסתר בינתיים (הוא בשכבה שמעל)');
  assert.deepEqual(list(c), []);
  // ביטול — חוזרים לחלון, בלי המוצר
  c.run('hideNewProduct()');
  assert.equal(modalOpen(c), true); assert.deepEqual(extras(c), []);
  // שוב, והפעם נקבע מחיר — המוצר ברשימה, עם שדה הכמות
  await camera(c); beep(c, '7290000000053');
  c.run(`$('npr_price').value = '6.5'`);
  await c.run('saveNewProduct()');
  assert.equal(c.run(`products.find(p => p.id === 'butter').price`), 6.5);
  assert.equal(modalOpen(c), true); assert.deepEqual(extras(c), ['butter 1']); assert.deepEqual(list(c), ['butter 1']);
  // גם מהחיפוש
  const d = await open([BIG], {}, catalog);
  d.run('aiScanDocuments = []; renderReceiving()');
  d.click('rc-open-nodoc');
  type(d, { lineSearch: '' }, 'חמאה'); click(d, { extraAdd: 'butter' });
  assert.equal(d.run(`!$('newProductModal').classList.contains('hidden')`), true); assert.deepEqual(extras(d), []);
  // כשיש תעודה (עוד נקראת) — בלי שאלה: המחיר יבוא מהתעודה ומבדיקת המחירים
  const e = await reading([BIG], {}, catalog);
  await camera(e); beep(e, '7290000000053');
  assert.equal(cardOpen(e), true); assert.equal(e.run(`$('newProductModal').classList.contains('hidden')`), true);
  cardClick(e, { scanDismiss: '' }); e.run('closeScanner()');
  await e.release();
});

test('10. "לא הגיע כלום": שאלה אחת, ואז כל השורות חוסר — בדיוק כמו "לא הגיע" בכל שורה ו"סיום"', async () => {
  const c = await open([BIG, SMALL]);
  const release = c.hold();
  c.click('rc-photo-none'); await settle();
  assert.equal(c.run('receiptQuantityIntent'), 'none'); assert.equal(draft(c).quantityIntent, 'none'); assert.equal(modalOpen(c), false);
  assert.match(strip(app(c)), /בסיום הפענוח תופיע לבד השאלה "לא הגיע כלום\?", והטלפון ירטוט\. אפשר להניח את הטלפון בצד\./);
  release(); await settle(); await settle();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  const q = json(c, 'testConfirms');
  assert.equal(q.length, 1); assert.equal(q[0].title, 'לא הגיע כלום?'); assert.equal(q[0].label, 'לא הגיע כלום');
  assert.equal(q[0].message, 'נקרא: תעודת ספק 4471001 · ₪114.00 · 3 שורות · 22 יח׳ | תעודת ספק 4471002 · ₪29.00 · 2 שורות · 7 יח׳. כל השורות בכל 2 התעודות יירשמו כחוסר (0 התקבלו). אם משהו כן הגיע — בדוק שורה-שורה.');
  assert.deepEqual(readyBuzzes(c), [[60, 40, 60]]); assert.deepEqual(list(c), [], 'לפני האישור — כלום');
  c.run('testConfirms[0].cb()');
  assert.deepEqual(json(c, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 0', 'cream 0', 'milk 0', 'yogurt 0']);
  assert.equal(c.run('currentView'), 'reconcile', 'מסך ההשוואה — שום דבר לא נשמר בלי האישור שם');
  assert.equal(c.run('receiptQuantityCheckAudit().method'), 'manual');
  assert.deepEqual(json(c, 'receiptQuantityCheckAudit().differences.map(d => d.productId + " " + d.paperQty + ">" + d.received).sort()'), ['cottage 6>0', 'cream 2>0', 'milk 17>0', 'yogurt 4>0']);
  // אותו דבר ביד: "לא הגיע" בכל שורה, ו"סיום"
  const b = await open([BIG, SMALL]);
  await b.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`); await settle();
  for (const id of ['0:0', '0:1', '0:2', '1:1']) click(b, { lineMark: id + ':none' });
  assert.equal(b.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(c, 'receiptList.slice().sort((x, y) => x.productId.localeCompare(y.productId))'), json(b, 'receiptList.slice().sort((x, y) => x.productId.localeCompare(y.productId))'));
  assert.deepEqual(json(c, 'receiptQuantityCheckAudit().differences'), json(b, 'receiptQuantityCheckAudit().differences'));
  // ממסך הקליטה, אחרי שהתעודה כבר נקראה — ועם ספירה שכבר נעשתה, השאלה אומרת כמה יימחק
  const d = await open([BIG]);
  await d.run(`yotvataStartPaperScan({ manualQuantities: true })`); await settle();
  assert.match(app(d), /data-role="rc-quantity-none"[^>]*>לא הגיע כלום — הכל חסר</);
  d.run(`receiptList = [{ productId: 'milk', name: 'חלב', barcode: '7290000000008', qty: 5 }]`);
  d.click('rc-quantity-none');
  const dq = json(d, 'testConfirms');
  assert.equal(dq.length, 1);
  assert.equal(dq[0].message, 'שים לב: כבר נספרו 5 יח׳ — הספירה תימחק. נקרא: תעודת ספק 4471001 · ₪114.00 · 3 שורות · 22 יח׳. כל השורות שבתעודה יירשמו כחוסר (0 התקבלו). אם משהו כן הגיע — בדוק שורה-שורה.');
  d.run('testConfirms[0].cb()');
  assert.deepEqual(json(d, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 0', 'milk 0', 'yogurt 0']);
});

test('11. יחידה בודדת שנסרקה כשבתעודה מארז החיוב שלה (ולהפך) — עוברת לשורה שבתעודה כשהכמות מתחלקת; אחרת נשארת "נוסף"', async () => {
  const catalog = products.map(p => p.id === 'milk' ? { ...p, billingPackId: 'milkpack', billingPackSize: 6 } : p)
    .concat([{ id: 'milkpack', name: 'חלב 3% — מארז 6', code: '60', barcode: '7290000000060', price: 30 }]);
  const PACKS = paper([['milkpack', 2], ['cottage', 6]], '4471005', catalog);
  // 12 בודדים = 2 מארזים — בדיוק מה שבתעודה
  const a = await reading([PACKS], {}, catalog);
  await scanQty(a, '7290000000008', 12);
  await a.release();
  assert.equal(a.run('receiptPaperScanState'), 'ok', JSON.stringify(a.run('receiptPaperScanProblems')));
  assert.deepEqual(marks(a), ['ok,']); assert.deepEqual(extras(a), [], 'הבודדים לא נשארו "הגיע משהו נוסף"');
  assert.deepEqual(list(a), ['milkpack 2']);
  // 6 בודדים = מארז אחד מתוך שניים — "אחרת" 1
  const b = await reading([PACKS], {}, catalog);
  await scanQty(b, '7290000000008', 6);
  await b.release();
  assert.deepEqual(marks(b), ['qty:1,']); assert.deepEqual(extras(b), []);
  // 5 בודדים — לא מתחלק: נשארים "נוסף", והשורה מחכה לסימון
  const d = await reading([PACKS], {}, catalog);
  await scanQty(d, '7290000000008', 5);
  await d.release();
  assert.deepEqual(marks(d), [',']); assert.deepEqual(extras(d), ['milk 5']);
  // להפך: בתעודה הבודדים (12), ונסרקו 2 מארזים
  const e = await reading([BIG], {}, catalog);
  await scanQty(e, '7290000000060', 2);
  await e.release();
  assert.deepEqual(marks(e), ['ok,,']); assert.deepEqual(extras(e), []); assert.deepEqual(list(e), ['milk 12']);
});

test('12. בדיקה שסומנו בה שורות אינה מוחלפת כשהתעודה נקראת מחדש; בדיקה ממתינה שורדת רענון; קריאה בלבד', async () => {
  // (א) שורות כבר סומנו, ואז התעודה נקראת מחדש — אין חלון ממתין שידרוס אותן
  const c = await open([BIG]);
  await c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: 'lines' })`); await settle();
  click(c, { lineMark: '0:0:ok' });
  c.run(`closeReceiptQuantityReview(); receiptPaperScanState = 'running'`);
  assert.equal(c.run('receiptLinePendingAllowed()'), false);
  assert.doesNotMatch(c.run('receiptManualReceivingHtml()'), /rc-quantity-lines/, 'בלי "לסרוק בינתיים" — מחכים לקריאה');
  c.run('startReceiptLineCheck()');
  assert.equal(modalOpen(c), false); assert.match(c.toasts.at(-1), /התעודה נקראת מחדש — הבדיקה תיפתח לבד כשהקריאה תסתיים, עם מה שכבר סומן/);
  assert.deepEqual(marks(c), ['ok,,'], 'מה שסומן — נשאר');
  c.run(`receiptPaperScanState = 'ok'; startReceiptLineCheck()`);
  assert.equal(modalOpen(c), true); assert.deepEqual(marks(c), ['ok,,']);
  // (ב) רענון באמצע בדיקה ממתינה: מה שנסרק נשאר; הקריאה נקטעה — החלון לא נפתח לבד, ו"המשך לסרוק בינתיים" מחזיר אליו
  const storage = new Map();
  const s = await reading([BIG], { storage });
  await scanQty(s, '7290000000008', 7);
  const again = runtime('yotvata', { storage, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  again.run(`currentView = 'receiving'; mainMode = 'receiving'; renderReceiving()`);
  assert.equal(again.run('receiptPaperScanState'), 'interrupted'); assert.equal(modalOpen(again), false);
  assert.deepEqual(list(again), ['milk 7']); assert.equal(review(again).pending, true);
  assert.match(strip(app(again)), /המשך לסרוק בינתיים/);
  again.click('rc-quantity-lines');
  assert.equal(modalOpen(again), true); assert.deepEqual(extras(again), ['milk 7']); assert.equal(again.run('receiptLinePendingKind()'), 'failed');
  await s.release();
  // (ג) ביטבתה אין מוצרי ארגז בלי ברקוד (כמו בתנובה) — אין כפתורי ארגזים בחלון
  const k = await reading([BIG]);
  assert.doesNotMatch(rows(k), /data-line-crates/);
  await k.release();
  // (ד) הקליטה התחלפה או קריאה בלבד — סריקה בבדיקה ממתינה סוגרת את המצלמה בלי להוסיף
  const q = await reading([BIG]);
  await camera(q);
  q.run('receiptLocalEpoch++');
  beep(q, '7290000000008');
  assert.equal(cardOpen(q), false); assert.equal(q.run('scanPurpose'), 'field'); assert.deepEqual(list(q), []);
  q.run('canEditDraft = () => false');
  q.events.get('receiptLineScan:click')();
  assert.equal(q.run('scanPurpose'), 'field');
  q.run('canEditDraft = () => true');
  await q.release();
});

test('13. הגרסה עלתה ל-417, כולל הכותרת וה-service worker; "סריקת מוצרים" אינה נבחרת עוד בשום מסך', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '417'/);
  assert.match(html, /<title>הזמנות יטבתה - v417 /); assert.match(html, /id="verBadge"[^>]*>v417 /);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v417/);
  assert.doesNotMatch(html, /data-role="rc-count-by-scan"|מעבר לקליטה בסריקת מוצרים<|>התחל קליטת מוצרים</);
});

test('14. הכפתור הכחול שבתחתית ("בדוק וסיים") פותח את הבדיקה עד שהיא אושרה — לא השוואה של ספירה חלקית מול התעודה', async () => {
  const c = await reading([BIG]);
  await scanQty(c, '7290000000008', 9); // חלב: 12 בתעודה
  c.events.get('receiptQuantityClose:click')({});
  assert.equal(modalOpen(c), false);
  assert.ok(c.run(`mainMode === 'receiving' && currentView === 'receiving' && receiptList.length > 0`), 'יש ספירה — הכפתור הכחול מוצג (updateCart)');
  // בזמן שהתעודה נקראת — חלון הבדיקה (עם מה שנסרק), בלי הודעת שגיאה
  const said = c.toasts.length;
  c.events.get('cartBtn:click')({});
  assert.equal(modalOpen(c), true); assert.equal(review(c).pending, true); assert.equal(c.toasts.length, said);
  assert.deepEqual(extras(c), ['milk 9']);
  await c.release();
  assert.equal(review(c).pending, undefined);
  assert.deepEqual(marks(c), ['qty:9,,']);
  assert.equal(progress(c), 'התעודה נקראה — 3 שורות · אחת כבר סומנה ממה שנסרק', 'שורה אחת — ביחיד');
  // הרשימה עלתה ונשארו שורות — הכפתור חוזר לרשימה (מאותו מקום), לא להשוואה שרושמת כחוסר את מה שעוד לא נבדק
  c.events.get('receiptQuantityClose:click')({});
  c.events.get('cartBtn:click')({});
  assert.equal(modalOpen(c), true); assert.equal(c.run('currentView'), 'receiving'); assert.equal(c.run('pendingReceipt'), null);
  assert.equal(json(c, 'testConfirms').length, 0);
  assert.deepEqual(marks(c), ['qty:9,,']); assert.equal(okText(c), 'סיום (נשארו 2)');
  assert.deepEqual(list(c), ['milk 9'], 'הספירה לא נגעה');
  // אחרי "סיום" הבדיקה אושרה — הכפתור הכחול הוא שוב הסיום הרגיל
  click(c, { lineMark: '0:1:ok' }); click(c, { lineMark: '0:2:ok' });
  assert.equal(c.run('finishReceiptLineCheck()'), true);
  assert.ok(c.run('!!receiptQuantityCheckAudit()'), 'הבדיקה אושרה');
  c.run(`pendingReceipt = null; reconcileData = null; setView('receiving');`);
  c.events.get('cartBtn:click')({});
  assert.equal(modalOpen(c), false, 'לא פותח שוב את הרשימה');
  assert.ok(c.run(`currentView === 'reconcile' || !!pendingReceipt`), 'ממשיך לסיום');
  // קליטה שנספרת במסך הסריקה (נתוני התעודה הוקלדו ביד) — הכפתור כמו קודם: בלי חלון בדיקה
  const t = await open([BIG]);
  t.run(`receiptCountingMode = 'scan'; receiptEntryMode = 'manual'; receiptOpened = true; receiptList = [{ productId: 'milk', name: 'חלב', barcode: '7290000000008', qty: 3 }]; saveReceiptDraft(); renderReceiving();`);
  t.events.get('cartBtn:click')({});
  assert.equal(modalOpen(t), false); assert.equal(t.run('receiptQuantityReview'), null);
});
