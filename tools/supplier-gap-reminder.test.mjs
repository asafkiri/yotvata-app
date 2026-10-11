// The supplier receives receiving-shortage reminders only with returns. Exercise
// the real message builders and send paths with the complete application harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';
import { attachReturns } from './returns-events-harness.mjs';

const MILK = { productId: 'missing-milk', name: 'חלב חסר לבדיקה', barcode: '7290000000077', qty: 0, noteQty: 8, unitPrice: 5, lineTotal: 0 };
function receipt(overrides = {}) {
  return { id: 'receipt-1', date: '2026-10-08', timestamp: Date.parse('2026-10-08T09:00:00+03:00'),
    status: 'open', noteParts: [{ amount: 40, units: 8 }], noteTotalInc: 40,
    totalExVat: 0, totalIncVat: 0, unresolvedAmountGap: 0, unresolvedUnitsGap: 0,
    items: [structuredClone(MILK)], priceAudit: { documents: [{ index: 0, number: 'INV-81742', date: '2026-10-08' }] },
    ...overrides };
}
function setup(receipts = [receipt()], returns = []) {
  const c = runtime('yotvata');
  c.context.reminderFixture = structuredClone({ receipts, returns });
  c.run(`receipts=reminderFixture.receipts;returns=reminderFixture.returns;
    window.location={href:''};contacts=[];appOrders=[];appOrdersChanges=[];logAction=()=>{};`);
  return c;
}
const note = c => c.run('supplierGapWhatsappNote()');
const plain = text => text.replace(/\*/g, '');
const outgoing = c => new URL(c.run('window.location.href')).searchParams.get('text');
const qty = (text, count) => new RegExp('(?:^|[^0-9])' + count + '\\s*(?:יח|יחידות)', 'u').test(plain(text));
const deliveryCredit = (count, amount) => ({ id: 'credit-1', source: 'delivery_credit_scan', number: 'CN-1924', amount,
  rows: [{ productId: MILK.productId, name: MILK.name, barcode: MILK.barcode, qty: count, amount }] });

