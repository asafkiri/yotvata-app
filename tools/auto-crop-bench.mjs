// האם החיתוך האוטומטי מאבד טקסט?
//
//   node tools/auto-crop-bench.mjs
//
// בדיקות ה-vm ב-image-capture.test.mjs מאמתות את החוזה — מה נקרא, מה מוחזר,
// שכל סירוב נופל לפריים המלא — אבל אין להן מפענח תמונות, ולכן הן לא יכולות
// לענות על השאלה היחידה שבאמת מסוכנת: האם המסגרת שהמנוע בחר בולעת את כל
// הדיו. הכלי הזה מריץ את aiDetectPaperRegion האמיתי מתוך index.html על
// סצנות עם ground truth ידוע — איפה הנייר ואיפה כל פיקסל דיו — וסופר כמה
// דיו נפל מחוץ למסגרת. התשובה הנדרשת היא אפס.
//
// אין תלויות חיצוניות ואין קריאות רשת.

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function source(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  if (!m) throw new Error('Missing function: ' + name);
  const eol = html.indexOf('\n', m.index);
  const end = html.slice(m.index, eol).trimEnd().endsWith('}') ? eol : html.indexOf('\n}', eol) + 2;
  return html.slice(m.index, end);
}

// ---------- שכבת קנבס מינימלית ----------
// aiDetectPaperRegion מצייר את המקור לקנבס פרוקסי ומושך ממנו getImageData.
// כאן זה ממומש בהקטנת box-filter, קרוב מספיק למה שדפדפן עושה כדי שספי
// הזיהוי יתנהגו כמו בשטח.
function makeDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0, _data: null };
      canvas.getContext = () => ({
        fillStyle: '', fillRect() {},
        drawImage(img, dx, dy, dw, dh) {
          const out = new Uint8ClampedArray(dw * dh * 4);
          const sx = img.width / dw, sy = img.height / dh;
          for (let y = 0; y < dh; y++) {
            const y0 = Math.floor(y * sy), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
            for (let x = 0; x < dw; x++) {
              const x0 = Math.floor(x * sx), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
              let sum = 0, n = 0;
              for (let yy = y0; yy < y1; yy++) {
                for (let xx = x0; xx < x1; xx++) { sum += img.data[(yy * img.width + xx) * 4]; n++; }
              }
              const v = n ? Math.round(sum / n) : 0, i = (y * dw + x) * 4;
              out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
            }
          }
          canvas._data = { data: out, width: dw, height: dh };
        },
        getImageData: () => canvas._data,
        putImageData() {},
      });
      return canvas;
    },
  };
}

const NAMES = ['aiFlattenIllumination', 'aiComputePaperCropBox', 'aiRefineCropEdges', 'aiDetectPaperRegion'];

// סף הזרעים הוא הפרמטר היחיד שקובע כמה "מרושל" עדיין נחתך: הוא דורש
// שאחוז מסוים מהאריחים יהיה נייר ודאי. אפשר לכוון אותו מכאן כדי לבדוק
// את הפשרה במספרים — כמה סצנות נחתכות מול כמה חיתוכי שווא — במקום לנחש.
//
//   node tools/auto-crop-bench.mjs --seeds 0.12
const areaArg = process.argv.indexOf('--min-area');
const minArea = areaArg > -1 ? Number(process.argv[areaArg + 1]) : null;
const seedsArg = process.argv.indexOf('--seeds');
const seedThreshold = seedsArg > -1 ? Number(process.argv[seedsArg + 1]) : null;

let code = NAMES.map(source).join('\n');
// ההחלפה חייבת למצוא את הסמן; החלפת ערך בערך זהה היא תקינה ולכן
// בודקים נוכחות ולא שינוי.
function override(text, marker, value, where) {
  assert.ok(text.includes(marker), marker + ' not found in ' + where);
  return text.replace(marker, value);
}
if (seedThreshold != null) code = override(code, 'tilesCount * 0.10', 'tilesCount * ' + seedThreshold, 'aiComputePaperCropBox');
if (minArea != null) code = override(code, 'areaFraction < 0.12', 'areaFraction < ' + minArea, 'aiDetectPaperRegion');

