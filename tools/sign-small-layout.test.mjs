// v374 — "2 בדף (קטן)" בהכנת שלטי מבצע, בדפדפן אמיתי (Playwright + Chromium).
// ביקשו הדפסה כמו "2 בדף (גדול)", רק מוקטנת — אותו דף עם שוליים לבנים מסביב.
// הבדיקה שומרת על:
// - ארבעה כפתורי פריסה בסדר 4 / 2 קטן / 2 גדול / 1, בשורה משלהם מתחת ל"תצוגה
//   מקדימה של הדף", ובדיוק אחד מסומן — זה שבמצב.
// - כל עמוד של "2 בדף (קטן)" נשאר A4 לאורך (1240×1754): מחוץ למלבן הממורכז של
//   88% הכל לבן לגמרי, בזמן שב"2 בדף (גדול)" המסגרת האדומה יושבת בתוך אותה רצועה.
// - כל עמוד קטן הוא העמוד הגדול מוקטן ל־88% סביב מרכז ה־A4 — כותרת, מחיר, רצועת
//   ברקודים לקופה והמעבר לעמוד השני. משווים פיקסלים מול העמוד הגדול שהוקטן כתמונה,
//   וביקורת שלילית מוכיחה שההשוואה תופסת הזזה של 2px וקנה מידה 0.89.
// - ברקודים לקופה: הספרייה נטענת בעצלות, והציור מחדש אחרי הטעינה נשאר קטן.
// - השיתוף/שמירה שולח בדיוק את העמודים הקטנים שבתצוגה.
// - "2 בדף (גדול)", "4 בדף" ו"1 בדף (רוחב)" מבטלים את המצב הקטן; ציור מחדש וחזרה
//   לבחירה ולעריכה משאירים אותו.
// - עם 3 שלטים "2 בדף (קטן)" לא עובר (אותה הגנה כמו בגדול), ומופיעה הודעה.
// הרצה: node --test tools/sign-small-layout.test.mjs
// SIGN_TEST_APP — עותק אחר של index.html (למשל עותק שבור, לראות שהבדיקה נופלת).
// SIGN_TEST_JSBARCODE — JsBarcode.all.min.js אמיתי; בלעדיו נטען תחליף קטן שמצייר פסים וספרות.
// SIGN_TEST_SHOTS — תיקייה לתמונות העמודים (ברירת מחדל: <temp>/yotvata-sign-layouts).
// YOTVATA_CHROMIUM — דפדפן אחר (לא חובה). בלי Playwright הבדיקה מדלגת עם הודעה.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch (e) {}
const skip = chromium ? false : 'Playwright לא מותקן — הבדיקה בדפדפן נדלגת';
const shots = process.env.SIGN_TEST_SHOTS || path.join(os.tmpdir(), 'yotvata-sign-layouts');

// העמוד הקטן: 88% מה־A4, ממורכז — אותם מספרים כמו SIGN_SMALL_SCALE באפליקציה
const K = 0.88, W = 1240, H = 1754, TOL = 2;
const OX = Math.round(W * (1 - K) / 2), OY = Math.round(H * (1 - K) / 2);
const BOX = { x0: OX, y0: OY, x1: OX + Math.round(W * K), y1: OY + Math.round(H * K) };
const tolBox = { x0: BOX.x0 - TOL, y0: BOX.y0 - TOL, x1: BOX.x1 + TOL, y1: BOX.y1 + TOL };
// העמוד הקטן מצויר בווקטור בקנה מידה 0.88; ההשוואה היא מול העמוד הגדול שהוקטן
// כתמונה. ההבדל הוא רק בהחלקת קצוות. נמדד ב־Chromium 141 (Playwright 1.56), ממוצע
// הפרש לערוץ: 0.5–1.3 על כל הדף ו־6.4–8.1 על פיקסלי הדיו (גם עם הברקודים, בתחליף
// וב־JsBarcode האמיתי). הזזה של 2px נותנת 10–12 / 55–85, וקנה מידה 0.89 במקום 0.88
// נותן 12–13 / 68–87. הסף יושב באמצע, והבדיקה מוכיחה שהוא תופס את שניהם.
const MEAN_DIFF_MAX = 2.5, INK_DIFF_MAX = 15;

// מוצרים עם ברקודי EAN-13 תקינים — כדי ש־JsBarcode אמיתי יצייר EAN13 ולא CODE128
const ean = d12 => d12 + (10 - [...d12].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0) % 10) % 10;
const names = ['שוקו יטבתה 1 ליטר', 'שוקו יטבתה 2 ליטר', 'שוקו דל שומן 1 ליטר', 'שוקו בננה 1 ליטר', 'שוקו וניל 1 ליטר', 'שוקו מוקה 1 ליטר',
  'מעדן חלב שוקולד', 'מעדן חלב וניל', 'גבינה לבנה 5%'];
