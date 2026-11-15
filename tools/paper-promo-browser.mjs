// v418 — "פתח מבצע" (מבצע שבתעודה ואינו במערכת) בדפדפן אמיתי (Chromium, רוחב טלפון 390px), בלי רשת חיצונית ובלי Firebase — כמו
// line-check-scan-browser.mjs. הקליטה נבנית קודם בקוד של האפליקציה עצמה (receipt-scan-harness: תעודה של 4 שורות, באחת מהן הנייר נותן
// 40% שאין במערכת) ונכנסת לדפדפן דרך הטיוטה שבזיכרון הטלפון; התעודה השמורה — מהכתיבה של אותה קליטה. מה שנבדק בדום אמיתי:
// 1. הרשימה שורה-שורה: ההודעה על שורת המוצר, והכפתור "פתח מבצע" — יעד מגע של 44px בתוך הכרטיס. לחיצה אמיתית פותחת את החלון מעל
//    חלון הבדיקה (הכפתור שלו הוא מה שנמצא מתחת לאצבע), עם 40%, התאריכים והשם; הפוקוס על הכפתור ולא על שדה. הקלדת אחוז אחר בשדה
//    אמיתי — אזהרה ו"פתח בכל זאת"; החזרה ל-40 מנקה. "פתח מבצע" סוגר את החלון, והשורה מאשרת; הסימונים שנעשו נשארים.
// 2. בלי לפתוח: "סיום" → מסך ההשוואה עם הקבוצה והכפתור היחיד; "המשך בלי לפתוח" → חלון הסיכום עם ההודעה; "פתח מבצע" משם — החלון
//    מעל הסיכום; אחרי השמירה הסיכום נסגר ו"הכול תואם — המשך" מוצג.
// 3. התעודה השמורה: הכרטיס נפתח בלחיצה; "מה לעשות עכשיו" וההודעה על שורת המוצר; "פתח מבצע" מהשורה → אחרי השמירה הכרטיס נשאר פתוח,
//    "אומתה", והשורה מראה "מבצע 40%".
// בכל הדפים: בלי שגיאות דף ובלי גלילה לצדדים.
// הרצה: node tools/paper-promo-browser.mjs (Playwright + Chromium; YOTVATA_CHROMIUM — נתיב לדפדפן, YOTVATA_SHOTS — תיקייה לצילומי מסך; שניהם אופציונליים)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('../', import.meta.url));
const products = [
  { id: 'milk', name: 'חלב 3% בקרטון 1 ליטר', code: '8', barcode: '7290000000008', price: 5, posPrice: 6.9 },
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7, posPrice: 9.9 },
  { id: 'choco', name: 'שוקו 1 ליטר', code: '22', barcode: '7290000000022', price: 8.86, posPrice: 12.9 },
  { id: 'avocado', name: 'ממרח אבוקדו 200', code: '39', barcode: '7290000000039', price: 11.89, posPrice: 19.9, boxSize: 8 },
  { id: 'tahini', name: 'טחינה 400 גרם', code: '46', barcode: '7290000000046', price: 8.17, posPrice: 12.9 }
];
const NOV = { start: '2026-11-01', end: '2026-11-30', minUnit: 'unit', cartonSize: null, type: 'receipt' };
const promos = [{ id: 'p-choco', name: 'משקאות חלב ליטר', pct: 15, minQty: 12, productIds: ['choco'], ...NOV }, { id: 'p-tahini', name: 'טחינה 400', pct: 18, minQty: 6, productIds: ['tahini'], ...NOV }];
const r2 = n => Math.round(n * 100) / 100;
const EVIDENCE = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber', 'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
// כמו ב-paper-promo.test.mjs: מחיר היחידה המלא, ברוטו, ונטו אחרי ההנחה, עם כוכבית; השורות כפי שהשירות מחזיר כשהקריאות הסכימו
function paper(spec) {
  const rows = spec.map(([id, q, pct = 0], i) => { const p = products.find(x => x.id === id), gross = r2(q * p.price);
    const row = { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'model_consensus',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: p.price, grossLineTotalExVat: gross, lineTotalExVat: r2(gross * (1 - pct / 100)), lineDiscountExVat: null, promotionText: pct ? '*' : null, confidence: .99 };
    row.modelVerification = { version: 1, status: 'verified', selectedRead: 2, strongSelected: true, identity: { productId: p.id, barcode: p.barcode }, identitySupport: [0, 1], issues: [],
      evidence: Object.fromEntries(EVIDENCE.map(k => [k, row[k] ?? null])) };
    return row; });
  const net = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-15', docNumber: '407300217817', invoiceNumber: '407300217817', docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: net, netToChargeExVat: net, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: net, promoDiscountExVat: 0, documentDiscountExVat: null, warnings: [] };
}
const NOTE = paper([['milk', 12], ['cottage', 6], ['choco', 12, 15], ['avocado', 8, 40]]);
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(res => setImmediate(res)); };

