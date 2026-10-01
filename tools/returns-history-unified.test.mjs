// v378: היסטוריית החזרות אוחדה לתוך מסך התעודות — מסך אחד לכל התעודות, קליטות וחזרות.
// עד כה היו שני מסכי היסטוריה: "היסטוריית חזרות" (תעודות חזרה בלבד) ו"תעודות"
// (קליטות וחזרות יחד). מעכשיו כל כניסה ל"היסטוריית חזרות" — setView הישן, הכפתור
// בלשונית החזרות, הבאנר האדום של תעודות לאימות, באנר הפערים — נוחתת במסך התעודות
// המאוחד, והכרטיס של תעודת החזרה שם מציע כל מה שהמסך הישן הציע: אימות, אישור,
// שליחה חוזרת, החזרה לרשימה הפתוחה, עריכה, מחיקה, פירוט הפער ומאזן הזיכויים.
// הבדיקה מריצה את מודול האפליקציה המלא (index.html) ולוחצת על הכפתורים עצמם.
//
// הרצה: node --test tools/returns-history-unified.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime } from './receipt-scan-harness.mjs';

const SUPPLIER = 'yotvata';
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const appHtml = c => c.run("$('app').innerHTML");
const view = c => c.run('currentView');
const money = (c, n) => c.run('fmtMoney(' + n + ')');

// חותמות זמן קבועות — הסדר במסך הוא לפי תאריך, מהחדש לישן
const T = {
  pending: Date.UTC(2026, 8, 28, 9, 0),  // 28.9.2026
  receipt: Date.UTC(2026, 8, 24, 9, 0),  // 24.9.2026
  ok: Date.UTC(2026, 8, 21, 9, 0),       // 21.9.2026
  gap: Date.UTC(2026, 8, 14, 9, 0)       // 14.9.2026
};

// תעודה שנשלחה וטרם אומתה: 4 × 7.42 + 2 × 4.60 = 38.88 ללא מע״מ
const PENDING = {
  id: 'ret-pending', timestamp: T.pending, date: '2026-09-28', docDate: '2026-09-28', sentTo: 'קבוצה בוואטסאפ',
  credited: false, totalExVat: 38.88, totalIncVat: 38.88,
  items: [
    { productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 4, unitPrice: 7.42, lineTotal: 29.68 },
    { productId: 'p-cottage', name: 'קוטג׳ בדיקה', barcode: '7290000000015', qty: 2, unitPrice: 4.6, lineTotal: 9.2 }
  ]
};
// תעודה שאומתה בדיוק: הוחזר ₪50, זוכה ₪50
const VERIFIED_OK = {
  id: 'ret-ok', timestamp: T.ok, date: '2026-09-21', docDate: '2026-09-21', sentTo: 'קבוצה בוואטסאפ',
  credited: true, creditedAt: T.ok + 86400000, creditNoteTotal: 50, creditStatus: 'ok', totalExVat: 50, totalIncVat: 50,
  items: [{ productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 10, unitPrice: 5, lineTotal: 50, noteQty: 10 }]
};
// תעודה שאומתה עם פער פתוח: הוחזרו 10 יח׳ (₪50), הספק זיכה 8 (₪40) — חסרות 2 יח׳ = ₪10
const VERIFIED_GAP = {
  id: 'ret-gap', timestamp: T.gap, date: '2026-09-14', docDate: '2026-09-14', sentTo: 'קבוצה בוואטסאפ',
  credited: true, creditedAt: T.gap + 86400000, creditNoteTotal: 40, creditStatus: 'open', totalExVat: 50, totalIncVat: 50,
  items: [{ productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 10, unitPrice: 5, lineTotal: 50, noteQty: 8 }]
};
// קליטה ישנה שממתינה לנייר — מספיקה כדי להוכיח שקליטות וחזרות יושבות באותו מסך
const RECEIPT = {
  id: 'rc-1', date: '2026-09-24', timestamp: T.receipt, status: 'open', noDoc: true, totalExVat: 15, count: 1,
  items: [{ productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 3 }]
};

function setup(opts) {
  opts = opts || {};
  const c = runtime(SUPPLIER);
  c.context.testConfirms = [];
  c.run(`
    products = [
      { id: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', price: 7.42, creditPrice: 5 },
      { id: 'p-cottage', name: 'קוטג׳ בדיקה', barcode: '7290000000015', price: 4.6 }
    ];
    returns = ${JSON.stringify(opts.returns || [PENDING, VERIFIED_OK, VERIFIED_GAP])};
    receipts = ${JSON.stringify(opts.receipts || [])};
    receiptsHistoryFilter = 'all';
    showConfirm = (title, msg, okText, cb) => { testConfirms.push({ title, msg, okText }); };
  `);
  return c;
}
// הכרטיס של תעודת חזרה אחת, כפי שהמסך המאוחד בונה אותו
const card = (c, id) => c.run('returnCardInReceipts(returns.find(x => x.id === ' + JSON.stringify(id) + '))');
const firstIndex = (html, id) => html.indexOf('data-id="' + id + '"');

// ===== א. ניווט =====

