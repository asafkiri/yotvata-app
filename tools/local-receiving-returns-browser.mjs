import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
// Real Chromium, two isolated phone contexts. Firebase RPC is mocked; all external network is blocked.
// Receiving is local until actual confirmReceipt; returns still sync and survive receiving finalization.
const root=process.env.RETURNS_TEST_ROOT||fileURLToPath(new URL('../',import.meta.url));
const app='yotvata';
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm,'').replace(/window\.location\.href\s*=\s*([^;\n]+);/g,'window.__navigate($1);');
const documents=new Map();let transactionQueue=Promise.resolve(),releaseTransaction;
const setPath=(obj,key,val)=>{const parts=key.split('.');let p=obj;for(const k of parts.slice(0,-1)){p[k]||={};p=p[k];}if(val?.__deleteField===true)delete p[parts.at(-1)];else p[parts.at(-1)]=structuredClone(val);};
const apply=([key,val,op,opts])=>{if(op==='delete')documents.delete(key);else if(op==='update'){assert(documents.has(key),'update existing document');const current=structuredClone(documents.get(key));for(const [k,v]of Object.entries(val))setPath(current,k,v);documents.set(key,current);}else if(opts?.merge)documents.set(key,{...documents.get(key),...structuredClone(val)});else documents.set(key,structuredClone(val));};
const rpc=async(op,args={})=>{
 if(op==='begin'){const prev=transactionQueue;transactionQueue=new Promise(r=>args.release=r);await prev;releaseTransaction=args.release;return true;}
 if(op==='read')return documents.get(args.path)??null;
 if(op==='list')return [...documents].filter(([k,v])=>k.startsWith(args.prefix+'/')&&k.split('/').length===args.prefix.split('/').length+1&&(args.wheres||[]).filter(w=>w.field).every(w=>v[w.field]===w.value)).map(([k,v])=>({id:k.split('/').pop(),value:v}));
 if(op==='batch'){await transactionQueue;for(const w of args.writes)apply(w);return true;}
 if(op==='commit')for(const w of args.writes)apply(w);
 if(op==='commit'||op==='abort'){releaseTransaction();releaseTransaction=null;}
 if(op==='navigate')return {records:[...documents].filter(([k])=>k.includes('/returns/')).map(([id,data])=>({id,data}))};
 return true;
};
const setup=`
window.__offline=false;Object.defineProperty(navigator,'onLine',{get:()=>!window.__offline});
window.__navigation=[];window.__navigate=url=>{const entry={url};window.__navigation.push(entry);window.__sharedRpc('navigate').then(x=>entry.records=x.records);};window.open=url=>window.__navigate(url);
const initializeApp=()=>({}),getAuth=()=>({currentUser:{getIdToken:async()=> 'test'}}),initializeFirestore=()=>({}),getFirestore=()=>({});
const persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),signInAnonymously=async()=>({}),onAuthStateChanged=()=>{};
const doc=(_db,...p)=>p.join('/'),collection=(_db,...p)=>({collection:p.join('/')}),where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=()=>({}),query=(col,...wheres)=>({...col,wheres});
const snapshot=value=>({exists:()=>value!==null,data:()=>structuredClone(value),metadata:{fromCache:false,hasPendingWrites:false}});
const getDoc=async path=>{if(window.__offline)throw Error('offline');return snapshot(await window.__sharedRpc('read',{path}));},getDocFromServer=getDoc;
const getDocs=async q=>{const list=await window.__sharedRpc('list',{prefix:q.collection,wheres:q.wheres});return {docs:list.map(d=>({id:d.id,data:()=>structuredClone(d.value)})),metadata:{fromCache:false}};},getDocsFromServer=getDocs;
const onSnapshot=(path,opts,callback)=>{if(typeof opts==='function')callback=opts;let stopped=false,prev;
const poll=async()=>{if(stopped)return;try{if(!window.__offline){const value=path?.collection?await getDocs(path):await getDoc(path),encoded=JSON.stringify(path?.collection?value.docs.map(d=>[d.id,d.data()]):value.exists()?value.data():null);if(encoded!==prev){prev=encoded;await callback(value);}}}catch(e){window.__snapshotError=e.message;}if(!stopped)setTimeout(poll,25);};poll();return()=>stopped=true;};
const deleteField=()=>({__deleteField:true});
const runTransaction=async(_db,body)=>{if(window.__offline)throw Error('offline');await window.__sharedRpc('begin');const writes=[];try{const result=await body({get:getDoc,set:(p,v,o)=>writes.push([p,v,'set',o]),update:(p,v)=>writes.push([p,v,'update']),delete:p=>writes.push([p,null,'delete'])});await window.__sharedRpc('commit',{writes});return result;}catch(e){await window.__sharedRpc('abort');throw e;}};
const writeBatch=()=>{const writes=[];return {set:(p,v,o)=>writes.push([p,v,'set',o]),update:(p,v)=>writes.push([p,v,'update']),delete:p=>writes.push([p,null,'delete']),commit:()=>window.__sharedRpc('batch',{writes})};};
const setDoc=(p,v,o)=>window.__sharedRpc('batch',{writes:[[p,v,'set',o]]}),updateDoc=(p,v)=>window.__sharedRpc('batch',{writes:[[p,v,'update']]}),deleteDoc=p=>window.__sharedRpc('batch',{writes:[[p,null,'delete']]});
const addDoc=async(col,data)=>{const ref=col.collection+'/'+crypto.randomUUID();await setDoc(ref,data);return {id:ref.split('/').pop()};};
`;
const start=app==='tnuva'?'await startReturnsLive();':app==='yotvata'?'await startReturnEvents().start();':'await startReturnsEvents().start();';
const receivingStart=app==='berman'?'await startSharedReceiving();':'startDraftHandoffs();';
const replay=`
products=[{id:'milk',name:'מוצר בדיקה',price:5,barcode:'7290000000008'},{id:'bread',name:'מוצר שני',price:6,barcode:'7290000000015'}];promos=[];returns=[];receipts=[];
window.fetch=async()=>{window.__paid=(window.__paid||0)+1;throw Error('Unexpected paid request');};
window.t={state:()=>({items:structuredClone(returnsList),sync:returnsEvents?.state(),nav:window.__navigation,requests:window.__paid||0}),scan:id=>addReturn(id),flush:()=>returnsEvents.flush(),open:()=>openReturnsSend(),send:()=>performSend({name:'בדיקה',phone:'0500000000'}),show:()=>setView('returns'),offline:x=>{window.__offline=x;if(!x)window.dispatchEvent(new Event('online'));}};
${receivingStart}
window.t.finishReceiving=async()=>{receiptNoDoc=true;pendingReceipt={lines:receiptList.map(x=>({...x,price:5,lineTotal:x.qty*5})),ex:45,calculatedEx:45,noDoc:true,status:'open',noteParts:[]};await confirmReceipt();};window.t.receiving=()=>structuredClone(receiptList);window.t.receive=(id,n)=>{receiptOpened=true;addReceiptQtyToTop(products.find(p=>p.id===id),n);saveReceiptDraft();};
${start}setView('returns');window.t.ready=true;
`;
const css=`.hidden{display:none!important}.flex{display:flex}.fixed{position:fixed}.inset-0{inset:0}.w-full{width:100%}.flex-1{flex:1}.min-w-0{min-width:0}.flex-wrap{flex-wrap:wrap}.grid{display:grid}.grid-cols-2{grid-template-columns:1fr 1fr}.items-center{align-items:center}.justify-center{justify-content:center}.max-w-3xl{max-width:48rem}.mx-auto{margin-inline:auto}body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}img{max-width:100%}main{padding:10px}#draftHandoffBanner{padding:10px}header{padding:8px}footer{bottom:0;max-width:100%}[id$=Modal]{background:#0008;z-index:50}[id$=Modal]>div{background:white;max-height:90vh;overflow:auto;padding:16px;box-sizing:border-box}input{min-width:0}`;
const body=html.replace(/<script\s+src="https:[^"]+"><\/script>/g,'').replace(/<link[^>]+(?:href="https:[^"]+"|rel="(?:manifest|preconnect)")[^>]*>/g,'').replace(/<script type="module">[\s\S]*?<\/script>/,()=>'<script type="module">'+setup+source+replay+'</script>').replace('</head>','<style>'+css+'</style></head>');
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');const file=req.url.split('?')[0];if(file==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(body);}else if(/^\/(draft-handoff|shared-return-events|shared-receiving|local-receiving)\.js$/.test(file)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(root+file));}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.RETURNS_CHROMIUM||process.env.HANDOFF_CHROMIUM||process.env.BERMAN_CHROMIUM,args:['--no-sandbox']});const errors=[];
async function phone(){const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'he-IL'});await c.exposeBinding('__sharedRpc',(_,op,args)=>rpc(op,args));await c.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());const p=await c.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error(app,e.message);});await p.goto(url);await p.waitForFunction(()=>window.t?.ready,{},{timeout:15000});return p;}
const qty=(p,id,n)=>p.waitForFunction(([id,n])=>(window.t.state().items.find(x=>x.productId===id)?.qty||0)===n,[id,n]);
try{const a=await phone(),b=await phone();
 await a.evaluate(()=>t.receive('milk',9));await b.evaluate(()=>t.receive('bread',4));
 await new Promise(r=>setTimeout(r,350));
 assert.deepEqual(await a.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['milk',9]]);
 assert.deepEqual(await b.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['bread',4]]);
 assert.equal([...documents.keys()].some(k=>/handoff_.*_receiving|\/drafts\/receipt$|\/receipts\//.test(k)),false,'mid-receiving wrote to cloud');
 await a.reload();await a.waitForFunction(()=>window.t?.ready);
 assert.deepEqual(await a.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['milk',9]],'same-phone reload must retain receipt');
 await a.evaluate(()=>t.scan('milk'));await a.evaluate(()=>t.flush());await qty(b,'milk',1);await b.evaluate(()=>t.scan('milk'));await b.evaluate(()=>t.flush());await qty(a,'milk',2);
 await a.evaluate(()=>t.offline(true));await a.evaluate(()=>t.scan('bread'));await b.evaluate(()=>t.scan('milk'));await b.evaluate(()=>t.flush());await a.evaluate(()=>t.offline(false));await a.evaluate(()=>t.flush());await qty(a,'milk',3);await qty(b,'bread',1);
 await a.evaluate(()=>t.open());await b.evaluate(()=>t.scan('milk'));await b.evaluate(()=>t.flush());await a.evaluate(()=>t.send());await a.waitForFunction(()=>t.state().nav[0]?.records?.length===1);
 const first=[...documents].find(([k])=>k.includes('/returns/'));assert(first);assert.equal(first[1].items.find(x=>x.barcode==='7290000000008').qty,4);assert.equal(first[1].items.find(x=>x.barcode==='7290000000015').qty,1);const frozen=JSON.stringify(first);
 await qty(b,'milk',0);await b.evaluate(()=>t.scan('milk'));await b.evaluate(()=>t.flush());await qty(a,'milk',1);assert.equal(JSON.stringify([...documents].find(([k])=>k===first[0])),frozen);
 await a.evaluate(()=>t.show());for(const p of[a,b]){assert.equal(await p.evaluate(()=>t.state().requests),0);const width=await p.evaluate(()=>({scroll:document.scrollingElement.scrollWidth,client:document.scrollingElement.clientWidth}));assert(width.scroll<=width.client+1,JSON.stringify(width));}assert.deepEqual(await a.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['milk',9]]);
 assert.deepEqual(await b.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['bread',4]]);
 assert.equal([...documents.keys()].some(k=>/handoff_.*_receiving|\/drafts\/receipt$|\/receipts\//.test(k)),false,'receiving local through return send');
 await b.evaluate(()=>{t.offline(true);t.scan('bread');});
 await a.evaluate(()=>t.finishReceiving());
 assert.equal([...documents.keys()].filter(k=>/\/receipts\//.test(k)).length,1,'finish writes one receipt');
 assert.deepEqual(await a.evaluate(()=>t.receiving()),[],'only finalized local receiving clears');
 assert.deepEqual(await b.evaluate(()=>t.receiving().map(x=>[x.productId,x.qty])),[['bread',4]],'other phone receiving stays local');
 await b.evaluate(()=>t.offline(false));await b.evaluate(()=>t.flush());await qty(a,'milk',1);await qty(a,'bread',1);await qty(b,'milk',1);await qty(b,'bread',1);
 assert.equal(JSON.stringify([...documents].find(([k])=>k===first[0])),frozen,'old sent return stays immutable through receiving finalization');
 assert.equal([...documents].find(([k])=>/\/receipts\//.test(k))[1].items.find(x=>x.productId==='milk').qty,9,'finalized quantities match local count');
 assert.equal([...documents.keys()].some(k=>/handoff_.*_receiving|\/drafts\/receipt$/.test(k)),false,'no legacy receiving draft was uploaded');
 for(const p of[a,b])assert.equal(await p.evaluate(()=>t.state().requests),0,'no AI during receiving finish');
 assert.deepEqual(errors,[]);console.log(app+': שני טלפונים 390px, קליטות מקומיות נפרדות, שמירה וטעינה מקומית, אפס כתיבות קליטה בענן, התחלה מלאה, סריקות משותפות, ניתוק וחיבור, סריקה אחרי סיכום, שליחה אטומית לפני וואטסאפ, רשימה הבאה, סיום קליטה שומר החזרות וקליטה בטלפון השני, אפס AI — עבר.');
}catch(e){console.error('מסמכים',JSON.stringify([...documents],null,2).slice(0,4000));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
