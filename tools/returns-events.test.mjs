import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloud,phone,json,root,settle} from './returns-events-harness.mjs';
const qty=(p,id='milk')=>json(p,'returnsList').filter(x=>x.productId===id).reduce((a,x)=>a+x.qty,0);
const records=c=>c.paths(root+'returns/').map(p=>c.get(p));
const phones=[];const make=(...args)=>{const p=phone(...args);phones.push(p);return p;};test.afterEach(()=>{while(phones.length)phones.pop().stop();});
test('סריקה בלי קליטה וקליטה מחדש מצטרפת לסריקה מהטלפון השני',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();await a.online(false);a.scan('milk',2);await a.sync();b.scan('coffee',3);await b.sync();await a.online(true);await a.sync();await b.sync();assert.equal(qty(a,'milk'),2);assert.equal(qty(a,'coffee'),3);assert.equal(qty(b,'milk'),2);assert.equal(qty(b,'coffee'),3);
});
test('שתי סריקות באותה שנייה של אותו מוצר מתחברות',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan('milk',2);b.scan('milk',3);await Promise.all([a.sync(),b.sync()]);await settle();assert.equal(qty(a),5);assert.equal(qty(b),5);
});
test('שעון מקדים ושעון מאחר אינם מוחקים שינוי',async()=>{
 const c=createCloud(),a=make(c,{clock:8*3600000}),b=make(c,{clock:-8*3600000});await settle();a.scan();await a.sync();b.scan('coffee');await b.sync();await settle();assert.equal(qty(a),1);assert.equal(qty(a,'coffee'),1);assert.equal(qty(b),1);assert.equal(qty(b,'coffee'),1);
});
test('סריקה לפני השליחה כלולה, וסריקה מאוחרת נשארת רק בטיוטה הבאה',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan();await a.sync();a.run('openReturnsSend()');b.scan('coffee',2);await b.sync();await a.run('performSend({name:"ספק בדיקה",phone:"0500000000"})');await settle();assert.equal(records(c).length,1);assert.equal(records(c)[0].items.reduce((n,x)=>n+x.qty,0),3);b.scan('milk',4);await b.sync();assert.equal(qty(a),4);assert.equal(records(c)[0].items.reduce((n,x)=>n+x.qty,0),3);
});
test('שני טלפונים שולחים יחד ונוצרת החזרה אחת',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan('milk',3);await a.sync();a.run('openReturnsSend()');b.run('openReturnsSend()');await Promise.all([a.run('performSend({name:"ספק בדיקה",phone:"0500000000"})'),b.run('performSend({name:"ספק בדיקה",phone:"0500000000"})')]);await settle();assert.equal(records(c).length,1);assert.equal(qty(a),0);assert.equal(qty(b),0);
});
test('טלפון שנפתח אחרי שבוע בלי קליטה לא מחזיר פריטים שכבר נשלחו',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan('milk',9);await a.sync();const storage=new Map(b.storage);b.stop();await a.send();const old=make(c,{storage,online:false});old.scan('coffee',2);await old.sync();await old.online(true);await old.sync();await settle();assert.equal(qty(a),0);assert.equal(qty(a,'coffee'),2);assert.equal(qty(old),0);assert.equal(records(c).length,1);
});

