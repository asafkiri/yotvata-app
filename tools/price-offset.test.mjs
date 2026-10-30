// v401: הכלל של בעל העסק — קיזוז לפי מחיר, לא לפי שם. חוסר ועודף באותו מחיר
// ליחידה (עד האגורה) הם אותו כסף, ולכן מתקזזים לבד: בתוך התעודה (הקיזוז הפנימי,
// שחזר להיות אוטומטי לכל התעודות ועכשיו עם "בטל") ובין תעודות (הקיזוז האוטומטי,
// שעד כאן דרש אותו מוצר ואותה כמות). הכמות שמתקזזת היא המשותפת; היתרה נשארת
// חוסר או עודף פתוח. כל קיזוז אוטומטי מוצג בכרטיס התעודה וניתן לביטול, וזוג
// שבוטל אינו חוזר לבד. הסטטוס השמור (v398) עוקב אחרי כל זה.
// הרצה: node --test tools/price-offset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (r, expression) => JSON.parse(r.run('JSON.stringify(' + expression + ')'));
const MOCHA = { id: 'mocha', name: 'מוקה ליטר', price: 4.4 };
const VANILLA = { id: 'vanilla', name: 'וניל ליטר', price: 4.4 };
const BUTTER = { id: 'butter', name: 'חמאה', price: 4.41 };

function create() {
  const r = harness.runtime('yotvata');
  r.run(`cloudLog = []; runCloudTaskSilent = async (name, task) => { cloudLog.push(task); return true; };
    mkRc = (id, day, lines, extra) => Object.assign({ id, date: '2026-09-' + day, timestamp: Date.parse('2026-09-' + day + 'T08:00:00Z'), status: 'open', aiAudit: null,
      items: lines.map(([p, qty, noteQty]) => ({ productId: p.id, name: p.name, qty, noteQty, unitPrice: p.price, lineTotal: Math.round(p.price * qty * 100) / 100 })) }, extra || {});
    paperOf = rc => { const amount = Math.round(rc.items.reduce((a, l) => a + l.unitPrice * (l.noteQty != null ? l.noteQty : l.qty), 0) * 100) / 100;
      const units = rc.items.reduce((a, l) => a + (l.noteQty != null ? l.noteQty : l.qty), 0);
      return { ...rc, noteParts: [{ amount, units }], noteTotalInc: amount, totalExVat: Math.round(rc.items.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100 }; };`);
  r.context.P = { MOCHA, VANILLA, BUTTER };
  return r;
}
const sweep = r => r.run(`autoApplyExactOffsets().then(a => JSON.stringify(a.map(p => [p.rc.id, p.other.id, p.productId, p.otherProductId, p.qty, p.byPrice])))`).then(JSON.parse);
const state = (r, index) => json(r, `(d => ({ open: d.open, short: d.shortItems.map(x => x.productId + ':' + x.n), over: d.overItems.map(x => x.productId + ':' + x.n),
  groups: d.priceOffsets.map(g => [g.id, g.qty, g.shortItems.map(x => x.productId + ':' + x.n).join('+'), g.overItems.map(x => x.productId + ':' + x.n).join('+')]),
  external: d.externalOffsets.map(x => [x.dir, x.productId, x.qty]), payable: receiptPayableBaseEx(receipts[${index}]), plain: receiptPlainStatus(receipts[${index}], d).text }))(receiptDiscrepancyInfo(receipts[${index}]))`);
function renderHistory(r) {
  r.run("returns = []; currentView = 'receiptsHistory'; renderReceiptsHistory()");
  return r.node('app').innerHTML;
}
const diffRows = html => [...html.matchAll(/<div class="min-w-0"><div class="font-bold truncate">([\s\S]*?)<button data-role="rc-offset-choose"/g)].map(m => strip(m[1]));

