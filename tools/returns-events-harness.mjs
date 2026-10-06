// מריץ את index.html המלא; רק גבולות הדפדפן והענן מדומים.
import fs from 'node:fs';
import vm from 'node:vm';
import {runtime} from './receipt-scan-harness.mjs';
import {createCloud} from '../tests/shared-return-fake.mjs';
export {createCloud};
export const root='artifacts/yotvata-app-classic/public/data/';
export const json=(p,e)=>JSON.parse(p.run('JSON.stringify('+e+')'));
export const settle=async()=>{for(let i=0;i<35;i++)await new Promise(r=>setImmediate(r));};
const copy=x=>JSON.parse(JSON.stringify(x));
export function phone(cloud=createCloud(),{storage=new Map(),online=true,clock=0,start=true}={}){
 const p=runtime('yotvata',{storage,handoff:false}),c=cloud.client(); c.setOnline(online);p.client=c;p.cloud=cloud;const listeners=[];Object.assign(p.context,c.fs);
 p.context.window.location={href:''};p.context.window.addEventListener=(name,fn)=>{listeners.push([name,fn]);};p.context.addEventListener=p.context.window.addEventListener;
 p.context.setTimeout=(fn,ms)=>{const t=setTimeout(fn,Math.min(ms||0,100000));t.unref();return t;};p.context.clearTimeout=clearTimeout;
 p.run('navigator.onLine='+online);
 p.context.testClock=clock;p.run('Date.now=(()=>{const now=Date.now;return ()=>now()+testClock;})();');
 p.run(`currentView='returns';mainMode='returns';products=testData.products;refreshReturnsList=()=>{};updateCart=()=>{};renderReceiptsHistory=()=>{};setView=()=>{};logAction=()=>{};hideSend=()=>{};renderSendModal=()=>{};showCloudBusy=()=>{};hideCloudBusy=()=>{};
 runCloudTask=async(name,task)=>{await executeCloudTask(task);return true;};runCloudTaskSilent=async(name,task)=>{try{await executeCloudTask(task);return true;}catch(e){return false;}};`);
 const html=fs.readFileSync(process.env.RECEIPT_TEST_APP||new URL('../index.html',import.meta.url),'utf8');
 if(/function startReturnEvents\(/.test(html)){
   vm.runInContext(fs.readFileSync(new URL('../shared-return-events.js',import.meta.url),'utf8'),p.context);
   if(start)p.run('startReturnEvents()');
 }else{
   const listener=html.slice(html.indexOf("  const rdRef = doc(db,"),html.indexOf('  // v288: רשימת "הוזמן באפליקציה" — משותפת',html.indexOf("  const rdRef = doc(db,")));
   if(start)p.run(listener);
 }
 p.sync=async()=>{if(p.run('typeof returnsEvents!=="undefined"&&!!returnsEvents'))await p.run('returnsEvents.flush()');else{const result=p.run('flushReturnsDraftToCloudNow()');if(c.isOnline())await result;else void result.catch(()=>{});}await settle();};
 p.online=async value=>{c.setOnline(value);p.run('navigator.onLine='+value);if(value){for(const [name,fn] of listeners)if(name==='online')fn();}await settle();};
 p.scan=(id='milk',qty=1)=>p.run('addQtyToTarget(products.find(p=>p.id==='+JSON.stringify(id)+'),'+qty+',"returns")');
 p.send=async()=>{p.run('openReturnsSend()');await p.run('performSend({name:"ספק בדיקה",phone:"0500000000"})');await settle();};
 p.stop=()=>{if(p.run('typeof returnsEvents!=="undefined"&&!!returnsEvents'))p.run('returnsEvents.stop()');else p.run('clearTimeout(returnsDraftTimer)');};
 return p;
}

// מצרף את מנגנון ההחזרות האמיתי לבדיקות עסקיות קיימות, בלי להחליף את ענן הקליטה שלהן.
export async function attachReturns(p,{legacy=true}={}) {
 const cloud=createCloud(),client=cloud.client();
 if(legacy)cloud.put(root+'drafts/returns',{items:json(p,'returnsList')});
 for(const row of json(p,'returns')){const data={...row};delete data.id;cloud.put(root+'returns/'+row.id,data);}
 p.context.deleteField=client.fs.deleteField;p.context.updateDoc??=client.fs.updateDoc;
 vm.runInContext(fs.readFileSync(new URL('../shared-return-events.js',import.meta.url),'utf8'),p.context);
 const create=p.context.SharedReturnEvents.create;
 p.context.SharedReturnEvents={create:o=>create({...o,ref:typeof o.ref==='string'?{path:o.ref}:o.ref,legacyRef:typeof o.legacyRef==='string'?{path:o.legacyRef}:o.legacyRef,recordRef:id=>{const ref=o.recordRef(id);return typeof ref==='string'?{path:ref}:ref;},fs:client.fs,db:client.db,timers:{set:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clear:clearTimeout}})};
 const original=p.run('runCloudTask');
 p.context.returnBoundary=async(label,task,opts)=>{const ok=await original(label,task,opts);if(ok&&task.path?.at(-2)==='returns'){const key=task.path.join('/');if(task.op==='update')cloud.put(key,{...cloud.get(key),...copy(task.data)});else if(task.op==='set')cloud.put(key,task.data);}return ok;};
 p.run('runCloudTask=returnBoundary');
 cloud.afterCommit=({operations})=>{for(const o of operations)if(o.path.includes('/returns/'))p.writes.push({...o,path:o.path.split('/')});};
 p.run('startReturnEvents()');await settle();p.returnCloud=cloud;p.returnClient=client;
 return {cloud,client,stop:()=>p.run('returnsEvents.stop()')};
}
