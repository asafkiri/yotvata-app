// v397: the received quantity is corrected from the shortage/surplus row itself.
// "חסר 80" → type 64 → the row says "חסר 16"; type 80 (or "הגיע הכול") → the
// shortage is gone. The edit is the same count: it reaches the comparison row,
// the scan list and the saved draft, and the findings are rebuilt locally
// without a paid call. Going back to the count and returning keeps the edit.
// v400: a row corrected here does not vanish when it closes — it stays in its
// place, green ("הגיע הכול · 10 יח׳"), with its editor, so a mistake is undone
// by lowering the number again. The memory lives in the draft with the
// comparison state.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cells = h => Object.fromEntries([...h.matchAll(/<div class="text-\[10px\] font-bold text-slate-500">([^<]*)<\/div><div class="text-base font-black [^"]*">([^<]*)<\/div>/g)].map(m => [m[1], m[2]]));
const ROW = '<div class="py-2 border-t border-black/5 first:border-t-0">';
const HEADINGS = ['אלה הבעיות שנמצאו', 'מה שתיקנת כאן'];
function rowHtml(html, name) {
  const head = Math.min(...HEADINGS.map(h => html.indexOf(h)).filter(i => i >= 0));
  if (!Number.isFinite(head)) return '';
  const start = html.indexOf(name, head);
  if (start < 0) return '';
  const end = html.indexOf(ROW, start);
  return html.slice(start, end < 0 ? undefined : end);
}
const editors = html => (html.match(/data-role="ai-recv-input"/g) || []).length;
const greenRows = html => (html.match(/rounded-lg bg-emerald-50 border border-emerald-200 p-2/g) || []).length;
const inputValue = (html, pid) => { const m = html.match(new RegExp('data-role="ai-recv-input" data-id="' + pid + '"[^>]*value="(\\d+)"')); return m ? Number(m[1]) : null; };
const quickButton = (html, pid) => { const m = html.match(new RegExp('<button type="button" data-role="ai-recv-set" data-id="' + pid + '" data-qty="(\\d+)"[^>]*>([^<]*)<')); return m ? { qty: Number(m[1]), text: m[2] } : null; };
const findings = r => JSON.parse(r.run('JSON.stringify((aiScanEvaluation.findings || []).filter(f => f.type === "shortage" || f.type === "surplus").map(f => [f.type, f.productId, f.qty]))'));
const counts = r => JSON.parse(r.run('JSON.stringify({ list: receiptList.map(l => [l.productId, l.qty]), rows: reconcileData.map(l => [l.productId, l.received]), source: receiptReconcileSource })'));
const edits = r => JSON.parse(r.run('JSON.stringify(aiReceivedEdits)'));

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
  assert.equal(greenRows(html), 0, 'still short — the row stays red');
  assert.deepEqual(counts(r), { list: [['milk', 6]], rows: [['milk', 6]], source: [{ productId: 'milk', qty: 6 }] });
  assert.deepEqual(edits(r), { milk: { kind: 'shortage', name: 'חלב בדיקה' } });
  assert.ok(r.toasts.at(-1).includes('התקבלו 6 יח׳') && r.toasts.at(-1).includes('עדיין חסר 4'), r.toasts.at(-1));
});

test('v400 "הגיע הכול" closes the shortage: the row stays in place, green, with its editor; lowering the number brings the shortage back', async () => {
  const r = await shortageScreen();
  r.click('ai-recv-set', 'milk', { qty: '10' });
  let html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), []);
  assert.ok(html.includes('מה שתיקנת כאן:'), 'the group is still drawn, under its own heading');
  const row = rowHtml(html, 'חלב בדיקה');
  assert.ok(row, 'the row is still there');
  assert.equal(greenRows(html), 1);
  assert.ok(strip(row).startsWith('חלב בדיקה הגיע הכול · 10 יח׳'), strip(row));
  assert.deepEqual(cells(row), { 'חויב בתעודה': '10', 'נסרק בפועל': '10', 'חסר': '0' });
  assert.ok(strip(row).includes('תוקן כאן. טעית? שנה את הכמות והחוסר יחזור.'));
  assert.equal(editors(html), 1, 'the editor is on the green row');
  assert.equal(inputValue(html, 'milk'), 10);
  assert.equal(quickButton(html, 'milk'), null, 'nothing to fill in');
  assert.ok(html.includes('תוקן 1'), 'the group badge says one was corrected');
  assert.ok(!html.includes('<span class="rounded-full px-2 py-0.5 text-[10px] font-black bg-rose-100 text-rose-800">'), 'no open-count badge');
  assert.deepEqual(counts(r).list, [['milk', 10]]);
  assert.ok(r.toasts.at(-1).includes('אין חוסר או עודף'), r.toasts.at(-1));

  // A mistake: only 7 came after all. The red row is back, in the same group.
  change(r, 'milk', '7');
  html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['shortage', 'milk', 3]]);
  assert.equal(greenRows(html), 0);
  assert.ok(html.includes('אלה הבעיות שנמצאו:'));
  assert.deepEqual(cells(rowHtml(html, 'חלב בדיקה')), { 'חויב בתעודה': '10', 'נסרק בפועל': '7', 'חסר': '3' });
  assert.equal(editors(html), 1);
});

