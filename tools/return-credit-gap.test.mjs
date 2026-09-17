// v356: אימות תעודת זיכוי עם פער — התעודה חייבת להישאר פתוחה.
// הבדיקה שולפת את הקוד מ-index.html עצמו ומריצה את מסלול השמירה האמיתי.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
// כל שורה: 10 יח׳ × ₪5 = ₪50, סך התעודה ₪100 ללא מע״מ
const RETURN_EX = 100;

function setup(noteTotal) {
  const c = runtime('yotvata');
  c.context.testConfirms = [];
  c.run(`
    currentView = 'returnsHistory';
    returns = [{ id: 'ret-1', timestamp: Date.now(), credited: false, totalExVat: ${RETURN_EX}, totalIncVat: ${RETURN_EX},
      items: [{ name: 'חלב בדיקה', barcode: '7290000000008', qty: 10, unitPrice: 5, lineTotal: 50 },
              { name: 'קפה בדיקה', barcode: '7290000000015', qty: 10, unitPrice: 5, lineTotal: 50 }] }];
    showConfirm = (title, msg, label, fn) => { testConfirms.push({ title: title, msg: msg, label: label }); fn(); };
    openReturnVerify('ret-1', ${noteTotal});
  `);
  return c;
}
const savedStatus = c => json(c, 'testWrites.filter(w => w.data && w.data.creditStatus != null).map(w => w.data.creditStatus)');
const confirmTitles = c => json(c, 'testConfirms.map(x => x.title)');

test('פער כספי בלבד — התעודה נשמרת פתוחה ולא ירוקה', async () => {
  // הספק זיכה ₪85 על החזרה של ₪100, בלי שאף שורה בתעודה שונה מהכמות שהוחזרה.
  const c = setup(85);
  assert.equal(json(c, 'rvGap()'), -15);
  await c.run('saveReturnVerify()');

  assert.deepEqual(savedStatus(c), ['open']);
  assert.deepEqual(confirmTitles(c), ['נשארו שורות בלי הכרעה', 'הספק זיכה ₪15.00 פחות']);
  assert.equal(json(c, 'testConfirms[1].label'), 'שמור כפתוחה');

  const di = json(c, 'returnsDiscrepancyInfo(returns[0])');
  assert.equal(di.open, true, 'הכרטיס חייב להציג "אומת — נותר פער בזיכוי", לא ✓ ירוק');
  assert.equal(di.owed, 15, 'הספק עדיין חייב את ההפרש');
  // הפער חייב להישאר ניתן להעברה לרשימת החזרות הפתוחה
  assert.equal(json(c, 'retCarryPlan(returns[0]).val'), 15);
});

test('הזיכוי סוגר בדיוק — התעודה נשמרת סגורה וירוקה', async () => {
  const c = setup(RETURN_EX);
  c.run('rvDecideAll()');
  assert.equal(json(c, 'rvGap()'), 0);
  await c.run('saveReturnVerify()');

  assert.deepEqual(confirmTitles(c), [], 'הכל הוכרע — אין מה לשאול');
  assert.deepEqual(savedStatus(c), ['ok']);
  assert.equal(json(c, 'returnsDiscrepancyInfo(returns[0]).open'), false);
});

test('פער בשורות — נשאר פתוח גם כשהסכומים מסתדרים', async () => {
  // הספק זיכה 8 יח׳ במקום 10 בשורה הראשונה: ₪90 — השורות משחזרות את התעודה בדיוק,
  // אבל חסרות 2 יחידות שהוחזרו ולא זוכו.
  const c = setup(90);
  c.run('rvDecideAll(); rvStepNote(0, -1); rvStepNote(0, -1);');
  assert.equal(json(c, 'rvGap()'), 0);
  await c.run('saveReturnVerify()');

  assert.deepEqual(confirmTitles(c), []);
  assert.deepEqual(savedStatus(c), ['open']);
  const di = json(c, 'returnsDiscrepancyInfo(returns[0])');
  assert.equal(di.open, true);
  assert.deepEqual(di.shortItems.map(x => [x.name, x.n]), [['חלב בדיקה', 2]]);
  assert.equal(di.owed, 10);
});

test('"לא זוכה" סוגר את הפער ורושם בדיוק את המוצר שלא זוכה', async () => {
  // הספק זיכה רק את הקפה. תהליך המשתמש: "הספק זיכה הכל" ואז ✗ על החריג.
  const c = setup(50);
  c.run('rvDecideAll(); rvDecide(0, "none");');
  assert.equal(json(c, 'rvGap()'), 0, 'ההכרעה סוגרת את ההפרש — בלי דיאלוג בשמירה');
  assert.deepEqual(json(c, 'returnVerify.items.map(rvRowState)'), ['none', 'full']);
  await c.run('saveReturnVerify()');

  assert.deepEqual(confirmTitles(c), []);
  assert.deepEqual(savedStatus(c), ['open']);
  const di = json(c, 'returnsDiscrepancyInfo(returns[0])');
  assert.deepEqual(di.shortItems.map(x => [x.name, x.n]), [['חלב בדיקה', 10]]);
  assert.equal(di.owed, 50);
  // ההעברה לרשימת החזרות הפתוחה מקבלת את השורה עצמה, לא סכום עיוור
  assert.deepEqual(json(c, 'retCarryPlan(returns[0]).items.map(x => [x.name, x.qty, x.amountOnly])'),
    [['חלב בדיקה', 10, false]]);
});