test('בתוך התעודה: חוסר ועודף באותו מחיר ליחידה מתקזזים לבד — גם בתעודה מאחרי 6.8.2026, מוצרים שונים, הכמות המשותפת', () => {
  const r = create();
  // הנייר: 6 מוקה (₪4.40). נסרקו: 0 מוקה, 4 וניל (₪4.40) שאינם בנייר. התעודה מספטמבר — עד v400 נדרש אישור ביד.
  r.run(`receipts = [paperOf(mkRc('rc', '28', [[P.MOCHA, 0, 6], [P.VANILLA, 4, 0]]))];`);
  assert.deepEqual(state(r, 0), { open: true, short: ['mocha:2'], over: [], groups: [['xin|440', 4, 'mocha:4', 'vanilla:4']], external: [], payable: 17.6, plain: 'חסר 2 × מוקה ליטר · ₪8.80 · ממתין לזיכוי מהספק' });
  const html = renderHistory(r);
  const box = strip(html.slice(html.indexOf('קיזוז פנימי אוטומטי'), html.indexOf('</div>', html.indexOf('לא נכון?'))));
  assert.equal(box, 'קיזוז פנימי אוטומטי — חוסר ועודף באותו מחיר ליחידה 4 × מוקה ליטר ⇄ 4 × וניל ליטר · ₪4.40 ליח׳ · ₪17.60 בטל הכסף זהה, ולכן השורות התקזזו לבד ואינן מופחתות מהתשלום. לא נכון? בטל — החוסר והעודף יחזרו להיות פתוחים ולא יקוזזו שוב לבד.');
  assert.match(html, /data-role="rc-offset-cancel" data-id="rc" data-group="xin\|440"/);
  assert.deepEqual(diffRows(html), ['חסר: מוקה ליטר 2 יח׳ · ₪8.80'], 'רק היתרה נשארת שורת הפרש');
  // כמות שווה — התעודה מאוזנת, והמשפט אומר איך
  r.run(`receipts = [paperOf(mkRc('rc', '28', [[P.MOCHA, 0, 6], [P.VANILLA, 6, 0]]))];`);
  assert.deepEqual(state(r, 0), { open: false, short: [], over: [], groups: [['xin|440', 6, 'mocha:6', 'vanilla:6']], external: [], payable: 26.4, plain: 'נקלטה ומאוזנת ✓ · קיזוז פנימי' });
  assert.ok(strip(renderHistory(r)).includes('אומתה · קיזוז פנימי'));
  assert.deepEqual(json(r, 'receiptStoredStatusPatch(receipts[0], {})'), { status: 'ok' }, 'הסטטוס השמור עוקב');
  // מחיר שנבדל באגורה — לא מתקזז
  r.run(`receipts = [paperOf(mkRc('rc', '28', [[P.MOCHA, 0, 6], [P.BUTTER, 6, 0]]))];`);
  assert.deepEqual([state(r, 0).groups, state(r, 0).short, state(r, 0).over], [[], ['mocha:6'], ['butter:6']]);
});

test('"בטל" על הקיזוז הפנימי: החוסר והעודף חוזרים, הסטטוס נפתח, הביטול נשמר ואינו מתקזז שוב — גם במסך העריכה', async () => {
  const r = create();
  r.run(`receipts = [paperOf(mkRc('rc', '28', [[P.MOCHA, 0, 6], [P.VANILLA, 6, 0]], { status: 'ok' }))]; currentView = 'receiptsHistory';`);
  await r.run("cancelReceiptOffset('rc', 'xin|440')");
  const write = r.writes.at(-1);
  assert.equal(write.op, 'batch');
  assert.deepEqual(write.writes.map(w => w.data), [{ canceledOffsetIds: ['xin|440'], status: 'open' }], 'רק הסימון והסטטוס נכתבים — אין רשומת קיזוז להסיר');
  assert.deepEqual(state(r, 0), { open: true, short: ['mocha:6'], over: ['vanilla:6'], groups: [], external: [], payable: 0, plain: 'חסר 6 × מוקה ליטר · ₪26.40 · ממתין לזיכוי מהספק' });
  assert.equal(r.run('receipts[0].status'), 'open');
  assert.match(r.toasts.at(-1), /הקיזוז בוטל — החוסר והעודף חזרו להיות פתוחים/);
  const html = strip(renderHistory(r));
  assert.ok(!html.includes('קיזוז פנימי אוטומטי'));
  assert.ok(html.includes('קיזוז מזוהה — ממתין לאישורך'), 'הזוג עדיין מוצע לאישור ביד');
  assert.ok(html.includes('הקיזוז הפנימי במחיר הזה בוטל בכרטיס, ולכן הוא לא מתבצע לבד.'));
  assert.deepEqual(await sweep(r), [], 'הסריקה האוטומטית אינה מקזזת בתוך תעודה שבוטלה');
  r.run("openReceiptFix('rc')");
  assert.deepEqual(json(r, 'receiptFixOpenLines().map(l => l.productId)'), ['mocha', 'vanilla']);
  assert.equal(json(r, 'receiptFixLineState("mocha").internalOffsetQty'), 0);
  await r.run("cancelReceiptOffset('rc', 'xin|440')");
  assert.equal(r.toasts.at(-1), 'הקיזוז כבר בוטל');
});

