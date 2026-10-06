import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const promo = { id:'august',name:'חומוס 750',type:'monthEnd',pct:20,start:'2026-08-01',end:'2026-08-31',productIds:['hummus'] };
const receipt = (id='r', date='2026-08-06', qty=6) => ({ id, date, timestamp:Date.parse(date+'T12:00:00'),
  items:[{productId:'hummus',qty,unitPrice:8.87,lineTotal:Math.round(qty*887)/100}], noteTotalInc:qty*8.87 });
const deletedPromo = (pr=promo, reason='promo-auto-cleanup') => ({collectionName:'promos',originalId:pr.id,reason,data:pr,deletedAt:Date.parse('2026-10-01')});
const copy = x => structuredClone(x);
function setup(seed={}, today='2026-10-06') {
  const c=runtime('yotvata'), docs=new Map(), commits=[];
  // Resolve appId rather than depending on production settings in test fixtures.
  const prefix=c.run("dataPath('receipts','x').slice(0,4).join('/')");
  const path=(name,id)=>prefix+'/'+name+'/'+id;
  for(const [name,records] of Object.entries(seed)) for(const [id,data] of Object.entries(records)) docs.set(path(name,id),copy(data));
  const snapshot=ref=>({id:ref.split('/').at(-1),ref,exists:()=>docs.has(ref),data:()=>copy(docs.get(ref))});
  c.context.doc=(_db,...p)=>p.join('/');
  c.context.collection=(_db,...p)=>p.join('/');
  c.context.getDocsFromServer=async ref=>{
    if(c.context.failRead) throw Error('read failed');
    return {docs:[...docs.keys()].filter(k=>k.startsWith(ref+'/')).sort().map(snapshot)};
  };
  c.context.getDocs=c.context.getDocsFromServer;
  c.context.writeBatch=()=>{
    const writes=[];
    return {set:(ref,data)=>writes.push({ref,data:copy(data)}),delete:ref=>writes.push({ref}),commit:async()=>{
      for(const w of writes) if(w.data) docs.set(w.ref,w.data); else docs.delete(w.ref);
      sync();
    }};
  };
  c.context.runTransaction=async (_db,fn)=>{
    const writes=[];
    const result=await fn({get:async ref=>snapshot(ref),set:(ref,data)=>writes.push({op:'set',ref,data:copy(data)}),
      update:(ref,data)=>{if(c.context.failStamp && ref.includes('/receipts/')) throw Error('stamp failed');writes.push({op:'update',ref,data:copy(data)});},
      delete:ref=>writes.push({op:'delete',ref})});
    if(c.context.failCommit && writes.length) throw Error('commit failed');
    for(const w of writes) {
      if(w.op==='delete') docs.delete(w.ref);
      else docs.set(w.ref,w.op==='update'?{...docs.get(w.ref),...w.data}:w.data);
    }
    if(writes.length) commits.push(writes);
    sync(); return result;
  };
  function sync() {
    c.context.cloudData=Object.fromEntries(['promos','promoArchive','receipts','trash'].map(name=>[name,[...docs].filter(([k])=>k.startsWith(prefix+'/'+name+'/')).map(([k,v])=>({...copy(v),id:k.split('/').at(-1)}))]));
    c.run('promos=cloudData.promos; promoArchive=cloudData.promoArchive; receipts=cloudData.receipts.slice(0,100); trash=cloudData.trash.slice(0,100);');
  }
  c.context.testDay=today;
  c.run("todayStr=()=>testDay; promoHistoryLoaded.promos=true; promoHistoryLoaded.archive=true; promoHistoryLoaded.receipts=true; returns=[]; stampResolvedAiPriceFindings=()=>{}; console={...console,error:()=>{}};");
  sync();
  return {...c,docs,commits,path,sync,get:(name,id)=>docs.get(path(name,id))};
}
const august=c=>c.run("receiptRangeData('2026-08-01','2026-08-31')");

