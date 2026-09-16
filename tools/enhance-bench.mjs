// מדידה של שיפור התמונה לפני השליחה למודל.
//
// הכלי מחלץ את פונקציות השיפור מתוך index.html עצמו — אותו מנגנון שבו
// משתמשות בדיקות האפליקציה — ומריץ אותן על סצנות מסונתזות עם ground truth
// ידוע: איפה הנייר, איפה הדיו, ומה הערכים המקוריים. כך אפשר להשוות מועמדים
// במספרים במקום בהיגיון.
//
//   node tools/enhance-bench.mjs            # רשת הסצנות המלאה
//   node tools/enhance-bench.mjs --size 3000  # ברזולוציית הייצור (איטי)
//
// אין תלויות חיצוניות ואין קריאות רשת. שום מודל אינו נקרא.

import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// חילוץ גוף פונקציה לפי שם — אותה שיטה שבה משתמשת tools/image-capture.test.mjs:
// לפי סימנים בטקסט ולא לפי מספרי שורות, כדי שהכלי לא יתיישן בשקט.
function source(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  if (!m) throw new Error('Missing function: ' + name);
  const eol = html.indexOf('\n', m.index);
  const end = html.slice(m.index, eol).trimEnd().endsWith('}') ? eol : html.indexOf('\n}', eol) + 2;
  return html.slice(m.index, end);
}

const NAMES = ['aiFlattenIllumination', 'aiInkAnchorContrast', 'aiEnhanceDocumentPixels'];
const sandbox = vm.createContext({ Math, Number, Uint8ClampedArray, Uint32Array, Float64Array, console });
vm.runInContext(NAMES.map(source).join('\n'), sandbox);
const live = Object.fromEntries(NAMES.map((n) => [n, sandbox[n]]));

// ---------- בניית סצנות ----------
// כל סצנה מחזירה RGBA + מסכות אמת: paper=1 לפיקסל נייר, ink=1 לפיקסל דיו.

function blankScene(width, height) {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    paper: new Uint8Array(width * height),
    ink: new Uint8Array(width * height),
    width, height,
  };
}

function put(scene, x, y, value) {
  const p = y * scene.width + x, i = p * 4;
  scene.data[i] = value; scene.data[i + 1] = value; scene.data[i + 2] = value; scene.data[i + 3] = 255;
  return p;
}

// דטרמיניסטי לחלוטין — אותו זרע נותן אותן סצנות בכל הרצה.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function buildScene({ width, height, paperFill, paperWhite, inkLuma, background, gradient = 0, shadowBand = false, noise = 2, seed = 7 }) {
  const scene = blankScene(width, height);
  const rng = makeRng(seed);
  const pw = Math.round(width * paperFill), ph = Math.round(height * paperFill);
  const px0 = Math.round((width - pw) / 2), py0 = Math.round((height - ph) / 2);
  // גובה שורת טקסט ביחס לדף — מחקה תעודת ספק צפופה (כ-40 שורות לעמוד).
  const rowStep = Math.max(6, Math.round(ph / 40));
  const glyph = Math.max(2, Math.round(rowStep * 0.5));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onPaper = x >= px0 && x < px0 + pw && y >= py0 && y < py0 + ph;
      let value;
      if (onPaper) {
        // מדרון תאורה אלכסוני + רצועת צל אופציונלית לרוחב הדף.
        const g = gradient * ((x - px0) / pw * 0.6 + (y - py0) / ph * 0.4);
        let base = paperWhite * (1 - g);
        if (shadowBand && y - py0 > ph * 0.55 && y - py0 < ph * 0.75) base *= 0.72;
        const row = (y - py0) % rowStep;
        const inRow = row < glyph && x - px0 > pw * 0.06 && x - px0 < pw * 0.94;
        // דפוס תווים דליל — לא כל פיקסל בשורה הוא דיו.
        const isInk = inRow && ((x * 7 + y * 3) % 5) < 2;
        value = isInk ? base * (inkLuma / paperWhite) : base;
        const p = put(scene, x, y, Math.max(0, Math.min(255, Math.round(value + (rng() - 0.5) * noise))));
        scene.paper[p] = 1;
        if (isInk) scene.ink[p] = 1;
      } else {
        value = background + (rng() - 0.5) * noise * 3;
        put(scene, x, y, Math.max(0, Math.min(255, Math.round(value))));
      }
    }
  }
  return scene;
}