const products = names.map((name, i) => ({ id: 'p' + i, name, barcode: ean('7290000' + String(10011 + i * 137).padStart(5, '0')), price: 4 + i, orderIndex: i }));
const promo = (id, name, pct, ids) => ({ id, name, pct, start: '2026-09-20', end: '2026-10-31', productIds: ids });
const promos = [promo('promo_choco', 'שוקו יטבתה', 15, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']),
  promo('promo_dessert', 'מעדני חלב', 10, ['p6', 'p7']), promo('promo_cheese', 'גבינה לבנה', 12, ['p8'])];

// תחליף ל־JsBarcode: אותו API שהאפליקציה משתמשת בו (קנבס, קוד, אפשרויות), פסים
// בגובה המבוקש וספרות מתחת — מספיק כדי שהעמוד יכלול תמונת ברקוד אמיתית שמוקטנת.
const jsBarcodeStub = `window.JsBarcode = function (cv, code, o) {
  o = Object.assign({ width: 2, height: 100, margin: 10, displayValue: true, fontSize: 20, font: 'monospace', background: '#ffffff', lineColor: '#000000' }, o);
  const bits = [1, 0, 1];
  for (const ch of String(code)) { const d = ch.charCodeAt(0); for (let b = 0; b < 7; b++) bits.push(((d >> b) ^ b) & 1); }
  bits.push(1, 0, 1);
  const textH = o.displayValue ? o.fontSize + 4 : 0;
  cv.width = bits.length * o.width + o.margin * 2; cv.height = o.height + textH + o.margin * 2;
  const c = cv.getContext('2d');
  c.fillStyle = o.background; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = o.lineColor;
  bits.forEach((b, i) => { if (b) c.fillRect(o.margin + i * o.width, o.margin, o.width, o.height); });
  if (o.displayValue) { c.font = o.fontSize + 'px ' + o.font; c.textAlign = 'center'; c.fillText(code, cv.width / 2, o.margin + o.height + o.fontSize); }
};`;
const jsBarcodeSource = process.env.SIGN_TEST_JSBARCODE ? fs.readFileSync(process.env.SIGN_TEST_JSBARCODE, 'utf8') : jsBarcodeStub;

const setup = `
const initializeApp = () => ({}), getAuth = () => ({ currentUser: null });
const initializeFirestore = () => ({}), getFirestore = () => ({});
const persistentLocalCache = () => ({}), persistentMultipleTabManager = () => ({});
const signInAnonymously = () => new Promise(() => {}), onAuthStateChanged = () => () => {};
const snapshot = () => ({ exists: () => false, data: () => null, metadata: { fromCache: false, hasPendingWrites: false } });
const collection = (_db, ...p) => p.join('/'), doc = (_db, ...p) => p.join('/'), query = r => r, orderBy = () => ({}), limit = () => ({}), where = () => ({});
const getDoc = async () => snapshot(), getDocs = async () => ({ docs: [], empty: true, size: 0, forEach() {} });
const onSnapshot = () => () => {};
const setDoc = async () => {}, addDoc = async () => ({ id: 'local' }), updateDoc = async () => {}, deleteDoc = async () => {};
const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: async () => {} });
const runTransaction = async (_db, body) => body({ get: async () => snapshot(), set() {}, update() {}, delete() {} });
`;
const replay = `
const testData = ${JSON.stringify({ products, promos })};
products = testData.products; promos = testData.promos;
aiRunAnalyzer = async () => {};
window.t = {
  state: () => ({ view: currentView, step: signMaker && signMaker.step, mode: signMaker && signMaker.mode || 'promo', perPage: signMaker && signMaker.perPage,
    small: !!(signMaker && signMaker.small), smallPage: typeof signSmallPage === 'function' && signSmallPage(),
    signs: signMaker ? signMaker.signs.map(s => ({ title: s.title, kind: s.kind, price: s.price, validUntil: s.validUntil, withBarcodes: !!s.withBarcodes })) : [] }),
  // מה שהשיתוף שולח הוא בדיוק הקנבסים שבתצוגה
  exportedAreShown: () => { const cvs = [...document.querySelectorAll('#signPages canvas')]; const pg = (signMaker && signMaker._pages) || []; return pg.length === cvs.length && pg.every((c, i) => c === cvs[i]); },
  store: () => storeName
};
setView('promos'); window.t.loaded = true;
`;
// השיתוף של הטלפון: לוכדים את הקבצים במקום לפתוח חלון שיתוף
const shareCapture = `
window.__shared = [];
Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
  window.__shared.push(await Promise.all(files.map(f => new Promise(res => { const fr = new FileReader(); fr.onload = () => res({ name: f.name, url: fr.result }); fr.readAsDataURL(f); }))));
} });`;
const css = `.hidden{display:none!important}.flex{display:flex}.grid{display:grid}.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.flex-wrap{flex-wrap:wrap}.flex-1{flex:1}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.fixed{position:fixed}.sticky{position:sticky}.top-0{top:0}.bottom-0{bottom:0}.bottom-24{bottom:6rem}.inset-x-0{left:0;right:0}.inset-0{inset:0}.z-40{z-index:40}.pointer-events-none{pointer-events:none}.items-center{align-items:center}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.w-full{width:100%}.block{display:block}.max-w-3xl{max-width:48rem}.mx-auto{margin-left:auto;margin-right:auto}.bg-white{background:white}.bg-slate-100{background:#f1f5f9}.bg-slate-200{background:#e2e8f0}.bg-rose-600{background:#e11d48}.text-white{color:white}.p-3{padding:.75rem}.p-4{padding:1rem}.pb-24{padding-bottom:6rem}.rounded-lg{border-radius:.5rem}.font-black{font-weight:900}body{margin:0;font:16px Arial}header{background:#1d4ed8;padding:6px;z-index:30}button,input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}button{cursor:pointer}[class*="z-50"]{z-index:50}[class*="z-["]{z-index:60}`;

function pageHtml() {
  const html = fs.readFileSync(process.env.SIGN_TEST_APP || new URL('../index.html', import.meta.url), 'utf8');
  return html.replace(/<script\s+src="https:[^"]+"><\/script>/g, '').replace(/<link[^>]+(?:href="https:[^"]+"|rel="(?:manifest|apple-touch-icon|icon|preconnect)")[^>]*>/g, '')
    .replace(/<script type="module">[\s\S]*?<\/script>/, () => {
      const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
        .replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm, '');
      return '<script>' + shareCapture + '</script><script type="module">' + setup + moduleSource + replay + '</script>';
    })
    .replace('</head>', '<style>' + css + '</style></head>');
}

