// v373: a price/promo credit claim covers only the billed units that ARRIVED, and
// only the gap the paper itself shows. Every product on the paper is written at the
// paper price, so a missing unit is already deducted as a shortage at the paper
// price — the price difference included. Until v372 the claim was the difference on
// every billed unit, so the missing units were deducted twice: A billed 12 at ₪5.50
// (list ₪5), 4 arrived → shortage 8 × 5.50 = 44 and a claim of 12 × 0.50 = 6; the
// month paid ₪66 for goods worth ₪70 (4 × 5 + B 50). The claim is now 4 × 0.50 = 2.
// The cap is per product and comes from the paper: when the analyzer led, the claim
// is built from the engine's paper comparison, so a gap the analyzer put on the wrong
// product, lumped, or split into several claims is claimed once, on the right product.
// Missing goods that arrive later are paid at the paper price, so their gap goes back
// into the claim.
// Also v373: a receipt with no units anchor ("אין בנייר — המשך בלי") stays closable
// after the analyzer confirms a claim (the engine's own units rule), and the saved
// quantity findings never contradict the saved lines. Everything else — a single
// shortage, an analyzer explanation that matches the paper, a price claim when all
// billed units arrived — is saved exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const CATALOG = [
  { id: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', price: 5 },
  { id: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', price: 5 },
  { id: 'C', name: 'מוצר ג בדיקה', barcode: '7290000000022', price: 5 }
];
const PROMO_A = { id: 'p1', name: 'מבצע בדיקה', productIds: ['A'], pct: 20, start: '2020-01-01', end: '2099-12-31', minQty: 1 };

function scanRow(p, line, qty, unit = p.price) {
  const total = Math.round(qty * unit * 100) / 100;
  return { section: 'items', description: p.name, itemCode: String(100 + line), barcode: p.barcode, barcodeObserved: p.barcode,
    barcodeReadType: 'full', barcodeMatchMethod: 'exact_full', lineNumber: line, sourcePage: 1, quantity: qty,
    unitPriceExVat: unit, grossLineTotalExVat: total, lineTotalExVat: total, lineDiscountExVat: 0, confidence: .95 };
}
// paper: [[productId, qty, unitPrice?]] rows of one document; scanned: { productId: qty }.
function fixture({ paper, scanned, promos = [], printedUnits = true, catalog = CATALOG }) {
  const data = harness.fixture('yotvata');
  data.products = structuredClone(catalog);
  data.promos = structuredClone(promos);
  const rows = paper.map(([id, qty, unit], i) => scanRow(CATALOG.find(p => p.id === id), i + 1, qty, unit));
  const subtotal = Math.round(rows.reduce((a, r) => a + r.lineTotalExVat, 0) * 100) / 100;
  const units = rows.reduce((a, r) => a + r.quantity, 0);
  Object.assign(data.paper.scan.documents[0], { subtotalExVat: subtotal, printedUnits: printedUnits ? units : null, totalUnits: printedUnits ? units : null,
    itemsPrintedLines: rows.length, printedLines: rows.length, itemsSectionTotalExVat: subtotal, rows });
  data.items = Object.entries(scanned).filter(([, qty]) => qty > 0)
    .map(([id, qty]) => { const p = CATALOG.find(x => x.id === id); return { productId: id, name: p.name, barcode: p.barcode, qty }; });
  return { data, subtotal };
}
function answerAnalyzer(c, claims) {
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    if (body.mode === 'analyze') return harness.reply({ ok: true, analysis: { claims, summary: 'fixture' } });
    return original(url, options);
  };
}
// The owner's clicks after the scan card: "these are the problems", then close. Returns
// the receipt exactly as confirmReceipt writes it, or null when closing is locked.
async function closeFromScan(c) {
  c.click('ai-confirm-findings');
  c.run('renderReconcile()');
  if (!c.node('app').innerHTML.includes('data-role="ai-apply"')) return null;
  c.click('ai-apply');
  assert.ok(c.run('!!pendingReceipt'), 'the close summary opened');
  await c.run('confirmReceipt()');
  for (let i = 0; i < 5; i++) await tick();
  const write = c.writes.slice().reverse().find(w => w && w.data && Array.isArray(w.data.items));
  assert.ok(write, 'the receipt was written');
  return write.data;
}
// Photo-first (the usual flow): the printed units on the paper are the units anchor.
async function photoClose({ claims = [], ...options }) {
  const { data } = fixture(options);
  const cloud = harness.fakeCloud();
  const c = harness.runtime('yotvata', { data, cloud });
  await cloud.tick();
  c.run('openScanner=()=>{}; closeScanner=()=>{}; scanBeep=()=>{}; buzz=()=>{}; refreshScanHost=()=>{};');
  answerAnalyzer(c, claims);
  await c.scan();
  c.run('receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();');
  for (let i = 0; i < 10; i++) await tick();
  if (claims.length) { await c.run('auditOriginalAnalyzer()'); c.run('renderReconcile()'); }
  const analyzerLed = c.run('!!(aiScanEvaluation && aiScanEvaluation.analyzerLed)');
  return { c, analyzerLed, saved: await closeFromScan(c) };
}
// Amount typed by hand, units declared absent on the paper, then the photo is read.
async function waivedClose({ claims = [], ...options }) {
  const { data, subtotal } = fixture({ ...options, printedUnits: false });
  const cloud = harness.fakeCloud();
  const c = harness.runtime('yotvata', { data, cloud });
  await cloud.tick();
  c.run(`showConfirm=(title,text,label,fn)=>fn(); buzz=()=>{}; receiptOpened = true; receiptDupConfirmed = true;
    receiptEntryMode = 'manual'; receiptAnchorSource = 'manual'; receiptNotes = [{ amount: ${subtotal}, units: null }];
    receiptUnitsWaived = true; recomputeNoteTotal(); receiptList = structuredClone(testData.items); saveReceiptDraft(); finishReceipt();`);
  for (let i = 0; i < 10; i++) await tick();
  c.run(`aiScanDocuments = [{ noteIndex: 0, amount: ${subtotal}, units: null, pages: [{ dataUrl: 'data:image/jpeg;base64,Zml4dHVyZQ==', orientationConfirmed: true }] }];`);
  await c.run('aiRunInvoiceScan()');
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(c.run('aiScanEvaluation.unitsAnchorless'), true, 'no units anchor anywhere');
  if (claims.length) {
    answerAnalyzer(c, claims);
    await c.run('auditOriginalAnalyzer()');
    assert.equal(c.run('!!(aiAnalyzeResult && aiAnalyzeResult.accepted)'), true, 'the analyzer explanation closed the money');
    c.run('renderReconcile()');
  }
  return { c, saved: await closeFromScan(c) };
}
const items = saved => saved.items.map(l => [l.productId, l.qty, l.noteQty == null ? null : l.noteQty, l.unitPrice]);
const claimOf = saved => saved.supplierCreditClaim && { amount: saved.supplierCreditClaim.amount,
  items: saved.supplierCreditClaim.items.map(i => [i.productId, i.qty, i.reason, i.amount, i.expectedUnitPrice, i.chargedUnitPrice]) };
