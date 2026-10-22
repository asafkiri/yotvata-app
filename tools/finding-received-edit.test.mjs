// v397: the received quantity is corrected from the shortage/surplus row itself.
// "חסר 80" → type 64 → the row says "חסר 16"; type 80 (or "הגיע הכול") → the
// shortage is gone. The edit is the same count: it reaches the comparison row,
// the scan list and the saved draft, and the findings are rebuilt locally
// without a paid call. Going back to the count and returning keeps the edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cells = h => Object.fromEntries([...h.matchAll(/<div class="text-\[10px\] font-bold text-slate-500">([^<]*)<\/div><div class="text-base font-black [^"]*">([^<]*)<\/div>/g)].map(m => [m[1], m[2]]));
const ROW = '<div class="py-2 border-t border-black/5 first:border-t-0">';
function rowHtml(html, name) {
  const head = html.indexOf('אלה הבעיות שנמצאו');
  if (head < 0) return '';
  const start = html.indexOf(name, head);
  if (start < 0) return '';
  const end = html.indexOf(ROW, start);
  return html.slice(start, end < 0 ? undefined : end);
}
const editors = html => (html.match(/data-role="ai-recv-input"/g) || []).length;
const inputValue = (html, pid) => { const m = html.match(new RegExp('data-role="ai-recv-input" data-id="' + pid + '"[^>]*value="(\\d+)"')); return m ? Number(m[1]) : null; };
const quickButton = (html, pid) => { const m = html.match(new RegExp('<button type="button" data-role="ai-recv-set" data-id="' + pid + '" data-qty="(\\d+)"[^>]*>([^<]*)<')); return m ? { qty: Number(m[1]), text: m[2] } : null; };
const findings = r => JSON.parse(r.run('JSON.stringify((aiScanEvaluation.findings || []).filter(f => f.type === "shortage" || f.type === "surplus").map(f => [f.type, f.productId, f.qty]))'));
const counts = r => JSON.parse(r.run('JSON.stringify({ list: receiptList.map(l => [l.productId, l.qty]), rows: reconcileData.map(l => [l.productId, l.received]), source: receiptReconcileSource })'));

// Paper: milk ×10 at ₪5 (the harness fixture). Scanned: 2 of it (an empty count
// cannot be closed), so the engine says "חסר 8".
async function shortageScreen(items = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 2 }]) {
  const data = harness.fixture('yotvata');
  data.items = items;
  const r = harness.runtime('yotvata', { data });
  await r.scan();
  r.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(r.run('rcStep'), 'ai');
  return r;
}
function change(r, pid, value) {
  const target = { dataset: { role: 'ai-recv-input', id: pid }, value: String(value), getAttribute: n => n === 'data-role' ? 'ai-recv-input' : null };
  return r.events.get('app:change')({ target });
}

test('typing a received quantity on the shortage row updates the shortage at once', async () => {
  const r = await shortageScreen();
  let html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['shortage', 'milk', 8]]);
  assert.deepEqual(cells(rowHtml(html, 'חלב בדיקה')), { 'חויב בתעודה': '10', 'נסרק בפועל': '2', 'חסר': '8' });
  assert.equal(editors(html), 1, 'one editor on the row');
  assert.equal(inputValue(html, 'milk'), 2);
  assert.deepEqual(quickButton(html, 'milk'), { qty: 10, text: 'הגיע הכול (10)' });

  change(r, 'milk', '6');
  html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['shortage', 'milk', 4]]);
  assert.deepEqual(cells(rowHtml(html, 'חלב בדיקה')), { 'חויב בתעודה': '10', 'נסרק בפועל': '6', 'חסר': '4' });
  assert.ok(strip(rowHtml(html, 'חלב בדיקה')).startsWith('חלב בדיקה חסר 4 יח׳'));
  assert.equal(inputValue(html, 'milk'), 6);
  assert.deepEqual(counts(r), { list: [['milk', 6]], rows: [['milk', 6]], source: [{ productId: 'milk', qty: 6 }] });
  assert.ok(r.toasts.at(-1).includes('התקבלו 6 יח׳') && r.toasts.at(-1).includes('עדיין חסר 4'), r.toasts.at(-1));
});

test('"הגיע הכול" clears the shortage; the row disappears', async () => {
  const r = await shortageScreen();
  r.click('ai-recv-set', 'milk', { qty: '10' });
  const html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), []);
  assert.equal(rowHtml(html, 'חלב בדיקה'), '', 'no shortage row any more');
  assert.equal(editors(html), 0);
  assert.deepEqual(counts(r).list, [['milk', 10]]);
  assert.ok(r.toasts.at(-1).includes('אין חוסר או עודף'), r.toasts.at(-1));
});

test('plus and minus step the received quantity by one unit, never below zero', async () => {
  const r = await shortageScreen();
  r.click('ai-recv-step', 'milk', { delta: '1' });
  r.click('ai-recv-step', 'milk', { delta: '1' });
  assert.deepEqual(findings(r), [['shortage', 'milk', 6]]);
  for (let i = 0; i < 5; i++) r.click('ai-recv-step', 'milk', { delta: '-1' });
  assert.deepEqual(findings(r), [['shortage', 'milk', 10]]);
  assert.deepEqual(counts(r).list, [], 'a zero count leaves the scan list');
  assert.ok(/data-role="ai-recv-step" data-id="milk" data-delta="-1"[^>]* disabled>/.test(r.node('app').innerHTML));
});

