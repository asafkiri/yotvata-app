// v376: דף המבצעים החודשי כקובץ אקסל. דיווח מהשטח (1.10.2026): הספק שלח את
// דף אוקטובר כ-XLSX במקום PDF, ובבורר של האייפון הקובץ היה אפור — הכפתור ביקש
// רק PDF ותמונות. עכשיו הקובץ נפתח במכשיר ונקרא ישירות מהתאים, בלי שרת.
// הגיליון כאן בנוי כמו הדף האמיתי (כותרת קבוצה, שורת כותרות, תאים ממוזגים
// לגורם האירוז, למחיר ולהנחה, כותרת עמוד שחוזרת באמצע) — בלי הקובץ עצמו.
// הרצה: node --test tools/promo-xlsx-import.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// מחרוזות משותפות: נאספות תוך כדי בניית הגיליונות. הראשונה (אינדקס 0) היא כותרת
// בטקסט מעוצב — שתי ריצות — ועם שורת הגייה שאינה חלק מהטקסט.
const STRINGS = [];
const RICH_TITLE = '<si><r><t xml:space="preserve">מארז 8 </t></r><r><rPr><b/></rPr><t>שקיות שוקו:</t></r><rPh sb="0" eb="1"><t>הגייה</t></rPh></si>';
const s = text => { if (!STRINGS.includes(text)) STRINGS.push(text); return STRINGS.indexOf(text) + 1; };
const sharedStrings = () => '<?xml version="1.0"?><sst count="' + (STRINGS.length + 1) + '">' + RICH_TITLE + STRINGS.map(t => '<si><t>' + esc(t) + '</t></si>').join('') + '</sst>';

function cell(ref, value) {
  if (value == null) return '<c r="' + ref + '" s="4"/>';
  if (typeof value === 'number') return '<c r="' + ref + '"><v>' + value + '</v></c>';
  if (value && value.inline) return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(value.inline) + '</t></is></c>';
  if (value && value.rich) return '<c r="' + ref + '" t="s"><v>0</v></c>';
  return '<c r="' + ref + '" t="s"><v>' + s(value) + '</v></c>';
}
function sheetXml(rows, merges = []) {
  return '<?xml version="1.0"?><worksheet><sheetData>' + Object.entries(rows).map(([n, cells]) =>
    '<row r="' + n + '">' + cells.map((v, i) => v === undefined ? '' : cell(String.fromCharCode(65 + i) + n, v)).join('') + '</row>').join('') +
    '</sheetData>' + (merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' : '') + '</worksheet>';
}
const HEADER = ['ברקוד', 'מק"ט ', 'תיאור מוצר ', 'גורם אירוז', 'מחיר קמעונאי', '10-30', 'הנחה'];
const PAGE = sheetXml({
  1: ['פעילות מצונן - אוקטובר 2026'],
  2: ['תחילת פעילות מתאריך 04.10.2026 ועד לתאריך 31.10.2026'],
  3: ['מסורתי 10-30'],
  4: [{ rich: true }],
  5: HEADER,
  6: [7290003029792, 329102, 'מארז 8 שקיות שוקו', "8 יח'", 15.91, "8 יח'", 0.15],
  7: [null],
  8: ['סלטי 250 :'],                               // ממוזג לרוחב A8:G8
  9: HEADER,
  10: [7290119373925, 367208, 'מטבוחה חריפה אש 250 גרם', "12 יח'", 7.8, "12 יח'", 0.15],
  11: [7290119373673, 367296, 'סלט חציל בטעם כבד 250 גרם'],
  12: [7290119373680, 367297, { inline: 'קולסלאו 250 גרם' }],
  13: [null],
  14: ['פעילות מצונן - אוקטובר 2026'],              // כותרת העמוד השני חוזרת
  15: ['תחילת פעילות מתאריך 04.10.2026 ועד לתאריך 31.10.2026'],
  16: ['פסטה/רביולי :'],
  17: HEADER,
  18: [7290003989539, 368435, 'פסטה רביולי גבינה', "11 יח'", 8.2100000000000009, "11 יח'", '18%'],
  19: [123, undefined, 'שורה פגומה'],                // ברקוד קצר — השורה לבדה מדולגת, הטבלה ממשיכה
  20: [7290000000017, 368999, 'פסטה טורטליני'],
  21: ['ללא הנחה:'],
  22: HEADER,
  23: [7290000000024, 369000, 'מוצר בלי הנחה', "6 יח'", 5],
  25: ['לידיעה! הספק רשאי לבטל חלק מהתוכנית.']
}, ['A8:G8', 'D10:D12', 'E10:E12', 'F10:F12', 'G10:G12']);
const HIDDEN = sheetXml({ 1: HEADER, 2: [7290000000031, 1, 'גיליון מוסתר', "6 יח'", 5, "6 יח'", 0.5] });
// סדר הגיליונות נקבע ב-workbook, לא במספר הקובץ: הדף הוא sheet2, והמוסתר sheet1.
const WORKBOOK = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="מבצעים" sheetId="1" r:id="rId7"/><sheet name="ישן" sheetId="2" state="hidden" r:id="rId8"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': sharedStrings(),
  'xl/worksheets/sheet2.xml': PAGE,
  'xl/worksheets/sheet1.xml': HIDDEN
};
const EXPECTED = {
  validFrom: '2026-10-04', validTo: '2026-10-31',
  groups: [
    { name: 'מארז 8 שקיות שוקו', discountPct: 15, packUnits: 8, unitPriceExVat: 15.91,
      products: [{ barcode: '7290003029792', name: 'מארז 8 שקיות שוקו', supplierItemCode: '329102' }] },
    { name: 'סלטי 250', discountPct: 15, packUnits: 12, unitPriceExVat: 7.8, products: [
      { barcode: '7290119373925', name: 'מטבוחה חריפה אש 250 גרם', supplierItemCode: '367208' },
      { barcode: '7290119373673', name: 'סלט חציל בטעם כבד 250 גרם', supplierItemCode: '367296' },
      { barcode: '7290119373680', name: 'קולסלאו 250 גרם', supplierItemCode: '367297' }] },
    { name: 'פסטה/רביולי', discountPct: 18, packUnits: 11, unitPriceExVat: 8.21,
      products: [{ barcode: '7290003989539', name: 'פסטה רביולי גבינה', supplierItemCode: '368435' },
        { barcode: '7290000000017', name: 'פסטה טורטליני', supplierItemCode: '368999' }] }
  ]
};
const XLSX_FILE = { name: 'מ 10-30.xlsx', size: 40934, type: '' };

