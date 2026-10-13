// v393: a driver credit that closes everything must read as closed on the comparison screen.
// Field shape (synthetic data only): one product was counted 36 by mistake, the comparison
// was opened (its paper column is then only a copy of the count, v178), the worker went back,
// corrected it to 12 and added the other 24 as a second product with the same unit price.
// The third product never arrived and a confirmed driver credit covers it exactly. Before
// v393 the restored comparison kept the old copy (36), so the credit card claimed
// "נותר לטיפול" for 24 phantom units although the scan card said the shortage was covered.
// v393 rebuilds only an untouched, unbalanced comparison; anything the worker decided, and a
// comparison that already balanced against the paper, restores exactly as in v392.
// These tests run the complete app module (receipt-scan-harness); only fetch, image
// preparation and the Firebase boundary are faked. No paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture } from './receipt-scan-harness.mjs';
import { verifiedCredit } from './credit-verified-fixture.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const row = (c, id) => json(c, `(l => l && {received:l.received, noteQty:l.noteQty})(reconcileData.find(l => l.productId === '${id}'))`);
const status = c => json(c, '(s => s && {amount:s.amount, amountGap:s.amountGap, units:s.units, unitsGap:s.unitsGap, verified:s.verified, shortageCovered:s.shortageCovered, fullyCovered:s.fullyCovered})(deliveryCreditLiveStatus())');
const roles = c => [...c.node('app').innerHTML.matchAll(/<button data-role="([^"]+)"/g)].map(m => m[1]);
// The [data-credit-reconcile] card as text, balanced on its <div>s.
function creditCard(c) {
  const html = c.node('app').innerHTML, start = html.indexOf('<div data-credit-reconcile');
  if (start < 0) return null;
  const re = /<div\b|<\/div>/g; re.lastIndex = start; let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[0] === '</div>' ? -1 : 1; if (!depth) return text(html.slice(start, re.lastIndex)); }
  return null;
}

