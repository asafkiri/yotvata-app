// v421 — "אשר וקלוט" עם ניסיון שמירה תלוי, בלחיצה אמיתית: Chromium, רוחב טלפון (390px), הדף עצמו.
// שומר הלחיצות (guardDraftEvent, בשלב ה-capture) עוצר כל לחיצה בקליטה כשיש ניסיון שמירה תלוי; עד 420 הוא עצר גם את "אשר וקלוט"
// ("בקשת הסיום עדיין לא אושרה — לחץ ״בדוק ושמור שוב״ למעלה"), כשהפס שלמעלה מוסתר מאחורי חלון הסיכום. כאן הלחיצות הן לחיצות
// עכבר אמיתיות על הכפתורים שבדף — השומר והמאזין של הכפתור רצים כמו בטלפון. Firebase מוחלף ב-RPC לתהליך הזה (כמו
// ב-local-receiving-returns-browser); כל רשת חיצונית חסומה.
// מה שנבדק:
// 1. "אשר וקלוט" כשהענן לא עונה: החלון נשאר פתוח, הניסיון תלוי, שום תעודה בענן.
// 2. "אשר וקלוט" שוב, בלחיצה אמיתית: נשמרה פעם אחת, החלון נסגר, הקליטה ריקה (עד 420: הלחיצה נבלעה).
// 3. קליטה שנייה, שוב בלי תשובה, "חזרה": הפס שלמעלה — הנוסח והכפתור; כפתור אחר במסך נעצר עם ההודעה החדשה;
//    לחיצה אמיתית על "בדוק ושמור שוב" — נשמרה.
// הרצה: node tools/confirm-tap-browser.mjs (Playwright + Chromium; YOTVATA_CHROMIUM — נתיב לדפדפן; YOTVATA_TEST_ROOT — תיקיית
// אפליקציה אחרת, למשל גרסה קודמת להשוואה).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = process.env.YOTVATA_TEST_ROOT || fileURLToPath(new URL('../', import.meta.url));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm, '')
  .replace(/window\.location\.href\s*=\s*([^;\n]+);/g, 'window.__navigate($1);');

