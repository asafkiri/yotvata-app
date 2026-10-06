// בדיקות של קוד הייצור מול Firebase SDK אמיתי ואמולטור מקומי בלבד.
// RETURN_FIREBASE_TEST_DEPS=/path/with/node_modules FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node --test tools/returns-firestore.integration.mjs
// כל הנתונים מומצאים; ה-SDK מוגבל לכתובת אמולטור מקומית.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=process.env.RETURN_REPO_ROOT||path.resolve(here,'..');
const require=createRequire(path.join(process.env.RETURN_FIREBASE_TEST_DEPS||process.cwd(),'package.json'));
const {initializeApp,deleteApp}=require('firebase/app'),sdk=require('firebase/firestore');
const emulator=process.env.FIRESTORE_EMULATOR_HOST;
if(!emulator||!/^127\.0\.0\.1:\d+$/.test(emulator))throw Error('Only a local Firestore emulator is allowed');
const wait=async(fn,label='state')=>{for(let i=0;i<700;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Emulator did not settle: '+label);};
const copy=value=>structuredClone(value);
const timers={set:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clear:clearTimeout};
const fields=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v instanceof sdk.FieldValue?v:copy(v)]));
function boundary(){
 const run='return_events_'+randomUUID().replaceAll('-',''),clients=[],writes=[];
 function make(){
  const app=initializeApp({projectId:'demo-receipt-scan',apiKey:'emulator-only'},run+'_'+clients.length),db=sdk.initializeFirestore(app,{experimentalForceLongPolling:true});
  const [host,port]=emulator.split(':');sdk.connectFirestoreEmulator(db,host,Number(port));
  const doc=(_db,...parts)=>sdk.doc(db,'runs',run,...parts),collection=(_db,...parts)=>sdk.collection(db,'runs',run,...parts);
  const api={doc,collection,query:sdk.query,where:sdk.where,orderBy:sdk.orderBy,limit:sdk.limit,onSnapshot:sdk.onSnapshot,getDocFromServer:sdk.getDocFromServer,getDocsFromServer:sdk.getDocsFromServer,deleteField:sdk.deleteField,
   setDoc:(ref,value,opts)=>sdk.setDoc(ref,copy(value),opts),deleteDoc:sdk.deleteDoc,addDoc:(ref,value)=>sdk.addDoc(ref,copy(value)),
   updateDoc:(ref,value)=>{writes.push({op:'updateDoc',path:ref.path,keys:Object.keys(value)});return sdk.updateDoc(ref,fields(value));},
   runTransaction:(_db,fn,opts)=>sdk.runTransaction(db,t=>fn({get:r=>t.get(r),set:(r,d,options)=>{writes.push({op:'transaction.set',path:r.path});return t.set(r,copy(d),options);},update:(r,d)=>{writes.push({op:'transaction.update',path:r.path,keys:Object.keys(d),deletedKeys:Object.entries(d).filter(([,v])=>v instanceof sdk.FieldValue&&v.isEqual(sdk.deleteField())).map(([k])=>k)});return t.update(r,fields(d));},delete:r=>t.delete(r)}),opts)};
  const client={app,db,api,ref:key=>doc(null,...key.split('/')),read:async key=>{const s=await sdk.getDocFromServer(doc(null,...key.split('/')));return s.exists()?s.data():null;},put:(key,d)=>sdk.setDoc(doc(null,...key.split('/')),d),
   list:async key=>(await sdk.getDocsFromServer(collection(null,...key.split('/')))).docs.map(d=>({id:d.id,...d.data()})),snapshot:async key=>{const s=await sdk.getDocFromServer(doc(null,...key.split('/')));return {data:s.exists()?s.data():null,metadata:{fromCache:s.metadata.fromCache,hasPendingWrites:s.metadata.hasPendingWrites}};},stop:()=>{}};
  clients.push(client);return client;
 }
 return {make,writes,close:async()=>{for(const c of clients){try{c.stop();await sdk.terminate(c.db);await deleteApp(c.app);}catch(e){console.error(e);}}}};
}
function modulePhone(c,{storage=new Map(),online=true}={}){
 const ctx=vm.createContext({crypto:{randomUUID},navigator:{onLine:online},setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(repoRoot,'shared-return-events.js'),'utf8'),ctx);
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},client=c.make();
 const engine=ctx.SharedReturnEvents.create({app:'integration',prefix:'test',deviceId:randomUUID(),storage:localStorage,slots:['weekly'],db:client.db,fs:client.api,ref:client.ref('drafts/events'),legacyRef:client.ref('drafts/legacy'),recordRef:id=>client.ref('returns/'+id),legacy:async(_tx,data)=>({slots:{weekly:data||{items:[]}}}),timers,timeouts:{write:1000,transaction:10000,retry:60000}});
 client.stop=()=>engine.stop();const p={...client,engine,storage,ctx,qty:()=>engine.view().slots.weekly.items.reduce((n,x)=>n+x.qty,0),add:(n=1)=>{const current=engine.view().slots.weekly;return engine.change('weekly',{...current,items:[{productId:'milk',name:'מוצר בדיקה',qty:(current.items[0]?.qty||0)+n}]});},send:()=>engine.finish('weekly',(slot,id)=>({id,items:slot.items,date:slot.date})),offline:async()=>{ctx.navigator.onLine=false;await sdk.disableNetwork(client.db);},online:async()=>{ctx.navigator.onLine=true;await sdk.enableNetwork(client.db);await engine.start();await engine.flush();}};
 return p;
}