test('receiving shortage includes product, barcode, quantity, date, known document and value without mutating records', () => {
  const c = setup();
  const before = c.run('JSON.stringify(receipts)');
  const text = note(c);
  assert.match(text, /חלב חסר לבדיקה/);
  assert.match(text, /7290000000077/);
  assert.ok(qty(text, 8), text);
  assert.match(text, /INV-81742/);
  assert.match(text, /8[./]10[./]2026|08[./]10[./]2026|2026-10-08/);
  assert.match(text, /40\.00/);
  assert.match(text, /ללא מע[״"']?מ/);
  assert.equal(c.run('JSON.stringify(receipts)'), before);
});

test('shortages from two receiving records are kept separate and add up', () => {
  const extra = { productId: 'missing-coffee', name: 'קפה חסר לבדיקה', barcode: '7290000000084', qty: 0, noteQty: 3, unitPrice: 7, lineTotal: 0 };
  const c = setup([receipt(), receipt({ id: 'receipt-2', date: '2026-10-09', timestamp: Date.parse('2026-10-09T09:00:00+03:00'),
    items: [extra], noteParts: [{ amount: 21, units: 3 }], noteTotalInc: 21,
    priceAudit: { documents: [{ index: 0, number: 'INV-81743', date: '2026-10-09' }] } })]);
  const text = note(c);
  for (const expected of ['חלב חסר לבדיקה', 'קפה חסר לבדיקה', '7290000000084', 'INV-81742', 'INV-81743', '61.00']) assert.ok(text.includes(expected), expected + ': ' + text);
  assert.ok(qty(text, 8) && qty(text, 3), text);
});

test('unapproved surplus does not silently cancel a genuine shortage in the reminder', () => {
  const c = setup([receipt({ items: [MILK, { productId: 'surplus', name: 'עודף שאינו קיזוז', qty: 10, noteQty: 0, unitPrice: 5, lineTotal: 50 }], totalExVat: 50 })]);
  assert.equal(c.run('receiptsBalance().bal'), -10, 'the existing account banner has a net balance');
  const text = note(c);
  assert.match(text, /חלב חסר לבדיקה/);
  assert.match(text, /40\.00/);
  assert.doesNotMatch(text, /עודף שאינו קיזוז/);
});

test('fully credited, delivered, approved-offset, balanced and undocumented receipts do not reappear', () => {
  const cases = [
    receipt({ shortCreditNotes: [deliveryCredit(8, 40)] }),
    receipt({ shortCreditNotes: [{ amount: 40, number: 'general-credit' }] }),
    receipt({ shortGoodsNotes: [{ productId: MILK.productId, qty: 8, price: 5 }] }),
    receipt({ externalOffsets: [{ id: 'offset-1', otherId: 'receipt-0', productId: MILK.productId, qty: 8, dir: 'short', source: 'manual' }] }),
    receipt({ items: [{ ...MILK, qty: 8, lineTotal: 40 }], totalExVat: 40 }),
    receipt({ noDoc: true, noteParts: [] })
  ];
  for (const rc of cases) assert.equal(note(setup([rc])), '', JSON.stringify(rc));
});

test('product-linked partial credit reduces the open quantity and amount', () => {
  const c = setup([receipt({ shortCreditNotes: [deliveryCredit(5, 25)] })]);
  const text = note(c);
  assert.match(text, /חלב חסר לבדיקה/);
  assert.ok(qty(text, 3), text);
  assert.ok(!qty(text, 8), 'the already credited five units must not be requested again: ' + text);
  assert.match(text, /15\.00/);
});

test('general monetary credit remains separate from identifiable product quantities', () => {
  const c = setup([receipt({ shortCreditNotes: [{ amount: 10, number: 'general-credit' }] })]);
  const text = note(c);
  assert.match(text, /פירוט החוסר לפני הזיכוי הכספי הכללי/);
  assert.ok(qty(text, 8), text);
  assert.ok(!qty(text, 6), 'a monetary credit cannot be assumed to cover two specific units: ' + text);
  for (const amount of ['40.00', '10.00', '30.00']) assert.ok(text.includes(amount), amount + ': ' + text);
});

test('same product at two prices keeps the complete remaining money after a linked credit', () => {
  const c = setup([receipt({ items: [{ ...MILK, noteQty: 4 }, { ...MILK, noteQty: 4, unitPrice: 7 }],
    noteTotalInc: 48, noteParts: [{ amount: 48, units: 8 }], shortCreditNotes: [deliveryCredit(4, 20)] })]);
  const text = note(c);
  assert.ok(qty(text, 4), text);
  assert.match(text, /חלב חסר לבדיקה[^\n]*28\.00/);
  assert.doesNotMatch(text, /חלב חסר לבדיקה[^\n]*20\.00/);
});

test('manual value offset displays its financial remainder without inventing fractional units', () => {
  const c = setup([receipt({ externalOffsets: [{ id: 'value-offset-1', productId: MILK.productId, dir: 'short',
    qty: 3.4, source: 'manual-value', amountEx: 17 }] })]);
  const text = note(c);
  assert.match(text, /חלב חסר לבדיקה/);
  assert.match(text, /23\.00/);
  assert.match(text, /יתרה כספית/);
  assert.ok(!qty(text, '4.6'), text);
});

test('all units credited at a lower amount leaves only money, including a separate general credit', () => {
  const c = setup([receipt({ shortCreditNotes: [deliveryCredit(8, 30), { number: 'general-credit', amount: 4 }] })]);
  const text = note(c);
  assert.ok(!qty(text, 8), text);
  assert.match(text, /יתרה כספית[^\n]*חלב חסר לבדיקה[^\n]*10\.00/);
  assert.match(text, /זיכוי כספי כללי[^\n]*4\.00/);
  assert.match(text, /יתרה לתעודה[^\n]*6\.00/);
});

test('invalid product-linked credit cannot hide an unrelated shortage', () => {
  const invalid = deliveryCredit(8, 40);
  invalid.rows[0].productId = 'another-product';
  const c = setup([receipt({ shortCreditNotes: [invalid] })]);
  const text = note(c);
  assert.ok(qty(text, 8), text);
  assert.match(text, /40\.00/);
});

test('an unassigned monetary gap is explicit and does not invent a missing product', () => {
  const c = setup([receipt({ items: [], noteParts: [{ amount: 18, units: 0 }], noteTotalInc: 18, unresolvedAmountGap: 18 })]);
  const text = note(c);
  assert.match(text, /18\.00/);
  assert.match(text, /פער כספי|פער סכום|טרם שויך|ללא שיוך/);
  assert.doesNotMatch(text, /חלב חסר לבדיקה/);
});

test('a missing free item still appears with its real quantity', () => {
  const c = setup([receipt({ items: [{ ...MILK, name: 'מוצר מתנה חסר', noteQty: 2, unitPrice: 0 }],
    noteParts: [{ amount: 0, units: 2 }], noteTotalInc: 0 })]);
  const text = note(c);
  assert.match(text, /מוצר מתנה חסר/);
  assert.ok(qty(text, 2), text);
});

test('returns-only checkbox is absent for new and repeated orders, present for returns', () => {
  const c = setup();
  c.run(`sendCtx={type:'order',resetCurrent:true};renderSendModal([{name:'הזמנה טרייה',amount:1,unit:'יחידות'}],'סיכום הזמנה','order')`);
  assert.doesNotMatch(c.node('sendSummary').innerHTML, /id="gapReminder"/);
  c.run(`openResend({items:[{name:'הזמנה חוזרת',amount:1,unit:'יחידות'}]})`);
  assert.doesNotMatch(c.node('sendSummary').innerHTML, /id="gapReminder"/);
  c.run(`openReturnsResend({items:[{name:'החזרה חדשה',barcode:'123',qty:1}]})`);
  assert.match(c.node('sendSummary').innerHTML, /id="gapReminder"/);
});

test('unchecked reminders and stale order checkboxes cannot append a reminder', () => {
  const c = setup();
  c.node('gapReminder').checked = true;
  c.run("sendCtx={type:'order'}");
  assert.equal(c.run("appendGapReminder('הזמנה')"), 'הזמנה');
  c.run("sendCtx={type:'returns'}");
  assert.match(c.run("appendGapReminder('חזרות')"), /חלב חסר לבדיקה/);
  c.node('gapReminder').checked = false;
  assert.equal(c.run("appendGapReminder('חזרות')"), 'חזרות');
});

test('actual new and repeated order send links never include receiving reminders', async () => {
  for (const resetCurrent of [true, false]) {
    const c = setup();
    c.node('gapReminder').checked = true; // a stale DOM element cannot reintroduce the duplicate
    c.run(`saveDraft=()=>{};finishDraft=async()=>true;setView=()=>{};
      sendCtx={type:'order',resetCurrent:${resetCurrent},items:[{name:'הזמנה טרייה',amount:1,unit:'יחידות'}]};`);
    await c.run("performSend({name:'ספק בדיקה',phone:'0500000000'})");
    const text = outgoing(c);
    assert.match(text, /הזמנת יטבתה/);
    assert.match(text, /הזמנה טרייה/);
    assert.doesNotMatch(text, /חלב חסר לבדיקה|תזכורת/);
  }
});

test('actual new returns and return resend links retain a single detailed reminder', async () => {
  for (const resend of [false, true]) {
    const c = setup();
    let engine;
    try {
      if (resend) c.run(`openReturnsResend({items:[{name:'החזרה חדשה',barcode:'123',qty:1}]})`);
      else {
        c.run(`returnsList=[{productId:'milk',name:'החזרה חדשה',barcode:'123',qty:1}];`);
        engine = await attachReturns(c);
        c.run('openReturnsSend()');
      }
      c.node('gapReminder').checked = true;
      await c.run("performSend({name:'ספק בדיקה',phone:'0500000000'})");
      const text = outgoing(c);
      assert.match(text, /חזרות \/ זיכוי/);
      assert.match(text, /החזרה חדשה/);
      assert.equal(text.split('חלב חסר לבדיקה').length - 1, 1, text);
      assert.match(text, /7290000000077/);
    } finally { engine?.stop(); }
  }
});

test('existing monetary reminder for a missing return credit is retained', () => {
  const c = setup([], [{ id: 'return-old', credited: true, totalExVat: 30, creditNoteTotal: 25, items: [] }]);
  const text = note(c);
  assert.match(text, /חסר לנו זיכוי של ₪5\.00 על חזרות/);
});