function create(files = WORKBOOK) {
  const c = harness.runtime('yotvata');
  c.context.xlsxFiles = files;
  c.context.xlsxFile = XLSX_FILE;
  c.run(`window.JSZip = { loadAsync: async () => ({ files: Object.fromEntries(Object.keys(xlsxFiles).map(k => [k, {}])),
      file: n => xlsxFiles[n] != null ? { async: async () => xlsxFiles[n] } : null }) };
    currentView = 'promos'; promoImportOpenNextMissing = () => {};
    cloudSilent = []; runCloudTaskSilent = async (label, task) => { cloudSilent.push(task); return true; };`);
  return c;
}
const scanRequests = c => c.requests.filter(q => !q.url.endsWith('/health'));

test('הגיליון נקרא כמו הדף: תאריכים, קבוצות, תאים ממוזגים, אחוז כטקסט — וגיליון מוסתר ושורה פגומה בחוץ', async () => {
  const c = create();
  assert.deepEqual(JSON.parse(await c.run('promoSheetFromXlsx(xlsxFile).then(s => JSON.stringify(s))')), EXPECTED);
});

test('ייבוא מאקסל: בלי שרת, כל מוצר מזוהה לפי ברקוד, המק"טים נאספים ומוצר חסר נפתח באשף', async () => {
  const c = create();
  c.run(`products = [
    { id: 'choco', name: 'שוקו שקית (מארז)', barcode: '7290003029792', price: 15.91 },
    { id: 'matbucha', name: 'מטבוחה אש', barcode: '7290119373925', price: 7.8, sku: '367208' },
    { id: 'eggplant', name: 'חציל כבד', barcode: '7290119373673', price: 7.8 },
    { id: 'ravioli', name: 'רביולי גבינה', barcode: '7290003989539', price: 8.21 }
  ]; promos = [];`);
  await c.run('promoImportStart([xlsxFile])');
  assert.deepEqual(scanRequests(c), [], 'הקובץ נקרא במכשיר — אף בקשה לשירות הסריקה');
  const st = json(c, `{ stage: promoImport.stage, error: promoImport.error, missing: promoImport.missing.map(m => [m.barcode, m.name, m.price, m.sku]),
    groups: promoImport.sheet.groups.map(g => [g.name, g.productIds, g.missingCount]), mismatches: promoImportPriceMismatches(promoImport.sheet) }`);
  assert.deepEqual(st, {
    stage: 'wizard', error: '',
    missing: [['7290119373680', 'קולסלאו 250 גרם', 7.8, '367297'], ['7290000000017', 'פסטה טורטליני', 8.21, '368999']],
    groups: [['מארז 8 שקיות שוקו', ['choco'], 0], ['סלטי 250', ['matbucha', 'eggplant'], 1], ['פסטה/רביולי', ['ravioli'], 1]],
    mismatches: []
  });
  // המק"טים מהדף נכתבים רק למוצרים שאין להם — אותו כלל כמו בייבוא מ-PDF (v317).
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(json(c, 'cloudSilent.map(t => [t.path[t.path.length - 1], t.data.sku])'), [['choco', '329102'], ['eggplant', '367296'], ['ravioli', '368435']]);
});