test('מודול + SDK: עדכוני שדות נפרדים, אופליין, וכמויות משני טלפונים מצטרפים',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await Promise.all([a.engine.start(),b.engine.start()]);await a.offline();a.add(3);b.add(4);await b.engine.flush();await a.online();await wait(()=>a.qty()===7&&b.qty()===7);
 const updates=c.writes.filter(w=>w.op==='updateDoc');assert.ok(updates.length>=2);assert.ok(updates.every(w=>w.keys.every(k=>/^events\.[^.]+$/.test(k))));assert.equal(a.engine.state().pending,0);assert.equal(b.engine.state().pending,0);
 }finally{await c.close();}
});
test('מודול + SDK: שליחה מסירה אירועים ומשאירה מצבות; retry ישן לא מחיה יחידות',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await Promise.all([a.engine.start(),b.engine.start()]);a.add(2);await a.engine.flush();await wait(()=>b.qty()===2);const before=await a.read('drafts/events'),[id,event]=Object.entries(before.events)[0];const out=await a.send();assert.equal(out.ok,true);
 // ב-Web SDK קריאת getDocFromServer יכולה למחזר snapshot של listener פעיל לפני הגעת watch חדש. לקוח שלישי ללא listener קורא כאן את מצב השרת לאחר הטרנזקציה.
 const observed=await c.make().snapshot('drafts/events'),after=observed.data;assert.equal(observed.metadata.fromCache,false);assert.equal(observed.metadata.hasPendingWrites,false);assert.ok(Object.keys(after.events).every(key=>after.sent[key]),'כל retry שהגיע אחרי המחיקה חייב להישאר מאחורי מצבה');assert.ok(c.writes.some(w=>w.op==='transaction.update'&&w.deletedKeys.includes('events.'+id)),'טרנזקציית השליחה מוחקת את האירוע באמצעות deleteField');assert.equal(after.sent[id],out.id);
 await b.api.updateDoc(b.ref('drafts/events'),{['events.'+id]:event});await wait(()=>b.qty()===0);b.add(1);await b.engine.flush();await wait(()=>a.qty()===1);assert.equal((await a.list('returns'))[0].items[0].qty,2);assert.equal((await b.send()).ok,true);assert.equal((await a.list('returns')).length,2);
 }finally{await c.close();}
});
test('מודול + SDK: שני שולחים במקביל מייצרים רשומה אחת, בסגירה אטומית',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await Promise.all([a.engine.start(),b.engine.start()]);a.add(5);await a.engine.flush();await wait(()=>b.qty()===5);const results=await Promise.all([a.send(),b.send()]);assert.equal(results.filter(x=>x.ok&&!x.already).length,1);assert.equal(results.filter(x=>x.already).length,1);const records=await a.list('returns');assert.equal(records.length,1);assert.equal(records[0].items[0].qty,5);assert.equal((await a.read('drafts/events')).epochs.weekly,1);
 }finally{await c.close();}
});
test('מודול + SDK: אירוע שנשמר בתור ה-SDK בזמן נתק נכנס לשבוע הבא',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await Promise.all([a.engine.start(),b.engine.start()]);a.add(2);await a.engine.flush();await wait(()=>b.qty()===2);await sdk.disableNetwork(b.db);b.add(1);await new Promise(r=>setTimeout(r,30));const out=await a.send();assert.equal(out.ok,true);await sdk.enableNetwork(b.db);await b.engine.flush();await wait(()=>a.qty()===1&&b.qty()===1);assert.equal((await a.read('returns/'+out.id)).items[0].qty,2);
 }finally{await c.close();}
});
test('מודול + SDK: הסרה באופליין מתייחסת ליחידות שנצפו ואינה מוחקת סריקה חדשה',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await Promise.all([a.engine.start(),b.engine.start()]);a.add(2);await a.engine.flush();await wait(()=>b.qty()===2);await b.offline();b.engine.change('weekly',{items:[],date:'',note:''});a.add(1);await a.engine.flush();await b.online();await wait(()=>a.qty()===1&&b.qty()===1);assert.equal((await a.send()).record.items[0].qty,1);
 }finally{await c.close();}
});
test('מודול + SDK: שני טלפונים ממירים טיוטה ישנה פעם אחת',async()=>{
 const c=boundary();try{const a=modulePhone(c),b=modulePhone(c);await a.put('drafts/legacy',{draftId:'synthetic-draft',items:[{productId:'milk',qty:6}],date:'2026-10-06'});await Promise.all([a.engine.start(),b.engine.start()]);await wait(()=>a.qty()===6&&b.qty()===6);const d=await a.read('drafts/events');assert.equal(Object.values(d.events).filter(e=>e.type==='item').length,1);assert.ok(Object.keys(d.events).every(id=>id.startsWith('migr_')));
 }finally{await c.close();}
});


