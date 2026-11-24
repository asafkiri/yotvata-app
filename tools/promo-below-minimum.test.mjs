// v420 — מבצע שהספק נתן בתעודה בלי המינימום נקלט כמבצע רגיל, בלי התראה. בעל העסק, 24.11.2026 (תעודה 407300217859 — צילום של כרטיס
// התעודה, וגיבוי): "היה רשום לי שיש בעיה במבצע בתעודה הזאת על ה-6 יח׳ משקה חלב ליטר. בקיצור סגרתי את התעודה וזהו — זה מראה כאילו
// הכל טוב בתעודה ושירד המבצע. למה?"; "למה בסגירת תעודה הוצג לי שיש חוסר של מבצע?"; ואחרי ההסבר: "מה אכפת לי שקיבלתי את המבצע? הרי
// למרות שמוגדר 12 יח׳ למבצע קיבלתי אותו על 6 יח׳. מבחינתי פצצה — אין צורך להתריע על זה אפילו."
// המבצע "משקאות חלב ליטר" (15%) מוגדר עם מינימום 12 יח׳ מהסל; בתעודה היו 6 יח׳ ("משקה מוקה 1 ליטר"), והספק נתן את ההנחה בכל זאת:
// 6 × ₪8.86 = ₪53.16, חיוב ₪45.19. עד 419 בקליטה זה היה "פערי מחיר שאומתו ונשמרו (1)", "עודף ₪7.97", "אלה אכן הבעיות — אשר" ו"סגור
// תעודה עם החוסרים" — ואחרי השמירה "מבצע 15%: המחיר בנייר תואם למבצע ✓". נתונים מומצאים עם המספרים של השורה ההיא: תעודה של 4 שורות —
// חלב 12, קוטג׳ 6, משקה מוקה 6 (15%, מתחת למינימום 12) וחומוס 6 (15%, המינימום 6 הושג).
// מה שנבדק:
// 1. הכלל (promoPaperGranted): מחיר המבצע בדיוק, 2 האגורות של בדיקת המחיר, הנחה של ממש, ומה שאינו כזה.
// 2. בדיקת המחירים: המחיר תואם למבצע — בלי שורה לטיפול, בלי "פערי מחיר שאומתו ונשמרו", ובלי שום הודעה: המסך זהה למסך של אותה תעודה
//    כשלמבצע אין מינימום. מה שנשאר הוא רק בנתוני הבדיקה (belowMinimum).
// 3. מנוע ההשוואה: המחיר הצפוי הוא מחיר המבצע, אין ממצא "מחיר שונה" ואין שום ממצא אחר במקומו; החשבון נסגר.
// 4. הקליטה, שורה-שורה ו"הכל הגיע": "סיום" → חלון הסיכום, בלי מסך "בעיות" ובלי הודעה; התעודה שנשמרת זהה לקליטה שבה למבצע אין
//    מינימום — שורת מבצע 15%, "אומתה". שום סכום לא השתנה מ-419.
// 5. כרטיס התעודה השמורה: "· מבצע 15%" על השורה, בלי שום הערה; ותעודה שנשמרה ב-419 (ממצא "מחיר שונה") — בדיוק כמו קודם.
// 6. מה לא השתנה: מחיר שאינו מחיר המבצע (פער מחיר, כמו קודם); המינימום הושג והנייר לא נתן הנחה ("הנחת המבצע לא ניתנה" + דרישת זיכוי);
//    המינימום לא הושג והנייר במחיר מלא (תואם, בלי מבצע); מוצר שחויב בשני מחירים; והספירה החיה בלי נייר.
// 7. חוסר במוצר שקיבל את המבצע: הממצא הוא חוסר במחיר המבצע, סרגל הסכומים מראה את החוסר ולא את ההנחה, והתעודה נשמרת עם החוסר.
// 8. שתי תעודות שיחד מגיעות למינימום: מבצע רגיל ("מבצע בתוקף"), בלי "פערי מחיר" (ב-419: פער בכל תעודה); ואותו מוצר בשתי תעודות.
// 9. מסך ההשוואה כשנפתח בלי ההחלה האוטומטית: סרגל הסכומים מאוזן יחד עם "הכול תואם — המשך".
// 10. מסך התוצאות אומר מה באמת נמצא: כשכל מה שנמצא הוא פער מחיר — "פער מחיר ₪…" בסרגל, מה שנמצא בתיבה, "פער המחיר נכון — אשר"
//     ו"סגור תעודה עם פער המחיר"; "…עם החוסרים" רק כשיש חוסר; עודף; וכמה סוגים.
// 11. הגרסה.
// הרצה: node --test tools/promo-below-minimum.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5, posPrice: 6.9 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7, posPrice: 9.9 },
  { id: 'mocha', name: 'משקה מוקה 1 ליטר', code: '22', barcode: '7290000000022', price: 8.86, posPrice: 14.9 },
  { id: 'banana', name: 'משקה ליטר בננה', code: '39', barcode: '7290000000039', price: 8.86, posPrice: 14.9 },
  { id: 'hummus', name: 'חומוס 750 חלק', code: '46', barcode: '7290000000046', price: 8.87, posPrice: 15.9 }
];
const NOV = { start: '2026-11-01', end: '2026-11-30', minUnit: 'unit', cartonSize: null, type: 'receipt' };
const promos = [
  { id: 'p-liter', name: 'משקאות חלב ליטר', pct: 15, minQty: 12, productIds: ['mocha', 'banana'], ...NOV },
  { id: 'p-hummus', name: 'חומוס 750 צהובה', pct: 15, minQty: 6, productIds: ['hummus'], ...NOV }
];
const r2 = n => Math.round(n * 100) / 100;
// שורה בנייר כמו שיטבתה מדפיסה: מחיר היחידה המלא, סכום ברוטו, וסכום נטו אחרי ההנחה — עם כוכבית ליד שורת מבצע; השורות כפי שהשירות
// מחזיר כשהקריאות הסכימו עליהן (כמו בתעודה ההיא — ולכן ב-419 הפער "אומת בהסכמה בין הסריקות", בלי שאלה)
const EVIDENCE = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber', 'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
function paper(spec, number = '407300217859') {
  const rows = spec.map(([id, q, pct = 0, unit], i) => { const p = products.find(x => x.id === id), price = unit == null ? p.price : unit, gross = r2(q * price);
    const row = { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'model_consensus',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: price, grossLineTotalExVat: gross, lineTotalExVat: r2(gross * (1 - pct / 100)), lineDiscountExVat: null, promotionText: pct ? '*' : null, confidence: .99 };
    row.modelVerification = { version: 1, status: 'verified', selectedRead: 2, strongSelected: true, identity: { productId: p.id, barcode: p.barcode }, identitySupport: [0, 1], issues: [],
      evidence: Object.fromEntries(EVIDENCE.map(k => [k, row[k] ?? null])) };
    return row; });
  const net = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-24', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: net, netToChargeExVat: net, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: net, promoDiscountExVat: 0, documentDiscountExVat: null, warnings: [] };
}
const NOTE = [['milk', 12], ['cottage', 6], ['mocha', 6, 15], ['hummus', 6, 15]];
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };
// האפליקציה במסך הקליטה אחרי שהתעודות צולמו ונקראו. intent — מה נבחר במסך הצילום ('lines' / 'all'), או בלי בחירה
async function scan(papers, { system = promos, intent = null, ...opts } = {}) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: { products, promos: structuredClone(system), items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } }, ...opts });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-24'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });
    runCloudTaskSilent = async (label, task) => { testWrites.push({ label, ...structuredClone(task) }); return true; };
    navigator.vibrate = () => {};
    window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
    navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) };
    $('scanVideo').play = async () => {};
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run(`yotvataStartPaperScan({ manualQuantities: true${intent ? ', intent: ' + JSON.stringify(intent) : ''} })`);
  await settle();
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודה נקראה ואומתה: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  c.callbacks.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
  await settle();
  return c;
}
const note = (opts = {}) => scan([paper(NOTE)], opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const review = r => json(r, 'receiptQuantityReview');
const markAll = r => review(r).docs.forEach((d, di) => d.lines.forEach((l, li) => click(r, { lineMark: di + ':' + li + ':ok' })));
const app = r => r.node('app').innerHTML;
const audit = r => json(r, 'receiptPriceAudit()');
const auditRow = (r, id) => audit(r).rows.find(x => x.productId === id);
const summaryShown = r => !r.run(`$('receiptSummaryModal').classList.contains('hidden')`);
const summary = r => r.run(`$('rsBody').innerHTML`);
// הרשימה שורה-שורה: נפתחת (אם עוד לא), כל השורות "הגיע", ו"סיום"
async function checkLines(r, marks = markAll) {
  if (!r.run(`!!(receiptQuantityReview && receiptQuantityReview.mode === 'lines')`)) r.run('startReceiptLineCheck()');
  assert.equal(review(r).mode, 'lines');
  marks(r);
  assert.equal(r.run('finishReceiptLineCheck()'), true); await settle();
}
async function save(r) {
  assert.ok(r.run('!!pendingReceipt'), 'הסיכום מוכן: ' + JSON.stringify(json(r, 'aiScanEvaluation && aiScanEvaluation.errors')));
  await r.run('confirmReceipt()'); await settle();
  const w = r.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
  assert.ok(w, 'התעודה נשמרה');
  return { id: w.path[w.path.length - 1], ...structuredClone(w.data) };
}
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
const itemsOf = rc => rc.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty, l.unitPrice, l.basePrice, l.promoPct, l.lineTotal]);
const MOCHA_UNIT = 45.19 / 6; // ₪7.53167 — מה שהנייר מחייב ליחידה
const GRANTED = 'מבצע בתוקף — ניתן בלי המינימום';
// אין התראה: שום מילה על המינימום, בשום מסך
const ALERT = /בלי המינימום|לטובתך|ניתנה בכל זאת|data-price-granted|data-promo-below-min|promo_below_min/;
// אותה תעודה כשלמבצע של משקאות הליטר אין מינימום — מה שהמסכים והתעודה השמורה צריכים להיות זהים לו
const NO_MINIMUM = promos.map(p => p.id === 'p-liter' ? { ...p, minQty: 1 } : p);