test('כשכל המוצרים במאגר — ישר לסיכום לאישור, ופתיחת המבצעים לוקחת את התאריכים והמינימום מהדף', async () => {
  const c = create();
  c.run(`products = [
    { id: 'choco', name: 'שוקו', barcode: '7290003029792', price: 15.91 }, { id: 'm', name: 'מטבוחה', barcode: '7290119373925', price: 7.8 },
    { id: 'e', name: 'חציל', barcode: '7290119373673', price: 7.8 }, { id: 'k', name: 'קולסלאו', barcode: '7290119373680', price: 7.8 },
    { id: 'r', name: 'רביולי', barcode: '7290003989539', price: 8.2 }, { id: 't', name: 'טורטליני', barcode: '7290000000017', price: 8.21 }
  ]; promos = [];`);
  await c.run('promoImportStart([xlsxFile])');
  assert.equal(c.run('promoImport.stage'), 'summary');
  // מחיר המאגר של הרביולי (8.20) שונה מהדף (8.21) — מוצג לאישור, כמו מ-PDF.
  assert.deepEqual(json(c, 'promoImportPriceMismatches(promoImport.sheet)'), [{ name: 'רביולי', catalog: 8.2, sheet: 8.21 }]);
  const html = c.run('promoImportHtml()');
  assert.match(html, /בתוקף 2026-10-04 עד 2026-10-31/);
  assert.match(html, /מינימום 12 יח׳/);
});

test('בורר הקבצים מקבל אקסל — באייפון קובץ שלא ברשימה אפור', () => {
  const c = create();
  const accept = c.run(`(() => { let el; const orig = document.createElement; document.createElement = () => (el = { click() {} }); promoImportPick(); document.createElement = orig; return el.accept; })()`);
  assert.equal(accept, 'image/*,application/pdf,.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel');
  assert.equal(c.run(`promoImportIsXlsx({ name: 'דף.xlsm', type: '' })`), true, 'xlsm בנוי כמו xlsx');
  assert.equal(c.run(`promoImportIsXlsx({ name: 'דף.xls', type: 'application/vnd.ms-excel' })`), false, 'xls הישן אינו ZIP');
  assert.equal(c.run(`promoImportIsXlsx({ name: 'x.bin', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })`), true);
  assert.equal(c.run(`promoImportIsXlsx({ name: 'דף.pdf', type: 'application/pdf' })`), false);
});

test('אקסל שאינו דף מבצעים — הודעה ברורה, בלי ניחוש ובלי שרת', async () => {
  const c = create({ ...WORKBOOK, 'xl/worksheets/sheet2.xml': sheetXml({ 1: ['פעילות מצונן - אוקטובר 2026'], 2: [7290003029792, 1] }) });
  c.run('products = []; promos = [];');
  await c.run('promoImportStart([xlsxFile])');
  assert.equal(c.run('promoImport.stage'), 'error');
  assert.match(c.run('promoImport.error'), /לא נמצאה טבלת מבצעים.*שמור אותו כ-PDF/);
  assert.deepEqual(scanRequests(c), []);
});

test('PDF ממשיך לעבור לשירות הסריקה כמו קודם', async () => {
  const c = create();
  c.run(`products = []; promos = []; promoImportFileRaw = async () => 'data:application/pdf;base64,JVBERi0=';`);
  await c.run(`promoImportStart([{ name: 'דף.pdf', type: 'application/pdf', size: 1000 }])`);
  const sent = scanRequests(c).map(q => JSON.parse(q.body));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mode, 'promoSheet');
  assert.equal(sent[0].pdf, 'data:application/pdf;base64,JVBERi0=');
});

// ===== ממצאי הביקורת: קובץ בפורמט קצת אחר לא פותח מבצעים שגויים בשקט =====
const HEAD = ['ברקוד', 'מק"ט', 'תיאור מוצר', 'גורם אירוז', 'מחיר קמעונאי', 'הנחה'];
const parseRows = (c, rows) => json(c, 'promoSheetFromXlsxRows(' + JSON.stringify(rows) + ')');

