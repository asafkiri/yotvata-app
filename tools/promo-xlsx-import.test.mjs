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
  19: [123, undefined, 'שורה פגומה'],                // ברקוד קצר — סוף הטבלה
  20: [7290000000017, 368999, 'פסטה רביולי גבינה'],  // אחרי שורה פגומה — כבר לא שייך לפסטה
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
      products: [{ barcode: '7290003989539', name: 'פסטה רביולי גבינה', supplierItemCode: '368435' }] }
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
    missing: [['7290119373680', 'קולסלאו 250 גרם', 7.8, '367297']],
    groups: [['מארז 8 שקיות שוקו', ['choco'], 0], ['סלטי 250', ['matbucha', 'eggplant'], 1], ['פסטה/רביולי', ['ravioli'], 0]],
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
    { id: 'r', name: 'רביולי', barcode: '7290003989539', price: 8.2 }
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
  assert.equal(accept, 'image/*,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
