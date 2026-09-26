// v369: a shortage the driver's credit (delivery_credit_scan) covered is not an
// open discrepancy on the saved receipt's card. Field report (owner, iPhone,
// v368): a receipt with three missing products and a driver's credit that
// covered two of them exactly still listed all three under "הפרשים מול התעודה"
// (each with "מצא קיזוז" that led nowhere) and painted all three AI findings
// red — "a whole mess of shortages that were actually fixed". The saved lines,
// the findings, the credit and the payable amount never change: only the card.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
// The card's sections, in the order the card renders them: the discrepancy box,
// the AI findings, then (after the scan details) the credit box and its buttons.
const DIFF = 'הפרשים מול התעודה', AI = 'פוענח ואושר בסריקת AI', CREDIT = 'fa-file-invoice-dollar"></i> ', DATE = 'תאריך התעודה';
function section(html, from, to) {
  const i = html.indexOf(from);
  if (i < 0) return '';
  const j = to ? html.indexOf(to, i + from.length) : -1;
  return html.slice(i, j < 0 ? undefined : j);
}
const aiBox = html => strip(section(html, AI, 'fa-file-invoice-dollar'));
const creditBox = html => strip(section(html, CREDIT, DATE).slice(CREDIT.length));
const offsetButtons = html => [...html.matchAll(/rc-offset-choose" data-id="[^"]+" data-product="([^"]+)" data-dir="short"/g)].map(m => m[1]);

// Mirrors the field receipt: two supplier documents, three products short
// (2 × crate at 15.10, 12 × cheese at 8.37, 10 of 20 × mocha at 12.53 =
// ₪255.94), everything else received in full.
const CRATE = { productId: 'crate', name: 'ארגז פלסטיק 400*300', qty: 0, noteQty: 2, unitPrice: 15.1, basePrice: 15.1, lineTotal: 0, promoPct: 0, barcode: '7290000000101' };
const CHEESE = { productId: 'cheese', name: 'גבינה לבנה 500', qty: 0, noteQty: 12, unitPrice: 8.37, basePrice: 8.37, lineTotal: 0, promoPct: 0, barcode: '7290000000102' };
const MOCHA = { productId: 'mocha', name: 'מוקה שקית (מארז)', qty: 10, noteQty: 20, unitPrice: 12.53, basePrice: 12.53, lineTotal: 125.3, promoPct: 0, barcode: '7290000000103' };
const REST = { productId: 'milk', name: 'חלב 1 ליטר', qty: 312, unitPrice: 5, basePrice: 5, lineTotal: 1560, promoPct: 0, barcode: '7290000000008' };
const CREDIT_ROWS = { crate: { productId: 'crate', name: CRATE.name, qty: 2, amount: 30.2, barcode: CRATE.barcode }, cheese: { productId: 'cheese', name: CHEESE.name, qty: 12, amount: 100.44, barcode: CHEESE.barcode }, mocha: { productId: 'mocha', name: MOCHA.name, qty: 10, amount: 125.3, barcode: MOCHA.barcode } };
function driverCredit(rows, number = '407300217606') {
  return { id: 'delivery_credit_1', source: 'delivery_credit_scan', number, autoConfirmed: true, at: Date.parse('2026-09-25T10:06:09'),
    amount: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100, rows: rows.map(r => ({ ...r })) };
}
function receipt(overrides = {}) {
  return { id: 'rc-1', timestamp: Date.parse('2026-09-25T12:08:42'), date: '2026-09-25', status: 'open', noDoc: false,
    noteParts: [{ units: 285, amount: 1717.49 }, { units: 61, amount: 311.77 }], noteTotalInc: 2029.26,
    totalExVat: 1773.32, totalIncVat: 1773.32, grossExVat: 1773.32, calculatedExVat: 1773.32, count: 4,
    supplierDiscount: 0, roundingAdjustment: 0, unresolvedAmountGap: 0, unresolvedUnitsGap: 0, supplierCreditClaim: null, quantityCheck: null,
    items: [structuredClone(CRATE), structuredClone(CHEESE), structuredClone(MOCHA), structuredClone(REST)],
    aiAudit: { version: 6, hasDiscrepancy: true, totalVerified: true, unitsVerified: true, findings: [
      { type: 'shortage', productId: 'cheese', name: CHEESE.name, qty: 12, expectedPrice: 8.37, text: 'חסר 12 × ' + CHEESE.name },
      { type: 'shortage', productId: 'mocha', name: MOCHA.name, qty: 10, expectedPrice: 12.53, text: 'חסר 10 × ' + MOCHA.name },
      { type: 'shortage', productId: 'crate', name: CRATE.name, qty: 2, expectedPrice: 15.1, text: 'חסר 2 × ' + CRATE.name }] },
    shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.mocha])],
    ...overrides };
}
function render(rc) {
  const c = harness.runtime('yotvata');
  c.context.historyFixture = rc;
  c.run("receipts=[historyFixture];returns=[];currentView='receiptsHistory';renderReceiptsHistory()");
  return { c, html: c.node('app').innerHTML };
}
function money(c) {
  return json(c, '(({shortValRaw,shortVal,shortCreditEx,shortFullyCredited,open,deliveryCreditMismatch})=>({shortValRaw,shortVal,shortCreditEx,shortFullyCredited,open,deliveryCreditMismatch,payable:receiptPayableBaseEx(receipts[0]),bucket:receiptFilterBucket(receipts[0]),balance:receiptsBalance().bal}))(receiptDiscrepancyInfo(receipts[0]))');
}