test('a surplus of a product not on the paper: typing 0 removes it from the count', async () => {
  const r = await shortageScreen([{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 10 }, { productId: 'coffee', name: 'קפה בדיקה', barcode: '7290000000015', qty: 4 }]);
  const html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['surplus', 'coffee', 4]]);
  assert.deepEqual(quickButton(html, 'coffee'), { qty: 0, text: 'לא הגיע (0)' });
  change(r, 'coffee', '1');
  assert.deepEqual(findings(r), [['surplus', 'coffee', 1]]);
  r.click('ai-recv-set', 'coffee', { qty: '0' });
  assert.deepEqual(findings(r), []);
  assert.deepEqual(counts(r).list, [['milk', 10]], 'the product left the scan list');
  assert.equal(editors(r.node('app').innerHTML), 0);
});

test('the edit survives going back to the count and returning to the comparison', async () => {
  const r = await shortageScreen();
  change(r, 'milk', '7');
  assert.deepEqual(findings(r), [['shortage', 'milk', 3]]);
  r.run("setView('receiving')");
  assert.ok(r.node('app').innerHTML.includes('value="7"'), 'the count screen shows the corrected quantity');
  r.run('openReconcile()');
  assert.equal(r.run('rcStep'), 'ai');
  assert.deepEqual(findings(r), [['shortage', 'milk', 3]]);
  assert.deepEqual(counts(r).rows, [['milk', 7]]);
});

test('the edit is in the saved draft: a restart restores the corrected count and findings', async () => {
  const r = await shortageScreen();
  change(r, 'milk', '8');
  const again = harness.runtime('yotvata', { storage: r.storage, data: harness.fixture('yotvata') });
  assert.deepEqual(JSON.parse(again.run('JSON.stringify(receiptList.map(l => [l.productId, l.qty]))')), [['milk', 8]]);
  again.run('openReconcile()');
  assert.deepEqual(findings(again), [['shortage', 'milk', 2]]);
});

test('bad input is refused without touching the count; a stale analyzer answer is dropped', async () => {
  const r = await shortageScreen();
  change(r, 'milk', 'abc');
  assert.deepEqual(findings(r), [['shortage', 'milk', 8]]);
  assert.ok(r.toasts.at(-1).includes('הקלד מספר'), r.toasts.at(-1));
  assert.equal(r.run("aiSetFindingReceived('deposit-recv-x', 3)"), false);
  assert.equal(r.run("aiSetFindingReceived('', 3)"), false);
  r.run("aiAnalyzeResult = { accepted: true, claims: [], findings: [], closure: { ok: true } }; aiScanEvaluation.analyzerLed = true;");
  change(r, 'milk', '5');
  assert.equal(r.run('aiAnalyzeResult'), null);
  assert.equal(r.run('aiScanEvaluation.analyzerLed === true'), false);
  assert.deepEqual(findings(r), [['shortage', 'milk', 5]]);
});

// When the analyzer leads, its claim card replaces the engine row — so the
// editor sits under its three numbers, once per product, and an edit drops the
// stale lead and rebuilds the engine findings against the corrected count.
function scanRow(desc, barcode, line, qty) {
  return { section: 'items', description: desc, itemCode: String(100 + line), barcode, barcodeObserved: barcode,
    barcodeReadType: 'full', barcodeMatchMethod: 'exact_full', lineNumber: line, sourcePage: 1, quantity: qty,
    unitPriceExVat: 5, grossLineTotalExVat: qty * 5, lineTotalExVat: qty * 5, lineDiscountExVat: 0, confidence: .95 };
}
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
async function analyzerLed(claims, scan) {
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
  return r;
}

test('analyzer-led card: the editor sits under the numbers; an edit rebuilds the findings locally', async () => {
  const r = await analyzerLed([{ kind: 'shortage', productId: 'A', quantity: 8, amountExVat: 40, evidence: 'נייר 12, נסרקו 4' }]);
  let html = r.node('app').innerHTML;
  assert.equal(editors(html), 1, 'one editor on the page — under the claim card');
  assert.equal(inputValue(html, 'A'), 4);
  assert.deepEqual(quickButton(html, 'A'), { qty: 12, text: 'הגיע הכול (12)' });
  r.context.fetch = async url => { throw new Error('Unexpected network request: ' + url); };
  change(r, 'A', '10');
  assert.equal(r.run('aiAnalyzeResult'), null);
  assert.deepEqual(findings(r), [['shortage', 'A', 2]]);
  html = r.node('app').innerHTML;
  assert.deepEqual(cells(rowHtml(html, 'מוצר א בדיקה')), { 'חויב בתעודה': '12', 'נסרק בפועל': '10', 'חסר': '2' });
  assert.equal(editors(html), 1, 'still one editor — now on the engine row');
  assert.deepEqual(counts(r).list, [['A', 10], ['B', 10]]);
});

test('analyzer-led card: a claim without the numbers (not paper − scan) gets no editor', async () => {
  const r = await analyzerLed([{ kind: 'shortage', productId: 'A', quantity: 6, amountExVat: 30 }], { scanB: 12 });
  const html = r.node('app').innerHTML;
  assert.equal(editors(html), 0);
});

test('no editor when the draft is read-only or there is no saved read', () => {
  const r = harness.runtime('yotvata');
  r.run("aiScanEvaluation = { aggregates: new Map([['p1', { qty: 10 }]]), basketComplete: true }; reconcileData = [{ productId: 'p1', received: 2 }];");
  assert.equal(r.run("aiScanResponse = null; aiQuantityFindingEditorHtml('p1', true)"), '');
  assert.ok(r.run("aiScanResponse = { scan: { documents: [] } }; aiQuantityFindingEditorHtml('p1', true)").includes('ai-recv-input'));
  assert.equal(r.run("canEditDraft = () => false; aiQuantityFindingEditorHtml('p1', true)"), '');
  assert.equal(r.run("aiQuantityFindingEditorHtml('deposit-recv-p1', true)"), '');
});