test('הסרה מטלפון מנותק אחרי שהבסיס נשלח אינה מפחיתה מסריקה חדשה',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan('milk',4);await a.sync();await b.online(false);b.run('removeReturn("milk")');await a.send();a.scan('milk',2);await a.sync();await b.online(true);await b.sync();assert.equal(qty(a),2);assert.equal(qty(b),2);assert.equal(records(c)[0].items[0].qty,4);
});
test('שני טלפונים ממירים אותה טיוטה ישנה רק פעם אחת, ותור SDK ישן אינו משפיע',async()=>{
 const c=createCloud();c.put(root+'drafts/returns',{items:[{productId:'milk',name:'חלב בדיקה',qty:7}],updatedAt:9999999999999});
 const a=make(c),b=make(c);await settle();assert.equal(qty(a),7);assert.equal(qty(b),7);await a.send();
 const old=c.client();await old.fs.setDoc({path:root+'drafts/returns'},{items:[{productId:'milk',qty:99}],updatedAt:99999999999999});
 b.scan('coffee',2);await b.sync();assert.equal(qty(a),0);assert.equal(qty(a,'coffee'),2);assert.equal(records(c)[0].items[0].qty,7);assert.equal(c.paths('returns_events_yotvata_v1').length,1);
});
test('תור שמירה ישן מבודד ואינו יוצר תעודה כפולה או דורס טיוטה',async()=>{
 const c=createCloud(),old=[{id:'draft-q',actionName:'save returns draft',task:{op:'set',path:(root+'drafts/returns').split('/'),data:{items:[{productId:'milk',qty:44}]}}},{id:'final-q',actionName:'save returns before send',task:{op:'set',path:(root+'returns/old-id').split('/'),data:{items:[{name:'ישן',qty:44}]}}}];
 const a=make(c,{storage:new Map([['yt_cloud_failed_writes_v1',JSON.stringify(old)]])});await settle();assert.equal(a.run('cloudFailedWrites.length'),0);assert.equal(JSON.parse(a.storage.get('yt_returns_old_writes_v1')).length,2);await a.run('retryCloudFailedWrites()');assert.equal(records(c).length,0);assert.equal(qty(a),0);
});
test('תשובה שאבדה אחרי השליחה אינה משכפלת תעודה אחרי הפעלה מחדש',async()=>{
 const c=createCloud(),a=make(c);await settle();a.scan('milk',3);await a.sync();c.loseReplyAfterCommit=true;await a.send();assert.equal(records(c).length,1);assert.equal(a.context.window.location.href,'');const storage=new Map(a.storage);a.stop();c.loseReplyAfterCommit=false;const b=make(c,{storage});await settle();b.scan('coffee',2);await b.sync();await b.send();assert.equal(records(c).length,1,'משלימים קודם את ניסיון השליחה הקודם');await b.send();assert.equal(records(c).length,2);assert.equal(records(c).reduce((sum,r)=>sum+r.items.reduce((n,l)=>n+l.qty,0),0),5);
});
test('כשל בענן אינו פותח וואטסאפ ושומר את הטיוטה הממתינה',async()=>{
 const c=createCloud(),a=make(c);await settle();await a.online(false);a.scan('milk',2);await a.send();assert.equal(a.context.window.location.href,'');assert.equal(records(c).length,0);assert.equal(qty(a),2);assert.ok(a.storage.get('yt_return_events_v1'));await a.online(true);await a.sync();await a.send();assert.equal(records(c).length,1);assert.match(a.context.window.location.href,/wa.me/);
});
test('המרת מארז, שינוי ברקוד ומוצר ידני שורדים הפעלה מחדש',async()=>{
 const c=createCloud(),a=make(c);await settle();a.run(`products.push({id:'pack',name:'מארז בדיקה',barcode:'7290000000091',price:10});products[0].billingPackId='pack';products[0].billingPackSize=2;addQtyToTarget(products[0],5,'returns');qtyProduct=products[0];qtyTarget='returns';$('qtyVal').value='0';openReturnsScanner=()=>{};`);
 // מסלול ההמרה משתמש באותה טיוטה קיימת, ללא קריאת צילום.
 a.run(`qtyPackOfferInfo=()=>({pack:products.find(p=>p.id==='pack'),size:2,total:5,n:2,remainder:1,forReturns:true});convertQtyToPack();$('mr_name').value='זיכוי בדיקה';$('mr_price').value='3.25';$('mr_qty').value='2';addManualReturn();`);
 await a.sync();const saved=json(a,'returnsList');const b=make(c,{storage:new Map(a.storage)});await settle();assert.deepEqual(json(b,'returnsList'),saved);assert.equal(qty(b,'pack'),2);assert.equal(qty(b,'milk'),1);assert.equal(saved.find(x=>x.manual).unitPrice,3.25);assert.equal(a.requests.length,0);
});