// Paper: 12 × milk + 24 × cream (both ₪5.00) + 6 × coffee (₪7.30) = ₪223.80, 42 units.
// Coffee is missing; `credit` rows say how much of it the driver's credit covers.
const MILK = { productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008' };
const CREAM = { id: 'cream', name: 'שמנת בדיקה', barcode: '7290000000022', price: 5 };
function paperData() {
  const data = fixture('yotvata');
  data.products[1].price = 7.3;
  data.products.push(structuredClone(CREAM));
  const doc = data.paper.scan.documents[0], base = doc.rows[0];
  doc.rows = [{ ...base, quantity: 12, grossLineTotalExVat: 60, lineTotalExVat: 60 },
    { ...base, description: CREAM.name, barcode: CREAM.barcode, barcodeObserved: CREAM.barcode, itemCode: '333', lineNumber: 2,
      quantity: 24, unitPriceExVat: 5, grossLineTotalExVat: 120, lineTotalExVat: 120 },
    { ...base, description: 'קפה בדיקה', barcode: '7290000000015', barcodeObserved: '7290000000015', itemCode: '222', lineNumber: 3,
      quantity: 6, unitPriceExVat: 7.3, grossLineTotalExVat: 43.8, lineTotalExVat: 43.8 }];
  Object.assign(doc, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 223.8, printedUnits: 42, printedLines: 3, itemsPrintedLines: 3, itemsSectionTotalExVat: 223.8 });
  doc.__pricePaper = structuredClone(doc);
  return data;
}
async function photoReceipt({ milk = 36, credit = [['coffee', 6, 43.8]], storage } = {}) {
  const data = paperData();
  const c = runtime('yotvata', { data, storage });
  c.context.paperFixture = { ...data.paper, docInputs: [{ amount: 223.8, units: 42, pageCount: 1 }] };
  c.context.milkCount = milk;
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:223.8,units:42}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:milkCount}];
    recomputeNoteTotal();restoreDraftScan(paperFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  // The driver's credit, read exactly as the automatic trigger reads it (one faked read).
  const original = data.paper;
  data.paper = verifiedCredit(data, { rows: credit });
  c.run(`receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,
    pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  assert.equal(await c.run(`deliveryCreditRead('credit-1')`), true, c.toasts.join('\n'));
  data.paper = original;
  assert.equal(c.run(`receiptDeliveryCredits[0].status`), 'confirmed');
  return c;
}
// 36 counted as milk → comparison opened → back → 12 milk and 24 cream → comparison again.
function correctAfterComparison(c) {
  c.run('finishReceipt()');
  assert.equal(c.run('currentView'), 'reconcile');
  assert.deepEqual(row(c, 'milk'), { received: 36, noteQty: 36 }, 'the first comparison copies the count');
  c.click('rc-recon-cancel');
  assert.equal(c.run('currentView'), 'receiving');
  c.run(`receiptList.find(l => l.productId === 'milk').qty = 12;
    addReceiptQtyToTop(products.find(p => p.id === 'cream'), 24); saveReceiptDraft(); finishReceipt();`);
  assert.equal(c.run('currentView'), 'reconcile');
}

test('field shape: an untouched comparison is rebuilt from the corrected count, and a credit that closes everything reads as closed', async () => {
  const c = await photoReceipt();
  correctAfterComparison(c);
  assert.equal(c.run('reconcilePaperEntered'), false);
  assert.deepEqual(row(c, 'milk'), { received: 12, noteQty: 12 }, 'the untouched comparison is rebuilt from the corrected count');
  assert.deepEqual(row(c, 'cream'), { received: 24, noteQty: 24 });
  assert.equal(c.run('reconcileGap()'), 43.8, 'only the undelivered coffee is missing');
  const s = status(c);
  assert.equal(s.amount, 43.8); assert.equal(s.amountGap, 0); assert.equal(s.unitsGap, 0);
  assert.equal(s.fullyCovered, true);
  const card = creditCard(c);
  assert.match(card, /תעודת הספק ₪223\.80 זיכוי על חוסר −₪43\.80 צפוי לאחר זיכוי ₪180\.00 סכום הפריטים שהתקבלו ₪180\.00 החוסר מכוסה בזיכוי ✓/);
  assert.doesNotMatch(card, /נותר לטיפול/);
  assert.match(card, /התקבלו בפועל: 36 יח׳ · בזיכוי: 6 יח׳ · בתעודה: 42 יח׳/);
  assert.match(c.node('app').innerHTML, /data-role="ai-apply"[^>]*>[^<]*<i[^>]*><\/i> החוסר מכוסה בזיכוי — המשך/);
  assert.ok(!roles(c).includes('ai-confirm-findings'), 'no "these are the problems" step for a closed credit');
  // Continue: the paper is applied and the receipt is saved closed, paid by what arrived.
  c.click('ai-apply');
  const p = json(c, 'pendingReceipt');
  assert.equal(p.status, 'ok'); assert.equal(p.ex, 180); assert.equal(p.unresolvedAmountGap, 0);
  assert.equal(p.lines.find(l => l.productId === 'milk').qty, 12);
  assert.equal(p.lines.find(l => l.productId === 'milk').noteQty, undefined, 'no "חויב בתעודה 36"');
  assert.deepEqual(p.lines.filter(l => l.noteQty != null).map(l => [l.productId, l.qty, l.noteQty]), [['coffee', 0, 6]], 'only the credited coffee differs from the paper');
  assert.equal(p.shortCreditNotes.length, 1);
  assert.equal(c.requests.filter(r => r.url.endsWith('/scan')).length, 1, 'only the credit read; the invoice paper is reused');
});

test('a draft that already holds a stale copy (saved before v393) still shows the closing credit as closed', async () => {
  const a = await photoReceipt({ milk: 12 });
  a.run(`addReceiptQtyToTop(products.find(p => p.id === 'cream'), 24); saveReceiptDraft(); finishReceipt();`);
  // The owner's draft: the saved baseline already says 12, but the paper column kept 36.
  a.run(`reconcileData.find(l => l.productId === 'milk').noteQty = 36; saveReceiptDraft();`);
  const c = runtime('yotvata', { data: paperData(), storage: new Map(a.storage) });
  c.run(`priceAuditSetDate(0,'2026-09-15'); openReconcile();`);
  assert.equal(c.run('aiScanEvaluation.valid'), true);
  assert.equal(c.run('reconcilePaperEntered'), false);
  assert.deepEqual(row(c, 'milk'), { received: 12, noteQty: 36 }, 'an unchanged row is not rewritten on restore');
  const s = status(c);
  assert.equal(s.amountGap, 0, 'the money gap is measured from what arrived, not from the stale copy');
  assert.equal(s.fullyCovered, true);
  const card = creditCard(c);
  assert.match(card, /החוסר מכוסה בזיכוי ✓/);
  assert.doesNotMatch(card, /נותר לטיפול/);
  assert.ok(roles(c).includes('ai-apply'));
  c.click('ai-apply');
  const p = json(c, 'pendingReceipt');
  assert.equal(p.status, 'ok'); assert.equal(p.ex, 180);
  assert.equal(p.lines.find(l => l.productId === 'milk').noteQty, undefined, 'the stale 36 never reaches the saved receipt');
  assert.equal(c.requests.length, 0, 'restoring never calls AI');
});

test('a credit that covers only part of the shortage still shows the exact amount left', async () => {
  const c = await photoReceipt({ credit: [['coffee', 4, 29.2]] });
  correctAfterComparison(c);
  const s = status(c);
  assert.equal(s.amount, 29.2); assert.equal(s.amountGap, 14.6); assert.equal(s.fullyCovered, false);
  const card = creditCard(c);
  assert.match(card, /נותר לטיפול ₪14\.60/);
  assert.match(card, /חסרות ללא זיכוי: 2 יח׳/);
});

// Manual comparison (no AI paper, no credit): 10 milk (₪5.00) and 3 coffee (₪7.30) were counted.
// `amount`/`units` are the typed paper anchors.
function manualData(deposit = 0) {
  const data = fixture('yotvata');
  data.products[1].price = 7.3;
  data.products[0].deposit = deposit;
  return data;
}
function manual({ milk = 10, coffee = 3, amount = 81.9, units = 15, deposit, promos } = {}) {
  const data = manualData(deposit);
  if (promos) data.promos = promos;
  const c = runtime('yotvata', { data });
  c.context.counts = { milk, coffee, amount, units };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptEntryMode='manual';receiptAnchorSource='manual';
    receiptNotes=[{amount:counts.amount,units:counts.units}];recomputeNoteTotal();
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:counts.milk},{productId:'coffee',name:'קפה בדיקה',barcode:'7290000000015',qty:counts.coffee}];
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();openReconcile();`);
  return c;
}
function backAndCount(c, script) {
  c.click('rc-recon-cancel');
  c.run(script + '; saveReceiptDraft(); openReconcile();');
}
const setCount = (id, qty) => `receiptList.find(l => l.productId === '${id}').qty = ${qty}`;
const balance = c => json(c, '{gap:reconcileGap(), units:reconcileUnitsGap(), balanced:reconcileIsBalanced()}');
const BALANCED = { gap: 0, units: 0, balanced: true };