test('setView("returnsHistory") — הכינוי הישן נוחת במסך התעודות המאוחד', () => {
  const c = setup();
  c.run("setView('returnsHistory')");
  assert.equal(view(c), 'receiptsHistory', 'הכינוי הישן מתורגם למסך המאוחד — גם מהיסטוריית הדפדפן');
  assert.equal(c.run('mainMode'), 'receiving', 'מסך היסטוריה אינו משנה את המצב הראשי');
  assert.ok(c.node('btnReceiptsHistory').className.includes('bg-blue-800'), 'כפתור "תעודות" בכותרת נצבע כמסך הפתוח');
});

test('setView("receiptsHistory") מצייר את הכותרת המאוחדת — ואין עוד "נקה הכל" בכותרת', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const html = appHtml(c);
  assert.ok(html.includes('<h2 class="font-black text-2xl text-slate-800">היסטוריית תעודות</h2>'), 'הכותרת');
  assert.ok(html.includes('<div class="text-xs text-slate-500 font-bold">קליטות וחזרות יחד · פתח קודם את מה שדורש טיפול</div>'), 'שורת המשנה');
  assert.ok(!html.includes('תעודות קליטה</h2>'), 'הכותרת הישנה נעלמה');
  assert.ok(!html.includes('נקה הכל'), 'כפתור "נקה הכל" הבולט ירד מהכותרת');

  const empty = setup({ returns: [] });
  empty.run("setView('receiptsHistory')");
  const emptyHtml = appHtml(empty);
  assert.ok(emptyHtml.includes('היסטוריית תעודות</h2>') && emptyHtml.includes('אין תעודות עדיין'), 'גם בלי תעודות — אותה כותרת');
  assert.ok(!emptyHtml.includes('ניהול תעודות'), 'אין מה לנהל כשאין תעודות');
});

test('כל הכניסות ל"היסטוריית חזרות" נוחתות במסך התעודות: הכפתור בלשונית, באנר הפערים, כפתור "תעודות"', () => {
  const c = setup();
  const fromReturns = () => c.run("currentView = 'returns'; mainMode = 'returns';");

  fromReturns();
  c.click('ret-history');
  assert.equal(view(c), 'receiptsHistory', 'הכפתור/הבאנר בלשונית החזרות');

  fromReturns();
  c.click('gap-goto', undefined, { view: 'receiptsHistory' });
  assert.equal(view(c), 'receiptsHistory', 'שורת פער בבאנר הספק');

  fromReturns();
  c.events.get('btnReceiptsHistory:click')({ type: 'click' });
  assert.equal(view(c), 'receiptsHistory', 'כפתור "תעודות" בכותרת — אותו מסך בדיוק');
  assert.equal(c.run('mainMode'), 'returns', 'וחזרה מהמסך מובילה ללשונית החזרות');
});

test('"לאימות ←" מהלשונית מראה את התעודה הממתינה גם כשמסנן המסך נשאר על "דורשות טיפול" או "הושלמו"', () => {
  // המסך הישן הראה תמיד את כל החזרות. במסך המאוחד המסנן האחרון נשאר דביק, ותעודות
  // חזרה יושבות רק בסל "חזרות" — אם הכניסה מהלשונית לא דואגת למסנן, הכפתור שמבטיח
  // "לאימות ←" נוחת על "אין תעודות במסנן הזה" והמשתמש הפשוט לא מוצא את התעודה.
  for (const sticky of ['attention', 'done']) {
    const c = setup({ returns: [PENDING, VERIFIED_OK] });
    c.run("receiptsHistoryFilter = " + JSON.stringify(sticky) + "; currentView = 'returns'; mainMode = 'returns';");
    assert.ok(c.run('pendingReturnsBannerHtml()').includes('לאימות ←'), 'הבאנר האדום מבטיח אימות');
    c.click('ret-history');
    assert.equal(view(c), 'receiptsHistory');
    const html = appHtml(c);
    assert.ok(html.includes('data-id="ret-pending"'), 'מסנן דביק "' + sticky + '": התעודה הממתינה נראית אחרי "לאימות ←"');
    assert.ok(!html.includes('אין תעודות במסנן הזה'), 'מסנן דביק "' + sticky + '": לא נוחתים על מסך ריק');
  }
  // אותו דבר לשורת הזיכויים בבאנר הפערים — פעם היא הובילה למסך החזרות שהראה הכל
  const g = setup({ returns: [VERIFIED_GAP] });
  g.run("receiptsHistoryFilter = 'attention'; currentView = 'order'; mainMode = 'order';");
  assert.equal(json(g, 'supplierGaps().lines[0].kind'), 'credits');
  g.click('gap-goto', undefined, { view: 'receiptsHistory' });
  assert.ok(appHtml(g).includes('data-id="ret-gap"'), 'שורת "חייב לך בזיכויים על חזרות" מראה את התעודה עם הפער');
});

