import {attachReturns,settle} from './returns-events-harness.mjs';
// v371: אישור תעודת זיכוי בלחיצה אחת — כמו בברמן (v80 שם).
// המצב הרגיל הוא שהספק זיכה בדיוק את מה שהוחזר. עד כה זה חייב הקלדה של מספר
// שהאפליקציה כבר יודעת ומציגה בראש הכרטיס; עכשיו "אישור" ליד "בדוק" רושם את
// אותו סכום ומגיע לאותו markReturnVerified. הבדיקה מריצה את מודול האפליקציה
// המלא ולוחצת על הכפתורים עצמם.
//
// הרצה: node --test tools/return-approve.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const SUPPLIER = 'yotvata';
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));

// תעודת חזרות שנשלחה ועדיין לא אומתה: 4 × 7.42 + 2 × 4.60 = 38.88 ללא מע״מ
const LINES = [
  { productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 4, unitPrice: 7.42, lineTotal: 29.68 },
  { productId: 'p-cottage', name: 'קוטג׳ בדיקה', barcode: '7290000000015', qty: 2, unitPrice: 4.6, lineTotal: 9.2 }
];
const SENT_EX = 38.88;

function setup(extra) {
  const c = runtime(SUPPLIER);
  c.context.testConfirms = [];
  const ret = Object.assign({
    id: 'ret-1', timestamp: Date.UTC(2026, 8, 26, 17, 35), date: '2026-09-26', docDate: '2026-09-26', sentTo: 'קבוצה בוואטסאפ',
    items: LINES, totalExVat: SENT_EX, totalIncVat: SENT_EX, credited: false
  }, extra || {});
  c.run(`
    products = [
      { id: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', price: 7.42 },
      { id: 'p-cottage', name: 'קוטג׳ בדיקה', barcode: '7290000000015', price: 4.6 }
    ];
    returns = [${JSON.stringify(ret)}];
    receipts = []; receiptsHistoryFilter = 'all';
    currentView = 'receiptsHistory'; // v378: היסטוריית החזרות חיה בתוך מסך התעודות המאוחד
    showConfirm = (title, msg, okText, cb) => { testConfirms.push({ title, msg, okText, cb }); };
  `);
  return c;
}
const writesFor = c => json(c, "testWrites.filter(w => w.op === 'update' && String(w.path).indexOf('ret-1') > -1)");
const withoutTime = data => { const d = Object.assign({}, data); delete d.creditedAt; return d; };

test('כרטיס שטרם אומת מציע "אישור" לצד "בדוק" — במסך התעודות המאוחד ובכרטיס עצמו, עם הסכום מראש', () => {
  const c = setup();
  const money = c.run('fmtMoney(' + SENT_EX + ')');
  c.run('renderReceiptsHistory()');
  const history = c.run("$('app').innerHTML");
  const receipts = c.run('returnCardInReceipts(returns[0])');
  for (const [where, html] of [['היסטוריית תעודות', history], ['כרטיס', receipts]]) {
    assert.ok(html.includes('data-role="rv-approve" data-id="ret-1"'), where + ': כפתור האישור קיים');
    assert.ok(html.includes('data-role="rv-verify-inline" data-id="ret-1"'), where + ': ההקלדה נשארת לצידו');
    assert.ok(html.includes('id="rvNote_ret-1"'), where + ': שדה הסכום נשאר');
    assert.ok(html.includes('או אשר שהוא בדיוק ₪' + money), where + ': הסכום לאישור נאמר מראש');
  }
  // שורת האימות נבנית בפונקציה אחת — שתי הגרסאות זהות, מלבד המרווח העליון בכרטיס התעודות
  assert.equal(c.run('retVerifyRowHtml(returns[0])').replace(' mb-2"', '"'), c.run('retVerifyRowHtml(returns[0], true)').replace('font-bold mt-2 mb-1.5', 'font-bold mb-1.5'));
  assert.ok(c.run('returnCardInReceipts(returns[0])').includes('font-bold mt-2 mb-1.5'), 'המרווח העליון בכרטיס התעודות נשמר');
});