test('the field receipt: only the uncredited cheese is an open discrepancy; the two credited products are shown as covered', () => {
  const { c, html } = render(receipt());
  const diff = strip(section(html, DIFF, AI));
  assert.equal(diff, 'הפרשים מול התעודה חסר: גבינה לבנה 500 12 יח׳ · ₪100.44 מצא קיזוז תעודת ספק ₪2,029.26 (₪1,717.49 + ₪311.77) · לתשלום ₪1,773.32');
  assert.deepEqual(offsetButtons(html), ['cheese'], 'one "find offset" button, for the product that is really open');
  const ai = aiBox(html);
  assert.ok(ai.includes('• חסר 12 × גבינה לבנה 500'), ai);
  assert.ok(ai.includes('• 10 × מוקה שקית (מארז) — כוסה בזיכוי מהספק ✓'), ai);
  assert.ok(ai.includes('• 2 × ארגז פלסטיק 400*300 — כוסה בזיכוי מהספק ✓'), ai);
  assert.ok(!ai.includes('חסר 10 ×') && !ai.includes('חסר 2 ×'), 'a credited finding is not painted as a shortage');
  const credit = creditBox(html);
  assert.ok(credit.startsWith('זיכוי חלקי מהספק — נותר חוב ₪100.44 זיכוי מס׳ 407300217606 · 25.9.2026 ₪155.50 כיסה: 2 × ארגז פלסטיק 400*300 · ₪30.20 · 10 × מוקה שקית (מארז) · ₪125.30'), credit);
  assert.ok(credit.includes('החוסר המקורי (₪255.94) נשמר בתעודה ובממצאי הסריקה; מה שהזיכוי כיסה אינו מוצג עוד כהפרש פתוח'), credit);
  assert.ok(credit.includes('התקבל זיכוי מהספק (נותר ₪100.44)'), credit);
  assert.match(html, /הפרש פתוח/);
  // The money is untouched: the paper minus the original shortage, once.
  assert.deepEqual(money(c), { shortValRaw: 255.94, shortVal: 100.44, shortCreditEx: 155.5, shortFullyCredited: false, open: true, deliveryCreditMismatch: false, payable: 1773.32, bucket: 'attention', balance: 100.44 });
  // The saved receipt is exactly what was loaded.
  assert.deepEqual(json(c, 'receipts[0]'), receipt());
});

test('"מצא קיזוז" on a credited product led nowhere: the open side is only the uncredited product', () => {
  const { c } = render(receipt());
  assert.deepEqual(json(c, "findOpenOffsetSide('rc-1','cheese','short')").qty, 12);
  assert.equal(c.run("findOpenOffsetSide('rc-1','crate','short')"), null);
  assert.equal(c.run("findOpenOffsetSide('rc-1','mocha','short')"), null);
  c.run("openManualOffsetPicker('rc-1','crate','short')");
  assert.match(c.toasts.at(-1), /הפער הזה כבר נסגר או השתנה/);
  assert.deepEqual(json(c, "receiptOffsets(receipts[0])"), [{ productId: 'cheese', name: CHEESE.name, d: 12, price: 8.37 }]);
});