// 1. הקליטה נבנית בקוד של האפליקציה (node): הטיוטה שלה — מה שהטלפון שומר — עוברת לדפדפן; וקליטה שנסגרה בלי לפתוח את המבצע נותנת את התעודה השמורה
async function build(finish) {
  const storage = new Map(), cloud = fakeCloud();
  const c = runtime('yotvata', { storage, cloud, data: { products, promos: structuredClone(promos), items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p0', scan: { warnings: [], documents: [structuredClone(NOTE)] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-15'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true; showConfirm = (t, m, l, cb) => cb();
    aiScanDocuments = [{ noteIndex: 0, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVIw', orientationConfirmed: true }] }];`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  c.run('startReceiptLineCheck()');
  assert.equal(c.run('receiptQuantityReview.mode'), 'lines');
  let saved = null;
  if (finish) {
    for (let k = 0; k < 4; k++) c.run(`receiptLineCheckClick({ target: { closest: () => ({ dataset: { lineMark: '0:${k}:ok' } }) } })`);
    c.run('finishReceiptLineCheck()'); await settle();
    c.click('ai-apply'); await settle();
    await c.run('confirmReceipt()'); await settle();
    const w = c.writes.find(x => x.op === 'set' && x.path.includes('receipts'));
    assert.ok(w, 'התעודה נשמרה'); assert.equal(w.data.status, 'open');
    saved = { id: w.path[w.path.length - 1], ...structuredClone(w.data) };
  }
  c.run('Object.values(draftHandoffs).forEach(h => h.stop())');
  return { storage, saved };
}

// 2. הדף: index.html בלי הסקריפטים החיצוניים (Tailwind, גופנים, Firebase), עם תחליפים ל-Firebase ו-CSS מינימלי (כולל שכבות ה-z של החלונות)
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm, '');
const setup = `
const initializeApp = () => ({}), getAuth = () => ({}), signInAnonymously = async () => ({}), onAuthStateChanged = () => {};
const initializeFirestore = () => ({}), getFirestore = () => ({}), persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({});
const collection = () => ({}), onSnapshot = () => () => {}, doc = () => ({}), getDoc = async () => ({ exists: () => false, data: () => null }), getDocFromServer = getDoc;
window.cloudWrites = [];
const deleteDoc = async () => {}, addDoc = async () => ({ id: 'x' }), updateDoc = async () => {}, setDoc = async (ref, data) => { window.cloudWrites.push(['set', data]); };
const writeBatch = () => ({ set() {}, update(ref, data) { window.cloudWrites.push(['update', data]); }, delete() {}, commit: async () => {} });
const query = () => ({}), orderBy = () => ({}), limit = () => ({}), getDocs = async () => ({ docs: [] }), getDocsFromServer = getDocs, where = () => ({}), runTransaction = async () => {}, deleteField = () => ({});
`;
const css = `.hidden{display:none!important}.flex{display:flex}.grid{display:grid}.block{display:block}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}
.inset-0{inset:0}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}.top-0{top:0}.flex-col{flex-direction:column}.flex-1{flex:1}.flex-\\[1\\.4\\]{flex:1.4}.items-center{align-items:center}.items-start{align-items:flex-start}.items-stretch{align-items:stretch}.justify-center{justify-content:center}.justify-between{justify-content:space-between}
.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}.min-h-0{min-height:0}.min-w-0{min-width:0}.shrink-0{flex-shrink:0}.w-full{width:100%}.h-full{height:100%}.max-w-lg{max-width:32rem}.max-w-sm{max-width:24rem}.max-w-3xl{max-width:48rem}.mx-auto{margin-left:auto;margin-right:auto}
.max-h-\\[92vh\\]{max-height:92vh}.max-h-\\[88vh\\]{max-height:88vh}.max-h-56{max-height:14rem}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.whitespace-nowrap{white-space:nowrap}
.gap-1{gap:.25rem}.gap-1\\.5{gap:.375rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.p-2\\.5{padding:.625rem}.p-3{padding:.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.px-2\\.5{padding-left:.625rem;padding-right:.625rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.px-5{padding-left:1.25rem;padding-right:1.25rem}.py-1\\.5{padding-top:.375rem;padding-bottom:.375rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.pt-4{padding-top:1rem}.pb-4{padding-bottom:1rem}
.mt-1\\.5{margin-top:.375rem}.mt-2{margin-top:.5rem}.mt-3{margin-top:.75rem}.mb-2\\.5{margin-bottom:.625rem}.mb-24{margin-bottom:6rem}
.grid-cols-\\[1\\.15fr_1fr\\]{grid-template-columns:1.15fr 1fr}.grid-cols-\\[1fr_auto_auto\\]{grid-template-columns:1fr auto auto}
.bg-white{background:#fff}.bg-black{background:#000}.bg-slate-50{background:#f8fafc}.bg-slate-100{background:#f1f5f9}.bg-indigo-600{background:#4f46e5;color:#fff}.bg-emerald-600{background:#059669;color:#fff}.bg-amber-500{background:#f59e0b;color:#fff}.bg-slate-400{background:#94a3b8}.bg-blue-600{background:#2563eb}.bg-rose-600{background:#e11d48}.bg-rose-50{background:#fff1f2}.bg-violet-600{background:#7c3aed}.bg-green-600{background:#16a34a}.bg-slate-900\\/60{background:rgba(15,23,42,.6)}
.rounded-2xl{border-radius:1rem}.rounded-3xl{border-radius:1.5rem}.rounded-xl{border-radius:.75rem}.rounded-lg{border-radius:.5rem}.border-2{border:2px solid #cbd5e1}.border{border:1px solid #cbd5e1}.border-emerald-300{border-color:#6ee7b7}.bg-emerald-50{background:#ecfdf5}.border-amber-300{border-color:#fcd34d}.bg-amber-50{background:#fffbeb}.border-rose-300{border-color:#fda4af}
.text-3xl{font-size:1.875rem}.text-lg{font-size:1.125rem}.text-xs{font-size:.75rem}.text-sm{font-size:.875rem}.text-\\[11px\\]{font-size:11px}.text-\\[13px\\]{font-size:13px}.font-black{font-weight:900}.font-bold{font-weight:700}.text-white{color:#fff}.text-center{text-align:center}.text-right{text-align:right}.text-rose-700{color:#be123c}
.min-h-\\[44px\\]{min-height:44px}.min-h-\\[48px\\]{min-height:48px}.min-h-\\[52px\\]{min-height:52px}.w-24{width:6rem}.w-10{width:2.5rem}.h-10{height:2.5rem}.top-2{top:.5rem}.left-2{left:.5rem}.ring-4{box-shadow:0 0 0 4px #93c5fd}
.z-20{z-index:20}.z-30{z-index:30}.z-40{z-index:40}.z-50{z-index:50}.z-\\[55\\]{z-index:55}.z-\\[60\\]{z-index:60}.z-\\[65\\]{z-index:65}.z-\\[70\\]{z-index:70}.z-\\[90\\]{z-index:90}.z-\\[100\\]{z-index:100}
body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}details>summary{list-style:none;cursor:pointer}`;
function pageFor(view, receipts) {
  const replay = `
products = ${JSON.stringify(products)}; promos = ${JSON.stringify(promos)}; receipts = ${JSON.stringify(receipts || [])}; returns = [];
todayStr = () => '2026-11-15';
window.fetch = async url => { throw new Error('External network is forbidden in the browser check: ' + url); };
setView(${JSON.stringify(view)});
// (המשתנים של המודול אינם גלובליים — הבדיקה ניגשת אליהם רק דרך t)
window.t = { start: () => startReceiptLineCheck(), mode: () => receiptQuantityReview && receiptQuantityReview.mode, marks: () => receiptQuantityReview.docs.map(d => d.lines.map(l => l.mark).join(',')),
  sheet: () => paperPromoSheet && { pct: paperPromoSheet.pct, start: paperPromoSheet.start, end: paperPromoSheet.end, name: paperPromoSheet.name, receiptId: paperPromoSheet.receiptId, force: paperPromoSheet.force },
  promos: () => promos.filter(p => p.productIds.includes('avocado')), paper: () => receiptPaperPromos().length, view: () => currentView, step: () => rcStep,
  pending: () => pendingReceipt && { status: pendingReceipt.status, pct: pendingReceipt.lines.find(l => l.productId === 'avocado').promoPct }, receipts: () => receipts.map(r => [r.status, r.items.find(l => l.productId === 'avocado').promoPct]) };
window.t.loaded = true;
`;
  return html.replace(/<script\s+src="https:[^"]+"><\/script>/g, '').replace(/<link[^>]+(?:href="https:[^"]+"|rel="manifest")[^>]*>/g, '')
    .replace(/<script type="module">[\s\S]*?<\/script>/, () => '<script type="module">' + setup + moduleSource + replay + '</script>')
    .replace('</head>', '<style>' + css + '</style></head>');
}
let pageHtml = '';
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const file = req.url === '/' ? null : path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(pageHtml); return; }
  if (/\.js$/.test(file) && fs.existsSync(file) && !/sw\.js$/.test(file)) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(file)); return; }
  res.statusCode = 404; res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.YOTVATA_CHROMIUM, args: ['--no-sandbox'] });