test('an untouched, unbalanced comparison is rebuilt: removed products leave, deposits follow, a new deposit product gets its row', () => {
  // Paper 12 milk (+ ₪0.30 deposit) + 3 coffee = ₪85.50 / 15; counted 10 milk: not balanced.
  const c = manual({ amount: 85.5, deposit: 0.3 });
  assert.equal(c.run('reconcileIsBalanced()'), false);
  assert.deepEqual(row(c, 'deposit-recv-milk'), { received: 10, noteQty: 10 });
  backAndCount(c, `${setCount('milk', 4)}; receiptList = receiptList.filter(l => l.productId !== 'coffee')`);
  assert.deepEqual(row(c, 'milk'), { received: 4, noteQty: 4 });
  assert.deepEqual(row(c, 'deposit-recv-milk'), { received: 4, noteQty: 4 }, 'the deposit row is rebuilt from the count it is derived from');
  assert.equal(c.run(`reconcileData.some(l => l.productId === 'coffee')`), false, 'a removed product is not left "on the paper"');
  assert.equal(c.run('reconcileReceivedInc()'), c.run('receiptTotals().ex'), 'the comparison receives exactly what the receiving screen counted');
  c.run(`products.push({id:'water',name:'מים בדיקה',barcode:'7290000000039',price:2,deposit:0.3})`);
  backAndCount(c, `addReceiptQtyToTop(products.find(p => p.id === 'water'), 6)`);
  assert.deepEqual(row(c, 'water'), { received: 6, noteQty: 6 });
  assert.deepEqual(row(c, 'deposit-recv-water'), { received: 6, noteQty: 6 });
  assert.equal(c.run('reconcileReceivedInc()'), c.run('receiptTotals().ex'));
  backAndCount(c, '');
  assert.equal(c.run('reconcileData.filter(l => l.productId === "deposit-recv-water").length'), 1, 'reopening does not add it twice');
  assert.equal(c.requests.length, 0);
});

