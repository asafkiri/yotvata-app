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

test('לחיצה על חילוף פותחת בוחר בתוך השורה: פריט החזרות הכללי עם מחיר, וחיפוש — בלי הצעת מארז (v381)', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', " + NOTE_WITH_PACK + ")");
  c.click('rv-swap', '1');
  assert.equal(json(c, 'returnVerify.swapIdx'), 1);
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('data-rvswap="1"'), 'הבוחר נפתח בשורת המילקי');
  assert.ok(!html.includes('data-rvswap="0"'), 'ולא בשורה אחרת');
  // v381: חילוף הוא יחידה ביחידה — בודד אחד אינו הופך לשמינייה, ולכן המארז אינו מוצע מעצמו
  assert.ok(!html.includes('data-role="rv-swap-pick" data-id="p-pack"'), 'המארז של הבודד אינו מוצע אוטומטית');
  assert.ok(!html.includes('המארז של המוצר'), 'אין טקסט הצעת מארז');
  assert.ok(html.includes('data-role="rv-swap-generic" data-id="1"') && html.includes('id="rvSwapGenPrice"'), 'פריט החזרות הכללי עם שדה מחיר');
  assert.ok(html.includes('value="2.14"'), 'המחיר בשדה מתחיל ממחיר השורה');
  assert.ok(html.includes('יחידה במקום יחידה'), 'ההסבר אומר שהחילוף הוא יחידה ביחידה');
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

// ===== v381: פריט החזרות הכללי =====
// מהנייר של 3.10: שוקו שקית (7290000042855) זוכה כ"*פריט החזרות*" ב-₪1.96 במקום
// ₪1.99 — אותו ברקוד, שם כללי, מחיר שהנהג קבע.

const SHOKO = { productId: 'p-shoko', name: 'שוקו שקית(בודד)', barcode: '7290000042855', qty: 1, unitPrice: 1.99, lineTotal: 1.99 };
function setupShoko(extra) {
  const c = setup(Object.assign({ items: [LINES[0], SHOKO], totalExVat: 32.32, totalIncVat: 32.32 }, extra || {}));
  c.run("products.push({ id: 'p-shoko', name: 'שוקו שקית(בודד)', barcode: '7290000042855', price: 1.99 })");
  return c;
}

test('פריט החזרות כללי: הברקוד נשאר, השם הופך לכללי, המחיר מהנייר — והפער נסגר', async () => {
  const c = setupShoko();
  c.run("openReturnVerify('ret-1', 32.29)"); // 30.33 + 1.96
  c.click('rv-yes', '0');
  c.click('rv-swap', '1');
  c.run("$('rvSwapGenPrice').value = '1.96'");
  c.click('rv-swap-generic', '1');
  const l = json(c, 'returnVerify.items[1]');
  assert.equal(l.name, 'פריט החזרות');
  assert.equal(l.barcode, '7290000042855', 'הברקוד נשאר כמו בנייר');
  assert.equal(l.productId, '', 'אין מוצר מהקטלוג');
  assert.equal(l.unitPrice, 1.96);
  assert.equal(l.qty, 1); assert.equal(l.noteQty, 1); assert.equal(l.checked, true);
  assert.deepEqual(l.orig, { productId: 'p-shoko', name: 'שוקו שקית(בודד)', barcode: '7290000042855', unitPrice: 1.99, isDeposit: false });
  assert.equal(c.run('rvRowState(returnVerify.items[1])'), 'swap');
  assert.equal(json(c, 'rvGap()'), 0, 'הנייר מוסבר במלואו');
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('במקום: <span class="line-through text-slate-400">שוקו שקית(בודד)</span>'));
  // שורה שכבר כללית אינה מציעה שוב "פריט החזרות" בבוחר
  c.click('rv-swap', '1');
  assert.ok(!c.run("$('app').innerHTML").includes('rv-swap-generic'), 'אין פריט החזרות על פריט החזרות');
  c.click('rv-swap-cancel');
  await c.run('saveReturnVerify()');
  const d = writesFor(c).at(-1).data;
  assert.equal(d.creditStatus, 'ok');
  assert.deepEqual(d.items[1], { name: 'פריט החזרות', barcode: '7290000042855', qty: 1, unitPrice: 1.96, lineTotal: 1.96, swappedFrom: { name: 'שוקו שקית(בודד)', barcode: '7290000042855', unitPrice: 1.99, productId: 'p-shoko' } });
  assert.equal(d.totalExVat, 32.29);
  assert.ok(c.run('returnCardInReceipts(returns[0])').includes('הוחלף באימות · במקום: שוקו שקית(בודד)'));
});