let browser, server, url;
before(async () => {
  if (skip) return;
  fs.mkdirSync(shots, { recursive: true });
  const body = pageHtml();
  server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(body); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.YOTVATA_CHROMIUM, args: ['--no-sandbox'] });
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// דף טרי של האפליקציה. JsBarcode נטען מה־CDN רק כשהשער נפתח — כדי לבדוק את
// הציור מחדש אחרי טעינה עצלה. כל בקשה אחרת החוצה נחסמת ונרשמת.
async function openApp({ holdBarcodes = false } = {}) {
  const errors = [], external = [], barcodeRequests = [];
  let release; const gate = holdBarcodes ? new Promise(r => { release = r; }) : Promise.resolve();
  const context = await browser.newContext({ viewport: { width: 430, height: 920 }, serviceWorkers: 'block', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  await context.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith(url) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    if (/jsbarcode/i.test(u)) { barcodeRequests.push(u); await gate; return route.fulfill({ status: 200, contentType: 'text/javascript', body: jsBarcodeSource }); }
    external.push(u); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.clock.setFixedTime(new Date('2026-10-01T10:00:00+03:00'));
  await page.goto(url); await page.waitForFunction(() => window.t && window.t.loaded);
  await installPixelTools(page);
  const role = (r, attrs = '') => page.locator('#app [data-role="' + r + '"]' + attrs).first();
  return { page, context, errors, external, barcodeRequests, release: () => release && release(), role,
    state: () => page.evaluate(() => window.t.state()),
    close: () => context.close() };
}

const LAYOUT = [
  { label: '4 בדף', pp: '4', small: null },
  { label: '2 בדף (קטן)', pp: '2', small: '1' },
  { label: '2 בדף (גדול)', pp: '2', small: null },
  { label: '1 בדף (רוחב)', pp: '1', small: null }
];
const [L4, L2S, L2B, L1] = [0, 1, 2, 3];
const layoutBtn = (a, i) => a.role('sign-pp', '[data-pp="' + LAYOUT[i].pp + '"]' + (LAYOUT[i].small ? '[data-small="1"]' : ':not([data-small])'));
const expectedIndex = s => s.perPage === 4 ? L4 : s.perPage === 1 ? L1 : s.small ? L2S : L2B;

// ארבעת הכפתורים בסדר, בשורה משלהם, ובדיוק אחד מסומן — זה שמתאים למצב
async function assertButtons(a, expect, why) {
  const btns = await a.page.$$eval('#app [data-role="sign-pp"]', bs => bs.map(b => ({
    label: b.textContent.trim(), pp: b.dataset.pp, small: b.dataset.small || null, on: b.classList.contains('bg-rose-600'),
    row: b.parentElement.className, head: b.parentElement.previousElementSibling ? b.parentElement.previousElementSibling.textContent.trim() : '' })));
  assert.deepEqual(btns.map(b => ({ label: b.label, pp: b.pp, small: b.small })), LAYOUT, why + ': four layout buttons in order');
  assert.ok(btns.every(b => /\bgrid-cols-4\b/.test(b.row) && b.head === 'תצוגה מקדימה של הדף'), why + ': buttons sit in their own 4-column row under the preview label');
  const on = btns.map((b, i) => b.on ? i : -1).filter(i => i >= 0);
  assert.deepEqual(on, [expect], why + ': exactly one active button, ' + LAYOUT[expect].label + ' (got ' + on.map(i => LAYOUT[i].label).join(',') + ')');
  const s = await a.state();
  assert.equal(expectedIndex(s), expect, why + ': active button matches state ' + JSON.stringify({ perPage: s.perPage, small: s.small }));
}

// כלי פיקסלים בתוך הדף — לא נוגעים במודול האפליקציה. כל "צילום" הוא כל העמודים שבתצוגה.
async function installPixelTools(page) {
  await page.evaluate(() => {
    const shots = {};
    const shown = () => [...document.querySelectorAll('#signPages canvas')];
    const copy = cv => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); return c; };
    const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const isRed = (d, i) => d[i] >= 180 && d[i + 1] <= 100 && d[i + 2] <= 130;
    window.px = {
      grab(name) { shots[name] = shown().map(copy); return shots[name].map(c => ({ w: c.width, h: c.height })); },
      live() { return shown().map(c => c.toDataURL('image/png')); },
      urls(name) { return shots[name].map(c => c.toDataURL('image/png')); },
      // פיקסלים שאינם לבן מלא מחוץ למלבן (ובתוכו), וכמה מהם אדומים
      outside(name, p, box) {
        const c = shots[name][p], d = pixels(c); let out = 0, outRed = 0, inside = 0, first = null;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255 && d[i + 3] === 255) continue;
          if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) { inside++; continue; }
          out++; if (isRed(d, i)) outRed++; if (!first) first = { x, y, rgba: [d[i], d[i + 1], d[i + 2], d[i + 3]] };
        }
        return { out, outRed, inside, first };
      },
      redBox(name, p) {
        const c = shots[name][p], d = pixels(c); let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          if (!isRed(d, (y * c.width + x) * 4)) continue;
          n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return { x0, y0, x1, y1, n };
      },
      // עמודות עם פס שחור רציף של minRun פיקסלים לפחות בין y0 ל־y1 — פסי ברקוד.
      // טקסט רצועת הברקודים (16–22px) לעולם לא מגיע לזה.
      bars(name, p, y0, y1, minRun) {
        const c = shots[name][p], d = pixels(c); let cols = 0;
        for (let x = 0; x < c.width; x++) {
          let run = 0, best = 0;
          for (let y = Math.max(0, y0); y < Math.min(c.height, y1); y++) {
            const i = (y * c.width + x) * 4;
            if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) { run++; if (run > best) best = run; } else run = 0;
          }
          if (best >= minRun) cols++;
        }
        return cols;
      },
      // העמוד הגדול מוקטן כתמונה באותו translate+scale, מול העמוד הקטן
      compare(smallName, bigName, p, k, ox, oy) {
        const s = shots[smallName][p], b = shots[bigName][p];
        const ref = document.createElement('canvas'); ref.width = s.width; ref.height = s.height;
        const ctx = ref.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ref.width, ref.height);
        ctx.translate(ox, oy); ctx.scale(k, k); ctx.drawImage(b, 0, 0);
        // mean: ממוצע הפרש לערוץ על כל הדף; inkMean: רק על פיקסלים שאינם לבנים באחד מהשניים
        const a = pixels(s), r = pixels(ref); let sum = 0, ink = 0, inkSum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const diff = Math.abs(a[i] - r[i]) + Math.abs(a[i + 1] - r[i + 1]) + Math.abs(a[i + 2] - r[i + 2]);
          sum += diff;
          if (!(a[i] + a[i + 1] + a[i + 2] === 765 && r[i] + r[i + 1] + r[i + 2] === 765)) { ink++; inkSum += diff; }
        }
        return { mean: sum / (a.length / 4 * 3), inkMean: inkSum / (ink * 3), ink };
      },
      // קובץ ששותף (PNG) מול העמוד שבתצוגה — פיקסל מול פיקסל
      async sameAsShown(dataUrl, p) {
        const img = new Image(); img.src = dataUrl; await img.decode();
        const live = shown()[p]; if (!live || img.width !== live.width || img.height !== live.height) return -1;
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
        const a = pixels(c), b = pixels(live); let off = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) off++;
        return off;
      }
    };
  });
}
const grab = (a, name) => a.page.evaluate(n => px.grab(n), name);
const live = a => a.page.evaluate(() => px.live());
const save = async (a, name) => (await a.page.evaluate(n => px.urls(n), name)).forEach((u, i, all) =>
  fs.writeFileSync(path.join(shots, name + (all.length > 1 ? '-' + (i + 1) : '') + '.png'), Buffer.from(u.split(',')[1], 'base64')));