const shots = process.env.YOTVATA_SHOTS;
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
async function open(view, { storage = new Map(), receipts = [] } = {}) {
  pageHtml = pageFor(view, receipts);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'he-IL' });
  await context.addInitScript(entries => { for (const [k, v] of entries) localStorage.setItem(k, v); }, [...storage.entries()]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e && e.stack || e)));
  // (sw.js אינו מוגש כאן בכוונה — הודעת ה-404 של רישום ה-service worker אינה שגיאה של הבדיקה)
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|favicon|bad HTTP response code .* fetching the script/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.t && window.t.loaded, null, { timeout: 15000 }).catch(e => { throw new Error('הדף לא עלה: ' + errors.join(' | ') + ' — ' + e.message); });
  const snap = async name => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  // בסוף כל דף: בלי שגיאות ובלי גלילה לצדדים
  const done = async () => {
    assert.deepEqual(errors, [], 'שגיאות דף');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'אין גלילה לצדדים');
    await context.close();
  };
  return { page, snap, done };
}
// החלון של המבצע נמצא מעל מה שמאחוריו: מה שמתחת לאצבע במרכז הכפתור הוא הכפתור עצמו
const onTop = (page, selector) => page.evaluate(sel => { const el = document.querySelector(sel), b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!hit && (hit === el || el.contains(hit)); }, selector);
const sheetClosed = page => page.waitForFunction(() => document.getElementById('paperPromoModal').classList.contains('hidden'));

