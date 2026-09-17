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
  assert.deepEqual(confirmTitles(c), ['לא סימנת הכל', 'הפרש לא מוסבר']);
  assert.equal(json(c, 'testConfirms[1].label'), 'שמור כפתוחה');

  const di = json(c, 'returnsDiscrepancyInfo(returns[0])');
  assert.equal(di.open, true, 'הכרטיס חייב להציג "אומת — נותר פער בזיכוי", לא ✓ ירוק');
  assert.equal(di.owed, 15, 'הספק עדיין חייב את ההפרש');
  // הפער חייב להישאר ניתן להעברה לרשימת החזרות הפתוחה
  assert.equal(json(c, 'retCarryPlan(returns[0]).val'), 15);
});

test('הזיכוי סוגר בדיוק — התעודה נשמרת סגורה וירוקה', async () => {
  const c = setup(RETURN_EX);
  assert.equal(json(c, 'rvGap()'), 0);
  await c.run('saveReturnVerify()');

  assert.deepEqual(confirmTitles(c), ['לא סימנת הכל']);
  assert.deepEqual(savedStatus(c), ['ok']);
  assert.equal(json(c, 'returnsDiscrepancyInfo(returns[0]).open'), false);
});

test('פער בשורות — נשאר פתוח גם כשהסכומים מסתדרים', async () => {
  // הספק זיכה 8 יח׳ במקום 10 בשורה הראשונה: ₪90 — השורות משחזרות את התעודה בדיוק,
  // אבל חסרות 2 יחידות שהוחזרו ולא זוכו.
  const c = setup(90);
  c.run('returnVerify.items[0].noteQty = 8;');
  assert.equal(json(c, 'rvGap()'), 0);
  await c.run('saveReturnVerify()');

  assert.deepEqual(confirmTitles(c), ['לא סימנת הכל']);
  assert.deepEqual(savedStatus(c), ['open']);
  const di = json(c, 'returnsDiscrepancyInfo(returns[0])');
  assert.equal(di.open, true);
  assert.deepEqual(di.shortItems.map(x => [x.name, x.n]), [['חלב בדיקה', 2]]);
  assert.equal(di.owed, 10);
});