// כל עמוד קטן: A4 לאורך, מחוץ למלבן 88% (עם 2px סבילות) לבן מלא, ובפנים יש שלט
async function assertSmallPages(a, name, pages, why) {
  const g = await grab(a, name);
  assert.deepEqual(g, Array(pages).fill({ w: W, h: H }), why + ': ' + pages + ' A4 portrait page(s)');
  for (let p = 0; p < pages; p++) {
    const o = await a.page.evaluate(([n, p, b]) => px.outside(n, p, b), [name, p, tolBox]);
    assert.equal(o.out, 0, why + ' page ' + (p + 1) + ': non-white pixel outside the centered ' + K * 100 + '% box: ' + JSON.stringify(o.first));
    assert.ok(o.inside > 10000, why + ' page ' + (p + 1) + ': the sign is drawn inside the box');
  }
}
// עמוד שאינו קטן: המסגרת האדומה יושבת ברצועת השוליים
async function assertMarginsUsed(a, name, sizes, why) {
  const g = await grab(a, name);
  assert.deepEqual(g, sizes, why + ': canvas sizes');
  for (let p = 0; p < sizes.length; p++) {
    const o = await a.page.evaluate(([n, p, b]) => px.outside(n, p, b), [name, p, tolBox]);
    assert.ok(o.out > 1000 && o.outRed > 1000, why + ' page ' + (p + 1) + ': the red frame reaches into the margin band (' + JSON.stringify(o) + ')');
  }
}
// העמוד הקטן = העמוד הגדול מוקטן; ביקורת שלילית: הזזה של 2px או קנה מידה 0.89 נכשלים
async function assertScaledCopy(a, smallName, bigName, p, why, negative = true) {
  const compare = (k, dx) => a.page.evaluate(([s, b, p, k, dx]) => px.compare(s, b, p, k, Math.round(1240 * (1 - k) / 2) + dx, Math.round(1754 * (1 - k) / 2) + dx), [smallName, bigName, p, k, dx]);
  const fmt = r => 'mean ' + r.mean.toFixed(3) + '/ch, ink ' + r.inkMean.toFixed(2) + '/ch';
  const cmp = await compare(K, 0);
  assert.ok(cmp.mean < MEAN_DIFF_MAX, why + ': small page is the big page scaled (mean diff ' + cmp.mean + ')');
  assert.ok(cmp.inkMean < INK_DIFF_MAX, why + ': small page is the big page scaled (ink diff ' + cmp.inkMean + ')');
  let line = why + ' page ' + (p + 1) + ': small vs big scaled as an image: ' + fmt(cmp) + ' over ' + cmp.ink + ' ink px';
  if (negative) {
    const shifted = await compare(K, 2), rescaled = await compare(0.89, 0);
    line += ' | shifted 2px: ' + fmt(shifted) + ' | scale 0.89: ' + fmt(rescaled);
    assert.ok(shifted.mean > MEAN_DIFF_MAX && shifted.inkMean > INK_DIFF_MAX, why + ': the comparison catches a 2px shift: ' + JSON.stringify(shifted));
    assert.ok(rescaled.mean > MEAN_DIFF_MAX && rescaled.inkMean > INK_DIFF_MAX, why + ': the comparison catches a 0.89 scale: ' + JSON.stringify(rescaled));
  }
  console.log(line);
  // המסגרת האדומה יושבת בדיוק במקום הצפוי, והגדולה מגיעה לתוך רצועת השוליים של הקטן
  const bigRed = await a.page.evaluate(([n, p]) => px.redBox(n, p), [bigName, p]);
  const smallRed = await a.page.evaluate(([n, p]) => px.redBox(n, p), [smallName, p]);
  const expectRed = { x0: OX + K * bigRed.x0, y0: OY + K * bigRed.y0, x1: OX + K * (bigRed.x1 + 1) - 1, y1: OY + K * (bigRed.y1 + 1) - 1 };
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(smallRed[k] - expectRed[k]) <= 3, why + ': red frame ' + k + ': ' + smallRed[k] + ' vs ' + expectRed[k].toFixed(1));
  assert.ok(bigRed.x0 < BOX.x0 - TOL && bigRed.y0 < BOX.y0 - TOL && bigRed.x1 >= BOX.x1 + TOL, why + ': big frame reaches the margin band: ' + JSON.stringify(bigRed));
  assert.ok(smallRed.x0 >= BOX.x0 && smallRed.y0 >= BOX.y0 && smallRed.x1 < BOX.x1 && smallRed.y1 < BOX.y1, why + ': small frame stays inside the box: ' + JSON.stringify(smallRed));
}

