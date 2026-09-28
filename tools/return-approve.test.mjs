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
    currentView = 'returnsHistory';
    showConfirm = (title, msg, okText, cb) => { testConfirms.push({ title, msg, okText, cb }); };
  `);
  return c;
}
const writesFor = c => json(c, "testWrites.filter(w => w.op === 'update' && String(w.path).indexOf('ret-1') > -1)");
const withoutTime = data => { const d = Object.assign({}, data); delete d.creditedAt; return d; };

test('כרטיס שטרם אומת מציע "אישור" לצד "בדוק" — בשני המסכים, עם הסכום מראש', () => {
  const c = setup();
  const money = c.run('fmtMoney(' + SENT_EX + ')');
  c.run('renderReturnsHistory()');
  const history = c.run("$('app').innerHTML");
  const receipts = c.run('returnCardInReceipts(returns[0])');
  for (const [where, html] of [['היסטוריית חזרות', history], ['תעודות', receipts]]) {
    assert.ok(html.includes('data-role="rv-approve" data-id="ret-1"'), where + ': כפתור האישור קיים');
    assert.ok(html.includes('data-role="rv-verify-inline" data-id="ret-1"'), where + ': ההקלדה נשארת לצידו');
    assert.ok(html.includes('id="rvNote_ret-1"'), where + ': שדה הסכום נשאר');
    assert.ok(html.includes('או אשר שהוא בדיוק ₪' + money), where + ': הסכום לאישור נאמר מראש');
  }
  // שורת האימות נבנית בפונקציה אחת — שני המסכים זהים, מלבד המרווח העליון בכרטיס התעודות
  assert.equal(c.run('retVerifyRowHtml(returns[0])').replace(' mb-2"', '"'), c.run('retVerifyRowHtml(returns[0], true)').replace('font-bold mt-2 mb-1.5', 'font-bold mb-1.5'));
  assert.ok(c.run('returnCardInReceipts(returns[0])').includes('font-bold mt-2 mb-1.5'), 'המרווח העליון בכרטיס התעודות נשמר');
});

test('תעודה מאומתת אינה מציעה אישור', () => {
  const c = setup({ credited: true, creditedAt: Date.now(), creditNoteTotal: SENT_EX, creditStatus: 'ok' });
  c.run('renderReturnsHistory()');
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
  c.run('renderReturnsHistory()');
  assert.ok(c.run("$('app').innerHTML").includes('הזיכוי אומת'), 'הכרטיס עובר לירוק');
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