test('automatic trash recovery restores August credit once and keeps it out of current promotions',async()=>{
  const c=setup({trash:{old:deletedPromo()},receipts:{r:receipt()}});
  assert.equal(august(c).meEx,0);
  assert.equal(await c.run('promoAutoCleanup()'),true);
  assert.equal(august(c).meEx,10.64);
  assert.equal(august(c).netInc,50.24);
  assert.equal(c.get('receipts','r').monthEndPromoSnapshots[0].creditEx,10.64);
  assert.ok(c.get('promoArchive','august')); assert.equal(c.get('promos','august'),undefined);
  assert.equal(c.get('trash','old'),undefined);
  const n=c.commits.length;
  await c.run('promoAutoCleanup(true)'); assert.equal(c.commits.length,n);
  const html=c.run('supplierPaymentModeCardsHtml(receiptRangeData("2026-08-01","2026-08-31"))');
  assert.match(html,/כולל זיכוי צפוי במרכזת/); assert.doesNotMatch(html,/אין זיכויי מבצע פתוחים/);
});

test('August quantities use existing per-line rounding (48 units, 85.14 before VAT)',async()=>{
  const dates=['02','06','09','18','20','27'], quantities=[6,6,6,6,12,12];
  const recs=Object.fromEntries(dates.map((d,i)=>['r'+i,receipt('r'+i,'2026-08-'+d,quantities[i])]));
  const c=setup({receipts:recs,trash:{old:deletedPromo()}});
  await c.run('promoAutoCleanup()'); assert.equal(august(c).meEx,85.14);
  c.run('promoArchive=[]; promos=[]'); assert.equal(august(c).meEx,85.14);
});

test('year-two retention boundary, purge after expiry, permanent receipt credit',async()=>{
  const c=setup({promoArchive:{august:promo},receipts:{r:receipt()}},'2028-08-31');
  await c.run('promoAutoCleanup()'); assert.ok(c.get('promoArchive','august'));
  c.context.testDay='2028-09-01'; await c.run('promoAutoCleanup()');
  assert.equal(c.get('promoArchive','august'),undefined); assert.equal(august(c).meEx,10.64);
  assert.equal(c.run("promoArchiveExpiry({end:'2024-02-29'})"),'2026-02-28');
  assert.equal(c.run("promoArchiveExpiry({end:''})"),'');
});

test('full migration covers receipts and trash entries outside the UI limits',async()=>{
  const recs=Object.fromEntries(Array.from({length:120},(_,i)=>['r'+i,receipt('r'+i)]));
  const trash=Object.fromEntries(Array.from({length:110},(_,i)=>['a'+i,{collectionName:'products',originalId:'p',data:{}}]));
  trash.zLast=deletedPromo();
  const c=setup({receipts:recs,trash},'2029-01-01');
  assert.equal(c.run('receipts.length'),100);
  await c.run('promoAutoCleanup()');
  for(const id of Object.keys(recs)) assert.equal(c.get('receipts',id).monthEndPromoSnapshots[0].creditEx,10.64);
  assert.equal(c.get('promoArchive','august'),undefined);
});

test('failed receipt stamping prevents retention purge; retry safely completes',async()=>{
  const c=setup({promoArchive:{august:promo},receipts:{r:receipt()}},'2029-01-01');
  c.context.failStamp=true; assert.equal(await c.run('promoAutoCleanup()'),false);
  assert.ok(c.get('promoArchive','august')); assert.equal(c.get('receipts','r').monthEndPromoSnapshots,undefined);
  c.context.failStamp=false; assert.equal(await c.run('promoAutoCleanup()'),true);
  assert.equal(c.get('promoArchive','august'),undefined); assert.equal(august(c).meEx,10.64);
});

test('failed recovery commit leaves the original trash backup intact',async()=>{
  const c=setup({trash:{old:deletedPromo()},receipts:{r:receipt()}});
  c.context.failCommit=true; assert.equal(await c.run('promoAutoCleanup()'),false);
  assert.ok(c.get('trash','old')); assert.equal(c.get('promoArchive','august'),undefined);
  c.context.failCommit=false; await c.run('promoAutoCleanup()'); assert.equal(august(c).meEx,10.64);
});

test('manual deletions are not resurrected; document-discount promotions never become month-end credits',async()=>{
  const c=setup({trash:{manual:deletedPromo(promo,'delete-promo'),receipt:deletedPromo({...promo,id:'receipt',type:'receipt'})},receipts:{r:receipt()}});
  await c.run('promoAutoCleanup()');
  assert.equal(august(c).meEx,0); assert.ok(c.get('trash','manual')); assert.equal(c.get('promoArchive','august'),undefined);
  assert.ok(c.get('promoArchive','receipt'));
});