const auditTexts = saved => ((saved.aiAudit || {}).findings || []).filter(f => ['shortage', 'surplus', 'price', 'promo_missing'].includes(f.type))
  .map(f => f.text + (f.noClaim ? ' [noClaim]' : ''));
// The month's "to pay" with this receipt alone, and whether the receipt reads open.
function money(c, saved, extra = {}) {
  c.context.monthReceipt = { ...saved, ...extra, id: 'rc-month' };
  return json(c, `(() => { receipts = [monthReceipt]; returns = []; const d = receiptRangeData(null, null), di = receiptDiscrepancyInfo(monthReceipt);
    return { recEx: d.recEx, pendingCreditEx: d.pendingSupplierCreditEx, netEx: d.netEx, open: di.open, aiAuditOpen: di.aiAuditOpen }; })()`);
}
// The shortage settled later (the goods came): what, if anything, still keeps the receipt open.
const shortageSettled = saved => ({ shortGoodsNotes: saved.items.filter(l => l.noteQty != null && l.noteQty > l.qty).map(l => ({ productId: l.productId, qty: l.noteQty - l.qty })) });

test('a price the paper overcharges is claimed only on the billed units that arrived — the missing ones are already deducted at the paper price', async () => {
  const { c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 4, B: 10 } });
  assert.deepEqual(items(saved), [['A', 4, 12, 5.5], ['B', 10, null, 5]]);
  // Until v372: { amount: 6, items: [['A', 12, 'price', 6, 5, 5.5]] } and the month paid ₪66.
  assert.deepEqual(claimOf(saved), { amount: 2, items: [['A', 4, 'price', 2, 5, 5.5]] });
  assert.deepEqual(auditTexts(saved), ['חסר 8 × מוצר א בדיקה', 'מחיר שונה: מוצר א בדיקה — במערכת ₪5.00, בנייר ₪5.50']);
  // Paper 116 − shortage 8 × 5.50 = 72, minus the claim 2 = 70 = 4 × ₪5 + B ₪50.
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: true });
});

