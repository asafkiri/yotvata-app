import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture, fakeCloud } from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const uploads = c => c.requests.filter(r => r.url.endsWith('/scan')).length;
function setup(options = {}) {
  const data = fixture('yotvata');
  data.products[1].price = 7.3;
  const doc = data.paper.scan.documents[0];
  Object.assign(doc, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 93.8, printedUnits: 16,
    printedLines: 2, itemsPrintedLines: 2, itemsSectionTotalExVat: 93.8 });
  doc.rows.push({ ...doc.rows[0], description: 'קפה בדיקה', barcode: '7290000000015',
    barcodeObserved: '7290000000015', itemCode: '222', lineNumber: 2, quantity: 6,
    unitPriceExVat: 7.3, grossLineTotalExVat: 43.8, lineTotalExVat: 43.8 });
  doc.__pricePaper = structuredClone(doc);
  const saved = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
  const c = runtime('yotvata', { data, ...options });
  c.context.creditInvoiceFixture = saved;
  c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
    receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:10}];
    recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';priceAuditSetDate(0,'2026-09-15');
    showConfirm=(title,text,label,fn)=>fn();saveReceiptDraft();`);
  return { c, data };
}
function response(data, { qty = 6, amount = 43.8, number = 'TEST-CREDIT', product = 1 } = {}) {
  const raw = structuredClone(data.paper.scan.documents[0].rows[product]);
  Object.assign(raw, { quantity: qty, lineNumber: 1, lineTotalExVat: -amount, grossLineTotalExVat: -amount });
  return { ok: true, serviceVersion: 145, model: 'fixture', requestId: 'credit-fixture',
    scan: { warnings: [], documents: [{ noteIndex: 0, invoiceNumber: number, pageCount: 1,
      subtotalExVat: -amount, vatAmount: -Math.round(amount * .18 * 100) / 100,
      totalInclVat: -Math.round(amount * 1.18 * 100) / 100,
      printedUnits: qty, printedLines: 1, rows: [raw] }] } };
}
async function readCredit(c, data, options = {}, id = 'credit-1') {
  // The boundary responds with a different document; the already saved invoice
  // and its original positive paper values stay in the application unchanged.
  const original = data.paper;
  data.paper = response(data, options);
  c.context.creditTestId = id;
  c.run(`receiptDeliveryCredits.push({id:creditTestId,status:'capture',pageCount:1,
    pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]});`);
  const result = await c.run('deliveryCreditRead(creditTestId)');
  data.paper = original;
  assert.equal(result, true, c.toasts.join('\n') + c.run('receiptDeliveryCredits.at(-1).error'));
}
function finish(c) {
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  return json(c, 'pendingReceipt');
}
function discrepancy(c, pending) {
  c.context.pendingFixture = pending;
  return json(c, 'receiptDiscrepancyInfo({...pendingFixture,items:pendingFixture.lines})');
}

test('a confirmed credit is folded and clears the live gap before saving', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  await c.click('delivery-credit-confirm', 'credit-1');
  const cards = c.run('deliveryCreditsHtml()');
  assert.match(cards, /<details data-delivery-credit="credit-1"[^>]*><summary/);
  assert.doesNotMatch(cards, /<details[^>]*\bopen\b/);
  assert.match(cards, /זיכוי שאושר · ₪43\.80 לפני מע״מ · פרטים/);
  const html = c.run('receivingProgressHtml(receiptTotals())');
  assert.match(html, /החוסר מכוסה בזיכוי/);
  assert.match(html, /₪50\.00 \/ ₪50\.00/);
  assert.match(html, /10\/16 יח׳/); assert.match(html, /6 יח׳ בזיכוי/);
  assert.doesNotMatch(html, /פער ₪43\.80/);
  assert.equal(c.run('receiptNoteTotal'), 93.8);
  assert.equal(c.run('receiptTotals().units'), 10);
  assert.equal(c.run('pendingReceipt'), null);
  c.run('finishReceipt()');
  assert.match(c.node('app').innerHTML, /החוסר מכוסה בזיכוי — המשך/);
  assert.doesNotMatch(c.node('app').innerHTML, /חסרות 6|חסר 6 יח׳|נתח את הפער|אלה אכן הבעיות — אשר/);
  assert.equal(c.run('aiScanEvaluation.findings.find(f=>f.type==="shortage").qty'), 6);
  c.run('aiApplyInvoiceResult()');
  assert.equal(c.run('pendingReceipt.status'), 'ok');
  assert.equal(c.run('pendingReceipt.ex'), 50);
  assert.match(c.node('rsBody').innerHTML, /6 בזיכוי/);
  assert.doesNotMatch(c.node('rsBody').innerHTML, /חסר 6/);
  assert.equal(uploads(c), 1);
});

test('a partial credit shows only the three units and money still uncovered', async () => {
  const { c, data } = setup(); await readCredit(c, data, { qty: 3, amount: 21.9 });
  await c.click('delivery-credit-confirm', 'credit-1');
  const html = c.run('receivingProgressHtml(receiptTotals())');
  assert.match(html, /נותר לטיפול ₪21\.90/);
  assert.doesNotMatch(html, /החוסר מכוסה בזיכוי ✓/);
  c.run('finishReceipt()');
  assert.match(c.node('app').innerHTML, /חסר ללא זיכוי: 3 יח׳ · ₪21\.90/);
  assert.match(c.node('app').innerHTML, /חסרות ללא זיכוי: 3 יח׳/);
  assert.doesNotMatch(c.node('app').innerHTML, /חסר 6 יח׳/);
  const p = finish(c);
  assert.equal(p.status, 'open'); assert.equal(p.ex, 50);
  assert.equal(discrepancy(c, p).shortVal, 21.9);
});

test('credit coverage updates immediately with counts, editing and removal', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  await c.click('delivery-credit-confirm', 'credit-1');
  c.run("receiptList.push({productId:'coffee',qty:1});refreshReceiptTotals()");
  assert.match(c.node('rcProgress').outerHTML, /הזיכוי אינו תואם לחוסר/);
  assert.doesNotMatch(c.node('rcProgress').outerHTML, /החוסר מכוסה בזיכוי/);
  c.run('receiptList.pop();refreshReceiptTotals()');
  assert.match(c.node('rcProgress').outerHTML, /החוסר מכוסה בזיכוי/);
  await c.click('delivery-credit-edit', 'credit-1');
  assert.doesNotMatch(c.run('deliveryCreditsHtml()'), /<details data-delivery-credit/);
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /פער ₪43\.80/);
  await c.click('delivery-credit-confirm', 'credit-1');
  await c.click('delivery-credit-remove', 'credit-1');
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /פער ₪43\.80/);
});

test('one credited product never hides a different missing product', async () => {
  const { c, data } = setup(); c.run('receiptList[0].qty=9');
  await readCredit(c, data); await c.click('delivery-credit-confirm', 'credit-1');
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /נותר לטיפול ₪5\.00/);
  c.run('finishReceipt()');
  const status = json(c, 'deliveryCreditLiveStatus()');
  assert.equal(status.fullyCovered, false);
  assert.deepEqual(status.findings.filter(f => f.type === 'shortage').map(f => f.productId), ['milk']);
  assert.match(c.node('app').innerHTML, /חסרות ללא זיכוי: 1 יח׳/);
});

for (const [label, options] of [['wrong product', { product: 0 }], ['excess quantity', { qty: 7 }], ['excess money', { amount: 44 }]]) {
  test('live status rejects ' + label + ' instead of subtracting the attached total', async () => {
    const { c, data } = setup(); await readCredit(c, data, options);
    await c.click('delivery-credit-confirm', 'credit-1');
    assert.match(c.run('receivingProgressHtml(receiptTotals())'), /פער ₪43\.80/);
    assert.match(c.run('receivingProgressHtml(receiptTotals())'), /הזיכוי אינו תואם לחוסר/);
    c.run('finishReceipt()');
    assert.doesNotMatch(c.node('app').innerHTML, /החוסר מכוסה בזיכוי/);
    assert.match(c.node('app').innerHTML, /חסר 6 יח׳/);
  });
}

test('credited quantities with insufficient money leave a visible monetary remainder', async () => {
  const { c, data } = setup(); await readCredit(c, data, { amount: 40 });
  await c.click('delivery-credit-confirm', 'credit-1');
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /נותר לטיפול ₪3\.80/);
  c.run('finishReceipt()');
  assert.match(c.node('app').innerHTML, /יתרה ללא זיכוי · ₪3\.80/);
  assert.doesNotMatch(c.node('app').innerHTML, /החוסר מכוסה בזיכוי — המשך/);
});

test('multiple partial credits combine in live status and draft restoration without rescanning', async () => {
  const { c, data } = setup();
  for (let i = 1; i <= 2; i++) {
    await readCredit(c, data, { qty: 3, amount: 21.9, number: 'PART-' + i }, 'credit-' + i);
    c.run(`deliveryCreditConfirm('credit-${i}')`);
  }
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  const restored = runtime('yotvata', { data, storage: new Map(c.storage) });
  restored.run('restoreReceiptDraft()');
  assert.match(restored.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  assert.equal(uploads(restored), 0);
});

test('unverified invoice data cannot declare a shortage covered from the matching total alone', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  await c.click('delivery-credit-confirm', 'credit-1');
  c.run('aiScanResponse.scan.documents[0].subtotalExVat=94.8');
  const html = c.run('receivingProgressHtml(receiptTotals())');
  assert.match(html, /פער ₪43\.80/); assert.doesNotMatch(html, /החוסר מכוסה בזיכוי/);
  assert.match(html, /אחרי השלמת בדיקת התעודה/);
});

test('surplus and independent price issues remain actionable after a shortage credit', async () => {
  const { c, data } = setup(); c.run('receiptList[0].qty=11');
  await readCredit(c, data); await c.click('delivery-credit-confirm', 'credit-1');
  c.run('finishReceipt()');
  assert.match(c.node('app').innerHTML, /עודף 1 יח׳/);
  assert.doesNotMatch(c.node('app').innerHTML, /החוסר מכוסה בזיכוי — המשך/);
  const filtered = json(c, `deliveryCreditRemainingFindings([
    {type:'shortage',productId:'coffee',qty:6},
    {type:'price',productId:'milk',amount:10},
    {type:'promo_missing',productId:'milk',amount:2}
  ],deliveryCreditLiveStatus())`);
  assert.deepEqual(filtered.map(f => f.type), ['price', 'promo_missing']);
});

test('an old accepted analysis cannot ask for the already supplied credit again', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  await c.click('delivery-credit-confirm', 'credit-1'); c.run('finishReceipt()');
  c.run(`aiScanEvaluation.analyzerLed=true;
    aiAnalyzeResult={accepted:true,summary:'טענה ישנה',claims:[{kind:'shortage',productId:'coffee',quantity:6,amountExVat:43.8}],closure:{}};
    renderReconcile()`);
  assert.doesNotMatch(c.node('app').innerHTML, /טענה ישנה|העתק לטענות מול הספק|נתח את הפער/);
  assert.match(c.node('app').innerHTML, /החוסר מכוסה בזיכוי — המשך/);
});

test('photograph, confirm and save a credited shortage once without reducing stock or payment twice', async () => {
  const { c, data } = setup();
  const paper = c.run('JSON.stringify(aiScanResponse)'), stock = c.run('JSON.stringify(receiptList)');
  await readCredit(c, data);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run('deliveryCreditReady()'), false);
  assert.equal(c.run('JSON.stringify(aiScanResponse)'), paper);
  assert.equal(c.run('JSON.stringify(receiptList)'), stock);
  assert.equal(c.run('receiptNoteTotal'), 93.8);
  assert.match(c.run('deliveryCreditsHtml()'), /האם זה זיכוי על חוסר במשלוח הנוכחי/);
  await c.click('delivery-credit-confirm', 'credit-1');
  const confirmed = c.run('JSON.stringify(deliveryCreditSnapshot())');
  await c.click('delivery-credit-confirm', 'credit-1');
  assert.equal(c.run('JSON.stringify(deliveryCreditSnapshot())'), confirmed);
  const p = finish(c);
  assert.ok(p); assert.equal(p.ex, 50); assert.equal(p.status, 'ok');
  const coffee = p.lines.find(x => x.productId === 'coffee');
  assert.equal(coffee.qty, 0); assert.equal(coffee.noteQty, 6);
  const di = discrepancy(c, p);
  assert.equal(di.shortValRaw, 43.8); assert.equal(di.shortVal, 0); assert.equal(di.shortFullyCredited, true);
  assert.match(c.node('rsBody').innerHTML, /הזיכוי מהנהג מכסה את החוסר/);
  assert.equal(p.shortCreditNotes[0].number, 'TEST-CREDIT');
  assert.equal(p.shortCreditNotes[0].paper.subtotalExVat, -43.8);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.ok(saved); assert.equal(saved.shortCreditNotes.length, 1);
  c.context.savedCreditReceipt = saved;
  assert.equal(c.run('receiptPayableBaseEx(savedCreditReceipt)'), 50);
  assert.equal(c.run('receiptPayableBaseEx({...savedCreditReceipt,shortCreditNotes:[]})'), 50);
  assert.equal(c.writes.some(w => w.path?.includes('returns')), false);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(uploads(c), 1);
});

test('a partial credit leaves only its uncovered amount open', async () => {
  const { c, data } = setup(); await readCredit(c, data, { qty: 3, amount: 21.9 });
  c.run("deliveryCreditConfirm('credit-1')"); const p = finish(c), di = discrepancy(c, p);
  assert.equal(p.ex, 50); assert.equal(p.status, 'open'); assert.equal(di.shortVal, 21.9);
  assert.match(c.node('rsBody').innerHTML, /עדיין ממתין לזיכוי: ₪21\.90/);
});

test('a credit for coffee leaves a separate milk shortage open', async () => {
  const { c, data } = setup(); c.run('receiptList[0].qty=9');
  await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  const p = finish(c); assert.equal(p.ex, 45); assert.equal(p.status, 'open');
  assert.equal(discrepancy(c, p).shortVal, 5);
});

for (const [label, options] of [['different product', { product: 0 }], ['too many units', { qty: 7 }], ['excess amount', { amount: 44 }]]) {
  test(label + ' cannot close the shortage or save a misleading credit', async () => {
    const { c, data } = setup(); await readCredit(c, data, options);
    c.run("deliveryCreditConfirm('credit-1')"); assert.equal(finish(c), null);
    assert.match(c.toasts.at(-1), /אינו תואם לחוסר/); assert.equal(c.writes.length, 0);
  });
}

test('two separate partial credit notes cover the shortage; overlapping notes do not', async () => {
  for (const qty of [3, 6]) {
    const { c, data } = setup();
    for (let i = 1; i <= 2; i++) {
      await readCredit(c, data, { qty, amount: qty * 7.3, number: 'TEST-CREDIT-' + i }, 'credit-' + i);
      c.run(`deliveryCreditConfirm('credit-${i}')`);
    }
    const p = finish(c);
    if (qty === 3) { assert.equal(p.status, 'ok'); assert.equal(p.shortCreditNotes.length, 2); assert.equal(p.ex, 50); }
    else assert.equal(p, null);
  }
});

test('an unconfirmed or edited credit blocks completion until confirmed or removed', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  c.run('finishReceipt()'); assert.equal(c.run('pendingReceipt'), null);
  assert.match(c.toasts.at(-1), /השלם|אשר/);
  await c.click('delivery-credit-confirm', 'credit-1'); assert.ok(finish(c));
  await c.click('delivery-credit-edit', 'credit-1');
  assert.equal(c.run('pendingReceipt'), null); assert.equal(c.run('deliveryCreditReady()'), false);
  await c.click('delivery-credit-remove', 'credit-1');
  assert.equal(c.run('deliveryCreditReady()'), true);
  assert.equal(finish(c).status, 'open');
});

test('duplicate credit numbers in this delivery or receipt history require correction', async () => {
  for (const history of [false, true]) {
    const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
    if (history) c.run("receipts=[{id:'old',shortCreditNotes:[{number:'TEST-CREDIT',amount:43.8}]}]");
    else await readCredit(c, data, {}, 'credit-2');
    assert.equal(c.run('deliveryCreditReady()'), false);
    assert.match(c.run('deliveryCreditsHtml()'), /כבר צורף/);
    assert.equal(c.run("deliveryCreditConfirm('credit-1')"), false);
  }
});

test('draft reload and cloud restoration retain the approved credit without images or another read', async () => {
  const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  const expected = json(c, 'deliveryCreditNotes()');
  assert.equal(JSON.stringify(json(c, 'receiptDraftPayload()').deliveryCredits).includes('data:image'), false);
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  assert.deepEqual(json(reloaded, 'deliveryCreditNotes()'), expected);
  assert.equal(reloaded.run('deliveryCreditReady()'), true); assert.equal(uploads(reloaded), 0);
  const remote = runtime('yotvata', { data });
  remote.context.remoteDraft = json(c, 'receiptDraftPayload(true)'); remote.run('restoreReceiptDraft(remoteDraft)');
  assert.deepEqual(json(remote, 'deliveryCreditNotes()'), expected);
  assert.equal(finish(remote).status, 'ok'); assert.equal(uploads(remote), 0);
});

test('unfinished scan recovers with a clear recapture action after reload', async () => {
  const { c, data } = setup();
  c.run("receiptDeliveryCredits=[{id:'credit-1',status:'reading',pages:[],pageCount:1}];saveReceiptDraft()");
  const restored = runtime('yotvata', { data, storage: c.storage });
  assert.match(restored.run('deliveryCreditsHtml()'), /לא הושלם.*צלם אותו שוב/);
  assert.equal(restored.run('deliveryCreditReady()'), false); assert.equal(uploads(restored), 0);
});

test('a removed credit ignores a response that arrives later', async () => {
  const { c, data } = setup(); const pending = response(data);
  let release; c.context.fetch = async () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => pending }); });
  c.run("receiptDeliveryCredits=[{id:'credit-1',status:'capture',pages:[{dataUrl:'data:image/jpeg;base64,AA==',orientationConfirmed:true}]}]");
  const work = c.run("deliveryCreditRead('credit-1')");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function'); await c.click('delivery-credit-remove', 'credit-1');
  release(); assert.equal(await work, false); assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('receiptNoteTotal'), 93.8);
});

test('manual barcode correction displays the resolved name before approval and preserves printed money', async () => {
  const { c, data } = setup(); await readCredit(c, data);
  const raw = c.run('JSON.stringify(receiptDeliveryCredits[0].paper)');
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-barcode', id: 'credit-1', row: '0' }, value: '7290000000008' } });
  assert.equal(c.node('creditName_credit-1_0').textContent, 'חלב בדיקה');
  assert.equal(c.run('JSON.stringify(receiptDeliveryCredits[0].paper)'), raw);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  assert.equal(finish(c), null, 'Correct identity still must match the actual shortage');
});

test('catalog binding changes expose a usable review; mere catalog price changes do not revoke identity', async () => {
  const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  c.run('products[1].price=20'); assert.equal(c.run('deliveryCreditReady()'), true);
  c.run("products[1].id='coffee-new'"); assert.equal(c.run('deliveryCreditReady()'), false);
  assert.match(c.run('deliveryCreditsHtml()'), /פרטי המוצר השתנו/);
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
});

test('a credit never migrates to a different shortage after a saved receipt is edited', async () => {
  const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  const p = finish(c); p.lines.find(x => x.productId === 'coffee').qty = 6;
  Object.assign(p.lines.find(x => x.productId === 'milk'), { qty: 1, noteQty: 10 });
  const di = discrepancy(c, p);
  assert.equal(di.deliveryCreditMismatch, true); assert.equal(di.shortCreditEx, 0);
  assert.equal(di.shortVal, 45); assert.equal(di.open, true);
});

for (const [label, mutate] of [
  ['positive invoice', d => { d.subtotalExVat = 43.8; d.rows[0].lineTotalExVat = 43.8; }],
  ['mixed sign', d => { d.rows[0].lineTotalExVat = 43.8; }],
  ['row total', d => { d.rows[0].lineTotalExVat = -43; }],
  ['units', d => { d.printedUnits = 7; }],
  ['VAT total', d => { d.totalInclVat = -50; }],
  ['missing page', d => { d.pageCount = 2; }],
  ['unknown source page', d => { d.rows[0].sourcePage = null; }]
]) test('unbalanced or ambiguous paper is not accepted: ' + label, async () => {
  const { c, data } = setup(); const credit = response(data); mutate(credit.scan.documents[0]); data.paper = credit;
  c.run("receiptDeliveryCredits=[{id:'credit-1',status:'capture',pages:[{dataUrl:'data:image/jpeg;base64,AA==',orientationConfirmed:true}]}]");
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'error');
  assert.equal(c.run('deliveryCreditReady()'), false); assert.equal(uploads(c), 1);
  assert.equal(c.run('receiptNoteTotal'), 93.8);
});

test('legacy amount-only credits retain their existing payment and closure behavior', () => {
  const { c } = setup(); const p = finish(c);
  p.shortCreditNotes = [{ amount: 43.8, at: 1 }]; const di = discrepancy(c, p);
  assert.equal(di.shortVal, 0); assert.equal(di.open, false); assert.equal(di.deliveryCreditMismatch, false);
  assert.equal(c.run('receiptPayableBaseEx({...pendingFixture,items:pendingFixture.lines,noteTotalInc:93.8})'), 50);
});

test('camera action, image rotation and quick confirmation read only the credit and preserve invoice state', async () => {
  const { c, data } = setup(); let openedCamera = '';
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => { openedCamera = id; }; return n; };
  const before = c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal,receiptNoteUnits])');
  await c.click('delivery-credit-add');
  const id = c.run('receiptDeliveryCredits[0].id'); assert.equal(openedCamera, 'creditCam_' + id);
  c.context.newCreditId = id;
  c.run(`aiCompressInvoiceImage=async file=>({name:file.name,dataUrl:'data:image/jpeg;base64,AA==',baseDataUrl:'data:image/jpeg;base64,AA==',orientationConfirmed:false});
    aiRenderInvoiceRotation=async()=>({dataUrl:'data:image/jpeg;base64,AQ==',bytes:1});`);
  await c.run("deliveryCreditAddFiles(newCreditId,[{name:'camera.jpg'}])");
  assert.match(c.node('aiOrientationLabel').textContent, /תעודת זיכוי מהנהג/);
  await c.run('aiRotateOrientationReview(1)');
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].rotation'), 90);
  data.paper = response(data);
  await c.run('aiConfirmOrientationReview()');
  assert.equal(uploads(c), 0, 'Allow more pages before a single explicit credit read');
  await c.click('delivery-credit-read', id);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal,receiptNoteUnits])'), before);
  assert.equal(uploads(c), 1);
  assert.deepEqual(JSON.parse(c.requests.find(r => r.url.endsWith('/scan')).body).documents[0].pages, ['data:image/jpeg;base64,AQ==']);
  await c.click('delivery-credit-page', id, { page: '0' });
  assert.equal(c.run('aiOrientationSession.reviewOnly'), true);
  await c.run('aiRotateOrientationReview(1)'); assert.equal(c.run('receiptDeliveryCredits[0].pages[0].rotation'), 90);
});

test('cancelling a credit photo cannot delete an invoice page or its verified scan', () => {
  const { c } = setup(); const before = c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal])');
  c.run("receiptDeliveryCredits=[{id:'credit-1',status:'capture',pages:[{dataUrl:'data:image/jpeg;base64,AA==',orientationConfirmed:false}]}];deliveryCreditOpenPage('credit-1',0);aiCancelOrientationReview()");
  assert.equal(c.run('receiptDeliveryCredits[0].pages.length'), 0);
  assert.equal(c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal])'), before);
  assert.equal(uploads(c), 0);
});

test('a failed receipt save retains the confirmed credit for retry', async () => {
  const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  assert.ok(finish(c)); const before = json(c, 'deliveryCreditNotes()');
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;};runCloudTask=async()=>false');
  await c.run('confirmReceipt()');
  assert.deepEqual(json(c, 'deliveryCreditNotes()'), before);
  const reload = runtime('yotvata', { data, storage: c.storage });
  assert.deepEqual(json(reload, 'deliveryCreditNotes()'), before); assert.equal(uploads(reload), 0);
});

test('credit approval changed after the summary requires a new summary before persistence', async () => {
  const { c, data } = setup(); await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  assert.ok(finish(c));
  c.run('receiptDeliveryCredits[0].confirmedAt++');
  await c.run('confirmReceipt()');
  assert.equal(c.writes.length, 0); assert.equal(c.run('pendingReceipt'), null);
  assert.match(c.toasts.at(-1), /מאז הסיכום/);
});

test('the shared draft carries credit approval to another device and final save consumes it atomically', async () => {
  const { c, data } = setup(); const cloud = fakeCloud();
  c.context.doc = (_db, ...path) => path.join('/');
  c.context.runTransaction = (_db, fn) => cloud.transaction(fn, c.context);
  c.context.onSnapshot = (ref, opts, listener) => cloud.subscribe(ref, listener, c.context);
  c.run('startReceiptDraftListener()'); await cloud.tick();
  await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  assert.equal(await c.run('flushReceiptDraftToCloud()'), true); await cloud.tick();
  const other = runtime('yotvata', { data, cloud }); await cloud.tick();
  assert.deepEqual(json(other, 'deliveryCreditNotes()'), json(c, 'deliveryCreditNotes()'));
  assert.equal(other.run('deliveryCreditReady()'), true); assert.equal(uploads(other), 0);
  c.run('runCloudTask=async(label,task)=>{testWrites.push(structuredClone(task));try{await executeCloudTask(task);return true}catch(e){testToasts.push(e.message);return false}}');
  assert.ok(finish(c)); await c.run('confirmReceipt()');
  assert.equal(c.writes.filter(w => w.path?.includes('receipts')).length, 1);
  assert.equal(c.writes.find(w => w.path?.includes('receipts')).data.shortCreditNotes.length, 1);
  assert.ok(c.writes.find(w => w.path?.includes('receipts')).receiptDraftGuard);
  await cloud.tick();
  assert.equal(other.run('receiptDeliveryCredits.length'), 0);
  assert.equal([...cloud.documents.entries()].find(([k]) => k.endsWith('/drafts/receipt'))[1].active, false);
  const saved = [...cloud.documents.entries()].filter(([k]) => k.includes('/receipts/'));
  assert.equal(saved.length, 1); assert.equal(saved[0][1].shortCreditNotes.length, 1);
});

test('credited products are excluded from future goods offsets while another shortage remains open', async () => {
  const { c, data } = setup(); c.run('receiptList[0].qty=1');
  await readCredit(c, data); c.run("deliveryCreditConfirm('credit-1')");
  const p = finish(c); c.context.offsetFixture = { ...p, items: p.lines };
  assert.deepEqual(json(c, 'receiptOffsets(offsetFixture)').map(x => [x.productId,x.d]), [['milk',9]]);
  c.run("offsetFixture.id='saved-credit';offsetFixture.noteTotalInc=93.8;receipts=[offsetFixture];openShortGoodsConfirm('saved-credit')");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(json(c, 'receipts[0].shortGoodsNotes').map(x => [x.productId,x.qty]), [['milk',9]]);
  assert.equal(c.run('receiptDiscrepancyInfo(receipts[0]).shortFullyCredited'), true);
  assert.equal(c.run('receiptPayableBaseEx(receipts[0])'), 50);
});
