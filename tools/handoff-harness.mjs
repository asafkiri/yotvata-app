import fs from 'node:fs';
import vm from 'node:vm';
import {runtime,supplier,fixture} from './receipt-scan-harness.mjs';
import {createCloud} from '../tests/fake-firestore.mjs';
export {createCloud,supplier,fixture};
export const root='artifacts/yotvata-app-classic/public/data/';
export const path=(kind,id)=>root+'drafts/handoff_yotvata_'+kind+'_'+id;
export const settle=async()=>{await new Promise(r=>setTimeout(r,15));for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
export const json=(p,e)=>JSON.parse(p.run('JSON.stringify('+e+')'));
export function phone(cloud=createCloud(),{storage=new Map(),cache=new Map(),name='טלפון בדיקה',online=true,data=fixture(supplier),start=true,timeouts={}}={}) {
  const p=runtime(supplier,{storage,data,handoff:false}),client=cloud.client({cache});client.setOnline(online);
  p.client=client;p.cloud=cloud;p.context.queueMicrotask=queueMicrotask;
  const listeners=new Map();
  const on=(key,fn)=>{if(!listeners.has(key))listeners.set(key,[]);listeners.get(key).push(fn);};
  p.context.addEventListener=(key,fn)=>on(key,fn);
  p.context.document.addEventListener=(key,fn)=>on(key,fn);
  p.fire=key=>{for(const fn of listeners.get(key)||[])fn();};
  vm.runInContext(fs.readFileSync(new URL('../draft-handoff.js',import.meta.url),'utf8'),p.context);
  const create=p.context.DraftHandoff.create;
  p.context.DraftHandoff={create:o=>create({...o,timeouts:{debounce:1000,retry:1000,backup:250,finish:250,take:250,close:250,grace:10,settleCap:500,read:250,scanBeat:1000,...timeouts},
    timers:{set:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clear:clearTimeout}})};
  Object.assign(p.context,client.fs);p.context.__name=name;
  p.run('actionDeviceLabel=()=>__name;navigator.onLine='+online);
  if(start)p.run('startDraftHandoffs()');
  p.change=code=>p.run('handoffUserEdit=true;try{'+code+'}finally{handoffUserEdit=false;}');
  p.sync=async(kind='receiving')=>{if(kind==='receiving'){await settle();return;}p.run("draftHandoffs['"+kind+"'].flush()");await settle();for(let i=0;i<80&&p.state(kind).status==='saving';i++)await new Promise(r=>setTimeout(r,5));await settle();};
  p.take=async(id,kind='receiving')=>{const r=await p.run("draftHandoffs['"+kind+"'].take("+JSON.stringify(id)+")");await settle();return r;};
  p.state=(kind='receiving')=>json(p,"draftHandoffs['"+kind+"'].state()");
  p.online=v=>{client.setOnline(v);p.run('navigator.onLine='+v);if(v)p.fire('online');};
  p.stop=()=>p.run('Object.values(draftHandoffs).forEach(h=>h.stop())');
  p.receipt=(qty=9)=>p.change("receiptOpened=true;receiptEntryMode='manual';receiptList=structuredClone(testData.items);receiptList[0].qty="+qty+";saveReceiptDraft();");
  return p;
}
