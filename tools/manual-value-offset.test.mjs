// v375: קיזוז לפי שווי ("מצא קיזוז") בין שני מוצרים שמחיר היחידה שלהם נבדל
// בשבר אגורה אינו משאיר שארית. דיווח מהשטח (1.10.2026, v374): 12 "שוקו בננה
// פקק" חסרו (₪3.161667 — 37.94 ÷ 12 מהנייר) ו-12 "פונצ בננה פקק" הגיעו בעודף
// (₪3.162 — מחיר המבצע). הקיזוז של ₪37.94 נשמר בצד העודף כ-37.94 ÷ 3.162 =
// 11.998735 יח׳, ונשארו 0.001265 יח׳: "עודף: פונצ בננה פקק · יתרה בשווי ₪0.00 ·
// ₪0.00" עם "מצא קיזוז", והתעודה נשארה פתוחה על עודף שכבר קוזז.
// הרצה: node --test tools/manual-value-offset.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const offsetButtons = html => [...html.matchAll(/rc-offset-choose" data-id="[^"]+" data-product="([^"]+)" data-dir="(short|over)"/g)].map(m => m[2] + ':' + m[1]);
function diffBox(html) {
  const i = html.indexOf('הפרשים מול התעודה');
  if (i < 0) return '';
  return strip(html.slice(i, html.indexOf('</div>', html.indexOf('לתשלום ₪', i))));
}

// השורות כמו בתעודה מהשטח: המחיר של שוקו בננה נגזר מהנייר (₪37.94 ÷ 12),
// ופונצ בננה שלא חויב קיבל את מחיר המבצע (₪3.72 פחות 15%).
const ACTIMEL = { productId: 'prod_71', name: 'אקטימל תות שמינייה (864 גרם)', qty: 0, noteQty: 3, unitPrice: 15.04, lineTotal: 0 };
const BANANA = { productId: 'prod_61', name: 'שוקו בננה פקק', qty: 0, noteQty: 12, unitPrice: 37.94 / 12, lineTotal: 0 };
const PUNCH = { productId: 'prod_62', name: 'פונצ בננה פקק', qty: 12, noteQty: 0, unitPrice: 3.162, lineTotal: 37.94 };
const SHOKO = { productId: 'prod_60', name: 'שוקו פקק', qty: 12, noteQty: null, unitPrice: 37.94 / 12, lineTotal: 37.94 };
function receipt(lines, overrides = {}) {
  const paper = Math.round(lines.reduce((a, l) => a + l.unitPrice * (l.noteQty != null ? l.noteQty : l.qty), 0) * 100) / 100;
  const units = lines.reduce((a, l) => a + (l.noteQty != null ? l.noteQty : l.qty), 0);
  const scanned = Math.round(lines.reduce((a, l) => a + l.lineTotal, 0) * 100) / 100;
  return { id: 'rc-1', timestamp: Date.parse('2026-10-01T12:35:06+03:00'), date: '2026-10-01', status: 'open',
    noteParts: [{ amount: paper, units }], noteTotalInc: paper, totalExVat: scanned, totalIncVat: scanned, count: lines.length,
    unresolvedAmountGap: 0, unresolvedUnitsGap: 0, items: lines.map(l => structuredClone(l)), ...overrides };
}
// שתי הרשומות שנשמרו בתעודה מהשטח, כפי שהן בגיבוי.
const GROUP = 'xov3|1790847351568|eb6knc|rc-1|rc-1';
const FIELD_OFFSETS = [
  { id: GROUP + '|short|rc-1|prod_61', groupId: GROUP, otherId: 'rc-1', productId: 'prod_61', name: BANANA.name, qty: 12, dir: 'short', at: 1790847351569, source: 'manual-value', amountEx: 37.94,
    shortName: BANANA.name, overName: PUNCH.name, shortProductId: 'prod_61', overProductId: 'prod_62' },
  { id: GROUP + '|over|rc-1|prod_62', groupId: GROUP, otherId: 'rc-1', productId: 'prod_62', name: PUNCH.name, qty: 11.998735, dir: 'over', at: 1790847351569, source: 'manual-value', amountEx: 37.94,
    shortName: BANANA.name, overName: PUNCH.name, shortProductId: 'prod_61', overProductId: 'prod_62' }
];
function load(rc, view = 'receiving') {
  const c = harness.runtime('yotvata');
  c.context.fixture = rc;
  c.run(`receipts = [fixture]; returns = []; currentView = '${view}';`);
  if (view === 'receiptsHistory') c.run('renderReceiptsHistory()');
  return c;
}
const state = c => json(c, `(di => ({ open: di.open, short: di.shortItems.map(x => x.productId + ':' + x.n), over: di.overItems.map(x => x.productId + ':' + x.n),
  shortValRaw: di.shortValRaw, overVal: di.overVal, payable: receiptPayableBaseEx(receipts[0]), bucket: receiptFilterBucket(receipts[0]) }))(receiptDiscrepancyInfo(receipts[0]))`);
