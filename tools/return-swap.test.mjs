// v380: חילוף מוצר במסך אימות הזיכוי.
// המקרה מהשטח (תעודת 3.10.2026): מילקי שוקולד נסרק כבודד (₪2.14), אבל הנהג
// מזכה אותו תמיד כמארז — כך הוא מוריד לנו אותו — ובנייר הופיע "פריט חזרות כללי"
// במחיר אחר. עד כה הברירה הייתה "זוכה" או "לא זוכה", ושתיהן שקר: הוא כן זיכה,
// רק מוצר אחר. "חילוף מוצר" מחליף את השורה במוצר שבאמת זוכה, במחיר הזיכוי
// שלו, בלי לצאת מהאימות. הבדיקה מריצה את מודול האפליקציה המלא ולוחצת על
// הכפתורים עצמם.
//
// הרצה: node --test tools/return-swap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));

// 9 × 3.37 + 1 × 2.14 = 32.47 ללא מע״מ. הנהג זיכה את המילקי כמארז: 30.33 + 16.03 = 46.36
const LINES = [
  { productId: 'p-top', name: 'מילקי טופ עדשים', barcode: '7290110573751', qty: 9, unitPrice: 3.37, lineTotal: 30.33 },
  { productId: 'p-single', name: 'מילקי שוקולד( בודדים )', barcode: '72940761', qty: 1, unitPrice: 2.14, lineTotal: 2.14 }
];
const SENT_EX = 32.47;
const NOTE_WITH_PACK = 46.36;

function setup(extra) {
  const c = runtime('yotvata');
  c.context.testConfirms = [];
  const ret = Object.assign({
    id: 'ret-1', timestamp: Date.UTC(2026, 9, 3, 14, 48), date: '2026-10-03', docDate: '2026-10-03', sentTo: 'קבוצה בוואטסאפ',
    items: LINES, totalExVat: SENT_EX, totalIncVat: SENT_EX, credited: false
  }, extra || {});
  c.run(`
    products = [
      { id: 'p-top', name: 'מילקי טופ עדשים', barcode: '7290110573751', price: 3.37 },
      { id: 'p-single', name: 'מילקי שוקולד( בודדים )', barcode: '72940761', price: 2.14, billingPackId: 'p-pack', billingPackSize: 8 },
      { id: 'p-pack', name: 'מארז 8 מילקי בטעם שוקולד', barcode: '7290104726712', price: 16.03 },
      { id: 'p-other', name: 'מילקי וניל', barcode: '72940754', price: 2.14 }
    ];
    returns = [${JSON.stringify(ret)}];
    receipts = []; receiptsHistoryFilter = 'all';
    currentView = 'receiptsHistory';
    showConfirm = (title, msg, okText, cb) => { testConfirms.push({ title, msg, okText, cb }); };
  `);
  return c;
}
const writesFor = c => json(c, "testWrites.filter(w => w.op === 'update' && String(w.path).indexOf('ret-1') > -1)");
const typeSwap = (c, text) => c.events.get('app:input')({ target: { id: 'rvSwapSearch', value: text, dataset: {}, closest: () => null } });

test('כל שורה במסך האימות מציעה "חילוף מוצר" לצד "זוכה" ו"לא זוכה"', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  assert.equal(c.run('currentView'), 'returnReconcile');
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('data-role="rv-swap" data-id="0"') && html.includes('data-role="rv-swap" data-id="1"'), 'כפתור חילוף בכל שורה');
  assert.ok(html.includes('data-role="rv-yes" data-id="1"') && html.includes('data-role="rv-no" data-id="1"'), 'שתי האופציות הישנות נשארו');
  assert.ok(html.includes('חילוף מוצר</b>'), 'ההסבר בראש המסך מזכיר את האופציה');
  assert.deepEqual(json(c, 'returnVerify.items.map(l => l.productId)'), ['p-top', 'p-single'], 'productId נוסע עם השורות');
});