test('שורת תאריכים ממוזגת עם תאריך קריא אחד — אין תאריכים, ולא מבצע של יום אחד', () => {
  const c = create();
  // התא הממוזג A1:F1 חוזר בכל עמודה; "31.10" בלי שנה אינו תאריך מלא.
  const line = 'תחילת פעילות מתאריך 04.10.2026 ועד לתאריך 31.10';
  const sheet = parseRows(c, [Array(6).fill(line), ['נמס:'], HEAD, ['7290110555337', '369875', 'נמס קלאסי', "12 יח'", '5.34', '0.15']]);
  assert.deepEqual([sheet.validFrom, sheet.validTo], [null, null]);
  assert.deepEqual(parseRows(c, [Array(6).fill('מתאריך 04.10.2026 ועד לתאריך 31.10.2026'), HEAD, ['7290110555337', '1', 'נמס', '12', '5', '0.15']]).validTo, '2026-10-31');
});

test('גורם אריזה בכל כתיב, ועמודות "מחיר לאחר הנחה" / "מחיר מבצע" אינן האחוז ואינן המחיר', () => {
  const c = create();
  const row = ['7290110555337', '369875', 'נמס קלאסי'];
  for (const pack of ['גורם אירוז', 'גורם אריזה', "יח' באריזה", 'יחידות בקרטון']) {
    assert.equal(parseRows(c, [['ברקוד', 'מק"ט', 'תיאור מוצר', pack, 'מחיר קמעונאי', 'הנחה'], [...row, "12 יח'", '5.34', '0.15']]).groups[0].packUnits, 12, pack);
  }
  const g = parseRows(c, [['ברקוד', 'מק"ט', 'תיאור מוצר', 'גורם אירוז', 'מחיר מבצע', 'מחיר קמעונאי', 'מחיר לאחר הנחה', 'הנחה'],
    [...row, '12', '4.54', '5.34', '4.54', '0.15']]).groups[0];
  assert.deepEqual([g.discountPct, g.unitPriceExVat], [15, 5.34]);
});

test('מספרים: תאים בכתיב מערכות (E12, ‎.0), פסיק עשרוני, ו-"1+1" שאינו אחוז', () => {
  const c = create();
  // תא מספרי שנכתב 7.29011055534E12 / 369875.0 — כמו שמייצאים כלים שאינם אקסל
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ברקוד</t></is></c><c r="B1" t="inlineStr"><is><t>מק"ט</t></is></c><c r="C1" t="inlineStr"><is><t>תיאור מוצר</t></is></c><c r="D1" t="inlineStr"><is><t>גורם אירוז</t></is></c><c r="E1" t="inlineStr"><is><t>מחיר קמעונאי</t></is></c><c r="F1" t="inlineStr"><is><t>הנחה</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>7.29011055534E12</v></c><c r="B2"><v>369875.0</v></c><c r="C2" t="inlineStr"><is><t>נמס קלאסי</t></is></c><c r="D2"><v>12.0</v></c><c r="E2"><v>5.3399999999999999</v></c><c r="F2"><v>1.5E-1</v></c></row></sheetData></worksheet>';
  const rows = json(c, 'xlsxSheetRows(' + JSON.stringify(xml) + ', [])');
  assert.deepEqual(rows[1], ['7290110555340', '369875', 'נמס קלאסי', '12', '5.34', '0.15']);
  // אותו דבר כטקסט: "...0" נקרא, "7.29E+12" (תצוגה מעוגלת) — השורה מדולגת
  const text = parseRows(c, [HEAD, ['7290110555337.0', '369875.0', 'נמס קלאסי', '12', '5,34', '12,5%'], ['7.29E+12', '1', 'נמס וניל'], ['7290110555344', '369876', 'נמס וניל']]).groups[0];
  assert.deepEqual(text.products.map(p => [p.barcode, p.supplierItemCode]), [['7290110555337', '369875'], ['7290110555344', '369876']]);
  assert.deepEqual([text.unitPriceExVat, text.discountPct], [5.34, 12.5]);
  assert.equal(parseRows(c, [HEAD, ['7290110555337', '1', 'נמס', '12', '5', '1+1']]), null, '"1+1" אינו אחוז — הקבוצה לא נפתחת, כמו בשרת');
});