test('בין תעודות: מוצר אחר באותו מחיר מתקזז לבד, בכמות המשותפת, והרשומה גדלה כשהעודף גדל — בלי כפילות', async () => {
  const r = create();
  r.run(`receipts = [paperOf(mkRc('today', '28', [[P.VANILLA, 4, 0]])), paperOf(mkRc('yday', '27', [[P.MOCHA, 0, 6]]))];`);
  assert.deepEqual(await sweep(r), [['today', 'yday', 'vanilla', 'mocha', 4, true]]);
  assert.deepEqual(state(r, 1), { open: true, short: ['mocha:2'], over: [], groups: [], external: [['short', 'mocha', 4]], payable: 17.6, plain: 'חסר 2 × מוקה ליטר · ₪8.80 · ממתין לזיכוי מהספק' });
  assert.deepEqual(json(r, 'cloudLog[0].writes.map(w => [String(w.path).endsWith("today") ? "today" : "yday", w.data.status, w.data.externalOffsets.map(x => [x.productId, x.otherProductId, x.dir, x.qty, x.price, x.source])])'),
    [['today', 'ok', [['vanilla', 'mocha', 'over', 4, 4.4, 'auto']]], ['yday', 'open', [['mocha', 'vanilla', 'short', 4, 4.4, 'auto']]]], 'הסטטוס השמור נכתב עם הקיזוז');
  assert.deepEqual(await sweep(r), []);
  r.run(`receipts[0].items[0].qty = 6; receipts[0].items[0].lineTotal = 26.4;`);
  assert.deepEqual(await sweep(r), [['today', 'yday', 'vanilla', 'mocha', 2, true]]);
  const oid = r.run("crossOffsetId('today', 'yday', 'vanilla', 'mocha')");
  assert.deepEqual(json(r, 'receipts.map(rc => rc.externalOffsets.map(x => [x.id, x.qty]))'), [[[oid, 6]], [[oid, 6]]]);
  assert.equal(state(r, 1).open, false); assert.equal(state(r, 1).plain, 'נקלטה ומאוזנת ✓ · קיזוז');
  const html = strip(renderHistory(r));
  assert.ok(html.includes('6 × מוקה ליטר ⇄ 6 × וניל ליטר — קוזז אוטומטית מול תעודה מ-28.9.2026 (אותו מחיר ליחידה ₪4.40)'), html);
  assert.ok(html.includes('6 × וניל ליטר ⇄ 6 × מוקה ליטר — קוזז אוטומטית מול תעודה מ-27.9.2026 (אותו מחיר ליחידה ₪4.40)'));
  assert.equal((html.match(/אומתה · קיזוז מאושר/g) || []).length, 2);
  const toast = await r.run(`(async () => { receipts = [paperOf(mkRc('t2', '28', [[P.VANILLA, 6, 0]])), paperOf(mkRc('y2', '27', [[P.MOCHA, 0, 6]]))]; return autoOffsetToastText(await autoApplyExactOffsets()); })()`);
  assert.equal(toast, '⚖️ קיזוז אוטומטי: 6 × וניל ליטר (עודף) מול 6 × מוקה ליטר (חסר) בתעודה אחרת — אותו מחיר ליחידה ₪4.40 (₪26.40). אפשר לבטל בכרטיס התעודה.');
});