async function valueOffset(c, amount) {
  await c.run(`applyManualValueOffset(findOpenOffsetSide('rc-1', 'prod_61', 'short'), findOpenOffsetSide('rc-1', 'prod_62', 'over'), ${amount})`);
  return json(c, 'receipts[0].externalOffsets.map(x => [x.dir, x.productId, x.qty, x.amountEx])');
}

test('התעודה מהשטח: הקיזוז שכבר נשמר סוגר את פונצ בננה עד הסוף, ורק האקטימל נשאר פתוח', () => {
  const rc = receipt([ACTIMEL, BANANA, PUNCH, SHOKO], { externalOffsets: structuredClone(FIELD_OFFSETS) });
  const c = load(rc, 'receiptsHistory');
  const html = c.node('app').innerHTML;
  assert.equal(diffBox(html), 'הפרשים מול התעודה חסר: אקטימל תות שמינייה (864 גרם) חויב בתעודה 3 · נסרק בפועל 0 · חסר 3 יח׳ · ₪45.12 מצא קיזוז תעודת ספק ₪121.00 · לתשלום ₪75.88');
  assert.deepEqual(offsetButtons(html), ['short:prod_71'], 'אין עוד "מצא קיזוז" על עודף של ₪0.00');
  assert.ok(!html.includes('יתרה בשווי ₪0.00'));
  assert.ok(strip(html).includes('קיזוז ידני: שוקו בננה פקק ⇄ פונצ בננה פקק · ₪37.94'), 'הקיזוז עצמו מוצג כמו קודם');
  // הכסף לא זז: הנייר פחות האקטימל החסר — כמו לפני התיקון. רק השארית נעלמה.
  assert.deepEqual(state(c), { open: true, short: ['prod_71:3'], over: [], shortValRaw: 45.12, overVal: 0, payable: 75.88, bucket: 'attention' });
  assert.equal(c.run("findOpenOffsetSide('rc-1', 'prod_62', 'over')"), null);
  // התיקון בקריאה בלבד — הרשומה השמורה לא משתנה.
  assert.deepEqual(json(c, 'receipts[0]'), rc);
});

test('בלי האקטימל — אותה תעודה נסגרת ומסומנת "אומתה · קיזוז מאושר"', () => {
  const rc = receipt([BANANA, PUNCH, SHOKO], { externalOffsets: structuredClone(FIELD_OFFSETS) });
  const c = load(rc, 'receiptsHistory');
  const html = c.node('app').innerHTML;
  assert.equal(diffBox(html), '');
  assert.ok(strip(html).includes('אומתה · קיזוז מאושר'));
  assert.ok(strip(html).includes('כל ההפרשים בתעודה הזאת טופלו ✓'));
  assert.deepEqual(state(c), { open: false, short: [], over: [], shortValRaw: 0, overVal: 0, payable: 75.88, bucket: 'done' });
});

test('קיזוז חדש לפי מלוא השווי נשמר כ-12 מול 12 ולא כ-11.998735', async () => {
  const c = load(receipt([BANANA, PUNCH, SHOKO]));
  assert.deepEqual(state(c), { open: true, short: ['prod_61:12'], over: ['prod_62:12'], shortValRaw: 37.94, overVal: 37.94, payable: 37.94, bucket: 'attention' });
  assert.deepEqual(await valueOffset(c, 37.94), [['short', 'prod_61', 12, 37.94], ['over', 'prod_62', 12, 37.94]]);
  assert.match(c.toasts.at(-1), /הקיזוז אושר — ₪37\.94 נוספו לתשלום במודע/);
  // שווי הקיזוז נוסף לתשלום — ושום דבר לא נשאר פתוח.
  assert.deepEqual(state(c), { open: false, short: [], over: [], shortValRaw: 0, overVal: 0, payable: 75.88, bucket: 'done' });
  const batch = c.writes.at(-1);
  assert.equal(batch.op, 'batch');
  assert.deepEqual(batch.writes.map(w => w.data.externalOffsets.map(x => x.qty)), [[12, 12]], 'אותה תעודה — כתיבה אחת עם שני הצדדים');
});