test('הכרעה קודמת חוזרת כשפותחים שוב תעודה שאומתה', async () => {
  const c = setup(50);
  c.run('rvDecideAll(); rvDecide(0, "none");');
  await c.run('saveReturnVerify()');
  c.run('openReturnVerify("ret-1", 50)');

  assert.deepEqual(json(c, 'returnVerify.items.map(rvRowState)'), ['none', 'full']);
  assert.equal(json(c, 'rvAllDecided()'), true);
  assert.equal(json(c, 'rvGap()'), 0);
});

// ===== v357: פותר הפער =====
// מסמך באותו גודל וצורה של המקרה שדווח: 18 שורות, 72 יחידות, מחירים מהקטלוג,
// ופער של ₪87.75 שמתפזר עליהן. למצוא ביד איזה צירוף מסתכם בדיוק בפער זה לא
// אפשרי — זה מה שהפותר צריך לעשות.
const REAL_DOC = [
  ['דנונה קראנץ שוקולד פאפס', 15, 3.48], ['מילקי טופ מגולגלת', 1, 3.37],
  ['אלפרו משקה ש.שועל אגוזי לוז', 6, 9.81], ['אלפרו ש.שועל ללא סוכר בריסטה', 1, 9.81],
  ['אלפרו משקה ש.שועל בריסטה 1 ליטר', 4, 9.81], ['גמדים לדרך תפוח בננה', 2, 3.90],
  ['חלב מעושר 3% 1 ליטר', 1, 6.53], ['משקה קאופרי 3% 1 ליטר', 9, 10.60],
  ['חומוס זעתר 400 גרם', 1, 8.06], ['חומוס צנובר 400 גרם', 2, 8.06],
  ['קוביות סלק 400 גרם', 1, 11.74], ['מילקי טריו שוקולד', 3, 2.45],
  ['מעדן סויה 2.3% bio שומן', 7, 3.75], ['משקה אקטיביה תות 1.2% בודד', 7, 3.96],
  ['משקה דנונה אקטיביה עם אפרסק', 7, 3.96], ['מילקי שוקולד( בודדים )', 1, 2.14],
  ['אקטימל רגיל שמינייה (864 גרם)', 1, 15.04], ['אשל 5% 200 גרם', 4, 2.90],
];
const r2 = n => Math.round(n * 100) / 100;
const DOC_EX = r2(REAL_DOC.reduce((a, [, q, u]) => a + q * u, 0)); // ₪426.95
function realDoc(noteTotal) {
  const c = runtime('yotvata');
  c.context.testConfirms = [];
  c.context.testDoc = REAL_DOC.map(([name, qty, unitPrice]) => ({ name, barcode: '', qty, unitPrice }));
  c.run(`
    currentView = 'returnsHistory';
    const ex = r2(testDoc.reduce((a, l) => a + l.unitPrice * l.qty, 0));
    returns = [{ id: 'ret-1', timestamp: Date.now(), credited: false, totalExVat: ex, totalIncVat: ex, items: testDoc }];
    showConfirm = (title, msg, label, fn) => { testConfirms.push({ title, msg, label }); fn(); };
    openReturnVerify('ret-1', ${noteTotal});
  `);
  return c;
}

test('הפותר מוצא איזה מוצרים מסבירים פער של ₪87.75 מתוך 18 שורות', async () => {
  const c = realDoc(339.20);
  assert.equal(json(c, 'returnTotals(returns[0]).ex'), DOC_EX);
  assert.equal(json(c, 'rvGap()'), -87.75);
  assert.equal(json(c, 'rvGapLabel(rvGap())'), 'הספק זיכה פחות', 'הכיוון נאמר במונחי הספק');

  const t0 = Date.now();
  const sol = json(c, 'rvGapSolution()');
  assert.ok(Date.now() - t0 < 500, 'הפותר חייב להיות מיידי — הוא רץ בכל הקשה');
  assert.ok(sol, 'חייב להימצא הסבר');
  assert.equal(sol.removing, true);
  assert.equal(sol.value, 87.75);
  // ההסבר חייב להסתכם בדיוק בפער, ולהיות בר-ביצוע על השורות הקיימות
  const sum = sol.lines.reduce((a, x) => a + REAL_DOC[x.idx][2] * x.units, 0);
  assert.equal(Math.round(sum * 100), 8775);
  sol.lines.forEach(x => assert.ok(x.units > 0 && x.units <= REAL_DOC[x.idx][1], 'לא יותר יחידות ממה שהוחזר'));

  // הפעלת ההצעה סוגרת את הפער ומאפשרת שמירה בלי אף דיאלוג
  c.run('rvApplyGapSolution()');
  assert.equal(json(c, 'rvGap()'), 0);
  await c.run('saveReturnVerify()');
  assert.deepEqual(confirmTitles(c), []);
  assert.deepEqual(savedStatus(c), ['open']);
  assert.equal(json(c, 'returnsDiscrepancyInfo(returns[0]).owed'), 87.75, 'הספק עדיין חייב בדיוק את הפער');
});