// "הענן": מסמכים בזיכרון של התהליך הזה; טרנזקציות בתור, כמו ב-local-receiving-returns-browser
const documents = new Map(); let transactionQueue = Promise.resolve(), releaseTransaction;
const rpc = async (op, args = {}) => {
  if (op === 'begin') { const prev = transactionQueue; transactionQueue = new Promise(r => args.release = r); await prev; releaseTransaction = args.release; return true; }
  if (op === 'read') return documents.get(args.path) ?? null;
  if (op === 'list') return [...documents].filter(([k]) => k.startsWith(args.prefix + '/') && k.split('/').length === args.prefix.split('/').length + 1).map(([k, v]) => ({ id: k.split('/').pop(), value: v }));
  if (op === 'batch') { await transactionQueue; for (const [key, val, kind] of args.writes) { if (kind === 'delete') documents.delete(key); else documents.set(key, structuredClone(val)); } return true; }
  if (op === 'commit') for (const [key, val, kind] of args.writes) { if (kind === 'delete') documents.delete(key); else documents.set(key, structuredClone(val)); }
  if (op === 'commit' || op === 'abort') { releaseTransaction(); releaseTransaction = null; }
  return true;
};
const setup = `
window.__navigate = () => {}; window.open = () => {};
const initializeApp=()=>({}),getAuth=()=>({currentUser:{getIdToken:async()=>'test'}}),initializeFirestore=()=>({}),getFirestore=()=>({});
const persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),signInAnonymously=async()=>({}),onAuthStateChanged=()=>{};
const doc=(_db,...p)=>p.join('/'),collection=(_db,...p)=>({collection:p.join('/')}),where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=()=>({}),query=(col,...wheres)=>({...col,wheres});
const snapshot=value=>({exists:()=>value!==null,data:()=>structuredClone(value),metadata:{fromCache:false,hasPendingWrites:false}});
const getDoc=async path=>snapshot(await window.__sharedRpc('read',{path})),getDocFromServer=getDoc;
const getDocs=async q=>{const list=await window.__sharedRpc('list',{prefix:q.collection});return {docs:list.map(d=>({id:d.id,data:()=>structuredClone(d.value)})),metadata:{fromCache:false}};},getDocsFromServer=getDocs;
const onSnapshot=()=>()=>{};
const deleteField=()=>({__deleteField:true});
// __txFail — הענן לא עונה לשמירה: הטרנזקציה נכשלת כמו נפילת רשת (unavailable), בזמן שהטלפון "מחובר"
const runTransaction=async(_db,body)=>{if(window.__txFail)throw Object.assign(new Error('unavailable'),{code:'unavailable'});await window.__sharedRpc('begin');const writes=[];try{const result=await body({get:getDoc,set:(p,v)=>writes.push([p,v,'set']),update:(p,v)=>writes.push([p,v,'set']),delete:p=>writes.push([p,null,'delete'])});await window.__sharedRpc('commit',{writes});return result;}catch(e){await window.__sharedRpc('abort');throw e;}};
const writeBatch=()=>{const writes=[];return {set:(p,v)=>writes.push([p,v,'set']),update:(p,v)=>writes.push([p,v,'set']),delete:p=>writes.push([p,null,'delete']),commit:()=>window.__sharedRpc('batch',{writes})};};
const setDoc=(p,v)=>window.__sharedRpc('batch',{writes:[[p,v,'set']]}),updateDoc=setDoc,deleteDoc=p=>window.__sharedRpc('batch',{writes:[[p,null,'delete']]});
const addDoc=async(col,data)=>{const ref=col.collection+'/'+crypto.randomUUID();await setDoc(ref,data);return {id:ref.split('/').pop()};};
`;
// (המשתנים של המודול אינם גלובליים — הבדיקה ניגשת אליהם רק דרך t)
const replay = `
products=[{id:'milk',name:'מוצר בדיקה',price:5,barcode:'7290000000008'},{id:'bread',name:'מוצר שני',price:6,barcode:'7290000000015'}];promos=[];returns=[];receipts=[];
window.fetch=async()=>{throw Error('Unexpected network request');};
window.toasts=[];{const say=showToast;showToast=(text,...rest)=>{window.toasts.push(String(text));return say(text,...rest);};}
startDraftHandoffs();
window.t={
  receive:(id,n)=>{receiptOpened=true;addReceiptQtyToTop(products.find(p=>p.id===id),n);saveReceiptDraft();},
  // חלון הסיכום של קליטה בלי תעודה — אותו pendingReceipt כמו ב-local-receiving-returns-browser, והחלון עצמו פתוח בדף
  summary:()=>{receiptNoDoc=true;pendingReceipt={lines:receiptList.map(x=>({...x,price:5,lineTotal:x.qty*5})),ex:45,calculatedEx:45,noDoc:true,status:'open',noteParts:[]};const m=$('receiptSummaryModal');m.classList.remove('hidden');m.classList.add('flex');},
  state:()=>({pending:localReceiptPending(),finalizing:receiptFinalizing||!!handoffFinalizing.receiving,summaryOpen:!$('receiptSummaryModal').classList.contains('hidden'),view:currentView,counted:receiptList.length,version:APP_VERSION}),
  fail:x=>{window.__txFail=x;},
  screen:()=>{setView('receiving');},
};
setView('receiving');window.t.ready=true;
`;
const css = `.hidden{display:none!important}.flex{display:flex}.block{display:block}.fixed{position:fixed}.inset-0{inset:0}.w-full{width:100%}.flex-1{flex:1}.min-w-0{min-width:0}.flex-wrap{flex-wrap:wrap}.grid{display:grid}.items-center{align-items:center}.justify-center{justify-content:center}.max-w-3xl{max-width:48rem}.mx-auto{margin-inline:auto}body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}img{max-width:100%}main{padding:10px}header{padding:8px}footer{bottom:0;max-width:100%}[id$=Modal]{background:#0008;z-index:50}[id$=Modal]>div{background:white;max-height:90vh;overflow:auto;padding:16px;box-sizing:border-box}input{min-width:0}`;
const body = html.replace(/<script\s+src="https:[^"]+"><\/script>/g, '').replace(/<link[^>]+(?:href="https:[^"]+"|rel="(?:manifest|preconnect)")[^>]*>/g, '')
  .replace(/<script type="module">[\s\S]*?<\/script>/, () => '<script type="module">' + setup + source + replay + '</script>').replace('</head>', '<style>' + css + '</style></head>');
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const file = req.url.split('?')[0];
  if (file === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(body); }
  else if (/^\/(draft-handoff|shared-return-events|local-receiving)\.js$/.test(file)) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, file))); }
  else { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.YOTVATA_CHROMIUM || process.env.RETURNS_CHROMIUM, args: ['--no-sandbox'] }); const errors = [];
