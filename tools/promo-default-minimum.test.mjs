import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, fixture} from './receipt-scan-harness.mjs';

const json = (c, expr) => JSON.parse(c.run('JSON.stringify(' + expr + ')'));
const audit = c => json(c, 'receiptPriceAudit().rows[0]');
function setup(minimum = {minQty: 1, minUnit: 'carton', cartonSize: 0}) {
  const data = fixture('yotvata'), doc = data.paper.scan.documents[0], row = doc.rows[0];
  data.products[0].boxSize = 12;
  data.items[0].qty = 1;
  Object.assign(row, {quantity: 1, unitPriceExVat: 5, grossLineTotalExVat: 5, lineDiscountExVat: 1, lineTotalExVat: 4});
  Object.assign(doc, {subtotalExVat: 4, printedUnits: 1, itemsSectionTotalExVat: 4});
  data.promos = [{id: 'p', name: 'מבצע בדיקה', pct: 20, productIds: ['milk'], start: '2026-09-01', end: '2026-09-30', type: 'receipt', ...minimum}];
  doc.__pricePaper = structuredClone(doc); doc.__priceSourceId = 'default-minimum-fixture';
  const c = runtime('yotvata', {data});
  c.context.savedMinimumScan = {...data.paper, docInputs: [{amount: 4, units: 1, pageCount: 1}]};
  c.run("receiptOpened=true;receiptDupConfirmed=true;restoreDraftScan(savedMinimumScan);receiptPaperScanState='ok';receiptDocDate='2026-09-20';receiptNotes=[{amount:4,units:1}];recomputeNoteTotal();receiptList=structuredClone(testData.items);saveReceiptDraft();renderReceiving()");
  return {c, data};
}

test('an absent minimum applies the discount from one unit even when carton metadata or product box size exists', () => {
  for (const minQty of [undefined, null, '', 0]) for (const cartonSize of [null, 0, 12]) {
    const {c} = setup({minQty, minUnit: 'carton', cartonSize});
    assert.equal(audit(c).result, 'match');
    assert.equal(audit(c).promo.minUnits, 1);
    assert.equal(c.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
    assert.equal(c.run('promoMinUnitsP(promos[0])'), 1);
    assert.equal(c.run('promoTriggered(promos[0],receiptDocDate)'), true);
    assert.equal(c.requests.length, 0);
  }
});

test('the legacy default one-carton record without a size has no minimum and survives draft restoration', () => {
  const {c, data} = setup();
  const paper = json(c, 'aiScanResponse.scan.documents[0].__pricePaper');
  assert.equal(audit(c).result, 'match');
  assert.doesNotMatch(c.run('receiptPriceAuditHtml()'), /price-complete-carton|חסר מספר יחידות בארגז/);
  const restored = runtime('yotvata', {data, storage: c.storage});
  assert.equal(audit(restored).result, 'match');
  assert.equal(restored.run('priceAuditPendingRows(receiptPriceAudit()).length'), 0);
  assert.deepEqual(json(restored, 'aiScanResponse.scan.documents[0].__pricePaper'), paper);
  assert.equal(c.requests.length + restored.requests.length, 0);
  assert.deepEqual(json(c, 'promos[0]'), data.promos[0]);
});

test('explicit unit and complete carton thresholds still determine whether the discount is due', () => {
  for (const minimum of [{minQty: 5, minUnit: 'unit'}, {minQty: 1, minUnit: 'carton', cartonSize: 12}, {minQty: 2, minUnit: 'carton', cartonSize: 6}]) {
    const {c} = setup(minimum);
    assert.equal(audit(c).promo, null);
    assert.equal(audit(c).expectedOptions[0].price, 5);
    assert.equal(c.run('promoTriggered(promos[0],receiptDocDate)'), false);
  }
});

test('a declared multi-carton threshold with unknown conversion still offers completion', () => {
  const {c} = setup({minQty: 2, minUnit: 'carton', cartonSize: null});
  assert.equal(audit(c).capability, 'partial');
  assert.match(c.run('receiptPriceAuditHtml()'), /price-complete-carton/);
});

function edit(c, qty, size) {
  c.run("promoEdit={id:'p',productIds:['milk']};promoType='receipt';promoUnitMode='carton'");
  for (const [id, value] of Object.entries({promoName: 'מבצע בדיקה', promoPct: '20', promoStart: '2026-09-01', promoEnd: '2026-09-30', promoMin: qty, promoCarton: size})) c.node(id).value = value;
}

test('saving an empty minimum normalizes it to one unit without demanding carton information', async () => {
  for (const [qty, size] of [['', ''], ['', '12'], ['1', '']]) {
    const {c} = setup(); edit(c, qty, size);
    c.run('updatePromoHint()');
    assert.match(c.node('promoUnitsHint').textContent, /מיחידה אחת/);
    await c.click('pe-save');
    const saved = c.writes.find(w => w.path?.includes('promos'))?.data;
    assert.ok(saved);
    assert.equal(saved.minQty, 1); assert.equal(saved.minUnit, 'unit'); assert.equal(saved.cartonSize, null);
  }
});

test('editing an explicit one-carton minimum displays it and retains it when saved', async () => {
  const {c} = setup({minQty: 1, minUnit: 'carton', cartonSize: 12});
  c.run("openPromoEdit('p')");
  assert.match(c.node('app').innerHTML, /id="promoMin"[^>]*value="1"/);
  edit(c, '1', '12'); c.run('updatePromoHint()');
  assert.match(c.node('promoUnitsHint').textContent, /12 יחידות/);
  await c.click('pe-save');
  const saved = c.writes.find(w => w.path?.includes('promos'))?.data;
  assert.equal(saved.minQty, 1); assert.equal(saved.minUnit, 'carton'); assert.equal(saved.cartonSize, 12);
});

test('final receiving uses the one-unit discount while preserving paper totals', async () => {
  const {c} = setup();
  c.run('logAction=()=>{};aiScanFromDraft=true;showConfirm=(title,text,label,fn)=>fn();finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  assert.equal(c.run('pendingReceipt.ex'), 4);
  c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.equal(saved.totalExVat, 4);
  assert.equal(saved.priceAudit.rows[0].result, 'match');
  assert.equal(saved.priceAudit.rows[0].promo.minUnits, 1);
});