test('v400 when the fix balances the receipt (manual anchors), the scan step stays with its green row until "המשך"', async () => {
  const r = await shortageScreen();
  r.run("receiptAnchorSource = 'manual'; renderReconcile();");
  assert.equal(r.run('rcStep'), 'ai');
  r.click('ai-recv-set', 'milk', { qty: '10' });
  assert.equal(r.run('rcStep'), 'ai');
  // The paper side of the row still carries the count it was opened with (2); with the
  // paper quantity typed as 10 the receipt balances against the note total.
  r.run("reconcileData.find(l => l.productId === 'milk').noteQty = 10; renderReconcile();");
  assert.equal(r.run('reconcileIsBalanced()'), true);
  assert.equal(r.run('rcStep'), 'ai', 'balanced, but the scan step stays');
  assert.ok(strip(rowHtml(r.node('app').innerHTML, 'חלב בדיקה')).startsWith('חלב בדיקה הגיע הכול · 10 יח׳'));
  // The memory is the only thing holding the screen: without it the comparison moves on to "מאוזן".
  assert.equal(r.run("const keep = aiReceivedEdits; aiReceivedEdits = {}; renderReconcile(); const step = rcStep; aiReceivedEdits = keep; rcStep = 'ai'; renderReconcile(); step"), 'balanced');
  assert.equal(r.run('rcStep'), 'ai');
  r.click('ai-apply');
  assert.equal(r.run('rcStep'), 'balanced', '"המשך" leads on as before');
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

test('a surplus of a product not on the paper: typing 0 removes it from the count, the row stays green and can bring it back', async () => {
  const r = await shortageScreen([{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 10 }, { productId: 'coffee', name: 'קפה בדיקה', barcode: '7290000000015', qty: 4 }]);
  let html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['surplus', 'coffee', 4]]);
  assert.deepEqual(quickButton(html, 'coffee'), { qty: 0, text: 'לא הגיע (0)' });
  change(r, 'coffee', '1');
  assert.deepEqual(findings(r), [['surplus', 'coffee', 1]]);
  r.click('ai-recv-set', 'coffee', { qty: '0' });
  assert.deepEqual(findings(r), []);
  assert.deepEqual(counts(r).list, [['milk', 10]], 'the product left the scan list');
  html = r.node('app').innerHTML;
  const row = rowHtml(html, 'קפה בדיקה');
  assert.ok(strip(row).startsWith('קפה בדיקה לא הגיע · הוסר מהספירה'), strip(row));
  assert.deepEqual(cells(row), { 'חויב בתעודה': '0', 'נסרק בפועל': '0', 'עודף': '0' });
  assert.equal(editors(html), 1);
  change(r, 'coffee', '2');
  assert.deepEqual(findings(r), [['surplus', 'coffee', 2]]);
  assert.deepEqual(counts(r).list, [['coffee', 2], ['milk', 10]]);
  assert.equal(greenRows(r.node('app').innerHTML), 0);
});

test('the edit — and the green row — survive going back to the count and returning to the comparison', async () => {
  const r = await shortageScreen();
  change(r, 'milk', '7');
  assert.deepEqual(findings(r), [['shortage', 'milk', 3]]);
  r.run("setView('receiving')");
  assert.ok(r.node('app').innerHTML.includes('value="7"'), 'the count screen shows the corrected quantity');
  r.run('openReconcile()');
  assert.equal(r.run('rcStep'), 'ai');
  assert.deepEqual(findings(r), [['shortage', 'milk', 3]]);
  assert.deepEqual(counts(r).rows, [['milk', 7]]);
  r.click('ai-recv-set', 'milk', { qty: '10' });
  r.click('rc-recon-cancel');
  assert.equal(r.run('currentView'), 'receiving');
  r.run('openReconcile()');
  const row = rowHtml(r.node('app').innerHTML, 'חלב בדיקה');
  assert.ok(strip(row).startsWith('חלב בדיקה הגיע הכול · 10 יח׳'), 'the green row is restored with the comparison: ' + strip(row));
});

