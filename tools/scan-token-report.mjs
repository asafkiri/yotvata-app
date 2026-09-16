// כמה טוקנים באמת עולה תמונת תעודה אחת.
//
//   node tools/scan-token-report.mjs גיבוי.json
//
// כל קליטה שנשמרה נושאת scanAudit.history[].usage.input_tokens — המספר
// שהשרת קיבל מ-OpenAI. הרשומה נבנית ב-yotvataScanMetadata ונשמרת עם הקליטה;
// מסך "פרטי פענוח התעודה" מציג ממנה מודל, שלב ותוצאה אבל מדלג על usage,
// ולכן המספר הזה יושב בגיבוי בלי שאף אחד רואה אותו.
//
// למה זה מעניין: טוקני הכניסה = פרומפט + רמזי קטלוג + התמונות. הפרומפט
// קבוע בערך, ולכן השיפוע של input_tokens מול מספר העמודים הוא בדיוק מחיר
// התמונה הבודדת. הוא מכריע איזה תקציב patches חל על detail:"original" —
// 1536 או 2500 — ומשם נגזרת הרזולוציה שמעבר לה אנחנו שולחים פיקסלים
// ש-OpenAI זורקת.
//
// הכלי מדפיס מספרים בלבד: טוקנים, עמודים, מודל. שום שם מוצר, ספק, סכום
// או לקוח אינו נקרא ואינו מודפס — אפשר להעתיק את הפלט בבטחה.

import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('שימוש: node tools/scan-token-report.mjs גיבוי.json');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(path, 'utf8'));
const rows = [];

// הגיבוי משנה צורה בין גרסאות, ולכן סורקים לרוחב במקום להניח מבנה.
// שתי עובדות על הצורה קובעות את האלגוריתם: usage יושב תחת scanAudit.history,
// ואילו מספר העמודים יושב בענף אחר לגמרי של אותה קליטה (paperScan). לכן לא
// די בהורשה מלמעלה למטה — צריך קודם לזהות את גבול הקליטה, ואז לאסוף משני
// הענפים בנפרד ולשדך לפי docIndex.

function collect(node, predicate, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 14) return out;
  if (Array.isArray(node)) { for (const item of node) collect(item, predicate, out, depth + 1); return out; }
  if (predicate(node)) out.push(node);
  for (const key of Object.keys(node)) collect(node[key], predicate, out, depth + 1);
  return out;
}

const hasUsage = (n) => n.usage && typeof n.usage === 'object' && Number.isFinite(n.usage.input_tokens);
const hasPages = (n) => Number.isFinite(n.pageCount) ? n.pageCount
  : Array.isArray(n.pages) ? n.pages.length
  : (Number.isFinite(n.restoredPageCount) && n.restoredPageCount > 0) ? n.restoredPageCount : null;

// קליטה = כל אובייקט שיש בו scanAudit. זהו גבול היחידה שבתוכה בטוח לשדך
// ספירת עמודים לקריאת מודל.
const records = collect(backup, (n) => n.scanAudit && typeof n.scanAudit === 'object');

// רשומת history נושאת בעצמה scanAudit של השרת, ולכן היא נתפסת כ"קליטה"
// מקוננת והקריאה שלה הייתה נספרת פעמיים. סופרים כל usage פעם אחת לפי זהות.
const counted = new Set();

for (const record of records) {
  const usages = collect(record, hasUsage).filter((n) => !counted.has(n.usage));
  usages.forEach((n) => counted.add(n.usage));
  const pageNodes = collect(record, (n) => hasPages(n) !== null);
  // ספירות עמודים לפי סדר התעודות; docIndex משדך כשהוא קיים.
  const counts = pageNodes.map(hasPages);
  for (const node of usages) {
    const index = Number.isFinite(node.docIndex) ? node.docIndex : 0;
    rows.push({
      input: node.usage.input_tokens,
      output: Number.isFinite(node.usage.output_tokens) ? node.usage.output_tokens : null,
      pages: counts[index] ?? (counts.length === 1 ? counts[0] : null),
      model: node.model || null,
      date: typeof record.date === 'string' ? record.date : null,
      attempts: Number.isFinite(node.attempts) ? node.attempts : null,
    });
  }
}

if (!rows.length) {
  console.log('\nלא נמצאה אף רשומת usage בגיבוי.');
  console.log('סביר שהגיבוי נוצר לפני v196, או שהוא מכיל רק מוצרים ולא קליטות.');
  console.log('בדוק בקליטה שנשמרה אחרי ספטמבר 2026.\n');
  process.exit(0);
}

console.log(`\nנמצאו ${rows.length} קריאות מודל בגיבוי.\n`);

const withPages = rows.filter((r) => Number.isFinite(r.pages) && r.pages > 0);
const byPages = new Map();
for (const r of withPages) {
  if (!byPages.has(r.pages)) byPages.set(r.pages, []);
  byPages.get(r.pages).push(r.input);
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

if (byPages.size) {
  console.log('עמודים   קריאות   חציון טוקני כניסה   טווח');
  for (const pages of [...byPages.keys()].sort((a, b) => a - b)) {
    const list = byPages.get(pages);
    console.log(
      String(pages).padStart(5) + String(list.length).padStart(9) +
      String(median(list)).padStart(20) +
      `   ${Math.min(...list)}–${Math.max(...list)}`
    );
  }
}

// השיפוע בין שתי ספירות עמודים שונות = מחיר תמונה אחת.
const counts = [...byPages.keys()].sort((a, b) => a - b);
if (counts.length >= 2) {
  const lo = counts[0], hi = counts[counts.length - 1];
  const perImage = (median(byPages.get(hi)) - median(byPages.get(lo))) / (hi - lo);
  console.log(`\nמחיר תמונה בודדת (שיפוע ${lo}→${hi} עמודים): ${Math.round(perImage)} טוקנים`);
  console.log(verdict(perImage));
} else {
  console.log('\nיש רק ספירת עמודים אחת בגיבוי, ולכן אי אפשר לגזור שיפוע.');
  console.log('צריך שתי קליטות עם מספר עמודים שונה — למשל אחת בת עמוד אחד ואחת בת שניים.');
  if (rows.length) {
    console.log(`לעיון: חציון טוקני כניסה על פני כל הקריאות = ${median(rows.map((r) => r.input))}`);
  }
}

function verdict(perImage) {
  if (perImage > 2100 && perImage < 2900) {
    return 'כלומר תקציב 2500 patches — המודל רואה עד כ-1850px בצלע הארוכה.\n' +
      'שליחת 3000px מבזבזת כ-40% מהפיקסלים. יעד ההקטנה: ~1850px.';
  }
  if (perImage > 1250 && perImage < 1800) {
    return 'כלומר תקציב 1536 patches — המודל רואה עד כ-1450px בצלע הארוכה.\n' +
      'שליחת 3000px מבזבזת כ-77% מהפיקסלים. יעד ההקטנה: ~1450px.';
  }
  if (perImage > 600 && perImage < 950) {
    return 'כלומר נוסחת האריחים הישנה (85 + 170 לאריח) — המודל רואה 1024x768.\n' +
      'שליחת 3000px מבזבזת כ-88% מהפיקסלים. יעד ההקטנה: ~1024px.';
  }
  return 'המספר אינו נופל על אף אחד מהתקציבים המוכרים — כדאי לבדוק אם הקליטות\n' +
    'שהושוו נבדלות גם במספר התעודות ולא רק במספר העמודים.';
}

const models = [...new Set(rows.map((r) => r.model).filter(Boolean))];
if (models.length) console.log(`\nמודלים שנצפו: ${models.join(', ')}`);
console.log('');
