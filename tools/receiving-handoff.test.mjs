// Receiving is local until the explicit final save; order handoff remains supported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {phone,createCloud,root,path,settle,json} from './handoff-harness.mjs';
const alive=[];const make=(c,o)=>{const p=phone(c,o);alive.push(p);return p;};
test.afterEach(()=>{while(alive.length)alive.pop().stop();});
const id=p=>p.run('receiptDraftId');
const saved=p=>p.run('finishDraft("receiving",receiptDraftId,{items:receiptList})');

test('counting, editing, backgrounding, and network reconnect never create receiving cloud drafts',async()=>{
 const c=createCloud(),a=make(c);a.receipt();a.change("setReceiptQty('milk','4');openReconcile();reconcileSetPriceLive('milk','6');saveReceiptDraft()");
 a.fire('visibilitychange');a.fire('pagehide');a.online(false);a.online(true);await settle();
 assert.deepEqual(json(a,'Object.keys(draftHandoffs)'),['order']);assert.equal(c.transactions,0);assert.deepEqual(c.paths('drafts/'),[]);
 assert.match(a.node('draftHandoffBanner').innerHTML,/בטלפון הזה בלבד/);assert.doesNotMatch(a.node('draftHandoffBanner').innerHTML,/מגובה בענן|המשך אותה כאן/);
});
test('two phones retain different local counts and do not offer a receiving transfer',async()=>{
 const c=createCloud(),a=make(c),b=make(c);a.receipt(9);b.receipt(17);await settle();
 assert.notEqual(id(a),id(b));assert.equal(a.run('receiptList[0].qty'),9);assert.equal(b.run('receiptList[0].qty'),17);assert.deepEqual(c.paths('drafts/'),[]);
});
test('reload keeps counts, corrections and parsed paper without another OCR',async()=>{
 const c=createCloud(),a=make(c);await a.scan();a.change("openReconcile();reconcileSetRecvLive('milk','4');reconcileSetNoteLive('milk','12');reconcileSetPriceLive('milk','6.321');addReceiptQtyToTop(products[1],3);saveReceiptDraft()");
 const b=make(c,{storage:new Map(a.storage)});b.run('openReconcile()');
 assert.equal(b.run("reconcileData.find(l=>l.productId==='milk').received"),4);assert.equal(b.run("reconcileData.find(l=>l.productId==='milk').noteQty"),12);
 assert.equal(b.run("reconcileData.find(l=>l.productId==='milk').price"),6.321);assert.equal(b.run("reconcileData.find(l=>l.productId==='coffee').received"),3);
 assert.equal(b.requests.length,0);assert.equal(b.run('aiScanResponse.scan.documents.length'),1);
});
test('explicit final save writes one receipt and action log without creating or mutating a handoff',async()=>{
 const c=createCloud(),a=make(c);a.receipt();const sid=id(a);assert.equal(await saved(a),true);assert.equal(await a.run("retryLocalReceiptFinal()"),true);
 assert.equal(c.paths('/receipts/').length,1);assert.equal(c.paths('/actionLog/').length,1);assert.equal(c.get(root+'receipts/'+sid).items[0].qty,9);assert.deepEqual(c.paths('/drafts/'),[]);
});
test('offline final keeps local counts and retry after reconnect succeeds',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const raw=a.storage.get('yt_receipt_draft');a.online(false);
 assert.equal(await saved(a),false);assert.equal(a.storage.get('yt_receipt_draft'),raw);assert.equal(c.paths('/receipts/').length,0);
 a.online(true);assert.equal(await saved(a),true);assert.equal(c.get(root+'receipts/'+id(a)).items[0].qty,17);
});
test('a lost reply resolves only the exact final receipt and does not duplicate it',async()=>{
 const c=createCloud(),a=make(c);a.receipt();c.loseReplyAfterCommit=true;assert.equal(await saved(a),true);assert.equal(await a.run("retryLocalReceiptFinal()"),true);
 assert.equal(c.paths('/receipts/').length,1);assert.equal(c.paths('/actionLog/').length,1);
});
test('a saved copy on another phone never replaces or clears this phone unique counts',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const sid=id(a);c.put(root+'receipts/'+sid,{items:[{productId:'milk',qty:9}]});await settle();
 assert.equal(a.run('receiptList[0].qty'),17);assert.equal(await saved(a),false);assert.equal(a.run('receiptList[0].qty'),17);assert.equal(c.get(root+'receipts/'+sid).items[0].qty,9);
});
test('changed attachment record and changed product price reject the whole atomic save',async()=>{
 const c=createCloud(),a=make(c);a.receipt();const record={id:'old',timestamp:1,noDoc:true,items:[{productId:'milk',qty:9,unitPrice:5}]};
 c.put(root+'receipts/old',{...record,newer:true});a.context.record=record;a.run('receiptAttachTarget={id:"old",sessionId:"edit_old",expectedReceipt:record}');
 assert.equal(await a.run('finishDraft("receiving","old",{items:receiptList})'),false);assert.equal(c.get(root+'receipts/old').newer,true);
 a.run('receiptAttachTarget=null;handoffFinishPlans.receiving={prices:[{id:"milk",expected:5,price:6}]}');c.put(root+'products/milk',{id:'milk',price:7});
 assert.equal(await saved(a),false);assert.equal(c.paths('/receipts/').length,1);assert.equal(c.get(root+'products/milk').price,7);assert.equal(c.paths('/actionLog/').length,0);
});
test('old moved/canceled ownership cannot be revived; the local copy remains available',async()=>{
 for(const state of ['open','canceled']){const c=createCloud(),a=make(c);a.receipt(17);const sid=id(a);c.put(path('receiving',sid),{state,deviceId:'other',gen:2});
 assert.equal(await saved(a),false);assert.equal(a.run('receiptList[0].qty'),17);assert.equal(c.paths('/receipts/').length,0);assert.equal(c.get(path('receiving',sid)).state,state);}
});
test('legacy sides and queued final writes remain available even if same receipt ID is already saved',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const payload=a.storage.get('yt_receipt_draft'),sid=id(a);
 a.storage.set('yt_handoff_receiving_side',JSON.stringify([{sessionId:sid,payload,savedAt:1}]));
 a.context.oldTasks=[{id:'old-task',actionName:'save receipt before clearing draft',task:{op:'set',path:(root+'receipts/'+sid).split('/'),data:{items:[{productId:'milk',qty:4,noteQty:12,unitPrice:6}],noDoc:true}}}];
 c.put(root+'receipts/'+sid,{items:[{productId:'milk',qty:9}]});a.run('cloudFailedWrites=oldTasks;quarantineLegacyDraftWrites()');await a.run('recoverLegacyDraftWrites()');
 assert.equal(a.run('localReceiptCopies().length'),2);assert.equal(JSON.parse(a.storage.get('yt_handoff_legacy_writes')).length,1);
 assert.equal(await a.run('openLocalReceiptCopy("legacy:0")'),false);assert.equal(a.run('receiptList[0].qty'),17);assert.match(a.node('draftHandoffBanner').innerHTML,/לעיון בלבד/);
 const full=await a.run('localReceiptCopyPayload(localReceiptCopies().find(x=>x.key==="legacy:0"))');assert.equal(full.legacyFinalReceipt.items[0].noteQty,12);assert.equal(JSON.parse(a.storage.get('yt_handoff_receiving_side')).length,1);
 assert.equal(c.get(root+'receipts/'+sid).items[0].qty,9);assert.equal(a.requests.length,0);
});
test('quota failure cannot replace the active draft or submit final save',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const payload=a.storage.get('yt_receipt_draft');a.storage.set('yt_handoff_receiving_side',JSON.stringify([{payload:payload.replace('"qty":17','"qty":4')}]))
 a.context.localStorage.setItem=()=>{throw Error('quota')};assert.equal(await a.run('openLocalReceiptCopy("yt_handoff_receiving_side:0")'),false);
 assert.equal(a.run('receiptList[0].qty'),17);assert.equal(await saved(a),false);assert.equal(c.transactions,0);
});
test('cancel closes stale quantity window and scan callbacks without writing a receiving tombstone',async()=>{
 const c=createCloud(),a=make(c);a.receipt();a.run("promptQty(products[0],'receipt');cancelLocalDraft('receiving');yotvataResetPhotoReceipt();receiptList=[];receiptDraftId=null;commitQty(false);handleReceivingScan(products[0].barcode)");
 assert.equal(a.run('receiptList.length'),0);assert.equal(a.run('qtyProduct'),null);assert.deepEqual(c.paths('drafts/'),[]);
});
test('order synchronization remains enabled alongside local receiving',async()=>{
 const c=createCloud(),a=make(c);a.receipt();a.change("orderState={milk:{amount:'5',unit:'unit'}};saveDraft()");await a.sync('order');
 assert.equal(c.paths('handoff_yotvata_order_').length,1);assert.equal(c.paths('handoff_yotvata_receiving_').length,0);
});
test('unknown final result locks edits and explicit retry after reload saves the original snapshot',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const sid=id(a);c.reject='unavailable';assert.equal(await saved(a),false);
 assert.equal(a.run('localReceiptPending()'),true);a.run("setReceiptQty('milk','4')");assert.equal(a.run('receiptList[0].qty'),17);
 const b=make(c,{storage:new Map(a.storage)});assert.equal(b.run('localReceiptPending()'),true);c.reject=null;
 assert.equal(await b.run('retryLocalReceiptFinal()'),true,b.toasts.join('\n'));assert.equal(b.run('receiptList.length'),0);
 assert.equal(c.get(root+'receipts/'+sid).items[0].qty,17);assert.equal(c.paths('/receipts/').length,1);
});
test('pending archive preserves both full draft and immutable submission and quota failure cannot clear it',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);c.reject='unavailable';await saved(a);const sid=id(a),journal=a.storage.get('yt_receiving_final_v1');
 a.run('showConfirm=(title,text,label,fn)=>fn();archivePendingLocalReceipt()');assert.equal(id(a),null);
 assert.equal(a.storage.get('yt_receiving_final_v1'),journal);assert.equal(JSON.parse(JSON.parse(a.storage.get('yt_local_receiving_archive'))[0].payload).items[0].qty,17);
 assert.equal(await a.run('openLocalReceiptCopy("yt_local_receiving_archive:0")'),true);assert.equal(id(a),sid);assert.equal(a.run('localReceiptPending()'),true);
 a.context.localStorage.setItem=()=>{throw Error('quota')};a.run('archivePendingLocalReceipt()');assert.equal(id(a),sid);assert.equal(a.run('receiptList[0].qty'),17);
});
test('old native barcode result is ignored after a different receiving scanner starts',async()=>{
 const c=createCloud(),a=make(c);a.receipt();let release;a.context.barcodeWait=new Promise(r=>release=r);a.node('scanVideo').readyState=2;
 a.run('scanStream={};barcodeDetector={detect:()=>barcodeWait};scanPurpose="receiving";scanReceiptEpoch=receiptLocalEpoch;scanTick();closeReceivingEditors();receiptDraftId="next";scanStream={};scanPurpose="receiving";scanReceiptEpoch=receiptLocalEpoch');
 release([{rawValue:a.run('products[1].barcode')}]);await settle();assert.equal(a.run('qtyProduct'),null);assert.equal(id(a),'next');
});
test('old cancellation dialog cannot discard an explicitly opened side draft',async()=>{
 const c=createCloud(),a=make(c);a.receipt(17);const payload=JSON.parse(a.storage.get('yt_receipt_draft'));payload.draftId='side';payload.items[0].qty=23;
 a.storage.set('yt_handoff_receiving_side',JSON.stringify([{payload:JSON.stringify(payload)}]));await a.click('rc-cancel');
 assert.equal(a.run('typeof confirmCb'),'function');assert.equal(await a.run('openLocalReceiptCopy("yt_handoff_receiving_side:0")'),true);
 a.events.get('confirmOk:click')();assert.equal(a.run('receiptList[0].qty'),23);assert.equal(id(a),'side');
});
test('quota failure quarantining legacy receiving writes still blocks every retry including nested batches',async()=>{
 const c=createCloud(),a=make(c);a.receipt();a.context.oldTasks=[
  {id:'draft',actionName:'old autosave',task:{op:'set',path:(root+'drafts/receipt').split('/'),data:{items:[]}}},
  {id:'batch',actionName:'old batch',task:{op:'batch',writes:[{op:'set',path:(root+'receipts/legacy').split('/'),data:{items:[]}}]}}
 ];let writes=0;a.context.executeCloudTask=async()=>{writes++};a.context.localStorage.setItem=()=>{throw Error('quota')};
 a.run('cloudFailedWrites=oldTasks');await a.run('retryCloudFailedWrites()');assert.equal(writes,0);assert.equal(a.run('cloudFailedWrites.length'),2);
 assert.equal(a.run('legacyReceivingWrite({actionName:"restore from trash",task:oldTasks[1].task})'),false);
});