test('העברה מתעודה לרשימה ושמירת התעודה אטומיות גם בלחיצה משני טלפונים',async()=>{
 const c=createCloud(),a=make(c),b=make(c),record={id:'source',timestamp:1,credited:false,items:[{name:'חלב בדיקה',barcode:'7290000000008',qty:5,unitPrice:5,lineTotal:25}],totalExVat:25,totalIncVat:25};await settle();c.put(root+'returns/source',{...record});
 for(const p of [a,b]){p.context.source=record;p.run('returns=[structuredClone(source)]');}
 await Promise.all([a.run('retReturnApply("source",returns[0].items,[2],null)'),b.run('retReturnApply("source",returns[0].items,[2],null)')]);await settle();assert.equal(c.get(root+'returns/source').items[0].qty,3);assert.equal(qty(a),2);assert.equal(qty(b),2);
 assert.ok(c.writes.filter(w=>w.path===root+'returns/source').every(w=>w.kind==='transaction'));
});
test('תעודה שהשתנתה בזמן החזרה לרשימה אינה נדרסת ואינה מוסיפה סריקות כפולות',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:false,items:[{name:'חלב בדיקה',barcode:'7290000000008',qty:5,unitPrice:5,lineTotal:25}]};await settle();a.context.source=record;a.run('returns=[source]');c.put(root+'returns/source',{...record,credited:true});await a.run('retReturnApply("source",returns[0].items,[2],null)');assert.equal(c.get(root+'returns/source').credited,true);assert.equal(c.get(root+'returns/source').items[0].qty,5);assert.equal(qty(a),0);
});
test('שינוי כמות והסרה נשמרים כאירועים; חזרה מהניתוק אינה מפחיתה סריקה שלא נראתה',async()=>{
 const c=createCloud(),a=make(c),b=make(c);await settle();a.scan('milk',5);await a.sync();await b.online(false);b.run('changeReturnQty("milk",-1)');a.scan('milk',2);await a.sync();await b.online(true);await b.sync();assert.equal(qty(a),6);assert.equal(qty(b),6);const data=c.get(root+'drafts/returns_events_yotvata_v1');assert.ok(Object.values(data.events).some(e=>e.delta===-1));
});
test('אירוע שנשלח שוב אחרי שנשלחה ההחזרה נשאר מצבה ואינו חוזר לרשימה',async()=>{
 const c=createCloud(),a=make(c);await settle();a.scan('milk',4);await a.sync();const data=c.get(root+'drafts/returns_events_yotvata_v1'),[id,event]=Object.entries(data.events)[0];await a.send();await a.client.fs.updateDoc({path:root+'drafts/returns_events_yotvata_v1'},{['events.'+id]:event});await settle();assert.equal(qty(a),0);assert.ok(c.get(root+'drafts/returns_events_yotvata_v1').sent[id]);a.scan('coffee',2);await a.sync();await a.send();assert.equal(records(c).length,2);assert.equal(records(c).reduce((n,r)=>n+r.items.reduce((t,l)=>t+l.qty,0),0),6);
});

test('פער שהועבר ונשלח בתעודה חדשה אינו חוזר לחוב המקורי בביטול ההעברה',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:true,items:[{name:'חלב בדיקה',barcode:'7290000000008',qty:5,unitPrice:5,lineTotal:25}],totalExVat:25,totalIncVat:25};await settle();c.put(root+'returns/source',record);a.context.source=record;a.run('returns=[source]');
 await a.run('saveReturnCarry("source",{items:[{name:"חלב בדיקה",barcode:"7290000000008",qty:2,price:5}],val:10})');assert.equal(json(a,'returnsList')[0].qty,2);await a.send();const before=c.get(root+'returns/source');assert.equal(await a.run('undoReturnCarry("source")'),false);assert.deepEqual(c.get(root+'returns/source'),before);assert.equal(qty(a),0);assert.equal(records(c).length,2);
});
test('ביטול העברה חלקית שנשארה ברשימה אינו מחזיר את כל החוב המקורי',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:true,items:[],carriedNotes:[{name:'פער בדיקה',qty:3,price:5,barcode:''}]};await settle();c.put(root+'returns/source',record);a.context.source=record;a.run('returns=[source];returnsList=[{productId:"carry-test",name:"פער בדיקה",qty:1,unitPrice:5,manual:true,carried:true,carriedFrom:"source"}];saveReturnsDraft()');await a.sync();assert.equal(await a.run('undoReturnCarry("source")'),false);assert.equal(c.get(root+'returns/source').carriedNotes[0].qty,3);assert.equal(json(a,'returnsList')[0].qty,1);
});

