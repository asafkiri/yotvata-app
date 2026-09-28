// v368: the shortage/surplus row shows billed · scanned · gap — but only when the
// arithmetic closes; otherwise it falls back to the plain one-line row.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const create = () => harness.runtime('yotvata');
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cells = h => Object.fromEntries([...h.matchAll(/<div class="text-\[10px\] font-bold text-slate-500">([^<]*)<\/div><div class="text-base font-black [^"]*">([^<]*)<\/div>/g)].map(m => [m[1], m[2]]));
const ROW = '<div class="py-2 border-t border-black/5 first:border-t-0">';
function rowCells(html, name) {
  const start = html.indexOf(name, html.indexOf('אלה הבעיות שנמצאו'));
  assert.ok(start > 0, name);
  const end = html.indexOf(ROW, start);
  return cells(html.slice(start, end < 0 ? undefined : end));
}
function row(r, { billed, scanned, finding, type = 'shortage', basketComplete = true, hasAgg = billed != null }) {
  r.context.rowFinding = finding;
  return r.run(`aiScanEvaluation = { aggregates: new Map(${hasAgg ? `[['p1', { qty: ${billed} }]]` : '[]'}), basketComplete: ${basketComplete} };
    reconcileData = ${scanned == null ? '[]' : `[{ productId: 'p1', received: ${scanned} }]`};
    aiQuantityFindingRowHtml(rowFinding, '${type}', 'head')`);
}

test('engine shortage: three cells and a sentence that closes', () => {
  const h = row(create(), { billed: 24, scanned: 12, finding: { type: 'shortage', productId: 'p1', name: 'גבינת סקי 500', qty: 12 } });
  assert.deepEqual(cells(h), { 'חויב בתעודה': '24', 'נסרק בפועל': '12', 'חסר': '12' });
  assert.ok(strip(h).includes('נסרקו 12 יח׳ מתוך 24 שחויבו בתעודה'));
  assert.ok(strip(h).startsWith('גבינת סקי 500 חסר 12 יח׳'));
});

test('surplus on the paper: wording does not say "out of"', () => {
  const h = row(create(), { billed: 12, scanned: 15, type: 'surplus', finding: { type: 'surplus', productId: 'p1', name: 'חלב', qty: 3 } });
  assert.deepEqual(cells(h), { 'חויב בתעודה': '12', 'נסרק בפועל': '15', 'עודף': '3' });
  assert.ok(strip(h).includes('חויבו 12 יח׳ בתעודה ונסרקו 15'));
});

test('surplus not on the paper: billed 0', () => {
  const h = row(create(), { billed: null, scanned: 4, type: 'surplus', finding: { type: 'surplus', productId: 'p1', name: 'קפה', qty: 4 } });
  assert.deepEqual(cells(h), { 'חויב בתעודה': '0', 'נסרק בפועל': '4', 'עודף': '4' });
  assert.ok(strip(h).includes('המוצר לא מופיע בתעודה, ונסרקו 4 יח׳'));
});

test('a finding whose qty is not billed − scanned (analyzer claim) keeps the plain row', () => {
  const h = row(create(), { billed: 6, scanned: 6, finding: { type: 'shortage', productId: 'p1', name: 'חלב', qty: 1, claimId: 'claim-0' } });
  assert.deepEqual(cells(h), {});
  assert.equal(strip(h), 'חלב חסר 1 יח׳');
});

test('credit remainder: credited units and the uncredited remainder are both shown', () => {
  const r = create();
  let h = row(r, { billed: 12, scanned: 10, finding: { type: 'shortage', productId: 'p1', name: 'חלב', qty: 1, creditedQty: 1, amount: 5, creditRemainderLabel: 'חסר ללא זיכוי: 1 יח׳ · ₪5.00' } });
  assert.deepEqual(cells(h), { 'חויב בתעודה': '12', 'נסרק בפועל': '10', 'חסר': '2' });
  assert.ok(strip(h).includes('מתוכם 1 יח׳ בזיכוי · נשארו 1 יח׳ ללא זיכוי'));
  // All units credited at a lower price: money remains, so it is not "fully covered".
  h = row(r, { billed: 10, scanned: 7, finding: { type: 'shortage', productId: 'p1', name: 'חלב', qty: 0, creditedQty: 3, amount: 0.6, creditRemainderLabel: 'יתרה ללא זיכוי · ₪0.60' } });
  assert.deepEqual(cells(h), { 'חויב בתעודה': '10', 'נסרק בפועל': '7', 'חסר': '3' });
  assert.ok(strip(h).includes('כל היחידות בזיכוי, נותרה יתרה של ₪0.60'));
  assert.ok(!strip(h).includes('כל החוסר מכוסה'));
  h = row(r, { billed: 10, scanned: 7, finding: { type: 'shortage', productId: 'p1', name: 'חלב', qty: 0, creditedQty: 3, amount: 0, creditRemainderLabel: 'יתרה ללא זיכוי · ₪0.00' } });
  assert.ok(strip(h).includes('כל החוסר מכוסה'));
});

test('partial basket: "billed" is labelled as resolved rows only', () => {
  const h = row(create(), { billed: 12, scanned: 10, basketComplete: false, finding: { type: 'shortage', productId: 'p1', name: 'קוטג׳', qty: 2 } });
  assert.deepEqual(cells(h), { 'חויב (שורות שזוהו)': '12', 'נסרק בפועל': '10', 'חסר': '2' });
  assert.ok(strip(h).includes('לא כל התעודה נקראה'));
});

test('degenerate states never throw and never leak NaN/undefined', () => {
  const r = create();
  const f = JSON.stringify({ type: 'shortage', productId: 'p1', name: 'x', qty: 2 });
  for (const setup of [
    'aiScanEvaluation = null; reconcileData = null;',
    'aiScanEvaluation = {}; reconcileData = undefined;',
    "aiScanEvaluation = { aggregates: { p1: { qty: 3 } } }; reconcileData = [];",
    "aiScanEvaluation = { aggregates: new Map([['p1', { qty: 3 }]]) }; reconcileData = [null, { productId: 'p1', received: 1 }];",
    "aiScanEvaluation = { aggregates: new Map([['p1', { qty: '3' }]]) }; reconcileData = [{ productId: 'p1', received: '1' }];"
  ]) {
    const h = r.run(setup + ' aiCompactFindingGroupHtml("shortage", "חוסרים", [' + f + '])');
    assert.ok(h.includes('חסר 2 יח׳'), setup);
    assert.ok(!/NaN|undefined|null/.test(strip(h)), setup);
  }
  assert.equal(r.run("aiScanEvaluation = null; aiQuantityFindingRowHtml(null, 'shortage', 'h').includes('חסר 0 יח׳')"), true);
});

test('real scan: every rendered row closes against the engine numbers', async () => {
  const r = create();
  await r.scan();
  r.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(r.run('rcStep'), 'ai');
  const html = r.node('app').innerHTML;
  const findings = JSON.parse(r.run('JSON.stringify(aiScanEvaluation.findings.filter(f => f.type === "shortage" || f.type === "surplus").map(f => ({ type: f.type, name: f.name, qty: f.qty, billed: (aiScanEvaluation.aggregates.get(f.productId) || { qty: 0 }).qty, scanned: (reconcileData.find(l => l.productId === f.productId) || { received: 0 }).received })))'));
  assert.ok(findings.length, 'fixture yields a shortage or surplus');
  assert.ok(!/התצוגה נכשלה/.test(html));
  for (const f of findings) {
    const label = f.type === 'shortage' ? 'חסר' : 'עודף';
    const c = rowCells(html, f.name);
    assert.equal(Number(c['חויב בתעודה']), f.billed, f.name);
    assert.equal(Number(c['נסרק בפועל']), f.scanned, f.name);
    assert.equal(Number(c[label]), f.qty, f.name);
  }
});

// v372: the same three numbers wherever a shortage/surplus is shown. When the
// analyzer ("המנתח") is adopted its claim cards replace the engine rows, so a
// shortage/surplus claim carries the detail too — under the same rule (the
// claim's quantity is exactly paper − scan) and only when it is the one
// quantity claim on that product (a substitution splits into two).
function scanRow(desc, barcode, line, qty) {
  return { section: 'items', description: desc, itemCode: String(100 + line), barcode, barcodeObserved: barcode,
    barcodeReadType: 'full', barcodeMatchMethod: 'exact_full', lineNumber: line, sourcePage: 1, quantity: qty,
    unitPriceExVat: 5, grossLineTotalExVat: qty * 5, lineTotalExVat: qty * 5, lineDiscountExVat: 0, confidence: .95 };
}
// Paper A×paperA and B×paperB at ₪5; the worker scanned A×scanA and B×scanB.
function twoProductScan({ paperA = 12, paperB = 10, scanA = 4, scanB = 10 } = {}) {
  const data = harness.fixture('yotvata');
  data.products = [{ id: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', price: 5 },
    { id: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', price: 5 }];
  const rows = [scanRow('מוצר א בדיקה', '7290000000008', 1, paperA), scanRow('מוצר ב בדיקה', '7290000000015', 2, paperB)];
  const subtotal = (paperA + paperB) * 5;
  Object.assign(data.paper.scan.documents[0], { subtotalExVat: subtotal, printedUnits: paperA + paperB,
    itemsPrintedLines: 2, printedLines: 2, itemsSectionTotalExVat: subtotal, rows });
  data.items = [{ productId: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', qty: scanA },
    { productId: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', qty: scanB }];
  return data;
}
async function analyzerCard(claims, scan) {
  const r = harness.runtime('yotvata', { data: twoProductScan(scan) });
  await r.scan();
  r.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(r.run('rcStep'), 'ai');
  r.context.fetch = async (url, options) => {
    if (options && options.body && JSON.parse(options.body).mode === 'analyze') return harness.reply({ ok: true, analysis: { claims, summary: 'fixture' } });
    throw new Error('Unexpected network request: ' + url);
  };
  await r.run('auditOriginalAnalyzer()');
  assert.equal(r.run('!!(aiAnalyzeResult && aiAnalyzeResult.accepted && aiScanEvaluation.analyzerLed)'), true, 'the analyzer leads');
  r.run('renderReconcile()');
  const html = r.node('app').innerHTML;
  const start = html.indexOf('אלה הבעיות שנמצאו');
  assert.ok(start > 0, 'the claims box is shown');
  assert.ok(html.slice(start, start + 400).includes('נסגר בדיוק ✓'));
  const box = html.slice(start, html.indexOf('המנתח הוביל', start));
  // One card per claim, in order: split on the card's outer div.
  const CARD = '<div class="rounded-xl border p-2.5 ';
  const cards = box.split(CARD).slice(1).map(card => CARD + card);
  return { r, html, box, cards };
}

test('analyzer-led card: a shortage claim that is exactly paper − scan shows billed, scanned and the gap', async () => {
  const { r, html, cards } = await analyzerCard([{ kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40, evidence: 'נייר 12, נסרקו 4' }]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cells(cards[0]), { 'חויב בתעודה': '12', 'נסרק בפועל': '4', 'חסר': '8' });
  const text = strip(cards[0]);
  assert.ok(text.startsWith('חוסר חוסר: 8 × מוצר א בדיקה · ₪40.00 ₪40.00 חויב בתעודה 12 נסרק בפועל 4 חסר 8 נסרקו 4 יח׳ מתוך 12 שחויבו בתעודה'), text);
  assert.ok(text.includes('נייר 12, נסרקו 4'), 'the evidence line stays');
  // The engine rows stay replaced, and the claim itself is unchanged.
  assert.ok(!html.includes('<div class="py-2 border-t border-black/5 first:border-t-0">'), 'no engine rows under the analyzer');
  assert.equal(r.run('aiAnalyzeClaimsPlainText()').split('\n')[1], '· חוסר: 8 × מוצר א בדיקה · ₪40.00');
  assert.deepEqual(JSON.parse(r.run('JSON.stringify(aiScanEvaluation.findings.filter(f=>f.type==="shortage").map(f=>[f.productId,f.qty,f.claimId]))')), [['A', 8, 'claim-0']]);
});

test('analyzer-led card: shortage and surplus claims each get their own numbers', async () => {
  const { cards } = await analyzerCard([
    { kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40 },
    { kind: 'surplus', productId: 'B', quantity: 2, amountExVat: 10 }], { scanB: 12 });
  assert.equal(cards.length, 2);
  assert.deepEqual(cells(cards[0]), { 'חויב בתעודה': '12', 'נסרק בפועל': '4', 'חסר': '8' });
  assert.deepEqual(cells(cards[1]), { 'חויב בתעודה': '10', 'נסרק בפועל': '12', 'עודף': '2' });
  assert.ok(strip(cards[1]).includes('חויבו 10 יח׳ בתעודה ונסרקו 12'));
});

test('analyzer-led card: a claim that closes overall but is not paper − scan for its product keeps the plain card', async () => {
  // Paper A12/B10, scanned A4/B12: the paper gap of A is 8, the claim says 6.
  const { cards } = await analyzerCard([{ kind: 'shortage', productId: 'A', quantity: 6, amountExVat: 30 }], { scanB: 12 });
  assert.equal(cards.length, 1);
  assert.deepEqual(cells(cards[0]), {});
  assert.ok(!/חויב בתעודה|נסרק בפועל/.test(cards[0]));
  assert.ok(strip(cards[0]).includes('חוסר: 6 × מוצר א בדיקה · ₪30.00'));
});

test('analyzer-led card: two quantity claims on one product (a substitution split) show no numbers for either', async () => {
  // Without the guard, "shortage 8 × A" (12 − 4) and "surplus 2 × B" (12 − 10) would each close on
  // their own, next to a substitution that moves two more units between the same products.
  const { cards } = await analyzerCard([
    { kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40 },
    { kind: 'substitution', productId: 'A', substituteProductId: 'B', quantity: 2 },
    { kind: 'surplus', productId: 'B', quantity: 2, amountExVat: 10 }], { scanB: 12 });
  assert.equal(cards.length, 3);
  cards.forEach(card => assert.deepEqual(cells(card), {}, strip(card)));
  assert.ok(strip(cards[1]).startsWith('החלפה החלפה: חויב 2 × מוצר א בדיקה, סופק מוצר ב בדיקה'), strip(cards[1]));
});

test('engine rows: a second quantity finding on the same product drops the numbers', () => {
  const r = create();
  r.context.rowFinding = { type: 'shortage', productId: 'p1', name: 'חלב', qty: 8 };
  const h = r.run(`aiScanEvaluation = { aggregates: new Map([['p1', { qty: 12 }]]), basketComplete: true,
      findings: [rowFinding, { type: 'shortage', productId: 'p1', name: 'חלב', qty: 2, claimId: 'claim-1', claimPart: 'billed' }] };
    reconcileData = [{ productId: 'p1', received: 4 }];
    aiQuantityFindingRowHtml(rowFinding, 'shortage', 'head')`);
  assert.deepEqual(cells(h), {});
  assert.equal(strip(h), 'חלב חסר 8 יח׳');
});
