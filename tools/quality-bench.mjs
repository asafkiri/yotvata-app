// האם מדדי האיכות מבדילים צילום טוב מצילום גרוע?
//
//   node tools/quality-bench.mjs
//
// aiMeasurePageQuality רץ על כל צילום ושומר ארבעה מספרים עם הקליטה. לפני
// שמישהו חוסם תעודה על סמך המספרים האלה, צריך לראות שהם בכלל מפרידים —
// שצילום חד וצילום מטושטש נופלים בצדדים שונים של קו כלשהו. הכלי מריץ את
// הפונקציה האמיתית מתוך index.html על סצנה בסיסית ועל שבע הרעות מכוונות
// שלה, ומדפיס את המדדים זה לצד זה.
//
// חשוב: הספים ב-aiQualityAdvice הם נקודת פתיחה שנגזרה מכאן, מסצנות
// מסונתזות. הם מספיקים להערה מייעצת ואינם מספיקים לחסימה. מה שיקבע ספים
// אמיתיים הוא ההתפלגות שתצטבר בשדה, דרך photoQuality שנשמר בכל קליטה.
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

const NAMES = ['aiMeasurePageQuality', 'aiQualityAdvice'];
const sandbox = vm.createContext({ Math, Number, Uint8Array, Uint32Array, console });
vm.runInContext(NAMES.map(source).join('\n'), sandbox);

// ---------- סצנה בסיסית ----------
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const W = 1200, H = 900;
const BOX = { x: 150, y: 110, width: 900, height: 680 };

function baseScene({ paperWhite = 240, inkLuma = 68, background = 105, seed = 7 } = {}) {
  const luma = new Uint8Array(W * H);
  const rng = makeRng(seed);
  const rowStep = Math.max(8, Math.round(BOX.height / 40)), glyph = Math.max(3, Math.round(rowStep * 0.5));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const on = x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height;
      let v;
      if (on) {
        const row = (y - BOX.y) % rowStep;
        const isInk = row < glyph && x - BOX.x > BOX.width * 0.06 && x - BOX.x < BOX.width * 0.94
          && ((x * 7 + y * 3) % 5) < 2;
        v = isInk ? inkLuma : paperWhite;
      } else {
        v = background + (rng() - 0.5) * 6;
      }
      luma[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return luma;
}

// ---------- הרעות ----------
// טשטוש תיבה ברדיוס r — מדמה יד רועדת או פוקוס שהתיישב על הדלפק.
function blur(luma, r) {
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          sum += luma[yy * W + xx]; n++;
        }
      }
      out[y * W + x] = Math.round(sum / n);
    }
  }
  return out;
}

// כתם בוהק מרוכז — השתקפות של גוף תאורה על נייר חלק.
function glare(luma, fraction) {
  const out = Uint8Array.from(luma);
  const rx = Math.round(BOX.width * Math.sqrt(fraction) / 2), ry = Math.round(BOX.height * Math.sqrt(fraction) / 2);
  const cx = BOX.x + BOX.width / 2, cy = BOX.y + BOX.height / 2;
  for (let y = cy - ry; y < cy + ry; y++) {
    for (let x = cx - rx; x < cx + rx; x++) {
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      out[y * W + x] = 255;
    }
  }
  return out;
}

const scale = (luma, k) => Uint8Array.from(luma, (v) => Math.max(0, Math.min(255, Math.round(v * k))));

// רעש חיישן גאוסי — sigma 3 הוא אור יום, 6 תאורת חנות, 10 מחסן אפלולי.
// הרעש הוא מה שמקרב תמונה מטושטשת לחדה במדד היחס, ולכן הוא חייב להיות
// בכל שורת כיול ולא רק בסצנה נקייה.
function noise(luma, sigma, seed) {
  const r = makeRng(seed);
  return Uint8Array.from(luma, (v) => {
    const g = Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r()) * sigma;
    return Math.max(0, Math.min(255, Math.round(v + g)));
  });
}

const SHARP_THRESHOLD = 1.20; // חייב להתאים ל-aiQualityAdvice ב-index.html
const CASES = [
  { name: 'חד, אור יום', luma: noise(baseScene(), 3, 11), sharp: true },
  { name: 'חד, תאורת חנות', luma: noise(baseScene(), 6, 13), sharp: true },
  { name: 'חד, מחסן אפלולי', luma: noise(baseScene(), 10, 17), sharp: true },
  { name: 'תרמי דהוי, חד', luma: noise(baseScene({ inkLuma: 205 }), 6, 19), sharp: true },
  { name: 'טשטוש r=3, אור יום', luma: noise(blur(baseScene(), 3), 3, 23), sharp: false },
  { name: 'טשטוש r=3, מחסן', luma: noise(blur(baseScene(), 3), 10, 29), sharp: false },
  { name: 'טשטוש r=6, מחסן', luma: noise(blur(baseScene(), 6), 10, 31), sharp: false },
  { name: 'תרמי + טשטוש r=3', luma: noise(blur(baseScene({ inkLuma: 205 }), 3), 6, 37), sharp: false },
  { name: 'בוהק על 20% מהדף', luma: noise(glare(baseScene(), 0.20), 3, 41), sharp: true, expect: 'glare' },
  { name: 'חשוך (x0.35)', luma: noise(scale(baseScene(), 0.35), 3, 43), sharp: true, expect: 'dark' },
];

