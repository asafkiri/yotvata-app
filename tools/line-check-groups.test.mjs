// גרסה 412 — בדיקה שורה-שורה: מוצר אחד — שורה אחת, גם כשהוא בשתי תעודות (כמו ברמן 164 ותנובה 157). בעל העסק, 9.11.2026: "אני
// עדיין לא בטוח מה נעשה כשיהיו שתי תעודות — זה נראה לי יסבך את כל המערכת". הסחורה על הרצפה לא אומרת לאיזו תעודה היא שייכת,
// ולכן מוצר שבכמה תעודות הוא קבוצה אחת: כרטיס אחד עם הסך, והחלוקה בין התעודות אוטומטית — לפי הסדר, והחוסר על האחרונה.
// אותם נתונים כמו בבדיקות הסריקה: תעודה 4471001 (חלב 12, קוטג׳ 6, יוגורט 4) ותעודה 4471002 (חלב 5, שמנת 2) — החלב (12 + 5)
// בשתיהן; 5 שורות בתעודות, 4 מוצרים.
// מה שנבדק:
// 1. הרשימה: 4 שורות; חלב — כרטיס אחד בתעודה 1 ("גם בתעודה 2 (5 יח׳)", "17 יח׳ ב-2 תעודות", "12 + 5", "הגיע 17"), ובתעודה 2
//    שורת הפניה ("נספר יחד עם תעודה 1, שורה 1", "הצג"); כותרות התעודות — כמו שהן ("2 שורות · 7 יח׳").
// 2. סימון הקבוצה: "הגיע 17" — שתי השורות; "אחרת" 15 — מתחלק 12 + 3 (החוסר על האחרונה), הסיכום "התקבלו 15 · חוסר 2", ואחרי
//    היציאה מהשדה השורה המלאה "הגיע"; "לא הגיע" — שתיהן; 20 — עודף 3 על האחרונה; שורת ההפניה אומרת מה סומן.
// 3. "הצג" בשורת ההפניה — לכרטיס של הקבוצה.
// 4. "סיום": מה שנשמר — לכל שורה בכל תעודה, עם split; הכרטיס בהיסטוריה — לפי החלוקה, עם ההערה שהיא אוטומטית.
// 5. המעבר מסריקה: מוצר בשתי תעודות שנסרק בכמות חלקית — "אחרת" עם המספר, מחולק; בדיוק הסך — "הגיע" בשניהן.
// 6. טיוטה מגרסה קודמת שבה שורה אחת של המוצר סומנה והשנייה לא — מה שסומן הופך לסך של הקבוצה, גם בהמשך מאותו מקום.
// 7. "התעודה הזאת לא שלנו": התעודה הראשונה יוצאת — השורה שנשארה (בשנייה) שומרת את חלקה; השנייה יוצאת — הראשונה שומרת את חלקה.
// 8. הגרסה.
// הרצה: node --test tools/line-check-groups.test.mjs
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
const DATA = { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } };
const json = (r, e) => JSON.parse(r.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const setup = `todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => testConfirms.push({ title, message, label, cb });`;
// שתי התעודות צולמו ונקראו, הכמויות נבדקות ידנית
async function scan(papers, opts = {}) {
  const cloud = fakeCloud();
  const c = runtime('yotvata', { cloud, data: DATA, ...opts });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(setup + `
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודות נקראו ואומתו: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  return c;
}
const twoPapers = opts => scan([BIG, SMALL], opts);
const click = (r, dataset) => r.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: ${JSON.stringify(dataset)} }) } })`);
const type = (r, dataset, value) => r.run(`receiptLineCheckInput({ target: { dataset: ${JSON.stringify(dataset)}, value: ${JSON.stringify(value)} } })`);
const blur = (r, lineGot) => r.events.get('receiptQuantityRows:focusout')({ target: { dataset: { lineGot } } });
const review = r => json(r, 'receiptQuantityReview');
const marks = r => review(r).docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(','));
const rows = r => r.run(`$('receiptQuantityRows').innerHTML`);
const progress = r => r.run(`$('receiptQuantityProgress').textContent`);
// ה-HTML של שורה אחת (lineCheck_di_li, או lineCheckRef_di_li — שורת הפניה) — עד השורה הבאה או סוף התעודה
function block(r, id) {
  const h = rows(r), i = h.indexOf('<div id="' + id + '"');
  assert.ok(i >= 0, id + ' קיים');
  const ends = ['<div id="lineCheck_', '<div id="lineCheckRef_', '<section', '</section>'].map(s => h.indexOf(s, i + 10)).filter(x => x > 0);
  return h.slice(i, Math.min.apply(null, ends));
}
const row = (r, di, li) => block(r, 'lineCheck_' + di + '_' + li);
const ref = (r, di, li) => block(r, 'lineCheckRef_' + di + '_' + li);
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

test('1. הרשימה: 4 שורות ל-5 שורות בשתי תעודות — מוצר שבשתיהן הוא כרטיס אחד עם הסך, ובתעודה השנייה שורת הפניה', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  assert.deepEqual(json(r, 'receiptLineGroups(receiptQuantityReview).map(g => [g.key, g.productId, g.paperQty, g.lines.map(x => x.di + ":" + x.li).join(" ")])'), [
    ['0:0', 'milk', 17, '0:0 1:0'], ['0:1', 'cottage', 6, '0:1'], ['0:2', 'yogurt', 4, '0:2'], ['1:1', 'cream', 2, '1:1']]);
  assert.equal(progress(r), 'סומנו 0 מתוך 4 שורות');
  assert.equal(r.run(`$('receiptQuantityConfirm').textContent`), 'סיום (נשארו 4)');
  const html = rows(r);
  assert.equal((html.match(/data-line-mark="\d+:\d+:ok"/g) || []).length, 4, 'ארבעה כרטיסים');
  // הכרטיס של החלב — בתעודה 1, עם הסך והחלוקה
  const a = row(r, 0, 0);
  assert.equal(strip(a), 'שורה 1 בתעודה · גם בתעודה 2 (5 יח׳) חלב 3% בקרטון 1 ליטר בקופה: ₪6.90 7290000000008 · ₪5.00 ליח׳ 17 יח׳ ב-2 תעודות 12 + 5 הגיע 17 אחרת לא הגיע');
  assert.match(a, /data-line-mark="0:0:ok"/); assert.match(a, /data-line-mark="0:0:qty"/); assert.match(a, /data-line-mark="0:0:none"/);
  // בתעודה 2 — שורת הפניה, בלי כפתורים, עם "הצג" שמוביל לכרטיס
  const p = ref(r, 1, 0);
  assert.equal(strip(p), 'שורה 1 בתעודה חלב 3% בקרטון 1 ליטר · 5 יח׳ נספר יחד עם תעודה 1, שורה 1 הצג');
  assert.doesNotMatch(p, /data-line-mark|data-line-got/);
  assert.match(p, /data-line-show="lineCheck_0_0"/);
  // מוצר בתעודה אחת — כמו קודם
  assert.match(strip(row(r, 0, 1)), /^שורה 2 בתעודה קוטג׳ 5% 250 גרם .* 6 יח׳ בתעודה הגיע 6 אחרת לא הגיע$/);
  assert.doesNotMatch(strip(row(r, 0, 1)), /גם בתעודה|ב-2 תעודות/);
  assert.match(strip(row(r, 1, 1)), /^שורה 2 בתעודה שמנת חמוצה 15% 200 מ״ל .* 2 יח׳ בתעודה הגיע 2 אחרת לא הגיע$/);
  // כותרות התעודות — כמו שהן: התעודה השנייה עדיין "2 שורות · 7 יח׳", גם ששורת החלב שלה נספרת למעלה
  assert.match(strip(html), /תעודה 2 מתוך 2 .*2 שורות · 7 יח׳/);
  assert.doesNotMatch(strip(html), /שורה נוספת|סרוק שוב|נסרקו \d+ יח׳ מהמוצר/);
  // הנתונים — עדיין שורה לכל תעודה (מה שנשמר אינו משתנה במבנה)
  assert.deepEqual(review(r).docs.map(d => d.lines.map(l => l.productId + '×' + l.paperQty).join(' ')), ['milk×12 cottage×6 yogurt×4', 'milk×5 cream×2']);
});