// בחירת מבצעים ומעבר לעריכה, עם מחיר ליחידה בכל שלט
async function pickSigns(a, ids, prices) {
  await a.role('sign-start').click();
  for (const id of ids) await a.role('sign-pick', '[data-id="' + id + '"]').click();
  await a.role('sign-next').click();
  await a.page.locator('#signPages canvas').first().waitFor({ state: 'attached' });
  for (const [i, price] of prices.entries()) {
    await a.role('sign-kind', '[data-id="' + i + '"][data-kind="unit"]').click();
    await a.role('sign-f', '[data-id="' + i + '"][data-f="price"]').fill(price);
  }
}
const cleanEnd = a => { assert.deepEqual(a.errors, []); assert.deepEqual(a.external, []); };

test('"2 בדף (קטן)": ארבעה כפתורים, וכל עמוד הוא "2 בדף (גדול)" מוקטן ל־88% עם שוליים לבנים', { skip }, async () => {
  const a = await openApp();
  try {
    assert.equal(await a.page.evaluate(() => window.t.store()), 'מיני מרקט שלום');
    await pickSigns(a, ['promo_choco', 'promo_dessert'], ['14.90', '12.90']);
    let s = await a.state();
    assert.equal(s.step, 'edit');
    assert.deepEqual(s.signs.map(x => [x.title, x.kind, x.price, x.validUntil]), [['שוקו יטבתה', 'unit', '14.90', '31.10.2026'], ['מעדני חלב', 'unit', '12.90', '31.10.2026']]);

    await assertButtons(a, L4, 'start');
    await assertMarginsUsed(a, '4', [{ w: W, h: H }], '4 per page');

    await layoutBtn(a, L2B).click();
    s = await a.state(); assert.equal(s.perPage, 2); assert.equal(s.small, false);
    await assertButtons(a, L2B, '2 big');
    await assertMarginsUsed(a, '2big', [{ w: W, h: H }], '2 big');
    await save(a, '2big');

    await layoutBtn(a, L2S).click();
    s = await a.state(); assert.equal(s.perPage, 2); assert.equal(s.small, true); assert.equal(s.smallPage, true);
    await assertButtons(a, L2S, '2 small');
    await assertSmallPages(a, '2small', 1, '2 small');
    await save(a, '2small');
    await assertScaledCopy(a, '2small', '2big', 0, '2 small');
    assert.equal(await a.page.evaluate(() => window.t.exportedAreShown()), true, 'share/save uses the shown small page');
    cleanEnd(a);
  } finally { await a.close(); }
});