console.log(`\nמדדי איכות · ${W}x${H} · מסגרת נייר ${BOX.width}x${BOX.height}\n`);
console.log('סצנה                       חדות    ניגודיות   בוהק%  לובן   הערה לעובד');

const rows = [];
for (const { name, luma, sharp: isSharp, expect } of CASES) {
  const q = sandbox.aiMeasurePageQuality(luma, W, H, BOX);
  assert.ok(q, 'aiMeasurePageQuality returned null for ' + name);
  // הכלי מודד את הפרוקסי; paperPx נגזר בצינור האמיתי ולכן ניטרלי כאן.
  q.paperPx = 1500;
  const advice = sandbox.aiQualityAdvice(q);
  rows.push({ name, q, advice, isSharp, expect });
  console.log(
    name.padEnd(27) +
    q.sharpness.toFixed(3).padStart(6) +
    String(q.contrast).padStart(11) +
    q.glarePct.toFixed(1).padStart(8) +
    String(q.paperLuma).padStart(7) +
    '   ' + (advice ? advice.code : '—')
  );
}

console.log('\nחדות = יחס אנרגיית הגרדיאנט בצעד 1 מול צעד 2. גבוה יותר = חד יותר.');
console.log('היחס אינו תלוי בניגודיות: תעודה תרמית דהויה אך חדה נמדדת כמו שחורה וחדה.\n');

// ---------- הטענה: הסף חייב לשבת בין שתי הקבוצות ----------
// זו הבדיקה היחידה שחשובה כאן. אם קבוצה אחת דולפת לצד השני, ההערה נעשית
// רעש: או שמתעלמים ממנה כי היא צועקת על צילומים טובים, או שהיא שותקת
// בדיוק כשצריך אותה.
let failed = 0;
const sharpRows = rows.filter(r => r.isSharp), blurRows = rows.filter(r => !r.isSharp);
const worstSharp = Math.min(...sharpRows.map(r => r.q.sharpness));
const bestBlur = Math.max(...blurRows.map(r => r.q.sharpness));
// כאן ישבה פעם טענה שהסף מפריד חד ממטושטש. היא עברה על הסצנות האלה
// ונפלה בשדה, ולכן היא הוסרה יחד עם הערת הטשטוש. הסיבה: הסצנות כאן
// נבנות ישירות בגודל היעד, ואילו צילום אמיתי מוקטן מ-4032px — וההקטנה
// היא עצמה מסנן שמוחק את ההבדל. מדדתי תעודה חדה: 1.321 ב-4032px מול
// 0.918 אחרי הקטנה ל-1500, בעוד תעודה מטושטשת באמת קיבלה 0.986.
// המסקנה שנשארה: אי אפשר לכייל מדד פוקוס על סצנות מסונתזות.
// המדד עדיין מודפס למטה כדי שיהיה אפשר לעקוב, אך שום דבר אינו נטען עליו.
// בוהק ותאורה עמומה נבדלים בפחות מהטשטוש, ולכן הציפייה מקובעת במפורש:
// רעש ISO גבוה על נייר לבן דוחף פיקסלים מעל 254 ונראה כמו בוהק.
for (const r of rows.filter(x => x.expect)) {
  const got = r.advice ? r.advice.code : '—';
  if (got !== r.expect) { console.log(`כשל: "${r.name}" קיבל "${got}" במקום "${r.expect}".`); failed++; }
}
for (const r of rows.filter(x => x.isSharp && !x.expect)) {
  if (r.advice) { console.log(`כשל: "${r.name}" קיבל הערה "${r.advice.code}" והוא תקין.`); failed++; }
}
console.log(`הצילום החד הגרוע ביותר: ${worstSharp.toFixed(3)} · המטושטש הטוב ביותר: ${bestBlur.toFixed(3)} · הסף: ${SHARP_THRESHOLD}`);
if (failed) { console.log(''); process.exit(1); }
console.log('הערת הטשטוש מנוטרלת; המספרים נשמרים לכיול עתידי מצילומים אמיתיים.\n');