test('מודול + SDK: שינוי מקור מסומן, וההגנה נשארת גם אחרי מחיקתו',async()=>{
 const c=boundary();try{const a=modulePhone(c);await a.engine.start();const source=a.ref('returns/synthetic-source');await a.put('returns/synthetic-source',{items:[{productId:'milk',qty:3}]});
 const amended=await a.engine.mutate([source],snaps=>({writes:[{op:'update',ref:source,data:{items:[{productId:'milk',qty:2}]}}],changes:{weekly:{items:[{productId:'milk',qty:1}],date:'',note:''}},result:{moved:1}}),{key:'synthetic-amend'});
 assert.equal(amended.ok,true);assert.ok(amended.mutationId);assert.equal((await a.read('returns/synthetic-source')).returnEventMutationId,amended.mutationId);assert.equal((await a.read('drafts/events')).protectedRecords['synthetic-source'],amended.mutationId);
 const deleted=await a.engine.mutate([source],snaps=>({writes:[{op:'delete',ref:source}],changes:{weekly:{items:[{productId:'milk',qty:3}],date:'',note:''}},result:{moved:2}}),{key:'synthetic-delete'});
 assert.equal(deleted.ok,true);assert.equal(await a.read('returns/synthetic-source'),null);assert.equal((await a.read('drafts/events')).protectedRecords['synthetic-source'],deleted.mutationId);assert.equal(a.qty(),3);
 const repeated=await a.engine.mutate([source],()=>{throw Error('Repeated operation must not run');},{key:'synthetic-delete'});assert.equal(repeated.already,true);assert.equal(a.qty(),3);
 }finally{await c.close();}
});