test('ברקודים לקופה: רצועת הברקודים והעמוד השני מוקטנים, גם בציור מחדש אחרי ש־JsBarcode נטען, וגם בשיתוף', { skip }, async () => {
  const a = await openApp({ holdBarcodes: true });
  try {
    await pickSigns(a, ['promo_choco', 'promo_dessert'], ['14.90', '12.90']);
    await layoutBtn(a, L2S).click();
    // הספרייה עוד לא נטענה: הסימון מצייר את הרצועה עם ספרות בלבד ומבקש את הספרייה
    await a.role('sign-with-barcodes', '[data-id="0"]').click();
    await a.page.waitForFunction(() => document.querySelectorAll('#signPages canvas').length === 2);
    for (let i = 0; i < 100 && !a.barcodeRequests.length; i++) await a.page.waitForTimeout(20);
    assert.equal(await a.page.evaluate(() => typeof window.JsBarcode), 'undefined', 'JsBarcode is still loading');
    assert.equal(a.barcodeRequests.length, 1, 'the barcode library was requested once');
    let s = await a.state(); assert.equal(s.small, true); assert.equal(s.signs[0].withBarcodes, true);
    await assertSmallPages(a, 'pre', 2, 'small, before JsBarcode loads');
    const pre = await live(a);

    // הספרייה נטענת — האפליקציה מציירת מחדש לבד, ועדיין קטן
    a.release();
    await a.page.waitForFunction(first => typeof window.JsBarcode === 'function' && px.live()[0] !== first, pre[0], { polling: 100 });
    s = await a.state(); assert.equal(s.perPage, 2); assert.equal(s.small, true);
    await assertButtons(a, L2S, 'after JsBarcode loads');
    await assertSmallPages(a, '2small-barcodes', 2, 'small, after JsBarcode loads');
    await save(a, '2small-barcodes');

    // הרצועה: בעמוד הגדול מתחילה ב־y=889 (40 + 825 + 24), כותרת 48px, שתי שורות של 164px
    const stripBig = [889 + 48, 889 + 48 + 2 * 164], stripSmall = stripBig.map(y => Math.round(OY + K * y));
    const barsPre = await a.page.evaluate(([y0, y1]) => px.bars('pre', 0, y0, y1, 50), stripSmall);
    const barsSmall = await a.page.evaluate(([y0, y1]) => px.bars('2small-barcodes', 0, y0, y1, 50), stripSmall);
    assert.equal(barsPre, 0, 'before the library loads the strip has digits only');
    assert.ok(barsSmall > 100, 'after the redraw the small strip has barcode images (' + barsSmall + ' bar columns)');

    await layoutBtn(a, L2B).click();
    s = await a.state(); assert.equal(s.small, false);
    await assertMarginsUsed(a, '2big-barcodes', [{ w: W, h: H }, { w: W, h: H }], '2 big with barcodes');
    await save(a, '2big-barcodes');
    const barsBig = await a.page.evaluate(([y0, y1]) => px.bars('2big-barcodes', 0, y0, y1, 60), stripBig);
    assert.ok(barsBig > 100, 'the big strip has barcode images (' + barsBig + ' bar columns)');
    // אותו מספר עמודים, וכל עמוד קטן הוא העמוד הגדול המקביל מוקטן — כולל הברקודים
    await assertScaledCopy(a, '2small-barcodes', '2big-barcodes', 0, 'with barcodes');
    await assertScaledCopy(a, '2small-barcodes', '2big-barcodes', 1, 'with barcodes', false);

    // שיתוף/שמירה: שני קבצי PNG, כל אחד בדיוק העמוד הקטן שבתצוגה
    await layoutBtn(a, L2S).click();
    assert.deepEqual(await live(a), await a.page.evaluate(() => px.urls('2small-barcodes')), 'back to small draws the same pages');
    assert.equal(await a.page.evaluate(() => window.t.exportedAreShown()), true);
    await a.role('sign-download').click();
    await a.page.waitForFunction(() => window.__shared.length === 1);
    const shared = await a.page.evaluate(() => window.__shared[0]);
    assert.deepEqual(shared.map(f => f.name), ['shelet-2026-10-01-1.png', 'shelet-2026-10-01-2.png']);
    for (const [p, f] of shared.entries()) assert.equal(await a.page.evaluate(([u, p]) => px.sameAsShown(u, p), [f.url, p]), 0, 'shared file ' + (p + 1) + ' is the shown small page');
    assert.equal(a.barcodeRequests.length, 1, 'the library is loaded once');
    cleanEnd(a);
  } finally { await a.close(); }
});