test('שליחה בוואטסאפ נוחתת על כל התעודות — מסנן דביק לא מסתיר את התעודה שנשלחה עכשיו', async () => {
  // המסך הישן הראה אחרי השליחה את כל החזרות; במסך המאוחד "הושלמו" היה מסתיר את התעודה שזה עתה נשלחה
  const c = setup({ returns: [] });
  c.run("receiptsHistoryFilter = 'done'; window.location = { href: '' }; currentView = 'returns'; mainMode = 'returns';");
  c.run("returnsList = [{ productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 2 }]; openReturnsSend();");
  assert.equal(c.run('sendCtx.type'), 'returns');
  await c.run("performSend({ name: 'גיל', phone: '050-1234567' })");
  assert.equal(view(c), 'receiptsHistory', 'נוחתים במסך המאוחד');
  assert.equal(c.run('receiptsHistoryFilter'), 'all', 'עם המסנן "הכל" — התעודה שנשלחה תיראה בראש');
  assert.match(c.run('window.location.href'), /^https:\/\/wa\.me\//, 'והקישור לוואטסאפ נפתח');
});

test('הכפתור בלשונית החזרות אומר שהוא מוביל לכל התעודות; הבאנר האדום נשאר כשיש מה לאמת', () => {
  const quiet = setup({ returns: [VERIFIED_OK] });
  quiet.run("currentView = 'returns'; mainMode = 'returns'; renderReturns();");
  const quietHtml = appHtml(quiet);
  assert.ok(quietHtml.includes('data-role="ret-history"'), 'הכפתור קיים');
  assert.ok(quietHtml.includes('<i class="fa-solid fa-clock-rotate-left text-blue-600"></i> היסטוריית תעודות — קליטות וחזרות'), 'התווית החדשה');
  assert.ok(!quietHtml.includes('>היסטוריית חזרות<'), 'התווית הישנה נעלמה');

  const c = setup();
  c.run("currentView = 'returns'; mainMode = 'returns'; renderReturns();");
  const banner = c.run('pendingReturnsBannerHtml()');
  assert.ok(banner.includes('data-role="ret-history"') && banner.includes('יש תעודת חזרות פתוחה לאימות') && banner.includes('לאימות ←'), 'הבאנר האדום לא השתנה');
  assert.ok(appHtml(c).includes(banner), 'והוא מחליף את הכפתור הרגיל');
});

test('באנר הפערים: כל שורה מובילה למסך התעודות, והסוג נשמר ב-kind', () => {
  const c = setup();
  const gaps = json(c, 'supplierGaps()');
  assert.ok(gaps.lines.length >= 1);
  assert.ok(gaps.lines.every(l => l.view === 'receiptsHistory'), 'אין עוד הפניה למסך החזרות');
  const credits = gaps.lines.find(l => l.kind === 'credits');
  assert.ok(credits && credits.owed && credits.text.includes('₪' + money(c, 10) + ' בזיכויים על חזרות'), 'שורת הזיכויים ממסך החזרות הישן');
  const banner = c.run('supplierGapBannerHtml()');
  assert.ok(banner.includes('data-role="gap-goto" data-view="receiptsHistory"'));
  assert.ok(!banner.includes('returnsHistory'));
});

test('ביטול אימות וביטול עריכת פריטים חוזרים למסך התעודות — גם כשהגיעו מלשונית החזרות', () => {
  const c = setup();
  // אימות: מהמסך המאוחד
  c.run("setView('receiptsHistory')");
  c.click('rv-open', 'ret-gap');
  assert.equal(view(c), 'returnReconcile');
  c.click('rv-cancel');
  assert.equal(view(c), 'receiptsHistory');
  assert.equal(c.run('returnVerify'), null);
  // אימות: הפעם מלשונית החזרות (פעם rvOrigin היה מחזיר למסך החזרות הנפרד)
  c.run("currentView = 'returns'; mainMode = 'returns'; openReturnVerify('ret-pending', null);");
  assert.equal(view(c), 'returnReconcile');
  c.click('rv-cancel');
  assert.equal(view(c), 'receiptsHistory');
  // עריכת פריטים
  c.run("setView('receiptsHistory')");
  c.click('ret-edit-items', 'ret-pending');
  assert.equal(view(c), 'returnItemsEdit');
  assert.equal(json(c, 'returnEdit.origin'), 'receiptsHistory', 'מקור העריכה הוא תמיד המסך המאוחד');
  c.click('re-cancel');
  assert.equal(view(c), 'receiptsHistory');
  assert.equal(c.run('returnEdit'), null);
  // ובלי returnEdit בכלל — ברירת המחדל היא המסך המאוחד
  c.run("currentView = 'returns'; returnEdit = null;");
  c.click('re-cancel');
  assert.equal(view(c), 'receiptsHistory');
});

// ===== ב. הכרטיסים במסך המאוחד =====

test('שלוש תעודות חזרה — כל אחת מופיעה במסך המאוחד עם המצב הנכון, לפי תאריך', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const html = appHtml(c);
  assert.equal(html.split('תעודת חזרות / זיכוי').length - 1, 3, 'שלושה כרטיסי חזרה');
  assert.ok(html.includes('<i class="fa-solid fa-hourglass-half"></i> ממתינה לאימות זיכוי'), 'ממתינה');
  assert.ok(html.includes('<i class="fa-solid fa-circle-check"></i> אומתה · '), 'אומתה (עם תאריך האימות)');
  assert.ok(html.includes('<i class="fa-solid fa-triangle-exclamation"></i> נותר פער'), 'פער פתוח');
  assert.ok(!html.includes('לא אומתה'), 'הנוסח הישן של הכרטיס נעלם');
  const [p, o, g] = [firstIndex(html, 'ret-pending'), firstIndex(html, 'ret-ok'), firstIndex(html, 'ret-gap')];
  assert.ok(p > -1 && o > -1 && g > -1);
  assert.ok(p < o && o < g, 'מהחדש לישן');
  assert.ok(html.includes('חזרות · 3') && html.includes('הכל · 3'), 'מוני המסננים');
  // כל כרטיס במסך זהה לכרטיס שהפונקציה בונה לבדה
  for (const id of ['ret-pending', 'ret-ok', 'ret-gap']) assert.ok(html.includes(card(c, id)), id + ': הכרטיס במסך הוא הכרטיס');
});

