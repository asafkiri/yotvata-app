import {attachReturns} from './returns-events-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {phone,createCloud,root,path,settle,json} from './handoff-harness.mjs';
const alive=[];const make=(c,o)=>{const p=phone(c,o);alive.push(p);return p;};
test.afterEach(()=>{while(alive.length)alive.pop().stop();});
const id=p=>p.run('receiptDraftId');
async function begin(c=createCloud()){const a=make(c);a.receipt();await a.sync();return a;}
async function pair(){const cloud=createCloud(),a=await begin(cloud),b=make(cloud);await settle();assert.equal((await b.take(id(a))).ok,true);return {cloud,a,b};}

test('local edits never wait for a stuck cloud; one backup in flight, with no old draft writes',async()=>{
 const c=createCloud(),a=make(c);a.receipt();c.hangCommits=true;const waiting=a.sync();await settle();
 a.change("setReceiptQty('milk','4')");assert.equal(JSON.parse(a.storage.get('yt_receipt_draft')).items[0].qty,4);
 a.run("draftHandoffs.receiving.flush();draftHandoffs.receiving.flush()");await settle();assert.equal(c.transactions,1);
 await waiting;await new Promise(r=>setTimeout(r,300));assert.equal(a.state().readOnly,false);assert.equal(a.state().status,'failed');assert.deepEqual(c.paths('drafts/receipt'),[]);
});
test('backup includes stable identity, paper source and corrections, never images; unchanged content is not rewritten',async()=>{
 const c=createCloud(),a=make(c);await a.scan();a.change("openReconcile();reconcileSetRecvLive('milk','4');reconcileSetPriceLive('milk','6');reconcileSetNoteLive('milk','12')");await a.sync();
 const d=c.get(path('receiving',id(a))),p=JSON.parse(d.payload);assert.equal(d.gen,1);assert.equal(d.recordId,id(a));assert.equal(d.summary.lines,1);assert.equal(d.summary.units,4);
 assert.equal(p.reconciliation.rows[0].received,4);assert.equal(p.reconciliation.rows[0].price,6);assert.equal(p.reconciliation.rows[0].noteQty,12);assert.ok(p.aiScan);
 assert.doesNotMatch(d.payload,/data:image|blob:|"pages"/);const before=c.server.get(path('receiving',id(a))).version;await a.sync();assert.equal(c.server.get(path('receiving',id(a))).version,before);
 const b=make(c);await settle();assert.equal((await b.take(id(a))).ok,true);b.run('openReconcile()');assert.equal(b.run('reconcileData[0].received'),4);assert.equal(b.run('reconcileData[0].price'),6);assert.equal(b.requests.length,0);
});
test('oversized Hebrew payload stays local and offers no take button',async()=>{
 const c=createCloud(),a=make(c);a.receipt();a.change("receiptList[0].name='א'.repeat(500000);saveReceiptDraft()");await a.sync();assert.equal(c.get(path('receiving',id(a))).tooBig,true);
 const b=make(c);await settle();assert.equal(b.state().offers[0].button,false);assert.equal(a.run('receiptList[0].name.length'),500000);
});
test('take uses the latest transaction payload; offline take leaves the phone untouched',async()=>{
 const c=createCloud(),a=await begin(c),b=make(c);await settle();a.change("setReceiptQty('milk','4')");await a.sync();
 b.online(false);assert.equal((await b.take(id(a))).reason,'offline');assert.equal(id(b),null);b.online(true);await settle();assert.equal((await b.take(id(a))).ok,true);assert.equal(b.run('receiptList[0].qty'),4);assert.equal(b.requests.length,0);
});
test('former owner cannot edit, scan, cancel or finalize; take-back preserves the local version',async()=>{
 const {cloud,a,b}=await pair();assert.equal(a.state().away.away,'moved');const before=json(a,'receiptList');
 a.run("setReceiptQty('milk','2');reconcileSetRecvLive('milk','1');cancelReceiptAttach();yotvataStartPaperScan();aiRunAnalyzer();finishReceipt()");assert.deepEqual(json(a,'receiptList'),before);assert.equal(a.requests.length,0);
 assert.equal(await a.run("finishDraft('receiving',receiptDraftId,{test:true})"),false);assert.equal(a.run("cancelLocalDraft('receiving')"),false);
 a.online(false); // emulate an edit made before the handoff notice reached this phone, never by bypassing the UI in real use
 a.run('receiptList[0].qty=8');b.change("setReceiptQty('milk','4')");await b.sync();a.online(true);await settle();assert.equal((await a.take(id(a))).ok,true);assert.equal(a.run('receiptList[0].qty'),4);
 assert.equal(a.state().side.length,1);assert.equal(JSON.parse(a.storage.get('yt_handoff_receiving_side'))[0].reason,'same');assert.equal(cloud.get(path('receiving',id(a))).gen,3);
});
test('finish writes exactly one receipt and closes handoff; other phone clears only its copy',async()=>{
 const {cloud,a,b}=await pair();const sid=id(b);b.run('openReconcile();saveReconciledReceipt({skipChecked:true,skipGap:true})');await b.run('confirmReceipt()');await settle();
 assert.equal(cloud.paths('/receipts/').length,1);assert.equal(cloud.get(path('receiving',sid)).state,'saved');assert.equal(cloud.paths('/actionLog/').length,1);
 assert.equal(id(b),null);assert.equal(a.state().away.away,'saved');assert.equal(a.run('draftHandoffs.receiving.clear().ok'),true);assert.equal(id(a),null);assert.equal(cloud.paths('/receipts/').length,1);
});
test('two takers and finish versus take are atomic',async()=>{
 const c=createCloud(),a=await begin(c),b=make(c),d=make(c);await settle();const sid=id(a);let release;c.commitGate=new Promise(r=>release=r);
 const r1=b.take(sid),r2=d.take(sid);await settle();release();const results=await Promise.all([r1,r2]);assert.equal(results.filter(r=>r.ok).length,1);c.commitGate=null;
 const owner=results[0].ok?b:d,other=owner===b?d:b;let release2;c.commitGate=new Promise(r=>release2=r);
 const finish=owner.run("finishDraft('receiving',receiptDraftId,{items:[]})"),take=other.take(sid);await settle();release2();const [saved,taken]=await Promise.all([finish,take]);assert.equal(Number(saved)+Number(taken.ok),1);
});
test('lost finish reply resolves from server without a duplicate receipt',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a);c.loseReplyAfterCommit=true;
 await a.run("finishDraft('receiving',receiptDraftId,{items:receiptList})");await settle();assert.equal(c.paths('/receipts/').length,1);assert.equal(c.get(path('receiving',sid)).state,'saved');assert.equal(id(a),null);
});
test('offline finish cannot overwrite a receipt after another phone takes and saves',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a);a.online(false);assert.equal(await a.run("finishDraft('receiving',receiptDraftId,{items:receiptList})"),false);
 const b=make(c);await settle();await b.take(sid);b.change("setReceiptQty('milk','4')");assert.equal(await b.run("finishDraft('receiving',receiptDraftId,{items:receiptList})"),true);
 a.online(true);await settle();await a.sync();assert.equal(c.get(root+'receipts/'+sid).items[0].qty,4);assert.equal(a.state().away.away,'saved');
});
test('cached ownership cannot undo a server transfer after restart',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a),storage=new Map(a.storage),cache=new Map(a.client.cache);a.stop();const b=make(c);await settle();await b.take(sid);
 const restarted=make(c,{storage,cache,online:false});await settle();assert.equal(c.get(path('receiving',sid)).gen,2);restarted.online(true);await settle();assert.equal(restarted.state().away.away,'moved');assert.equal(restarted.run("canEditDraft('receiving',true)"),false);
});
test('offline cancel retries; a moved copy cannot cancel the current owner',async()=>{
 const {cloud,a,b}=await pair(),sid=id(b);b.online(false);assert.equal(b.run("cancelLocalDraft('receiving')"),true);b.run("handoffEmpty('receiving')");assert.equal(cloud.get(path('receiving',sid)).state,'open');
 b.online(true);await b.sync();await settle();assert.equal(cloud.get(path('receiving',sid)).state,'canceled');assert.equal(a.state().away.away,'canceled');
});
test('scan start immediately hides the take button and restore never uploads again',async()=>{
 const c=createCloud(),a=await begin(c),b=make(c);await settle();assert.equal(b.state().offers[0].button,true);
 a.run("aiScanBusy=true;handoffChanged('receiving')");await settle();assert.equal(c.get(path('receiving',id(a))).scanRunning,true);assert.equal(b.state().offers[0].button,false);assert.equal((await b.take(id(a))).reason,'scan-running');
 a.run("aiScanBusy=false;handoffChanged('receiving')");await settle();await a.sync();assert.equal((await b.take(id(a))).ok,true);assert.equal(b.requests.length,0);
});
test('another local draft is kept and reopened; full storage stops replacement',async()=>{
 const c=createCloud(),a=await begin(c),b=make(c);b.receipt(2);const local=id(b);await settle();assert.equal((await b.take(id(a))).ok,true);assert.equal(JSON.parse(b.storage.get('yt_handoff_receiving_side'))[0].sessionId,local);
 b.run("draftHandoffs.receiving.openSide("+JSON.stringify(local)+")");assert.equal(b.run('receiptList[0].qty'),2);
 b.context.localStorage.setItem=()=>{throw Error('quota')};assert.equal((await b.take(id(a))).reason,'storage');assert.equal(id(b),local);
});
test('legacy copies do not claim on start, render or automatic saves; first user edit owns',async()=>{
 const seed=make(createCloud(),{start:false});seed.receipt();const storage=new Map(seed.storage);const c=createCloud(),a=make(c,{storage:new Map(storage)}),b=make(c,{storage:new Map(storage)});await settle();await a.sync();await b.sync();assert.equal(c.paths('handoff_').length,0);
 a.run('saveReceiptDraft();renderReceiving()');await a.sync();assert.equal(c.paths('handoff_').length,0);a.change("setReceiptQty('milk','4')");await a.sync();assert.equal(b.state().away.away,'moved');assert.equal((await b.take(id(a))).ok,true);assert.equal(b.state().side.length,1);assert.deepEqual(c.paths('drafts/receipt'),[]);
});
test('legacy cancel is local and creates no tombstone',async()=>{
 const seed=make(createCloud(),{start:false});seed.receipt();const c=createCloud(),a=make(c,{storage:new Map(seed.storage)});a.run("cancelLocalDraft('receiving');handoffEmpty('receiving')");await a.sync();assert.equal(c.paths('handoff_').length,0);
});
test('edit sessions carry expected record, transfer and stop stale overwrites',async()=>{
 const c=createCloud(),a=make(c),record={id:'saved-test',timestamp:1,date:'2026-10-06',docDate:'2026-10-06',noDoc:true,items:[{productId:'milk',name:'בדיקה',qty:9,unitPrice:5}],totalExVat:45};c.put(root+'receipts/'+record.id,record);a.context.fixtureRecord=record;
 a.run('receipts=[fixtureRecord];reopenReceiptForDoc(fixtureRecord.id)');
 const sid=a.run("handoffDraft('receiving').sessionId");assert.match(sid,/^edit_/);a.change("setReceiptQty('milk','4')");await a.sync();const b=make(c);await settle();assert.equal((await b.take(sid)).ok,true);assert.equal(b.run('receiptAttachTarget.expectedReceipt.items[0].qty'),9);
 c.put(root+'receipts/'+record.id,{...record,newer:true});assert.equal(await b.run("finishDraft('receiving','saved-test',{items:[]})"),false);assert.equal(c.get(root+'receipts/'+record.id).newer,true);
});
test('receiving and order are isolated; shared returns and app orders stay live',async()=>{const c=createCloud(),a=await begin(c);const engine=await attachReturns(a);a.change("returnsList=[{productId:'milk',qty:3}];saveReturnsDraft();orderState={milk:{amount:'5',unit:'unit'}};saveDraft()");await a.sync('order');assert.equal(c.paths('handoff_yotvata_').length,2);assert.deepEqual(json(a,'Object.keys(draftHandoffs)').sort(),['order','receiving']);assert.equal(JSON.parse(a.storage.get('yt_returns_draft'))[0].qty,3);engine.stop();});
test('late commit after restart keeps the later correction visible in a side copy',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a);c.commitDelayMs=1100;
 assert.equal(await a.run("finishDraft('receiving',receiptDraftId,{items:receiptList})"),false);c.commitDelayMs=0;
 await new Promise(r=>setTimeout(r,550));assert.equal(a.state().readOnly,false);a.online(false);a.change("setReceiptQty('milk','4')");const storage=new Map(a.storage),cache=new Map(a.client.cache);a.stop();
 const b=make(c,{storage,cache,online:false});await new Promise(r=>setTimeout(r,400));b.online(true);await settle();
 assert.equal(b.state().away.away,'saved');assert.equal(c.get(root+'receipts/'+sid).items[0].qty,9);
 const side=JSON.parse(b.storage.get('yt_handoff_receiving_side'));assert.equal(side[0].reason,'late');assert.equal(JSON.parse(side[0].payload).items[0].qty,4);
 b.run('draftHandoffs.receiving.clear()');assert.equal(b.state().side.length,1);assert.equal(b.requests.length,0);
});
test('two consecutive edits use different sessions and both save on the original phone',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a);assert.equal(await a.run("finishDraft('receiving',handoffDraft('receiving').recordId,{timestamp:1,noDoc:true,items:receiptList})"),true);a.run("handoffEmpty('receiving')");
 let previous='';for(const qty of [4,2]){
  a.context.savedRecord={id:sid,...c.get(root+'receipts/'+sid)};a.run('receipts=[savedRecord];reopenReceiptForDoc(savedRecord.id)');const edit=a.run("handoffDraft('receiving').sessionId");assert.notEqual(edit,previous);previous=edit;
  a.change("setReceiptQty('milk','"+qty+"')");await a.sync();assert.equal(await a.run("finishDraft('receiving',handoffDraft('receiving').recordId,{timestamp:1,noDoc:true,items:receiptList})"),true);a.run("handoffEmpty('receiving')");assert.equal(c.get(root+'receipts/'+sid).items[0].qty,qty);
 }
 assert.equal(c.paths('/receipts/').length,1);assert.equal(c.paths('/actionLog/').length,3);
});
test('old blind queued saves are quarantined, restored with corrections, and never overwrite newer records',async()=>{
 const c=createCloud(),a=make(c);a.context.oldTasks=['missing','already'].map(id=>({id:'q_'+id,actionName:'save receipt before clearing draft',createdAt:1,task:{op:'set',path:(root+'receipts/'+id).split('/'),data:{items:[{productId:'milk',name:'בדיקה',qty:4,noteQty:12,unitPrice:6}],noDoc:true,noteParts:[]}}}));
 c.put(root+'receipts/already',{newer:true});a.run('cloudFailedWrites=oldTasks;quarantineLegacyDraftWrites()');assert.equal(a.run('cloudFailedWrites.length'),0);await a.run('recoverLegacyDraftWrites()');assert.equal(c.get(root+'receipts/already').newer,true);assert.equal(c.get(root+'receipts/missing'),null);
 assert.equal(a.state().side.length,1);assert.equal(a.run("draftHandoffs.receiving.openSide('missing').ok"),true);a.run('openReconcile()');assert.equal(a.run('reconcileData[0].received'),4);assert.equal(a.run('reconcileData[0].noteQty'),12);assert.equal(a.run('reconcileData[0].price'),6);assert.equal(a.requests.length,0);
});
test('offline cancellation cannot close the draft subsequently taken by another phone',async()=>{
 const c=createCloud(),a=await begin(c),sid=id(a);a.online(false);a.run("cancelLocalDraft('receiving');handoffEmpty('receiving')");const b=make(c);await settle();assert.equal((await b.take(sid)).ok,true);a.online(true);await a.sync();assert.equal(c.get(path('receiving',sid)).state,'open');assert.equal(c.get(path('receiving',sid)).deviceId,b.storage.get('yt_device_id'));
});

