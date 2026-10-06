import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, supplier} from './receipt-scan-harness.mjs';
const copy = x => JSON.parse(JSON.stringify(x));
function setup() {
  const a = runtime(supplier);
  a.run(`receiptOpened = true; receiptEntryMode = 'manual'; receiptList = structuredClone(testData.items); saveReceiptDraft(); openReconcile();`);
  return a;
}
function reload(a) {
  const b = runtime(supplier, {storage:new Map(a.storage)});
  b.run('openReconcile()');
  assert.equal(b.requests.length, 0, 'restoring never calls AI');
  return b;
}
test('received quantity 9 → 4 survives an immediate reload and reopening comparison', () => {
  const a = setup();
  a.run(`reconcileSetRecvLive('milk', '4')`);
  const b = reload(a);
  assert.equal(b.run('reconcileData[0].received'), 4);
  b.run('openReconcile()');
  assert.equal(b.run('reconcileData[0].received'), 4);
});
test('paper quantity, exact price and added missing product survive together', () => {
  const a = setup();
  a.run(`reconcileSetNoteLive('milk', '12'); reconcileSetPriceLive('milk', '6.321'); reconcileAddItem('coffee'); reconcileSetNoteLive('coffee', '3');`);
  const b = reload(a);
  assert.equal(b.run('reconcileData[0].noteQty'), 12);
  assert.equal(b.run('reconcileData[0].price'), 6.321);
  assert.equal(b.run(`reconcileData.find(l => l.productId === 'coffee').noteQty`),3);
});
test('increment buttons persist and restored corrections reach the payment summary', () => {
  const a = setup();
  a.run(`reconcileStepRecv('milk', -5); reconcileStepNote('milk', 3); reconcileSetPriceLive('milk','6');`);
  const b = reload(a);
  b.run('db=null;saveReconciledReceipt({skipChecked:true,skipGap:true})');
  const line = copy(b.run('pendingReceipt.lines[0]'));
  assert.equal(line.qty,4); assert.equal(line.noteQty,12); assert.equal(line.unitPrice,6);
});
test('inline price input without a repaint goes through the draft saver', () => {
  const a = setup();
  const target = {id:'',value:'7.2',dataset:{id:'milk'},getAttribute:()=> 'rc-qty-price'};
  a.events.get('app:input')({target});
  assert.equal(reload(a).run('reconcileData[0].price'), 7.2);
});
test('unfinished barcode paper input and reconciliation decisions survive reload', () => {
  const a = setup();
  a.run(`noteCheckRows = [{d:'',pid:'milk',st:'ok'}]; reconcileSupplierDiscount=2.5; reconcilePaperEntered=true;`);
  const target = {id:'',value:'12',dataset:{i:'0'},getAttribute:()=> 'nc-qty'};
  a.events.get('app:input')({target});
  const b = reload(a);
  assert.equal(b.run('noteCheckRows[0].q'),12);
  assert.equal(b.run('reconcileSupplierDiscount'),2.5);
  assert.equal(b.run('reconcilePaperEntered'),true);
});
test('back to counting preserves corrections; a later count changes only its received quantity', () => {
  const a = setup();
  a.run(`reconcileSetRecvLive('milk','4'); reconcileSetPriceLive('milk','6'); reconcileSetNoteLive('milk','12'); reconcileData=null; currentView='receiving'; saveReceiptDraft();`);
  assert.equal(reload(a).run('reconcileData[0].received'),4);
  a.run(`receiptList[0].qty=8; saveReceiptDraft()`);
  const b=reload(a);
  assert.equal(b.run('reconcileData[0].received'),8);
  assert.equal(b.run('reconcileData[0].noteQty'),12);
  assert.equal(b.run('reconcileData[0].price'),6);
});
test('new session and legacy drafts do not inherit the previous comparison', () => {
  const a=setup(); a.run(`reconcileSetRecvLive('milk','4'); receiptDraftId='new-test-session'; reconcileData=null; saveReceiptDraft()`);
  assert.equal(reload(a).run('reconcileData[0].received'),9);
  const stored=JSON.parse(a.storage.get(a.run('RECEIPT_DRAFT_KEY'))); delete stored.reconciliation;
  a.storage.set(a.run('RECEIPT_DRAFT_KEY'),JSON.stringify(stored));
  assert.equal(reload(a).run('reconcileData[0].received'),9);
});
test('storage failure is visible and does not erase the in-memory corrections', () => {
  const a=setup();
  a.run(`localStorage.setItem=()=>{throw Error('quota')}; reconcileSetRecvLive('milk','4')`);
  assert.equal(a.run('reconcileData[0].received'),4);
  assert.ok(a.run('receiptStorageWarning'));
});