test('תעודה ממתינה: אימות, אישור, שליחה חוזרת, החזרה לרשימה, עריכה ומחיקה — כמו במסך הישן', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const html = card(c, 'ret-pending');
  assert.ok(appHtml(c).includes(html));
  assert.ok(html.includes('ממתינה לאימות זיכוי'));
  for (const role of ['rv-verify-inline', 'rv-approve', 'ret-resend', 'ret-return-open', 'ret-edit-items', 'del-return'])
    assert.ok(html.includes('data-role="' + role + '" data-id="ret-pending"'), role);
  assert.ok(html.includes('id="rvNote_ret-pending"'), 'שדה הסכום');
  assert.ok(html.includes('או אשר שהוא בדיוק ₪' + money(c, 38.88)), 'הסכום לאישור נאמר מראש');
  assert.ok(html.includes('<i class="fa-brands fa-whatsapp"></i> שלח שוב בוואטסאפ'), 'שליחה חוזרת');
  assert.ok(html.includes('<i class="fa-solid fa-trash-can"></i> מחק תעודה'), 'מחיקה');
  assert.ok(!html.includes('rv-open') && !html.includes('uncredit') && !html.includes('פירוט הפער'), 'אין פעולות של תעודה מאומתת');
  // סדר הפעולות: אימות, שליחה חוזרת, החזרה לרשימה, עריכה, מחיקה
  const order = ['rv-verify-inline', 'ret-resend', 'ret-return-open', 'ret-edit-items', 'del-return'].map(r => html.indexOf('data-role="' + r + '"'));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order);

  // הכפתורים חיים: שליחה חוזרת ומחיקה מגיעים לאותן פונקציות
  c.run('openReturnsResend = r => { testResend = r.id; };');
  c.click('ret-resend', 'ret-pending');
  assert.equal(c.run('testResend'), 'ret-pending');
  c.click('del-return', 'ret-pending');
  assert.deepEqual(json(c, 'testConfirms.map(x => x.title)'), ['מחיקת תעודת חזרות']);
});

test('שורות הפריטים מראות גם את הכסף, הברקוד ותג "תביעת זיכוי"', () => {
  const c = setup({ returns: [Object.assign({}, PENDING, { items: [
    { name: 'חלב <בדיקה>', barcode: '7290000000008', qty: 4, unitPrice: 7.42, lineTotal: 29.68 },
    { name: 'קוטג׳ בדיקה', barcode: '', qty: 2, unitPrice: 4.6, carriedClaim: true },
    { name: 'בלי מחיר', barcode: '7290000000022', qty: 1 }
  ] })] });
  c.run("setView('receiptsHistory')");
  const html = card(c, 'ret-pending');
  assert.ok(html.includes('חלב &lt;בדיקה&gt;'), 'השם עובר htmlEscape');
  assert.ok(html.includes('<i class="fa-solid fa-barcode"></i> 7290000000008'), 'ברקוד');
  assert.ok(html.includes('<i class="fa-solid fa-barcode"></i> —'), 'בלי ברקוד — קו');
  assert.ok(html.includes('4 יח׳') && html.includes('₪' + money(c, 29.68)), 'הכמות והסכום של השורה');
  assert.ok(html.includes('₪' + money(c, 9.2)), 'בלי lineTotal — מחיר × כמות');
  assert.ok(html.includes('תביעת זיכוי'), 'התג שהיה במסך הישן');
  assert.ok(html.includes('בלי מחיר') && !html.includes('₪' + money(c, 0) + '</div>'), 'שורה בלי מחיר — בלי סכום');
});

test('תעודה שאומתה בדיוק: ירוקה, בלי פירוט פער, עם "ערוך אימות" וביטול אימות', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const html = card(c, 'ret-ok');
  assert.ok(html.includes('<i class="fa-solid fa-circle-check"></i> אומתה · ' + new Date(VERIFIED_OK.creditedAt).toLocaleDateString('he-IL')));
  assert.ok(html.includes('border-emerald-300'));
  assert.ok(html.includes('data-role="rv-open" data-id="ret-ok"') && html.includes('ערוך אימות'));
  assert.ok(html.includes('data-role="uncredit" data-id="ret-ok"'));
  assert.ok(html.includes('data-role="ret-edit-items" data-id="ret-ok"'));
  for (const gone of ['פירוט הפער', 'הספק חייב לך עוד', 'rv-approve', 'ret-resend', 'del-return', 'ret-carry', 'rvAdd_'])
    assert.ok(!html.includes(gone), gone + ' אינו בכרטיס מאומת בלי פער');
});

