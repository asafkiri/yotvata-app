// v419 — שורות שמחכות להכרעה לפני הבדיקה: בלי מסך ההשוואה; בחירת מוצר לשורה שלא זוהתה; ספרות שנקראו גוברות על השם; מסך ההשוואה
// מתרענן אחרי אישור. בעל העסק, 17.11.2026 (צילום מסך "בדיקת תעודה" וגיבוי, תעודות 9074000379 ו-407300217829): "למה כל כך הרבה
// בלאגן? חוסרים וטעויות... וגם שאני לוחץ על השורה (ניסיתי בשורה של המטבוחה) על הכפתור כן זה המוצר והמחיר נכונים וזה לא נלחץ לי
// בכלל"; ואחר כך: "יש מוצר אחד שבכלל אין כפתור שנותן לי להגיד כן זה המוצר. אבל למה בכלל נותר כל הבלאגן הזה, והוא מראה לי כל כך
// הרבה חוסרים". הנתונים כאן מומצאים (אותו מבנה כמו ב-line-check-pending.test.mjs); הקליטה מהגיבוי עצמה שוחזרה בכלי מקומי שאינו במאגר.
// מה שנבדק:
// א. השער —
//  1. התעודה נקראה כשחלון הבדיקה פתוח ושורה אחת מחכה לזיהוי: החלון נסגר, מסך הקליטה מציג כרטיס אחד (בלי כפתורי הבדיקה) והשורה
//     מתחתיו; לא מסך ההשוואה; הבחירה נשארת; רטט והודעה; מה שנסרק נשמר.
//  2. הכפתור הכחול, "בדוק שורה-שורה", "הכל הגיע", "יש חוסרים או עודפים" ו"לא הגיע כלום" בזמן שהשורות מחכות — נשארים במסך הקליטה.
//  3. הזיהוי הושלם — הרשימה נפתחת לבד, עם מה שנסרק; והתעודה השמורה זהה לקליטה שבה המוצר זוהה מההתחלה.
//  4. שורה לבדיקה מול הנייר (לא זיהוי): "כן, הכמות והמחיר נכונים לפי הנייר" מעדכן את הכרטיס, והרשימה נפתחת לבד.
//  5. נבחר "הכל הגיע כמו בתעודה": אחרי השורה האחרונה השאלה מופיעה לבד.
//  6. טיוטה מגרסה 418 שנעצרה שם (הבחירה נמחקה, נשארה בדיקה ממתינה): הבחירה חוזרת והרשימה נפתחת לבד; "שנה את הבדיקה" מוחק בדיקה ממתינה.
//  7. כשאין שורה שאפשר להשלים — כמו קודם: מסך ההשוואה.
// ב. מסך ההשוואה —
//  8. "כן, כך כתוב בתעודה — שמור את הפער" בראש מסך ההשוואה מצייר אותו מחדש (עד 418 הכרטיס נשאר, והלחיצה נראתה כאילו לא נקלטה).
// ג. שורה שהמוצר שלה לא זוהה —
//  9. ההצעות: מחיר זהה, ספרות קרובות, מחיר מבצע (חלש יותר), ושום הצעה כשאין ראיה; הכרטיס — "זה המוצר", "בחר מוצר מהמאגר", הקלדת ברקוד.
// 10. "זה המוצר": השורה משויכת, נשמרת ושורדת רענון; לחיצה ישנה נדחית; מוצר שהברקוד שלו השתנה אינו משויך עוד; נרשם בתעודה השמורה.
// 11. "בחר מוצר מהמאגר": חיפוש לפי מילים, ברקוד ומק״ט; אישור לפני השיוך; "חזרה לחיפוש"; שורה שהשתנתה בינתיים.
// 12. "בטל את הבחירה" מחזיר את השורה בדיוק למה שהייתה.
// ד. ספרות מול שם —
// 13. aiRowDigitEvidence: מק״ט, ברקוד מלא, סיומת, ספרה אחת; ומה שאינו ראיה.
// 14. מבין מוצרים באותו מחיר: הספרות שנקראו גוברות על השם; בלי ספרות — כמו ב-360; שוויון — השם מכריע.
// ה. מהירות —
// 15. הברקוד של כל מוצר נבדק פעם אחת ולא בכל חיפוש; שינוי של ברקוד במאגר נראה מיד; וכל שורה מזוהה פעם אחת לכל חישוב — עם אותן תשובות.
// ו. פחות שורות לאישור, ובדיקה שנמשכת —
// 16. הנחת שורה שהיא בדיוק ברוטו פחות נטו, כששניהם אושרו בקריאה נוספת, אינה נשלחת לאישור — הרשימה עולה מיד; ומה שהחשבון אינו מוכיח נשאר.
// 17. בדיקה שכבר התחילה ונבנית מחדש (המוצר של שורה תוקן): מה שסומן נשאר, מה שנסרק כ"הגיע משהו נוסף" עובר לשורה שלו, בלי שאלה, עם הודעה.
// 18. הגרסה.
// הרצה: node --test tools/paper-gate.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud, fixture } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', sku: '351247', barcode: '7290000000008', price: 5, posPrice: 6.9 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', sku: '216962', barcode: '7290011194246', price: 5.1 },
  { id: 'yogurt', name: 'יוגורט טבעי 150 גרם', code: '22', sku: '210184', barcode: '7290000000022', price: 3 },
  { id: 'cream', name: 'שמנת חמוצה 15% 200 מ״ל', code: '39', sku: '217122', barcode: '7290000000039', price: 2 },
  { id: 'soy', name: 'משקה סויה 500 מ״ל', code: '46', sku: '372481', barcode: '7290000000046', price: 6 }
];
const r2 = n => Math.round(n * 100) / 100;
function paper(spec, number, catalog = products) {
  const rows = spec.map(([id, q], i) => { const p = catalog.find(x => x.id === id);
    return { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.sku || p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: p.price, grossLineTotalExVat: r2(q * p.price), lineTotalExVat: r2(q * p.price), lineDiscountExVat: 0, confidence: .99 }; });
  const gross = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-17', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: gross, netToChargeExVat: gross, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: gross, promoDiscountExVat: 0, documentDiscountExVat: 0, warnings: [] };
}
// שורה שהקריאות לא הצליחו לזהות: שם שגוי, ברקוד שנבדל בשתי ספרות משל המוצר, ומק״ט שנקרא לא נכון — כמו שורה 14 בתעודה 9074000379
function unknownRow(doc, index) {
  doc.rows[index] = { ...doc.rows[index], code: null, itemCode: null, supplierItemCode: '216802', barcode: null, barcodeObserved: '7290110194246', barcodeReadType: 'full',
    barcodeMatchMethod: 'unresolved', description: 'סקי 5% 250 גרם' };
  return doc;
}
const EVIDENCE = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber', 'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
const MONEY = EVIDENCE.slice(-5);
// שורה כפי ששירות הסריקה מחזיר כשהקריאות הסכימו על המוצר — ועל הנתונים, חוץ מהשדות שב-issues ("לבדיקה מול הנייר")
function verified(row, catalog = products, issues = []) {
  const p = catalog.find(x => x.barcode === row.barcode);
  Object.assign(row, { barcodeMatchMethod: 'model_consensus', catalogHintId: null, catalogCandidateHintIds: [] });
  const evidence = Object.fromEntries(EVIDENCE.map(k => [k, row[k] ?? null])), identity = { productId: p.id, barcode: p.barcode };
  row.modelVerification = { version: 1, status: issues.length ? 'needs_review' : 'verified', selectedRead: 2, strongSelected: true, issues, identity, identitySupport: [0, 1], candidates: [identity],
    fieldSupport: Object.fromEntries(MONEY.map(k => [k, issues.includes(k) ? [] : [0, 1]])), evidence,
    readings: [2, 0, 1].map(read => ({ read, identity, values: structuredClone(evidence) })) };
  return row;
}
const BIG = () => paper([['milk', 12], ['cottage', 6], ['yogurt', 4]], '9074000379');
const UNKNOWN = () => unknownRow(BIG(), 1);
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const readyBuzzes = r => json(r, 'buzzes.filter(Array.isArray)');
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
const pagesOf = papers => JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })));
async function open(papers, opts = {}, catalog = products, promos = []) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products: structuredClone(catalog), promos, items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
  await cloud.tick();
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
  c.run(`todayStr = () => '2026-11-17'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    globalThis.buzzes = []; navigator.vibrate = ms => buzzes.push(ms);
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) };
    $('scanVideo').play = async () => {};
    aiScanDocuments = ${pagesOf(papers)}; renderReceiving();`);
  return c;
}
// "התחל בדיקה שורה-שורה" (או בחירה אחרת) נלחץ, והפענוח מעוכב: release() משחרר אותו
async function reading(papers, intent = 'lines', catalog, promos) {
  const c = await open(papers, {}, catalog, promos);
  const release = c.hold();
  c.started = c.run(`yotvataStartPaperScan({ manualQuantities: true, intent: '${intent}' })`);
  await settle();
  assert.equal(c.run('receiptPaperScanState'), 'running');
  c.release = async () => { release(); await c.started; await settle(); runQueued(c); };
  return c;
}
function runQueued(r) { let n = 0; while (r.callbacks.length && n++ < 20) r.callbacks.splice(0).forEach(fn => { try { fn(); } catch (e) {} }); }
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const cardClick = (r, dataset) => r.run(`receiptLineScanCardClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const cardType = (r, value) => r.run(`receiptLineScanCardInput({ target: { dataset: { scanGot: '' }, value: ${JSON.stringify(value)} } })`);
const beep = (r, code) => { r.run('lastScanTime = 0'); r.run(`onScanned(${JSON.stringify(code)})`); };
async function scanQty(r, code, qty) {
  r.events.get('receiptLineScan:click')(); await settle();
  beep(r, code); cardType(r, String(qty)); cardClick(r, { scanSave: '' });
  assert.equal(r.run('scanPurpose'), 'field', 'המצלמה נסגרה אחרי השמירה');
}
const finish = r => r.events.get('receiptQuantityConfirm:click')({});
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.productId + ':' + l.mark + (l.got ? ':' + l.got : '')).join(','));
const list = r => json(r, 'receiptList.map(l => l.productId + " " + l.qty)');
const modalOpen = r => r.run(`!$('receiptQuantityModal').classList.contains('hidden')`);
const app = r => r.node('app').innerHTML;
const draft = r => JSON.parse(r.storage.get('yt_receipt_draft'));
const gateText = r => strip(r.run('receiptQuantityButtonsHtml()'));
const pendingTitle = r => r.run(`(() => { const a = receiptPriceAudit(), p = priceAuditPendingRows(a); return p.length ? priceAuditPendingTitle(p, false, receiptPaperPromoMap(a)) : ''; })()`);
const cardOf = (r, rowIndex) => r.run(`(() => { const a = receiptPriceAudit(), row = a.rows.find(x => x.documentIndex === 0 && x.rowIndex === ${rowIndex}); return priceAuditActionCardHtml(row, receiptPaperPromoMap(a)); })()`);
const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// הכפתור כפי שהוא בכרטיס: ה-dataset שהלחיצה נושאת
function button(html, role) {
  const tag = html.match(new RegExp('<button[^>]*data-role="' + role + '"[^>]*>'));
  assert.ok(tag, 'אין כפתור ' + role + ' בכרטיס');
  const data = {}; for (const m of tag[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)) data[m[1].replace(/-([a-z])/g, (x, ch) => ch.toUpperCase())] = unescape(m[2]);
  return data;
}
const tap = (r, html, role) => { const d = button(html, role); return r.click(role, d.id, d); };
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
// קליטה שנעצרה בשער: חלב נסרק בזמן הקריאה, והתעודה נקראה עם שורה אחת שהמוצר שלה לא זוהה
async function gated(intent = 'lines') {
  const c = await reading([UNKNOWN()], intent);
  if (intent === 'lines') await scanQty(c, '7290000000008', 12);
  await c.release();
  return c;
}

test('1. התעודה נקראה ושורה אחת מחכה לזיהוי: החלון נסגר, כרטיס אחד במסך הקליטה — לא מסך ההשוואה; הבחירה נשארת; מה שנסרק נשמר', async () => {
  const c = await reading([UNKNOWN()]);
  await scanQty(c, '7290000000008', 12);
  assert.equal(modalOpen(c), true, 'החלון פתוח בזמן הקריאה');
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptLineCheckDocs()'), null, 'אי אפשר לבנות את הרשימה עדיין');
  assert.equal(c.run('currentView'), 'receiving', 'לא מסך ההשוואה');
  assert.equal(c.run('reconcileData'), null, 'ההשוואה לא נבנתה מול ספירה חלקית');
  assert.equal(modalOpen(c), false, 'החלון נסגר — השורה להשלמה במסך שמאחוריו');
  assert.equal(c.run('receiptQuantityIntent'), 'lines', 'הבחירה נשארת');
  assert.equal(draft(c).quantityIntent, 'lines', 'גם בטיוטה');
  assert.equal(review(c).pending, true, 'הבדיקה הממתינה נשארת, עם מה שנסרק');
  assert.deepEqual(list(c), ['milk 12']);
  assert.deepEqual(readyBuzzes(c), [[60, 40, 60]], 'רטט אחד');
  assert.equal(c.toasts.at(-1), 'התעודה נקראה. צריך רק לאשר שורה אחת — ואז ממשיכים לקלוט.');
  // הכרטיס: מה נקרא, מה נשאר, מה ייפתח, ומה כבר נסרק — ובלי מילה על חוסר שנמצא
  const html = app(c), text = strip(html);
  assert.match(html, /data-paper-gate/);
  assert.match(text, /התעודה נקראה · 3 שורות · 22 יח׳ צריך רק לאשר שורה אחת — ואז ממשיכים לקלוט בשורה הזאת האפליקציה לא הייתה בטוחה במה שכתוב בתעודה\. היא כאן למטה: בוחרים את המוצר, או מאשרים שהמספרים נכונים\. מיד אחרי זה הבדיקה שורה-שורה נפתחת לבד, וממשיכים לקלוט את הסחורה\. מה שכבר נסרק נשמר: מוצר אחד · 12 יח׳ — יסומן ברשימה כשהיא תיפתח\. שום דבר לא חסר — עוד לא נספר כלום\./);
  for (const role of ['rc-quantity-lines', 'rc-quantity-all', 'rc-quantity-differences', 'rc-quantity-none']) assert.doesNotMatch(html, new RegExp('data-role="' + role + '"'), 'אין כפתור בדיקה שעוד אינו יכול לפעול: ' + role);
  assert.ok(html.indexOf('data-paper-gate') < html.indexOf('data-price-audit'), 'הכרטיס מעל השורות');
  assert.match(text, /נשארה שורה אחת לבחירת מוצר איזה מוצר מופיע בשורה\?/, 'הפאנל שמתחת לכרטיס — בלי פסקת הסבר שנייה');
  assert.doesNotMatch(text, /מוצגות רק השורות שנותרו לטיפול/);
  assert.doesNotMatch(gateText(c), /חוסר|חסרות|חסר ₪|חסר \d/, 'הכרטיס אינו מדווח על חוסר — רק "שום דבר לא חסר"');
  assert.doesNotMatch(c.node('app').innerHTML, /data-ai-finding|חויבו \d+ יח׳ בתעודה ולא נסרקה/, 'ואין במסך כרטיסי חוסר של מסך ההשוואה');
  // ציור חוזר של המסך (כל ציור מנסה שוב את הבחירה) אינו עושה דבר: בלי רטט נוסף, בלי הודעה נוספת, ובלי לולאה
  const toasts = c.toasts.length;
  c.run('renderReceiving()'); runQueued(c); c.run('renderReceiving()'); runQueued(c);
  assert.equal(c.toasts.length, toasts); assert.deepEqual(readyBuzzes(c), [[60, 40, 60]]);
  assert.equal(c.run('currentView'), 'receiving'); assert.equal(c.run('receiptQuantityIntent'), 'lines');
});

test('2. בזמן שהשורות מחכות: הכפתור הכחול וכל אחת מהבדיקות נשארים במסך הקליטה, עם הודעה — בלי מסך ההשוואה', async () => {
  const c = await gated();
  for (const [what, call, intent] of [['הכפתור הכחול', 'receiptFinishFromBar()', 'lines'], ['בדוק שורה-שורה', 'startReceiptLineCheck()', 'lines'],
    ['הכל הגיע', 'startReceiptQuantityReview(true)', 'all'], ['חוסרים ועודפים', 'startReceiptQuantityReview(false)', 'differences'], ['לא הגיע כלום', 'startReceiptNothingArrived()', 'none']]) {
    c.run(call); runQueued(c);
    assert.equal(c.run('currentView'), 'receiving', what);
    assert.equal(c.run('reconcileData'), null, what + ': ההשוואה לא נבנתה');
    assert.equal(modalOpen(c), false, what);
    assert.equal(c.run('receiptQuantityIntent'), intent, what + ': הבחירה נשמרת למה שנבחר');
    assert.equal(c.toasts.at(-1), 'קודם מאשרים את השורה שכאן — ואז ממשיכים לקלוט.', what);
    assert.equal(c.run('testConfirms.length'), 0, what + ': בלי שאלה');
  }
  assert.match(gateText(c), /מיד אחרי זה תופיע לבד השאלה "לא הגיע כלום\?"\./, 'הכרטיס אומר מה ייפתח');
  assert.deepEqual(list(c), ['milk 12'], 'הספירה לא נגעה');
});

test('3. הזיהוי הושלם — הרשימה נפתחת לבד עם מה שנסרק; והתעודה השמורה זהה לקליטה שבה המוצר זוהה מההתחלה', async () => {
  const c = await gated();
  tap(c, cardOf(c, 1), 'price-pick-product'); runQueued(c);
  assert.equal(c.run('receiptPaperGate()'), null, 'אין עוד מה להשלים');
  assert.equal(modalOpen(c), true, 'הרשימה נפתחה לבד');
  assert.equal(c.run('receiptQuantityIntent'), null, 'הבחירה מומשה');
  assert.equal(review(c).pending, undefined);
  assert.deepEqual(marks(c), ['milk:ok,cottage:,yogurt:'], 'מה שנסרק מסומן');
  assert.equal(c.run('receiptLineNotice.text'), 'התעודה נקראה — 3 שורות · אחת כבר סומנה ממה שנסרק');
  assert.deepEqual(readyBuzzes(c), [[60, 40, 60], [60, 40, 60]], 'רטט שני — כשהרשימה עולה');
  assert.equal(c.run('currentView'), 'receiving');
  assert.doesNotMatch(app(c), /data-paper-gate/, 'הכרטיס ירד');
  // שאר השורות, "סיום", והשמירה — מול קליטה רגילה שבה אותה תעודה נקראה עם המוצר מזוהה
  click(c, { lineMark: '0:1:ok' }); click(c, { lineMark: '0:2:ok' }); finish(c); await settle();
  const saved = await save(c);
  const plain = await reading([BIG()]);
  await scanQty(plain, '7290000000008', 12);
  await plain.release();
  assert.equal(modalOpen(plain), true);
  click(plain, { lineMark: '0:1:ok' }); click(plain, { lineMark: '0:2:ok' }); finish(plain); await settle();
  const expected = await save(plain);
  assert.deepEqual(items(saved), items(expected)); assert.equal(saved.status, expected.status); assert.equal(saved.totalExVat, expected.totalExVat);
  // הבחירה מהמאגר נרשמת בתעודה בשמה
  const mapping = saved.aiAudit.confirmedMappings.find(m => m.rowIndex === 1);
  assert.equal(mapping.confirmationSource, 'manual_catalog_pick'); assert.equal(mapping.selectedProductId, 'cottage'); assert.equal(mapping.enteredBarcode, null);
});

test('4. שורה לבדיקה מול הנייר: "כן, הכמות והמחיר נכונים לפי הנייר" מעדכן את הכרטיס — והרשימה נפתחת לבד אחרי האחרונה', async () => {
  const doc = BIG();
  doc.rows.forEach(r => verified(r));
  // שתי שורות שבאמת צריכות עין: גם לברוטו וגם להנחה אין קריאה תומכת (הנחה לבדה, שהחשבון מוכיח, אינה נשלחת לאישור — בדיקה 16)
  verified(doc.rows[1], products, ['grossLineTotalExVat', 'lineDiscountExVat']); verified(doc.rows[2], products, ['grossLineTotalExVat', 'lineDiscountExVat']);
  const c = await reading([doc]);
  await c.release();
  assert.equal(c.run('currentView'), 'receiving'); assert.equal(modalOpen(c), false);
  assert.match(gateText(c), /צריך רק לאשר 2 שורות — ואז ממשיכים לקלוט בשורות האלה האפליקציה לא הייתה בטוחה במה שכתוב בתעודה\. הן כאן למטה, אחת אחת: בוחרים את המוצר, או מאשרים שהמספרים נכונים\. מיד אחרי זה הבדיקה שורה-שורה נפתחת לבד, וממשיכים לקלוט את הסחורה\. שום דבר לא חסר — עוד לא נספר כלום\.$/);
  assert.equal(pendingTitle(c), 'נשארו 2 שורות לבדיקה מול הנייר');
  tap(c, cardOf(c, 1), 'price-confirm-values');
  // האישור הזה אינו מצייר את כל המסך (רק את הפאנל) — הכרטיס שמעל השורות חייב להתעדכן איתו
  assert.match(strip(c.node('rcQuantityOptions').innerHTML), /צריך רק לאשר שורה אחת — ואז ממשיכים לקלוט/);
  assert.doesNotMatch(c.node('rcPriceAudit').innerHTML, /מוצגות רק השורות שנותרו לטיפול/, 'גם הפאנל שצויר מחדש — בלי פסקת ההסבר');
  assert.equal(pendingTitle(c), 'נשארה שורה אחת לבדיקה מול הנייר');
  runQueued(c);
  assert.equal(modalOpen(c), false, 'עוד שורה אחת מחכה'); assert.equal(c.run('receiptQuantityIntent'), 'lines');
  tap(c, cardOf(c, 2), 'price-confirm-values'); runQueued(c);
  assert.equal(modalOpen(c), true, 'הרשימה נפתחה לבד');
  assert.deepEqual(marks(c), ['milk:,cottage:,yogurt:']);
  assert.doesNotMatch(c.node('rcQuantityOptions').innerHTML, /data-paper-gate/);
});

test('5. נבחר "הכל הגיע כמו בתעודה": הכרטיס אומר מה יקרה, ואחרי השורה האחרונה השאלה מופיעה לבד', async () => {
  const c = await gated('all');
  assert.equal(c.run('currentView'), 'receiving'); assert.equal(c.run('receiptQuantityIntent'), 'all');
  assert.match(gateText(c), /מיד אחרי זה תופיע לבד השאלה "הכל הגיע כמו בתעודה\?"\./);
  assert.doesNotMatch(gateText(c), /מה שכבר נסרק/, 'לא נסרק דבר');
  assert.equal(c.run('testConfirms.length'), 0);
  tap(c, cardOf(c, 1), 'price-pick-product'); runQueued(c);
  assert.equal(c.run('testConfirms.length'), 1, 'השאלה הופיעה לבד');
  assert.equal(c.run('testConfirms[0].title'), 'הכל הגיע כמו בתעודה');
  assert.match(c.run('testConfirms[0].message'), /תעודת ספק 9074000379 · ₪102\.60 · 3 שורות · 22 יח׳/);
  assert.equal(c.run('receiptQuantityIntent'), null);
});

test('6. טיוטה מגרסה 418 שנעצרה לפני הרשימה: הבחירה חוזרת והרשימה נפתחת לבד; "שנה את הבדיקה" מוחק בדיקה ממתינה', async () => {
  const c = await gated();
  // כך נשמרה הטיוטה ב-418: הבחירה נמחקה לפני שמסך ההשוואה נפתח, והבדיקה הממתינה נשארה
  c.run('receiptQuantityIntent = null; saveReceiptDraft(); restoreReceiptDraft();');
  assert.equal(c.run('receiptQuantityIntent'), null); assert.equal(review(c).pending, true);
  c.run('renderReceiving()'); runQueued(c);
  assert.equal(c.run('receiptQuantityIntent'), 'lines', 'הרשימה עוד חייבת לעלות');
  assert.match(gateText(c), /מיד אחרי זה הבדיקה שורה-שורה נפתחת לבד, וממשיכים לקלוט את הסחורה\./);
  assert.equal(c.run('currentView'), 'receiving');
  tap(c, cardOf(c, 1), 'price-pick-product'); runQueued(c);
  assert.equal(modalOpen(c), true); assert.deepEqual(marks(c), ['milk:ok,cottage:,yogurt:']);
  // בלי בדיקה ממתינה הבחירה אינה מומצאת: הכרטיס אומר שיבחרו אחר כך, ואחרי השורה — כפתורי הבדיקה
  const d = await gated('all');
  d.run('receiptQuantityIntent = null; saveReceiptDraft(); renderReceiving()'); runQueued(d);
  assert.equal(d.run('receiptQuantityIntent'), null);
  assert.match(gateText(d), /אחרי זה בוחרים איך לבדוק את הכמויות\./);
  tap(d, cardOf(d, 1), 'price-pick-product'); runQueued(d);
  assert.equal(modalOpen(d), false); assert.equal(d.run('testConfirms.length'), 0);
  assert.match(app(d), /data-role="rc-quantity-lines"/, 'כפתורי הבדיקה חזרו');
  // "שנה את הבדיקה" בזמן הקריאה: הבדיקה הממתינה נמחקת, ומה שנסרק בה נשאר בספירה
  const e = await reading([UNKNOWN()]);
  await scanQty(e, '7290000000008', 12);
  e.run('closeReceiptQuantityReviewByUser()');
  e.click('rc-intent-clear');
  assert.equal(e.run('receiptQuantityReview'), null); assert.deepEqual(list(e), ['milk 12']);
  await e.release();
  assert.equal(e.run('receiptQuantityIntent'), null, 'שום רשימה אינה "חייבת" לעלות');
  assert.match(gateText(e), /אחרי זה בוחרים איך לבדוק את הכמויות\./);
});

test('7. כשאין שורה שאפשר להשלים כאן — כמו קודם: ההודעה הישנה ומסך ההשוואה; ושורה שהחשבון שלה סותר את עצמו היא שורה להשלמה', async () => {
  // הכמויות שבתעודה אינן ידועות, ואין בפאנל שורה לבחירת מוצר או לבדיקה מול הנייר: ההשוואה היא שמסבירה, כמו עד 418
  const c = await reading([BIG()]);
  c.run('receiptQuantityPaperRows = () => null');
  await c.release();
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptPaperGate()'), null, 'אין שער — אין כאן שורה להשלים');
  assert.equal(c.run('currentView'), 'reconcile');
  assert.match(c.toasts.at(-1), /צריך להשלים את זיהוי המוצרים ובדיקת הפענוח/);
  assert.equal(modalOpen(c), false);
  assert.equal(c.run('receiptQuantityIntent'), null, 'הבחירה נמחקה, כמו קודם');
  // חזרה למסך הקליטה אינה קופצת שוב למסך ההשוואה, והבחירה אינה חוזרת מעצמה (אין שער)
  c.run("setView('receiving')"); runQueued(c);
  assert.equal(c.run('currentView'), 'receiving'); assert.equal(c.run('receiptQuantityIntent'), null);
  assert.match(app(c), /data-role="rc-quantity-lines"/, 'כפתורי הבדיקה, כמו קודם');
  // שורה שהחשבון שלה סותר את עצמו (6 × 5.10 = 30.60, אבל סכום השורה 33.60) — יש לה כרטיס בפאנל ("תקן לפי הנייר"), ולכן היא שער
  const doc = BIG();
  doc.rows[1].lineTotalExVat = 33.6;
  doc.subtotalExVat = doc.netToChargeExVat = doc.itemsSectionTotalExVat = r2(doc.subtotalExVat + 3);
  const d = await reading([doc]);
  await d.release();
  assert.equal(d.run('receiptPaperScanState'), 'ok', json(d, 'receiptPaperScanProblems').join(';'));
  assert.equal(d.run('currentView'), 'receiving');
  assert.match(gateText(d), /צריך רק לאשר שורה אחת — ואז ממשיכים לקלוט/);
  assert.match(cardOf(d, 1), /data-role="paper-row-edit"/, 'התיקון לפי הנייר — בכרטיס שמתחת');
});

test('8. מסך ההשוואה: "כן, כך כתוב בתעודה — שמור את הפער" מצייר את המסך מחדש — הכרטיס יורד והכותרת מתעדכנת', async () => {
  // חלב במחיר אחר ממחיר המאגר: פער מחיר אינו עוצר את הרשימה, ומגיעים איתו למסך ההשוואה אחרי "סיום"
  const doc = BIG();
  Object.assign(doc.rows[0], { unitPriceExVat: 5.5, grossLineTotalExVat: 66, lineTotalExVat: 66 });
  doc.subtotalExVat = doc.netToChargeExVat = doc.itemsSectionTotalExVat = r2(doc.subtotalExVat + 6);
  const c = await reading([doc]);
  await c.release();
  assert.equal(modalOpen(c), true, 'אין שער — פער מחיר אינו עוצר את הבדיקה');
  for (let k = 0; k < 3; k++) click(c, { lineMark: '0:' + k + ':ok' });
  finish(c); await settle();
  assert.equal(c.run('currentView'), 'reconcile');
  const before = app(c);
  assert.match(strip(before), /נשארה שורה אחת עם פער מחיר/);
  tap(c, before, 'price-confirm-paper');
  const after = app(c);
  assert.notEqual(after, before, 'המסך צויר מחדש');
  assert.doesNotMatch(after, /data-role="price-confirm-paper"/, 'הכרטיס ירד');
  assert.doesNotMatch(strip(after), /נשארה שורה אחת עם פער מחיר/);
  assert.match(strip(after), /הבדיקה הושלמה · 1 פערי מחיר נשמרו/);
  assert.equal(c.toasts.at(-1), 'הנתונים אושרו לפי הנייר. פער המחיר נשמר בפירוט התעודה.');
  // "פתח לבדיקה חוזרת" — אותו דבר בכיוון ההפוך
  tap(c, after, 'price-reopen-paper');
  assert.match(app(c), /data-role="price-confirm-paper"/);
  assert.equal(c.run('currentView'), 'reconcile');
});

test('9. ההצעות לשורה שלא זוהתה: מחיר זהה וספרות קרובות; מחיר מבצע חלש יותר; בלי ראיה — בלי הצעה; והכרטיס', async () => {
  const c = await gated();
  const guesses = () => json(c, 'priceAuditIdentityGuesses(aiScanResponse.scan.documents[0].rows[1])');
  // קוטג׳: המחיר זהה (2), והברקוד שנקרא נבדל משלו בשתי ספרות (1)
  assert.deepEqual(guesses().list.map(g => [g.productId, g.points, g.byPrice, g.nearOnly]), [['cottage', 3, true, true]]);
  assert.equal(guesses().more, 0);
  const html = cardOf(c, 1), text = strip(html);
  assert.match(text, /^איזה מוצר מופיע בשורה\? בדוק בתעודה איזה מוצר מודפס בשורה הזאת, ובחר אותו\./);
  assert.match(text, /הפענוח קרא: סקי 5% 250 גרם — ייתכן שהשם שגוי/);
  assert.match(text, /אולי זה המוצר\? בחר רק אם זה השם שמודפס בשורה שבתעודה: קוטג׳ 5% 250 גרם אותו מחיר כמו בשורה \(₪5\.10\) · הברקוד שנקרא קרוב לשלו · 7290011194246 זה המוצר בחר מוצר מהמאגר או הקלד את הברקוד שמודפס בשורה$/);
  assert.equal(button(html, 'price-pick-product').id, 'cottage');
  assert.match(html, /data-role="price-pick-search"/); assert.match(html, /data-role="ai-manual-paper-barcode"/);
  // מוצר נוסף באותו מחיר, בלי ספרות — מוצג אחרי החזק (הפרש של נקודה אחת); מוצר שרק מחיר המבצע שלו מתאים — רעש ליד השניים
  c.run(`products.push({ id: 'ski', name: 'גבינה סקי 5%', barcode: '7290000000060', price: 5.1 });
    promos.push({ id: 'p-soy', name: 'סויה', pct: 15, minQty: 1, minUnit: 'unit', cartonSize: null, type: 'receipt', productIds: ['soy'], start: '2026-11-01', end: '2026-11-30' });`);
  assert.deepEqual(guesses().list.map(g => [g.productId, g.points, g.basis]), [['cottage', 3, 'catalog_base'], ['ski', 2, 'catalog_base']]);
  assert.match(strip(cardOf(c, 1)), /אולי אחד מאלה\? בחר רק אם זה השם שמודפס בשורה שבתעודה: קוטג׳ 5% 250 גרם .* גבינה סקי 5% אותו מחיר כמו בשורה \(₪5\.10\) · 7290000000060 זה המוצר/);
  // בלי השניים — מחיר המבצע (6 פחות 15% = 5.10) הוא ההצעה היחידה, והיא אומרת שזה מחיר מבצע
  c.run(`products = products.filter(p => !['cottage', 'ski'].includes(p.id))`);
  assert.deepEqual(guesses().list.map(g => [g.productId, g.points, g.basis]), [['soy', 1, 'active_promotion']]);
  assert.match(strip(cardOf(c, 1)), /משקה סויה 500 מ״ל מחיר המבצע שלו הוא המחיר שבשורה \(₪5\.10\)/);
  // שום דבר לא מצביע על מוצר — בלי הצעות, והכרטיס נשאר עם הבחירה מהמאגר והקלדת הברקוד
  c.run(`promos.length = 0`);
  assert.deepEqual(guesses(), { list: [], more: 0 });
  const bare = cardOf(c, 1);
  assert.doesNotMatch(bare, /data-identity-guesses|price-pick-product/);
  assert.match(strip(bare), /בחר מוצר מהמאגר או הקלד את הברקוד שמודפס בשורה$/);
  // יותר משלוש — שלוש, ו"יש עוד"
  c.run(`for (let i = 0; i < 5; i++) products.push({ id: 'same' + i, name: 'מוצר ' + i, barcode: '72900000' + (1000 + i * 7), price: 5.1 })`); // 12 ספרות — בלי ספרת ביקורת של 13
  const many = guesses();
  assert.equal(many.list.length, 3); assert.equal(many.more, 2);
  assert.match(strip(cardOf(c, 1)), /יש עוד 2 מוצרים שמתאימים — חפש במאגר\./);
});

test('10. "זה המוצר": השורה משויכת, נשמרת ושורדת רענון; לחיצה ישנה נדחית; מוצר שהברקוד שלו השתנה אינו משויך עוד', async () => {
  const c = await gated();
  const row = 'aiScanResponse.scan.documents[0].rows[1]', resolution = () => json(c, 'aiResolveInvoiceBarcode(' + row + ')');
  const html = cardOf(c, 1), stale = button(html, 'price-pick-product');
  // לחיצה על כפתור של שורה שהשתנתה מאז (הכמות תוקנה) — נדחית, עם הודעה
  c.run(row + '.quantity = 7');
  assert.equal(c.run(`priceAuditPickProduct(0, 1, 'cottage', ${JSON.stringify(stale.reviewToken)})`), false);
  assert.equal(c.toasts.at(-1), 'השורה או המוצר השתנו. פתח שוב את השורה כדי לבחור.');
  assert.equal(c.run(row + '.barcodeMatchMethod'), 'unresolved');
  c.run(row + '.quantity = 6');
  // מוצר שאינו במאגר / בלי ברקוד יחיד — נדחה
  assert.equal(c.run(`priceAuditPickProduct(0, 1, 'nope', ${JSON.stringify(stale.reviewToken)})`), false);
  // הלחיצה עצמה
  tap(c, html, 'price-pick-product');
  assert.equal(c.toasts.at(-1), 'המוצר שויך לשורה והמחיר תואם. השורה הוסרה מהרשימה.');
  assert.equal(resolution().product.id, 'cottage'); assert.equal(resolution().method, 'user_confirmed');
  const saved = json(c, row);
  assert.equal(saved.barcodeUserConfirmedFromMethod, 'manual_catalog_pick'); assert.equal(saved.barcodeUserPicked, '7290011194246'); assert.equal(saved.barcode, '7290011194246');
  assert.equal(saved.barcodeObserved, '7290110194246', 'מה שנקרא נשאר כמו שנקרא'); assert.equal(saved.description, 'סקי 5% 250 גרם');
  assert.equal(saved.quantity, 6); assert.equal(saved.unitPriceExVat, 5.1);
  assert.equal(json(c, 'receiptPriceAudit().rows[1]').result, 'match');
  assert.equal(pendingTitle(c), '');
  assert.equal(draft(c).aiScan.scan.documents[0].rows[1].barcodeUserConfirmedFromMethod, 'manual_catalog_pick', 'נשמר בטיוטה');
  // לחיצה חוזרת על אותו כפתור (שורה שכבר זוהתה) — נדחית
  assert.equal(c.run(`priceAuditPickProduct(0, 1, 'cottage', ${JSON.stringify(stale.reviewToken)})`), false);
  // רענון
  c.run('restoreReceiptDraft()');
  assert.equal(resolution().product.id, 'cottage');
  // הברקוד של המוצר השתנה במאגר אחרי הבחירה — השיוך אינו תקף עוד, והשורה חוזרת לבחירה
  c.run(`products.find(p => p.id === 'cottage').barcode = '7290000000077'`);
  assert.equal(resolution().product, undefined);
  assert.match(resolution().error, /הברקוד שאושר אינו קיים במאגר|אינו תואם עוד לברקוד שלו/);
  assert.equal(pendingTitle(c), 'נשארה שורה אחת לבחירת מוצר');
});

test('11. "בחר מוצר מהמאגר": חיפוש לפי מילים, ברקוד ומק״ט; אישור לפני השיוך; "חזרה לחיפוש"; ושורה שהשתנתה בינתיים', async () => {
  const c = await gated();
  const body = () => c.node('pricePickBody').innerHTML, results = () => strip(c.node('pricePickResults').innerHTML);
  const search = q => { c.node('pricePickSearch').value = q; c.node('pricePickSearch').oninput(); return results(); };
  const choose = id => c.node('pricePickResults').onclick({ target: { closest: () => ({ dataset: { pickId: id } }) } });
  c.click('price-pick-search', undefined, { doc: '0', row: '1' });
  assert.equal(json(c, 'pricePickState && [pricePickState.documentIndex, pricePickState.rowIndex, pricePickState.query, pricePickState.chosen]').join(), '0,1,,');
  // החלון: השורה, שדה החיפוש, וההצעה — עוד לפני שהוקלד דבר
  assert.match(strip(body()), /^תעודה מס׳ 9074000379 · עמוד 1 מתוך 1 · שורה מודפסת 2 הפענוח קרא: סקי 5% 250 גרם — ייתכן שהשם שגוי 6 יח׳ × ₪5\.10 · סכום שורה ₪30\.60 אולי זה המוצר: קוטג׳ 5% 250 גרם אותו מחיר כמו בשורה \(₪5\.10\) · הברקוד שנקרא קרוב לשלו · מק״ט 216962 · 7290011194246 לא זה\? הקלד למעלה חלק מהשם שמודפס בשורה\.$/);
  assert.match(body(), /id="pricePickSearch"[^>]*placeholder="חפש לפי שם, ברקוד או מק״ט"/);
  // מילים בכל סדר, בלי גרש; ספרות מהברקוד; מק״ט; ומה שאינו במאגר
  assert.match(search('250 קוטג'), /^קוטג׳ 5% 250 גרם אותו מחיר כמו בשורה · במאגר ₪5\.10 · מק״ט 216962 · 7290011194246$/);
  assert.match(search('1194246'), /^קוטג׳ 5% 250 גרם /);
  assert.match(search('217122'), /^שמנת חמוצה 15% 200 מ״ל במאגר ₪2\.00 · מק״ט 217122 · 7290000000039$/);
  assert.match(search('אבוקדו'), /^לא נמצא מוצר כזה במאגר\. מוצר חדש\? סגור את החלון והקלד את הברקוד שמודפס בשורה — משם אפשר להוסיף אותו\.$/);
  // כמה תוצאות: קודם מי שבמחיר של השורה
  const order = search('5%').split(' 729').length; assert.ok(order >= 2);
  assert.match(search('ג'), /^קוטג׳ 5% 250 גרם אותו מחיר כמו בשורה/, 'המחיר של השורה ראשון');
  // בחירה → שלב האישור, באותו חלון; "חזרה לחיפוש" מחזיר עם מה שהוקלד
  search('חלב'); choose('milk');
  assert.equal(c.run('pricePickState.chosen'), 'milk');
  assert.match(strip(body()), /זה המוצר שמופיע בשורה\? חלב 3% בקרטון 1 ליטר 7290000000008 · במאגר ₪5\.00 בדוק שזה השם שמודפס בשורה שבתעודה\. הכמות והמחיר נשארים כמו שנקראו, ונבדקים אחר כך\. כן, שייך לשורה חזרה לחיפוש$/);
  assert.equal(c.run('aiScanResponse.scan.documents[0].rows[1].barcodeMatchMethod'), 'unresolved', 'עוד לא שויך');
  c.node('pricePickBack').onclick();
  assert.equal(c.run('pricePickState.chosen'), null); assert.match(body(), /id="pricePickSearch"[^>]*value="חלב"/);
  // הבחירה הנכונה, והאישור
  search('קוטג'); choose('cottage'); c.node('pricePickConfirm').onclick(); runQueued(c);
  assert.equal(c.run('pricePickState'), null, 'החלון נסגר');
  assert.equal(c.run('aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[1]).product.id'), 'cottage');
  assert.equal(c.toasts.at(-1), 'המוצר שויך לשורה והמחיר תואם. השורה הוסרה מהרשימה.');
  assert.equal(modalOpen(c), true, 'והרשימה נפתחה לבד');
  // שורה שהשתנתה בזמן שהחלון פתוח — האישור נדחה, ושום דבר לא משויך
  const d = await gated();
  d.click('price-pick-search', undefined, { doc: '0', row: '1' });
  d.node('pricePickResults').onclick({ target: { closest: () => ({ dataset: { pickId: 'cottage' } }) } });
  d.run('aiScanResponse.scan.documents[0].rows[1].quantity = 9');
  d.node('pricePickConfirm').onclick();
  assert.equal(d.toasts.at(-1), 'התעודה או המוצר השתנו. פתח שוב את השורה כדי לבחור.');
  assert.equal(d.run('aiScanResponse.scan.documents[0].rows[1].barcodeMatchMethod'), 'unresolved'); assert.equal(d.run('pricePickState'), null);
  // ✕ סוגר בלי לשנות
  d.click('price-pick-search', undefined, { doc: '0', row: '1' }); d.node('pricePickClose').onclick();
  assert.equal(d.run('pricePickState'), null);
});

test('12. "בטל את הבחירה" מחזיר את השורה בדיוק למה שהייתה — והשורה חוזרת לרשימת הטיפול', async () => {
  const c = await gated();
  const row = 'aiScanResponse.scan.documents[0].rows[1]', before = json(c, row);
  tap(c, cardOf(c, 1), 'price-pick-product'); runQueued(c);
  assert.equal(modalOpen(c), true);
  c.run('closeReceiptQuantityReviewByUser()');
  const panel = c.run('receiptPriceAuditHtml()');
  assert.match(strip(panel), /מוצרים שבחרת מהמאגר \(1\) קוטג׳ 5% 250 גרם עמוד 1 מתוך 1 · שורה מודפסת 2 · הפענוח קרא: סקי 5% 250 גרם בטל את הבחירה/);
  tap(c, panel, 'price-pick-undo'); runQueued(c);
  assert.deepEqual(json(c, row), before, 'בדיוק כמו לפני הבחירה');
  assert.equal(c.toasts.at(-1), 'הבחירה בוטלה. השורה חזרה לרשימה — בחר את המוצר מחדש.');
  assert.equal(pendingTitle(c), 'נשארה שורה אחת לבחירת מוצר');
  assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /data-price-picked/);
  assert.match(gateText(c), /צריך רק לאשר שורה אחת — ואז ממשיכים לקלוט/, 'השער חזר — הרשימה מחכה שוב לשורה');
  // ביטול של שורה שלא נבחרה מהמאגר — לא עושה דבר
  assert.equal(c.run('priceAuditUndoPick(0, 0)'), false);
});

// ----- ד. ספרות מול שם: אותו מבנה כמו ב-verified-price-identity.test.mjs (שורה אחת, שלושה מוצרים באותו מחיר) -----
function disputed({ change = () => {} } = {}) {
  const data = fixture('yotvata'), doc = data.paper.scan.documents[0], r = doc.rows[0];
  data.products = [
    { id: 'tortellini', name: 'פסטה טורטליני פטריות', sku: '368400', barcode: '7290003989553', price: 13.77 },
    { id: 'ravioli', name: 'רביולי גבינה 400 גרם', sku: '368435', barcode: '7290003989539', price: 13.77 },
    { id: 'kreplach', name: 'פסטה קרפלך תפוח אדמה', sku: '368500', barcode: '7290119373567', price: 13.77 }];
  data.items = [];
  Object.assign(r, { barcode: null, barcodeObserved: '7290003980000', barcodeReadType: 'full', barcodeMatchMethod: 'unresolved', description: 'פסטה טורטליני', supplierItemCode: null, itemCode: null, confidence: .8,
    catalogHintId: null, catalogCandidateHintIds: [], quantity: 11, unitPriceExVat: 13.77, grossLineTotalExVat: 151.47, lineDiscountExVat: 0, lineTotalExVat: 151.47 });
  change(data, r);
  const evidence = Object.fromEntries(EVIDENCE.map(k => [k, r[k] ?? null]));
  // הקריאה שנבחרה (2) וקריאה 0 מסכימות על המחיר; על המוצר — לא
  r.modelVerification = { version: 1, status: 'needs_review', selectedRead: 2, strongSelected: true, issues: ['identity'], identity: null, identitySupport: [], candidates: [],
    fieldSupport: Object.fromEntries(MONEY.map(k => [k, [0]])), evidence,
    readings: [{ read: 2, identity: null, values: { ...structuredClone(evidence), barcode: r.barcodeObserved } }, { read: 0, identity: null, values: { ...structuredClone(evidence), barcode: r.read0 || '7290000000000', description: r.name0 || r.description } },
      ...(r.read3 ? [{ read: 3, identity: null, values: { ...structuredClone(evidence), barcode: r.read3 } }] : [])] };
  delete r.read0; delete r.name0; delete r.read3;
  Object.assign(doc, { subtotalExVat: 151.47, printedUnits: 11, itemsSectionTotalExVat: 151.47 });
  data.paper.serviceVersion = 153;
  doc.__pricePaper = structuredClone(doc); doc.__priceSourceId = 'digit-evidence-fixture';
  const c = runtime('yotvata', { data });
  c.context.savedPriceScan = { ...data.paper, docInputs: [{ amount: doc.subtotalExVat, units: 11, pageCount: 1 }] };
  c.run("receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedPriceScan);receiptPaperScanState='ok';receiptDocDate='2026-11-17';receiptNotes=[{amount:aiScanResponse.scan.documents[0].subtotalExVat,units:11}];recomputeNoteTotal();saveReceiptDraft();renderReceiving()");
  return c;
}
const ROW = 'aiScanResponse.scan.documents[0].rows[0]';
const resolved = c => json(c, 'aiResolveInvoiceBarcode(' + ROW + ')');
const evidenceOf = (c, id) => c.run(`aiRowDigitEvidence(${ROW}, products.find(p => p.id === '${id}'))`);

test('13. aiRowDigitEvidence: מק״ט זהה ויחיד, ברקוד מלא, סיומת של 6 ספרות, ספרה אחת — ומה שאינו ראיה', () => {
  // בלי ספרות שמצביעות על מוצר
  let c = disputed();
  assert.deepEqual(['tortellini', 'ravioli', 'kreplach'].map(id => evidenceOf(c, id)), [0, 0, 0]);
  // ברקוד מלא שהקריאה שנבחרה קראה — של הרביולי (2); שתי ספרות ממנו — לא ראיה
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989539'; } });
  assert.deepEqual(['tortellini', 'ravioli', 'kreplach'].map(id => evidenceOf(c, id)), [0, 2, 0], 'הטורטליני נבדל בשתי ספרות — לא ראיה');
  // ברקוד מלא שקריאה אחרת (0) קראה
  c = disputed({ change: (d, r) => { r.read0 = '7290003989539'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 2);
  // ספרה אחת שונה, 13 ספרות (1)
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989530'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 1); assert.equal(evidenceOf(c, 'tortellini'), 0);
  // סיומת: 6 ספרות — ראיה; 5 — לא
  c = disputed({ change: (d, r) => { r.barcodeObserved = '989539'; r.barcodeReadType = 'suffix'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 2); assert.equal(evidenceOf(c, 'tortellini'), 0);
  c = disputed({ change: (d, r) => { r.barcodeObserved = '89539'; r.barcodeReadType = 'suffix'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 0);
  // מק״ט הספק: זהה למק״ט של מוצר אחד (2), יחד עם ברקוד (4); מק״ט ששני מוצרים חולקים — לא ראיה; מק״ט קצר מדי — לא
  c = disputed({ change: (d, r) => { r.supplierItemCode = '368435'; } });
  assert.deepEqual(['tortellini', 'ravioli', 'kreplach'].map(id => evidenceOf(c, id)), [0, 2, 0]);
  c = disputed({ change: (d, r) => { r.supplierItemCode = '368435'; r.barcodeObserved = '7290003989539'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 4);
  c = disputed({ change: (d, r) => { r.supplierItemCode = '368435'; d.products[0].sku = '368435'; } });
  assert.deepEqual(['tortellini', 'ravioli'].map(id => evidenceOf(c, id)), [0, 0]);
  c = disputed({ change: (d, r) => { r.supplierItemCode = '36'; d.products[1].sku = '36'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 0);
  // קריאה 4 של שירות 153 (read 3) לעולם אינה מצביעה על זהות
  c = disputed({ change: (d, r) => { r.read3 = '7290003989539'; } });
  assert.equal(evidenceOf(c, 'ravioli'), 0);
});

test('14. מבין מוצרים באותו מחיר: הספרות שנקראו גוברות על השם; בלי ספרות — כמו ב-360; שוויון בספרות — השם מכריע', () => {
  // בלי ספרות: השם שנקרא ("פסטה טורטליני") בוחר את הטורטליני — בדיוק כמו עד 418
  let c = disputed();
  assert.equal(resolved(c).product.id, 'tortellini'); assert.equal(resolved(c).method, 'verified_price_name');
  assert.equal(resolved(c).identityEvidence.digitEvidence, undefined, 'בלי ראיית ספרות — בלי השדה');
  // הברקוד המלא והתקין של הרביולי נקרא: הרביולי, למרות שהשם שנקרא אינו דומה לו בכלל (וגם לא רמז עליו)
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989539'; } });
  assert.equal(resolved(c).product.id, 'ravioli'); assert.equal(resolved(c).method, 'verified_price_name');
  assert.equal(resolved(c).identityEvidence.digitEvidence, 2);
  assert.equal(resolved(c).identityEvidence.priceBasis, 'catalog_base');
  assert.deepEqual(resolved(c).candidates.map(k => [k.product.id, k.digits]), [['ravioli', 2], ['tortellini', 0], ['kreplach', 0]]);
  assert.equal(json(c, 'receiptPriceAudit().rows[0]').productId, 'ravioli'); assert.equal(json(c, 'receiptPriceAudit().rows[0]').result, 'match');
  assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0, 'בלי שאלה, כמו ב-360');
  assert.equal(c.run("aiEvaluateInvoiceScan(aiScanResponse).aggregates.get('ravioli').qty"), 11);
  assert.equal(json(c, 'aiAutomaticNamePriceMappingsAudit()')[0].digitEvidence, 2, 'נרשם בתיעוד ההתאמה');
  // רק מק״ט הספק מצביע — מספיק
  c = disputed({ change: (d, r) => { r.supplierItemCode = '368435'; } });
  assert.equal(resolved(c).product.id, 'ravioli');
  // ספרה אחת שונה מול שם דומה: הספרות
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989530'; } });
  assert.equal(resolved(c).product.id, 'ravioli');
  // שתי קריאות מצביעות על שני מוצרים שונים (שוויון בספרות) — השם מכריע, כמו קודם
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989539'; r.read0 = '7290003989553'; } });
  assert.equal(resolved(c).product.id, 'tortellini');
  // הספרות אינן עוקפות את המחיר: מוצר שהברקוד שלו נקרא אבל המחיר שלו אחר — אינו מועמד
  c = disputed({ change: (d, r) => { r.barcodeObserved = '7290003989539'; d.products[1].price = 14; } });
  assert.equal(resolved(c).product.id, 'tortellini');
  assert.deepEqual(resolved(c).candidates.map(k => k.product.id), ['tortellini', 'kreplach'], 'הרביולי אינו מועמד');
});

test('15. מהירות בלי שינוי בתשובות: ברקוד של מוצר נבדק פעם אחת, שינוי במאגר נראה מיד, וכל שורה מזוהה פעם אחת לכל חישוב', async () => {
  const c = await gated();
  const matches = code => json(c, `aiCatalogBarcodeMatches(${JSON.stringify(code)}, false).map(m => m.product.id)`);
  // ספירת הבדיקות של ספרת הביקורת: ציור של מסך הקליטה אינו בודק מחדש את כל המאגר
  c.run('globalThis.eanChecks = 0; { const original = aiIsValidEan13; aiIsValidEan13 = v => { eanChecks++; return original(v); }; }');
  c.run('renderReceiving()'); runQueued(c);
  const first = c.run('eanChecks');
  c.run('eanChecks = 0; renderReceiving()'); runQueued(c);
  assert.ok(c.run('eanChecks') <= first, 'ציור חוזר אינו יקר מהראשון');
  assert.ok(c.run('eanChecks') < c.run('products.length') * 6, 'לא נבדק כל המאגר שוב ושוב: ' + c.run('eanChecks'));
  // אותן תשובות: מוצר נמצא לפי הברקוד שלו; ברקוד שהשתנה במקום נראה מיד; 13 ספרות בלי ספרת ביקורת תקינה — לא במאגר; מוצר חדש — נמצא
  assert.deepEqual(matches('7290011194246'), ['cottage']);
  c.run(`products.find(p => p.id === 'cottage').barcode = '7290000000053'`);
  assert.deepEqual(matches('7290011194246'), []); assert.deepEqual(matches('7290000000053'), ['cottage']);
  c.run(`products.find(p => p.id === 'cottage').barcode = '7290000000054'`); // ספרת ביקורת שגויה
  assert.deepEqual(matches('7290000000054'), []); assert.equal(c.run(`aiCatalogSafeBarcode(products.find(p => p.id === 'cottage'))`), '');
  c.run(`products.find(p => p.id === 'cottage').barcode = '7290011194246'; products.push({ id: 'new', name: 'מוצר חדש', barcode: '72900001', price: 1 })`);
  assert.deepEqual(matches('7290011194246'), ['cottage']); assert.deepEqual(matches('72900001'), ['new']);
  assert.deepEqual(json(c, `aiCatalogBarcodeMatches('194246', true).map(m => m.product.id)`), ['cottage'], 'סיומת');
  assert.deepEqual(json(c, `aiCatalogBarcodeOneDigitMatches('7290011194240').map(m => m.product.id)`), ['cottage'], 'ספרה אחת');
  // בתוך חישוב אחד שורה מזוהה פעם אחת; מחוץ לו — תמיד מחדש (אחרת שינוי בשורה לא היה נראה)
  const row = 'aiScanResponse.scan.documents[0].rows[0]';
  c.run('globalThis.resolves = 0; { const original = aiResolveInvoiceBarcodeNow; aiResolveInvoiceBarcodeNow = r => { resolves++; return original(r); }; }');
  assert.equal(c.run(`aiResolveScope(() => { const a = aiResolveInvoiceBarcode(${row}), b = aiResolveInvoiceBarcode(${row}); return a === b && resolves; })`), 1);
  assert.equal(c.run(`resolves = 0; aiResolveInvoiceBarcode(${row}); aiResolveInvoiceBarcode(${row}); resolves`), 2, 'בלי scope — בלי מטמון');
  assert.equal(c.run('aiResolveScopeCache'), null, 'המטמון אינו נשאר אחרי החישוב');
  assert.equal(c.run(`aiResolveScope(() => aiResolveScope(() => aiResolveInvoiceBarcode(${row}).product.id))`), 'milk', 'חישוב בתוך חישוב — אותו מטמון');
  assert.equal(c.run(`(() => { try { aiResolveScope(() => { throw new Error('x'); }); } catch (e) {} return aiResolveScopeCache; })()`), null, 'גם אחרי שגיאה');
  c.run('resolves = 0; receiptPriceAudit()');
  assert.ok(c.run('resolves') <= 3, 'בדיקת מחירים של שלוש שורות — לכל היותר זיהוי אחד לשורה: ' + c.run('resolves'));
  // ושינוי בשורה בין שני חישובים נראה: הבחירה מהמאגר משנה את התשובה של החישוב הבא
  assert.equal(json(c, 'receiptPriceAudit().rows[1]').productId, null);
  tap(c, cardOf(c, 1), 'price-pick-product'); runQueued(c);
  assert.equal(json(c, 'receiptPriceAudit().rows[1]').productId, 'cottage');
});

// שורת מבצע כמו שורות 26, 29 ו-32 בתעודה 9074000379: הקריאה שנבחרה קראה ברוטו, הנחה ונטו; קריאה 0 אישרה את המחיר והברוטו ופספסה את
// ההנחה; קריאה 1 קראה את המחיר נטו ואישרה את סכום השורה. למספר ההנחה עצמו אין קריאה תומכת.
const PROMO = [{ id: 'p-cottage', name: 'קוטג׳ 15%', pct: 15, minQty: 1, minUnit: 'unit', cartonSize: null, type: 'receipt', productIds: ['cottage'], start: '2026-11-01', end: '2026-11-30' }];
function discounted() {
  const doc = BIG();
  doc.rows.forEach(r => verified(r));
  const row = doc.rows[1]; // קוטג׳: 6 × 5.10 = 30.60, פחות 4.59 (15%) = 26.01
  Object.assign(row, { lineDiscountExVat: 4.59, lineTotalExVat: 26.01, promotionText: '15.00%' });
  verified(row, products, ['lineDiscountExVat']);
  const proof = row.modelVerification, base = proof.evidence;
  proof.fieldSupport = { quantity: [0, 1], unitPriceExVat: [0], grossLineTotalExVat: [0], lineDiscountExVat: [], lineTotalExVat: [1] };
  proof.readings = [{ read: 2, identity: proof.identity, values: structuredClone(base) },
    { read: 0, identity: proof.identity, values: { ...structuredClone(base), lineDiscountExVat: 0, lineTotalExVat: 30.6 } },
    { read: 1, identity: proof.identity, values: { ...structuredClone(base), unitPriceExVat: 4.34, grossLineTotalExVat: 26.01, lineDiscountExVat: null } }];
  doc.subtotalExVat = doc.netToChargeExVat = doc.itemsSectionTotalExVat = r2(doc.subtotalExVat - 4.59);
  return doc;
}

test('16. הנחת שורה שהחשבון מוכיח אינה נשלחת לאישור: הרשימה עולה מיד; ומה שהחשבון אינו מוכיח — נשאר לעובד', async () => {
  const c = await reading([discounted()], 'lines', products, structuredClone(PROMO));
  await c.release();
  const row = 'aiScanResponse.scan.documents[0].rows[1]', doc = 'aiScanResponse.scan.documents[0]';
  const proven = extra => c.run(`priceAuditDiscountProvenByArithmetic(${doc}, ${extra ? '{ ...' + row + ', ' + extra + ' }' : row})`);
  assert.equal(c.run('receiptPaperScanState'), 'ok', json(c, 'receiptPaperScanProblems').join(';'));
  assert.deepEqual(json(c, row + '.modelVerification.issues'), ['lineDiscountExVat'], 'השרת עדיין אומר needs_review');
  assert.equal(proven(), true);
  assert.deepEqual(json(c, `aiModelReviewIssues(${row})`), [], 'אין מה לאשר');
  assert.equal(c.run(`priceAuditConsensusConfirmed(${row})`), true);
  assert.equal(pendingTitle(c), '');
  assert.equal(c.run('receiptPaperGate()'), null, 'אין שער');
  assert.equal(modalOpen(c), true, 'הרשימה עלתה מיד, בלי שורה לאישור');
  assert.equal(c.run('currentView'), 'receiving');
  assert.equal(json(c, 'receiptPriceAudit().rows[1]').result, 'match', 'המחיר נבדק כרגיל: מבצע 15% בתוקף');
  const before = json(c, row);
  // שום ערך לא השתנה, ורשומת ההסכמה של השרת נשארה כמו שהיא
  assert.equal(before.lineDiscountExVat, 4.59); assert.equal(before.modelVerification.status, 'needs_review'); assert.deepEqual(before.modelVerification.fieldSupport.lineDiscountExVat, []);
  // מה שהחשבון אינו מוכיח: ההנחה אינה ברוטו פחות נטו; ההנחה לא נקראה; שורת פיקדון
  assert.equal(proven('lineDiscountExVat: 4.5'), false);
  assert.equal(proven('lineDiscountExVat: null'), false);
  assert.equal(proven('quantity: 5'), false, 'כמות × מחיר אינו הברוטו');
  assert.equal(proven(`description: 'פיקדון'`), false);
  // לברוטו או לנטו אין קריאה תומכת (גם כשקריאה 4 "סגרה" אותו — היא אינה קריאה תומכת); שרת ישן בלי fieldSupport
  for (const field of ['unitPriceExVat', 'grossLineTotalExVat', 'lineTotalExVat']) {
    c.run(`${row}.modelVerification.fieldSupport.${field} = []`);
    assert.equal(proven(), false, field);
    assert.deepEqual(json(c, `aiModelReviewIssues(${row})`), ['lineDiscountExVat'], field + ': השורה נשארת לאישור העובד');
    c.run(`${row}.modelVerification.fieldSupport.${field} = [${field === 'lineTotalExVat' ? 1 : 0}]`);
  }
  c.run(`${row}.modelVerification.fieldSupport.grossLineTotalExVat = ['arithmetic']`);
  assert.equal(proven(), false, 'סמן שאינו מספר קריאה אינו קריאה תומכת');
  c.run(`${row}.modelVerification.fieldSupport.grossLineTotalExVat = [0]`);
  assert.equal(proven(), true);
  c.run(`globalThis.savedSupport = ${row}.modelVerification.fieldSupport; delete ${row}.modelVerification.fieldSupport`);
  assert.equal(proven(), false, 'בלי fieldSupport');
  c.run(`${row}.modelVerification.fieldSupport = savedSupport`);
  // הנייר אינו מתאזן (הסיכום המודפס אחר) — החשבון של השורה לבדו אינו מספיק
  c.run(`${doc}.__pricePaper.subtotalExVat += 1`);
  assert.equal(proven(), false, 'נייר שאינו מתאזן');
  c.run(`${doc}.__pricePaper.subtotalExVat -= 1`);
  assert.equal(proven(), true);
  // גם לצד שדה נוסף שבאמת חסר לו אישור — השורה נשארת, עם השדה ההוא בלבד
  c.run(`${row}.modelVerification.issues = ['lineDiscountExVat', 'unitPriceExVat']; ${row}.modelVerification.fieldSupport.unitPriceExVat = []`);
  assert.deepEqual(json(c, `aiModelReviewIssues(${row})`), ['lineDiscountExVat', 'unitPriceExVat']);
  assert.equal(c.run(`priceAuditConsensusConfirmed(${row})`), false);
});

test('17. בדיקה שכבר התחילה ונבנית מחדש כי המוצר של שורה תוקן: מה שסומן נשאר, מה שנסרק כ"נוסף" עובר לשורה שלו — בלי שאלה, עם הודעה', async () => {
  const c = await reading([BIG()]);
  await scanQty(c, '7290000000008', 12);
  await c.release();
  assert.equal(modalOpen(c), true);
  assert.deepEqual(marks(c), ['milk:ok,cottage:,yogurt:']);
  // בשורה 3 הרשימה אומרת "יוגורט", אבל מה שהגיע הוא שמנת: המשתמש מוסיף אותה כ"הגיע משהו נוסף" (4 יח׳), וגם מוצר שבאמת אינו בתעודה
  click(c, { extraAdd: 'cream' }); c.run(`receiptLineCheckInput({ target: { dataset: { extraGot: '0' }, value: '4' } })`);
  click(c, { extraAdd: 'soy' }); c.run(`receiptLineCheckInput({ target: { dataset: { extraGot: '1' }, value: '2' } })`);
  click(c, { lineMark: '0:1:ok' });
  assert.deepEqual(review(c).extras.map(x => x.productId + ' ' + x.got), ['cream 4', 'soy 2']);
  // "חזרה", והמוצר של שורה 3 מתוקן (ברקוד שהוקלד מהנייר) — הכמויות שבתעודה השתנו, הספירה לא
  c.run('closeReceiptQuantityReviewByUser()');
  c.run(`aiApplyManualPaperBarcode(aiScanResponse.scan.documents[0].rows[2], '7290000000039', 'cream')`); runQueued(c);
  c.run('testConfirms.length = 0; startReceiptLineCheck()'); runQueued(c);
  assert.equal(c.run('testConfirms.length'), 0, 'בלי "כבר נספרו…" — המשתמש באמצע הבדיקה');
  assert.equal(modalOpen(c), true);
  assert.deepEqual(marks(c), ['milk:ok,cottage:ok,cream:ok'], 'מה שסומן נשאר; השמנת שנסרקה (4 = 4) סומנה בשורה שלה');
  assert.deepEqual(review(c).extras.map(x => x.productId + ' ' + x.got), ['soy 2'], 'מה שאינו בתעודה נשאר "נוסף"; השמנת כבר לא שם');
  assert.equal(c.run('receiptLineNotice.text'), 'הרשימה עודכנה — המוצר תוקן בשורה 3. מה שכבר סימנת נשאר, ומה שסרקת מהם סומן.');
  // כמות אחרת ממה שבתעודה — "אחרת" עם המספר, כמו בכל סריקה (410)
  const d = await reading([BIG()]);
  await d.release();
  click(d, { extraAdd: 'cream' }); d.run(`receiptLineCheckInput({ target: { dataset: { extraGot: '0' }, value: '3' } })`);
  d.run('closeReceiptQuantityReviewByUser()');
  d.run(`aiApplyManualPaperBarcode(aiScanResponse.scan.documents[0].rows[2], '7290000000039', 'cream')`); runQueued(d);
  d.run('testConfirms.length = 0; startReceiptLineCheck()'); runQueued(d);
  assert.equal(d.run('testConfirms.length'), 0);
  assert.deepEqual(marks(d), ['milk:,cottage:,cream:qty:3']);
  assert.equal(d.run('receiptLineNotice.text'), 'הרשימה עודכנה — המוצר תוקן בשורה 3. מה שכבר סימנת נשאר, ומה שסרקת מהם סומן.');
  // בלי שום דבר שנסרק מהמוצר החדש — ההודעה אומרת רק מה תוקן, והשורה מחכה לסימון
  const e = await reading([BIG()]);
  await e.release();
  click(e, { lineMark: '0:0:ok' });
  e.run('closeReceiptQuantityReviewByUser()');
  e.run(`aiApplyManualPaperBarcode(aiScanResponse.scan.documents[0].rows[2], '7290000000039', 'cream')`); runQueued(e);
  e.run('testConfirms.length = 0; startReceiptLineCheck()'); runQueued(e);
  assert.deepEqual(marks(e), ['milk:ok,cottage:,cream:']);
  assert.equal(e.run('receiptLineNotice.text'), 'הרשימה עודכנה — המוצר תוקן בשורה 3. מה שכבר סימנת נשאר.');
  // חזרה לאותה בדיקה בלי שום שינוי — בלי הודעה (resume), כמו קודם
  e.run('closeReceiptQuantityReviewByUser(); startReceiptLineCheck()'); runQueued(e);
  assert.equal(e.run('receiptLineNotice'), null); assert.deepEqual(marks(e), ['milk:ok,cottage:,cream:']);
});

test('18. הגרסה עלתה ל-420, כולל הכותרת וה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '420'/);
  assert.match(html, /<title>הזמנות יטבתה - v420 מבצע שניתן בלי המינימום — כבר בקליטה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v420 מבצע שניתן בלי המינימום — כבר בקליטה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v420/);
});