test('a credit for part of a product leaves the rest open, in the rows and in the finding', () => {
  const half = { ...CREDIT_ROWS.mocha, qty: 5, amount: 62.65 };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([half])] }));
  const diff = strip(section(html, DIFF, AI));
  assert.ok(diff.includes('חסר: מוקה שקית (מארז) 5 יח׳ · ₪62.65'), diff);
  assert.ok(diff.includes('חסר: ארגז פלסטיק 400*300 2 יח׳ · ₪30.20') && diff.includes('חסר: גבינה לבנה 500 12 יח׳ · ₪100.44'), diff);
  assert.deepEqual(offsetButtons(html), ['crate', 'cheese', 'mocha']);
  const ai = aiBox(html);
  assert.ok(ai.includes('• חסר 5 × מוקה שקית (מארז) (5 יח׳ כוסו בזיכוי)'), ai);
  assert.ok(ai.includes('• חסר 12 × גבינה לבנה 500') && ai.includes('• חסר 2 × ארגז פלסטיק 400*300'), ai);
  assert.ok(creditBox(html).includes('נותר חוב ₪193.29 זיכוי מס׳ 407300217606 · 25.9.2026 ₪62.65 כיסה: 5 × מוקה שקית (מארז) · ₪62.65'));
  assert.equal(money(c).payable, 1773.32);
  assert.equal(money(c).shortVal, 193.29);
});

test('a legacy amount-only credit binds to no product, so every shortage row stays visible with the remaining debt', () => {
  const { c, html } = render(receipt({ shortCreditNotes: [{ amount: 155.5, at: Date.parse('2026-09-25T15:00:00') }] }));
  assert.deepEqual(offsetButtons(html), ['crate', 'cheese', 'mocha']);
  const ai = aiBox(html);
  assert.ok(!ai.includes('כוסה בזיכוי'), ai);
  const credit = creditBox(html);
  assert.ok(credit.startsWith('זיכוי חלקי מהספק — נותר חוב ₪100.44 זיכוי 25.9.2026 ₪155.50 החוסר המקורי (₪255.94) נשמר בתעודה; הסכום שכוסה בזיכוי לא יקוזז מול תעודה עתידית.'), credit);
  assert.ok(!credit.includes('כיסה:'), credit);
  assert.equal(money(c).payable, 1773.32);
});

test('a credit that no longer matches the missing products covers nothing and hides nothing', () => {
  const wrong = { ...CREDIT_ROWS.crate, productId: 'milk', name: REST.name, barcode: REST.barcode };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([wrong, CREDIT_ROWS.mocha])] }));
  assert.deepEqual(offsetButtons(html), ['crate', 'cheese', 'mocha']);
  assert.ok(!aiBox(html).includes('כוסה בזיכוי'));
  const credit = creditBox(html);
  assert.ok(credit.startsWith('פרטי החוסר השתנו — יש לבדוק שוב את הזיכוי המצורף'), credit);
  assert.ok(credit.includes('הזיכוי שאינו תואם למוצרים ולכמויות החסרים אינו סוגר חוסר אחר.'), credit);
  assert.equal(money(c).deliveryCreditMismatch, true);
  assert.equal(money(c).shortVal, 255.94);
});

test('a credit that covers every missing product closes the card: no discrepancy box, every finding green', () => {
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha])] }));
  assert.equal(section(html, DIFF, AI), '');
  assert.deepEqual(offsetButtons(html), []);
  const ai = aiBox(html);
  assert.equal((ai.match(/כוסה בזיכוי מהספק ✓/g) || []).length, 3, ai);
  assert.ok(!ai.includes('• חסר'), ai);
  assert.match(html, /אומתה · החוסר נסגר בזיכוי/);
  const credit = creditBox(html);
  assert.ok(credit.startsWith('החוסר נסגר בזיכוי מהספק ✓ זיכוי מס׳ 407300217606 · 25.9.2026 ₪255.94 כיסה: 2 × ארגז'), credit);
  assert.ok(!html.includes('data-role="rc-short-credit"'), 'nothing left to credit');
  assert.deepEqual(money(c), { shortValRaw: 255.94, shortVal: 0, shortCreditEx: 255.94, shortFullyCredited: true, open: false, deliveryCreditMismatch: false, payable: 1773.32, bucket: 'done', balance: 0 });
});

test('all units credited below the paper price: the money remainder is a row without an offset button', () => {
  const cheap = { ...CREDIT_ROWS.cheese, amount: 96 };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, cheap, CREDIT_ROWS.mocha])] }));
  const diff = strip(section(html, DIFF, AI));
  assert.ok(diff.startsWith('הפרשים מול התעודה חסר: גבינה לבנה 500 כל היחידות בזיכוי · נותרה יתרה · ₪4.44 תעודת ספק'), diff);
  assert.deepEqual(offsetButtons(html), []);
  const ai = aiBox(html);
  assert.ok(ai.includes('• גבינה לבנה 500 — כל היחידות בזיכוי, נותרה יתרה ₪4.44'), ai);
  assert.equal((ai.match(/כוסה בזיכוי מהספק ✓/g) || []).length, 2, ai);
  assert.ok(creditBox(html).startsWith('זיכוי חלקי מהספק — נותר חוב ₪4.44'));
  assert.deepEqual(json(c, 'receiptOffsets(receipts[0])'), []);
  assert.equal(money(c).shortVal, 4.44);
  assert.equal(money(c).open, true);
});