test('לחיצה על חילוף פותחת בוחר בתוך השורה, עם המארז של הבודד כהצעה בלחיצה אחת וחיפוש', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-swap', '1');
  assert.equal(json(c, 'returnVerify.swapIdx'), 1);
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('data-rvswap="1"'), 'הבוחר נפתח בשורת המילקי');
  assert.ok(!html.includes('data-rvswap="0"'), 'ולא בשורה אחרת');
  assert.ok(html.includes('data-role="rv-swap-pick" data-id="p-pack"'), 'המארז מוצע בלחיצה אחת');
  assert.ok(html.includes('המארז של המוצר (8 יח׳)') && html.includes('₪' + c.run('fmtMoney(16.03)')), 'עם ההסבר והמחיר');
  assert.ok(html.includes('id="rvSwapSearch"') && html.includes('data-role="rv-swap-cancel"'), 'חיפוש וביטול');
  // חיפוש: לפי שם, בלי המוצר של השורה עצמה
  typeSwap(c, 'מילקי');
  const list = c.run("$('rvSwapList').innerHTML");
  assert.ok(list.includes('data-role="rv-swap-pick" data-id="p-other"') && list.includes('data-id="p-pack"'), 'תוצאות החיפוש הן כפתורי חילוף');
  assert.ok(!list.includes('data-id="p-single"'), 'המוצר שכבר בשורה אינו מוצע');
  // ביטול סוגר בלי לשנות דבר
  c.click('rv-swap-cancel');
  assert.equal(json(c, 'returnVerify.swapIdx'), -1);
  assert.equal(json(c, 'returnVerify.items[1].name'), 'מילקי שוקולד( בודדים )');
  assert.ok(!c.run("$('app').innerHTML").includes('data-rvswap='), 'הבוחר נסגר');
});

test('בחירת המארז מחליפה את השורה: מוצר ומחיר זיכוי חדשים, הכמות נשמרת, זוכה במלואו — והפער נסגר', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-yes', '0');
  assert.ok(Math.abs(json(c, 'rvGap()') - 13.89) < 0.01, 'לפני החילוף: הנייר גדול ב-₪13.89 (מארז 16.03 במקום בודד 2.14) ממה שהשורות מסבירות');
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-pack');
  const l = json(c, 'returnVerify.items[1]');
  assert.equal(l.productId, 'p-pack');
  assert.equal(l.name, 'מארז 8 מילקי בטעם שוקולד');
  assert.equal(l.barcode, '7290104726712');
  assert.equal(l.unitPrice, 16.03, 'מחיר הזיכוי של המוצר שנבחר');
  assert.equal(l.qty, 1, 'הכמות שהוחזרה נשמרת');
  assert.equal(l.noteQty, 1, 'נספר כזוכה במלואו');
  assert.equal(l.checked, true);
  assert.deepEqual(l.orig, { productId: 'p-single', name: 'מילקי שוקולד( בודדים )', barcode: '72940761', unitPrice: 2.14, isDeposit: false }, 'המקור נשמר');
  assert.equal(c.run('rvRowState(returnVerify.items[1])'), 'swap');
  assert.equal(json(c, 'returnVerify.swapIdx'), -1, 'הבוחר נסגר');
  assert.equal(json(c, 'rvGap()'), 0, 'ההפרש נסגר — הנהג באמת זיכה הכל, רק כמארז');
  assert.ok(json(c, 'rvAllDecided()'));
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('הוחלף · זוכה ✓'), 'תג השורה');
  assert.ok(html.includes('במקום: <span class="line-through text-slate-400">מילקי שוקולד( בודדים )</span>'), 'השורה אומרת מה היה כתוב');
  assert.ok(html.includes('data-role="rv-swap-undo" data-id="1"'), 'ואפשר לבטל');
  assert.match(json(c, 'testToasts.at(-1)'), /הוחלף ל: מארז 8 מילקי/);
});