test('הפותר מעדיף את ההסבר הפשוט ביותר', async () => {
  // ₪15.04 הוא בדיוק שורת האקטימל — הסבר של שורה אחת מנצח צירופים ארוכים
  const c = realDoc(r2(DOC_EX - 15.04));
  const sol = json(c, 'rvGapSolution()');
  assert.equal(sol.lines.length, 1);
  assert.equal(REAL_DOC[sol.lines[0].idx][0], 'אקטימל רגיל שמינייה (864 גרם)');
  assert.equal(sol.lines[0].units, 1);
});

test('פער שאינו צירוף של מוצרים — הפותר מודה בזה ולא ממציא', async () => {
  const c = realDoc(r2(DOC_EX - 20.07));
  assert.equal(json(c, 'rvGapSolution()'), null);
  await c.run('saveReturnVerify()');
  // הדיאלוג אומר כמה ולאיזה כיוון, לא "הפרש לא מוסבר"
  assert.deepEqual(confirmTitles(c), ['נשארו שורות בלי הכרעה', 'הספק זיכה ₪20.07 פחות']);
  assert.deepEqual(savedStatus(c), ['open']);
});

test('תעודה גדולה מהשורות — הפותר מציע להחזיר יחידות שהורדו', async () => {
  const c = realDoc(DOC_EX);
  c.run('rvDecideAll(); rvDecide(16, "none");'); // הורדנו את האקטימל בטעות
  assert.equal(json(c, 'rvGap()'), 15.04);
  assert.equal(json(c, 'rvGapLabel(rvGap())'), 'הספק זיכה יותר');
  const sol = json(c, 'rvGapSolution()');
  assert.equal(sol.removing, false);
  assert.deepEqual(sol.lines, [{ idx: 16, units: 1 }]);
  c.run('rvApplyGapSolution()');
  assert.equal(json(c, 'rvGap()'), 0);
  assert.deepEqual(json(c, 'returnVerify.items.map(rvRowState)'), REAL_DOC.map(() => 'full'));
});

test('סכום שהוקלד כולל מע״מ מזוהה ומוסבר', async () => {
  const c = realDoc(r2(DOC_EX * 1.18));
  assert.equal(json(c, 'rvGapSolution()'), null, 'אין צירוף מוצרים כזה');
  assert.match(json(c, 'rvSolveBoxHtml()'), /כולל מע/, 'הקופסה מסבירה שזה מע״מ');
  assert.match(json(c, 'rvSolveBoxHtml()'), new RegExp(String(DOC_EX)));
});

test('הסבר יחיד מוצג כוודאי, הסבר עם חלופות מוצג כאפשרות', async () => {
  // שתי שורות בדיוק באותו שווי (₪50) — הפער של ₪50 מוסבר על ידי כל אחת מהן,
  // והמסך חייב להגיד את זה ולא להציג ניחוש כעובדה.
  const amb = setup(50);
  const sAmb = json(amb, 'rvGapSolution()');
  assert.equal(sAmb.whole, true);
  assert.equal(sAmb.unique, false, 'יש שני הסברים — אסור להציג אחד מהם כיחיד');
  assert.match(json(amb, 'rvSolveBoxHtml()'), /יש גם צירופים אחרים/);

  const one = realDoc(r2(DOC_EX - 15.04));
  const sOne = json(one, 'rvGapSolution()');
  assert.equal(sOne.unique, true);
  assert.match(json(one, 'rvSolveBoxHtml()'), /אין צירוף אחר/);
});

test('ההצעה מכריעה את כל השורות, לא רק את אלה שבה', async () => {
  const c = realDoc(339.20);
  c.run('rvApplyGapSolution()');
  assert.equal(json(c, 'rvAllDecided()'), true, 'אחרי שההפרש הוסבר אין מה לשאול על השאר');
  const states = json(c, 'returnVerify.items.map(rvRowState)');
  assert.equal(states.filter(s => s === 'none').length, 5, 'חמישה מוצרים שהספק לא זיכה');
  assert.equal(states.filter(s => s === 'full').length, 13);
  assert.ok(!states.includes('todo'));
});