test('שחזור גיבוי ישן אינו מוחק מצבות, מחזיר טיוטה או דורס תעודה חדשה',async()=>{
 const c=createCloud(),a=make(c);await settle();a.scan('milk',3);await a.sync();const oldLedger=c.get(root+'drafts/returns_events_yotvata_v1');await a.send();const ledger=c.get(root+'drafts/returns_events_yotvata_v1'),recordPath=c.paths(root+'returns/')[0],id=recordPath.split('/').at(-1),record=c.get(recordPath);
 a.context.collection=(_db,...parts)=>({path:parts.join('/')});
 a.context.getDocs=async ref=>({docs:c.paths(ref.path+'/').filter(path=>path.split('/').length===ref.path.split('/').length+1).map(path=>({id:path.split('/').at(-1),ref:{path},data:()=>c.get(path)}))});
 a.context.writeBatch=()=>{const ops=[];return {set:(ref,data)=>ops.push({op:'set',path:ref.path,data}),delete:ref=>ops.push({op:'delete',path:ref.path}),commit:async()=>c._commit(ops)};};
 a.context.oldBackup={backupType:'yotvata-firestore-full',collections:{drafts:{returns_events_yotvata_v1:oldLedger},returns:{[id]:{...record,items:[{name:'אסור לדרוס',qty:99}]},'missing-record':{items:[{name:'שחזור בדיקה',qty:1}]}}}};
 a.run('promoAutoCleanup=()=>{}');await a.run('applyBackupToCloud(oldBackup)');await settle();assert.deepEqual(c.get(root+'drafts/returns_events_yotvata_v1'),ledger);assert.deepEqual(c.get(recordPath),record);assert.equal(qty(a),0);assert.equal(c.get(root+'returns/missing-record').items[0].qty,1);
});

test('שחזור מהסל או מתור ישן לא דורס תעודת החזרה קיימת',async()=>{
 const c=createCloud(),a=make(c);await settle();const current={items:[{name:'עדכני',qty:3}],returnEventSend:{app:'yotvata',slot:'weekly',epoch:0}};c.put(root+'returns/kept',current);c.put(root+'trash/old',{data:{items:[{name:'ישן',qty:99}]}});
 a.context.oldTask={op:'set',path:(root+'returns/kept').split('/'),data:{items:[{name:'ישן',qty:99}]}};
 await assert.rejects(a.run('executeCloudTask(oldTask)'),/כבר קיימת/);a.context.oldBatch={op:'batch',writes:[a.context.oldTask,{op:'delete',path:(root+'trash/old').split('/')} ]};await assert.rejects(a.run('executeCloudTask(oldBatch)'),/כבר קיימת/);assert.deepEqual(c.get(root+'returns/kept'),current);assert.ok(c.get(root+'trash/old'));
});
test('גיבוי legacy שנכשל מתבצע בהפעלה הבאה גם כשכבר נוצר תור אירועים חדש',async()=>{
 const old=JSON.stringify([{productId:'milk',name:'עותק מקומי ישן',qty:17}]);
 // זו צורת האחסון לאחר כשל quota בגיבוי, ואחריו כתיבה מוצלחת של pending.
 const storage=new Map([['yt_returns_draft',old],['yt_return_events_v1',JSON.stringify({pending:{},cache:null,seq:0,intents:{},mutations:{}})]]),c=createCloud(),a=make(c,{storage});await settle();assert.equal(storage.get('yt_returns_before_events_v1'),old);assert.equal(storage.get('yt_returns_legacy_checked_v1'),'1');assert.equal(qty(a),0);
});