test('the same cap for a promotion the supplier did not apply, and for one product billed at two prices', async () => {
  let { c, saved } = await photoClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 }, promos: [PROMO_A] });
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]]);
  // Until v372: 12 × ₪1 = ₪12 and a month of ₪58 for goods worth 4 × ₪4 + ₪50 = ₪66.
  assert.deepEqual(claimOf(saved), { amount: 4, items: [['A', 4, 'promo_missing', 4, 4, 5]] });
  assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 4, netEx: 66, open: true, aiAuditOpen: true });
  // The mismatch notice still records what the paper billed.
  assert.deepEqual(saved.supplierPromoMismatchItems.map(x => [x.productId, x.qty, x.expectedDiscount]), [['A', 12, 12]]);

  ({ c, saved } = await photoClose({ paper: [['A', 6], ['A', 6, 6], ['B', 10]], scanned: { A: 4, B: 10 } }));
  assert.deepEqual(items(saved), [['A', 4, 12, 5.5], ['B', 10, null, 5]]);
  assert.deepEqual(claimOf(saved), { amount: 2, items: [['A', 4, 'price', 2, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: true });
});

test('nothing of the overpriced product arrived: no claim at all, and the price finding does not keep the receipt open after the shortage is settled', async () => {
  const { c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 0, B: 10 } });
  assert.deepEqual(items(saved), [['A', 0, 12, 5.5], ['B', 10, null, 5]]);
  // Until v372: a ₪6 claim on top of the ₪66 shortage — ₪44 paid for ₪50 of goods.
  assert.equal(saved.supplierCreditClaim, null);
  assert.deepEqual(auditTexts(saved), ['חסר 12 × מוצר א בדיקה',
    'מחיר שונה: מוצר א בדיקה — במערכת ₪5.00, בנייר ₪5.50 — בלי דרישת זיכוי: בנייר אין הפרש מחיר על יחידה שהגיעה [noClaim]']);
  assert.deepEqual(money(c, saved), { recEx: 50, pendingCreditEx: 0, netEx: 50, open: true, aiAuditOpen: false });
  // Until v372 the receipt stayed red forever: a price finding with nothing left to settle.
  assert.deepEqual(money(c, saved, shortageSettled(saved)), { recEx: 116, pendingCreditEx: 0, netEx: 116, open: false, aiAuditOpen: false });
});

test('an analyzer price claim is capped by the same paper numbers', async () => {
  const { c, analyzerLed, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 4, B: 10 },
    claims: [{ kind: 'shortage', productId: 'A', quantity: 8 }, { kind: 'price', productId: 'A', quantity: 12, billedUnitPriceExVat: 5.5, expectedUnitPriceExVat: 5, amountExVat: 6 }] });
  assert.equal(analyzerLed, true);
  assert.deepEqual(items(saved), [['A', 4, 12, 5.5], ['B', 10, null, 5]]);
  assert.deepEqual(claimOf(saved), { amount: 2, items: [['A', 4, 'price', 2, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: true });
});

test('unchanged: all billed units arrived (or more) — the claim is still the difference on every billed unit', async () => {
  for (const scannedA of [12, 14]) {
    const { c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: scannedA, B: 10 } });
    assert.deepEqual(items(saved), [['A', scannedA, scannedA === 12 ? null : 12, 5.5], ['B', 10, null, 5]]);
    assert.deepEqual(claimOf(saved), { amount: 6, items: [['A', 12, 'price', 6, 5, 5.5]] });
    assert.deepEqual(money(c, saved), { recEx: 116, pendingCreditEx: 6, netEx: 110, open: true, aiAuditOpen: true });
  }
  const { c, saved } = await photoClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 12, B: 10 }, promos: [PROMO_A] });
  assert.deepEqual(claimOf(saved), { amount: 12, items: [['A', 12, 'promo_missing', 12, 4, 5]] });
  assert.deepEqual(money(c, saved), { recEx: 110, pendingCreditEx: 12, netEx: 98, open: true, aiAuditOpen: true });
});