function scenes(size) {
  const width = size, height = Math.round(size * 0.75);
  const base = { width, height };
  return [
    { name: 'A · תרמי ממלא פריים', ...buildScene({ ...base, paperFill: 0.92, paperWhite: 238, inkLuma: 198, background: 90, gradient: 0.10, seed: 11 }) },
    { name: 'B · תעודה רגילה, מדרון תאורה', ...buildScene({ ...base, paperFill: 0.78, paperWhite: 236, inkLuma: 70, background: 105, gradient: 0.30, seed: 23 }) },
    { name: 'C · רצועת צל על הדף', ...buildScene({ ...base, paperFill: 0.80, paperWhite: 245, inkLuma: 60, background: 120, gradient: 0.18, shadowBand: true, seed: 31 }) },
    { name: 'D · לבן על שולחן לבן', ...buildScene({ ...base, paperFill: 0.70, paperWhite: 250, inkLuma: 75, background: 235, gradient: 0.08, seed: 43 }) },
    { name: 'E · דלפק עץ כהה', ...buildScene({ ...base, paperFill: 0.72, paperWhite: 242, inkLuma: 65, background: 48, gradient: 0.15, seed: 57 }) },
    { name: 'F · עובד מרושל — נייר 45%', ...buildScene({ ...base, paperFill: 0.45, paperWhite: 240, inkLuma: 68, background: 140, gradient: 0.22, seed: 61 }) },
    { name: 'G · העתק פחמן דהוי', ...buildScene({ ...base, paperFill: 0.76, paperWhite: 240, inkLuma: 182, background: 110, gradient: 0.20, seed: 73 }) },
    { name: 'H · מחסן חשוך', ...buildScene({ ...base, paperFill: 0.74, paperWhite: 150, inkLuma: 48, background: 35, gradient: 0.25, seed: 89 }) },
  ];
}

// ---------- מדדים ----------

function lumaOf(data, i) { return ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0; }

function measure(scene, data) {
  const { paper, ink, width, height } = scene;
  const paperVals = [], inkVals = [];
  const greys = new Set();
  // מעוך נספר על רקע הנייר בלבד. דיו שהושחר ל-0 הוא התנהגות רצויה
  // ואסור שייראה כנזק — ערבוב השניים הופך את המדד לחסר משמעות.
  let crushed = 0, backgroundCount = 0, inkCrushed = 0;
  for (let p = 0; p < width * height; p++) {
    if (!paper[p]) continue;
    const v = lumaOf(data, p * 4);
    if (ink[p]) { inkVals.push(v); if (v === 0) inkCrushed++; }
    else { paperVals.push(v); greys.add(v); backgroundCount++; if (v === 0) crushed++; }
  }
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const paperMedian = median(paperVals), inkMedian = median(inkVals);
  // אנרגיית תדר גבוה — פרוקסי לעלות ה-JPEG בבתים.
  let energy = 0, n = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = (y * width + x) * 4;
      const gx = lumaOf(data, i) - lumaOf(data, i + 8);
      const gy = lumaOf(data, i) - lumaOf(data, i + width * 8);
      energy += Math.abs(gx) + Math.abs(gy); n++;
    }
  }
  return {
    paperMedian, inkMedian,
    separation: paperMedian - inkMedian,
    greyLevels: greys.size,
    crushedPct: backgroundCount ? (100 * crushed / backgroundCount) : 0,
    inkCrushedPct: inkVals.length ? (100 * inkCrushed / inkVals.length) : 0,
    energy: n ? energy / n : 0,
  };
}

// ---------- מועמדים ----------
// V0 הוא הקוד החי מתוך index.html. כל השאר מוגדרים כאן ומועתקים לאפליקציה
// רק אחרי שהמדידה הכריעה.

const candidates = {
  'V0 · הקוד החי': (data, w, h) => live.aiEnhanceDocumentPixels(data, w, h),

  'V1 · השטחה בלבד': (data, w, h) => {
    const flattened = live.aiFlattenIllumination(data, w, h);
    // העוגן רץ רק כשההשטחה ויתרה — כך הוא לעולם אינו מכייל את עצמו
    // על פיקסלים שההשטחה כבר שינתה.
    if (flattened) return true;
    return live.aiInkAnchorContrast(data, w, h);
  },

  'V2 · עוגן בלבד': (data, w, h) => live.aiInkAnchorContrast(data, w, h),

  'V3 · ללא-255, שיפוע 3.0': (data, w, h) => {
    const flattened = live.aiFlattenIllumination(data, w, h);
    return anchorRestrained(data, w, h, flattened, 3.0) || flattened;
  },
  'V4 · ללא-255, שיפוע 2.4': (data, w, h) => {
    const flattened = live.aiFlattenIllumination(data, w, h);
    return anchorRestrained(data, w, h, flattened, 2.4) || flattened;
  },
  'V5 · ללא-255, שיפוע 1.8': (data, w, h) => {
    const flattened = live.aiFlattenIllumination(data, w, h);
    return anchorRestrained(data, w, h, flattened, 1.8) || flattened;
  },
};

