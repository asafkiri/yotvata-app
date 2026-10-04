import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

function setup(status = 'payment_offset') {
  const c = runtime('yotvata');
  c.run(`receipts = [{id:'receipt', date:'2026-09-20',
    timestamp:new Date('2026-09-20T12:00:00').getTime(),
    noteTotalInc:100, totalExVat:100, items:[],
    supplierCreditClaim:{status:${JSON.stringify(status)}, amount:9.55,
      receivedAmount:${status === 'open' ? 0 : 9.55},
      verifiedAt:new Date('2026-10-01T12:00:00').getTime(), verifiedMonth:'2026-10'}}];
    returns=[]; promos=[];`);
  return c;
}
const range = (c, from, to) => c.run(`receiptRangeData('${from}', '${to}')`);

test('existing October payment offset reduces September once, including VAT', () => {
  const c = setup();
  const september = range(c, '2026-09-01', '2026-09-30');
  const october = range(c, '2026-10-01', '2026-10-31');
  const combined = range(c, '2026-09-01', '2026-10-31');
  assert.equal(september.netEx, 90.45);
  assert.equal(september.netInc, 106.73);
  assert.equal(september.paymentOffsetEx, 9.55);
  assert.equal(october.verifiedSupplierCreditEx, 0);
  assert.equal(october.netInc, 0);
  assert.equal(combined.netInc, september.netInc + october.netInc);
  const html = c.run("supplierCalculationStepsHtml(receiptRangeData('2026-09-01','2026-09-30'))");
  assert.match(html, /פחות קיזוזים בתשלום/);
  assert.doesNotMatch(html, /פחות זיכויי מבצע שהתקבלו מהספק/);
});

test('supplier credit received in October stays in October', () => {
  const c = setup('verified');
  assert.equal(range(c, '2026-09-01', '2026-09-30').netInc, 118);
  const october = range(c, '2026-10-01', '2026-10-31');
  assert.equal(october.verifiedStatementCreditEx, 9.55);
  assert.equal(october.paymentOffsetEx, 0);
  assert.equal(october.netInc, -11.27);
});

test('marking an open claim as payment offset does not deduct it twice', async () => {
  const c = setup('open');
  const before = range(c, '2026-09-01', '2026-09-30');
  await c.run("setReceiptSupplierCreditStatus('receipt','payment_offset',{note:'קיזוז מוסכם'})");
  // Apply the committed update as the Firestore snapshot listener does.
  assert.equal(c.writes.length, 1);
  c.run('Object.assign(receipts[0], testWrites[0].data)');
  const after = range(c, '2026-09-01', '2026-09-30');
  assert.equal(after.netInc, before.netInc);
  assert.equal(after.pendingSupplierCreditEx, 0);
  assert.equal(after.paymentOffsetEx, 9.55);
  assert.equal(c.run('receipts[0].supplierCreditClaim.verifiedMonth'), '2026-09');
});

test('payment offsets and actual credit notes have separate summary rows', () => {
  const c = setup();
  c.run(`receipts.push({...receipts[0],id:'second',
    supplierCreditClaim:{status:'verified',amount:5,receivedAmount:5,
      verifiedAt:new Date('2026-09-28T12:00:00').getTime()}})`);
  const d = range(c, '2026-09-01', '2026-09-30');
  assert.equal(d.netEx, 185.45);
  assert.equal(d.verifiedStatementCreditEx, 5);
  assert.equal(d.paymentOffsetEx, 9.55);
  const html = c.run("supplierCalculationStepsHtml(receiptRangeData('2026-09-01','2026-09-30'))");
  assert.match(html, /פחות קיזוזים בתשלום/);
  assert.match(html, /פחות זיכויי מבצע שהתקבלו מהספק/);
});