test('תעודה עם פער פתוח: הבאנר האדום, "פירוט הפער" והעברת הפער — כמו במסך הישן', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const html = card(c, 'ret-gap');
  const di = json(c, 'returnsDiscrepancyInfo(returns.find(x => x.id === "ret-gap"))');
  assert.equal(di.open, true); assert.equal(di.owed, 10);
  assert.ok(html.includes('נותר פער') && html.includes('border-rose-300'));
  assert.ok(html.includes('הספק חייב לך עוד ₪' + money(c, 10) + ' בזיכוי!'), 'הבאנר האדום של הכרטיס');
  assert.ok(html.includes('החזרת ₪' + money(c, 50) + ' · בתעודת הזיכוי ₪' + money(c, 40)), 'שורת ההסבר');
  assert.ok(!html.includes('הועבר לחזרות'), 'שום דבר לא הועבר עדיין');
  assert.ok(html.includes('<div class="font-black text-rose-700 mb-1">פירוט הפער</div>'));
  assert.ok(html.includes('<span>זוכה חסר: חלב בדיקה</span><span>2 יח׳</span>'), 'השורה החסרה');
  assert.ok(html.includes('data-role="rv-open" data-id="ret-gap"') && html.includes('תקן פער'));
  assert.ok(html.includes('data-role="ret-carry" data-id="ret-gap"'), 'העברת הפער לחזרות הפתוחות');
  assert.ok(html.includes('id="rvAdd_ret-gap"'), 'תעודת זיכוי משלימה');
  const breakdownAt = html.indexOf('פירוט הפער'), carryAt = html.indexOf('data-role="ret-carry"');
  assert.ok(breakdownAt < carryAt, 'הפירוט לפני ההעברה');
  assert.ok(!html.includes('rv-approve') && !html.includes('ret-resend') && !html.includes('del-return'));

  // זוכה יותר מדי: הנוסח השני של הבאנר, עם "זוכה יתר"
  const over = setup({ returns: [Object.assign({}, VERIFIED_GAP, { creditNoteTotal: 55, items: [
    { name: 'חלב בדיקה', barcode: '7290000000008', qty: 10, unitPrice: 5, lineTotal: 50, noteQty: 11 }
  ] })] });
  over.run("setView('receiptsHistory')");
  const overHtml = card(over, 'ret-gap');
  assert.ok(overHtml.includes('הספק זיכה ₪' + money(over, 5) + ' יותר מדי'));
  assert.ok(overHtml.includes('<span>זוכה יתר: חלב בדיקה</span><span>1 יח׳</span>'));
});

// ===== ג. שורות המצב, מאזן הזיכויים וניהול התעודות =====

test('שורות המצב מעל הרשימה: כמה ממתינות לאימות וכמה עם פער פתוח', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  let html = appHtml(c);
  assert.ok(html.includes('<div class="px-1 mb-2 text-sm font-bold text-amber-600"><i class="fa-solid fa-hourglass-half"></i> תעודת חזרה אחת ממתינה לאימות זיכוי</div>'));
  assert.ok(html.includes('<div class="px-1 mb-2 text-sm font-bold text-rose-700"><i class="fa-solid fa-triangle-exclamation"></i> תעודת חזרה אחת עם פער פתוח בזיכוי</div>'));
  assert.ok(html.indexOf('ממתינה לאימות זיכוי</div>') < firstIndex(html, 'ret-pending'), 'שורות המצב לפני הכרטיסים');

  const two = setup({ returns: [PENDING, Object.assign({}, PENDING, { id: 'ret-pending-2', timestamp: T.pending - 3600000 }), VERIFIED_GAP, Object.assign({}, VERIFIED_GAP, { id: 'ret-gap-2' })] });
  two.run("setView('receiptsHistory')");
  html = appHtml(two);
  assert.ok(html.includes('2 תעודות חזרה ממתינות לאימות זיכוי'));
  assert.ok(html.includes('2 תעודות חזרה עם פער פתוח בזיכוי'));

  const quiet = setup({ returns: [VERIFIED_OK] });
  quiet.run("setView('receiptsHistory')");
  html = appHtml(quiet);
  assert.ok(!html.includes('ממתינ') && !html.includes('פער פתוח בזיכוי'), 'שום דבר לטיפול — אין שורות מצב');
});

test('מאזן הזיכויים מול הספק מופיע במסך המאוחד, אחרי מאזן הסחורה ולפני דוח התשלום', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  const banner = c.run('returnsBalanceBannerHtml()');
  assert.ok(banner.includes('<i class="fa-solid fa-scale-unbalanced"></i> הספק חייב לך ₪' + money(c, 10) + '</div>'), 'אדום: הספק חייב');
  assert.ok(banner.includes('מאזן מצטבר מכל הזיכויים'));
  const html = appHtml(c);
  assert.ok(html.includes(banner), 'הבאנר במסך');
  assert.ok(html.indexOf(banner) < html.indexOf('דוח לתשלום לספק'), 'לפני דוח התשלום');
  assert.ok(html.indexOf(banner) > html.indexOf('פער פתוח בזיכוי</div>'), 'אחרי שורות המצב');

  const balanced = setup({ returns: [VERIFIED_OK] });
  assert.ok(balanced.run('returnsBalanceBannerHtml()').includes('מאזן הזיכויים מול הספק מאוזן ✓'), 'ירוק: מאוזן');
  balanced.run("setView('receiptsHistory')");
  assert.ok(appHtml(balanced).includes('מאזן הזיכויים מול הספק מאוזן ✓'));

  const overCredited = setup({ returns: [Object.assign({}, VERIFIED_OK, { creditNoteTotal: 60 })] });
  assert.ok(overCredited.run('returnsBalanceBannerHtml()').includes('<i class="fa-solid fa-scale-unbalanced-flip"></i> זוכית ₪' + money(c, 10) + ' יותר מסך הכל'), 'כחול: זוכית יותר');

  const nothingVerified = setup({ returns: [PENDING] });
  assert.equal(nothingVerified.run('returnsBalanceBannerHtml()'), '', 'בלי תעודה מאומתת אין מאזן');
  nothingVerified.run("setView('receiptsHistory')");
  assert.ok(!appHtml(nothingVerified).includes('מאזן הזיכויים'));
});

