// קיזוז אוטומטי בין תעודות: חוסר בתעודה אחת ועודף בתעודה אחרת של אותו מוצר,
// באותו מחיר ובאותה כמות, מתקזזים לבד — אבל רק בתוך 9 התעודות האחרונות.
// כמויות משקל נחשבות שוות גם כשהחיסור משאיר רעש נקודה צפה.
// הרצה: node --test tools/auto-offset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

function create() {
  const r = harness.runtime('yotvata');
  r.run(`cloudLog = []; runCloudTaskSilent = async (name, task) => { cloudLog.push(task); return true; };
    mkRc = (id, day, lines) => ({ id, date: '2026-09-' + day, docDate: '2026-09-' + day, timestamp: Date.parse('2026-09-' + day + 'T08:00:00Z'),
      items: lines.map(([productId, qty, noteQty, unitPrice]) => ({ productId, name: 'מוצר ' + productId, qty, noteQty, unitPrice, lineTotal: Math.round(unitPrice * qty * 100) / 100 })) });
    fillers = n => Array.from({ length: n }, (_, i) => mkRc('f' + i, String(20 - Math.floor(i / 3)).padStart(2, '0'), [['z', 1, 1, 5]]));`);
  return r;
}
const sweep = r => r.run(`autoApplyExactOffsets().then(a => JSON.stringify(a.map(p => [p.rc.id, p.other.id, p.productId, p.qty])))`).then(JSON.parse);
const offsets = (r, id) => JSON.parse(r.run(`JSON.stringify(receipts.find(x => x.id === '${id}').externalOffsets || [])`));

test('חוסר אתמול ועודף היום — אותו מוצר, מחיר וכמות — מתקזזים לבד', async () => {
  const r = create();
  r.run(`receipts = [mkRc('today', '28', [['p1', 5, 3, 10]]), mkRc('yday', '27', [['p1', 3, 5, 10]])];`);
  assert.deepEqual(await sweep(r), [['today', 'yday', 'p1', 2]]);
  assert.equal(offsets(r, 'today')[0].source, 'auto');
  assert.equal(offsets(r, 'today')[0].dir, 'over');
  assert.equal(offsets(r, 'yday')[0].dir, 'short');
  assert.deepEqual(await sweep(r), [], 'הזוג כבר קוזז — סריקה שנייה לא מוסיפה');
});

test('כמויות משקל עם רעש נקודה צפה נחשבות שוות', async () => {
  const r = create();
  // 0.3 - 0.1 = 0.19999999999999998 · 1.2 - 1.0 = 0.19999999999999996
  r.run(`receipts = [mkRc('today', '28', [['w', 1.2, 1.0, 40]]), mkRc('yday', '27', [['w', 0.1, 0.3, 40]])];`);
  const applied = await sweep(r);
  assert.equal(applied.length, 1);
  assert.ok(Math.abs(applied[0][3] - 0.2) < 1e-9);
});

test('כמות שונה, או מוצר אחר באותו מחיר — לא מתקזזים לבד', async () => {
  const r = create();
  r.run(`receipts = [mkRc('today', '28', [['p1', 4, 3, 10], ['p2', 2, 0, 7]]), mkRc('yday', '27', [['p1', 3, 5, 10], ['p3', 0, 2, 7]])];`);
  assert.deepEqual(await sweep(r), []);
  assert.equal(r.run(`!!findOffsetMatch(receipts[0])`), true, 'מוצר אחר באותו מחיר נשאר הצעה לאישור ידני');
});

test('זוג שאחד מצדדיו מחוץ ל-9 התעודות האחרונות נשאר הצעה בלבד', async () => {
  const r = create();
  r.run(`receipts = [mkRc('today', '28', [['p1', 5, 3, 10]])].concat(fillers(8), [mkRc('old', '01', [['p1', 3, 5, 10]])]);`);
  assert.equal(r.run('receipts.length'), 10);
  assert.deepEqual(await sweep(r), []);
  assert.equal(r.run(`findOffsetMatch(receipts[0]).other.id`), 'old', 'עדיין מוצע לאישור בכרטיס התעודה');
  r.run(`receipts.splice(1, 1);`); // עכשיו התעודה הישנה היא התשיעית
  assert.deepEqual(await sweep(r), [['today', 'old', 'p1', 2]]);
});

test('קיזוז שבוטל במודע לא חוזר אוטומטית', async () => {
  const r = create();
  r.run(`receipts = [mkRc('today', '28', [['p1', 5, 3, 10]]), mkRc('yday', '27', [['p1', 3, 5, 10]])];
    receipts[0].canceledOffsetIds = [crossOffsetId('today', 'yday', 'p1')];`);
  assert.deepEqual(await sweep(r), []);
});