const appConfig={tnuva:{runtime:'tools/receipt-scan-harness.mjs',init:'startReturnsLive()',product:'milk',second:'yogurt'},yotvata:{runtime:'tools/receipt-scan-harness.mjs',init:'startReturnEvents()',product:'milk',second:'yogurt'},berman:{runtime:'tests/receipt-scan-harness.mjs',init:'startReturnsEvents()',product:'code_101',second:'code_238'}};
const selected=['yotvata'];
for(const name of selected){
 const config=appConfig[name];if(!config)throw Error('Unknown app '+name);
 const {runtime}=await import(path.join(repoRoot,config.runtime));
 const ROOT='artifacts/'+name+'-app-classic/public/data/';
 function appPhone(c,{storage=new Map(),online=true,clock=0}={}){
  const p=name==='berman'?runtime({storage}):runtime(name,{storage,handoff:false});
  p.run("if(typeof returnsEvents!=='undefined'&&returnsEvents){returnsEvents.stop();returnsEvents=null;}");
  const client=c.make();Object.assign(p.context,client.api);p.context.setTimeout=timers.set;p.context.clearTimeout=clearTimeout;p.context.window.location={href:''};p.context.navigator.onLine=online;
  vm.runInContext(fs.readFileSync(path.join(repoRoot,'shared-return-events.js'),'utf8'),p.context);
  p.context.testClock=clock;p.run('Date.now=(()=>{const old=Date.now;return ()=>old()+testClock})();');
  p.run("currentView='returns';mainMode='returns';refreshReturnsList=()=>{};updateCart=()=>{};renderReceiptsHistory=()=>{};setView=()=>{};logAction=()=>{};hideSend=()=>{};renderSendModal=()=>{};showCloudBusy=()=>{};hideCloudBusy=()=>{};");
  p.run(config.init);client.stop=()=>p.run('returnsEvents.stop()');
  const q={...p,client,ready:()=>p.run('returnsEvents.state().ready'),qty:(id=config.product)=>p.run('returnsList.find(x=>x.productId==='+JSON.stringify(id)+')?.qty||0'),scan:(id=config.product)=>p.run('addReturn('+JSON.stringify(id)+')'),flush:()=>p.run('returnsEvents.flush()'),send:async()=>{p.run('openReturnsSend()');await p.run('performSend({name:"ספק בדיקה",phone:"0500000000"})');},
   offline:async()=>{p.context.navigator.onLine=false;await sdk.disableNetwork(client.db);},online:async()=>{p.context.navigator.onLine=true;await sdk.enableNetwork(client.db);await p.run('returnsEvents.start()');await p.run('returnsEvents.flush()');},records:()=>client.list(ROOT+'returns'),read:()=>client.read(ROOT+'drafts/returns_events_'+name+'_v1')};
  return q;
 }
 test(name+' מלא + SDK: שתי סריקות באותה שנייה, אופליין ושעונים שונים נשמרים',async()=>{
  const c=boundary();try{const a=appPhone(c,{clock:-7*3600000}),b=appPhone(c,{clock:11*3600000});await wait(()=>a.ready()&&b.ready());a.scan();b.scan();await Promise.all([a.flush(),b.flush()]);await wait(()=>a.qty()===2&&b.qty()===2);await a.offline();a.scan();b.scan();await b.flush();await a.online();await wait(()=>a.qty()===4&&b.qty()===4);assert.equal(a.requests.length+b.requests.length,0);
  }finally{await c.close();}
 });
 test(name+' מלא + SDK: שני שולחים, רשומה אחת ורק טלפון אחד פותח וואטסאפ',async()=>{
  const c=boundary();try{const a=appPhone(c),b=appPhone(c);await wait(()=>a.ready()&&b.ready());a.scan();await a.flush();await wait(()=>b.qty()===1);a.run('openReturnsSend()');b.run('openReturnsSend()');await Promise.all([a.run('performSend({name:"בדיקה א",phone:"0500000000"})'),b.run('performSend({name:"בדיקה ב",phone:"0500000000"})')]);const records=await a.records();assert.equal(records.length,1);assert.equal(records[0].items[0].qty,1);assert.equal([a,b].filter(p=>p.run('window.location.href').includes('wa.me')).length,1);await wait(()=>a.qty()===0&&b.qty()===0);
  }finally{await c.close();}
 });
 test(name+' מלא + SDK: סריקה מאוחרת לא משנה את ההחזרה שנשלחה; פתיחה עם מטמון ישן בטוחה',async()=>{
  const c=boundary();try{const a=appPhone(c),b=appPhone(c);await wait(()=>a.ready()&&b.ready());a.scan();await a.flush();await wait(()=>b.qty()===1);const stale=new Map(b.storage);await b.offline();await a.send();b.scan();await b.online();await wait(()=>a.qty()===1&&b.qty()===1);let records=await a.records();assert.equal(records.length,1);assert.equal(records[0].items[0].qty,1);const first=copy(records[0]);await a.send();records=await a.records();assert.equal(records.length,2);assert.deepEqual(records.find(x=>x.id===first.id),first);
   const d=appPhone(c,{storage:stale,online:false});await sdk.disableNetwork(d.client.db);d.scan();await d.online();await wait(()=>d.qty()===1&&a.qty()===1);assert.equal((await d.records()).length,2);assert.equal(d.requests.length,0);
  }finally{await c.close();}
 });
 test(name+' מלא + SDK: שחזור ישן לא מחיה תעודה שנמחקה והוגנה בשרת',async()=>{
  const c=boundary();try{const a=appPhone(c);await wait(()=>a.ready());const ledger=ROOT+'drafts/returns_events_'+name+'_v1';
   await a.client.api.updateDoc(a.client.ref(ledger),{'protectedRecords.deleted_source':'op_synthetic'});
   const restore={op:'set',path:(ROOT+'returns/deleted_source').split('/'),data:{items:[{productId:config.product,qty:7}],timestamp:1}};
   a.context.testBlockedReturnTask=restore;await assert.rejects(a.run('executeCloudTask(testBlockedReturnTask)'));assert.equal(await a.client.read(ROOT+'returns/deleted_source'),null);
   a.context.testBlockedReturnTask={...restore,op:'create-if-absent'};await assert.rejects(a.run('executeCloudTask(testBlockedReturnTask)'));assert.equal(await a.client.read(ROOT+'returns/deleted_source'),null);
   a.context.testBlockedReturnTask={op:'batch',writes:[{op:'set',path:(ROOT+'returns/innocent_restore').split('/'),data:{items:[{productId:config.product,qty:1}]}},restore]};
   await assert.rejects(a.run('executeCloudTask(testBlockedReturnTask)'));assert.equal(await a.client.read(ROOT+'returns/deleted_source'),null);assert.equal(await a.client.read(ROOT+'returns/innocent_restore'),null);assert.equal((await a.read()).protectedRecords.deleted_source,'op_synthetic');assert.equal(a.requests.length,0);
  }finally{await c.close();}
 });

}