test('בחירת מוצר אחר שאינו מארז — מהחיפוש — עובדת כמו ההצעה, ובחירה חוזרת של המקור היא ביטול', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', null)");
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-other');
  assert.equal(json(c, 'returnVerify.items[1].name'), 'מילקי וניל');
  assert.equal(json(c, 'returnVerify.items[1].orig.name'), 'מילקי שוקולד( בודדים )');
  // חילוף נוסף שומר על המקור הראשון, לא על הביניים
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-pack');
  assert.equal(json(c, 'returnVerify.items[1].name'), 'מארז 8 מילקי בטעם שוקולד');
  assert.equal(json(c, 'returnVerify.items[1].orig.name'), 'מילקי שוקולד( בודדים )', 'המקור הוא מה שנשלח, לא המוצר הקודם');
  // בחירת המקור מחדש = ביטול החילוף
  c.click('rv-swap', '1');
  typeSwap(c, '72940761');
  assert.ok(c.run("$('rvSwapList').innerHTML").includes('data-id="p-single"'), 'המקור נמצא בחיפוש לפי ברקוד');
  c.click('rv-swap-pick', 'p-single');
  const l = json(c, 'returnVerify.items[1]');
  assert.equal(l.name, 'מילקי שוקולד( בודדים )');
  assert.equal(l.unitPrice, 2.14);
  assert.equal(l.orig, null);
  assert.equal(c.run('rvRowState(returnVerify.items[1])'), 'full', 'בלי orig — שורה רגילה');
});

test('"בטל חילוף" מחזיר את המוצר והמחיר המקוריים', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-pack');
  c.click('rv-swap-undo', '1');
  const l = json(c, 'returnVerify.items[1]');
  assert.equal(l.productId, 'p-single');
  assert.equal(l.name, 'מילקי שוקולד( בודדים )');
  assert.equal(l.barcode, '72940761');
  assert.equal(l.unitPrice, 2.14);
  assert.equal(l.orig, null);
  assert.ok(!c.run("$('app').innerHTML").includes('הוחלף · זוכה'), 'התג ירד');
  assert.match(json(c, 'testToasts.at(-1)'), /החילוף בוטל/);
});

test('שמירה: השורה נכתבת עם המוצר החדש, מחירו, ה-productId ו-swappedFrom; סך התעודה מתעדכן ואין פער', async () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-yes', '0');
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-pack');
  await c.run('saveReturnVerify()');
  assert.deepEqual(json(c, 'testConfirms.map(x => x.title)'), [], 'הכל הוכרע ואין פער — אין מה לשאול');
  const writes = writesFor(c);
  assert.equal(writes.length, 1);
  const d = writes[0].data;
  assert.equal(d.creditStatus, 'ok');
  assert.equal(d.credited, true);
  assert.equal(d.creditNoteTotal, NOTE_WITH_PACK);
  assert.equal(d.totalExVat, NOTE_WITH_PACK, 'מה שהוחזר מחושב מחדש לפי המוצר שבאמת חזר');
  assert.deepEqual(d.items[0], { name: 'מילקי טופ עדשים', barcode: '7290110573751', qty: 9, unitPrice: 3.37, lineTotal: 30.33, productId: 'p-top' }, 'שורה רגילה שומרת גם productId (עד כה נשמט)');
  assert.deepEqual(d.items[1], {
    name: 'מארז 8 מילקי בטעם שוקולד', barcode: '7290104726712', qty: 1, unitPrice: 16.03, lineTotal: 16.03, productId: 'p-pack',
    swappedFrom: { name: 'מילקי שוקולד( בודדים )', barcode: '72940761', unitPrice: 2.14, productId: 'p-single' }
  });
  assert.ok(!('noteQty' in d.items[1]), 'שורה שהוחלפה זוכתה במלואה — אין noteQty');
  assert.equal(c.run('currentView'), 'receiptsHistory');
  assert.equal(json(c, 'returnsDiscrepancyInfo(returns[0]).open'), false, 'אין פער פתוח בכרטיס');
  // הכרטיס במסך התעודות אומר מה הוחלף
  const card = c.run('returnCardInReceipts(returns[0])');
  assert.ok(card.includes('מארז 8 מילקי בטעם שוקולד'), 'השורה בכרטיס היא המוצר שזוכה');
  assert.ok(card.includes('הוחלף באימות · במקום: מילקי שוקולד( בודדים )'), 'עם מה שהיה כתוב כשנשלחה');
});