test('פריט החזרות בלי מחיר — לא מחליפים, מבקשים את המחיר מהנייר; "בטל חילוף" מחזיר את השוקו', () => {
  const c = setupShoko();
  c.run("openReturnVerify('ret-1', null)");
  c.click('rv-swap', '1');
  c.run("$('rvSwapGenPrice').value = ''");
  c.click('rv-swap-generic', '1');
  assert.equal(json(c, 'returnVerify.items[1].name'), 'שוקו שקית(בודד)', 'לא הוחלף');
  assert.equal(json(c, 'returnVerify.swapIdx'), 1, 'הבוחר נשאר פתוח');
  assert.match(json(c, 'testToasts.at(-1)'), /הקלד את המחיר/);
  c.run("$('rvSwapGenPrice').value = '1,96'");
  c.click('rv-swap-generic', '1');
  assert.equal(json(c, 'returnVerify.items[1].unitPrice'), 1.96, 'פסיק עשרוני מתקבל');
  c.click('rv-swap-undo', '1');
  const l = json(c, 'returnVerify.items[1]');
  assert.equal(l.name, 'שוקו שקית(בודד)'); assert.equal(l.productId, 'p-shoko'); assert.equal(l.unitPrice, 1.99); assert.equal(l.orig, null);
});

// ===== v381: הוספת מוצר שלא נרשם =====

test('כרטיס "הספק זיכה מוצר שלא רשמנו" בתחתית המסך: חיפוש מהקטלוג ופריט החזרות הכללי', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', null)");
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('id="rvAddBox"') && html.includes('id="rvAddSearch"') && html.includes('id="rvAddList"'));
  assert.ok(html.includes('data-role="rv-add-generic"') && html.includes('id="rvAddGenPrice"'));
  assert.ok(html.includes('אם הספק פשוט זיכה יותר מדי, אל תוסיף'), 'ההבדל מ"זיכה יותר" נאמר');
  c.events.get('app:input')({ target: { id: 'rvAddSearch', value: 'וניל', dataset: {}, closest: () => null } });
  const list = c.run("$('rvAddList').innerHTML");
  assert.ok(list.includes('data-role="rv-add-pick" data-id="p-other"'), 'תוצאת חיפוש היא כפתור הוספה');
  assert.ok(!list.includes('data-id="p-top"') && !list.includes('data-id="p-single"'), 'מוצרים שכבר בתעודה אינם מוצעים');
  assert.equal(json(c, 'returnVerify.addQuery'), 'וניל');
});

test('הוספת מוצר מהקטלוג: שורה חדשה בכמות 1 במחיר הזיכוי, מסומנת "נוסף באימות"; החיצים מזיזים הוחזר וזוכה יחד', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', 36.75)"); // 30.33 + 2.14 + 2 × 2.14 מילקי וניל שלא נרשם
  c.click('rv-yes', '0'); c.click('rv-yes', '1');
  assert.ok(Math.abs(json(c, 'rvGap()') - 4.28) < 0.01, 'לפני ההוספה הנייר גדול ב-₪4.28');
  c.click('rv-add-pick', 'p-other');
  let items = json(c, 'returnVerify.items');
  assert.equal(items.length, 3);
  const a = items[2];
  assert.equal(a.productId, 'p-other'); assert.equal(a.name, 'מילקי וניל'); assert.equal(a.barcode, '72940754');
  assert.equal(a.qty, 1); assert.equal(a.noteQty, 1); assert.equal(a.unitPrice, 2.14); assert.equal(a.added, true); assert.equal(a.checked, true);
  assert.equal(c.run('rvRowState(returnVerify.items[2])'), 'added');
  const html = c.run("$('app').innerHTML");
  assert.ok(html.includes('נוסף באימות ✓') && html.includes('data-role="rv-added-remove" data-id="2"'), 'תג והסרה');
  assert.ok(!html.includes('data-role="rv-yes" data-id="2"') && !html.includes('data-role="rv-swap" data-id="2"'), 'בשורה שנוספה אין הכרעה או חילוף — היא לפי הנייר');
  assert.equal(json(c, 'returnVerify.addQuery'), '', 'החיפוש התנקה');
  // חץ + משנה גם את מה שהוחזר
  c.click('rv-plus', '2');
  items = json(c, 'returnVerify.items');
  assert.equal(items[2].qty, 2); assert.equal(items[2].noteQty, 2);
  assert.equal(json(c, 'rvGap()'), 0, 'הנייר מוסבר');
  // הקלדה ישירה
  c.events.get('app:input')({ target: { dataset: { role: 'rv-note', id: '2' }, value: '3', getAttribute: n => n === 'data-role' ? 'rv-note' : null, closest: () => null } });
  items = json(c, 'returnVerify.items');
  assert.equal(items[2].qty, 3); assert.equal(items[2].noteQty, 3);
  // שורה רגילה: החיצים אינם נוגעים ב"הוחזר"
  c.click('rv-minus', '0');
  items = json(c, 'returnVerify.items');
  assert.equal(items[0].qty, 9); assert.equal(items[0].noteQty, 8);
});