test('"ניהול תעודות" מקופל: מחיקת כל היסטוריית החזרות (ומחיקת הקליטות רק כשיש)', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  let html = appHtml(c);
  const summary = '<details class="mb-3"><summary class="cursor-pointer text-xs font-bold text-slate-400 px-1">ניהול תעודות</summary>';
  assert.ok(html.includes(summary));
  const block = html.slice(html.indexOf(summary), html.indexOf('</details>', html.indexOf(summary)));
  assert.ok(block.includes('<button data-role="clear-returns-history" class="btn-tap mt-2 text-xs font-bold text-red-500 bg-red-50 px-3 py-2 rounded-lg"><i class="fa-solid fa-trash-can"></i> מחק את כל היסטוריית החזרות</button>'));
  assert.ok(!block.includes('clear-receipts'), 'אין קליטות — אין מה למחוק מהן');
  assert.ok(html.indexOf(summary) < html.indexOf('rc-hist-filter'), 'הבלוק מיד אחרי הכותרת');
  c.click('clear-returns-history');
  assert.deepEqual(json(c, 'testConfirms.map(x => [x.title, x.okText])'), [['ניקוי היסטוריה', 'מחק הכל']], 'המחיקה עדיין שואלת קודם');

  const mixed = setup({ receipts: [RECEIPT] });
  mixed.run("setView('receiptsHistory')");
  html = appHtml(mixed);
  const mixedBlock = html.slice(html.indexOf(summary), html.indexOf('</details>', html.indexOf(summary)));
  assert.ok(mixedBlock.includes('data-role="clear-receipts"') && mixedBlock.includes('data-role="clear-returns-history"'));
  assert.ok(mixedBlock.indexOf('clear-receipts') < mixedBlock.indexOf('clear-returns-history'));

  const onlyReceipts = setup({ returns: [], receipts: [RECEIPT] });
  onlyReceipts.run("setView('receiptsHistory')");
  html = appHtml(onlyReceipts);
  assert.ok(html.includes('data-role="clear-receipts"') && !html.includes('clear-returns-history'), 'אין חזרות — אין מה למחוק מהן');
});

// ===== ד. קליטות וחזרות יחד =====

test('קליטה ותעודות חזרה באותו מסך, לפי תאריך; מסנן "חזרות" משאיר רק את החזרות', () => {
  const c = setup({ receipts: [RECEIPT] });
  c.run("setView('receiptsHistory')");
  let html = appHtml(c);
  assert.ok(html.includes('<i class="fa-solid fa-file-invoice"></i> תעודת קליטה</span>'), 'כרטיס קליטה');
  assert.equal(html.split('תעודת חזרות / זיכוי').length - 1, 3, 'ושלושת כרטיסי החזרה');
  const [p, rc, o, g] = [firstIndex(html, 'ret-pending'), firstIndex(html, 'rc-1'), firstIndex(html, 'ret-ok'), firstIndex(html, 'ret-gap')];
  assert.ok(p < rc && rc < o && o < g, 'מעורבים לפי תאריך: 28.9, 24.9, 21.9, 14.9');
  assert.ok(html.includes('הכל · 4') && html.includes('חזרות · 3'));

  c.click('rc-hist-filter', undefined, { f: 'returns' });
  html = appHtml(c);
  assert.equal(c.run('receiptsHistoryFilter'), 'returns');
  assert.equal(firstIndex(html, 'rc-1'), -1, 'הקליטה מסוננת');
  assert.equal(html.split('תעודת חזרות / זיכוי').length - 1, 3);
  assert.ok(html.includes('תעודת חזרה אחת ממתינה לאימות זיכוי') && html.includes('ניהול תעודות'), 'שורות המצב והניהול לא תלויים במסנן');

  c.click('rc-hist-filter', undefined, { f: 'all' });
  assert.ok(firstIndex(appHtml(c), 'rc-1') > -1);
});

test('פעולה על תעודה מציירת מחדש את המסך המאוחד — האישור מעביר את הכרטיס לירוק במקום', async () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  c.click('rv-approve', 'ret-pending');
  assert.deepEqual(json(c, 'testConfirms.map(x => x.title)'), ['אישור תעודת זיכוי']);
  c.run("approveReturnAsSent('ret-pending', 38.88)");
  await new Promise(resolve => setImmediate(resolve)); // השמירה בענן (המזויף) מסתיימת
  assert.equal(view(c), 'receiptsHistory', 'נשארים באותו מסך');
  const html = appHtml(c);
  assert.ok(!html.includes('ממתינה לאימות זיכוי'), 'אין עוד תעודה ממתינה — לא בכרטיס ולא בשורת המצב');
  assert.equal(html.split('<i class="fa-solid fa-circle-check"></i> אומתה').length - 1, 2, 'שתי תעודות ירוקות');
  assert.ok(html.includes('data-role="rv-open" data-id="ret-pending"'));
});

