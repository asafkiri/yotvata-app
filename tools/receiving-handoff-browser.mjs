// שני טלפונים, 390px, בלי חיבור לשירותי החנות ובלי AI בתשלום.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm,'');
const documents=new Map();
let transactionQueue = Promise.resolve(), releaseTransaction;
const rpc = async (operation, args = {}) => {
  if (operation === 'begin') {
    const previous = transactionQueue;
    transactionQueue = new Promise(resolve => { args.release = resolve; });
    await previous; releaseTransaction = args.release; return true;
  }
  if (operation === 'read') return documents.get(args.path) ?? null;
  if (operation === 'list') return [...documents.entries()].filter(([k, v]) => k.startsWith(args.prefix + '/') && k.split('/').length === args.prefix.split('/').length + 1
    && v && (args.wheres || []).every(w => v[w.field] === w.value)).map(([k, v]) => ({ id: k.split('/').pop(), value: v }));
  if (operation === 'commit' || operation === 'batch') {
    for (const [path, value, op] of args.writes) { if (op === 'delete') documents.delete(path); else documents.set(path, structuredClone(value)); }
  }
  if (operation === 'commit' || operation === 'abort') { releaseTransaction(); releaseTransaction = null; }
  return true;
};
const setup = `
const initializeApp = () => ({}), getAuth = () => ({currentUser:{getIdToken:async()=> 'test'}});
const initializeFirestore = () => ({}), getFirestore = () => ({});
const persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({});
const signInAnonymously = async () => ({}), onAuthStateChanged = () => {};
const doc = (_db, ...path) => path.join('/');
const collection = (_db, ...path) => ({ collection: path.join('/') });
const where = (field, op, value) => ({ field, op, value });
const query = (col, ...wheres) => ({ collection: col.collection, wheres });
const snapshot = value => ({exists:()=>value!==null,data:()=>structuredClone(value),metadata:{fromCache:false,hasPendingWrites:false}});
const getDoc = async path => snapshot(await window.__sharedRpc('read',{path}));
const getDocFromServer = getDoc;
const onSnapshot = (path, opts, callback) => {
  if (typeof opts === 'function') { callback = opts; }
  let stopped=false, previous;
  const poll=async()=>{
    if(stopped)return;
    if (path && path.collection) {
      const list=await window.__sharedRpc('list',{prefix:path.collection,wheres:path.wheres}), encoded=JSON.stringify(list);
      if(encoded!==previous){previous=encoded;await callback({docs:list.map(d=>({id:d.id,data:()=>structuredClone(d.value)})),metadata:{fromCache:false}});}
      if(!stopped)setTimeout(poll,30);
      return;
    }
    const value=await window.__sharedRpc('read',{path}), encoded=JSON.stringify(value);
    if(encoded!==previous){previous=encoded;await callback(snapshot(value));}
    if(!stopped)setTimeout(poll,30);
  };poll();return()=>{stopped=true};
};
const runTransaction = async(_db,body)=>{
  await window.__sharedRpc('begin'); const writes=[];
  try{const value=await body({get:getDoc,set:(path,value)=>writes.push([path,value]),delete:path=>writes.push([path,null,'delete'])});await window.__sharedRpc('commit',{writes});return value;}
  catch(error){await window.__sharedRpc('abort');throw error;}
};
const writeBatch=()=>{const writes=[];return{set:(path,value)=>writes.push([path,value]),commit:()=>window.__sharedRpc('batch',{writes})};};
const setDoc=(path,value)=>window.__sharedRpc('batch',{writes:[[path,value]]});
const deleteDoc=path=>window.__sharedRpc('batch',{writes:[[path,null,'delete']]});
`;
const replay=`
products=[{id:'milk',name:'מוצר בדיקה',price:5,barcode:'7290000000008'}];promos=[];
aiRunAnalyzer=async()=>{};openReceivingScanner=()=>{};
window.t={state:()=>({id:receiptDraftId,items:receiptList,away:draftHandoffs.receiving.state().away,requests:window.__paid||0}),
 begin:()=>{receiptOpened=true;receiptNoDoc=true;receiptEntryMode='manual';receiptList=[{productId:'milk',name:'מוצר בדיקה',qty:9}];saveReceiptDraft();setView('receiving');},
 flush:()=>draftHandoffs.receiving.flush()};
window.fetch=async()=>{window.__paid=(window.__paid||0)+1;throw Error('Unexpected paid request');};
setView('receiving');startDraftHandoffs();window.t.ready=true;
`;
const css=`.hidden{display:none!important}.flex{display:flex}.fixed{position:fixed}.inset-0{inset:0}.w-full{width:100%}.flex-1{flex:1}.min-w-0{min-width:0}.flex-wrap{flex-wrap:wrap}.grid{display:grid}.grid-cols-2{grid-template-columns:1fr 1fr}.items-center{align-items:center}.justify-center{justify-content:center}.max-w-3xl{max-width:48rem}.mx-auto{margin-inline:auto}body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}img{max-width:100%}main{padding:10px}#draftHandoffBanner{padding:10px}header{padding:8px}footer{bottom:0;max-width:100%}[id$=Modal]{background:#0008;z-index:50}[id$=Modal]>div{background:white;max-height:90vh;overflow:auto;padding:16px;box-sizing:border-box}input{min-width:0}`;
const body=html.replace(/<script\s+src="https:[^"]+"><\/script>/g,'').replace(/<link[^>]+(?:href="https:[^"]+"|rel="(?:manifest|preconnect)")[^>]*>/g,'')
 .replace(/<script type="module">[\s\S]*?<\/script>/,()=>'<script type="module">'+setup+moduleSource+replay+'</script>').replace('</head>','<style>'+css+'</style></head>');
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/draft-handoff.js')){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(new URL('../draft-handoff.js',import.meta.url)));}else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(body);}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.HANDOFF_CHROMIUM,args:['--no-sandbox']});
const errors=[];
async function phone(){const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'he-IL'});await context.exposeBinding('__sharedRpc',(_,op,args)=>rpc(op,args));await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.t?.ready);return page;}
try{
 const a=await phone(),b=await phone();await a.evaluate(()=>window.t.begin());
 for(let i=0;i<5;i++)await a.locator('[data-role="rc-minus"][data-id="milk"]').click();
 assert.equal(await a.evaluate(()=>window.t.state().items[0].qty),4);await a.evaluate(()=>window.t.flush());
 await b.locator('[data-handoff="take"]').click();await a.waitForFunction(()=>window.t.state().away?.away==='moved');
 assert.equal(await b.evaluate(()=>window.t.state().items[0].qty),4);assert.equal(await b.evaluate(()=>window.t.state().requests),0);
 await a.locator('[data-role="rc-minus"][data-id="milk"]').click();assert.equal(await a.evaluate(()=>window.t.state().items[0].qty),4);
 await a.reload();await a.waitForFunction(()=>window.t?.state().away?.away==='moved');
 await b.locator('#cartBtn').click();await b.locator('#rs_ok').click();await a.waitForFunction(()=>window.t.state().away?.away==='saved');
 assert.equal([...documents.keys()].filter(k=>k.includes('/receipts/')).length,1);
 await a.locator('[data-handoff="clear"]').click();await a.locator('#confirmOk').click();await a.waitForFunction(()=>!window.t.state().id);
 for(const p of [a,b])assert.equal(await p.evaluate(()=>document.scrollingElement.scrollWidth<=document.scrollingElement.clientWidth+1),true,'390px without horizontal overflow');
 assert.deepEqual(errors,[]);console.log('שני טלפונים: 9→4, העברה, חסימה, פתיחה מחדש, שמירה אחת וניקוי — עבר. אפס AI.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