test('2. סימון הקבוצה: "הגיע 17" לשתי השורות; "אחרת" 15 מתחלק 12 + 3 והחוסר על האחרונה; "לא הגיע" לשתיהן; 20 — עודף על האחרונה', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:ok' });
  assert.deepEqual(marks(r), ['ok,,', 'ok,']);
  assert.equal(strip(row(r, 0, 0)), 'חלב 3% בקרטון 1 ליטר הגיע · 17 יח׳ ב-2 תעודות · בקופה ₪6.90 שנה', 'מקופל, עם הסך');
  assert.equal(strip(ref(r, 1, 0)), 'שורה 1 בתעודה חלב 3% בקרטון 1 ליטר · 5 יח׳ נספר יחד עם תעודה 1, שורה 1 · ✓ הגיע הצג');
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות');
  // "אחרת" 15: תוך כדי הקלדה — 12 + 3 בנתונים (עדיין "אחרת" בשתיהן), הסיכום על הסך, הכרטיס כתום
  click(r, { lineOpen: '0:0' }); click(r, { lineMark: '0:0:qty' });
  assert.match(row(r, 0, 0), /data-line-got="0:0"[^>]*value=""/);
  type(r, { lineGot: '0:0' }, '15');
  assert.deepEqual(marks(r), ['qty:12,,', 'qty:3,'], 'ממלאים לפי הסדר: 12 בראשונה, 3 בשנייה');
  assert.equal(r.run(`$('lineCheckSum_0_0').textContent`), 'התקבלו 15 · חוסר 2');
  assert.match(r.run(`$('lineCheck_0_0').className`), /border-amber-300 bg-amber-50$/);
  assert.equal(progress(r), 'סומנו 1 מתוך 4 שורות · חוסר 2 יח׳');
  // יציאה מהשדה — השורה שהתמלאה בדיוק נהיית "הגיע"; הקבוצה עדיין "אחרת" עם 15
  blur(r, '0:0');
  assert.deepEqual(marks(r), ['ok,,', 'qty:3,']);
  click(r, { lineMark: '0:1:ok' }); // ציור מחדש
  const a = row(r, 0, 0);
  assert.match(a, /data-line-got="0:0"[^>]*value="15"/, 'השדה — הסך של הקבוצה');
  assert.match(a, /data-line-mark="0:0:qty" aria-pressed="true"/);
  assert.match(a, /id="lineCheckSum_0_0"[^>]*>התקבלו 15 · חוסר 2</);
  assert.equal(strip(ref(r, 1, 0)), 'שורה 1 בתעודה חלב 3% בקרטון 1 ליטר · 5 יח׳ נספר יחד עם תעודה 1, שורה 1 · התקבלו 15 מתוך 17 הצג');
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 2 יח׳');
  // "לא הגיע" — שתי השורות
  click(r, { lineMark: '0:0:none' });
  assert.deepEqual(marks(r), ['none,ok,', 'none,']);
  assert.equal(strip(row(r, 0, 0)), 'חלב 3% בקרטון 1 ליטר לא הגיע · 0 מתוך 17 · בקופה ₪6.90 שנה');
  assert.equal(strip(ref(r, 1, 0)), 'שורה 1 בתעודה חלב 3% בקרטון 1 ליטר · 5 יח׳ נספר יחד עם תעודה 1, שורה 1 · ✗ לא הגיע הצג');
  // 20 — העודף (3) על האחרונה
  click(r, { lineOpen: '0:0' }); click(r, { lineMark: '0:0:qty' }); type(r, { lineGot: '0:0' }, '20'); blur(r, '0:0');
  assert.deepEqual(marks(r), ['ok,ok,', 'qty:8,']);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · עודף 3 יח׳');
  assert.equal(json(r, 'receiptQuantityReview.rows.find(x => x.productId === "milk")').kind, 'surplus');
  assert.equal(json(r, 'receiptQuantityReview.rows.find(x => x.productId === "milk")').difference, '3');
});

