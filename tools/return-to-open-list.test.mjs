// v363: החזרת חלק מפריטי תעודת חזרות אל רשימת החזרות הפתוחה.
// הבדיקה שולפת את הקוד מ-index.html עצמו ומריצה את מסלול השמירה האמיתי.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));

function setup(items, opts) {
  opts = opts || {};
  const c = runtime('yotvata');
  c.context.testDeleted = [];
  c.run(`
    currentView = 'returnsHistory';
    products = [
      { id: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', price: 6, creditPrice: 5, deposit: 0 },
      { id: 'p-bottle', name: 'בקבוק בדיקה', barcode: '7290000000015', price: 4, creditPrice: 4, deposit: 1.2 }
    ];
    returnsList = ${JSON.stringify(opts.openList || [])};
    returns = [{ id: 'ret-1', timestamp: Date.now(), docDate: '2026-09-19', credited: ${!!opts.credited}, totalExVat: 0, totalIncVat: 0, items: ${JSON.stringify(items)} }];
    hardDeleteDocWithBackup = async (name, id, backup) => { testDeleted.push({ name, id, backup }); return true; };
    renderReturnsHistory = () => {}; renderReceiptsHistory = () => {}; refreshReturnsList = () => {}; updateCart = () => {}; logAction = async () => {};
  `);
  return c;
}
const lines = c => json(c, "returns[0].items.filter(l => !l.isDeposit && (Number(l.qty) || 0) > 0)");
const apply = (c, takes) => c.run('retReturnApply("ret-1", returns[0].items.filter(l => !l.isDeposit && (Number(l.qty) || 0) > 0), ' + JSON.stringify(takes) + ', null)');

test('חלק מהכמות חוזר — התעודה יורדת, הפיקדון הצמוד יורד, והפריט נכנס לרשימה הפתוחה', async () => {
  const c = setup([
    { name: 'חלב בדיקה', barcode: '7290000000008', qty: 6, unitPrice: 5, lineTotal: 30 },
    { name: 'בקבוק בדיקה', barcode: '7290000000015', qty: 4, unitPrice: 4, lineTotal: 16 },
    { name: 'פיקדון · בקבוק בדיקה', barcode: '', qty: 4, unitPrice: 1.2, lineTotal: 4.8, isDeposit: true }
  ]);
  assert.equal(lines(c).length, 2, 'שורת הפיקדון לא מוצעת להחזרה בנפרד');
  await apply(c, [2, 3]);

  const write = json(c, 'testWrites.find(w => w.op === "update" && w.data && w.data.items)');
  assert.deepEqual(write.data.items.map(l => [l.name, l.qty, l.lineTotal]), [
    ['חלב בדיקה', 4, 20],
    ['בקבוק בדיקה', 1, 4],
    ['פיקדון · בקבוק בדיקה', 1, 1.2]
  ]);
  // תעודות חזרה ביטבתה נשמרות ללא מע״מ — שני הסכומים שווים
  assert.equal(write.data.totalExVat, 25.2);
  assert.equal(write.data.totalIncVat, 25.2);
  assert.deepEqual(json(c, 'returns[0].items.map(l => l.qty)'), [4, 1, 1], 'הרשומה בזיכרון עודכנה יחד עם הענן');

  const open = json(c, 'returnsList');
  assert.deepEqual(open.map(it => [it.productId, it.qty, !!it.manual]), [['p-milk', 2, false], ['p-bottle', 3, false]],
    'הפריטים חוזרים כשורות מוצר רגילות לפי ברקוד — הפיקדון יתווסף שוב בשליחה');
  assert.equal(json(c, 'testDeleted.length'), 0);
  assert.match(json(c, 'testToasts.at(-1)'), /5 יח׳ חזרו לרשימה הפתוחה/);
});