test('הסרת שורה שנוספה לפני השמירה', () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', null)");
  c.click('rv-add-pick', 'p-other');
  c.click('rv-added-remove', '2');
  assert.equal(json(c, 'returnVerify.items.length'), 2);
  // שורה מקורית אינה ניתנת להסרה בדרך הזאת
  c.click('rv-added-remove', '0');
  assert.equal(json(c, 'returnVerify.items.length'), 2);
});

test('שמירה עם שורה שנוספה: addedAtVerify, הסכום שהוחזר גדל, הכרטיס מסמן; בפתיחה מחדש היא שורה רגילה שעדיין מסומנת', async () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', 36.75)");
  c.click('rv-yes', '0'); c.click('rv-yes', '1');
  c.click('rv-add-pick', 'p-other');
  c.click('rv-plus', '2');
  await c.run('saveReturnVerify()');
  assert.deepEqual(json(c, 'testConfirms.map(x => x.title)'), []);
  const d = writesFor(c).at(-1).data;
  assert.equal(d.creditStatus, 'ok');
  assert.equal(d.totalExVat, 36.75);
  assert.deepEqual(d.items[2], { name: 'מילקי וניל', barcode: '72940754', qty: 2, unitPrice: 2.14, lineTotal: 4.28, productId: 'p-other', addedAtVerify: true });
  assert.ok(c.run('returnCardInReceipts(returns[0])').includes('נוסף באימות · לא היה בתעודה שנשלחה'));
  c.run("openReturnVerify('ret-1', null)");
  assert.deepEqual(json(c, 'returnVerify.items.map(rvRowState)'), ['full', 'full', 'full'], 'בפתיחה מחדש השורה היא שורה רגילה עם הכרעה');
  assert.equal(json(c, 'returnVerify.items[2].addedAtVerify'), true);
  c.click('rv-no', '2');
  await c.run('saveReturnVerify({ skipGap: true })');
  const d2 = writesFor(c).at(-1).data;
  assert.equal(d2.items[2].addedAtVerify, true, 'הסימון נשאר גם אחרי אימות נוסף');
  assert.equal(d2.items[2].noteQty, 0);
});

test('הוספת פריט החזרות כללי: בלי מוצר ובלי ברקוד, במחיר מהנייר; בלי מחיר לא נוסף', async () => {
  const c = setup();
  c.run("openReturnVerify('ret-1', null)");
  c.run("$('rvAddGenPrice').value = ''");
  c.click('rv-add-generic');
  assert.equal(json(c, 'returnVerify.items.length'), 2);
  assert.match(json(c, 'testToasts.at(-1)'), /הקלד את המחיר/);
  c.run("$('rvAddGenPrice').value = '1.96'");
  c.click('rv-add-generic');
  c.click('rv-yes', '0'); c.click('rv-yes', '1');
  const a = json(c, 'returnVerify.items[2]');
  assert.equal(a.name, 'פריט החזרות'); assert.equal(a.productId, ''); assert.equal(a.barcode, ''); assert.equal(a.unitPrice, 1.96); assert.equal(a.qty, 1); assert.equal(a.added, true);
  await c.run('saveReturnVerify()');
  const d = writesFor(c).at(-1).data;
  assert.deepEqual(d.items[2], { name: 'פריט החזרות', barcode: '', qty: 1, unitPrice: 1.96, lineTotal: 1.96, addedAtVerify: true });
  assert.equal(d.totalExVat, 34.43);
});