test('the split is display only: the discrepancy info, the offsets engine and the goods completion see the same remainder', () => {
  const { c } = render(receipt());
  const split = json(c, '(s=>({open:s.open,credited:s.credited,remainder:s.remainder}))(receiptShortAfterCredits(receiptDiscrepancyInfo(receipts[0])))');
  assert.deepEqual(split, {
    open: [{ productId: 'cheese', name: CHEESE.name, n: 12, price: 8.37 }],
    credited: [{ productId: 'crate', name: CRATE.name, n: 2, price: 15.1 }, { productId: 'mocha', name: MOCHA.name, n: 10, price: 12.53 }],
    remainder: [] });
  // "התקבל זיכוי בסחורה" proposes exactly the open remainder (v205 rule), which the card now shows.
  c.run("showConfirm=(title,text,label,fn)=>{testToasts.push(text);}");
  c.run("openShortGoodsConfirm('rc-1')");
  assert.match(c.toasts.at(-1), /12 × גבינה לבנה 500 \(₪100\.44\)/);
  assert.doesNotMatch(c.toasts.at(-1), /ארגז|מוקה/);
  // Without a driver's credit nothing is split and nothing is marked.
  const plain = json(c, "(s=>({open:s.open.length,credited:s.credited.length,remainder:s.remainder.length,byProduct:s.byProduct.size}))(receiptShortAfterCredits(receiptDiscrepancyInfo({...receipts[0],shortCreditNotes:[]})))");
  assert.deepEqual(plain, { open: 3, credited: 0, remainder: 0, byProduct: 0 });
});

test('the edit screen names the credited lines and keeps the paper difference editable; saving never touches the credit', async () => {
  const { c } = render(receipt());
  c.run("openReceiptFix('rc-1')");
  const html = c.node('app').innerHTML;
  const tags = [...html.matchAll(/(חסר \d+ · כוסה בזיכוי מהספק|חסר \d+(?: <span[^>]*>\([^)]*\)<\/span>)?)<\/span>/g)].map(m => strip(m[1]));
  assert.deepEqual(tags, ['חסר 2 · כוסה בזיכוי מהספק', 'חסר 12', 'חסר 10 · כוסה בזיכוי מהספק']);
  assert.ok(strip(html).includes('3 שורות עם הפרש · 2 מכוסות בזיכוי מהספק'), strip(section(html, 'rfStatus', 'rfStatus') || html.slice(0, 2000)));
  assert.ok(!html.includes('disabled'), 'credited lines are explained, not locked');
  // A worker who tops up the cheese count: the credited lines keep their tags, the cheese row closes.
  c.run("receiptFix.items.find(l=>l.productId==='cheese').qty=12;renderReceiptFix()");
  const after = c.node('app').innerHTML;
  assert.ok(strip(after).includes('2 שורות עם הפרש · 2 מכוסות בזיכוי מהספק'), strip(after).slice(0, 400));
  await c.run('saveReceiptFix()');
  const write = c.writes.find(w => w.path && w.path.includes('receipts'));
  assert.ok(write, 'the fix was saved');
  assert.ok(!('shortCreditNotes' in write.data), 'the credit is not rewritten by the edit screen');
  assert.equal(write.data.items.find(l => l.productId === 'cheese').noteQty, undefined);
  assert.equal(write.data.items.find(l => l.productId === 'crate').noteQty, 2);
});

test('a partially credited line on the edit screen says how many units are in the credit', () => {
  const half = { ...CREDIT_ROWS.mocha, qty: 5, amount: 62.65 };
  const { c } = render(receipt({ shortCreditNotes: [driverCredit([half])] }));
  c.run("openReceiptFix('rc-1')");
  const html = c.node('app').innerHTML;
  assert.ok(strip(html).includes('חסר 10 (5 בזיכוי)'), strip(html).slice(0, 600));
  assert.ok(strip(html).includes('3 שורות עם הפרש') && !strip(html).includes('מכוסות בזיכוי'), 'no line is fully covered');
});