test('1. הכלל: המבצע חל כשהנייר מחייב בדיוק במחיר שלו — 2 האגורות של בדיקת המחיר, הנחה של ממש, ולא מרכזת', async () => {
  const r = await note();
  const granted = (pr, base, charged) => r.run(`promoPaperGranted(${JSON.stringify(pr)}, ${base}, ${charged})`);
  const pr = { id: 'x', pct: 15, type: 'receipt' };
  assert.equal(granted(pr, 8.86, MOCHA_UNIT), true, 'השורה ההיא: 45.19 ÷ 6 מול 8.86 פחות 15%');
  assert.equal(granted(pr, 8.86, 7.531), true);
  assert.equal(granted(pr, 8.86, 7.55), true, 'בתוך 2 אגורות ליחידה');
  assert.equal(granted(pr, 8.86, 7.56), false, 'מעבר ל-2 אגורות — לא מחיר המבצע');
  assert.equal(granted(pr, 8.86, 7.50), false);
  assert.equal(granted(pr, 8.86, 8.86), false, 'מחיר מלא');
  assert.equal(granted({ ...pr, pct: 10 }, 8.86, MOCHA_UNIT), false, 'אחוז אחר');
  assert.equal(granted({ ...pr, pct: 0 }, 8.86, 8.86), false);
  assert.equal(granted({ ...pr, type: 'monthEnd' }, 8.86, MOCHA_UNIT), false, 'מבצע מרכזת אינו בתעודה');
  assert.equal(granted(pr, 0.1, 0.085), false, 'הנחה של פחות מ-2 אגורות ליחידה אינה ראיה למבצע');
  assert.equal(granted(pr, 0, 0), false); assert.equal(granted(null, 8.86, 7.531), false); assert.equal(granted(pr, 8.86, 0), false);
});