test('unchanged: a single shortage, and analyzer explanations that match the paper product by product', async () => {
  const cases = [
    [{ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 } }, [['A', 4, 12, 5], ['B', 10, null, 5]], ['חסר 8 × מוצר א בדיקה']],
    [{ paper: [['A', 5], ['A', 7], ['B', 10]], scanned: { A: 4, B: 10 } }, [['A', 4, 12, 5], ['B', 10, null, 5]], ['חסר 8 × מוצר א בדיקה']],
    [{ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 12 }, claims: [{ kind: 'shortage', productId: 'A', quantity: 6 }, { kind: 'substitution', productId: 'A', substituteProductId: 'B', quantity: 2 }] },
      [['A', 4, 12, 5], ['B', 12, 10, 5]], ['חסר 6 × מוצר א בדיקה', 'חויב ולא סופק: 2 × מוצר א בדיקה', 'סופק במקומו: 2 × מוצר ב בדיקה']],
    [{ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 12 }, claims: [{ kind: 'substitution', productId: 'A', substituteProductId: 'B', quantity: 2 }, { kind: 'shortage', productId: 'A', quantity: 6 }] },
      [['A', 4, 12, 5], ['B', 12, 10, 5]], ['חויב ולא סופק: 2 × מוצר א בדיקה', 'סופק במקומו: 2 × מוצר ב בדיקה', 'חסר 6 × מוצר א בדיקה']],
    [{ paper: [['A', 5], ['A', 7], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [{ kind: 'shortage', productId: 'A', quantity: 3 }, { kind: 'shortage', productId: 'A', quantity: 5 }] },
      [['A', 4, 12, 5], ['B', 10, null, 5]], ['חסר 3 × מוצר א בדיקה', 'חסר 5 × מוצר א בדיקה']]
  ];
  for (const [options, lines, audit] of cases) {
    const { c, saved } = await photoClose(options);
    assert.deepEqual(items(saved), lines);
    assert.equal(saved.supplierCreditClaim, null);
    assert.deepEqual(auditTexts(saved), audit);
    assert.equal(saved.aiAudit.findings.some(f => 'noClaim' in f), false);
    assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 0, netEx: 70, open: true, aiAuditOpen: false });
  }
});

test('an analyzer explanation that closes the totals but not product by product: lines and saved findings both follow the paper', async () => {
  // Same price, so the gate cannot tell A from B: claims A4 B4 C4 close 12 units and ₪60.
  let { saved } = await photoClose({ paper: [['A', 12], ['B', 10], ['C', 6]], scanned: { A: 4, B: 10, C: 2 },
    claims: [{ kind: 'shortage', productId: 'A', quantity: 4 }, { kind: 'shortage', productId: 'B', quantity: 4 }, { kind: 'shortage', productId: 'C', quantity: 4 }] });
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5], ['C', 2, 6, 5]]);
  // Until v372 the saved findings said "חסר 4 × B" — B was not short at all.
  assert.deepEqual(auditTexts(saved), ['חסר 8 × מוצר א בדיקה', 'חסר 4 × מוצר ג בדיקה']);
  ({ saved } = await photoClose({ paper: [['A', 12], ['B', 10], ['C', 6]], scanned: { A: 4, B: 18, C: 2 },
    claims: [{ kind: 'shortage', productId: 'A', quantity: 8 }, { kind: 'substitution', productId: 'B', substituteProductId: 'A', quantity: 8 },
      { kind: 'surplus', productId: 'B', quantity: 8 }, { kind: 'shortage', productId: 'C', quantity: 4 }] }));
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 18, 10, 5], ['C', 2, 6, 5]]);
  assert.deepEqual(auditTexts(saved), ['חסר 8 × מוצר א בדיקה', 'עודף 8 × מוצר ב בדיקה', 'חסר 4 × מוצר ג בדיקה']);
});

test('no units anchor: the analyzer confirming a claim no longer locks a receipt the engine closes', async () => {
  // The engine alone closes it (unchanged).
  let { c, saved } = await waivedClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 } });
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]]);
  // Until v372: after the analyzer's correct "shortage A 8" the card said the closing is
  // locked, with no reason and no close button.
  ({ c, saved } = await waivedClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [{ kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40 }] }));
  assert.ok(saved, 'closable');
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]]);
  assert.equal(saved.supplierCreditClaim, null);
  assert.deepEqual(auditTexts(saved), ['חסר 8 × מוצר א בדיקה']);
  assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 0, netEx: 70, open: true, aiAuditOpen: false });
  // Without a units anchor the gate weighs money only. A same-price mislabel ("B" for A)
  // closes it too — the lines and the saved findings still follow the paper.
  ({ c, saved } = await waivedClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [{ kind: 'shortage', productId: 'B', quantity: 8 }] }));
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]]);
  assert.deepEqual(auditTexts(saved), ['חסר 8 × מוצר א בדיקה']);
  assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 0, netEx: 70, open: true, aiAuditOpen: false });
});