test('כשהעודף הוא הצד עם המחיר המדויק יותר — השארית בצד החוסר נסגרת גם היא, והתשלום לא זז', async () => {
  // הנייר חייב 12 פונצ בננה (₪3.162) שלא הגיעו, ובמקומם הגיעו 12 שוקו בננה שלא חויבו.
  const punchShort = { ...PUNCH, qty: 0, noteQty: 12, lineTotal: 0 };
  const bananaOver = { ...BANANA, qty: 12, noteQty: 0, lineTotal: 37.94 };
  const c = load(receipt([punchShort, bananaOver, SHOKO]));
  await c.run(`applyManualValueOffset(findOpenOffsetSide('rc-1', 'prod_62', 'short'), findOpenOffsetSide('rc-1', 'prod_61', 'over'), 37.94)`);
  assert.deepEqual(json(c, 'receipts[0].externalOffsets.map(x => [x.dir, x.productId, x.qty])'), [['short', 'prod_62', 12], ['over', 'prod_61', 12]]);
  assert.deepEqual(state(c), { open: false, short: [], over: [], shortValRaw: 0, overVal: 0, payable: 75.88, bucket: 'done' });
  // ואותו דבר לרשומה ישנה שנשמרה עם 11.998735 בצד החוסר.
  const old = load(receipt([punchShort, bananaOver, SHOKO], { externalOffsets: [
    { ...FIELD_OFFSETS[0], id: GROUP + '|short|rc-1|prod_62', productId: 'prod_62', name: PUNCH.name, qty: 11.998735 },
    { ...FIELD_OFFSETS[1], id: GROUP + '|over|rc-1|prod_61', productId: 'prod_61', name: BANANA.name, qty: 12 }] }));
  assert.deepEqual(state(old), { open: false, short: [], over: [], shortValRaw: 0, overVal: 0, payable: 75.88, bucket: 'done' });
});

test('קיזוז חלקי לפי שווי משאיר את היתרה האמיתית פתוחה', async () => {
  const c = load(receipt([BANANA, PUNCH, SHOKO]));
  assert.deepEqual(await valueOffset(c, 20), [['short', 'prod_61', 6.325778, 20], ['over', 'prod_62', 6.325111, 20]]);
  const s = state(c);
  assert.equal(s.open, true);
  assert.deepEqual([s.shortValRaw, s.overVal, s.payable], [17.94, 17.94, 57.94]);
  assert.equal(c.run("offsetSideQtyText(findOpenOffsetSide('rc-1', 'prod_62', 'over'))"), 'יתרה בשווי ₪17.94');
});

test('יתרה של אגורה אחת אינה שארית — רק פחות מחצי אגורה נסגר', async () => {
  const c = load(receipt([BANANA, PUNCH, SHOKO]));
  await valueOffset(c, 37.93);
  const s = state(c);
  assert.equal(s.open, true);
  assert.deepEqual([s.shortValRaw, s.overVal], [0.01, 0.01]);
  assert.equal(c.run("offsetSideQtyText(findOpenOffsetSide('rc-1', 'prod_62', 'over'))"), 'יתרה בשווי ₪0.01');
});

test('שארית בשורה שאינה מקיזוז לפי שווי לא נסגרת — הכלל חל רק על קיזוז לפי שווי', () => {
  // קיזוז כמות רגיל ("אשר קיזוז לפריט הזה") של 11.99 ק״ג מתוך 12 משאיר 0.01 — הוא לא נבלע.
  const w = { productId: 'w', name: 'גבינה במשקל', qty: 0, noteQty: 12, unitPrice: 0.3, lineTotal: 0 };
  const c = load(receipt([w], { externalOffsets: [{ id: 'xo2|rc-0|rc-1|w', otherId: 'rc-0', productId: 'w', name: w.name, qty: 11.99, dir: 'short', at: 1, source: 'manual' }] }));
  assert.deepEqual(state(c).short, ['w:0.01']);
});
