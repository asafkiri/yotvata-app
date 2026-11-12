// v408 — הסריקה בתוך הבדיקה שורה-שורה בדפדפן אמיתי (Chromium, רוחב טלפון 390px), בלי רשת חיצונית ובלי Firebase.
// הבדיקה שורה-שורה נבנית קודם בקוד של האפליקציה עצמה (receipt-scan-harness: שתי תעודות, חלב בשתיהן) ונכנסת לדפדפן דרך
// הטיוטה בזיכרון הטלפון (localStorage) — בדיוק כמו פתיחה מחדש של האפליקציה. המצלמה מזויפת (זרם מקנבס, BarcodeDetector שלא
// קורא כלום), והברקוד "נקרא" דרך onScanned. מה שנבדק בדום אמיתי:
// - "סרוק מוצר" ו"סיום" בתחתית הקבועה: גלויים, ולא זזים כשגוללים את הרשימה.
// - הלחיצה פותחת את המצלמה (החלון מוסתר), עם "סומנו 0 מתוך 4"; ברקוד מעלה את הכרטיס, ולחיצה אמיתית על "הגיע 6" מסמנת;
//   "אחרת" — השדה בפוקוס, הסיכום מתעדכן בהקלדה, Enter שומר; מוצר שאינו בתעודה — "הוסף"; ברקוד לא מוכר — ההודעה.
// - 413: כל סימון מהכרטיס סוגר את המצלמה וחוזר לרשימה — רק השורה שסומנה מודגשת, והיא נגללת לתוך המסך (גם הכרטיס הצהוב
//   בתחתית); "סרוק מוצר" שוב למוצר הבא, עם המונה המעודכן. ✕ בכרטיס, "תקן את הסה״כ" וברקוד לא מוכר משאירים את המצלמה.
// - ✕ במצלמה מחזיר לרשימה כמו שהיא: השורות שסומנו בסריקה מקופלות, המונה נכון; בלי שגיאות דף ובלי גלילה לצדדים.
// - 416: "בטל סימון" בשורה שנפתחה ב"שנה" — בלחיצה אמיתית השורה חוזרת ל"עוד לא נבדקה", והפוקוס נשאר על "הגיע" שלה.
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
body{margin:0;font:16px Arial}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}video{background:#222}.min-h-\\[44px\\]{min-height:44px}`;
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
const highlighted = page => page.evaluate(() => [...document.querySelectorAll('#receiptQuantityRows .ring-4')].map(e => e.id));
// v413: הסימון סגר את המצלמה — הרשימה חזרה, רק השורה שסומנה מודגשת, והיא בתוך המסך (נגללת למרכז)
async function returned(page, id) {
  await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
  assert.equal(await page.locator('#scanModal').isVisible(), false, 'המצלמה נסגרה אחרי הסימון');
  assert.equal(await page.evaluate(() => t.purpose()), 'field');
  assert.equal(await page.evaluate(() => t.card()), null);
  assert.deepEqual(await highlighted(page), [id], 'רק השורה שסומנה מודגשת');
  // בתוך הגוף הנגלל — ולא מתחת לכותרת הדביקה של התעודה (413: כשהרשימה קצרה והגלילה נעצרת בסופה, "למרכז" היה משאיר אותה מאחוריה)
  await page.waitForFunction(i => { const el = document.getElementById(i), e = el.getBoundingClientRect(), b = document.getElementById('receiptQuantityBody').getBoundingClientRect();
    const head = el.closest('section') && el.closest('section').querySelector('.sticky'), headBottom = head ? head.getBoundingClientRect().bottom : b.top;
    return e.height > 0 && e.top >= b.top - 1 && e.top >= headBottom - 1 && e.bottom <= b.bottom + 1; }, id, { timeout: 5000 })
    .catch(() => assert.fail(id + ' — השורה שסומנה לא נגללה לתוך המסך (או שהיא מתחת לכותרת הדביקה)'));
}
// "סרוק מוצר" שוב — המצלמה נפתחת נקייה למוצר הבא
async function rescan(page) {
  await page.locator('#receiptLineScan').click();
  await page.waitForSelector('#scanModal:not(.hidden)');
  await page.waitForFunction(() => t.stream());
  assert.equal(await page.locator('#receiptQuantityModal').isVisible(), false);
  assert.equal(await page.locator('#scanLineCard').isVisible(), false);
}
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
  assert.equal((await scanBtn.textContent()).trim(), 'סרוק מוצר'); assert.equal((await finish.textContent()).trim(), 'סיום (נשארו 4)');
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
  assert.equal(await page.evaluate(() => document.getElementById('scanOverlayLabel').textContent + ' ' + document.getElementById('scanOverlayCount').textContent), 'סומנו 0 מתוך 4');
  assert.equal(await page.locator('#scanLineCard').isVisible(), false);
  await snap(page, '2-camera');
  // ברקוד של שורה → הכרטיס; לחיצה אמיתית על "הגיע 6"
  await page.evaluate(() => t.beep('7290000000015'));
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /שורה 2 בתעודה 1 מתוך 2 קוטג׳ 5% 250 גרם .*6 יח׳ בתעודה.*הגיע 6/);
  await snap(page, '3-card');
  await page.locator('[data-scan-mark="ok"]').click();
  await returned(page, 'lineCheck_0_1'); // 413: המצלמה נסגרה, הרשימה חזרה על השורה
  assert.deepEqual(await page.evaluate(() => t.marks()), [',ok,', ',']);
  assert.match((await page.locator('#lineCheck_0_1').innerText()).replace(/\s+/g, ' '), /הגיע · 6 יח׳.*שנה/, 'מקופלת, כמו "הגיע" ביד');
  assert.equal((await page.locator('#receiptQuantityProgress').textContent()).trim(), 'סומנו 1 מתוך 4 שורות');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'receiptQuantityTitle', 'הפוקוס על הכותרת — לא על שדה (המקלדת לא קופצת)');
  await snap(page, '3b-returned');
  // "סרוק מוצר" שוב — המונה מעודכן, בלי "מה סומן זה עתה"
  await rescan(page);
  assert.equal(await page.evaluate(() => document.getElementById('scanOverlayCount').textContent + ' | ' + document.getElementById('scanOverlayName').textContent), '1 מתוך 4 | ');
  // "אחרת": השדה בפוקוס, הסיכום בהקלדה, Enter שומר
  await page.evaluate(() => t.beep('7290000000008'));
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  await page.locator('[data-scan-mark="qty"]').click();
  await page.waitForSelector('#scanLineGot');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'scanLineGot', 'שדה הכמות בפוקוס');
  await page.keyboard.type('10');
  assert.equal((await page.locator('#scanLineSum').textContent()).trim(), 'התקבלו 10 · חוסר 7'); // 412: החלב — 17 בשתי התעודות
  await snap(page, '4-qty');
  await page.keyboard.press('Enter');
  await returned(page, 'lineCheck_0_0');
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:10,ok,', 'none,']); // 412: 10 מתוך 17 — 10 בתעודה הראשונה, 0 ("לא הגיע") בשנייה
  assert.equal(await page.locator('#lineCheck_0_0 [data-line-got]').inputValue(), '10', '"אחרת" — השורה פתוחה עם הכמות');
  // גרסה 411: סריקה חוזרת של שורה שסומנה — "סרקת עד עכשיו 3 מתוך 4", מה שחסר כבר בשדה (בפוקוס ומסומן), Enter מוסיף ומשלים ל"הגיע"
  await rescan(page);
  await page.evaluate(() => t.beep('7290000000022')); // יוגורט — 4 בתעודה
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  await page.locator('[data-scan-mark="qty"]').click();
  await page.waitForSelector('#scanLineGot');
  await page.keyboard.type('3'); await page.keyboard.press('Enter');
  await returned(page, 'lineCheck_0_2');
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:10,ok,qty:3', 'none,']);
  await rescan(page);
  await page.evaluate(() => t.beep('7290000000022'));
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /סרקת עד עכשיו 3 מתוך 4 .*4 יח׳ בתעודה.*עוד כמה\?.*הוסף.*סה״כ 4 · כמו בתעודה.*תקן את הסה״כ/);
  assert.equal(await page.locator('#scanLineGot').inputValue(), '1', 'מה שחסר — בשדה');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'scanLineGot', 'השדה בפוקוס');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.selectionStart, document.activeElement.selectionEnd]), [0, 1], 'המספר מסומן — הקלדה מחליפה אותו');
  assert.equal(await page.locator('[data-scan-mark="ok"]').count(), 0, 'בלי "הגיע N" — זה כרטיס של תוספת');
  await snap(page, '4b-add');
  await page.keyboard.press('Enter');
  await returned(page, 'lineCheck_0_2');
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:10,ok,ok', 'none,'], '3 + 1 = 4 — "הגיע"');
  assert.match((await page.locator('#lineCheck_0_2').innerText()).replace(/\s+/g, ' '), /הגיע · 4 יח׳.*שנה/, 'גרסה 411: השורה שהושלמה ב"עוד כמה?" — מקופלת כמו "הגיע"');
  assert.equal((await page.locator('#receiptQuantityProgress').textContent()).trim(), 'סומנו 3 מתוך 4 שורות · חוסר 7 יח׳');
  // "לא נכון? תקן את הסה״כ" — הכרטיס הקודם עם שלושת הכפתורים; ✕ בכרטיס סוגר בלי לשנות — והמצלמה נשארת
  await rescan(page);
  await page.evaluate(() => t.beep('7290000000015')); // קוטג׳ — כבר "הגיע" 6 מתוך 6
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /סרקת עד עכשיו 6 מתוך 6 — הכל הגיע/);
  assert.equal(await page.locator('#scanLineGot').inputValue(), '');
  await page.locator('[data-scan-mark="fix"]').click();
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /כבר סומנה: הגיע — אפשר לשנות.*הגיע 6.*אחרת.*לא הגיע/);
  assert.equal(await page.locator('#scanLineGot').count(), 0);
  assert.equal(await page.evaluate(() => t.purpose()), 'linecheck', '"תקן את הסה״כ" אינו סימון — המצלמה נשארת');
  await page.locator('[data-scan-dismiss]').click();
  await cardHidden(page);
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:10,ok,ok', 'none,']);
  assert.equal(await page.locator('#scanModal').isVisible(), true, '✕ בכרטיס — המצלמה נשארת');
  assert.equal(await page.evaluate(() => t.purpose()), 'linecheck');
  // מוצר שאינו בתעודה — "הוסף": חזרה לרשימה, לכרטיס הצהוב שבתחתית — נגלל לתוך המסך
  await page.evaluate(() => { t.later(); t.beep('7290000000046'); });
  await page.waitForSelector('#scanLineCard:not(.hidden)');
  assert.match((await page.locator('#scanLineCard').innerText()).replace(/\s+/g, ' '), /לא בתעודה — הגיע בנוסף מעדן שוקולד 125 גרם/);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'scanLineGot');
  await page.locator('[data-scan-save]').click();
  await returned(page, 'lineExtra_0');
  assert.deepEqual(await page.evaluate(() => t.extras()), [['pudding', '1']]);
  assert.ok(await page.evaluate(() => document.getElementById('receiptQuantityBody').scrollTop) > 0, 'הרשימה נגללה אל הכרטיס הצהוב שבתחתית');
  await snap(page, '4c-extra-returned');
  // ברקוד לא מוכר — ההודעה, בלי כרטיס, והמצלמה נשארת
  await rescan(page);
  await page.evaluate(() => t.beep('7290119390519'));
  assert.equal(await page.locator('#scanLineCard').isVisible(), false);
  assert.match(await page.locator('#toastMsg').textContent(), /ברקוד לא קיים במערכת/);
  assert.equal(await page.locator('#scanModal').isVisible(), true);
  // ✕ במצלמה — חזרה לרשימה כמו שהיא, בלי שורה מודגשת (כלום לא סומן מאז)
  await page.locator('#scanClose').click();
  await page.waitForSelector('#receiptQuantityModal:not(.hidden)');
  assert.equal(await page.locator('#scanModal').isVisible(), false);
  assert.equal(await page.evaluate(() => t.purpose()), 'field');
  assert.equal((await page.locator('#receiptQuantityProgress').textContent()).trim(), 'סומנו 3 מתוך 4 שורות · חוסר 7 יח׳ · עודף 1 יח׳');
  assert.match((await page.locator('#lineCheck_0_1').innerText()).replace(/\s+/g, ' '), /הגיע · 6 יח׳.*שנה/, 'השורה שסומנה בסריקה — מקופלת');
  assert.equal(await page.locator('#lineCheck_0_0 [data-line-got]').inputValue(), '10', '"אחרת" — פתוחה עם הכמות');
  assert.deepEqual(await highlighted(page), [], '✕ בלי סימון — שום שורה לא מודגשת');
  await snap(page, '5-back');
  // 412: המספר קובע — ב"אחרת" של החלב (10 מתוך 17 בשתי התעודות) מקלידים 17: תוך כדי ההקלדה הכרטיס ירוק ו"הגיע 17" דולק, בלי
  //     שהשדה נעלם; 170 — שוב כתום; 17, ויציאה מהשדה עם לחיצה על "סיום" — "הגיע" (12 + 5), מקופלת, והלחיצה לא נבלעה
  assert.match((await page.locator('#lineCheck_0_0').innerText()).replace(/\s+/g, ' '), /גם בתעודה 2 \(5 יח׳\).*17 יח׳ ב-2 תעודות 12 \+ 5/, '412: כרטיס אחד לשתי התעודות');
  assert.match((await page.locator('#lineCheckRef_1_0').innerText()).replace(/\s+/g, ' '), /נספר יחד עם תעודה 1, שורה 1 · התקבלו 10 מתוך 17 הצג/, '412: בתעודה השנייה — שורת הפניה');
  const got = page.locator('#lineCheck_0_0 [data-line-got]');
  await got.click(); await got.selectText(); await page.keyboard.type('17');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.lineGot), '0:0', 'השדה עדיין בפוקוס — לא צויר מחדש');
  assert.match(await page.evaluate(() => document.getElementById('lineCheck_0_0').className), /border-emerald-300 bg-emerald-50/, 'הכרטיס ירוק');
  assert.equal(await page.locator('[data-line-mark="0:0:ok"]').getAttribute('aria-pressed'), 'true', '"הגיע 17" דולק');
  assert.equal(await page.locator('[data-line-mark="0:0:qty"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#lineCheckSum_0_0').innerText(), 'כמו בתעודה');
  await page.keyboard.type('0'); // 170
  assert.match(await page.evaluate(() => document.getElementById('lineCheck_0_0').className), /border-amber-300 bg-amber-50/, 'עודף — שוב כתום');
  assert.equal(await page.locator('[data-line-mark="0:0:qty"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#lineCheckSum_0_0').innerText(), 'התקבלו 170 · עודף 153');
  await got.selectText(); await page.keyboard.type('17');
  assert.deepEqual(await page.evaluate(() => t.marks()), ['qty:12,ok,ok', 'qty:5,'], 'בנתונים עדיין "אחרת" — 17 מתחלקים 12 + 5 — עד שעוזבים את השדה');
  await snap(page, '6-exact');
  await finish.click({ force: true }); // "סיום" אפור עם aria-disabled — Playwright היה מחכה שיהיה "enabled"; הלחיצה עצמה אמיתית
  assert.deepEqual(await page.evaluate(() => t.marks()), ['ok,ok,ok', 'ok,'], 'יציאה מהשדה — "הגיע" בשתי התעודות');
  assert.match((await page.locator('#lineCheck_0_0').innerText()).replace(/\s+/g, ' '), /הגיע · 17 יח׳ ב-2 תעודות.*שנה/, 'מקופלת, כמו "הגיע" ביד');
  assert.match((await page.locator('#lineCheckRef_1_0').innerText()).replace(/\s+/g, ' '), /✓ הגיע/);
  assert.equal(await page.locator('#lineCheck_0_0 [data-line-got]').count(), 0);
  assert.equal(await page.locator('#receiptQuantityProgress').innerText(), 'נשארה שורה אחת בלי סימון — סמן בכל שורה: הגיע, כמות אחרת או לא הגיע', 'הלחיצה על "סיום" לא נבלעה');
  assert.equal((await finish.textContent()).trim(), 'סיום (נשארו 1)');
  await snap(page, '7-settled');
  // 416: "בטל סימון" בלחיצה אמיתית — "שנה" על החלב (מקופל, "הגיע 17" בשתי התעודות), ואז "בטל סימון": בלי סימון בשתי השורות שלו,
  // אף כפתור לא דולק, "סיום (נשארו 2)", והפוקוס על "הגיע" של השורה; בשורות מקופלות ובשורה שלא סומנה הכפתור אינו קיים
  assert.equal(await page.locator('[data-line-clear]').count(), 0, 'בשורות מקופלות — רק "שנה"');
  await page.locator('[data-line-open="0:0"]').click();
  const clear = page.locator('[data-line-clear="0:0"]');
  assert.equal(await page.locator('[data-line-clear]').count(), 1, 'רק בשורה הפתוחה שסומנה');
  assert.equal((await clear.innerText()).trim(), 'בטל סימון');
  const clearBox = await clear.boundingBox(), rowBox = await page.locator('#lineCheck_0_0').boundingBox();
  assert.ok(clearBox.height >= 44 && clearBox.x >= rowBox.x && clearBox.x + clearBox.width <= rowBox.x + rowBox.width + 1, '"בטל סימון" — יעד מגע של 44px, בתוך הכרטיס: ' + JSON.stringify(clearBox));
  await clear.click();
  assert.deepEqual(await page.evaluate(() => t.marks()), [',ok,ok', ','], 'בלי סימון, בשתי השורות של המוצר');
  assert.equal(await page.locator('[data-line-clear]').count(), 0);
  for (const m of ['ok', 'qty', 'none']) assert.equal(await page.locator('[data-line-mark="0:0:' + m + '"]').getAttribute('aria-pressed'), 'false');
  assert.equal((await finish.textContent()).trim(), 'סיום (נשארו 2)');
  assert.doesNotMatch((await page.locator('#lineCheckRef_1_0').innerText()).replace(/\s+/g, ' '), /הגיע/, 'שורת ההפניה — בלי סטטוס');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.lineMark), '0:0:ok', 'הפוקוס על "הגיע" של השורה שבוטלה');
  await snap(page, '8-cleared');
  const width = await page.evaluate(() => ({ scroll: document.scrollingElement.scrollWidth, client: document.scrollingElement.clientWidth }));
  assert.ok(width.scroll <= width.client, 'בלי גלילה לצדדים');
  assert.deepEqual(errors, [], 'בלי שגיאות דף');
  console.log('yotvata: הסריקה בבדיקה שורה-שורה בדפדפן אמיתי (390px) — התחתית הקבועה, המצלמה, הכרטיס, "אחרת", "עוד כמה?" (פוקוס, מסומן, Enter), "תקן את הסה״כ", "הגיע בנוסף", ברקוד לא מוכר, כל סימון חוזר לשורה שלו ברשימה (413), המספר שקובע את הסימון, ו"בטל סימון" (416) — תקין');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