test('no units anchor: a "price" claim the paper does not show opens no credit claim — the shortage is not deducted twice', async () => {
  // Paper A12 B10 at exactly the list ₪5; 4 of A arrived. The analyzer calls the ₪40 a price issue.
  const { c, saved } = await waivedClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 },
    claims: [{ kind: 'price', productId: 'A', quantity: 12, billedUnitPriceExVat: 5, expectedUnitPriceExVat: 5, amountExVat: 40 }] });
  assert.ok(saved, 'closable (until v372 locked, like the correct claim above)');
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]]);
  assert.equal(saved.supplierCreditClaim, null, 'with a ₪40 claim the month would pay ₪30 for ₪70 of goods');
  assert.deepEqual(auditTexts(saved), ['מחיר שונה: מוצר א בדיקה — בלי דרישת זיכוי: בנייר אין הפרש מחיר על יחידה שהגיעה [noClaim]', 'חסר 8 × מוצר א בדיקה']);
  assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 0, netEx: 70, open: true, aiAuditOpen: false });
  assert.deepEqual(money(c, saved, shortageSettled(saved)), { recEx: 110, pendingCreditEx: 0, netEx: 110, open: false, aiAuditOpen: false });
});

test('manual check: "the supplier did not honour the promotion" claims only the units that were billed and arrived, whatever the click order', async () => {
  // A is in a 20% promotion (₪4); the supplier billed A 12 at the full ₪5 (₪110 / 22 units); 4 arrived.
  for (const order of ['assign the shortage, then mark the promotion', 'mark the promotion, then assign the shortage']) {
    const { data } = fixture({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 }, promos: [PROMO_A] });
    data.products = data.products.slice(0, 2);
    const cloud = harness.fakeCloud();
    const c = harness.runtime('yotvata', { data, cloud });
    await cloud.tick();
    c.run(`showConfirm=(title,text,label,fn)=>fn(); buzz=()=>{}; showInputModal = async () => '8'; receiptOpened = true; receiptDupConfirmed = true;
      receiptEntryMode = 'manual'; receiptAnchorSource = 'manual'; receiptNotes = [{ amount: 110, units: 22 }]; recomputeNoteTotal();
      receiptList = structuredClone(testData.items); saveReceiptDraft(); finishReceipt();`);
    for (let i = 0; i < 5; i++) await tick();
    c.click('rc-goto-manual');
    const assign = async () => { await c.click('manual-pick', 'A'); for (let i = 0; i < 5; i++) await tick(); };
    const mark = () => { c.click('manual-claim', 'A'); c.node('pmClaim').onclick(); };
    if (order.startsWith('assign')) { await assign(); mark(); } else { mark(); await assign(); }
    assert.equal(c.run('reconcileIsBalanced()'), true, order);
    c.run('saveReconciledReceipt()');
    await c.run('confirmReceipt()');
    for (let i = 0; i < 5; i++) await tick();
    const saved = c.writes.slice().reverse().find(w => w && w.data && Array.isArray(w.data.items)).data;
    assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 10, null, 5]], order);
    // Until v372 the first order claimed 12 × ₪1 = ₪12 (a month of ₪58); the second ₪4.
    assert.deepEqual([saved.supplierCreditClaim.amount, saved.supplierCreditClaim.items.map(i => [i.productId, i.qty, i.expectedDiscount])], [4, [['A', 4, 4]]], order);
    assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 4, netEx: 66, open: true, aiAuditOpen: false }, order);
  }
});

