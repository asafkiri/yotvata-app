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
// ₪255.94), everything else received in full. The paper (₪1,941.24) equals
// the lines on the paper, so the edit screen sees no phantom amount gap.
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
    noteParts: [{ units: 285, amount: 1629.47 }, { units: 61, amount: 311.77 }], noteTotalInc: 1941.24,
    totalExVat: 1685.3, totalIncVat: 1685.3, grossExVat: 1685.3, calculatedExVat: 1685.3, count: 4,
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
  assert.equal(diff, 'הפרשים מול התעודה חסר: גבינה לבנה 500 12 יח׳ · ₪100.44 מצא קיזוז תעודת ספק ₪1,941.24 (₪1,629.47 + ₪311.77) · לתשלום ₪1,685.30');
  assert.deepEqual(offsetButtons(html), ['cheese'], 'one "find offset" button, for the product that is really open');
  const ai = aiBox(html);
  assert.ok(ai.includes('• חסר 12 × גבינה לבנה 500'), ai);
  assert.ok(ai.includes('• 10 × מוקה שקית (מארז) — מכוסה בזיכוי ✓'), ai);
  assert.ok(ai.includes('• 2 × ארגז פלסטיק 400*300 — מכוסה בזיכוי ✓'), ai);
  assert.ok(!ai.includes('חסר 10 ×') && !ai.includes('חסר 2 ×'), 'a credited finding is not painted as a shortage');
  const credit = creditBox(html);
  assert.ok(credit.startsWith('זיכוי חלקי מהספק — נותר חוב ₪100.44 זיכוי מס׳ 407300217606 · 25.9.2026 ₪155.50 כיסה: 2 × ארגז פלסטיק 400*300 · ₪30.20 · 10 × מוקה שקית (מארז) · ₪125.30'), credit);
  assert.ok(credit.includes('החוסר המקורי (₪255.94) נשמר בתעודה ובממצאי הסריקה; מה שהזיכוי כיסה אינו מוצג עוד כהפרש פתוח'), credit);
  assert.ok(credit.includes('התקבל זיכוי מהספק (נותר ₪100.44)'), credit);
  assert.match(html, /הפרש פתוח/);
  // The money is untouched: the paper minus the original shortage, once.
  assert.deepEqual(money(c), { shortValRaw: 255.94, shortVal: 100.44, shortCreditEx: 155.5, shortFullyCredited: false, open: true, deliveryCreditMismatch: false, payable: 1685.3, bucket: 'attention', balance: 100.44 });
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
  assert.ok(ai.includes('• מוקה שקית (מארז) — חסר ללא זיכוי: 5 יח׳ · ₪62.65 (5 יח׳ בזיכוי)'), ai);
  assert.ok(ai.includes('• חסר 12 × גבינה לבנה 500') && ai.includes('• חסר 2 × ארגז פלסטיק 400*300'), ai);
  assert.ok(creditBox(html).includes('נותר חוב ₪193.29 זיכוי מס׳ 407300217606 · 25.9.2026 ₪62.65 כיסה: 5 × מוקה שקית (מארז) · ₪62.65'));
  assert.equal(money(c).payable, 1685.3);
  assert.equal(money(c).shortVal, 193.29);
});

test('a legacy amount-only credit binds to no product, so every shortage row stays visible with the remaining debt', () => {
  const { c, html } = render(receipt({ shortCreditNotes: [{ amount: 155.5, at: Date.parse('2026-09-25T15:00:00') }] }));
  assert.deepEqual(offsetButtons(html), ['crate', 'cheese', 'mocha']);
  const ai = aiBox(html);
  assert.ok(!ai.includes('בזיכוי'), ai);
  const credit = creditBox(html);
  assert.ok(credit.startsWith('זיכוי חלקי מהספק — נותר חוב ₪100.44 זיכוי 25.9.2026 ₪155.50 החוסר המקורי (₪255.94) נשמר בתעודה; הסכום שכוסה בזיכוי לא יקוזז מול תעודה עתידית.'), credit);
  assert.ok(!credit.includes('כיסה:'), credit);
  assert.equal(money(c).payable, 1685.3);
});