test('שמירת אימות נוחתת תמיד במסך התעודות — גם כשהאימות נפתח מלשונית החזרות', async () => {
  // פעם rvOrigin זכר מאיזה מסך הגיעו והחזיר לשם; עכשיו יש מסך אחד
  const c = setup();
  c.run("setView('receiptsHistory')");
  c.click('rv-open', 'ret-gap');
  assert.equal(view(c), 'returnReconcile');
  // המשתמש מצא שהספק בעצם זיכה את כל 10 היחידות — ₪50, בלי פער
  c.run('returnVerify.noteTotal = 50; returnVerify.items[0].noteQty = 10;');
  await c.run('saveReturnVerify()');
  assert.equal(view(c), 'receiptsHistory', 'חוזרים למסך המאוחד');
  assert.equal(c.run('returnVerify'), null);
  assert.deepEqual(json(c, 'testConfirms'), [], 'בלי פער — בלי שאלות');
  assert.equal(json(c, 'testToasts.at(-1)'), 'הזיכוי אומת ✓');
  let html = appHtml(c);
  const gapCard = card(c, 'ret-gap');
  assert.ok(html.includes(gapCard), 'הכרטיס המעודכן במסך');
  assert.ok(gapCard.includes('<i class="fa-solid fa-circle-check"></i> אומתה') && !gapCard.includes('פירוט הפער') && !gapCard.includes('ret-carry'), 'ירוק, בלי פער ובלי העברה');
  assert.ok(!html.includes('פער פתוח בזיכוי'), 'שורת הפערים הפתוחים ירדה');
  assert.ok(html.includes('מאזן הזיכויים מול הספק מאוזן ✓'), 'המאזן התעדכן באותו ציור');

  // מלשונית החזרות: "בדוק" על התעודה הממתינה עם הסכום שהוצע — ושמירה אחרי שכל השורות סומנו
  c.run("currentView = 'returns'; mainMode = 'returns'; openReturnVerify('ret-pending', 38.88);");
  assert.equal(view(c), 'returnReconcile');
  c.run('returnVerify.items.forEach(l => { l.checked = true; });');
  await c.run('saveReturnVerify()');
  assert.equal(view(c), 'receiptsHistory', 'לא חוזרים ללשונית החזרות ולא למסך החזרות הישן');
  html = appHtml(c);
  assert.ok(!html.includes('ממתינה לאימות זיכוי'), 'שלוש התעודות מאומתות');
  assert.equal(html.split('<i class="fa-solid fa-circle-check"></i> אומתה').length - 1, 3);
  assert.equal(json(c, 'returns.find(x => x.id === "ret-pending").creditStatus'), 'ok');
});

test('ביטול אימות מצייר את הכרטיס מחדש במקום — חוזר להיות ממתין, ושורות המצב והמאזן נספרים מחדש', async () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  c.click('uncredit', 'ret-ok');
  assert.deepEqual(json(c, 'testConfirms.map(x => [x.title, x.okText])'), [['ביטול אימות', 'בטל אימות']], 'שואלים קודם');
  await c.run("clearReturnVerification('ret-ok')");
  assert.equal(view(c), 'receiptsHistory');
  const html = appHtml(c);
  const okCard = card(c, 'ret-ok');
  assert.ok(html.includes(okCard), 'הכרטיס המעודכן במסך');
  assert.ok(okCard.includes('ממתינה לאימות זיכוי'), 'חזרה להיות תעודה ממתינה');
  for (const role of ['rv-verify-inline', 'rv-approve', 'ret-resend', 'ret-edit-items', 'del-return'])
    assert.ok(okCard.includes('data-role="' + role + '" data-id="ret-ok"'), role + ' — עם כל הפעולות של תעודה ממתינה');
  assert.ok(!okCard.includes('uncredit') && !okCard.includes('rv-open'));
  assert.ok(html.includes('2 תעודות חזרה ממתינות לאימות זיכוי'), 'שורת המצב נספרה מחדש');
  assert.ok(html.includes('הספק חייב לך ₪' + money(c, 10) + '</div>'), 'המאזן מחושב רק מהתעודות שנשארו מאומתות');
  const write = json(c, 'testWrites.find(w => w.op === "update" && String(w.path).indexOf("ret-ok") > -1)');
  assert.equal(write.data.credited, false);
  assert.equal(write.data.creditNoteTotal, null);
});