test('2. בדיקת המחירים: המחיר תואם למבצע — בלי שורה לטיפול, בלי "פערי מחיר שאומתו ונשמרו", ובלי שום הודעה', async () => {
  const r = await note();
  const a = audit(r);
  // בנתוני הבדיקה (לא על המסך): השורה תואמת למבצע, ומסומן שהמינימום לא הושג — למי שיקרא גיבוי וישאל למה 6 יח׳ הן מבצע
  assert.deepEqual(a.rows.map(x => [x.productId, x.result, x.matchedForms]), [['milk', 'match', ['מחיר רגיל']], ['cottage', 'match', ['מחיר רגיל']], ['mocha', 'match', [GRANTED]], ['hummus', 'match', ['מבצע בתוקף']]]);
  const row = a.rows[2];
  assert.equal(row.reason, 'המחיר תואם: ' + GRANTED);
  assert.deepEqual(row.promo, { id: 'p-liter', name: 'משקאות חלב ליטר', pct: 15, fixedPrice: null, start: '2026-11-01', end: '2026-11-30', minUnits: 12, belowMinimum: true, basketUnits: 6 });
  assert.equal(row.originalUnitPrice, 8.86); assert.ok(Math.abs(row.comparisonPrice - MOCHA_UNIT) < 1e-9);
  assert.deepEqual(row.expectedOptions.map(o => [o.label, r2(o.price * 1000) / 1000, o.lineDifference]), [[GRANTED, 7.531, 0]]);
  assert.equal(row.paperConfirmed, false, 'אין פער לאשר');
  // החומוס (המינימום הושג) — בדיוק כמו קודם, בלי הסימון
  assert.equal(a.rows[3].promo.belowMinimum, undefined); assert.equal(a.rows[3].promo.basketUnits, undefined);
  assert.equal(a.complete, true);
  assert.equal(r.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.deepEqual(json(r, 'receiptPaperPromos()'), [], 'זה לא "מבצע שלא קיים במערכת" — המבצע קיים');
  // על המסך: הכותרת הירוקה של תעודה תואמת, ושום דבר אחר — לא המסך של 419 ולא הודעה על המינימום. הפאנל, חלון הסיכום ומסך הקליטה
  // זהים לאלה של אותה תעודה כשלמבצע אין מינימום
  const same = await note({ system: NO_MINIMUM });
  const panel = r.run('receiptPriceAuditHtml()');
  assert.match(panel, /<details data-price-panel><summary class="[^"]*text-emerald-800"><span role="status" aria-live="polite">המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר<\/span>/);
  assert.doesNotMatch(panel, /data-price-reviewed|פערי מחיר|data-price-row=|המחיר בתעודה שונה|פער לשורה|data-price-paper-promo/);
  assert.doesNotMatch(panel, ALERT);
  assert.equal(panel, same.run('receiptPriceAuditHtml()'));
  const brief = r.run('receiptPriceAuditHtml(undefined, { summary: true })');
  assert.equal(strip(brief), 'המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר');
  assert.equal(brief, same.run('receiptPriceAuditHtml(undefined, { summary: true })'));
  r.run('renderReceiving()'); same.run('renderReceiving()');
  assert.doesNotMatch(app(r), ALERT);
  assert.doesNotMatch(strip(app(r)), /פערי מחיר|פער מחיר/);
  assert.equal(strip(app(r)), strip(app(same)));
  // בלי המבצע במערכת — "מבצע שלא קיים במערכת" (418), כמו קודם
  const none = await note({ system: promos.filter(p => p.id !== 'p-liter') });
  assert.deepEqual(json(none, 'receiptPaperPromos().map(x => [x.productId, x.pct])'), [['mocha', 15]]);
  assert.match(none.run('receiptPriceAuditHtml()'), /data-price-paper-promo="mocha"/);
});

test('3. מנוע ההשוואה: המחיר הצפוי הוא מחיר המבצע — בלי ממצא "מחיר שונה" ובלי שום ממצא במקומו; החשבון נסגר והקליטה ניתנת להחלה', async () => {
  const r = await note();
  await checkLines(r);
  const ev = json(r, `({ valid: aiScanEvaluation.valid, closure: aiScanEvaluation.closure.ok, errors: aiScanEvaluation.errors, findings: aiScanEvaluation.findings,
    granted: Array.from(aiScanEvaluation.grantedPromos.entries()) })`);
  assert.deepEqual([ev.valid, ev.closure, ev.errors], [true, true, []]);
  assert.deepEqual(ev.granted, [['mocha', { id: 'p-liter', name: 'משקאות חלב ליטר', pct: 15, minUnits: 12, basketUnits: 6 }]]);
  // רק הכוכביות שנקראו מהנייר (כמו בכל שורת מבצע) — בלי ממצא מחיר ובלי שורת מידע על המינימום
  assert.deepEqual(ev.findings.map(f => [f.type, f.productId]), [['printed_promo', 'mocha'], ['printed_promo', 'hummus']]);
  assert.doesNotMatch(JSON.stringify(ev.findings), ALERT);
  assert.equal(r.run('aiScanAllGood(aiScanEvaluation)'), true);
  // אותה תעודה כשלמבצע אין מינימום — אותם ממצאים בדיוק
  const same = await note({ system: NO_MINIMUM });
  await checkLines(same);
  assert.deepEqual(json(same, 'aiScanEvaluation.findings'), ev.findings);
  assert.equal(same.run('aiScanEvaluation.grantedPromos.size'), 0);
});

for (const [intent, name] of [['lines', 'שורה-שורה'], ['all', '"הכל הגיע כמו בתעודה"']]) {
  test('4. הקליטה, ' + name + ': "סיום" → חלון הסיכום, בלי מסך "בעיות" ובלי הודעה; התעודה שנשמרת זהה לקליטה שבה למבצע אין מינימום', async () => {
    async function receive(system) {
      const r = await note({ system, intent });
      if (intent === 'lines') await checkLines(r);
      // "הכל הגיע כמו בתעודה": השאלה מופיעה לבד כשהתעודה נקראה (405), והאישור שלה הוא הספירה
      else { assert.match(r.run('testConfirms[0].title + " " + testConfirms[0].message'), /הכל הגיע כמו בתעודה/); r.run('testConfirms.shift().cb()'); await settle(); }
      return r;
    }
    const r = await receive(promos);
    // ההחלה נעשתה לבד (כמו בכל קליטה שהכול תואם בה): חלון הסיכום פתוח, בלי "אלה אכן הבעיות — אשר" ובלי "סגור תעודה עם החוסרים"
    assert.equal(r.run('!!pendingReceipt'), true); assert.equal(summaryShown(r), true);
    assert.equal(r.run('testConfirms.length'), 0);
    const screen = strip(app(r));
    assert.doesNotMatch(screen, /אלה אכן הבעיות|סגור תעודה עם החוסרים|פערי מחיר|פער מחיר|עודף ₪/);
    assert.match(screen, /תעודת הספק ₪192\.43 סכום הפריטים (שנסרקו|מהנייר) ₪192\.43 מאוזן ✓/);
    // חלון הסיכום: כמו בכל תעודה תואמת, השורה כמבצע — ושום הודעה על המינימום, לא בחלון ולא במסך שמאחוריו
    const text = strip(summary(r));
    assert.ok(text.startsWith('המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר חלב 3% בקרטון 1 ליטר התקבל 12 × ₪5.00 ₪60.00'), text.slice(0, 200));
    assert.match(text, /משקה מוקה 1 ליטר התקבל 6 × ₪7\.53167 · מבצע 15% ₪45\.19/);
    assert.match(text, /לא נמצא פער נוסף\./);
    assert.match(text, /לתשלום — מה שהתקבל \(ללא מע״מ\) ₪192\.43 סכום התעודה מהספק: ₪192\.43$/);
    assert.doesNotMatch(summary(r), ALERT); assert.doesNotMatch(app(r), ALERT);
    const pending = json(r, 'pendingReceipt');
    assert.deepEqual([pending.status, pending.ex, pending.supplierCreditClaim, pending.supplierPromoMismatchItems], ['ok', 192.43, null, []]);
    // אותה תעודה כשלמבצע אין מינימום: אותו חלון סיכום, מילה במילה
    const same = await receive(NO_MINIMUM);
    assert.equal(text, strip(summary(same)));
    const rc = await save(r), expected = await save(same);
    assert.deepEqual([rc.status, rc.totalExVat, rc.aiAudit.hasDiscrepancy, rc.unresolvedAmountGap, rc.unresolvedUnitsGap], ['ok', 192.43, false, 0, 0]);
    const mocha = rc.items.find(l => l.productId === 'mocha');
    assert.deepEqual([mocha.qty, mocha.basePrice, mocha.promoPct, mocha.lineTotal], [6, 8.86, 15, 45.19]);
    assert.ok(Math.abs(mocha.unitPrice - MOCHA_UNIT) < 1e-9, 'המחיר שבנייר, כמו ב-419');
    // והתעודה השמורה זהה: השורות, הסכומים והממצאים. ההבדל היחיד הוא בנתוני בדיקת המחירים — הסימון שהמינימום לא הושג
    assert.deepEqual(itemsOf(rc), itemsOf(expected));
    assert.deepEqual([rc.status, rc.totalExVat, rc.calculatedExVat, rc.grossExVat, rc.supplierDiscount, rc.roundingAdjustment, rc.noteTotalInc], [expected.status, expected.totalExVat, expected.calculatedExVat, expected.grossExVat, expected.supplierDiscount, expected.roundingAdjustment, expected.noteTotalInc]);
    assert.deepEqual(rc.aiAudit.findings, expected.aiAudit.findings);
    assert.deepEqual(rc.aiAudit.findings.filter(f => f.productId === 'mocha').map(f => [f.type, f.text]), [['printed_promo', 'מבצע מודפס ליד משקה מוקה 1 ליטר: *']]);
    assert.equal(rc.aiAudit.hasDiscrepancy, expected.aiAudit.hasDiscrepancy);
    assert.equal(rc.priceAudit.rows.find(x => x.productId === 'mocha').promo.belowMinimum, true);
    assert.equal(expected.priceAudit.rows.find(x => x.productId === 'mocha').promo.belowMinimum, undefined);
  });
}

test('5. כרטיס התעודה השמורה: "מבצע 15%" על השורה, בלי שום הערה; תעודה שנשמרה ב-419 — בדיוק כמו קודם', async () => {
  const r = await note({ intent: 'lines' });
  await checkLines(r);
  const rc = await save(r);
  // כך אותה קליטה נשמרה ב-419: המחיר שבנייר בלי מבצע, וממצא "מחיר שונה" (אותם סכומים)
  const legacy = structuredClone(rc); legacy.id = 'rc-419';
  legacy.items.find(l => l.productId === 'mocha').promoPct = 0;
  legacy.aiAudit.hasDiscrepancy = true;
  legacy.aiAudit.findings = legacy.aiAudit.findings.concat([{ type: 'price', productId: 'mocha', name: 'משקה מוקה 1 ליטר', qty: 6, amount: -7.97, expectedPrice: 8.86, paperPrice: MOCHA_UNIT,
    text: 'מחיר שונה: משקה מוקה 1 ליטר — במערכת ₪8.86, בנייר ₪7.53' }]);
  history(r, [rc, legacy]);
  for (const id of [rc.id, 'rc-419']) {
    const c = card(r, id);
    assert.match(c, /<i class="fa-solid fa-circle-check"><\/i> אומתה<\/span>/, id);
    assert.match(c, /data-plain-status="balanced">נקלטה ומאוזנת ✓<\/div>/, id);
    assert.match(c, /<div class="text-sm font-bold text-slate-700 truncate">משקה מוקה 1 ליטר<\/div><div class="text-\[11px\] text-slate-400">6 × ₪7\.53167 · מבצע 15%<\/div>/, id);
    assert.doesNotMatch(c, /תקן הפרשים|data-plain-action|data-paper-promo|מחיר שונה: /, id);
    assert.doesNotMatch(c, ALERT, id);
    assert.equal(plain(r, id).state, 'balanced');
  }
  // התעודה מ-420: שורת מבצע רגילה. אין ממצא מחיר, ולכן גם אין קופסה סגולה — כמו בכל תעודה שהכול תאם בה
  assert.doesNotMatch(card(r, rc.id), /bg-violet-50 border border-violet-200|המחיר בנייר תואם למבצע/);
  assert.match(card(r, 'rc-419'), /bg-violet-50 border border-violet-200/);
  // התעודה מ-419: בדיוק כמו ב-419 — "המחיר בנייר תואם למבצע ✓", בלי תוספת
  assert.match(card(r, 'rc-419'), /<div class="font-black mt-1 text-emerald-700">• משקה מוקה 1 ליטר — מבצע 15%: המחיר בנייר תואם למבצע ✓<\/div>/);
  assert.equal(r.writes.filter(w => w.op !== 'set' || !w.path.includes('receipts')).length, 0, 'הכרטיס הוא תצוגה בלבד — שום דבר לא נכתב');
});

test('6. מה לא השתנה: מחיר שאינו מחיר המבצע; המינימום הושג והנייר לא נתן הנחה; מחיר מלא מתחת למינימום; שני מחירים; והספירה החיה', async () => {
  // (א) 10% במקום 15% — פער מחיר מול המחיר המלא, כמו קודם: נשמר כפער שאומת, והקליטה עוצרת במסך ההשוואה
  const other = await scan([paper([['milk', 12], ['mocha', 6, 10]])], { intent: 'lines' });
  assert.deepEqual([auditRow(other, 'mocha').result, auditRow(other, 'mocha').promo, auditRow(other, 'mocha').expectedOptions[0].label], ['difference', null, 'מחיר רגיל']);
  assert.match(other.run('receiptPriceAuditHtml()'), /פערי מחיר שאומתו ונשמרו \(1\)/);
  await checkLines(other);
  assert.equal(other.run('!!pendingReceipt'), false, 'בלי החלה אוטומטית');
  assert.deepEqual(json(other, `aiScanEvaluation.findings.filter(f => f.productId === 'mocha' && f.type !== 'printed_promo').map(f => [f.type, f.expectedPrice, f.amount])`), [['price', 8.86, -5.32]]);
  assert.equal(other.run('aiScanEvaluation.grantedPromos.size'), 0);
  assert.match(app(other), /data-role="ai-confirm-findings"/);
  // (ב) המינימום הושג (12 יח׳) והנייר חייב מחיר מלא — "הנחת המבצע לא ניתנה בתעודה", ודרישת זיכוי
  const missing = await scan([paper([['milk', 12], ['mocha', 12]])], { intent: 'lines' });
  const gap = auditRow(missing, 'mocha');
  assert.deepEqual([gap.result, gap.promo.id, gap.promo.belowMinimum, gap.expectedOptions[0].label, gap.expectedOptions[0].lineDifference], ['difference', 'p-liter', undefined, 'מבצע בתוקף', 15.95]);
  await checkLines(missing);
  assert.deepEqual(json(missing, `aiScanEvaluation.findings.filter(f => f.productId === 'mocha').map(f => [f.type, f.amount])`), [['promo_missing', 15.95]]);
  // (ג) המינימום לא הושג והנייר במחיר מלא — תואם, בלי מבצע ובלי הודעה
  const full = await scan([paper([['milk', 12], ['mocha', 6]])], { intent: 'lines' });
  assert.deepEqual([auditRow(full, 'mocha').result, auditRow(full, 'mocha').promo, auditRow(full, 'mocha').matchedForms], ['match', null, ['מחיר רגיל']]);
  assert.doesNotMatch(full.run('receiptPriceAuditHtml()'), ALERT);
  await checkLines(full);
  assert.equal(full.run('!!pendingReceipt'), true);
  const plainRc = await save(full);
  assert.deepEqual(plainRc.items.find(l => l.productId === 'mocha').promoPct, 0);
  assert.deepEqual(plainRc.aiAudit.findings.map(f => f.type), []);
  // (ד) אותו מוצר בשתי שורות, אחת במחיר המבצע ואחת במחיר מלא — לא "ניתן בלי המינימום" במנוע (המוצר חויב ביותר ממחיר אחד, כמו קודם)
  const mixed = await scan([paper([['milk', 12], ['mocha', 3, 15], ['mocha', 3]])], { intent: 'lines' });
  await checkLines(mixed);
  assert.equal(mixed.run('aiScanEvaluation.grantedPromos.size'), 0);
  assert.deepEqual(json(mixed, `aiScanEvaluation.findings.filter(f => f.type === 'price').map(f => [f.productId, /ביותר ממחיר אחד/.test(f.text)])`), [['mocha', true]]);
  assert.equal(mixed.run('!!pendingReceipt'), false);
  // (ה) הספירה החיה בלי נייר: המינימום הוא המינימום ("עוד 6 יח׳ להנחה"), והמחיר מלא
  const live = await note();
  live.run(`aiScanResponse = null; aiScanEvaluation = null; receiptList = [{ productId: 'mocha', name: 'משקה מוקה 1 ליטר', barcode: '7290000000022', qty: 6 }];`);
  assert.equal(live.run(`promoTriggered(promos[0], '2026-11-24')`), false);
  assert.equal(live.run(`effectivePrice(products.find(p => p.id === 'mocha'), 6, '2026-11-24')`), 8.86);
  assert.deepEqual(json(live, 'receiptPromoStatuses()'), [{ name: 'משקאות חלב ליטר', pct: 15, triggered: false, remaining: 6, discount: 0 }]);
  assert.equal(live.run('receiptGrantedPromoMap()'), null);
  assert.deepEqual(json(live, 'receiptReconcileRows().map(l => [l.productId, l.price, l.promoPct, l.promoOn])'), [['mocha', 8.86, 0, false]]);
});

test('7. חוסר במוצר שקיבל את המבצע: חוסר במחיר המבצע, הסרגל מראה את החוסר ולא את ההנחה, והתעודה נשמרת עם החוסר', async () => {
  const r = await note({ intent: 'lines' });
  // המוקה: הגיעו 4 מתוך 6
  await checkLines(r, c => review(c).docs.forEach((d, di) => d.lines.forEach((l, li) => {
    if (l.productId !== 'mocha') { click(c, { lineMark: di + ':' + li + ':ok' }); return; }
    click(c, { lineMark: di + ':' + li + ':other' });
    c.run(`receiptLineCheckInput({ target: { dataset: { lineGot: '${di}:${li}' }, value: '4' } })`);
  })));
  assert.deepEqual(json(r, `receiptList.filter(l => l.productId === 'mocha').map(l => l.qty)`), [4]);
  assert.equal(r.run('!!pendingReceipt'), false, 'חוסר — הקליטה עוצרת במסך ההשוואה, כמו תמיד');
  const findings = json(r, `aiScanEvaluation.findings.filter(f => f.productId === 'mocha' && f.type !== 'printed_promo')`);
  assert.deepEqual(findings.map(f => [f.type, f.qty, r2(f.expectedPrice * 1000) / 1000]), [['shortage', 2, 7.531]]);
  assert.deepEqual(json(r, '[aiScanEvaluation.valid, aiScanEvaluation.closure.ok]'), [true, true]);
  // שורת ההשוואה של המוקה כבר במחיר המבצע, ולכן הסרגל מראה את שווי החוסר (2 × ₪7.531 = ₪15.06) ולא ₪9.75 (החוסר פחות ההנחה, כמו ב-419)
  assert.deepEqual(json(r, `reconcileData.filter(l => l.productId === 'mocha').map(l => [l.received, l.promoPct, l.promoOn, Math.round(l.price * 1000) / 1000])`), [[4, 15, true, 7.531]]);
  const screen = strip(app(r));
  assert.match(screen, /תעודת הספק ₪192\.43 סכום הפריטים שנסרקו ₪177\.36 חסר ₪15\.07/);
  assert.match(screen, /חוסרים/); assert.match(app(r), /data-role="ai-confirm-findings"/);
  assert.doesNotMatch(screen, /בעיות מחיר|פערי מחיר|מחיר שונה/);
  assert.doesNotMatch(app(r), ALERT, 'גם כאן — בלי הודעה על המינימום');
  r.click('ai-confirm-findings'); await settle();
  r.click('ai-apply'); await settle();
  const rc = await save(r);
  const mocha = rc.items.find(l => l.productId === 'mocha');
  assert.deepEqual([mocha.qty, mocha.noteQty, mocha.promoPct, mocha.basePrice, mocha.lineTotal], [4, 6, 15, 8.86, 30.13]);
  assert.ok(Math.abs(mocha.unitPrice - MOCHA_UNIT) < 1e-9);
  assert.deepEqual([rc.status, rc.aiAudit.hasDiscrepancy], ['open', true]);
  assert.deepEqual(rc.aiAudit.findings.filter(f => f.productId === 'mocha').map(f => f.type), ['shortage', 'printed_promo']);
});

test('8. שתי תעודות שיחד מגיעות למינימום: מבצע רגיל — "מבצע בתוקף", בלי "פערי מחיר" (ב-419: פער מחיר בכל תעודה); ואותו מוצר בשתי תעודות', async () => {
  const r = await scan([paper([['milk', 12], ['mocha', 6, 15]], '9074025069'), paper([['cottage', 6], ['banana', 6, 15]], '407300217859')], { intent: 'lines' });
  const rows = audit(r).rows.filter(x => ['mocha', 'banana'].includes(x.productId));
  assert.deepEqual(rows.map(x => [x.productId, x.result, x.matchedForms, x.reason, x.expectedOptions[0].label, x.promo.belowMinimum, x.promo.basketUnits, x.promo.minUnits]),
    [['mocha', 'match', ['מבצע בתוקף'], 'המחיר תואם: מבצע בתוקף', 'מבצע בתוקף', undefined, 12, 12], ['banana', 'match', ['מבצע בתוקף'], 'המחיר תואם: מבצע בתוקף', 'מבצע בתוקף', undefined, 12, 12]]);
  const panel = r.run('receiptPriceAuditHtml()');
  assert.match(panel, /המחירים שנבדקו תואמים · 4 שורות · אין מה לאשר/);
  assert.doesNotMatch(panel, /פערי מחיר|data-price-reviewed/); assert.doesNotMatch(panel, ALERT);
  await checkLines(r);
  assert.equal(r.run('aiScanEvaluation.grantedPromos.size'), 0, 'במנוע המינימום הושג (12 יח׳ בשתי התעודות)');
  assert.deepEqual(json(r, `aiScanEvaluation.findings.map(f => f.type)`), ['printed_promo', 'printed_promo']);
  assert.equal(r.run('!!pendingReceipt'), true, 'הכול תואם — ההחלה נעשתה לבד');
  const rc = await save(r);
  assert.deepEqual(rc.items.filter(l => ['mocha', 'banana'].includes(l.productId)).map(l => [l.productId, l.promoPct, l.lineTotal]).sort(), [['banana', 15, 45.19], ['mocha', 15, 45.19]]);
  assert.deepEqual([rc.status, rc.aiAudit.hasDiscrepancy], ['ok', false]);
  // ואותו מוצר בשתי התעודות, 3 + 3 (מתחת למינימום גם יחד): המבצע חל על שתי השורות — בנתוני הבדיקה הסל נמדד על שתי התעודות יחד
  const split = await scan([paper([['milk', 12], ['mocha', 3, 15]], '9074025069'), paper([['cottage', 6], ['mocha', 3, 15]], '407300217859')], { intent: 'lines' });
  assert.deepEqual(audit(split).rows.filter(x => x.productId === 'mocha').map(x => [x.result, x.matchedForms[0], x.promo.belowMinimum, x.promo.basketUnits]), [['match', GRANTED, true, 6], ['match', GRANTED, true, 6]]);
  assert.doesNotMatch(split.run('receiptPriceAuditHtml()'), ALERT);
  await checkLines(split);
  assert.deepEqual(json(split, 'Array.from(aiScanEvaluation.grantedPromos.values()).map(g => [g.id, g.basketUnits])'), [['p-liter', 6]]);
  assert.deepEqual(json(split, `aiScanEvaluation.findings.map(f => f.type)`), ['printed_promo']);
  assert.equal(split.run('!!pendingReceipt'), true);
  const splitRc = await save(split);
  // (כל שורה בנייר מעוגלת בנפרד: 2 × ₪22.59)
  assert.deepEqual(splitRc.items.filter(l => l.productId === 'mocha').map(l => [l.qty, l.promoPct, l.lineTotal]), [[6, 15, 45.18]]);
});

test('9. מסך ההשוואה כשנפתח בלי ההחלה האוטומטית: שורת המוצר במחיר המבצע, והסרגל מאוזן יחד עם "הכול תואם — המשך"', async () => {
  const r = await note();
  // הספירה כבר בפנים (כמו בצירוף נייר לקליטה שנספרה, או בטיוטה שנמשכת), והסיום הוא מהכפתור הכחול — בלי הבדיקה הידנית שמחילה לבד
  r.run(`receiptList = [{ productId: 'milk', name: 'חלב', barcode: '7290000000008', qty: 12 }, { productId: 'cottage', name: 'קוטג׳', barcode: '7290000000015', qty: 6 },
    { productId: 'mocha', name: 'משקה מוקה 1 ליטר', barcode: '7290000000022', qty: 6 }, { productId: 'hummus', name: 'חומוס 750 חלק', barcode: '7290000000046', qty: 6 }];
    receiptCountingMode = 'scan'; saveReceiptDraft();`);
  assert.equal(r.run('aiScanEvaluation'), null, 'בצילום תחילה ההערכה נבנית רק כשמסך ההשוואה נפתח');
  assert.deepEqual(json(r, 'Array.from(receiptGrantedPromoMap().keys())'), ['mocha'], 'ועד אז — מחושבת מול הנייר');
  r.run('openReconcile()'); await settle();
  assert.equal(r.run('currentView'), 'reconcile'); assert.equal(r.run('!!pendingReceipt'), false);
  assert.deepEqual(json(r, `reconcileData.filter(l => l.productId === 'mocha').map(l => [l.received, l.noteQty, l.promoPct, l.promoOn, Math.round(l.price * 1000) / 1000, l.basePrice])`), [[6, 6, 15, true, 7.531, 8.86]]);
  assert.equal(r.run('reconcileIsBalanced()'), true);
  const screen = strip(app(r));
  assert.match(screen, /תעודת הספק ₪192\.43 סכום הפריטים שנסרקו ₪192\.43 מאוזן ✓/);
  assert.match(screen, /הכול תואם — לא נמצאו חוסר, עודף או בעיית מחיר\/מבצע\./);
  assert.match(app(r), /<button data-role="ai-apply"[^>]*><i class="fa-solid fa-check"><\/i> הכול תואם — המשך<\/button>/);
  assert.doesNotMatch(screen, /עודף ₪|אלה אכן הבעיות/);
  // אותה השוואה שנשמרה בטיוטה ונפתחת שוב נשארת "לא נגעו בה" (393): השורות שנבנות מחדש זהות לשמורות
  assert.deepEqual(json(r, 'receiptReconcileRows().filter(l => l.productId === "mocha").map(l => [l.promoPct, l.promoOn, Math.round(l.price * 1000) / 1000])'), [[15, true, 7.531]]);
  r.click('ai-apply'); await settle();
  const rc = await save(r);
  assert.deepEqual([rc.status, rc.totalExVat, rc.items.find(l => l.productId === 'mocha').promoPct], ['ok', 192.43, 15]);
});

// הרשימה שורה-שורה עם כמות אחרת למוצרים שב-got ({ mocha: 4 }); כל השאר "הגיע"
const checkWith = (r, got) => checkLines(r, c => review(c).docs.forEach((d, di) => d.lines.forEach((l, li) => {
  if (!(l.productId in got)) { click(c, { lineMark: di + ':' + li + ':ok' }); return; }
  click(c, { lineMark: di + ':' + li + ':other' });
  c.run(`receiptLineCheckInput({ target: { dataset: { lineGot: '${di}:${li}' }, value: '${got[l.productId]}' } })`);
})));
const buttons = r => [...app(r).matchAll(/<button data-role="(ai-confirm-findings|ai-apply)"[^>]*>(?:<i [^>]*><\/i>)?\s*([^<]*)<\/button>/g)].map(m => m[1] + ': ' + m[2].trim());
const bar = r => (strip(app(r)).match(/תעודת הספק ₪[\d.,]+ סכום הפריטים (?:שנסרקו|מהנייר) ₪[\d.,]+ (.+?) יחידות שנסרקו/) || [])[1];
const priceNote = r => { const h = app(r), i = h.indexOf('<div data-price-only-note'); return i < 0 ? null : strip(h.slice(i, h.indexOf('</div></div>', i) + 12)); };

test('10. מסך התוצאות אומר מה באמת נמצא: פער מחיר נקרא "פער מחיר" — בסרגל, בתיבה ובכפתורים; "עם החוסרים" רק כשיש חוסר', async () => {
  // (א) כל היחידות הגיעו, והמוקה חויב ב-10% הנחה (לא המבצע): פער מחיר בלבד, לטובת החנות. עד 419: "עודף ₪5.32", תיבה ריקה,
  //     "אלה אכן הבעיות — אשר" ו"סגור תעודה עם החוסרים"
  const cheap = await scan([paper([['milk', 12], ['mocha', 6, 10]])], { intent: 'lines' });
  await checkLines(cheap);
  assert.equal(cheap.run('!!pendingReceipt'), false);
  assert.equal(bar(cheap), 'פער מחיר ₪5.32');
  assert.equal(priceNote(cheap), 'נמצא פער מחיר אחד — בסחורה לא חסר ולא עודף דבר מחיר שונה: משקה מוקה 1 ליטר — במערכת ₪8.86, בנייר ₪7.97 הפירוט המלא למעלה, בבדיקת המחירים. התעודה נקלטת לפי המחיר שבנייר.');
  assert.deepEqual(buttons(cheap), ['ai-confirm-findings: פער המחיר נכון — אשר']);
  assert.doesNotMatch(strip(app(cheap)), /אלה אכן הבעיות|עם החוסרים|עודף ₪|חסר ₪|אלה הבעיות שנמצאו/);
  cheap.click('ai-confirm-findings'); await settle();
  assert.deepEqual(buttons(cheap), ['ai-apply: סגור תעודה עם פער המחיר']);
  assert.doesNotMatch(strip(app(cheap)), /עם החוסרים/);
  cheap.click('ai-apply'); await settle();
  const cheapRc = await save(cheap);
  // התעודה עצמה נשמרת בדיוק כמו קודם: המחיר שבנייר, בלי מבצע, עם ממצא המחיר
  assert.deepEqual(cheapRc.items.find(l => l.productId === 'mocha').promoPct, 0);
  assert.deepEqual(cheapRc.aiAudit.findings.filter(f => f.type === 'price').map(f => [f.productId, f.amount]), [['mocha', -5.32]]);

  // (ב) המינימום הושג והנייר חייב מחיר מלא — הספק לא נתן את המבצע. עד 419 הסרגל כתב "חסר ₪15.95": חסרה הנחה, לא סחורה
  const missing = await scan([paper([['milk', 12], ['mocha', 12]])], { intent: 'lines' });
  await checkLines(missing);
  assert.equal(bar(missing), 'פער מחיר ₪15.95');
  assert.equal(priceNote(missing), 'נמצא פער מחיר אחד — בסחורה לא חסר ולא עודף דבר המבצע לא מופיע אצל הספק: משקה מוקה 1 ליטר — במערכת ₪7.53, בנייר ₪8.86 הפירוט המלא למעלה, בבדיקת המחירים. התעודה נקלטת לפי המחיר שבנייר.');
  assert.deepEqual(buttons(missing), ['ai-confirm-findings: פער המחיר נכון — אשר']);
  missing.click('ai-confirm-findings'); await settle();
  assert.deepEqual(buttons(missing), ['ai-apply: סגור תעודה עם פער המחיר']);

  // (ג) חוסר בלבד — בדיוק כמו קודם: "חסר ₪…", רשימת החוסרים, "אלה אכן הבעיות — אשר" ו"סגור תעודה עם החוסרים"
  const short = await scan([paper([['milk', 12], ['cottage', 6]])], { intent: 'lines' });
  await checkWith(short, { cottage: 4 });
  assert.equal(bar(short), 'חסר ₪14.00');
  assert.equal(priceNote(short), null);
  assert.match(strip(app(short)), /אלה הבעיות שנמצאו: חוסרים/);
  assert.deepEqual(buttons(short), ['ai-confirm-findings: אלה אכן הבעיות — אשר']);
  short.click('ai-confirm-findings'); await settle();
  assert.deepEqual(buttons(short), ['ai-apply: סגור תעודה עם החוסרים']);

  // (ד) עודף בלבד — "סגור תעודה עם העודפים"
  const over = await scan([paper([['milk', 12], ['cottage', 6]])], { intent: 'lines' });
  await checkWith(over, { cottage: 8 });
  assert.equal(bar(over), 'עודף ₪14.00');
  assert.deepEqual(buttons(over), ['ai-confirm-findings: אלה אכן הבעיות — אשר']);
  over.click('ai-confirm-findings'); await settle();
  assert.deepEqual(buttons(over), ['ai-apply: סגור תעודה עם העודפים']);

  // (ה) חוסר וגם פער מחיר — הסרגל והרשימה כמו קודם, בלי הקופסה של "פער מחיר בלבד", והכפתור: "עם ההפרשים"
  const both = await scan([paper([['milk', 12], ['cottage', 6], ['mocha', 6, 10]])], { intent: 'lines' });
  await checkWith(both, { cottage: 4 });
  assert.match(bar(both), /^חסר ₪/);
  assert.equal(priceNote(both), null);
  assert.deepEqual(buttons(both), ['ai-confirm-findings: אלה אכן הבעיות — אשר']);
  both.click('ai-confirm-findings'); await settle();
  assert.deepEqual(buttons(both), ['ai-apply: סגור תעודה עם ההפרשים']);

  // (ו) השם של הכפתור, לכל צירוף
  const label = list => both.run(`aiCloseFindingsLabel(${JSON.stringify(list.map(type => ({ type })))})`);
  assert.equal(label(['shortage']), 'סגור תעודה עם החוסרים');
  assert.equal(label(['shortage', 'shortage']), 'סגור תעודה עם החוסרים');
  assert.equal(label(['surplus']), 'סגור תעודה עם העודפים');
  assert.equal(label(['shortage', 'surplus']), 'סגור תעודה עם החוסרים והעודפים');
  assert.equal(label(['price']), 'סגור תעודה עם פער המחיר');
  assert.equal(label(['promo_missing']), 'סגור תעודה עם פער המחיר');
  assert.equal(label(['price', 'promo_missing']), 'סגור תעודה עם פערי המחיר');
  assert.equal(label(['price', 'shortage']), 'סגור תעודה עם ההפרשים');
  assert.equal(label(['surplus', 'promo_missing']), 'סגור תעודה עם ההפרשים');
  assert.equal(label(['printed_promo']), 'סגור תעודה עם החוסרים', 'בלי ממצא לטיפול — השם הישן (למשל זיכוי מהנהג שמחכה)');
  assert.equal(label([]), 'סגור תעודה עם החוסרים');
  // "פער מחיר בלבד" — רק כשאין שום חוסר או עודף, גם לא כזה שכוסה
  const only = list => both.run(`aiPriceOnlyFindings({ findings: ${JSON.stringify(list.map(type => ({ type })))} }).length`);
  assert.deepEqual([only(['price']), only(['price', 'promo_missing', 'printed_promo']), only(['price', 'shortage']), only(['surplus']), only(['printed_promo']), only([])], [1, 2, 0, 0, 0, 0]);
});

test('11. הגרסה עלתה ל-420, כולל הכותרת וה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '420'/);
  assert.match(html, /<title>הזמנות יטבתה - v420 מבצע שניתן בלי המינימום נקלט כמבצע — בלי התראה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v420 מבצע שניתן בלי המינימום נקלט כמבצע — בלי התראה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v420/);
});