test('a credit that no longer matches the missing products covers nothing and hides nothing', () => {
  const wrong = { ...CREDIT_ROWS.crate, productId: 'milk', name: REST.name, barcode: REST.barcode };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([wrong, CREDIT_ROWS.mocha])] }));
  assert.deepEqual(offsetButtons(html), ['crate', 'cheese', 'mocha']);
  assert.ok(!aiBox(html).includes('בזיכוי'));
  const credit = creditBox(html);
  assert.ok(credit.startsWith('פרטי החוסר השתנו — יש לבדוק שוב את הזיכוי המצורף'), credit);
  assert.ok(credit.includes('אינו תואם לחוסר: 2 × חלב 1 ליטר · ₪30.20 · 10 × מוקה שקית (מארז) · ₪125.30'), credit);
  assert.ok(!credit.includes('כיסה:'), 'a rejected credit never claims to have covered anything');
  assert.ok(credit.includes('הזיכוי שאינו תואם למוצרים ולכמויות החסרים אינו סוגר חוסר אחר.'), credit);
  assert.equal(money(c).deliveryCreditMismatch, true);
  assert.equal(money(c).shortVal, 255.94);
});

test('the receipt stays open for another reason while every missing unit is credited: the box says so instead of standing empty', () => {
  // (a) a second driver credit that no longer matches, next to one that covers everything
  const stale = driverCredit([{ ...CREDIT_ROWS.cheese, productId: 'milk', name: REST.name, barcode: REST.barcode }], '407300217699');
  let { c, html } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha]), stale] }));
  let diff = strip(section(html, DIFF, AI));
  assert.ok(diff.startsWith('הפרשים מול התעודה החוסר (2 × ארגז פלסטיק 400*300 + 12 × גבינה לבנה 500 + 10 × מוקה שקית (מארז)) מכוסה בזיכוי ✓ תעודת ספק'), diff);
  assert.ok(!diff.includes('חסר:'), diff);
  assert.deepEqual(offsetButtons(html), []);
  let credit = creditBox(html);
  assert.ok(credit.includes('₪255.94 כיסה: 2 × ארגז'), credit);
  assert.ok(credit.includes('מס׳ 407300217699 · 25.9.2026 ₪100.44 אינו תואם לחוסר: 12 × חלב 1 ליטר · ₪100.44'), credit);
  assert.deepEqual([money(c).shortVal, money(c).deliveryCreditMismatch, money(c).shortFullyCredited, money(c).open], [0, true, true, true]);
  // (b) a price finding keeps the receipt open although the whole shortage is credited
  const rc = receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha])] });
  rc.aiAudit.findings.push({ type: 'price', productId: 'milk', name: REST.name, paperPrice: 5.5, expectedPrice: 5, qty: 312, amount: 156, text: 'חלב 1 ליטר — מחיר בנייר ₪5.50 במקום ₪5.00' });
  ({ c, html } = render(rc));
  diff = strip(section(html, DIFF, AI));
  assert.ok(diff.includes('מכוסה בזיכוי ✓ תעודת ספק') && !diff.includes('חסר:'), diff);
  assert.deepEqual(offsetButtons(html), []);
  assert.ok(aiBox(html).includes('חלב 1 ליטר — מחיר בנייר ₪5.50 במקום ₪5.00'), 'the price finding is still shown');
  assert.deepEqual([money(c).shortVal, money(c).open, money(c).payable], [0, true, 1685.3]);
});

test('a credit that covers every missing product closes the card: no discrepancy box, every finding green', () => {
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha])] }));
  assert.equal(section(html, DIFF, AI), '');
  assert.deepEqual(offsetButtons(html), []);
  const ai = aiBox(html);
  assert.equal((ai.match(/מכוסה בזיכוי ✓/g) || []).length, 3, ai);
  assert.ok(!ai.includes('חסר'), ai);
  assert.match(html, /אומתה · החוסר נסגר בזיכוי/);
  const credit = creditBox(html);
  assert.ok(credit.startsWith('החוסר נסגר בזיכוי מהספק ✓ זיכוי מס׳ 407300217606 · 25.9.2026 ₪255.94 כיסה: 2 × ארגז'), credit);
  assert.ok(!html.includes('data-role="rc-short-credit"'), 'nothing left to credit');
  assert.deepEqual(money(c), { shortValRaw: 255.94, shortVal: 0, shortCreditEx: 255.94, shortFullyCredited: true, open: false, deliveryCreditMismatch: false, payable: 1685.3, bucket: 'done', balance: 0 });
});