test('אותו מוצר קודם לאותו מחיר; זוג שבוטל אינו חוזר ובכרטיס כתוב למה; מחוץ לחלון 9 התעודות — הצעה עם הסבר', async () => {
  const r = create();
  r.run(`receipts = [paperOf(mkRc('today', '28', [[P.MOCHA, 0, 6]])), paperOf(mkRc('yday', '27', [[P.VANILLA, 6, 0]])), paperOf(mkRc('older', '26', [[P.MOCHA, 6, 0]]))];`);
  assert.deepEqual(await sweep(r), [['today', 'older', 'mocha', 'mocha', 6, false]]);
  assert.ok(strip(renderHistory(r)).includes('6 × מוקה ליטר — קוזז אוטומטית מול תעודה מ-26.9.2026 (אותו מוצר ואותו מחיר)'));
  // ביטול של זוג של שני מוצרים
  r.run(`receipts = [paperOf(mkRc('today', '28', [[P.VANILLA, 6, 0]])), paperOf(mkRc('yday', '27', [[P.MOCHA, 0, 6]]))]; currentView = 'receiptsHistory';`);
  await sweep(r);
  const groupId = r.run("receipts[0].externalOffsets[0].id");
  await r.run(`cancelReceiptOffset('today', '${groupId}')`);
  assert.deepEqual(json(r, 'receipts.map(rc => [rc.externalOffsets.length, rc.canceledOffsetIds, rc.status])'), [[0, [groupId], 'open'], [0, [groupId], 'open']], 'העודף והחוסר פתוחים שוב — גם הסטטוס השמור');
  assert.deepEqual(await sweep(r), []);
  let html = strip(renderHistory(r));
  assert.ok(html.includes('קיזוז מזוהה — ממתין לאישורך'));
  assert.ok(html.includes('קיזוז כזה בוטל בעבר, ולכן הוא לא מתבצע לבד.'));
  r.run(`receipts = [paperOf(mkRc('today', '28', [[P.VANILLA, 6, 0]]))].concat(Array.from({ length: 8 }, (_, i) => mkRc('f' + i, '2' + i, [[P.BUTTER, 1, 1]])), [paperOf(mkRc('old', '01', [[P.MOCHA, 0, 6]]))]);`);
  assert.deepEqual(await sweep(r), []);
  html = strip(renderHistory(r));
  assert.ok(html.includes('אחת התעודות אינה בין 9 התעודות האחרונות, ולכן הקיזוז לא מתבצע לבד — אפשר לאשר אותו כאן.'));
});

test('קיזוז שאושר ביד בתוך התעודה (מאז 6.8.2026) נצרך קודם ומוצג פעם אחת; "בטל" עליו משחרר את שני המוצרים בלי שהקיזוז הפנימי יבלע אותם מיד', async () => {
  const r = create();
  r.run(`receipts = [paperOf(mkRc('rc', '28', [[P.MOCHA, 0, 6], [P.VANILLA, 6, 0]], { status: 'ok', offsetSchemaVersion: 3, externalOffsets: [
      { id: 'g|short', groupId: 'g', otherId: 'rc', productId: 'mocha', name: 'מוקה ליטר', qty: 6, dir: 'short', at: 1, source: 'manual' },
      { id: 'g|over', groupId: 'g', otherId: 'rc', productId: 'vanilla', name: 'וניל ליטר', qty: 6, dir: 'over', at: 1, source: 'manual' }] }))]; currentView = 'receiptsHistory';`);
  assert.deepEqual(state(r, 0), { open: false, short: [], over: [], groups: [], external: [['short', 'mocha', 6], ['over', 'vanilla', 6]], payable: 26.4, plain: 'נקלטה ומאוזנת ✓ · קיזוז' });
  const html = strip(renderHistory(r));
  assert.ok(html.includes('קיזוזים שאושרו במודע 6 × מוקה ליטר — קוזז בתוך התעודה באישורך בטל'), html);
  assert.ok(!html.includes('קיזוז פנימי אוטומטי'), 'אותו קיזוז אינו מוצג פעמיים');
  await r.run("cancelReceiptOffset('rc', 'g')");
  assert.deepEqual(json(r, '[receipts[0].externalOffsets, receipts[0].canceledOffsetIds, receipts[0].status]'), [[], ['g', 'xin|440'], 'open']);
  assert.deepEqual(state(r, 0), { open: true, short: ['mocha:6'], over: ['vanilla:6'], groups: [], external: [], payable: 0, plain: 'חסר 6 × מוקה ליטר · ₪26.40 · ממתין לזיכוי מהספק' });
});