try {
  // ----- 1. "פתח מבצע" מהשורה שברשימה, בזמן הקליטה -----
  {
    const { storage } = await build(false);
    const { page, snap, done } = await open('receiving', { storage });
    assert.equal(await page.evaluate(() => t.mode()), 'lines', 'הבדיקה חזרה מהטיוטה');
    await page.evaluate(() => t.start());
    await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
    await page.locator('[data-line-mark="0:0:ok"]').click();
    const row = page.locator('#lineCheck_0_3');
    await row.scrollIntoViewIfNeeded();
    assert.match(flat(await row.innerText()), /ממרח אבוקדו 200 .*בתעודה קיים מבצע: 40% הנחה ₪7\.13 ליח׳ במקום ₪11\.89 · המבצע לא קיים במערכת פתח מבצע הגיע 8 אחרת לא הגיע$/);
    assert.equal(await page.locator('#receiptQuantityRows [data-role="paper-promo-open"]').count(), 1, 'רק על המוצר הזה');
    const button = row.locator('[data-role="paper-promo-open"]'), box = await button.boundingBox(), rowBox = await row.boundingBox();
    assert.ok(box.height >= 44, 'יעד מגע של 44px: ' + box.height);
    assert.ok(box.x >= rowBox.x && box.x + box.width <= rowBox.x + rowBox.width + 1, 'הכפתור בתוך הכרטיס');
    await snap('1-row');
    await button.click();
    await page.waitForSelector('#paperPromoModal:not(.hidden)');
    assert.equal(await onTop(page, '#paperPromoSave'), true, 'החלון מעל חלון הבדיקה');
    assert.deepEqual(await page.evaluate(() => ['paperPromoPct', 'paperPromoStart', 'paperPromoEnd', 'paperPromoName'].map(id => document.getElementById(id).value)), ['40', '2026-11-01', '2026-11-30', 'ממרח אבוקדו 200']);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'paperPromoSave', 'הפוקוס על הכפתור — לא על שדה (המקלדת לא קופצת)');
    const sheetBox = await page.locator('#paperPromoModal > div').boundingBox();
    assert.ok(sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 390 && sheetBox.y >= 0 && sheetBox.y + sheetBox.height <= 844, 'החלון כולו בתוך המסך: ' + JSON.stringify(sheetBox));
    await snap('1-sheet');
    // אחוז אחר בשדה אמיתי — אזהרה ו"פתח בכל זאת"; החזרה ל-40 מנקה אותה, והשדה נשאר בפוקוס (החלון לא צויר מחדש)
    await page.locator('#paperPromoPct').fill('35');
    assert.equal((await page.evaluate(() => t.sheet())).pct, '35');
    await page.locator('#paperPromoSave').click();
    assert.match(flat(await page.locator('#paperPromoMsg').innerText()), /^35% לא נותן את המחיר שבתעודה \(₪7\.13 ליח׳\)/);
    assert.equal(flat(await page.locator('#paperPromoSave').textContent()), 'פתח בכל זאת');
    assert.equal((await page.evaluate(() => t.promos())).length, 0);
    await page.locator('#paperPromoPct').fill('40');
    assert.equal(flat(await page.locator('#paperPromoMsg').innerText()), ''); assert.equal(flat(await page.locator('#paperPromoSave').textContent()), 'פתח מבצע');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'paperPromoPct');
    await page.locator('#paperPromoSave').click();
    await sheetClosed(page);
    assert.deepEqual((await page.evaluate(() => t.promos())).map(p => [p.name, p.pct, p.start, p.end, p.minQty, p.productIds.join()]), [['ממרח אבוקדו 200', 40, '2026-11-01', '2026-11-30', 1, 'avocado']]);
    assert.deepEqual((await page.evaluate(() => window.cloudWrites)).map(w => [w[0], w[1].name, w[1].pct]).filter(w => w[1]), [['set', 'ממרח אבוקדו 200', 40]]);
    await page.waitForSelector('#lineCheck_0_3 [data-paper-promo-done]');
    assert.equal(await page.locator('#receiptQuantityRows [data-role="paper-promo-open"]').count(), 0);
    assert.match(flat(await row.innerText()), /המבצע נפתח במערכת: 40% · 1\.11\.2026 עד 30\.11\.2026 הגיע 8 אחרת לא הגיע$/);
    assert.equal(flat(await page.locator('#receiptQuantityProgress').textContent()), 'המבצע נפתח: ממרח אבוקדו 200 · 40% ✓');
    assert.deepEqual(await page.evaluate(() => t.marks()), ['ok,,,'], 'מה שסומן נשאר');
    assert.equal(await page.locator('#receiptQuantityModal').isVisible(), true, 'חלון הבדיקה נשאר פתוח');
    await snap('1-done');
    await done();
  }
  // ----- 2. בלי לפתוח ברשימה: מסך ההשוואה, חלון הסיכום, ו"פתח מבצע" משם -----
  {
    const { storage } = await build(false);
    const { page, snap, done } = await open('receiving', { storage });
    await page.evaluate(() => t.start());
    await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
    for (let k = 0; k < 4; k++) await page.locator('[data-line-mark="0:' + k + ':ok"]').click();
    // מקופלת — ההודעה המקוצרת נשארת, עם הכפתור
    assert.match(flat(await page.locator('#lineCheck_0_3').innerText()), /^ממרח אבוקדו 200 הגיע · 8 יח׳ בקופה ₪19\.90 שנה בתעודה קיים מבצע 40% ₪7\.13 במקום ₪11\.89 · לא קיים במערכת פתח מבצע$/);
    assert.ok((await page.locator('#lineCheck_0_3 [data-role="paper-promo-open"]').boundingBox()).height >= 44);
    await page.locator('#receiptQuantityConfirm').click();
    await page.waitForFunction(() => t.view() === 'reconcile');
    assert.equal(await page.evaluate(() => t.step()), 'ai');
    assert.equal(await page.locator('#receiptSummaryModal').isVisible(), false, 'לא נסגר לבד — יש מה להחליט');
    assert.match(flat(await page.locator('[data-price-paper-promo="avocado"]').innerText()), /^ממרח אבוקדו 200 בתעודה קיים מבצע: 40% הנחה/);
    assert.match(flat(await page.locator('[data-paper-promo-group]').innerText()), /^מבצע בתעודה שלא קיים במערכת 1 ממרח אבוקדו 200 בתעודה קיים מבצע 40%/);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#app [data-role="ai-apply"], #app [data-role="ai-confirm-findings"]')].map(b => b.textContent.trim())), ['המשך בלי לפתוח את המבצע — התעודה תיקלט כפתוחה']);
    await snap('2-reconcile');
    await page.locator('#app [data-role="ai-apply"]').click();
    await page.waitForSelector('#receiptSummaryModal:not(.hidden)');
    assert.deepEqual(await page.evaluate(() => t.pending()), { status: 'open', pct: 0 });
    const inSummary = page.locator('#rsBody [data-role="paper-promo-open"]');
    await inSummary.scrollIntoViewIfNeeded();
    assert.ok((await inSummary.boundingBox()).height >= 44);
    await snap('2-summary');
    await inSummary.click();
    await page.waitForSelector('#paperPromoModal:not(.hidden)');
    assert.equal(await onTop(page, '#paperPromoSave'), true, 'החלון מעל חלון הסיכום');
    await page.locator('#paperPromoSave').click();
    await sheetClosed(page);
    await page.waitForFunction(() => document.getElementById('receiptSummaryModal').classList.contains('hidden'));
    assert.deepEqual(await page.evaluate(() => [t.view(), t.step(), t.paper(), t.pending()]), ['reconcile', 'ai', 0, null]);
    assert.equal(await page.locator('#app [data-role="paper-promo-open"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#app [data-role="ai-apply"]')].map(b => b.textContent.trim())), ['הכול תואם — המשך']);
    await page.locator('#app [data-role="ai-apply"]').click();
    await page.waitForSelector('#receiptSummaryModal:not(.hidden)');
    assert.deepEqual(await page.evaluate(() => t.pending()), { status: 'ok', pct: 40 }, 'השורה נקלטת כמבצע, והתעודה מאוזנת');
    await snap('2-summary-after');
    await done();
  }
  // ----- 3. התעודה השמורה: "פתח מבצע" מכרטיס התעודה -----
  {
    const { saved } = await build(true);
    const { page, snap, done } = await open('receiptsHistory', { receipts: [saved] });
    const card = page.locator('details[data-receipt-card="' + saved.id + '"]');
    assert.equal(await card.evaluate(el => el.open), false);
    assert.match(flat(await card.locator('[data-plain-status]').innerText()), /^בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40%$/);
    await card.locator('summary').first().click();
    assert.equal(await card.evaluate(el => el.open), true);
    assert.equal(flat(await card.locator('[data-plain-action]').innerText()), 'מה לעשות עכשיו בתעודה קיים מבצע שלא קיים במערכת · ממרח אבוקדו 200 · 40% פתח מבצע');
    const notice = card.locator('[data-paper-promo="avocado"]');
    await notice.scrollIntoViewIfNeeded();
    assert.equal(flat(await notice.innerText()), 'בתעודה קיים מבצע 40% ₪7.13 במקום ₪11.89 · לא קיים במערכת פתח מבצע');
    assert.ok((await notice.locator('button').boundingBox()).height >= 44);
    assert.equal(await card.locator('text=הפרשים מול התעודה').count(), 0, 'בלי קופסת הפרשים ריקה');
    await snap('3-card');
    await notice.locator('button').click();
    await page.waitForSelector('#paperPromoModal:not(.hidden)');
    assert.deepEqual(await page.evaluate(() => t.sheet()), { pct: '40', start: '2026-11-01', end: '2026-11-30', name: 'ממרח אבוקדו 200', receiptId: saved.id, force: false });
    await page.locator('#paperPromoSave').click();
    await sheetClosed(page);
    const after = page.locator('details[data-receipt-card="' + saved.id + '"]');
    await page.waitForFunction(id => { const el = document.querySelector('details[data-receipt-card="' + id + '"]'); return !!el && !el.querySelector('[data-paper-promo]'); }, saved.id);
    assert.equal(await after.evaluate(el => el.open), true, 'הכרטיס נשאר פתוח');
    assert.match(flat(await after.locator('summary').first().innerText()), /אומתה/);
    assert.equal(flat(await after.locator('[data-plain-status]').innerText()), 'נקלטה ומאוזנת ✓');
    assert.match(flat(await after.innerText()), /ממרח אבוקדו 200 8 × ₪7\.13375 · מבצע 40% ₪57\.07/);
    assert.match(flat(await after.innerText()), /• ממרח אבוקדו 200 — מבצע 40%: המחיר בנייר תואם למבצע ✓/);
    assert.equal(flat(await page.locator('#toastMsg').textContent()), 'המבצע נפתח: ממרח אבוקדו 200 · 40% · התעודה אומתה ✓');
    assert.deepEqual(await page.evaluate(() => t.receipts()), [['ok', 0]], 'הסטטוס השמור נסגר; השורה השמורה לא השתנתה');
    assert.deepEqual((await page.evaluate(() => window.cloudWrites)).map(w => [w[0], w[1].pct || w[1].status]).filter(w => w[1]), [['set', 40], ['update', 'ok']]);
    await snap('3-card-after');
    await done();
  }
  console.log('yotvata: "פתח מבצע" בדפדפן אמיתי (390px) — על השורה ברשימה, מעל חלון הבדיקה ומעל חלון הסיכום, בשדות אמיתיים, ומכרטיס התעודה השמורה (נשאר פתוח, "אומתה") — תקין');
} finally {
  await browser.close();
  server.close();
}