test('תעודה מאומתת אינה מציעה אישור', () => {
  const c = setup({ credited: true, creditedAt: Date.now(), creditNoteTotal: SENT_EX, creditStatus: 'ok' });
  c.run('renderReceiptsHistory()');
  assert.ok(!c.run("$('app').innerHTML").includes('rv-approve'));
  assert.ok(!c.run('returnCardInReceipts(returns[0])').includes('rv-approve'));
  c.click('rv-approve', 'ret-1');
  assert.equal(json(c, 'testConfirms.length'), 0, 'לחיצה ישנה על תעודה שכבר אומתה אינה פותחת חלון');
  assert.equal(writesFor(c).length, 0);
});

test('"אישור" רושם בדיוק את מה שהוחזר וסוגר את התעודה בלי פער', () => {
  const c = setup();
  c.click('rv-approve', 'ret-1');
  const confirm = json(c, 'testConfirms.map(x => ({ title: x.title, msg: x.msg, okText: x.okText }))');
  assert.equal(confirm.length, 1, 'שואלים לפני שסוגרים');
  assert.equal(confirm[0].title, 'אישור תעודת זיכוי');
  assert.ok(confirm[0].msg.includes('₪' + c.run('fmtMoney(' + SENT_EX + ')')), 'החלון אומר את הסכום שיירשם');
  assert.equal(writesFor(c).length, 0, 'עד שלא אישרו — לא נכתב דבר');

  c.run('testConfirms[0].cb()');
  const writes = writesFor(c);
  assert.equal(writes.length, 1);
  assert.deepEqual(withoutTime(writes[0].data), { credited: true, creditNoteTotal: SENT_EX, creditStatus: 'ok' });
  const r = json(c, 'returns[0]');
  assert.equal(r.credited, true);
  assert.equal(r.creditNoteTotal, SENT_EX);
  assert.equal(r.creditStatus, 'ok');
  assert.equal(json(c, 'returnsBalance().bal'), 0, 'אין חוב זיכוי פתוח');
  c.run('renderReceiptsHistory()');
  assert.ok(c.run("$('app').innerHTML").includes('<i class="fa-solid fa-circle-check"></i> אומתה'), 'הכרטיס עובר לירוק');
});

test('אישור זהה לחלוטין להקלדה ידנית של אותו סכום', () => {
  const approved = setup();
  approved.click('rv-approve', 'ret-1');
  approved.run('testConfirms[0].cb()');

  const typed = setup();
  typed.run("$('rvNote_ret-1').value = '" + SENT_EX + "'");
  typed.click('rv-verify-inline', 'ret-1');

  const a = writesFor(approved), t = writesFor(typed);
  assert.equal(a.length, 1); assert.equal(t.length, 1);
  assert.deepEqual(a[0].path, t[0].path);
  assert.deepEqual(withoutTime(a[0].data), withoutTime(t[0].data));
  const strip = r => { const x = Object.assign({}, r); delete x.creditedAt; return x; };
  assert.deepEqual(strip(json(approved, 'returns[0]')), strip(json(typed, 'returns[0]')));
});

test('תעודה בלי סכום — אין מה לאשר, נשארת הקלדה בלבד', () => {
  const c = setup({ totalExVat: 0, totalIncVat: 0 });
  const html = c.run('retVerifyRowHtml(returns[0])');
  assert.ok(!html.includes('rv-approve'), 'אין כפתור אישור ל-₪0');
  assert.ok(html.includes('rv-verify-inline') && html.includes('כדי לאמת'), 'ההקלדה והנוסח הרגיל נשארים');
  c.click('rv-approve', 'ret-1');
  assert.equal(json(c, 'testConfirms.length'), 0);
  assert.equal(writesFor(c).length, 0);
  assert.match(json(c, 'testToasts.at(-1)'), /הקלד את סכום תעודת הזיכוי/);
});

test('התעודה השתנתה בזמן שהחלון פתוח — האישור עובר במסלול של "בדוק", לא נסגר עם פער', () => {
  const c = setup();
  c.click('rv-approve', 'ret-1');
  // עריכה ממכשיר אחר: נוספה שורה, ומה שהוחזר גדל ב-₪5
  c.run('returns[0].totalExVat = returns[0].totalIncVat = ' + (SENT_EX + 5));
  c.run('testConfirms[0].cb()');
  assert.equal(writesFor(c).length, 0, 'לא נרשם כתעודה סגורה בלי פער');
  assert.equal(c.run('currentView'), 'returnReconcile', 'נפתח מסך ההתאמה');
  assert.equal(json(c, 'returnVerify.noteTotal'), SENT_EX, 'עם הסכום שאושר כסכום הנייר');
});