test('manual check, 14 arrived of 12 billed: the promotion claim covers the 12 billed, not the 14', async () => {
  const { data } = fixture({ paper: [['A', 12], ['B', 10]], scanned: { A: 14, B: 10 }, promos: [PROMO_A] });
  const cloud = harness.fakeCloud();
  const c = harness.runtime('yotvata', { data, cloud });
  await cloud.tick();
  c.run(`buzz=()=>{}; receiptList = structuredClone(testData.items); receiptNotes = [{ amount: 110, units: 22 }]; recomputeNoteTotal(); openReconcile(); rcStep = 'manual';
    reconcileData.find(l => l.productId === 'A').noteQty = 12;`);
  c.run("manualTogglePromoClaim('A')"); c.node('pmClaim').onclick();
  assert.deepEqual(json(c, 'reconcileSupplierCreditClaim.items.map(i => [i.productId, i.qty, i.expectedDiscount])'), [['A', 12, 12]]);
});

// ─── the claim follows the paper, product by product, whoever explained it ──
// The analyzer's gate weighs units and money in total (without a units anchor, money
// only), so it cannot tell which product carries a price gap, and it lets one gap be
// split into several claims. When the analyzer led, the claim is built from the
// engine's paper comparison (one finding per product), capped per product; the
// analyzer's words stay as the explanation.
const PRICE_B = { kind: 'price', productId: 'B', quantity: 10, billedUnitPriceExVat: 5.6, expectedUnitPriceExVat: 5, amountExVat: 6 };

test('the analyzer names the wrong product for a real price gap: the claim follows the paper (A), and the month pays ₪110', async () => {
  // A billed 12 at ₪5.50 (list ₪5); the analyzer calls it "price B ₪6" (B was billed at exactly ₪5).
  let { c, analyzerLed, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 12, B: 10 }, claims: [PRICE_B] });
  assert.equal(analyzerLed, true);
  // A cap per claim put B's cap (₪0) on it: no claim, the receipt closed, the month paid ₪116.
  assert.deepEqual(claimOf(saved), { amount: 6, items: [['A', 12, 'price', 6, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 116, pendingCreditEx: 6, netEx: 110, open: true, aiAuditOpen: false });
  assert.deepEqual(auditTexts(saved), ['מחיר שונה: מוצר ב בדיקה — בלי דרישת זיכוי: בנייר אין הפרש מחיר על יחידה שהגיעה [noClaim]']);
  // The same with 8 of A missing: the gap on the 4 that arrived.
  ({ c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [{ kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40 }, PRICE_B] }));
  assert.deepEqual(claimOf(saved), { amount: 2, items: [['A', 4, 'price', 2, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: false });
  // No units anchor (money-only gate): locked until v372, and must not lose the ₪6 now that it closes.
  ({ c, saved } = await waivedClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 12, B: 10 }, claims: [PRICE_B] }));
  assert.deepEqual(claimOf(saved), { amount: 6, items: [['A', 12, 'price', 6, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 116, pendingCreditEx: 6, netEx: 110, open: true, aiAuditOpen: false });
});

test('the gap is on B, the analyzer names A (same catalog price, nothing missing): claim B ₪6, month ₪120', async () => {
  const { c, saved } = await photoClose({ paper: [['A', 12], ['B', 12, 5.5]], scanned: { A: 12, B: 12 },
    claims: [{ kind: 'price', productId: 'A', quantity: 12, amountExVat: 6, billedUnitPriceExVat: 5.5 }] });
  assert.deepEqual(claimOf(saved), { amount: 6, items: [['B', 12, 'price', 6, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 126, pendingCreditEx: 6, netEx: 120, open: true, aiAuditOpen: false });
});

test('two products overcharged, the analyzer lumps ₪12 on A: claim A ₪6 + B ₪6, month ₪110', async () => {
  const { c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10, 5.6]], scanned: { A: 12, B: 10 },
    claims: [{ kind: 'price', productId: 'A', quantity: 12, billedUnitPriceExVat: 6, expectedUnitPriceExVat: 5, amountExVat: 12 }] });
  assert.deepEqual(claimOf(saved), { amount: 12, items: [['A', 12, 'price', 6, 5, 5.5], ['B', 10, 'price', 6, 5, 5.6]] });
  assert.deepEqual(money(c, saved), { recEx: 122, pendingCreditEx: 12, netEx: 110, open: true, aiAuditOpen: true });
});

