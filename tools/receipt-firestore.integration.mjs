// האפליקציה המלאה + SDK אמיתי + אמולטור מקומי בלבד. אין חיבור לנתוני החנות.
// RECEIPT_FIREBASE_TEST_DEPS=/path/with/node_modules FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node --test tools/receipt-firestore.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {phone,createCloud,root} from './handoff-harness.mjs';
const require=createRequire(path.join(process.env.RECEIPT_FIREBASE_TEST_DEPS||process.cwd(),'package.json'));
const {initializeApp,deleteApp}=require('firebase/app'),sdk=require('firebase/firestore');
const emulator=process.env.FIRESTORE_EMULATOR_HOST;
if(!emulator||!/^127\.0\.0\.1:\d+$/.test(emulator))throw Error('Only a local Firestore emulator is allowed');
const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Emulator state did not settle');};
function boundary(){
 const run='handoff_'+Date.now()+'_'+Math.random().toString(36).slice(2),clients=[];
 function make(){
  const app=initializeApp({projectId:'demo-receipt-scan',apiKey:'emulator-only'},run+'_'+clients.length),db=sdk.initializeFirestore(app,{experimentalForceLongPolling:true});
  const [host,port]=emulator.split(':');sdk.connectFirestoreEmulator(db,host,Number(port));
  const p=phone(createCloud(),{start:false,timeouts:{backup:3000,finish:3000,take:3000,close:3000,read:3000}});
  const doc=(_db,...parts)=>sdk.doc(db,'runs',run,...parts),collection=(_db,...parts)=>sdk.collection(db,'runs',run,...parts);
  Object.assign(p.context,{doc,collection,query:sdk.query,where:sdk.where,onSnapshot:sdk.onSnapshot,getDocFromServer:sdk.getDocFromServer,getDocsFromServer:sdk.getDocsFromServer,setDoc:(ref,value)=>sdk.setDoc(ref,structuredClone(value)),
   runTransaction:(_db,fn,opts)=>sdk.runTransaction(db,t=>fn({get:r=>t.get(r),set:(r,d)=>t.set(r,structuredClone(d))}),opts)});
  p.run('startDraftHandoffs()');clients.push({p,app,db});
  p.read=async key=>{const s=await sdk.getDocFromServer(doc(null,...(root+key).split('/')));return s.exists()?s.data():null;};
  p.list=async name=>(await sdk.getDocsFromServer(collection(null,...(root+name).split('/')))).docs.map(d=>({id:d.id,...d.data()}));
  p.put=(key,data)=>sdk.setDoc(doc(null,...(root+key).split('/')),data);
  return p;
 }
 return {make,close:async()=>{for(const {p,app,db} of clients){p.stop();await sdk.terminate(db);await deleteApp(app);}}};
}
test('real SDK: two phones transfer the paid result and corrections, then save one record atomically',async()=>{
 const c=boundary();try{
  const a=c.make();await a.scan(2);a.change("openReconcile();reconcileSetRecvLive('milk','4');reconcileSetNoteLive('milk','12')");await a.sync();const sid=a.run('receiptDraftId');await wait(async()=>!!await a.read('drafts/handoff_yotvata_receiving_'+sid));
  const b=c.make();await wait(()=>b.state().offers.length);assert.equal((await b.take(sid)).ok,true);b.run('openReconcile()');assert.equal(b.run('reconcileData[0].received'),4);assert.equal(b.run('reconcileData[0].noteQty'),12);assert.equal(b.requests.length,0);
  // Direct confirmation uses the same final transaction as the summary button.
  assert.equal(await b.run("(async()=>finishDraft('receiving',receiptDraftId,{items:reconcileData.map(l=>({productId:l.productId,qty:l.received,noteQty:l.noteQty,unitPrice:l.price})),paperScan:await packReceiptValue(receiptScanSnapshot())}))()"),true);
  const records=await b.list('receipts');assert.equal(records.length,1);b.context.savedPaper=records[0].paperScan;assert.equal((await b.run('unpackReceiptValue(savedPaper)')).scan.documents.length,2);assert.equal((await b.read('drafts/handoff_yotvata_receiving_'+sid)).state,'saved');assert.equal((await b.list('actionLog')).filter(x=>x.type==='receiving').length,1);assert.equal((await b.list('actionLog')).filter(x=>x.type==='draft-handoff').length,1);
  await wait(()=>a.state().away?.away==='saved');assert.equal(a.run('draftHandoffs.receiving.clear().ok'),true);assert.equal((await b.list('receipts')).length,1);
 }finally{await c.close();}
});
test('real SDK: product price, log and final receipt commit together; stale product stops every write',async()=>{
 const c=boundary();try{
  const a=c.make();a.receipt();await a.put('products/milk',{name:'מוצר בדיקה',price:5});a.change("openReconcile();reconcileSetPriceLive('milk','6');saveReconciledReceipt({skipChecked:true,skipGap:true})");
  await a.put('products/milk',{name:'מוצר בדיקה',price:7});await a.run('confirmReceipt()');assert.equal((await a.list('receipts')).length,0);assert.equal((await a.list('actionLog')).length,0);assert.equal(a.run('receiptList.length'),1);
  await a.put('products/milk',{name:'מוצר בדיקה',price:5});await a.run('confirmReceipt()');assert.equal((await a.list('receipts')).length,1);assert.equal((await a.read('products/milk')).price,6);assert.equal((await a.list('actionLog')).length,1);
 }finally{await c.close();}
});