test('כל כפתור אחר מבטל את המצב הקטן; ציור מחדש וחזרה לעריכה משאירים אותו', { skip }, async () => {
  const a = await openApp();
  try {
    await pickSigns(a, ['promo_choco', 'promo_dessert'], ['14.90', '12.90']);
    await assertMarginsUsed(a, '4', [{ w: W, h: H }], '4 per page');
    await layoutBtn(a, L2B).click(); await grab(a, '2big');
    await layoutBtn(a, L2S).click();
    await assertSmallPages(a, '2small', 1, '2 small');
    const smallUrls = await live(a);

    // ציור מחדש של הכרטיסים, הקלדה, וחזרה לבחירה ולעריכה
    await a.role('sign-kind', '[data-id="0"][data-kind="unit"]').click();
    await assertButtons(a, L2S, 'after re-render');
    assert.deepEqual(await live(a), smallUrls, 're-render draws the same small page');
    await a.role('sign-f', '[data-id="1"][data-f="price"]').fill('12.90');
    assert.equal((await a.state()).small, true);
    assert.deepEqual(await live(a), smallUrls, 'typing redraws the same small page');
    await a.role('sign-back').click();
    assert.equal((await a.state()).step, 'pick');
    await a.role('sign-next').click();
    let s = await a.state(); assert.equal(s.step, 'edit'); assert.equal(s.perPage, 2); assert.equal(s.small, true);
    await assertButtons(a, L2S, 'back to edit');
    assert.deepEqual(await live(a), smallUrls, 'back to edit draws the same small page');

    await layoutBtn(a, L2B).click();
    s = await a.state(); assert.equal(s.perPage, 2); assert.equal(s.small, false);
    await assertButtons(a, L2B, 'small -> 2 big');
    assert.deepEqual(await live(a), await a.page.evaluate(() => px.urls('2big')), 'small -> 2 big draws the original big page');

    await layoutBtn(a, L2S).click(); assert.equal((await a.state()).small, true);
    await layoutBtn(a, L4).click();
    s = await a.state(); assert.equal(s.perPage, 4); assert.equal(s.small, false);
    await assertButtons(a, L4, 'small -> 4');
    assert.deepEqual(await live(a), await a.page.evaluate(() => px.urls('4')), 'small -> 4 draws the original 4 page');

    // "1 בדף" דורש שלט אחד: מורידים את המעדנים, המצב הקטן נשמר בדרך
    await layoutBtn(a, L2S).click(); assert.equal((await a.state()).small, true);
    await a.role('sign-back').click();
    await a.role('sign-pick', '[data-id="promo_dessert"]').click();
    await a.role('sign-next').click();
    s = await a.state(); assert.equal(s.signs.length, 1); assert.equal(s.small, true);
    await assertButtons(a, L2S, 'one sign, small');
    await assertSmallPages(a, '2small-one', 1, 'one sign, small');
    await layoutBtn(a, L1).click();
    s = await a.state(); assert.equal(s.perPage, 1); assert.equal(s.small, false); assert.equal(s.smallPage, false);
    await assertButtons(a, L1, 'small -> 1');
    await assertMarginsUsed(a, '1', [{ w: H, h: W }], 'small -> 1 (landscape)');
    cleanEnd(a);
  } finally { await a.close(); }
});

