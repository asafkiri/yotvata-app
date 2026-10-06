/* החזרות משותפות: אירועים בלתי משתנים, תור מקומי, ושליחה אטומית.
   אין הכרעות לפי שעון הטלפון. מסמך נפרד מגן גם מפני תור SDK ישן. */
(function (g) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const clean = value => JSON.parse(JSON.stringify(value, (_k,v) => v === undefined ? null : v));
  const canonical = value => JSON.stringify(value, (_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
  const hex = value => Array.from(String(value || '')).map(c=>c.codePointAt(0).toString(16)).join('_') || '0';
  const random = () => g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID().replace(/-/g,'') : Array.from({length:5},()=>Math.random().toString(36).slice(2)).join('');
  const round = n => Math.round(n * 1000000) / 1000000;
  function create(o) {
    const fs=o.fs, slots=o.slots || ['weekly'], key=o.prefix+'_return_events_v1';
    const timers=o.timers || {set:(f,n)=>setTimeout(f,n),clear:t=>clearTimeout(t)};
    const times={write:12000,transaction:12000,retry:20000,...o.timeouts};
    const online=o.online || (()=>!g.navigator || g.navigator.onLine !== false);
    let savedDevice;try{savedDevice=o.storage.getItem(o.prefix+'_device_id');if(!savedDevice){savedDevice=random();o.storage.setItem(o.prefix+'_device_id',savedDevice);}}catch(_){}
    const device=String(o.deviceId || savedDevice || random());
    let local={pending:{},cache:null,seq:0,intents:{},mutations:{}};
    try { const x=JSON.parse(o.storage.getItem(key)||'null');if(x && x.pending)local={...local,...x}; } catch (_) {}
    let cloud=local.cache, ready=false, stopped=false, starting=null, flushing=null, sending=new Map(), unsubscribe=null, retry=null, error=null;
    let view=projection(cloud,local.pending), listeners=[];
    const empty = () => ({schemaVersion:1,app:o.app,events:{},sent:{},epochs:Object.fromEntries(slots.map(s=>[s,0])),last:{},operations:{},protectedRecords:{}});
    function persist(next) { o.storage.setItem(key,JSON.stringify(next));local=next; }
    function state() { return {ready,pending:Object.keys(local.pending).length,error:error && {code:error.code||error.name||'unavailable',message:String(error.message||error)},sending:sending.size>0}; }
    function emit() { view=projection(cloud,local.pending);if(o.onChange)o.onChange(copy(view),state()); }
    function fail(e) { error=e;emit();return false; }
    function itemKey(item) { return String(o.itemKey ? o.itemKey(item) : item.productId || item.id || item.barcode || item.name || ''); }
    function rank(e) { return [Number(e.seq)||0,String(e.device||''),String(e.eventId||'')]; }
    function newer(a,b) { if(!b)return true;const x=rank(a),y=rank(b);return x[0]!==y[0]?x[0]>y[0]:x[1]!==y[1]?x[1]>y[1]:x[2]>y[2]; }
    function remaining(data,pending={}) {
      const events={...data?.events,...pending}, reductions={};
      for(const [id,e] of Object.entries(events))if(e&&!data?.sent?.[id])for(const [source,n] of Object.entries(e.targets||{}))reductions[source]=round((reductions[source]||0)+(Number(n)||0));
      const out={};for(const [id,e] of Object.entries(events))if(e?.type==='item'&&e.delta>0&&!data?.sent?.[id])out[id]={event:e,qty:Math.max(0,round(e.delta-(reductions[id]||0))),removed:Math.min(e.delta,reductions[id]||0)};
      return out;
    }
    function projection(data,pending={}) {
      const out={slots:{},epochs:{}};const maps={};
      for(const slot of slots){out.slots[slot]={items:[],date:'',note:''};out.epochs[slot]=Number(data?.epochs?.[slot])||0;maps[slot]={rows:new Map(),date:null,note:null};}
      const events={...data?.events,...pending}, contributions=remaining(data,pending);
      for(const [id,e] of Object.entries(events)) {
        if(!e || data?.sent?.[id] || !maps[e.slot])continue;
        const m=maps[e.slot];
        if(e.type==='item') {
          const k=String(e.key),row=m.rows.get(k)||{qty:0,item:{},last:null};
          row.qty=round(row.qty+(contributions[id]?.qty||0));
          if(newer(e,row.last)){row.item=copy(e.item||{productId:k});row.last=e;}
          m.rows.set(k,row);
        } else if((e.type==='date'||e.type==='note') && newer(e,m[e.type]))m[e.type]=e;
      }
      for(const slot of slots){const m=maps[slot];out.slots[slot].items=[...m.rows.entries()].sort((a,b)=>a[0].localeCompare(b[0])).filter(([,r])=>r.qty>0).map(([,r])=>({...r.item,qty:r.qty}));out.slots[slot].date=String(m.date?.value||'');out.slots[slot].note=String(m.note?.value||'');}
      return out;
    }
    function asMap(items) {
      const m=new Map();for(const raw of items||[]){const item=clean(raw),k=itemKey(item);if(!k)throw Error('לפריט חסר מזהה');const old=m.get(k);m.set(k,{...item,qty:round((old?.qty||0)+(Number(item.qty)||0))});}return m;
    }
    function differences(slot,before,after,makeId,nextSeq,basis={}) {
      const events={},a=asMap(before.items),b=asMap(after.items);
      const add=e=>{const eventId=makeId();events[eventId]={eventId,slot,device,seq:nextSeq(),...e};};
      for(const k of new Set([...a.keys(),...b.keys()])) {
        const x=a.get(k),y=b.get(k),delta=round((Number(y?.qty)||0)-(Number(x?.qty)||0));
        const item=copy(y||x),old=copy(x||{});delete item.qty;delete old.qty;
        if(delta || (y && canonical(item)!==canonical(old))) {
          const targets={};let left=-delta;
          if(delta<0)for(const [id,r] of Object.entries(basis).sort(([a],[b])=>a.localeCompare(b))) {
            if(r.event.slot!==slot||r.event.key!==k||!(r.qty>0))continue;
            const take=Math.min(left,r.qty);if(take>0){targets[id]=round(take);left=round(left-take);}if(left<=0)break;
          }
          add({type:'item',key:k,delta,item,...(delta<0?{targets}:{})});
        }
      }
      for(const type of ['date','note'])if(String(after[type]||'')!==String(before[type]||''))add({type,value:String(after[type]||'')});
      return events;
    }
    function maxSequence(data) {return Math.max(0,...Object.values(data?.events||{}).map(e=>Number(e.seq)||0),Number(data?.seq)||0,Number(local.seq)||0);}
    function accept(data) {
      if(!data || data.schemaVersion!==1 || data.app!==o.app)return;
      // האירועים והמצבות רק נוספים: תשובת טרנזקציה ישנה אינה מוחקת snapshot חדש.
      const merged={...copy(data),events:{...cloud?.events,...data.events},sent:{...cloud?.sent,...data.sent},operations:{...cloud?.operations,...data.operations},protectedRecords:{...cloud?.protectedRecords,...data.protectedRecords},epochs:{...data.epochs},last:{...data.last}};
      for(const slot of slots)if((Number(cloud?.epochs?.[slot])||0)>(Number(merged.epochs[slot])||0)){merged.epochs[slot]=cloud.epochs[slot];merged.last[slot]=cloud.last?.[slot]||null;}
      for(const id of Object.keys(merged.sent))delete merged.events[id];
      cloud=merged;data=merged;ready=true;error=null;
      const pending={...local.pending};
      for(const [id,e] of Object.entries(pending))if(data.sent?.[id] || canonical(data.events?.[id])===canonical(e))delete pending[id];
      const next={...local,pending,cache:cloud,seq:maxSequence(data)};
      try {persist(next);}catch(e){error=e;} // אין אישור מקומי אם שמירתו נכשלה; retry של אירוע בטוח.
      emit();
    }
    async function bounded(work,ms) {
      let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=timers.set(()=>reject(Object.assign(Error('החיבור מתעכב'),{code:'deadline-exceeded'})),ms);})]);}finally{timers.clear(timer);}
    }
    async function transaction(fn) {
      if(!online())throw Object.assign(Error('אין חיבור לענן'),{code:'unavailable'});
      let cancelled=false,timer;
      const check=()=>{if(cancelled||stopped)throw Object.assign(Error('הפעולה נעצרה לפני הכתיבה'),{code:'cancelled'});};
      try {
        return await Promise.race([fs.runTransaction(o.db,async tx=>{
          check();const guarded={get:async ref=>{const x=await tx.get(ref);check();return x;},set:(...a)=>{check();return tx.set(...a);},update:(...a)=>{check();return tx.update(...a);},delete:(...a)=>{check();return tx.delete(...a);}};
          const result=await fn(guarded,check);check();return result;
        },{maxAttempts:5}),new Promise((_,reject)=>{timer=timers.set(()=>{cancelled=true;reject(Object.assign(Error('ממתין לאישור הענן; אפשר לנסות שוב בבטחה'),{code:'deadline-exceeded'}));},times.transaction);})]);
      } finally {cancelled=true;timers.clear(timer);}
    }
    function write(tx,w) { if(w.op==='delete')tx.delete(w.ref);else if(w.op==='update')tx.update(w.ref,w.data);else tx.set(w.ref,w.data); }
    async function initialize() {
      const result=await transaction(async tx=>{
        const snap=await tx.get(o.ref);if(snap.exists())return snap.data();
        const legacySnap=o.legacyRef?await tx.get(o.legacyRef):null;
        const legacy=o.legacy?await o.legacy(tx,legacySnap?.exists()?legacySnap.data():null):{slots:{}};
        const data=empty();let n=0;
        for(const slot of slots){const s=legacy?.slots?.[slot]||{items:[]},draft=s.draftId||('legacy_'+o.app+'_'+slot);
          const makeId=()=> 'migr_'+hex(draft)+'_'+hex(slot)+'_'+(++n);
          const events=differences(slot,{items:[],date:'',note:''},s,makeId,()=>0);
          // מפתחות הגירה קבועים לפי מוצר; מטא־נתונים לפי סוג.
          for(const e of Object.values(events)){e.eventId='migr_'+hex(draft)+'_'+hex(slot)+'_'+e.type+'_'+hex(e.type==='item'?e.key:e.type);e.device='migration';e.seq=0;data.events[e.eventId]=e;}
        }
        data.seq=0;for(const w of legacy?.writes||[])write(tx,w);tx.set(o.ref,data);return data;
      });
      accept(result);return true;
    }
    function schedule() {
      if(retry||stopped)return;retry=timers.set(()=>{retry=null;if(stopped)return;start().then(()=>flush()).catch(fail).finally(schedule);},times.retry);
      if(retry?.unref)retry.unref();
    }
    function wake(){if(!stopped)start().then(()=>flush()).catch(fail);}
    async function start() {
      if(stopped)return false;
      if(!unsubscribe){emit();unsubscribe=fs.onSnapshot(o.ref,{includeMetadataChanges:true},snap=>{
        if(snap.metadata?.fromCache || snap.metadata?.hasPendingWrites)return;
        if(snap.exists()){accept(snap.data());if(Object.keys(local.pending).length)void flush();}
      },fail);
        const add=(target,event,fn)=>{if(target?.addEventListener){target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener?.(event,fn));}};
        add(g,'online',wake);add(g.document,'visibilitychange',()=>{if(!g.document.hidden)wake();});schedule();
      }
      if(ready)return true;if(starting)return starting;if(!online())return false;
      starting=initialize().catch(fail).finally(()=>{starting=null;});return starting;
    }
    function change(slot,next) {
      if(stopped||!slots.includes(slot))return false;
      try {
        let seq=maxSequence(cloud);const events=differences(slot,view.slots[slot],next,()=>random(),()=>++seq,remaining(cloud,local.pending));
        if(!Object.keys(events).length)return true;
        persist({...local,pending:{...local.pending,...events},seq});error=null;emit();void flush();return true;
      }catch(e){return fail(e);}
    }
    async function flush() {
      if(stopped||!online())return false;if(flushing)return flushing;
      flushing=(async()=>{
        if(!ready && !await start())return false;
        for(let i=0;i<20;i++){
          const pending=copy(local.pending),ids=Object.keys(pending);if(!ids.length)return true;
          const patch={};for(const id of ids)patch['events.'+id]=pending[id];
          await bounded(fs.updateDoc(o.ref,patch),times.write);
          // updateDoc resolves only on server acknowledgement. A snapshot may have already removed these.
          const nextPending={...local.pending};for(const id of ids)if(canonical(nextPending[id])===canonical(pending[id]))delete nextPending[id];
          const nextCloud=copy(cloud||empty());for(const id of ids)if(!nextCloud.sent?.[id])nextCloud.events[id]=pending[id];
          persist({...local,pending:nextPending,cache:nextCloud});cloud=nextCloud;error=null;emit();
        }
        return Object.keys(local.pending).length===0;
      })().catch(fail).finally(()=>{flushing=null;});return flushing;
    }
    async function finish(slot,buildRecord,opts={}) {
      if(sending.has(slot))return {ok:false,busy:true};
      const wanted=opts.expectedEpoch===undefined?view.epochs[slot]:opts.expectedEpoch;
      const job=(async()=>{
        if(!slots.includes(slot))throw Error('רשימה לא מוכרת');
        if(!await start() || !await flush())return {ok:false};
        let intent=local.intents[slot];
        if(!intent){intent={id:'return_'+random(),epoch:Number(wanted)||0};persist({...local,intents:{...local.intents,[slot]:intent}});}
        const result=await transaction(async tx=>{
          const snap=await tx.get(o.ref),recordRef=o.recordRef(intent.id),recordSnap=await tx.get(recordRef);
          if(!snap.exists())throw Error('מסמך האירועים חסר');const data=snap.data();
          if(recordSnap.exists()){const previous=recordSnap.data();if(previous.returnEventSend?.app!==o.app||previous.returnEventSend?.slot!==slot||previous.returnEventSend?.epoch!==intent.epoch)throw Error('המזהה כבר שייך לתעודה אחרת');return {ok:true,id:intent.id,record:previous,recovered:true,data};}
          if((Number(data.epochs?.[slot])||0)!==intent.epoch)return {ok:true,already:true,id:data.last?.[slot]||null,data};
          const actual=projection(data).slots[slot],ids=Object.entries(data.events||{}).filter(([id,e])=>e.slot===slot&&!data.sent?.[id]).map(([id])=>id);
          if(!actual.items.length)return {ok:false,empty:true,data};
          const record=clean(buildRecord(copy(actual),intent.id));if(!record || !Array.isArray(record.items) || !record.items.length)throw Error('אין שורות לשמירה');
          record.returnEventSend={app:o.app,slot,epoch:intent.epoch};
          const patch={['epochs.'+slot]:intent.epoch+1,['last.'+slot]:intent.id};
          const next=copy(data);next.sent={...next.sent};next.epochs={...next.epochs,[slot]:intent.epoch+1};next.last={...next.last,[slot]:intent.id};
          for(const id of ids){patch['sent.'+id]=intent.id;patch['events.'+id]=fs.deleteField();next.sent[id]=intent.id;delete next.events[id];}
          tx.set(recordRef,record);tx.update(o.ref,patch);return {ok:true,id:intent.id,record,data:next};
        });
        accept(result.data);const intents={...local.intents};delete intents[slot];
        try{persist({...local,intents});}catch(e){error=e;}
        const {data,...out}=result;emit();return out;
      })().catch(e=>{fail(e);return {ok:false,error:String(e.message||e)};}).finally(()=>{sending.delete(slot);emit();});
      sending.set(slot,job);emit();return job;
    }
    async function mutate(refs,build,opts={}) {
      try {
        if(!await start() || !await flush())return {ok:false};
        const operationKey=String(opts.key || random()),id='op_'+hex(operationKey);
        const result=await transaction(async tx=>{
          const snap=await tx.get(o.ref);if(!snap.exists())throw Error('מסמך האירועים חסר');const data=snap.data();
          if(data.operations?.[id])return {ok:true,already:true,mutationId:id,result:data.operations[id].result,data};
          const snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
          const plan=await build(snaps,copy(projection(data)));if(!plan)return {ok:false};
          let seq=maxSequence(data),index=0;const events={};
          for(const [slot,next] of Object.entries(plan.changes||{}))Object.assign(events,differences(slot,projection(data).slots[slot],next,()=>id+'_'+(++index),()=>++seq,remaining(data)));
          const out=clean(plan.result===undefined?null:plan.result),protectedRecords={...data.protectedRecords},patch={['operations.'+id]:{result:out},seq};
          // גם גיבוי ישן מלפני העברה לרשימה אינו רשאי להחיות את תעודת המקור.
          for(const w of plan.writes||[]){const path=typeof w.ref==='string'?w.ref:String(w.ref?.path||'');const parts=path.split('/');if(parts.at(-2)==='returns')protectedRecords[parts.at(-1)]=id;}
          patch.protectedRecords=protectedRecords;
          for(const [eid,e] of Object.entries(events))patch['events.'+eid]=e;
          for(const w of plan.writes||[])write(tx,w.op==='delete'?w:{...w,data:{...w.data,returnEventMutationId:id}});tx.update(o.ref,patch);
          const next={...data,seq,protectedRecords,events:{...data.events,...events},operations:{...data.operations,[id]:{result:out}}};
          return {ok:true,mutationId:id,result:out,data:next};
        });
        if(result.data)accept(result.data);const {data,...out}=result;return out;
      }catch(e){fail(e);return {ok:false,error:String(e.message||e)};}
    }
    function stop(){stopped=true;unsubscribe?.();timers.clear(retry);listeners.forEach(f=>f());listeners=[];}
    return {start,change,flush,finish,mutate,view:()=>copy(view),state,epoch:slot=>view.epochs[slot]||0,stop};
  }
  g.SharedReturnEvents={create};
})(typeof globalThis!=='undefined'?globalThis:window);
