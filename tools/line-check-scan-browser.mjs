// v408 — הסריקה בתוך הבדיקה שורה-שורה בדפדפן אמיתי (Chromium, רוחב טלפון 390px), בלי רשת חיצונית ובלי Firebase.
// הבדיקה שורה-שורה נבנית קודם בקוד של האפליקציה עצמה (receipt-scan-harness: שתי תעודות, חלב בשתיהן) ונכנסת לדפדפן דרך
// הטיוטה בזיכרון הטלפון (localStorage) — בדיוק כמו פתיחה מחדש של האפליקציה. המצלמה מזויפת (זרם מקנבס, BarcodeDetector שלא
// קורא כלום), והברקוד "נקרא" דרך onScanned. מה שנבדק בדום אמיתי:
// - "סרוק מוצר" ו"סיום" בתחתית הקבועה: גלויים, ולא זזים כשגוללים את הרשימה.
// - הלחיצה פותחת את המצלמה (החלון מוסתר), עם "סומנו 0 מתוך 5"; ברקוד מעלה את הכרטיס, ולחיצה אמיתית על "הגיע 6" מסמנת;
//   "אחרת" — השדה בפוקוס, הסיכום מתעדכן בהקלדה, Enter שומר; מוצר שאינו בתעודה — "הוסף"; ברקוד לא מוכר — ההודעה.
// - ✕ מחזיר לרשימה: השורות שסומנו בסריקה מקופלות, השורה האחרונה מודגשת, המונה נכון; בלי שגיאות דף ובלי גלילה לצדדים.
// הרצה: node tools/line-check-scan-browser.mjs (Playwright + Chromium; YOTVATA_CHROMIUM — נתיב לדפדפן, אופציונלי)
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
  { id: 'cottage', name: 'קוטג׳ 5% 250 גרם', code: '15', barcode: '7290000000015', price: 7 },
  { id: 'yogurt', name: 'יוגורט טבעי 150 גרם', code: '22', barcode: '7290000000022', price: 3 },
  { id: 'cream', name: 'שמנת חמוצה 15% 200 מ״ל', code: '39', barcode: '7290000000039', price: 2 },
  { id: 'pudding', name: 'מעדן שוקולד 125 גרם', code: '46', barcode: '7290000000046', price: 4, posPrice: 5.5 }
];
const r2 = n => Math.round(n * 100) / 100;
function paper(spec, number) {
  const rows = spec.map(([id, q], i) => { const p = products.find(x => x.id === id);
    return { section: 'items', code: p.code, itemCode: p.code, supplierItemCode: p.code, description: p.name, barcode: p.barcode, barcodeObserved: p.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
      sourcePage: 1, lineNumber: i + 1, quantity: q, unitPriceExVat: p.price, grossLineTotalExVat: r2(q * p.price), lineTotalExVat: r2(q * p.price), lineDiscountExVat: 0, confidence: .99 }; });
  const gross = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = spec.reduce((n, s) => n + s[1], 0);
  return { noteIndex: 0, docDate: '2026-11-02', docNumber: number, invoiceNumber: number, docType: 'invoice', pageCount: 1, rows, confidence: .99,
    subtotalExVat: gross, netToChargeExVat: gross, totalUnits: units, printedUnits: units, itemsPrintedLines: spec.length, printedLines: spec.length,
    itemsSectionTotalExVat: gross, promoDiscountExVat: 0, documentDiscountExVat: 0, warnings: [] };
}
// 1. הבדיקה נבנית בקוד של האפליקציה (node), והטיוטה שלה — מה שהטלפון שומר — עוברת לדפדפן
const papers = [paper([['milk', 12], ['cottage', 6], ['yogurt', 4]], '4471001'), paper([['milk', 5], ['cream', 2]], '4471002')];
const storage = new Map();
{
  const cloud = fakeCloud();
  const c = runtime('yotvata', { storage, cloud, data: { products, promos: [], items: [], paper: { ok: true, serviceVersion: 160, scan: { warnings: [], documents: [] } } } });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const sent = options?.body || '', index = papers.findIndex((p, i) => sent.includes('UEFQRVI' + i));
    const body = JSON.stringify({ ok: true, serviceVersion: 160, model: 'fixture', requestId: 'p' + index, scan: { warnings: [], documents: papers[index] ? [structuredClone(papers[index])] : [] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true; showConfirm = (t, m, l, cb) => cb();
    aiScanDocuments = ${JSON.stringify(papers.map((p, i) => ({ noteIndex: i, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI' + i, orientationConfirmed: true }] })))};`);
  await c.run('yotvataStartPaperScan({ manualQuantities: true })');
  assert.equal(c.run('receiptPaperScanState'), 'ok', JSON.stringify(c.run('receiptPaperScanProblems')));
  c.run('startReceiptLineCheck()');
  assert.equal(c.run('receiptQuantityReview.mode'), 'lines');
  c.run('Object.values(draftHandoffs).forEach(h => h.stop())');
}

// 2. הדף: index.html בלי הסקריפטים החיצוניים (Tailwind, גופנים, Firebase), עם תחליפים ל-Firebase ולמצלמה
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm, '');
const setup = `
// auth קיים אבל אף פעם לא "מתחבר" — כמו בטלפון, שום דבר לא מצויר לפני שהמודול כולו נטען (fallbackLocal מצייר מיד, לפני שהמשתנים קיימים)
const initializeApp = () => ({}), getAuth = () => ({}), signInAnonymously = async () => ({}), onAuthStateChanged = () => {};
const initializeFirestore = () => ({}), getFirestore = () => ({}), persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({});
const collection = () => ({}), onSnapshot = () => () => {}, doc = () => ({}), getDoc = async () => ({ exists: () => false, data: () => null }), getDocFromServer = getDoc;
const deleteDoc = async () => {}, addDoc = async () => ({ id: 'x' }), updateDoc = async () => {}, setDoc = async () => {}, writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => {} });
const query = () => ({}), orderBy = () => ({}), limit = () => ({}), getDocs = async () => ({ docs: [] }), getDocsFromServer = getDocs, where = () => ({}), runTransaction = async () => {}, deleteField = () => ({});
// מצלמה מזויפת: זרם מקנבס, ומנוע שלא קורא כלום — הברקוד נכנס דרך onScanned
const fakeCanvas = document.createElement('canvas'); fakeCanvas.width = 320; fakeCanvas.height = 240;
fakeCanvas.getContext('2d').fillStyle = '#334'; fakeCanvas.getContext('2d').fillRect(0, 0, 320, 240);
navigator.mediaDevices.getUserMedia = async () => fakeCanvas.captureStream(5);
window.BarcodeDetector = class { detect() { return Promise.resolve([]); } };
`;
const replay = `
products = ${JSON.stringify(products)}; promos = []; receipts = []; returns = [];
todayStr = () => '2026-11-03';
window.fetch = async url => { throw new Error('External network is forbidden in the browser check: ' + url); };
setView('receiving');
// (המשתנים של המודול אינם גלובליים — הבדיקה ניגשת אליהם רק דרך t)
window.t = { marks: () => receiptQuantityReview.docs.map(d => d.lines.map(l => l.mark + (l.got ? ':' + l.got : '')).join(',')), extras: () => receiptQuantityReview.extras.map(x => [x.productId, x.got]),
  mode: () => receiptQuantityReview && receiptQuantityReview.mode, start: () => startReceiptLineCheck(), stream: () => !!scanStream,
  beep: code => onScanned(code), purpose: () => scanPurpose, card: () => receiptLineScanCard, later: () => { lastScanTime = 0; } };
window.t.loaded = true;
`;
const css = `.hidden{display:none!important}.flex{display:flex}.grid{display:grid}.block{display:block}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}
.inset-0{inset:0}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}.top-0{top:0}.flex-col{flex-direction:column}.flex-1{flex:1}.items-center{align-items:center}.items-start{align-items:flex-start}.justify-center{justify-content:center}.justify-between{justify-content:space-between}
.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}.min-h-0{min-height:0}.min-w-0{min-width:0}.shrink-0{flex-shrink:0}.w-full{width:100%}.h-full{height:100%}.max-w-lg{max-width:32rem}.mx-auto{margin-left:auto;margin-right:auto}
.gap-1{gap:.25rem}.gap-1\\.5{gap:.375rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.p-3{padding:.75rem}.p-4{padding:1rem}.mt-3{margin-top:.75rem}.mb-2\\.5{margin-bottom:.625rem}
.grid-cols-\\[1\\.15fr_1fr\\]{grid-template-columns:1.15fr 1fr}.grid-cols-\\[1fr_auto_auto\\]{grid-template-columns:1fr auto auto}
.bg-white{background:#fff}.bg-black{background:#000}.bg-slate-50{background:#f8fafc}.bg-indigo-600{background:#4f46e5;color:#fff}.bg-emerald-600{background:#059669;color:#fff}.bg-amber-500{background:#f59e0b;color:#fff}.bg-slate-400{background:#94a3b8}.bg-blue-600{background:#2563eb}
.rounded-2xl{border-radius:1rem}.rounded-xl{border-radius:.75rem}.border-2{border:2px solid #cbd5e1}.border{border:1px solid #cbd5e1}.border-emerald-300{border-color:#6ee7b7}.bg-emerald-50{background:#ecfdf5}.border-amber-300{border-color:#fcd34d}.bg-amber-50{background:#fffbeb}
.text-3xl{font-size:1.875rem}.text-lg{font-size:1.125rem}.text-xs{font-size:.75rem}.text-sm{font-size:.875rem}.text-\\[11px\\]{font-size:11px}.font-black{font-weight:900}.font-bold{font-weight:700}.text-white{color:#fff}.text-center{text-align:center}
.min-h-\\[48px\\]{min-height:48px}.min-h-\\[52px\\]{min-height:52px}.w-24{width:6rem}.w-10{width:2.5rem}.h-10{height:2.5rem}.top-2{top:.5rem}.left-2{left:.5rem}.ring-4{box-shadow:0 0 0 4px #93c5fd}.h-full{height:100%}.items-stretch{align-items:stretch}.px-4{padding-left:1rem;padding-right:1rem}.pt-4{padding-top:1rem}.pb-4{padding-bottom:1rem}
body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}video{background:#222}`;
const pageHtml = html.replace(/<script\s+src="https:[^"]+"><\/script>/g, '').replace(/<link[^>]+(?:href="https:[^"]+"|rel="manifest")[^>]*>/g, '')
  .replace(/<script type="module">[\s\S]*?<\/script>/, () => '<script type="module">' + setup + moduleSource + replay + '</script>')
  .replace('</head>', '<style>' + css + '</style></head>');
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
const shots = process.env.YOTVATA_SHOTS; // תיקייה לצילומי מסך (אופציונלי)
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const errors = [];
// הכרטיס נסגר (המחלקה hidden) — waitForSelector מחכה לנראות, ולכן בודקים את המחלקה עצמה
const cardHidden = page => page.waitForFunction(() => document.getElementById('scanLineCard').classList.contains('hidden'));
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'he-IL' });
  await context.addInitScript(entries => { for (const [k, v] of entries) localStorage.setItem(k, v); }, [...storage.entries()]);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e && e.stack || e)));
  // (sw.js אינו מוגש כאן בכוונה — הודעת ה-404 של רישום ה-service worker אינה שגיאה של הבדיקה)
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|net::|Failed to load resource|favicon|bad HTTP response code .* fetching the script/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.t && window.t.loaded, null, { timeout: 15000 }).catch(e => { throw new Error('הדף לא עלה: ' + errors.join(' | ') + ' — ' + e.message); });
  assert.equal(await page.evaluate(() => t.mode()), 'lines', 'הבדיקה חזרה מהטיוטה');
  await page.evaluate(() => t.start());
  await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
  // התחתית הקבועה: "סרוק מוצר" ו"סיום" גלויים, ולא זזים כשגוללים את הרשימה
  const scanBtn = page.locator('#receiptLineScan'), finish = page.locator('#receiptQuantityConfirm'), body = page.locator('#receiptQuantityBody');
  assert.equal(await scanBtn.isVisible(), true); assert.equal(await finish.isVisible(), true);
  assert.equal((await scanBtn.textContent()).trim(), 'סרוק מוצר'); assert.equal((await finish.textContent()).trim(), 'סיום (נשארו 5)');
  const before = await page.evaluate(() => document.getElementById('receiptQuantityFooter').getBoundingClientRect().top);
  const scrolled = await page.evaluate(() => { const b = document.getElementById('receiptQuantityBody'); b.scrollTop = 10000; return b.scrollTop; });
  assert.ok(scrolled > 100, 'הרשימה נגללת (' + scrolled + ')');
  assert.equal(await page.evaluate(() => document.getElementById('receiptQuantityFooter').getBoundingClientRect().top), before, 'התחתית לא זזה בגלילה');
  const footerBox = await page.locator('#receiptQuantityFooter').boundingBox(), scanBox = await scanBtn.boundingBox(), finishBox = await finish.boundingBox();
  assert.ok(footerBox.y + footerBox.height <= 844 && scanBox.y >= 0, 'התחתית בתוך המסך');
  // v409: בטלפון החלון על כל המסך — התיבה מהקצה לקצה, והתחתית צמודה לתחתית המסך
  const box = await page.locator('#receiptQuantityModal > div').boundingBox();
  assert.ok(Math.abs(box.y) < 1 && Math.abs(box.height - 844) < 2 && Math.abs(box.width - 390) < 2, 'מסך מלא: ' + JSON.stringify(box));
  assert.ok(Math.abs(footerBox.y + footerBox.height - 844) < 2, 'התחתית צמודה לתחתית המסך: ' + JSON.stringify(footerBox));
  assert.ok(scanBox.x > finishBox.x && scanBox.width > finishBox.width, '"סרוק" מימין (RTL) ורחב יותר');
  await snap(page, '1-list');
  // הלחיצה פותחת את המצלמה; החלון מוסתר
  await scanBtn.click();
  await page.waitForSelector('#scanModal:not(.hidden)');
  await page.waitForFunction(() => t.stream());
  assert.equal(await page.locator('#receiptQuantityModal').isVisible(), false, 'החלון מוסתר בזמן הסריקה');
  assert.equal(await page.evaluate(() => t.purpose()), 'linecheck');
  assert.equal((await page.locator('#scanTitle').textContent()).trim(), 'בדיקה שורה-שורה — סריקה');
  assert.equal(await page.evaluate(() => document.getElementById('scanOverlayLabel').textContent + ' ' + document.getElementById('scanOverlayCount').textContent), 'סומנו 0 מתוך 5');
  assert.equal(await page.locator('#scanLineCard').isVisible(), false);
  await snap(page, '2-camera');
  // ברקוד של שורה → הכרטיס; לחיצה אמיתית על "הגיע 6"
  await page.evaluate(() => t.beep('7290000000015'));
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /שורה 2 בתעודה 1 מתוך 2 קוטג׳ 5% 250 גרם .*6 יח׳ בתעודה.*הגיע 6/);
  await snap(page, '3-card');
  await page.locator('[data-scan-mark="ok"]').click();
  await cardHidden(page);
  assert.deepEqual(await page.evaluate(() => t.marks()), [',ok,', ',']);
  assert.equal(await page.evaluate(() => document.getElementById('scanOverlayCount').textContent + ' | ' + document.getElementById('scanOverlayName').textContent), '1 מתוך 5 | ✓ קוטג׳ 5% 250 גרם · הגיע 6');
  // "אחרת": השדה בפוקוס, הסיכום בהקלדה, Enter שומר
  await page.evaluate(() => { t.later(); t.beep('7290000000008'); });
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  await page.locator('[data-scan-mark="qty"]').click();
  await page.waitForSelector('#scanLineGot');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'scanLineGot', 'שדה הכמות בפוקוס');
  await page.keyboard.type('10');
  assert.equal((await page.locator('#scanLineSum').textContent()).trim(), 'התקבלו 10 · חוסר 2');
  await snap(page, '4-qty');
  await page.keyboard.press('Enter');
  await cardHidden(page);
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:10,ok,', ',']);
  // מוצר שאינו בתעודה — "הוסף"
  await page.evaluate(() => { t.later(); t.beep('7290000000046'); });
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם/);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'scanLineGot');
  await page.locator('[data-scan-save]').click();
  await cardHidden(page);
  assert.deepEqual(await page.evaluate(() => t.extras()), [['pudding', '1']]);
  // ברקוד לא מוכר — ההודעה, בלי כרטיס
  await page.evaluate(() => { t.later(); t.beep('7290119390519'); });
  assert.equal(await page.locator('#scanLineCard').isVisible(), false);
  assert.match(await page.locator('#toastMsg').textContent(), /ברקוד לא קיים במערכת/);
  // ✕ — חזרה לרשימה
  await page.locator('#scanClose').click();
  await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
  assert.equal(await page.locator('#scanModal').isVisible(), false);
  assert.equal(await page.evaluate(() => t.purpose()), 'field');
  assert.equal((await page.locator('#receiptQuantityProgress').textContent()).trim(), 'סומנו 2 מתוך 5 שורות · חוסר 2 יח׳ · עודף 1 יח׳');
  assert.match((await page.locator('#lineCheck_0_1').innerText()).replace(/\s+/g, ' '), /הגיע · 6 יח׳.*שנה/, 'השורה שסומנה בסריקה — מקופלת');
  assert.equal(await page.locator('#lineCheck_0_0 [data-line-got]').inputValue(), '10', '"אחרת" — פתוחה עם הכמות');
  assert.equal(await page.evaluate(() => document.getElementById('lineExtra_0').classList.contains('ring-4')), true, 'השורה האחרונה שסומנה — מודגשת');
  await snap(page, '5-back');
  const width = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, client: document.scrollingElement.clientWidth }));
  assert.ok(width.scroll <= width.client, 'בלי גלילה לצדדים');
  assert.deepEqual(errors, [], 'בלי שגיאות דף');
  console.log('yotvata: הסריקה בבדיקה שורה-שורה בדפדפן אמיתי (390px) — התחתית הקבועה, המצלמה, הכרטיס, "אחרת", "הגיע בנוסף", ברקוד לא מוכר, וחזרה לרשימה — תקין');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