test('a comparison that balanced against the paper is confirmed paper, even without typing: a recount moves only the received side', () => {
  // Paper 10 milk + 3 coffee = ₪71.90 / 13, counted exactly so. Then one milk turns out to be scanned twice.
  const c = manual({ amount: 71.9, units: 13 });
  assert.deepEqual(balance(c), BALANCED);
  backAndCount(c, setCount('milk', 9));
  assert.deepEqual(row(c, 'milk'), { received: 9, noteQty: 10 }, 'the paper still says 10');
  assert.deepEqual(balance(c), BALANCED);
  assert.deepEqual(json(c, 'reconcileAssigned()'), { sh: 5, ov: 0 }, 'the missing milk is an explained shortage');
});

test('a detective answer is paper: a later recount moves only the received side, also after a reload', () => {
  // Paper 12 milk + 3 coffee = ₪81.90 / 15; counted 10 milk and 3 coffee.
  const c = manual();
  assert.equal(c.run('reconcileGap()'), 10);
  c.run('detectiveApplySolution(0)');
  assert.deepEqual(row(c, 'milk'), { received: 10, noteQty: 12 }, 'the detective put the 2 missing milk on the paper');
  assert.equal(c.run('reconcilePaperEntered'), false);
  backAndCount(c, setCount('milk', 12)); // the worker finds the two bottles
  assert.deepEqual(row(c, 'milk'), { received: 12, noteQty: 12 }, 'the paper estimate stays; no phantom surplus');
  assert.deepEqual(balance(c), BALANCED);
  c.run('saveReceiptDraft()');
  // Reload. The column now looks like the count, but it balanced against the paper: two more milk
  // and one more coffee are an explained surplus, not an unexplained gap.
  const r = runtime('yotvata', { data: manualData(), storage: new Map(c.storage) });
  r.run(`showConfirm=(title,text,label,fn)=>{ testToasts.push('CONFIRM: ' + title); fn(); };
    ${setCount('milk', 14)}; ${setCount('coffee', 4)}; saveReceiptDraft(); openReconcile();`);
  assert.deepEqual(row(r, 'milk'), { received: 14, noteQty: 12 });
  assert.deepEqual(row(r, 'coffee'), { received: 4, noteQty: 3 });
  assert.deepEqual(balance(r), BALANCED);
  r.run('saveReconciledReceipt()');
  assert.ok(!r.toasts.some(t => /הפרש לא מוסבר/.test(t)), r.toasts.join('\n'));
  const p = json(r, 'pendingReceipt');
  assert.equal(p.unresolvedAmountGap, 0); assert.equal(p.unresolvedUnitsGap, 0);
  assert.deepEqual(p.lines.filter(l => l.noteQty != null).map(l => [l.productId, l.qty, l.noteQty]).sort(),
    [['coffee', 4, 3], ['milk', 14, 12]], 'the surplus is saved on its products');
  // A ± on the paper column is a decision as well.
  r.run(`reconcileStepNote('coffee', -1)`);
  backAndCount(r, setCount('coffee', 5));
  assert.deepEqual(row(r, 'coffee'), { received: 5, noteQty: 2 });
  assert.equal(c.requests.length + r.requests.length, 0);
});