test('אפשר להעביר פער, לבטל, ולהעביר אותו שוב בלי דילוג או כפל',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:true,items:[],carriedNotes:[]};await settle();c.put(root+'returns/source',record);a.context.source=record;a.run('returns=[source]');
 const carry='saveReturnCarry("source",{items:[{name:"פער בדיקה",qty:2,price:5}],val:10})';await a.run(carry);assert.equal(json(a,'returnsList')[0].qty,2);assert.equal(await a.run('undoReturnCarry("source")'),true);assert.equal(json(a,'returnsList').length,0);await a.run(carry);assert.equal(json(a,'returnsList')[0].qty,2);assert.equal(c.get(root+'returns/source').carriedNotes[0].qty,2);
});

test('תעודה שכל פריטיה עברו לרשימה אינה ניתנת לשחזור מהסל במקביל לפריטים',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:false,items:[{name:'חלב בדיקה',barcode:'7290000000008',qty:2,unitPrice:5,lineTotal:10}],totalExVat:10,totalIncVat:10};await settle();c.put(root+'returns/source',record);a.context.source=record;a.run('returns=[source]');await a.run('retReturnApply("source",returns[0].items,[2],null)');assert.equal(c.get(root+'returns/source'),null);const trashPath=c.paths(root+'trash/')[0],trashed=c.get(trashPath);assert.equal(trashed.reason,'return-to-open-list');a.context.trashed={trashId:trashPath.split('/').at(-1),...trashed};a.run('trash=[trashed]');await a.run('restoreTrashItem(trashed.trashId)');await a.run('restoreDoc("returns",trashed.data)');assert.equal(c.get(root+'returns/source'),null);assert.equal(qty(a),2);assert.ok(c.get(trashPath));assert.match(a.toasts.at(-1),/לא ניתן לשחזר/);
});

test('עותק ישן של תעודה שנמחקה בהעברה לרשימה חסום גם בלי סימון בקובץ הישן',async()=>{
 const c=createCloud(),a=make(c),record={id:'source',timestamp:1,credited:false,items:[{name:'חלב בדיקה',barcode:'7290000000008',qty:2,unitPrice:5,lineTotal:10}],totalExVat:10,totalIncVat:10};await settle();c.put(root+'returns/source',record);a.context.source=record;a.run('returns=[source]');await a.run('retReturnApply("source",returns[0].items,[2],null)');assert.equal(c.get(root+'returns/source'),null);assert.ok(c.get(root+'drafts/returns_events_yotvata_v1').protectedRecords.source);
 a.context.oldTask={op:'set',path:(root+'returns/source').split('/'),data:record};await assert.rejects(a.run('executeCloudTask(oldTask)'),/לא ישוחזר/);await assert.rejects(a.run('executeCloudTask({...oldTask,op:"create-if-absent"})'),/לא ישוחזר/);
 a.context.collection=(_db,...parts)=>({path:parts.join('/')});a.context.getDocs=async ref=>({docs:c.paths(ref.path+'/').filter(path=>path.split('/').length===ref.path.split('/').length+1).map(path=>({id:path.split('/').at(-1),ref:{path},data:()=>c.get(path)}))});a.context.writeBatch=()=>{const ops=[];return {set:(ref,data)=>ops.push({op:'set',path:ref.path,data}),delete:ref=>ops.push({op:'delete',path:ref.path}),commit:async()=>c._commit(ops)};};a.context.backup={backupType:'yotvata-firestore-full',collections:{returns:{source:record}}};a.run('promoAutoCleanup=()=>{}');await a.run('applyBackupToCloud(backup)');await settle();assert.equal(c.get(root+'returns/source'),null);assert.equal(qty(a),2);assert.ok(c.get(root+'drafts/returns_events_yotvata_v1').protectedRecords.source);
});