const receiptsInCloud = () => [...documents.keys()].filter(k => /\/receipts\//.test(k));
try {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'he-IL' });
  await c.exposeBinding('__sharedRpc', (_, op, args) => rpc(op, args));
  await c.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
  const p = await c.newPage(); p.on('pageerror', e => { errors.push(e.message); });
  await p.goto(url); await p.waitForFunction(() => window.t?.ready, {}, { timeout: 15000 });
  const state = () => p.evaluate(() => t.state()), toasts = () => p.evaluate(() => window.toasts.splice(0));
  const idle = () => p.waitForFunction(() => !t.state().finalizing);
  const version = (await state()).version;

  // 1. "אשר וקלוט" כשהענן לא עונה
  await p.evaluate(() => { t.receive('milk', 9); t.summary(); t.fail(true); });
  await p.click('#rs_ok'); await idle();
  let s = await state();
  assert.equal(s.pending, true, 'הניסיון תלוי'); assert.equal(s.summaryOpen, true, 'החלון נשאר פתוח'); assert.equal(receiptsInCloud().length, 0);
  assert.match((await toasts()).join(' | '), /אין חיבור — הטיוטה נשארה בטלפון הזה\. נסה לסיים שוב כשיש רשת\./);

  // 2. הענן חזר; "אשר וקלוט" שוב — לחיצה אמיתית
  await p.evaluate(() => t.fail(false));
  await p.click('#rs_ok'); await idle();
  s = await state(); const said = (await toasts()).join(' | ');
  assert.equal(receiptsInCloud().length, 1, 'אשר וקלוט עם ניסיון תלוי: התעודה נשמרה (' + version + ': ' + said + ')');
  assert.equal(s.pending, false); assert.equal(s.summaryOpen, false, 'החלון נסגר'); assert.equal(s.counted, 0, 'הקליטה ריקה'); assert.equal(s.view, 'receiptsHistory');
  assert.equal(documents.get(receiptsInCloud()[0]).items.find(x => x.productId === 'milk').qty, 9);
  assert.doesNotMatch(said, /בקשת הסיום עדיין לא אושרה/);

  // 3. קליטה שנייה, שוב בלי תשובה; "חזרה", והפס שבראש מסך הקליטה
  await p.evaluate(() => { t.screen(); t.receive('bread', 4); t.summary(); t.fail(true); });
  await p.click('#rs_ok'); await idle();
  assert.equal((await state()).pending, true);
  await p.evaluate(() => t.fail(false)); await toasts();
  await p.click('#rs_cancel');
  assert.equal((await state()).summaryOpen, false, '"חזרה" סוגר את החלון גם בזמן נעילה');
  const bar = p.locator('#draftHandoffBanner');
  const text = (await bar.innerText()).replace(/\s+/g, ' ');
  assert.match(text, /השמירה נשלחה, ועוד לא הגיע אישור מהענן\. שום דבר לא אבד — הקליטה שמורה בטלפון הזה\. עד שהשמירה תאושר, הקליטה נעולה\./);
  const retry = bar.locator('button[data-handoff="retry-final"]');
  assert.equal((await retry.innerText()).trim(), 'בדוק ושמור שוב');
  const box = await retry.boundingBox();
  assert.ok(box.width >= 300 && box.height >= 28, 'כפתור ברוחב המסך: ' + JSON.stringify(box)); // הגובה תלוי בגופן של הסביבה
  const width = await p.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, client: document.scrollingElement.clientWidth }));
  assert.ok(width.scroll <= width.client + 1, 'בלי גלילה לצדדים: ' + JSON.stringify(width));
  // כפתור אחר במסך הקליטה — נעצר, עם השם של הכפתור כמו שהוא כתוב בפס
  await p.click('#app [data-role="rc-open-nodoc"]'); // "אין תעודה בכלל — קלוט…"
  assert.match((await toasts()).join(' | '), /הקליטה נעולה עד שהשמירה תאושר\. לחץ ״בדוק ושמור שוב״ בפס שלמעלה\./);
  assert.equal((await state()).pending, true, 'הלחיצה שנעצרה לא שינתה דבר');
  await retry.click(); await idle();
  s = await state();
  assert.equal(receiptsInCloud().length, 2, 'הקליטה השנייה נשמרה מהפס'); assert.equal(s.pending, false); assert.equal(s.counted, 0);
  assert.deepEqual(errors, []);
  console.log('יטבתה ' + version + ': Chromium 390px, לחיצות אמיתיות — "אשר וקלוט" אחרי שמירה בלי תשובה נשמרת פעם אחת והחלון נסגר; הפס שלמעלה, כפתור אחר שנעצר, ו"בדוק ושמור שוב" ששומר; בלי שגיאות דף ובלי גלילה לצדדים');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