test('שלושה שלטים: "2 בדף (קטן)" לא עובר, בדיוק כמו "2 בדף (גדול)"', { skip }, async () => {
  const a = await openApp();
  try {
    await pickSigns(a, ['promo_choco', 'promo_dessert', 'promo_cheese'], ['14.90', '12.90', '9.90']);
    let s = await a.state(); assert.equal(s.signs.length, 3); assert.equal(s.perPage, 4);
    await assertButtons(a, L4, 'three signs');
    const threeUrls = await live(a);
    for (const i of [L2S, L2B]) {
      await a.page.evaluate(() => { document.getElementById('toastMsg').textContent = ''; });
      await layoutBtn(a, i).click();
      s = await a.state(); assert.equal(s.perPage, 4, LAYOUT[i].label + ' with 3 signs keeps 4'); assert.equal(s.small, false);
      await assertButtons(a, L4, LAYOUT[i].label + ' with 3 signs');
      assert.equal(await a.page.locator('#toastMsg').textContent(), 'בחרת 3 מבצעים — הסר כדי לעבור ל-2 בדף');
      assert.equal(await a.page.locator('#toast').evaluate(el => el.classList.contains('hidden')), false, 'toast shown');
      assert.deepEqual(await live(a), threeUrls, LAYOUT[i].label + ' with 3 signs leaves the page as is');
    }
    cleanEnd(a);
  } finally { await a.close(); }
});

test('שלט למבצע פנימי: אותם ארבעה כפתורים, ו"2 בדף (קטן)" מוקטן גם שם', { skip }, async () => {
  const a = await openApp();
  try {
    await a.role('sign-start-internal').click();
    await a.role('sign-prod-toggle', '[data-id="p8"]').click();
    await a.role('sign-next').click();
    await a.page.locator('#signPages canvas').first().waitFor({ state: 'attached' });
    await a.role('sign-f', '[data-id="0"][data-f="price"]').fill('9.90');
    let s = await a.state(); assert.equal(s.mode, 'internal'); assert.equal(s.step, 'edit'); assert.equal(s.signs[0].title, 'גבינה לבנה 5%');
    await assertButtons(a, L4, 'internal');
    await layoutBtn(a, L2B).click(); await grab(a, 'int-2big');
    await layoutBtn(a, L2S).click();
    s = await a.state(); assert.equal(s.small, true);
    await assertButtons(a, L2S, 'internal, small');
    await assertSmallPages(a, 'int-2small', 1, 'internal, small');
    await assertScaledCopy(a, 'int-2small', 'int-2big', 0, 'internal', false);
    cleanEnd(a);
  } finally { await a.close(); }
});