test('the former owner cannot add photos or trigger the old live camera, including an already open modal',async()=>{
 const {a}=await pair();const before=json(a,'aiScanDocuments');let prepared=0;a.context.aiCompressInvoiceImage=async()=>{prepared++;return {dataUrl:'synthetic'};};
 await a.run("aiAddInvoiceFiles(0,[{}]);aiOpenLiveCamera(0);aiLiveCamTakePhoto();aiRemoveInvoicePage(0,0);aiConfirmOrientationReview();aiCancelOrientationReview()");assert.equal(prepared,0);assert.deepEqual(json(a,'aiScanDocuments'),before);assert.equal(a.requests.length,0);
 let blocked=false;a.context.cameraEvent={type:'click',target:{closest:selector=>selector.includes('#aiLiveCamModal')?{}:null},preventDefault:()=>blocked=true,stopImmediatePropagation(){}};a.run('guardDraftEvent(cameraEvent)');assert.equal(blocked,true);
});

test('taking a draft records the successful session and generation in the action log',async()=>{const c=createCloud(),a=await begin(c),b=make(c),entries=[];b.context.logAction=(...entry)=>entries.push(entry);await settle();const sid=id(a);assert.equal((await b.take(sid)).ok,true);assert.equal(entries.length,1);assert.equal(entries[0][0],'draft-handoff');assert.equal(entries[0][3].sessionId,sid);assert.equal(entries[0][3].gen,2);});