const sandbox = vm.createContext({
  Math, Number, Uint8ClampedArray, Uint8Array, Uint32Array, Float64Array, console,
  document: makeDocument(),
  AI_CROP_PROXY_SIDE: 1500,
});
vm.runInContext(code, sandbox);

// ---------- סצנות ----------
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function scene({ width, height, paper, paperWhite, inkLuma, background, gradient = 0, seed = 5, clutter = null }) {
  const data = new Uint8ClampedArray(width * height * 4);
  const ink = new Uint8Array(width * height);
  const rng = makeRng(seed);
  const rowStep = Math.max(8, Math.round(paper.h / 40)), glyph = Math.max(3, Math.round(rowStep * 0.5));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, i = p * 4;
      const on = x >= paper.x && x < paper.x + paper.w && y >= paper.y && y < paper.y + paper.h;
      let v;
      if (on) {
        const g = gradient * ((x - paper.x) / paper.w * 0.6 + (y - paper.y) / paper.h * 0.4);
        const base = paperWhite * (1 - g);
        const row = (y - paper.y) % rowStep;
        const isInk = row < glyph && x - paper.x > paper.w * 0.06 && x - paper.x < paper.w * 0.94
          && ((x * 7 + y * 3) % 5) < 2;
        v = isInk ? base * (inkLuma / paperWhite) : base;
        if (isInk) ink[p] = 1;
      } else if (clutter && x >= clutter.x && x < clutter.x + clutter.w && y >= clutter.y && y < clutter.y + clutter.h) {
        v = clutter.luma;
      } else {
        v = background + (rng() - 0.5) * 6;
      }
      const c = Math.max(0, Math.min(255, Math.round(v)));
      data[i] = c; data[i + 1] = c; data[i + 2] = c; data[i + 3] = 255;
    }
  }
  return { data, width, height, ink, paper };
}

const W = 2000, H = 1500;
const CASES = [
  { name: 'נייר ממלא פריים (90%)', s: scene({ width: W, height: H, paper: { x: 100, y: 75, w: 1800, h: 1350 }, paperWhite: 238, inkLuma: 70, background: 95, gradient: 0.12, seed: 11 }) },
  { name: 'עובד מרושל — נייר 55%', s: scene({ width: W, height: H, paper: { x: 450, y: 340, w: 1100, h: 825 }, paperWhite: 240, inkLuma: 68, background: 110, gradient: 0.20, seed: 23 }) },
  { name: 'מרושל מאוד — נייר 35%', s: scene({ width: W, height: H, paper: { x: 650, y: 490, w: 700, h: 525 }, paperWhite: 242, inkLuma: 65, background: 120, gradient: 0.18, seed: 31 }) },
  { name: 'דלפק עץ כהה', s: scene({ width: W, height: H, paper: { x: 280, y: 210, w: 1440, h: 1080 }, paperWhite: 244, inkLuma: 60, background: 45, gradient: 0.16, seed: 43 }) },
  { name: 'לבן על שולחן לבן', s: scene({ width: W, height: H, paper: { x: 300, y: 225, w: 1400, h: 1050 }, paperWhite: 250, inkLuma: 72, background: 236, gradient: 0.08, seed: 57 }) },
  { name: 'תעודה שנייה בקצה', s: scene({ width: W, height: H, paper: { x: 500, y: 250, w: 1200, h: 1000 }, paperWhite: 240, inkLuma: 66, background: 100, gradient: 0.15, seed: 61, clutter: { x: 0, y: 300, w: 240, h: 900, luma: 235 } }) },
  { name: 'נייר חורג מהפריים', s: scene({ width: W, height: H, paper: { x: -200, y: -150, w: 2400, h: 1800 }, paperWhite: 238, inkLuma: 64, background: 100, gradient: 0.14, seed: 73 }) },
  { name: 'תרמי דהוי', s: scene({ width: W, height: H, paper: { x: 350, y: 260, w: 1300, h: 980 }, paperWhite: 236, inkLuma: 196, background: 105, gradient: 0.15, seed: 89 }) },
  // שתי הסצנות הבאות חייבות להיות מסורבות. הן השומר מפני הורדת סף
  // הזרעים: אם אחת מהן מתחילה להיחתך, הסף נמוך מדי ואנחנו ממציאים נייר.
  { name: 'אין נייר — דלפק בלבד', mustRefuse: true, s: scene({ width: W, height: H, paper: { x: 0, y: 0, w: 0, h: 0 }, paperWhite: 240, inkLuma: 70, background: 118, gradient: 0, seed: 97, clutter: { x: 700, y: 400, w: 300, h: 220, luma: 208 } }) },
  { name: 'מגבת בהירה, לא נייר', mustRefuse: true, s: scene({ width: W, height: H, paper: { x: 0, y: 0, w: 0, h: 0 }, paperWhite: 240, inkLuma: 70, background: 150, gradient: 0.3, seed: 103, clutter: { x: 200, y: 200, w: 1200, h: 900, luma: 196 } }) },
  { name: 'תווית קטנה בלבד', mustRefuse: true, s: scene({ width: W, height: H, paper: { x: 0, y: 0, w: 0, h: 0 }, paperWhite: 240, inkLuma: 70, background: 112, gradient: 0, seed: 109, clutter: { x: 820, y: 600, w: 360, h: 270, luma: 244 } }) },
];