test('שינוי של עד שקל — כמו בהקלדה, נרשם הסכום שאושר', () => {
  const c = setup();
  c.click('rv-approve', 'ret-1');
  c.run('returns[0].totalExVat = returns[0].totalIncVat = ' + (SENT_EX + 0.5));
  c.run('testConfirms[0].cb()');
  const writes = writesFor(c);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.creditNoteTotal, SENT_EX);
});

test('התעודה אומתה ממכשיר אחר בזמן שהחלון פתוח — האישור אינו כותב שוב', () => {
  const c = setup();
  c.click('rv-approve', 'ret-1');
  c.run('returns[0].credited = true');
  c.run('testConfirms[0].cb()');
  assert.equal(writesFor(c).length, 0);
});

// ===== ממצאי הביקורת על "אישור" =====

test('סכום שכבר הוקלד בשדה — "אישור" מגיש אותו כמו "בדוק", ולא את סך התעודה', () => {
  // תואם: נסגר עם הסכום שהוקלד, בלי חלון נוסף
  const same = setup();
  same.run("$('rvNote_ret-1').value = '38.50'");
  same.click('rv-approve', 'ret-1');
  assert.equal(json(same, 'testConfirms.length'), 0, 'אין חלון "זיכה בדיוק" על סכום אחר');
  const w = writesFor(same);
  assert.equal(w.length, 1);
  assert.equal(w[0].data.creditNoteTotal, 38.5, 'נרשם הסכום שהוקלד, לא ' + SENT_EX);

  // לא תואם: מסך ההתאמה עם הסכום שהוקלד — בדיוק כמו "בדוק"
  const short = setup();
  short.run("$('rvNote_ret-1').value = '35'");
  short.click('rv-approve', 'ret-1');
  assert.equal(json(short, 'testConfirms.length'), 0);
  assert.equal(writesFor(short).length, 0, 'התעודה לא נסגרה כ"בלי פער"');
  assert.equal(short.run('currentView'), 'returnReconcile');
  assert.equal(json(short, 'returnVerify.noteTotal'), 35);

  const typed = setup();
  typed.run("$('rvNote_ret-1').value = '35'");
  typed.click('rv-verify-inline', 'ret-1');
  assert.equal(typed.run('currentView'), 'returnReconcile', '"בדוק" עם אותו סכום מגיע לאותו מקום');
  assert.equal(json(typed, 'returnVerify.noteTotal'), 35);
});

test('שורה בלי מחיר — הסכום אינו "כל מה שהוחזר", ולכן אין אישור מהיר', () => {
  const c = setup({ items: LINES.concat([{ productId: 'p-free', name: 'מוצר בלי מחיר', barcode: '7290000000022', qty: 3, unitPrice: 0, lineTotal: 0 }]) });
  const html = c.run('retVerifyRowHtml(returns[0])');
  assert.ok(!html.includes('rv-approve'), 'אין כפתור אישור');
  assert.ok(html.includes('rv-verify-inline') && html.includes('כדי לאמת'), 'ההקלדה והנוסח הרגיל נשארים');
  c.click('rv-approve', 'ret-1');
  assert.equal(json(c, 'testConfirms.length'), 0, 'גם לחיצה ישנה אינה פותחת חלון');
  assert.equal(writesFor(c).length, 0);
  assert.match(json(c, 'testToasts.at(-1)'), /הקלד את סכום תעודת הזיכוי/);
  // שורת פיקדון ושורה בכמות אפס אינן חוסמות
  const dep = setup({ items: LINES.concat([{ name: 'פיקדון · בקבוק', barcode: '', qty: 4, unitPrice: 0, lineTotal: 0, isDeposit: true }, { name: 'שורה ריקה', qty: 0, unitPrice: 0 }]) });
  assert.ok(dep.run('retVerifyRowHtml(returns[0])').includes('rv-approve'));
});