test('all units credited below the paper price: the money remainder is a row without an offset button', () => {
  const cheap = { ...CREDIT_ROWS.cheese, amount: 96 };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, cheap, CREDIT_ROWS.mocha])] }));
  const diff = strip(section(html, DIFF, AI));
  assert.ok(diff.startsWith('הפרשים מול התעודה יתרה ללא זיכוי: גבינה לבנה 500 כל היחידות בזיכוי · ₪4.44 תעודת ספק'), diff);
  assert.deepEqual(offsetButtons(html), []);
  const ai = aiBox(html);
  assert.ok(ai.includes('• גבינה לבנה 500 — יתרה ללא זיכוי · ₪4.44 (כל היחידות בזיכוי)'), ai);
  assert.equal((ai.match(/מכוסה בזיכוי ✓/g) || []).length, 2, ai);
  assert.ok(creditBox(html).startsWith('זיכוי חלקי מהספק — נותר חוב ₪4.44'));
  assert.deepEqual(json(c, 'receiptOffsets(receipts[0])'), []);
  assert.equal(money(c).shortVal, 4.44);
  assert.equal(money(c).open, true);
});

test('the split is display only: the discrepancy info, the offsets engine and the goods completion see the same remainder', () => {
  const { c } = render(receipt());
  const split = json(c, '(s=>({open:s.open,credited:s.credited,remainder:s.remainder}))(receiptShortAfterCredits(receiptDiscrepancyInfo(receipts[0])))');
  assert.deepEqual(split, {
    open: [{ productId: 'cheese', name: CHEESE.name, n: 12, price: 8.37, value: 100.44 }],
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
  const tags = [...html.matchAll(/(חסר \d+ · מכוסה בזיכוי|חסר \d+(?: <span[^>]*>\([^)]*\)<\/span>)?)<\/span>/g)].map(m => strip(m[1]));
  assert.deepEqual(tags, ['חסר 2 · מכוסה בזיכוי', 'חסר 12', 'חסר 10 · מכוסה בזיכוי']);
  assert.ok(strip(html).includes('3 שורות עם הפרש · 2 מכוסות בזיכוי'), strip(html).slice(0, 400));
  assert.ok(!html.includes('disabled'), 'credited lines are explained, not locked');
  // A covered line is green all over (card border and both count fields), not a green tag inside red.
  assert.match(html, /border-emerald-200 p-3 shadow-sm" data-id="crate"/);
  assert.match(html, /border-rose-200 p-3 shadow-sm" data-id="cheese"/);
  assert.equal((html.match(/border-rose-300/g) || []).length, 2, 'only the cheese count fields are red');
  // A worker who tops up the cheese count: the credited lines keep their tags, the cheese row closes,
  // and nothing uncovered remains — the header turns green.
  c.run("receiptFix.items.find(l=>l.productId==='cheese').qty=12;renderReceiptFix()");
  const after = c.node('app').innerHTML;
  assert.ok(strip(after).includes('2 שורות עם הפרש — כולן מכוסות בזיכוי'), strip(after).slice(0, 400));
  await c.run('saveReceiptFix()');
  const write = c.writes.find(w => w.path && w.path.includes('receipts'));
  assert.ok(write, 'the fix was saved');
  assert.ok(!('shortCreditNotes' in write.data), 'the credit is not rewritten by the edit screen');
  assert.equal(write.data.items.find(l => l.productId === 'cheese').noteQty, undefined);
  assert.equal(write.data.items.find(l => l.productId === 'crate').noteQty, 2);
});

test('a credit that pays less per unit than the paper: the open row and the finding carry the money still owed', () => {
  const cheap = { ...CREDIT_ROWS.mocha, qty: 5, amount: 50 };
  const { c, html } = render(receipt({ shortCreditNotes: [driverCredit([cheap])] }));
  const diff = strip(section(html, DIFF, AI));
  assert.ok(diff.includes('חסר: מוקה שקית (מארז) 5 יח׳ · ₪75.30'), diff);
  assert.ok(aiBox(html).includes('• מוקה שקית (מארז) — חסר ללא זיכוי: 5 יח׳ · ₪75.30 (5 יח׳ בזיכוי)'), aiBox(html));
  assert.ok(creditBox(html).startsWith('זיכוי חלקי מהספק — נותר חוב ₪205.94'), creditBox(html));
  assert.equal(money(c).shortVal, 205.94);
  // The unit price on the paper is still what the offsets engine trades on.
  assert.deepEqual(json(c, "findOpenOffsetSide('rc-1','mocha','short')").value, 62.65);
});

test('a positive amount gap on a fully credited receipt is listed once, as the gap it is', () => {
  const rc = receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha])], unresolvedAmountGap: 3 });
  rc.noteParts = [{ amount: 1717.49 }, { amount: 311.77 }]; // no printed unit count: the stored gap is the truth
  const { c, html } = render(rc);
  const diff = strip(section(html, DIFF, AI));
  assert.ok(diff.includes('מכוסה בזיכוי ✓'), diff);
  assert.equal((diff.match(/פער סכום שטרם שויך/g) || []).length, 1, diff);
  assert.ok(!diff.includes('יתרה ללא זיכוי') && !diff.includes('חסר:'), diff);
  assert.deepEqual([money(c).shortValRaw, money(c).shortVal, money(c).open], [258.94, 3, true]);
});