// הקליטה עצמה (המסלול האמיתי): הנייר אומר 12 × א ו-2 × ג, נסרקו 12 × ב (אותו מחיר כמו א)
// ו-2 × ג. מסך התוצאות אומר מראש שהזוג יתקזז, הסיכום מציג את הקיזוז, והתעודה נשמרת מאוזנת.
function scanRow(desc, barcode, line, qty, price) {
  return { section: 'items', description: desc, itemCode: String(100 + line), barcode, barcodeObserved: barcode,
    barcodeReadType: 'full', barcodeMatchMethod: 'exact_full', lineNumber: line, sourcePage: 1, quantity: qty,
    unitPriceExVat: price, grossLineTotalExVat: qty * price, lineTotalExVat: qty * price, lineDiscountExVat: 0, confidence: .95 };
}
function swappedScan() {
  const data = harness.fixture('yotvata');
  data.products = [{ id: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', price: 5 },
    { id: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', price: 5 },
    { id: 'C', name: 'מוצר ג בדיקה', barcode: '7290000000022', price: 6 }];
  const rows = [scanRow('מוצר א בדיקה', '7290000000008', 1, 12, 5), scanRow('מוצר ג בדיקה', '7290000000022', 2, 2, 6)];
  Object.assign(data.paper.scan.documents[0], { subtotalExVat: 72, printedUnits: 14, itemsPrintedLines: 2, printedLines: 2, itemsSectionTotalExVat: 72, rows });
  data.items = [{ productId: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', qty: 12 }, { productId: 'C', name: 'מוצר ג בדיקה', barcode: '7290000000022', qty: 2 }];
  return data;
}

test('הקליטה מתחילתה ועד הכרטיס: "יתקזז לבד בסיום" במסך התוצאות, הקיזוז בסיכום, והתעודה נשמרת מאוזנת', async () => {
  const c = harness.runtime('yotvata', { data: swappedScan() });
  await c.scan();
  c.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(c.run('rcStep'), 'ai');
  let html = c.node('app').innerHTML;
  const preview = strip(html.slice(html.indexOf('data-price-offset-preview') + 'data-price-offset-preview'.length, html.indexOf('אלה הבעיות שנמצאו')));
  assert.equal(preview, '> יתקזז לבד בסיום — חוסר ועודף באותו מחיר ליחידה 12 × מוצר א בדיקה ⇄ 12 × מוצר ב בדיקה · ₪5.00 ליח׳ הכסף זהה, ולכן הכמות המשותפת לא תופחת מהתשלום; יתרה, אם יש, נשארת חוסר או עודף. אפשר לבטל אחר כך בכרטיס התעודה.');
  assert.ok(strip(html).includes('מוצר א בדיקה חסר 12 יח׳'), 'החוסר עצמו עדיין מוצג כממצא');
  c.click('ai-confirm-findings');
  c.click('ai-apply');
  assert.ok(c.run('!!pendingReceipt'), 'the summary opened');
  const summary = strip(c.node('rsBody').innerHTML);
  assert.ok(summary.includes('קיזוז פנימי אוטומטי — חוסר ועודף באותו מחיר ליחידה 12 × מוצר א בדיקה ⇄ 12 × מוצר ב בדיקה · ₪5.00 ליח׳ · ₪60.00 הכסף זהה, ולכן הכמות הזאת אינה מופחתת מהתשלום. אפשר לבטל אחר כך בכרטיס התעודה.'), summary);
  assert.ok(!summary.includes('נשמר עם הפרשים'), 'התעודה מאוזנת');
  assert.equal(c.run('pendingReceipt.status'), 'ok');
  assert.equal(c.run('pendingReceipt.ex'), 72);
  await c.run('confirmReceipt()');
  const saved = c.writes.slice().reverse().find(w => w && w.data && Array.isArray(w.data.items));
  assert.ok(saved, 'receipt saved');
  assert.equal(saved.data.status, 'ok');
  c.context.savedRc = { ...saved.data, id: 'rc1' };
  c.run("receipts = [savedRc]; returns = []; currentView = 'receiptsHistory'; renderReceiptsHistory()");
  html = strip(c.node('app').innerHTML);
  assert.ok(html.includes('אומתה · קיזוז פנימי'));
  assert.ok(html.includes('נקלטה ומאוזנת ✓ · קיזוז פנימי'));
  assert.ok(html.includes('קיזוז פנימי אוטומטי — חוסר ועודף באותו מחיר ליחידה 12 × מוצר א בדיקה ⇄ 12 × מוצר ב בדיקה · ₪5.00 ליח׳ · ₪60.00 בטל'));
});