test('the edit is in the saved draft: a restart restores the corrected count, the findings and the green row', async () => {
  const r = await shortageScreen();
  change(r, 'milk', '8');
  const again = harness.runtime('yotvata', { storage: r.storage, data: harness.fixture('yotvata') });
  assert.deepEqual(JSON.parse(again.run('JSON.stringify(receiptList.map(l => [l.productId, l.qty]))')), [['milk', 8]]);
  again.run('openReconcile()');
  assert.deepEqual(findings(again), [['shortage', 'milk', 2]]);
  again.click('ai-recv-set', 'milk', { qty: '10' });
  const third = harness.runtime('yotvata', { storage: again.storage, data: harness.fixture('yotvata') });
  third.run('openReconcile()');
  assert.deepEqual(findings(third), []);
  assert.deepEqual(edits(third), { milk: { kind: 'shortage', name: 'חלב בדיקה' } });
  assert.ok(strip(rowHtml(third.node('app').innerHTML, 'חלב בדיקה')).startsWith('חלב בדיקה הגיע הכול · 10 יח׳'));
});

test('bad input is refused without touching the count; a stale analyzer answer is dropped', async () => {
  const r = await shortageScreen();
  change(r, 'milk', 'abc');
  assert.deepEqual(findings(r), [['shortage', 'milk', 8]]);
  assert.ok(r.toasts.at(-1).includes('הקלד מספר'), r.toasts.at(-1));
  assert.deepEqual(edits(r), {}, 'a refused edit is not remembered');
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

test('v400 two shortages, one corrected: the green row keeps its place above the open one, and the badges say 1 open · 1 corrected', async () => {
  const r = harness.runtime('yotvata', { data: twoProductScan({ scanA: 4, scanB: 2 }) });
  await r.scan();
  r.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(r.run('rcStep'), 'ai');
  assert.deepEqual(findings(r), [['shortage', 'A', 8], ['shortage', 'B', 8]]);
  r.click('ai-recv-set', 'A', { qty: '12' });
  const html = r.node('app').innerHTML;
  assert.deepEqual(findings(r), [['shortage', 'B', 8]]);
  const group = html.slice(html.indexOf('אלה הבעיות שנמצאו:'));
  assert.ok(group.indexOf('מוצר א בדיקה') < group.indexOf('מוצר ב בדיקה'), 'A (green) still comes before B (red)');
  assert.equal(greenRows(html), 1);
  assert.equal(editors(html), 2);
  assert.ok(group.includes('תוקן 1'));
  assert.ok(group.includes('<span class="rounded-full px-2 py-0.5 text-[10px] font-black bg-rose-100 text-rose-800">1</span>'), 'one open shortage');
  assert.ok(strip(rowHtml(html, 'מוצר א בדיקה')).startsWith('מוצר א בדיקה הגיע הכול · 12 יח׳'));
  assert.deepEqual(cells(rowHtml(html, 'מוצר ב בדיקה')), { 'חויב בתעודה': '10', 'נסרק בפועל': '2', 'חסר': '8' });
});

test('no editor when the draft is read-only or there is no saved read; junk in the memory never draws a row', () => {
  const r = harness.runtime('yotvata');
  r.run("aiScanEvaluation = { aggregates: new Map([['p1', { qty: 10 }]]), basketComplete: true }; reconcileData = [{ productId: 'p1', received: 2 }];");
  assert.equal(r.run("aiScanResponse = null; aiQuantityFindingEditorHtml('p1', true)"), '');
  assert.ok(r.run("aiScanResponse = { scan: { documents: [] } }; aiQuantityFindingEditorHtml('p1', true)").includes('ai-recv-input'));
  assert.equal(r.run("canEditDraft = () => false; aiQuantityFindingEditorHtml('p1', true)"), '');
  assert.equal(r.run("aiQuantityFindingEditorHtml('deposit-recv-p1', true)"), '');
  assert.deepEqual(JSON.parse(r.run("aiReceivedEdits = [1, 2]; JSON.stringify(aiResolvedEditRows([]))")), []);
  assert.deepEqual(JSON.parse(r.run("aiReceivedEdits = { p1: 'x', '': { kind: 'shortage' }, p2: { kind: 'weird', name: 7 } }; JSON.stringify(aiReceivedEditsSanitize(aiReceivedEdits))")), { p2: { kind: 'shortage', name: '7' } });
});