test('several price claims on one product never add up past the paper: one capped claim per product', async () => {
  const SHORT8 = { kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40 };
  // A on two rows (6 × ₪5.50 + 6 × ₪5.60, list ₪5), 4 of 12 arrived, one price claim per row.
  let { c, saved } = await photoClose({ paper: [['A', 6, 5.5], ['A', 6, 5.6], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [SHORT8,
    { kind: 'price', productId: 'A', quantity: 6, billedUnitPriceExVat: 5.5, expectedUnitPriceExVat: 5, amountExVat: 3 },
    { kind: 'price', productId: 'A', quantity: 6, billedUnitPriceExVat: 5.6, expectedUnitPriceExVat: 5, amountExVat: 3.6 }] });
  // The paper's gap: 4 × (₪5.55 − ₪5) = ₪2.20 — a cap per claim took it twice (₪4.40).
  assert.deepEqual(claimOf(saved), { amount: 2.2, items: [['A', 4, 'price', 2.2, 5, 5.55]] });
  assert.deepEqual(money(c, saved), { recEx: 72.2, pendingCreditEx: 2.2, netEx: 70, open: true, aiAuditOpen: true });
  // One gap split into three claims of ₪2, each under the ₪2 cap: still ₪2 in all.
  ({ c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 4, B: 10 }, claims: [SHORT8,
    ...[1, 2, 3].map(() => ({ kind: 'price', productId: 'A', quantity: 4, amountExVat: 2 }))] }));
  assert.deepEqual(claimOf(saved), { amount: 2, items: [['A', 4, 'price', 2, 5, 5.5]] });
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: true });
});

test('everything arrived: the claim is the engine\'s own amount to the agora (a product on two rows at two prices, with a promotion)', async () => {
  // Catalog ₪4.65 with 15% off → expected ₪3.9525 (not rounded). 9 × ₪4.75 + 1 × ₪4.93.
  const catalog = CATALOG.map(p => p.id === 'A' ? { ...p, price: 4.65 } : p);
  const { saved } = await photoClose({ paper: [['A', 9, 4.75], ['A', 1, 4.93], ['B', 5]], scanned: { A: 10, B: 5 }, catalog, promos: [{ ...PROMO_A, pct: 15 }] });
  // A cap recomputed as (average price − expected) × qty lands on ₪8.15 — nothing was missing, nothing to cap.
  assert.deepEqual([saved.supplierCreditClaim.amount, saved.supplierCreditClaim.items.map(i => [i.productId, i.qty, i.amount])], [8.16, [['A', 10, 8.16]]]);
  assert.equal(saved.aiAudit.findings.find(f => f.type === 'price').amount, 8.16);
});

// ─── the missing goods arrive later ("התקבל זיכוי בסחורה") ───────────────────
// The claim covers the billed units that arrived because a missing unit is deducted
// at the paper price. When the missing units arrive later they are paid at the paper
// price, so their price gap goes back into the claim.
async function goodsLater(c, saved) {
  c.context.rcLater = { ...saved, id: 'rc-later' };
  c.context.cloudTasks = [];
  c.context.goodsConfirm = null;
  c.run(`receipts = [rcLater]; returns = []; runCloudTask = async (name, task) => { cloudTasks.push(task); return true; };
    showConfirm = (title, text, label, fn) => { goodsConfirm = fn; }; openShortGoodsConfirm('rc-later');`);
  await c.run('goodsConfirm()');
  return { after: json(c, 'receipts[0]'), task: json(c, 'cloudTasks').at(-1) };
}
test('goods later: 12 billed at ₪5.50 (list ₪5), 4 arrived, 8 came later — the claim grows to ₪6 and the month pays ₪110', async () => {
  const { c, saved } = await photoClose({ paper: [['A', 12, 5.5], ['B', 10]], scanned: { A: 4, B: 10 } });
  assert.deepEqual(money(c, saved), { recEx: 72, pendingCreditEx: 2, netEx: 70, open: true, aiAuditOpen: true });
  const { after, task } = await goodsLater(c, saved);
  assert.deepEqual(claimOf(after), { amount: 6, items: [['A', 12, 'price', 6, 5, 5.5]] });
  assert.deepEqual(money(c, after), { recEx: 116, pendingCreditEx: 6, netEx: 110, open: true, aiAuditOpen: true }); // was ₪114
  assert.equal(task.data.supplierCreditClaim.amount, 6, 'the grown claim is written with the goods notes');
  assert.deepEqual(task.data.shortGoodsNotes.map(n => [n.productId, n.qty, n.claimTopUp]), [['A', 8, { productId: 'A', qty: 8, amount: 4 }]]);
});

