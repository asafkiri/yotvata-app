// v372: whenever a shortage or surplus is shown, the owner sees three numbers —
// billed on the supplier document (חויב בתעודה), actually scanned (נסרק בפועל)
// and the gap. Until v371 the close summary ("סיכום תעודה") said only
// "התקבל 4 × ₪5.00 · חסר 8", and the saved receipt's "הפרשים מול התעודה" said
// only "8 יח׳ · ₪40.00". The summary's numbers always close (they come from one
// line). The saved card shows them only when billed − scanned is exactly the
// gap the row shows (plus what a driver's credit covered); an offset, a goods
// completion or a legacy price offset shrinks the row, and it stays as it was.
// Display only: the saved record, the discrepancy info and the payable never change.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));

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
// The real photo-first flow up to the close summary: scan, finish, confirm, apply.
async function closeSummary(scan) {
  const c = harness.runtime('yotvata', { data: twoProductScan(scan) });
  await c.scan();
  c.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();");
  assert.equal(c.run('rcStep'), 'ai');
  c.click('ai-confirm-findings');
  c.click('ai-apply');
  assert.ok(c.run('!!pendingReceipt'), 'the summary opened');
  return c;
}
// One entry per product line of the summary: name + the grey sub-line.
function summaryLines(html) {
  return [...html.matchAll(/<div class="font-bold text-slate-800 text-sm truncate">([^<]*)<\/div><div class="text-\[11px\] text-slate-400">([\s\S]*?)<\/div><\/div>/g)]
    .map(m => strip(m[1] + ' ' + m[2]));
}
// The saved card's "הפרשים מול התעודה" rows, one string per row.
function diffRows(html) {
  const i = html.indexOf('הפרשים מול התעודה');
  if (i < 0) return [];
  const box = html.slice(i, html.indexOf('לתשלום ₪', i));
  return [...box.matchAll(/<div class="min-w-0"><div class="font-bold truncate">([\s\S]*?)<button data-role="rc-offset-choose"/g)].map(m => strip(m[1]));
}
function renderHistory(rc) {
  const c = harness.runtime('yotvata');
  c.context.historyFixture = rc;
  c.run("receipts=[historyFixture];returns=[];currentView='receiptsHistory';renderReceiptsHistory()");
  return { c, html: c.node('app').innerHTML };
}
// A saved receipt as confirmReceipt writes it: paper A12/B10 at ₪5, scanned A4/B12.
const LINE_A = { productId: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', qty: 4, noteQty: 12, unitPrice: 5, basePrice: 5, lineTotal: 20, promoPct: 0 };
const LINE_B = { productId: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', qty: 12, noteQty: 10, unitPrice: 5, basePrice: 5, lineTotal: 60, promoPct: 0 };
function savedReceipt(overrides = {}) {
  return { id: 'rc-1', timestamp: Date.parse('2026-09-27T09:00:00'), date: '2026-09-27', status: 'open', noDoc: false,
    noteParts: [{ units: 22, amount: 110 }], noteTotalInc: 110, totalExVat: 80, totalIncVat: 80, grossExVat: 80, calculatedExVat: 80,
    count: 2, supplierDiscount: 0, roundingAdjustment: 0, unresolvedAmountGap: 0, unresolvedUnitsGap: 0, supplierCreditClaim: null,
    items: [structuredClone(LINE_A), structuredClone(LINE_B)], aiAudit: null, shortCreditNotes: [], ...overrides };
}

test('close summary: a line with a difference says billed on the paper, scanned and the gap; a line without one is unchanged', async () => {
  let c = await closeSummary({ scanB: 12 });
  assert.deepEqual(summaryLines(c.node('rsBody').innerHTML), [
    'מוצר א בדיקה חויב בתעודה 12 · נסרק בפועל 4 × ₪5.00 · חסר 8',
    'מוצר ב בדיקה חויב בתעודה 10 · נסרק בפועל 12 × ₪5.00 · עודף 2']);
  // The line totals, the payable and the saved lines are what they always were.
  assert.ok(strip(c.node('rsBody').innerHTML).includes('חסר 8 ₪20.00 מוצר ב בדיקה'));
  assert.equal(c.run('pendingReceipt.ex'), 80);
  assert.deepEqual(json(c, 'pendingReceipt.lines.map(l=>[l.productId,l.qty,l.noteQty])'), [['A', 4, 12], ['B', 12, 10]]);
  c = await closeSummary();
  assert.deepEqual(summaryLines(c.node('rsBody').innerHTML), [
    'מוצר א בדיקה חויב בתעודה 12 · נסרק בפועל 4 × ₪5.00 · חסר 8',
    'מוצר ב בדיקה התקבל 10 × ₪5.00']);
  assert.ok(!/NaN|undefined|null/.test(strip(c.node('rsBody').innerHTML)));
});

// The driver's-credit flow of tools/delivery-credit.test.mjs: paper milk×10 and coffee×6
// (₪7.30), only the milk scanned; the driver's credit covers some or all of the coffee.
function creditSetup() {
  const data = harness.fixture('yotvata');
  data.products[1].price = 7.3;
  const doc = data.paper.scan.documents[0];
  Object.assign(doc, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 93.8, printedUnits: 16, printedLines: 2, itemsPrintedLines: 2, itemsSectionTotalExVat: 93.8 });
  doc.rows.push({ ...doc.rows[0], description: 'קפה בדיקה', barcode: '7290000000015', barcodeObserved: '7290000000015', itemCode: '222',
    lineNumber: 2, quantity: 6, unitPriceExVat: 7.3, grossLineTotalExVat: 43.8, lineTotalExVat: 43.8 });
  doc.__pricePaper = structuredClone(doc);
  const c = harness.runtime('yotvata', { data });
  c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:10}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  return { c, data };
}
async function readCredit(c, data, qty, amount) {
  const original = data.paper;
  const raw = structuredClone(original.scan.documents[0].rows[1]);
  Object.assign(raw, { quantity: qty, lineNumber: 1, lineTotalExVat: -amount, grossLineTotalExVat: -amount });
  data.paper = { ok: true, serviceVersion: 145, model: 'fixture', requestId: 'credit-fixture',
    scan: { warnings: [], documents: [{ noteIndex: 0, invoiceNumber: 'TEST-CREDIT', pageCount: 1, subtotalExVat: -amount,
      vatAmount: -Math.round(amount * .18 * 100) / 100, totalInclVat: -Math.round(amount * 1.18 * 100) / 100,
      printedUnits: qty, printedLines: 1, rows: [raw] }] } };
  c.run(`receiptDeliveryCredits.push({id:'credit-1',status:'capture',pageCount:1,
    pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  const read = await c.run("deliveryCreditRead('credit-1')");
  data.paper = original;
  assert.equal(read, true);
  await c.click('delivery-credit-confirm', 'credit-1');
}

test('close summary: a credited line keeps its credit tag, now next to billed and scanned', async () => {
  let { c, data } = creditSetup();
  await readCredit(c, data, 3, 21.9);
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  assert.deepEqual(summaryLines(c.node('rsBody').innerHTML), [
    'קפה בדיקה חויב בתעודה 6 · נסרק בפועל 0 × ₪7.30 · 3 בזיכוי · נותר ללא זיכוי: 3 יח׳ · ₪21.90',
    'חלב בדיקה התקבל 10 × ₪5.00']);
  // A shortage the credit covers in full is still not called "חסר 6" (v369).
  ({ c, data } = creditSetup());
  await readCredit(c, data, 6, 43.8);
  c.run('finishReceipt();aiApplyInvoiceResult()');
  assert.deepEqual(summaryLines(c.node('rsBody').innerHTML), [
    'קפה בדיקה חויב בתעודה 6 · נסרק בפועל 0 × ₪7.30 · 6 בזיכוי',
    'חלב בדיקה התקבל 10 × ₪5.00']);
  assert.doesNotMatch(c.node('rsBody').innerHTML, /חסר 6/);
});

test('saved card: the difference rows say billed, scanned and the gap, next to the money and "מצא קיזוז"', async () => {
  // Straight from the real flow: the lines the summary is about to save.
  const flow = await closeSummary({ scanB: 12 });
  const lines = json(flow, 'pendingReceipt.lines');
  const rc = savedReceipt({ items: lines, totalExVat: flow.run('pendingReceipt.ex'), noteParts: json(flow, 'pendingReceipt.noteParts') });
  const { c, html } = renderHistory(rc);
  assert.deepEqual(diffRows(html), [
    'חסר: מוצר א בדיקה חויב בתעודה 12 · נסרק בפועל 4 · חסר 8 יח׳ · ₪40.00',
    'עודף: מוצר ב בדיקה חויב בתעודה 10 · נסרק בפועל 12 · עודף 2 יח׳ · ₪10.00']);
  assert.equal((html.match(/data-role="rc-offset-choose"/g) || []).length, 2);
  // Display only: the discrepancy info and the saved record are untouched.
  const di = json(c, '(({open,shortItems,overItems,shortVal,overVal})=>({open,shortItems,overItems,shortVal,overVal}))(receiptDiscrepancyInfo(receipts[0]))');
  assert.deepEqual(di, { open: true, shortItems: [{ productId: 'A', name: 'מוצר א בדיקה', n: 8, price: 5 }],
    overItems: [{ productId: 'B', name: 'מוצר ב בדיקה', n: 2, price: 5 }], shortVal: 40, overVal: 10 });
  assert.deepEqual(json(c, 'receipts[0]'), rc);
  // v370 stays: no violet box for quantity findings.
  assert.ok(!html.includes('bg-violet-50 border border-violet-200'));
});

test('saved card: a partial driver credit shows the whole gap and how much of it the credit covered', () => {
  const credit = { id: 'delivery_credit_1', source: 'delivery_credit_scan', number: '4073', autoConfirmed: true, at: Date.parse('2026-09-27T10:00:00'),
    amount: 25, rows: [{ productId: 'A', name: LINE_A.name, qty: 5, amount: 25, barcode: LINE_A.barcode }] };
  const { html } = renderHistory(savedReceipt({ shortCreditNotes: [credit] }));
  const rows = diffRows(html);
  // The open part stays as the row's money line; the paper numbers add up to it plus the credit.
  assert.equal(rows[0], 'חסר: מוצר א בדיקה 3 יח׳ · ₪15.00 חויב בתעודה 12 · נסרק בפועל 4 · חסר 8 (5 יח׳ בזיכוי)');
  assert.equal(rows[1], 'עודף: מוצר ב בדיקה חויב בתעודה 10 · נסרק בפועל 12 · עודף 2 יח׳ · ₪10.00');
});

test('saved card: an offset, a goods completion or a legacy price offset shrinks the row, so it keeps today\'s text', () => {
  // (a) an approved offset against another receipt took 3 of the 8
  let rows = diffRows(renderHistory(savedReceipt({ externalOffsets: [{ id: 'x1', otherId: 'rc-2', productId: 'A', dir: 'short', qty: 3 }] })).html);
  assert.deepEqual(rows, ['חסר: מוצר א בדיקה 5 יח׳ · ₪25.00', 'עודף: מוצר ב בדיקה חויב בתעודה 10 · נסרק בפועל 12 · עודף 2 יח׳ · ₪10.00']);
  // (b) the supplier completed 2 of the missing units in goods
  rows = diffRows(renderHistory(savedReceipt({ shortGoodsNotes: [{ productId: 'A', name: LINE_A.name, qty: 2, price: 5, at: 1 }] })).html);
  assert.equal(rows[0], 'חסר: מוצר א בדיקה 6 יח׳ · ₪30.00');
  // (c) a receipt from before manual offset approval: 2 × A ⇄ 2 × B at the same price were offset automatically
  rows = diffRows(renderHistory(savedReceipt({ timestamp: Date.parse('2026-07-01T09:00:00'), date: '2026-07-01' })).html);
  assert.deepEqual(rows, ['חסר: מוצר א בדיקה 6 יח׳ · ₪30.00']);
});

test('saved card: two difference rows on one product, legacy lines and broken data show no numbers and never throw', () => {
  // (a) the same product on two lines (two supplier documents): each row is only part of the product's gap
  const second = { ...LINE_A, qty: 1, noteQty: 3, lineTotal: 5 };
  const { c, html } = renderHistory(savedReceipt({ items: [structuredClone(LINE_A), second, structuredClone(LINE_B)] }));
  assert.deepEqual(diffRows(html), ['חסר: מוצר א בדיקה 8 יח׳ · ₪40.00', 'חסר: מוצר א בדיקה 2 יח׳ · ₪10.00',
    'עודף: מוצר ב בדיקה חויב בתעודה 10 · נסרק בפועל 12 · עודף 2 יח׳ · ₪10.00']);
  // …also when a driver's credit covered the second line and only one row of the product is left
  const credit = { id: 'dc', source: 'delivery_credit_scan', number: '1', autoConfirmed: true, at: 1, amount: 15,
    rows: [{ productId: 'A', name: LINE_A.name, qty: 3, amount: 15, barcode: LINE_A.barcode }] };
  const covered = renderHistory(savedReceipt({ items: [structuredClone(LINE_A), second, structuredClone(LINE_B)], shortCreditNotes: [credit] })).html;
  assert.deepEqual(diffRows(covered).slice(0, 1), ['חסר: מוצר א בדיקה 7 יח׳ · ₪35.00']);
  // (b) a legacy line without noteQty cannot say what was billed
  assert.equal(c.run("receiptDiffPaperNumbers({items:[{productId:'A',qty:4}]},{productId:'A',n:8},'short',null)"), null);
  // (c) deposits, missing ids and broken records fall back to the plain row
  assert.equal(c.run("receiptDiffPaperNumbers({items:[{productId:'deposit-1',qty:0,noteQty:5}]},{productId:'deposit-1',n:5},'short',null)"), null);
  for (const expr of [
    "receiptDiffRowHtml({id:'x'},{productId:'A',name:'א',n:2,price:5},'short')",
    "receiptDiffRowHtml({id:'x',items:null},{productId:'A',name:'א',n:2,price:5},'over',{di:null,shortSplit:null})",
    "receiptDiffRowHtml({id:'x',items:[null,{productId:'A',qty:'x',noteQty:'y'}]},{productId:'A',name:'א',n:2,price:5},'short',{di:{shortItems:null},shortSplit:{byProduct:{}}})",
    "receiptDiffRowHtml({id:'x',items:[{productId:'A',qty:1.5,noteQty:3}]},{productId:'A',name:'א',n:1.5,price:5},'short')"
  ]) {
    const h = c.run(expr);
    assert.ok(!h.includes('חויב בתעודה'), expr);
    assert.ok(!/NaN|undefined|null/.test(strip(h)), expr);
  }
});