// עוגן דיו מרוסן: מתעלם מפיקסלים שנקטמו ל-255 בהשטחה (הם מטים את
// אחוזון ה-99 כלפי מעלה ומחשיכים את הנייר), ומגביל את השיפוע כדי שרצועת
// ההשחרה המוחלטת לא תבלע דיו דהוי.
function anchorRestrained(data, width, height, afterFlatten, slopeCap) {
  if (!width || !height || data.length < width * height * 4) return false;
  const x0 = Math.floor(width * 0.15), x1 = Math.ceil(width * 0.85);
  const y0 = Math.floor(height * 0.10), y1 = Math.ceil(height * 0.90);
  const hist = new Uint32Array(256);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      const v = ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0;
      // אחרי השטחה, 255 הוא ברובו תוצר קטימה ולא לובן אמיתי.
      if (afterFlatten && v >= 255) continue;
      hist[v]++; total++;
    }
  }
  if (!total) return false;
  let cum = 0, high = 255;
  const highTarget = total * 0.99;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= highTarget) { high = v; break; } }
  if (high < 60) return false;
  const cut = Math.max(24, Math.round(high * 0.35));
  let inkTotal = 0;
  for (let v = cut; v < 256; v++) inkTotal += hist[v];
  if (!inkTotal) return false;
  const lowTarget = inkTotal * 0.01;
  cum = 0; let low = high;
  for (let v = cut; v < 256; v++) { cum += hist[v]; if (cum >= lowTarget) { low = v; break; } }
  const span = high - low;
  if (span < 8) return false;
  // תקרת שיפוע 1.8 במקום 3.0: מעל זה רצועת ההשחרה בולעת דיו דהוי.
  const slope = Math.min(slopeCap, 233 / span);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(243 - (high - v) * slope);
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const out = lut[((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0];
    data[i] = out; data[i + 1] = out; data[i + 2] = out;
  }
  return true;
}

// ---------- הרצה ----------

const sizeArg = process.argv.indexOf('--size');
const size = sizeArg > -1 ? Number(process.argv[sizeArg + 1]) : 1200;
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > -1 ? process.argv[onlyArg + 1] : null;

const list = scenes(size);
const names = Object.keys(candidates).filter((k) => !only || k.includes(only));

console.log(`\nרשת סצנות ב-${size}x${Math.round(size * 0.75)} · ${list.length} סצנות · ${names.length} מועמדים\n`);

const totals = Object.fromEntries(names.map((n) => [n, { sep: 0, grey: 0, crushed: 0, energy: 0, darkened: 0, applied: 0 }]));

for (const scene of list) {
  const before = measure(scene, scene.data);
  console.log(`\n${scene.name}`);
  console.log(`  לפני: נייר=${before.paperMedian} דיו=${before.inkMedian} הפרדה=${before.separation} רמות=${before.greyLevels} מעוך=${before.crushedPct.toFixed(1)}% אנרגיה=${before.energy.toFixed(1)}`);
  for (const name of names) {
    const copy = new Uint8ClampedArray(scene.data);
    let applied = false;
    try { applied = !!candidates[name](copy, scene.width, scene.height); }
    catch (error) { console.log(`  ${name}: שגיאה — ${error.message}`); continue; }
    const after = measure(scene, copy);
    const t = totals[name];
    t.sep += after.separation - before.separation;
    t.grey += after.greyLevels - before.greyLevels;
    t.crushed += after.crushedPct;
    t.energy += (after.energy - before.energy) / Math.max(1, before.energy) * 100;
    t.darkened += Math.max(0, before.paperMedian - after.paperMedian);
    if (applied) t.applied++;
    const flag = after.paperMedian < before.paperMedian - 2 ? ' ⚠ נייר הוכהה' : '';
    console.log(`  ${name}: נייר=${after.paperMedian} דיו=${after.inkMedian} הפרדה=${after.separation} (${sign(after.separation - before.separation)}) רמות=${after.greyLevels} (${sign(after.greyLevels - before.greyLevels)}) מעוך=${after.crushedPct.toFixed(1)}% אנרגיה=${sign(Math.round((after.energy - before.energy) / Math.max(1, before.energy) * 100))}%${applied ? '' : ' [לא הופעל]'}${flag}`);
  }
}

console.log('\n\n=== סיכום על פני כל הסצנות ===');
console.log('מועמד                          הפרדה   רמות   מעוך%   בתים%   הכהיית נייר   הופעל');
for (const name of names) {
  const t = totals[name], k = list.length;
  console.log(
    name.padEnd(30) +
    sign(Math.round(t.sep / k)).padStart(6) +
    sign(Math.round(t.grey / k)).padStart(7) +
    (t.crushed / k).toFixed(1).padStart(8) +
    sign(Math.round(t.energy / k)).padStart(8) +
    (t.darkened / k).toFixed(1).padStart(14) +
    `${t.applied}/${k}`.padStart(9)
  );
}
console.log('\nהפרדה גבוהה = דיו נבדל מנייר. רמות גבוהות = פחות מידע טונלי אבד.');
console.log('מעוך% = פיקסלי נייר שנמחצו ל-0. בתים% = פרוקסי לגודל ה-JPEG. הכהיית נייר צריכה להיות 0.\n');

function sign(n) { return n > 0 ? '+' + n : String(n); }
