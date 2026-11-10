// v406: תעודת חזרה נכנסת לדוח התשלום לפי יום אימות הזיכוי, לא לפי יום השליחה.
// בעל העסק השווה את דוח אוקטובר לחשבונית הספק: ההחזרה שנשלחה לנהג ב-31.10 ואומתה
// ב-1.11 נספרה אצלנו באוקטובר, ואצל הספק היא בחשבונית נובמבר. הבדיקות מקבעות:
// חזרה שאומתה — לפי יום הזיכוי; חזרה שטרם אומתה — לפי יום השליחה; "שנה תאריך"
// אחרי האימות גובר; הרשימה בדוח מציגה את יום הזיכוי ומציינת את יום השליחה.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtime } from './receipt-scan-harness.mjs';

const at = s => new Date(s).getTime();
const he = s => new Date(s + 'T12:00:00').toLocaleDateString('he-IL').replace(/\./g, '\\.');
const ret = (over = {}) => ({ id: 'ret', timestamp: at('2026-10-31T19:16:09'), sentTo: 'סאמר',
  items: [{ name: 'מילקי', barcode: '72940761', qty: 1, unitPrice: 104.61, lineTotal: 104.61 }],
  totalExVat: 104.61, totalIncVat: 104.61,
  credited: true, creditedAt: at('2026-11-01T08:04:45'), creditNoteTotal: 104.61, creditStatus: 'ok', ...over });
function setup(rets, recs = []) {
  const c = runtime('yotvata', { handoff: false });
  c.context.testRets = rets; c.context.testRecs = recs;
  c.run('receipts = testRecs; returns = testRets; promos = []; promoArchive = []; VAT = 0.18;');
  return c;
}
const range = (c, from, to) => c.run(`receiptRangeData('${from}', '${to}')`);
const october = c => range(c, '2026-10-01', '2026-10-31');
const november = c => range(c, '2026-11-01', '2026-11-30');

test('חזרה שנשלחה ב-31.10 ואומתה ב-1.11 נכנסת לדוח נובמבר ולא לדוח אוקטובר', () => {
  const c = setup([ret()]);
  assert.equal(october(c).rets.length, 0);
  assert.equal(october(c).retEx, 0);
  assert.equal(november(c).rets.length, 1);
  assert.equal(november(c).retEx, 104.61);
  assert.equal(november(c).netEx, -104.61);
  assert.equal(november(c).netInc, -123.44);
});

test('חזרה שטרם אומתה נשארת לפי יום השליחה, ועוברת לחודש הזיכוי ברגע שאומתה', () => {
  const c = setup([ret({ credited: false, creditedAt: null, creditNoteTotal: null, creditStatus: null })]);
  assert.equal(october(c).retEx, 104.61);
  assert.equal(november(c).retEx, 0);
  c.run("Object.assign(returns[0], { credited: true, creditedAt: " + at('2026-11-01T08:04:45') + ", creditNoteTotal: 104.61, creditStatus: 'ok' })");
  assert.equal(october(c).retEx, 0);
  assert.equal(november(c).retEx, 104.61);
});

test('שליחה ואימות באותו יום — החזרה נשארת באותו חודש כמו קודם', () => {
  const c = setup([ret({ creditedAt: at('2026-10-31T21:00:00') })]);
  assert.equal(october(c).retEx, 104.61);
  assert.equal(november(c).retEx, 0);
});

test('תאריך שנשמר ב"שנה תאריך" אחרי האימות גובר על יום הזיכוי', () => {
  const c = setup([ret({ timestamp: at('2026-10-30T19:16:09'), date: '2026-10-30',
    originalTimestamp: at('2026-10-31T19:16:09'), dateChangedAt: at('2026-11-02T10:00:00') })]);
  assert.equal(october(c).retEx, 104.61);
  assert.equal(november(c).retEx, 0);
});

test('תאריך ששונה לפני האימות אינו גובר — יום הזיכוי קובע', () => {
  const c = setup([ret({ timestamp: at('2026-10-30T19:16:09'), date: '2026-10-30',
    originalTimestamp: at('2026-10-31T19:16:09'), dateChangedAt: at('2026-10-31T22:00:00') })]);
  assert.equal(october(c).retEx, 0);
  assert.equal(november(c).retEx, 104.61);
});

test('רשימת התעודות בדוח מציגה את החזרה ביום הזיכוי ומציינת את יום השליחה', () => {
  const c = setup([ret()]);
  const html = c.run("receiptRangeDocsListHtml(receiptRangeData('2026-11-01', '2026-11-30'))");
  assert.match(html, new RegExp('חזרה · ' + he('2026-11-01') + '<'));
  assert.match(html, new RegExp('1 פריטים · נשלחה ' + he('2026-10-31') + ' · סאמר · '));
  assert.match(html, /−₪104\.61/);
  const same = setup([ret({ creditedAt: at('2026-10-31T21:00:00') })]);
  const sameHtml = same.run("receiptRangeDocsListHtml(receiptRangeData('2026-10-01', '2026-10-31'))");
  assert.match(sameHtml, new RegExp('חזרה · ' + he('2026-10-31') + '<'));
  assert.doesNotMatch(sameHtml, /נשלחה/);
});

test('כותרת הדוח אומרת שהחזרות לפי יום אימות הזיכוי, והכרטיס מציין את יום הזיכוי כשהוא שונה מתאריך התעודה', () => {
  const c = setup([ret()]);
  c.run("promoHistoryReady = true; promoHistoryLoaded.archive = true; promoHistoryError = '';");
  c.node('rcFrom').value = '2026-11-01'; c.node('rcTo').value = '2026-11-30';
  c.run('calcReceiptRange()');
  assert.match(c.node('rcRangeResult').innerHTML, /0 תעודות קליטה · 1 תעודות חזרה <span class="text-slate-400">\(לפי יום אימות הזיכוי\)<\/span>/);
  const box = c.run("docDateEditorInnerHtml('return', returns[0])");
  assert.match(box, new RegExp('תאריך התעודה: <b class="text-slate-700">' + he('2026-10-31') + '</b>'));
  assert.match(box, new RegExp('\\(בדוח: ' + he('2026-11-01') + ' — יום הזיכוי\\)'));
  c.run("receiptDateEdit = { kind: 'return', id: 'ret' }");
  assert.match(c.run("docDateEditorInnerHtml('return', returns[0])"), /חזרה שאומתה נכללת בדוח התשלום לפי יום אימות הזיכוי, כמו בחשבונית הספק; תאריך שנשמר כאן אחרי האימות גובר עליו/);
  const same = setup([ret({ creditedAt: at('2026-10-31T21:00:00') })]);
  assert.doesNotMatch(same.run("docDateEditorInnerHtml('return', returns[0])"), /בדוח:/);
  same.run("receiptDateEdit = { kind: 'receipt', id: 'rc' }");
  assert.match(same.run("docDateEditorInnerHtml('receipt', { id: 'rc', timestamp: " + at('2026-10-31T10:00:00') + " })"), /התאריך קובע באיזה דוח תשלום התעודה נכללת ולפי איזה יום נבדקים המבצעים/);
});

test('הגרסה עלתה (406 ומעלה), כולל ה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '413'/); // גרסה 413: הסימון במצלמה מחזיר לשורה
  assert.match(html, /APP_VERSION_LABEL = 'v' \+ APP_VERSION \+ '_scan_return'/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v413/);
});