test('שדה הסכום נשאר 16px — אחרת האייפון עושה זום כשנוגעים בו', () => {
  const c = setup();
  for (const html of [c.run('retVerifyRowHtml(returns[0])'), c.run('retVerifyRowHtml(returns[0], true)')]) {
    const input = html.match(/<input id="rvNote_ret-1"[^>]*>/);
    assert.ok(input, 'שדה הסכום קיים');
    assert.match(input[0], /\btext-base\b/);
    assert.doesNotMatch(input[0], /\btext-sm\b/);
  }
});

test('התעודה השתנתה או אומתה בזמן שהחלון פתוח — המשתמש שומע על זה', () => {
  const changed = setup();
  changed.click('rv-approve', 'ret-1');
  changed.run('returns[0].totalExVat = returns[0].totalIncVat = ' + (SENT_EX + 5));
  changed.run('testConfirms[0].cb()');
  assert.match(json(changed, 'testToasts.at(-1)'), /השתנתה בזמן האישור/);

  const gone = setup();
  gone.click('rv-approve', 'ret-1');
  gone.run('returns = []');
  gone.run('testConfirms[0].cb()');
  assert.equal(writesFor(gone).length, 0);
  assert.match(json(gone, 'testToasts.at(-1)'), /כבר אומתה או הוסרה/);
});

test('תעודה שנפתחה מחדש אחרי אימות עם פער — האישור מנקה את כמויות הזיכוי הישנות בשורות', () => {
  // אומתה קודם עם פער (הספק זיכה 3 מתוך 4), ואז "בטל אימות". השורה עדיין נושאת
  // noteQty=3 שאינו נראה בכרטיס הפתוח; אילו נשאר, עריכת פריטים מאוחרת הייתה
  // מחשבת ממנו פער מחדש בתעודה שנסגרה "בלי פער".
  const items = [Object.assign({}, LINES[0], { noteQty: 3 }), LINES[1]];
  const c = setup({ items });
  c.click('rv-approve', 'ret-1');
  c.run('testConfirms[0].cb()');
  const w = writesFor(c);
  assert.equal(w.length, 1);
  assert.equal(w[0].data.creditStatus, 'ok');
  assert.ok(Array.isArray(w[0].data.items) && w[0].data.items.every(l => !('noteQty' in l)), 'השורות נשמרות בענן בלי noteQty');
  assert.deepEqual(w[0].data.items.map(l => [l.name, l.qty, l.unitPrice]), LINES.map(l => [l.name, l.qty, l.unitPrice]), 'ושום דבר אחר בשורות לא זז');
  assert.ok(json(c, 'returns[0].items').every(l => !('noteQty' in l)), 'וגם בזיכרון');
  assert.equal(json(c, 'returnsDiscrepancyInfo(returns[0]).shortItems.length'), 0, 'אין "זוכה חסר"');

  // תעודה רגילה (בלי noteQty) — לא כותבים את השורות בכלל
  const plain = setup();
  plain.click('rv-approve', 'ret-1');
  plain.run('testConfirms[0].cb()');
  assert.ok(!('items' in writesFor(plain)[0].data));
});

test('פער שהועבר לרשימת החזרות ואז התעודה נפתחה מחדש ואושרה — הפער יורד מהרשימה', async () => {
  // אימות עם פער: הספק זיכה 3 מתוך 4 חלב (₪7.42 חסר) → "העבר לחזרות" →
  // "בטל אימות" → "אישור" על הסכום המלא. הספק זיכה הכל, ולכן אותה יחידה
  // אסור שתיתבע שוב בתעודת החזרות הבאה.
  const items = [Object.assign({}, LINES[0], { noteQty: 3 }), LINES[1]];
  const c = setup({ items, credited: true, creditedAt: Date.now(), creditNoteTotal: 31.46, creditStatus: 'open' });
  c.run('returnsList = []; refreshReturnsList = () => {}; updateCart = () => {};');
  const engine=await attachReturns(c);
  c.click('ret-carry', 'ret-1');
  await c.run('testConfirms.at(-1).cb()');
  assert.equal(json(c, 'returnsList.filter(it => it.carriedFrom === "ret-1").length'), 1, 'הפער נכנס לרשימה');
  c.click('uncredit', 'ret-1');
  await c.run('testConfirms.at(-1).cb()');
  assert.equal(c.run('returns[0].credited'), false);

  c.click('rv-approve', 'ret-1');
  c.run('testConfirms.at(-1).cb()');
  await settle(); // השמירה וביטול ההעברה אסינכרוניים
  const r = json(c, 'returns[0]');
  assert.equal(r.credited, true); assert.equal(r.creditStatus, 'ok'); assert.equal(r.creditNoteTotal, SENT_EX);
  assert.equal(json(c, 'returnsList.filter(it => it.carriedFrom === "ret-1").length'), 0, 'הפער ירד מרשימת החזרות');
  assert.deepEqual(r.carriedNotes, [], 'והתעודה כבר לא מסמנת פער שהועבר');
  assert.ok(json(c, 'testWrites.some(w => w.data && Array.isArray(w.data.carriedNotes) && w.data.carriedNotes.length === 0)'), 'גם בענן');
  assert.match(json(c, 'testToasts.at(-1)'), /הפער ירד גם מרשימת החזרות/);engine.stop();
});