console.log(`\nחיתוך אוטומטי על ${CASES.length} סצנות · מקור ${W}x${H} · פרוקסי ${sandbox.AI_CROP_PROXY_SIDE}px\n`);
console.log('סצנה                        החלטה      דיו שאבד   רקע שהוסר   רווח patches');

let failures = 0, cropped = 0;
for (const { name, s, mustRefuse } of CASES) {
  const report = {};
  let region = null;
  try { region = sandbox.aiDetectPaperRegion({ ...s, naturalWidth: s.width, naturalHeight: s.height }, s.width, s.height, report); }
  catch (error) { console.log(`  ${name}: שגיאה — ${error.message}`); failures++; continue; }

  if (!region) {
    console.log(name.padEnd(28) + 'ללא חיתוך'.padEnd(11) + (mustRefuse ? '✓ כנדרש' : '—').padStart(9) + '—'.padStart(12) + '   ' + (report.reason || '?'));
    continue;
  }
  cropped++;
  let lost = 0, total = 0;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (!s.ink[y * s.width + x]) continue;
      total++;
      if (x < region.x || x >= region.x + region.width || y < region.y || y >= region.y + region.height) lost++;
    }
  }
  const removed = 100 * (1 - (region.width * region.height) / (s.width * s.height));
  // הרווח האמיתי הוא ביחס תקציב ה-patches שהולך לנייר: הצלע הארוכה של
  // האזור הנשלח מול הצלע הארוכה של הפריים המלא.
  const gain = Math.max(s.width, s.height) / Math.max(region.width, region.height);
  // חיתוך על סצנה שאין בה נייר הוא כשל חמור בדיוק כמו אובדן דיו: המנוע
  // המציא מסגרת, והעובד יקבל תעודה קטועה בלי לדעת.
  if (lost > 0 || mustRefuse) failures++;
  console.log(
    name.padEnd(28) + 'נחתך'.padEnd(11) +
    (mustRefuse ? 'שווא ✗' : lost ? `${lost} ✗` : '0 ✓').padStart(9) +
    (removed.toFixed(0) + '%').padStart(12) +
    ('×' + gain.toFixed(2)).padStart(13)
  );
}

console.log(`\nנחתכו ${cropped}/${CASES.length}. סצנות שאיבדו דיו: ${failures}.`);
if (failures) {
  console.log("\nכשל: או שהחיתוך חתך טקסט, או שהוא המציא מסגרת בסצנה ללא נייר.");
  console.log('עדיף לא לחתוך בכלל מאשר לחתוך שורת מוצר.\n');
  process.exit(1);
}
console.log('אף סצנה לא איבדה ולו פיקסל דיו אחד.\n');