test('3. "הצג" בשורת ההפניה — גלילה לכרטיס של הקבוצה והדגשה שלו', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineShow: 'lineCheck_0_0' });
  assert.equal(r.run(`$('lineCheck_0_0').classList.contains('ring-4')`), true);
  assert.equal(r.run(`$('lineCheck_0_0').classList.contains('ring-blue-300')`), true);
  assert.deepEqual(marks(r), [',,', ','], 'הצגה אינה סימון');
});

test('4. "סיום": מה שנשמר — לכל שורה בכל תעודה לפי החלוקה, עם split; הכרטיס בהיסטוריה אומר שהחלוקה אוטומטית', async () => {
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:qty' }); type(r, { lineGot: '0:0' }, '15'); // חלב 15 מתוך 17
  markRestOk(r);
  assert.equal(progress(r), 'כל 4 שורות סומנו — אפשר לסיים · חוסר 2 יח׳');
  assert.equal(r.run('finishReceiptLineCheck()'), true);
  assert.deepEqual(json(r, 'receiptList.map(l => l.productId + " " + l.qty).sort()'), ['cottage 6', 'cream 2', 'milk 15', 'yogurt 4']);
  const saved = await save(r);
  assert.deepEqual(saved.quantityCheck.papers.map(p => p.lines), [
    [{ productId: 'milk', paperQty: 12, got: 12, split: true }, { productId: 'cottage', paperQty: 6, got: 6 }, { productId: 'yogurt', paperQty: 4, got: 4 }],
    [{ productId: 'milk', paperQty: 5, got: 3, split: true }, { productId: 'cream', paperQty: 2, got: 2 }]], 'החוסר (2) על התעודה האחרונה');
  assert.deepEqual(saved.quantityCheck.differences, [{ productId: 'milk', paperQty: 17, received: 15 }]);
  r.context.SAVED = saved;
  assert.equal(r.run(`typeof receiptPaperSections === 'function' ? receiptPaperSections(SAVED).split : receiptDocSplit(SAVED).every(d => d.split)`), true, 'הכרטיס יודע שהחלוקה אוטומטית');
  r.run(`receipts = [SAVED]; receiptHistoryFilter = 'all'; renderReceiptsHistory();`);
  const card = strip(r.run('app.innerHTML'));
  assert.match(card, /מוצר שמופיע בכמה תעודות נספר יחד, והחלוקה בין התעודות אוטומטית — לפי סדר התעודות, והחוסר על האחרונה\./);
  // קליטה עם תעודה אחת — בלי split ובלי ההערה
  const one = await scan([BIG]);
  one.run('startReceiptLineCheck()');
  markRestOk(one);
  assert.equal(one.run('finishReceiptLineCheck()'), true);
  const savedOne = await save(one);
  assert.ok(!JSON.stringify(savedOne.quantityCheck).includes('split'), 'בלי מוצר בכמה תעודות — בלי split');
  one.context.SAVED = savedOne;
  one.run(`receipts = [SAVED]; receiptHistoryFilter = 'all'; renderReceiptsHistory();`);
  assert.doesNotMatch(strip(one.run('app.innerHTML')), /החלוקה בין התעודות אוטומטית/);
});