test('only promotions ending before last month are archived',async()=>{
  const c=setup({promos:{august:promo,september:{...promo,id:'september',start:'2026-09-01',end:'2026-09-30'},future:{...promo,id:'future',end:'2027-01-31'}}});
  await c.run('promoAutoCleanup()');
  assert.ok(c.get('promoArchive','august')); assert.ok(c.get('promos','september')); assert.ok(c.get('promos','future'));
});

test('live edits override saved/archive copies without duplicate credit; date and item edits remain accurate',async()=>{
  const c=setup({promos:{august:promo},promoArchive:{august:{...promo,pct:15}},receipts:{r:receipt()}},'2026-09-01');
  await c.run('promoAutoCleanup()'); assert.equal(august(c).meEx,10.64);
  c.docs.set(c.path('promos','august'),{...promo,start:'2026-08-10'});c.sync();
  assert.equal(august(c).meEx,0);
  await c.run('preserveAllMonthEndSnapshots()');
  c.docs.delete(c.path('promos','august')); c.docs.delete(c.path('promoArchive','august')); c.sync();
  assert.equal(august(c).meEx,0);
  c.run("receipts[0].date='2026-08-20'; receipts[0].items[0].lineTotal=106.44");
  assert.equal(august(c).meEx,21.29);
});

test('manual deletion preservation keeps earned credit after both definitions disappear',async()=>{
  const c=setup({promos:{august:promo},receipts:{r:receipt()}});
  await c.run('preserveAllMonthEndSnapshots()');
  c.docs.delete(c.path('promos','august'));c.sync(); assert.equal(august(c).meEx,10.64);
  c.run("receipts[0].date='2026-09-01'; receipts[0].monthEndPromoSnapshots=receiptMonthEndSnapshots(receipts[0]); receipts[0].date='2026-08-06'");
  assert.equal(august(c).meEx,10.64);
});

test('archive load/read failure shows a waiting message instead of a misleading amount, without retry loop',async()=>{
  const c=setup({receipts:{r:receipt()}}); c.context.failRead=true;
  await c.run('promoAutoCleanup()');
  c.run("currentView='receiptsHistory'; document.getElementById('rcFrom').value='2026-08-01'; document.getElementById('rcTo').value='2026-08-31';");
  const n=c.callbacks.length; c.run('calcReceiptRange(false)');
  assert.match(c.node('rcRangeResult').innerHTML,/היסטוריית המבצעים טרם נטענה/);
  assert.equal(c.callbacks.length,n);
});

test('old backups preserve an absent archive; new backups restore the archived terms',async()=>{
  const c=setup({promoArchive:{august:promo},receipts:{r:receipt()}});
  c.run('setView=()=>{}; logAction=async()=>{};');
  c.context.oldBackup={backupType:'yotvata-firestore-full',collections:{receipts:{r:receipt()},promos:{}}};
  await c.run('applyBackupToCloud(oldBackup)');
  assert.ok(c.get('promoArchive','august'));
  assert.equal(august(c).meEx,10.64);
  c.context.newBackup={backupType:'yotvata-firestore-full',collections:{receipts:{r:receipt()},promos:{},promoArchive:{august:{...promo,pct:15}}}};
  await c.run('applyBackupToCloud(newBackup)');
  assert.equal(c.get('promoArchive','august').pct,15);
  assert.equal(august(c).meEx,7.98);
});

test('saving an edited receipt keeps its promotion after archive expiry and updates the amount',async()=>{
  const c=setup({promoArchive:{august:promo},receipts:{r:receipt()}},'2029-01-01');
  await c.run('promoAutoCleanup()');
  c.run("openReceiptFix('r'); receiptFix.items[0].qty=12; receiptFix.items[0].noteQty=12;");
  await c.run('saveReceiptFix()');
  const write=c.writes.find(w=>w.path?.at(-1)==='r');
  assert.equal(write.data.monthEndPromoSnapshots[0].creditEx,21.29);
});

test('concurrent extension of promotion dates prevents automatic archival',async()=>{
  const c=setup({promos:{august:{...promo,end:'2027-01-31'}}});
  await c.run("archiveExpiredPromo('august','2026-09-01')");
  assert.ok(c.get('promos','august')); assert.equal(c.get('promoArchive','august'),undefined);
});