test('שורת מוצר פגומה מדולגת לבדה; הטבלה נגמרת בשורה ריקה או בכותרת', () => {
  const c = create();
  const sheet = parseRows(c, [['נמס:'], HEAD,
    ['7290110555337', '1', 'נמס קלאסי', '12', '5.34', '0.15'],
    ['', '2', 'ברקוד יימסר', '12', '5.34', '0.15'],
    ['7290110555344', '3', 'נמס וניל', '12', '5.34', '0.15'],
    ['אלפרו:'],
    ['7290110558420', '4', 'אלפרו', '8', '9.81', '0.25']]);
  assert.deepEqual(sheet.groups.map(g => [g.name, g.products.map(p => p.barcode)]), [['נמס', ['7290110555337', '7290110555344']]]);
});

test('שורה מוסתרת באקסל אינה חלק מהדף — גם כשבה התא הממוזג של הטבלה', () => {
  const c = create();
  const r = (n, cells, extra = '') => '<row r="' + n + '"' + extra + '>' + cells.map((v, i) => '<c r="' + 'ABCDEF'[i] + n + '" t="inlineStr"><is><t>' + v + '</t></is></c>').join('') + '</row>';
  const xml = '<worksheet><sheetData>' + r(1, HEAD) + r(2, ['7290110555337', '1', 'נמס קלאסי', '12', '5.34', '0.15'], ' hidden="1"') +
    r(3, ['7290110555344', '2', 'נמס וניל']) + r(4, ['7290119373604', '3', 'נמס שיבולת']) + '</sheetData><mergeCells><mergeCell ref="D2:D4"/><mergeCell ref="E2:E4"/><mergeCell ref="F2:F4"/></mergeCells></worksheet>';
  const g = json(c, 'promoSheetFromXlsxRows(xlsxSheetRows(' + JSON.stringify(xml) + ', []))').groups[0];
  assert.deepEqual(g.products.map(p => p.barcode), ['7290110555344', '7290119373604']);
  assert.deepEqual([g.packUnits, g.unitPriceExVat, g.discountPct], [12, 5.34, 15]);
});

test('שני גיליונות עם טבלאות מבצע — לא מנחשים איזה, ולא פותחים מבצעים חופפים', async () => {
  const c = create({ ...WORKBOOK,
    'xl/workbook.xml': '<workbook><sheets><sheet name="10-30" sheetId="1" x:id="rId7"/><sheet name="30-60" sheetId="2" x:id="rId8"/></sheets></workbook>' });
  c.run('products = []; promos = [];');
  await c.run('promoImportStart([xlsxFile])');
  assert.equal(c.run('promoImport.stage'), 'error');
  assert.match(c.run('promoImport.error'), /2 גיליונות עם טבלאות מבצע \(10-30 · 30-60\)/);
});

test('קובץ פגום (ירד חלקית) — הודעה בעברית, לא שגיאה באנגלית', async () => {
  const c = create();
  // תוכן הכניסה נפתח רק כשקוראים אותה — שם JSZip נכשל, מחוץ לפתיחת הקובץ עצמה.
  c.run(`zipOpts = null; window.JSZip = { loadAsync: async (f, opts) => { zipOpts = opts || null;
      return { files: {}, file: n => ({ async: async () => { throw new Error('Bug : uncompressed data size mismatch'); } }) }; } };
    products = []; promos = [];`);
  await c.run('promoImportStart([xlsxFile])');
  assert.equal(c.run('promoImport.stage'), 'error');
  assert.equal(c.run('promoImport.error'), 'לא הצלחתי לפתוח את קובץ האקסל. שמור אותו כ-PDF ונסה שוב.');
  assert.deepEqual(json(c, 'zipOpts'), { checkCRC32: true }, 'בדיקת CRC בפתיחה תופסת קובץ שירד חלקית מיד');
});

test('XLS בפורמט הישן — הודעה ברורה במקום קובץ אפור', async () => {
  const c = create();
  c.run('products = []; promos = [];');
  await c.run(`promoImportStart([{ name: 'דף.xls', type: 'application/vnd.ms-excel', size: 1000 }])`);
  assert.equal(c.run('promoImport.error'), 'קובץ XLS בפורמט הישן אינו נתמך — שמור אותו כ-XLSX או כ-PDF');
  assert.deepEqual(scanRequests(c), []);
});

test('כותרות בכתיב אחר וסימני כיווניות — "תאור מוצר", שורת RLM', () => {
  const c = create();
  const sheet = parseRows(c, [['‏'], ['נמס ICE :'], ['ברקוד', 'מק"ט', 'תאור מוצר', 'גורם אירוז', 'מחיר קמעונאי', 'הנחה'], ['7290110555337', '1', 'נמס קלאסי', '12', '5.34', '15%']]);
  assert.equal(sheet.groups[0].name, 'נמס ICE');
});