test('פריט שכבר ברשימה הפתוחה מקבל תוספת כמות במקום שורה כפולה', async () => {
  const c = setup(
    [{ name: 'חלב בדיקה', barcode: '7290000000008', qty: 6, unitPrice: 5, lineTotal: 30 }],
    { openList: [{ productId: 'p-milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 1 }] }
  );
  await apply(c, [3]);
  assert.deepEqual(json(c, 'returnsList.map(it => [it.productId, it.qty])'), [['p-milk', 4]]);
});

test('החזרת הכל — התעודה נמחקת לסל המחזור עם גיבוי, בלי כתיבת עדכון', async () => {
  const c = setup([
    { name: 'חלב בדיקה', barcode: '7290000000008', qty: 2, unitPrice: 5, lineTotal: 10 },
    { name: 'בקבוק בדיקה', barcode: '7290000000015', qty: 1, unitPrice: 4, lineTotal: 4 },
    { name: 'פיקדון · בקבוק בדיקה', barcode: '', qty: 1, unitPrice: 1.2, lineTotal: 1.2, isDeposit: true }
  ]);
  await apply(c, [2, 1]);
  assert.equal(json(c, 'testWrites.filter(w => w.op === "update" && w.data && w.data.items).length'), 0);
  const del = json(c, 'testDeleted');
  assert.equal(del.length, 1);
  assert.equal(del[0].name, 'returns');
  assert.equal(del[0].id, 'ret-1');
  assert.equal(del[0].backup.items.length, 3, 'הגיבוי שומר את התעודה המקורית כולל הפיקדון');
  assert.deepEqual(json(c, 'returnsList.map(it => [it.productId, it.qty])'), [['p-milk', 2], ['p-bottle', 1]]);
});

test('שורה ללא מוצר במערכת ותביעת זיכוי שהועברה חוזרות כשורות ידניות עם מחיר הזיכוי', async () => {
  const c = setup([
    { name: 'מוצר לא מוכר', barcode: '5740900403239', qty: 3, unitPrice: 7.5, lineTotal: 22.5 },
    { name: 'חלב בדיקה', barcode: '7290000000008', qty: 2, unitPrice: 4.1, lineTotal: 8.2, carriedClaim: true }
  ]);
  await apply(c, [1, 2]);
  const open = json(c, 'returnsList');
  assert.equal(open.length, 2);
  assert.equal(open[0].manual, true);
  assert.equal(open[0].name, 'מוצר לא מוכר');
  assert.equal(open[0].unitPrice, 7.5);
  assert.equal(open[0].qty, 1);
  assert.equal(open[1].manual, true, 'תביעת זיכוי לא הופכת לשורת מוצר רגילה גם כשהברקוד מוכר');
  assert.equal(open[1].carried, true);
  assert.equal(open[1].unitPrice, 4.1);
  const write = json(c, 'testWrites.find(w => w.op === "update" && w.data && w.data.items)');
  assert.deepEqual(write.data.items.map(l => [l.name, l.qty, !!l.carriedClaim]), [['מוצר לא מוכר', 2, false]]);
});

test('כשהענן נכשל — התעודה והרשימה הפתוחה לא זזות', async () => {
  const c = setup([{ name: 'חלב בדיקה', barcode: '7290000000008', qty: 6, unitPrice: 5, lineTotal: 30 }]);
  c.run('runCloudTask = async () => false;');
  await apply(c, [2]);
  assert.equal(json(c, 'returns[0].items[0].qty'), 6);
  assert.deepEqual(json(c, 'returnsList'), []);
});

test('תעודה מאומתת — אין החזרה, גם אם קוראים ישירות', async () => {
  const c = setup([{ name: 'חלב בדיקה', barcode: '7290000000008', qty: 6, unitPrice: 5, lineTotal: 30 }], { credited: true });
  c.run('openRetReturnPicker("ret-1")');
  assert.match(json(c, 'testToasts.at(-1)'), /תעודה מאומתת/);
  await apply(c, [2]);
  assert.equal(json(c, 'returns[0].items[0].qty'), 6);
  assert.deepEqual(json(c, 'returnsList'), []);
  assert.equal(json(c, 'testWrites.filter(w => w.op === "update").length'), 0);
});

test('הכפתור מופיע רק בתעודה שטרם אומתה, בשני מסכי התעודות', () => {
  const c = setup([{ name: 'חלב בדיקה', barcode: '7290000000008', qty: 6, unitPrice: 5, lineTotal: 30 }]);
  const openHtml = c.run('returnCardInReceipts(returns[0])');
  assert.match(openHtml, /data-role="ret-return-open" data-id="ret-1"/);
  c.run('returns[0].credited = true; returns[0].creditNoteTotal = 30;');
  const closedHtml = c.run('returnCardInReceipts(returns[0])');
  assert.doesNotMatch(closedHtml, /ret-return-open/);
});