test('a receipt without an AI audit does not claim its findings keep the shortage', () => {
  const { html } = render(receipt({ aiAudit: null }));
  assert.equal(section(html, AI, DATE), '');
  const credit = creditBox(html);
  assert.ok(credit.includes('נשמר בתעודה; מה שהזיכוי כיסה אינו מוצג עוד כהפרש פתוח'), credit);
  assert.ok(!credit.includes('ובממצאי הסריקה'), credit);
});

test('the edit screen re-checks the credit against the lines as the worker changes them', () => {
  const { c } = render(receipt());
  c.run("openReceiptFix('rc-1')");
  // Counting one crate after all: the credit (2 crates + 10 mocha) is one paper and no longer
  // matches, so both tags drop at once — exactly what the saved card would say after saving.
  c.run("receiptFix.items.find(l=>l.productId==='crate').qty=1;renderReceiptFix()");
  let html = strip(c.node('app').innerHTML);
  assert.ok(html.includes('ארגז פלסטיק 400*300 ₪ ליח׳ חסר 1 התקבל'), html.slice(0, 500));
  assert.ok(html.includes('מוקה שקית (מארז) ₪ ליח׳ חסר 10 התקבל'), html.slice(0, 800));
  assert.ok(html.includes('3 שורות עם הפרש ארגז') && !html.includes('בזיכוי'), html.slice(0, 300));
  c.run("receiptFix.items.find(l=>l.productId==='crate').qty=0;renderReceiptFix()");
  html = strip(c.node('app').innerHTML);
  assert.ok(html.includes('חסר 2 · מכוסה בזיכוי') && html.includes('2 מכוסות בזיכוי'), html.slice(0, 500));
  // The in-place header refresh (a keystroke) agrees with the full render.
  c.run("receiptFix.items.find(l=>l.productId==='crate').qty=1;refreshReceiptFixHeader()");
  assert.ok(!c.node('rfStatus').innerHTML.includes('בזיכוי') && c.node('rfStatus').className.includes('text-rose-600'), c.node('rfStatus').innerHTML);
});

test('when every differing line is covered by the credit the edit screen header turns green', () => {
  const { c } = render(receipt({ shortCreditNotes: [driverCredit([CREDIT_ROWS.crate, CREDIT_ROWS.cheese, CREDIT_ROWS.mocha])] }));
  c.run("openReceiptFix('rc-1')");
  const html = c.node('app').innerHTML;
  assert.match(html, /id="rfStatus" class="[^"]*text-emerald-600"><i class="fa-solid fa-file-invoice-dollar"><\/i> 3 שורות עם הפרש — כולן מכוסות בזיכוי</);
  assert.equal((strip(html).match(/· מכוסה בזיכוי/g) || []).length, 3);
  assert.ok(!html.includes('border-rose-'), 'no line is red');
  // Counting the cheese after all contradicts the one credit paper (it lists the cheese), so the
  // whole credit stops matching: the header is red again and no line claims to be covered.
  c.run("receiptFix.items.find(l=>l.productId==='cheese').qty=12;refreshReceiptFixHeader()");
  assert.ok(c.node('rfStatus').className.includes('text-rose-600'), c.node('rfStatus').className);
  assert.match(c.node('rfStatus').innerHTML, /2 שורות עם הפרש$/);
});

test('a partially credited line on the edit screen says how many units are in the credit', () => {
  const half = { ...CREDIT_ROWS.mocha, qty: 5, amount: 62.65 };
  const { c } = render(receipt({ shortCreditNotes: [driverCredit([half])] }));
  c.run("openReceiptFix('rc-1')");
  const html = c.node('app').innerHTML;
  assert.ok(strip(html).includes('חסר 10 (5 יח׳ בזיכוי)'), strip(html).slice(0, 600));
  assert.ok(strip(html).includes('3 שורות עם הפרש') && !strip(html).includes('מכוסות בזיכוי'), 'no line is fully covered');
});