test('a promo decision (no quantity changed) keeps the column as paper', () => {
  // Promo 10% on milk with a 100-unit minimum: active but not triggered by the count, so the
  // paper's 10 × ₪4.50 + 3 × ₪7.30 = ₪66.90 shows a ₪5 gap that the detective explains as the promo.
  const promos = [{ id: 'pr1', name: 'מבצע חלב', pct: 10, productIds: ['milk'], start: '2000-01-01', end: '2099-12-31', minQty: 100 }];
  const c = manual({ amount: 66.9, units: 13, promos });
  assert.equal(c.run('reconcileGap()'), -5);
  c.click('detective-promo');
  assert.deepEqual(balance(c), BALANCED);
  assert.deepEqual(row(c, 'milk'), { received: 10, noteQty: 10 }, 'no quantity changed, only the discount');
  backAndCount(c, setCount('milk', 9));
  assert.deepEqual(row(c, 'milk'), { received: 9, noteQty: 10 });
  assert.deepEqual(balance(c), BALANCED);
});

test('a shortage recorded in the comparison\'s received column survives lining the count up with it', () => {
  // Paper 10 milk + 3 coffee = ₪71.90 / 13 units, counted exactly so.
  const c = manual({ amount: 71.9, units: 13 });
  c.run(`reconcileStepRecv('coffee', -1); reconcileSetRecvLive('milk', '8')`); // only 2 coffee and 8 milk are really here
  assert.deepEqual(row(c, 'coffee'), { received: 2, noteQty: 3 });
  backAndCount(c, `${setCount('coffee', 2)}; ${setCount('milk', 8)}`); // the count screen is corrected to match
  assert.deepEqual(row(c, 'coffee'), { received: 2, noteQty: 3 }, 'the recorded shortage stays');
  assert.deepEqual(row(c, 'milk'), { received: 8, noteQty: 10 });
  assert.deepEqual(balance(c), BALANCED);
  assert.deepEqual(json(c, 'reconcileAssigned()'), { sh: 17.3, ov: 0 });
});

test('paper quantities typed in the barcode check are paper, even where they equal the count', () => {
  const typePaper = (c, milk, coffee) => {
    c.context.typed = { milk, coffee };
    c.run(`rcStep='quantities'; noteCheckQtyMode=true;
      noteCheckRows=[{d:'7290000000008',pid:'milk',st:'ok',q:typed.milk},{d:'7290000000015',pid:'coffee',st:'ok',q:typed.coffee}];
      noteCheckRes=ncCompute();`);
    c.click('nc-qty-apply');
  };
  // Paper 10 milk + 3 coffee = ₪71.90 / 13; counted 10 milk and 2 coffee. One milk was scanned twice.
  const a = manual({ coffee: 2, amount: 71.9, units: 13 });
  typePaper(a, 10, 3);
  assert.deepEqual(row(a, 'coffee'), { received: 2, noteQty: 3 });
  assert.deepEqual(balance(a), BALANCED);
  backAndCount(a, setCount('milk', 9));
  assert.deepEqual(row(a, 'milk'), { received: 9, noteQty: 10 }, 'the typed 10 is kept');
  assert.deepEqual(balance(a), BALANCED);
});

test('typed paper quantities stay exactly as typed when the count changes; only the received side moves', () => {
  const c = manual();
  c.run(`reconcileSetNoteLive('milk', '12')`);
  assert.equal(c.run('reconcilePaperEntered'), true);
  backAndCount(c, `${setCount('milk', 8)}; ${setCount('coffee', 5)}`);
  assert.deepEqual(row(c, 'milk'), { received: 8, noteQty: 12 });
  assert.deepEqual(row(c, 'coffee'), { received: 5, noteQty: 3 });
});