test('goods later on the manual promotion claim: 4 of 12 arrived at the full price, the other 8 came later — claim ₪12, month ₪98', async () => {
  const { data } = fixture({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 }, promos: [PROMO_A] });
  data.products = data.products.slice(0, 2);
  const cloud = harness.fakeCloud();
  const c = harness.runtime('yotvata', { data, cloud });
  await cloud.tick();
  c.run(`showConfirm=(title,text,label,fn)=>fn(); buzz=()=>{}; showInputModal = async () => '8'; receiptOpened = true; receiptDupConfirmed = true;
    receiptEntryMode = 'manual'; receiptAnchorSource = 'manual'; receiptNotes = [{ amount: 110, units: 22 }]; recomputeNoteTotal();
    receiptList = structuredClone(testData.items); saveReceiptDraft(); finishReceipt();`);
  for (let i = 0; i < 5; i++) await tick();
  c.click('rc-goto-manual');
  await c.click('manual-pick', 'A'); for (let i = 0; i < 5; i++) await tick();
  c.click('manual-claim', 'A'); c.node('pmClaim').onclick();
  c.run('saveReconciledReceipt()');
  await c.run('confirmReceipt()');
  for (let i = 0; i < 5; i++) await tick();
  const saved = c.writes.slice().reverse().find(w => w && w.data && Array.isArray(w.data.items)).data;
  assert.equal(saved.supplierCreditClaim.amount, 4);
  const { after } = await goodsLater(c, saved);
  assert.deepEqual([after.supplierCreditClaim.amount, after.supplierCreditClaim.items.map(i => [i.productId, i.qty, i.expectedDiscount])], [12, [['A', 12, 12]]]);
  assert.deepEqual(money(c, after), { recEx: 110, pendingCreditEx: 12, netEx: 98, open: true, aiAuditOpen: false }); // 12 × ₪4 + ₪50
});

// ─── the paper, not the claim, sets the cap ──────────────────────────────────

test('an analyzer claim whose "billed" price contradicts the paper (says ₪5.50, the paper ₪5), no units anchor: no claim', async () => {
  const { c, saved } = await waivedClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 10 },
    claims: [{ kind: 'price', productId: 'A', quantity: 12, billedUnitPriceExVat: 5.5, expectedUnitPriceExVat: 5, amountExVat: 40 }] });
  assert.ok(saved);
  assert.equal(saved.supplierCreditClaim, null);
  assert.deepEqual(money(c, saved), { recEx: 70, pendingCreditEx: 0, netEx: 70, open: true, aiAuditOpen: false });
});

test('a small over-claim is still capped (₪1.20 on 12 billed at ₪5.10, 11 arrived → ₪1.10)', async () => {
  const { saved } = await photoClose({ paper: [['A', 12, 5.1], ['B', 10]], scanned: { A: 11, B: 10 } });
  const claim = claimOf(saved);
  assert.deepEqual([claim.amount, claim.items.map(i => i.slice(0, 4))], [1.1, [['A', 11, 'price', 1.1]]]);
});

test('a price finding that never had a claim (paper cheaper than expected) is saved as before, without a noClaim mark', async () => {
  const { saved } = await photoClose({ paper: [['A', 12, 4.5], ['B', 10]], scanned: { A: 12, B: 10 } });
  const finding = saved.aiAudit.findings.find(f => f.type === 'price');
  assert.deepEqual([finding.productId, finding.amount], ['A', -6]);
  assert.equal('noClaim' in finding, false);
  assert.equal(saved.supplierCreditClaim, null);
});

test('claims with a shortage and a surplus on one product that net to the paper keep the analyzer\'s wording', async () => {
  // Per product the claims net to the paper (A: 3 + 5 = 8 short; B: 2 short − 3 delivered = 1 over).
  const { saved } = await photoClose({ paper: [['A', 12], ['B', 10]], scanned: { A: 4, B: 11 }, claims: [
    { kind: 'substitution', productId: 'A', substituteProductId: 'B', quantity: 3 },
    { kind: 'shortage', productId: 'A', quantity: 5 }, { kind: 'shortage', productId: 'B', quantity: 2 }] });
  assert.deepEqual(items(saved), [['A', 4, 12, 5], ['B', 11, 10, 5]]);
  assert.deepEqual(auditTexts(saved), ['חויב ולא סופק: 3 × מוצר א בדיקה', 'סופק במקומו: 3 × מוצר ב בדיקה', 'חסר 5 × מוצר א בדיקה', 'חסר 2 × מוצר ב בדיקה']);
});