test('5. המעבר מסריקה עם מוצר בשתי תעודות: כמות חלקית — "אחרת" מחולקת; בדיוק הסך — "הגיע" בשתיהן', async () => {
  const r = await twoPapers();
  r.run(`receiptList = [{ productId: 'milk', name: 'חלב 3% בקרטון 1 ליטר', barcode: '7290000000008', qty: 15 }, { productId: 'yogurt', name: 'יוגורט טבעי 150 גרם', barcode: '7290000000022', qty: 4 }]; saveReceiptDraft(); receiptCountingMode = 'scan';`);
  r.run('startReceiptLineCheck()');
  assert.equal(r.run('testConfirms.length'), 1); r.run('testConfirms[0].cb()');
  assert.deepEqual(marks(r), ['ok,,ok', 'qty:3,'], 'חלב 15: 12 בראשונה (מלאה — "הגיע"), 3 בשנייה; יוגורט 4 = 4: "הגיע"');
  const a = row(r, 0, 0);
  assert.match(a, /data-line-got="0:0"[^>]*value="15"/); assert.match(a, /data-line-mark="0:0:qty" aria-pressed="true"/);
  assert.match(a, /id="lineCheckSum_0_0"[^>]*>התקבלו 15 · חוסר 2</);
  assert.equal(progress(r), 'סומנו 2 מתוך 4 שורות · חוסר 2 יח׳');
  assert.doesNotMatch(strip(rows(r)), /נסרקו \d+ יח׳ מהמוצר/);
  // בדיוק הסך — "הגיע" בשתיהן
  const q = await twoPapers();
  q.run(`receiptList = [{ productId: 'milk', name: 'חלב 3% בקרטון 1 ליטר', barcode: '7290000000008', qty: 17 }]; saveReceiptDraft(); receiptCountingMode = 'scan';`);
  q.run('startReceiptLineCheck()'); q.run('testConfirms[0].cb()');
  assert.deepEqual(marks(q), ['ok,,', 'ok,']);
  assert.equal(strip(row(q, 0, 0)), 'חלב 3% בקרטון 1 ליטר הגיע · 17 יח׳ ב-2 תעודות · בקופה ₪6.90 שנה');
});