test('תעודה שנשמרה עם חילוף נפתחת מחדש עם המקור — ואפשר לבטל גם אז', async () => {
  const c = setup({
    credited: true, creditedAt: Date.now(), creditStatus: 'ok', creditNoteTotal: NOTE_WITH_PACK, totalExVat: NOTE_WITH_PACK, totalIncVat: NOTE_WITH_PACK,
    items: [LINES[0], { productId: 'p-pack', name: 'מארז 8 מילקי בטעם שוקולד', barcode: '7290104726712', qty: 1, unitPrice: 16.03, lineTotal: 16.03, swappedFrom: { productId: 'p-single', name: 'מילקי שוקולד( בודדים )', barcode: '72940761', unitPrice: 2.14 } }]
  });
  c.run("openReturnVerify('ret-1', null)");
  assert.deepEqual(json(c, 'returnVerify.items.map(rvRowState)'), ['full', 'swap']);
  assert.equal(json(c, 'returnVerify.items[1].orig.name'), 'מילקי שוקולד( בודדים )');
  c.click('rv-swap-undo', '1');
  assert.equal(json(c, 'returnVerify.items[1].name'), 'מילקי שוקולד( בודדים )');
  assert.equal(json(c, 'returnVerify.items[1].unitPrice'), 2.14);
  assert.ok(Math.abs(json(c, 'rvGap()') - 13.89) < 0.01, 'בלי החילוף הפער חוזר: 46.36 − 32.47');
  c.click('rv-save');
  assert.equal(json(c, 'testConfirms.at(-1).title'), 'הספק זיכה ₪13.89 יותר', 'שואלים לפני שמירה עם פער');
  await c.run('saveReturnVerify({ skipChecked: true, skipGap: true })'); // מה שהאישור בחלון מריץ — "שמור כפתוחה"
  const d = writesFor(c).at(-1).data;
  assert.ok(!('swappedFrom' in d.items[1]), 'אחרי ביטול אין swappedFrom');
  assert.equal(d.items[1].productId, 'p-single');
  assert.equal(d.creditStatus, 'open');
});

test('שורה שהוחלפה ואז הוכרעה חלקית נשארת עם המוצר החדש ועם המקור — רק המצב משתנה', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-swap', '1');
  c.click('rv-swap-pick', 'p-pack');
  c.click('rv-no', '1');
  assert.equal(c.run('rvRowState(returnVerify.items[1])'), 'none');
  assert.equal(json(c, 'returnVerify.items[1].name'), 'מארז 8 מילקי בטעם שוקולד');
  assert.equal(json(c, 'returnVerify.items[1].orig.name'), 'מילקי שוקולד( בודדים )');
  c.click('rv-yes', '1');
  assert.equal(c.run('rvRowState(returnVerify.items[1])'), 'swap');
});

test('מוצר בלי מארז מוגדר — אין הצעה, נשאר החיפוש; מארז מציע את הבודד שלו', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', null)");
  c.click('rv-swap', '0');
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('data-rvswap="0"') && html.includes('id="rvSwapSearch"'));
  assert.ok(!html.includes('המארז של המוצר') && !html.includes('הבודד של המארז'), 'למילקי טופ אין מארז מוגדר');
  // שורה של מארז מציעה את הבודד
  c.run("returnVerify.items[0] = { productId: 'p-pack', name: 'מארז 8 מילקי בטעם שוקולד', barcode: '7290104726712', qty: 2, noteQty: 2, unitPrice: 16.03, isDeposit: false, orig: null, checked: false }");
  c.click('rv-swap', '0');
  assert.ok(c.run("$('app').innerHTML").includes('הבודד של המארז'), 'ההצעה ההפוכה');
  assert.ok(c.run("$('app').innerHTML").includes('data-role="rv-swap-pick" data-id="p-single"'));
});