// ===== חורים שבדיקת המוטציות מצאה =====

test('תעודה בלי סכומים שמורים — האישור רושם את מה שהכרטיס מציג, ללא מע״מ', () => {
  // רק שורות, בלי totalExVat/totalIncVat: returnTotals מחשב מהשורות. האישור חייב
  // לרשום את אותו מספר (ללא מע״מ), לא את הכולל מע״מ ולא 0.
  const c = setup({ totalExVat: undefined, totalIncVat: undefined });
  c.run('delete returns[0].totalExVat; delete returns[0].totalIncVat;');
  assert.equal(json(c, 'returnTotals(returns[0]).ex'), SENT_EX);
  assert.ok(c.run('retVerifyRowHtml(returns[0])').includes('rv-approve'), 'האישור מוצע');
  c.click('rv-approve', 'ret-1');
  c.run('testConfirms[0].cb()');
  assert.equal(writesFor(c)[0].data.creditNoteTotal, SENT_EX);
});

test('גבול השקל — כמו "בדוק": עד שקל נסגר, מעל שקל מסך ההתאמה', () => {
  for (const [delta, closes] of [[0.99, true], [-0.99, true], [1.01, false], [-1.01, false]]) {
    const c = setup();
    c.click('rv-approve', 'ret-1');
    c.run('returns[0].totalExVat = returns[0].totalIncVat = ' + Math.round((SENT_EX + delta) * 100) / 100);
    c.run('testConfirms[0].cb()');
    assert.equal(writesFor(c).length, closes ? 1 : 0, 'שינוי של ' + delta);
    if (!closes) assert.equal(c.run('currentView'), 'returnReconcile', 'שינוי של ' + delta);
  }
});

test('לחיצה ישנה על תעודה שנמחקה במכשיר אחר — לא קורס ולא פותח חלון', () => {
  const c = setup();
  c.run('returns = []');
  assert.doesNotThrow(() => c.click('rv-approve', 'ret-1'));
  assert.equal(json(c, 'testConfirms.length'), 0);
  assert.equal(writesFor(c).length, 0);
});

test('המרווחים של כל גרסה נשמרו', () => {
  const c = setup();
  const history = c.run('retVerifyRowHtml(returns[0])');
  const receipts = c.run('retVerifyRowHtml(returns[0], true)');
  assert.ok(history.includes('font-bold mb-1.5"') && history.includes('items-stretch mb-2"'), 'גרסת ההיסטוריה: בלי מרווח עליון, עם מרווח תחתון');
  assert.ok(receipts.includes('font-bold mt-2 mb-1.5"') && receipts.includes('items-stretch"'), 'כרטיס התעודות: מרווח עליון, בלי תחתון');
  // v378: מסך התעודות המאוחד הוא המסך היחיד — הוא בונה את השורה בגרסת הכרטיס
  c.run('renderReceiptsHistory()');
  const screen = c.run("$('app').innerHTML");
  assert.ok(screen.includes('font-bold mt-2 mb-1.5"'), 'מסך התעודות בונה את השורה בגרסת הכרטיס');
  assert.ok(!screen.includes('items-stretch mb-2"'), 'ולא בגרסת ההיסטוריה הישנה');
});