test('6. טיוטה מגרסה קודמת — שורה אחת של המוצר סומנה והשנייה לא: מה שסומן הופך לסך של הקבוצה, גם בהמשך מאותו מקום', async () => {
  const storage = new Map();
  const r = await twoPapers({ storage });
  r.run('startReceiptLineCheck()');
  // כמו שהגרסה הקודמת הייתה שומרת: חלב "הגיע" בתעודה הראשונה בלבד
  r.run(`receiptQuantityReview.docs[0].lines[0].mark = 'ok'; receiptQuantityReview.docs[0].lines[0].got = ''; saveReceiptDraft(); closeReceiptQuantityReview();`);
  r.run('startReceiptLineCheck()');
  assert.equal(r.run('testConfirms.length'), 0, 'המשך מאותו מקום');
  assert.deepEqual(marks(r), ['ok,,', 'none,'], 'הסך של מה שסומן — 12 מתוך 17: 12 בראשונה, 0 בשנייה');
  assert.match(row(r, 0, 0), /data-line-got="0:0"[^>]*value="12"/);
  assert.match(row(r, 0, 0), /id="lineCheckSum_0_0"[^>]*>התקבלו 12 · חוסר 5</);
  // גם בפתיחה מחדש של האפליקציה — הקריאה מהטיוטה
  const again = runtime('yotvata', { storage, data: DATA });
  again.run(setup);
  assert.equal(again.run(`receiptQuantityReview && receiptQuantityReview.mode`), 'lines');
  again.run('startReceiptLineCheck()');
  assert.deepEqual(marks(again), ['ok,,', 'none,']);
});

test('7. "התעודה הזאת לא שלנו": כל תעודה שנשארת שומרת את חלקה בחלוקה', async () => {
  // התעודה השנייה יוצאת — נשארת שורת ה-12 (מלאה: "הגיע")
  const r = await twoPapers();
  r.run('startReceiptLineCheck()');
  click(r, { lineMark: '0:0:qty' }); type(r, { lineGot: '0:0' }, '15'); blur(r, '0:0');
  click(r, { lineDrop: '1' }); click(r, { lineDropYes: '1' });
  assert.deepEqual(marks(r), ['ok,,']);
  assert.equal(strip(row(r, 0, 0)), 'חלב 3% בקרטון 1 ליטר הגיע · 12 יח׳ · בקופה ₪6.90 שנה');
  // התעודה הראשונה יוצאת — נשארת שורת ה-5 עם חלקה (3)
  const q = await twoPapers();
  q.run('startReceiptLineCheck()');
  click(q, { lineMark: '0:0:qty' }); type(q, { lineGot: '0:0' }, '15'); blur(q, '0:0');
  click(q, { lineDrop: '0' }); click(q, { lineDropYes: '0' });
  assert.deepEqual(marks(q), ['qty:3,']);
  assert.match(strip(row(q, 0, 0)), /^שורה 1 בתעודה חלב 3% בקרטון 1 ליטר .* 5 יח׳ בתעודה הגיע 5 אחרת לא הגיע כמה הגיע\? התקבלו 3 · חוסר 2$/);
  assert.doesNotMatch(strip(rows(q)), /גם בתעודה|נספר יחד עם/);
});

test('8. הגרסה (412 ומעלה), כולל הכותרת ו-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const v = html.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.ok(Number(v) >= 412, v);
  assert.match(html, new RegExp('<title>הזמנות יטבתה - v' + v + ' ')); assert.match(html, new RegExp('id="verBadge"[^>]*>v' + v + ' '));
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp('yotvata-v' + v));
});