test('מחיקה ותעודה שמגיעה מהענן: המאזין של אוסף החזרות מצייר מחדש את המסך המאוחד', async () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  // המחיקה עוברת דרך סל המחזור בענן; המכשיר מוריד את התעודה והמאזין מצייר מחדש
  c.run('hardDeleteDocWithBackup = async (name, id) => { returns = returns.filter(x => x.id !== id); return true; };');
  await c.run("delReturnDoc('ret-pending')");
  assert.equal(json(c, 'testToasts.at(-1)'), 'תעודת החזרות נמחקה ונשמר גיבוי');
  c.run('rerender()'); // מה שהמאזין של onSnapshot עושה כשהמסך המאוחד פתוח
  let html = appHtml(c);
  assert.equal(firstIndex(html, 'ret-pending'), -1, 'הכרטיס נעלם');
  assert.ok(!html.includes('ממתינה לאימות זיכוי'), 'ואיתו שורת הממתינות');
  assert.ok(html.includes('חזרות · 2') && html.includes('הכל · 2'), 'המונים התעדכנו');

  // תעודה חדשה שנשלחה ממכשיר אחר — אותו מאזין, אותו ציור, והיא למעלה
  c.run('returns = returns.concat([' + JSON.stringify(Object.assign({}, PENDING, { id: 'ret-new', timestamp: T.pending + 3600000 })) + ']); rerender();');
  html = appHtml(c);
  assert.ok(firstIndex(html, 'ret-new') > -1 && firstIndex(html, 'ret-new') < firstIndex(html, 'ret-ok'), 'התעודה החדשה למעלה');
  assert.ok(html.includes('תעודת חזרה אחת ממתינה לאימות זיכוי'));
  assert.ok(html.includes(card(c, 'ret-new')));

  // המאזין עצמו: מצייר מחדש גם כשהמסך המאוחד פתוח (לא רק בלשונית החזרות)
  const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /returns = snap\.docs\.map[^\n]*\n\s*if \(currentView === 'returns' \|\| currentView === 'receiptsHistory'\) rerender\(\);/, 'השומר של onSnapshot');
});

// ===== ה. המסך הישן נעלם =====

test('המסך הנפרד של היסטוריית החזרות אינו קיים עוד', () => {
  const c = setup();
  assert.equal(c.run('typeof renderReturnsHistory'), 'undefined', 'הפונקציה נמחקה');
  assert.equal(c.run('typeof rvOrigin'), 'undefined', 'ואיתה המשתנה שזכר מאיזה מסך הגיעו');
  assert.equal(c.run('typeof renderReceiptsHistory'), 'function');
  assert.equal(c.run('typeof returnsBalanceBannerHtml'), 'function');
  const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!source.includes('renderReturnsHistory') && !source.includes('rvOrigin'), 'אין שרידים בקוד');
  assert.ok(!source.includes("setView('returnsHistory')"), 'אף אחד לא מנווט למסך הישן');
  assert.ok(source.includes("{ name: 'returns', label: 'היסטוריית חזרות' }"), 'אוסף הגיבוי שומר את שמו — הוא לא מסך');
  assert.match(source, /id="btnReceiptsHistory"[^>]*title="היסטוריית תעודות"[^>]*aria-label="היסטוריית תעודות"/, 'כפתור "תעודות" בכותרת מתאר את המסך המאוחד');
});

// ===== ו. גרסה =====

test('הגרסה: הכותרת, התג בפינה ושם המטמון של ה-service worker מספרים את אותו מספר', () => {
  // ליטבתה אין קבוע גרסה — הטקסט חי בשני מקומות ב-index.html ובשם המטמון ב-sw.js.
  // אם אחד מהם נשאר מאחור, הדפדפן ממשיך להגיש את המסך הישן מהמטמון.
  const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const title = source.match(/<title>הזמנות יטבתה - (v\d+)([^<]*)<\/title>/);
  const badge = source.match(/id="verBadge"[^>]*>(v\d+)([^<]*)<\/div>/);
  const cache = sw.match(/const CACHE_NAME = 'yotvata-(v\d+)'/);
  assert.ok(title && badge && cache, 'שלושת המקומות קיימים');
  assert.equal(badge[1] + badge[2], title[1] + title[2], 'אותו טקסט גרסה בכותרת ובתג');
  assert.equal(cache[1], title[1], 'ה-service worker מרענן את המטמון עם אותה גרסה');
  assert.ok(Number(title[1].slice(1)) >= 378, 'הגרסה שאיחדה את המסכים או מאוחרת ממנה');
});

// ===== ז. v379: כפתור "בטל אימות" אחד =====
// בכרטיס מאומת היו שני כפתורים לאותה פעולה: טקסט מלא, ולצד "ערוך אימות" גם
// אייקון חץ בודד. נשאר הטקסט — הוא אומר מה יקרה — מתחת לפעולה הראשית.
test('v379: בכרטיס מאומת יש כפתור "בטל אימות" אחד — עם טקסט, אחרי פעולת האימות הראשית', () => {
  const c = setup();
  c.run("setView('receiptsHistory')");
  for (const id of ['ret-ok', 'ret-gap']) {
    const html = card(c, id);
    assert.equal(html.split('data-role="uncredit"').length - 1, 1, id + ': כפתור ביטול אימות אחד');
    assert.ok(html.includes('<i class="fa-solid fa-rotate-left"></i> בטל אימות — פתח מחדש לתיקון'), id + ': עם טקסט שמסביר');
    assert.ok(!html.includes('title="בטל אימות"'), id + ': האייקון הבודד ירד');
    assert.ok(html.indexOf('data-role="rv-open"') < html.indexOf('data-role="uncredit"'), id + ': מתחת לפעולה הראשית');
    assert.ok(html.indexOf('data-role="uncredit"') < html.indexOf('data-role="ret-edit-items"'), id + ': ולפני עריכת הפריטים');
  }
  assert.ok(!card(c, 'ret-pending').includes('data-role="uncredit"'), 'תעודה ממתינה — אין מה לבטל');
  // והכפתור עדיין חי: שואל קודם
  c.click('uncredit', 'ret-ok');
  assert.deepEqual(json(c, 'testConfirms.map(x => x.title)'), ['ביטול אימות']);
});
