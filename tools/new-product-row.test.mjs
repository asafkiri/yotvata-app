// v404 — מוצר חדש בתעודה: כרטיס עם פעולה במקום מבוי סתום.
// מהשטח (גיבוי החנות 3.11.2026 09:47, אפליקציה 403 / שירות 153): תעודה 200 (ת.משלוח הקטנה), שורות 1–3 — "משקה פרו ויגן"
// 7290119390519, "משקה פרו ויגן" 7290119371600 ו"משקה חלב בטעם" 7290119387816. הקריאות קראו את הברקוד המלא והתקין, והמוצרים
// עוד לא במאגר. השירות סימן אותם verified_unknown_full בפורמט של ההסכמה (מאז שירות 146) — אותן ספרות גם בשדה barcode — והאפליקציה
// פסלה את הפורמט ("הברקוד החדש אינו קריאה מלאה ותקינה"): "הוסף והמשך" לא הופיע, הכרטיס אמר "איזה מוצר מופיע בשורה? הקלד את
// הברקוד", והקלדת אותו ברקוד נעצרה ב"הברקוד לא נמצא במאגר". השורות כאן בנויות באותו מבנה בדיוק (identity בלי מוצר, תמיכה
// מקריאה 1, קריאה 2 עם רמז קטלוג למוצר אחר, ומועמדי שם לשורה 3), עם תעודה קטנה שמתאזנת.
// מה שנבדק:
// 1. שורות בפורמט של שירות 153 הן "מוצר חדש": כותרת, כרטיס וכפתור; לא "איזה מוצר מופיע בשורה?".
// 2. "הוסף את המוצר למאגר": חלון "מוצר חדש" עם הברקוד נעול, השם והמחיר מהשורה; בשמירה המוצר נוצר, השורה משויכת, המחיר
//    נבדק (תואם) והשורה יוצאת מהרשימה מיד; נשמר בטיוטה ושורד פתיחה מחדש.
// 3. הקלדת אותו ברקוד שנקרא — שאלה אחת ואז אותו חלון; ביטול השאלה או החלון — שום דבר לא משתנה.
// 4. הקלדת ברקוד אחר שאינו במאגר — מוצר חדש עם הברקוד שהוקלד, והשורה משויכת אליו כברקוד שהוקלד מהנייר.
// 5. השורה השתנתה בזמן שהחלון פתוח — המוצר נשמר, השורה לא משויכת, וההודעה אומרת מה לעשות.
// 6. מוצר שנוסף למאגר מחוץ לקליטה (ניהול) — השורה מזוהה לבד.
// 7. הפורמט הישן (barcode ריק) כמו קודם; ברקוד שנפתר לספרות אחרות — עדיין נפסל.
// 8. מסך ההשוואה מציג "מוצר חדש בתעודה · הוסף והמשך" גם לשורות בפורמט של ההסכמה.
// הרצה: node --test tools/new-product-row.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';

const r2 = n => Math.round(n * 100) / 100;
const products = [
  { id: 'ZcENnwbLHpnsudh51vjw', name: 'מילקי שכבות בטעם טירמיסו', barcode: '7290119386079', price: 2.45 },
  // מה שהקריאות הציעו בשטח ואינו המוצר שבשורה: רמז הקטלוג של קריאה 2 בשורות 1–2, ומועמדי השם של שורה 3
  { id: 'barcode_7290119390502', name: 'יטבתה משקה שוקו ויגן בקירור 1ל', barcode: '7290119390502', price: 10.68, hidden: true },
  { id: 'barcode_7290110577230', name: 'משקה חלב בטעם פיסטוק 1 ליטר', barcode: '7290110577230', price: 8.86 },
  { id: 'barcode_7290119385829', name: 'משקה חלב בטעם טירמיסו 1 - ליטר', barcode: '7290119385829', price: 8.86 },
  { id: 'barcode_7290119387809', name: 'משקה חלב בטעם סמורס 1 ליטר', barcode: '7290119387809', price: 8.86, hidden: true }
];
const NAME_HINTS = ['barcode_7290110577230', 'barcode_7290119385829', 'barcode_7290119387809'];
const VALUE_KEYS = ['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
// שורת "מוצר חדש" כפי ששירות 153 מחזיר אותה (resolveScanBarcodes ואז ההסכמה, server.js): הברקוד גם ב-barcode
function newProductRow(line, barcode, description, quantity, unit, { strongHint = null, nameHints = [] } = {}) {
  const total = r2(quantity * unit);
  const values = { barcode, barcodeReadType: 'full', catalogHintId: null, catalogCandidateHintIds: nameHints, description, sourcePage: 1, lineNumber: line,
    quantity, unitPriceExVat: unit, grossLineTotalExVat: total, lineDiscountExVat: null, lineTotalExVat: total };
  const strong = strongHint ? { productId: strongHint.id, barcode: strongHint.barcode } : null;
  return { ...values, rowRegion: { x: 48, y: 257 + 21 * line, width: 880, height: 27 }, supplierItemCode: null, promotionText: null, confidence: .83,
    modelVerification: { version: 1, status: 'agreed', selectedRead: 0, strongSelected: false, issues: [], identity: { productId: null, barcode }, identitySupport: [1],
      candidates: [{ productId: null, barcode }, ...(strong ? [strong] : [])], fieldSupport: Object.fromEntries(VALUE_KEYS.map(k => [k, [1, 2]])),
      readings: [{ read: 0, identity: { productId: null, barcode }, values }, { read: 1, identity: { productId: null, barcode }, values: { ...values, lineNumber: null } },
        { read: 2, identity: strong, values: { ...values, lineNumber: null, catalogHintId: strong && strong.productId } }], evidence: values },
    barcodeObserved: barcode, barcodeMatchMethod: 'verified_unknown_full', barcodeSuggested: null, barcodeSuggestedProductId: null, barcodeSuggestedProductName: null,
    barcodeSuggestedCandidates: nameHints.map(id => { const p = products.find(x => x.id === id); return { productId: p.id, productName: p.name, barcode: p.barcode }; }),
    barcodeResolvedProductId: null, barcodeRetryConflict: false, barcodeUnknownProductCandidate: true, barcodeResolutionScope: nameHints.length ? 'full_catalog' : null,
    barcodeInitialObserved: barcode, barcodeRetryObserved: barcode, barcodeInitialReadType: 'full', barcodeRetryReadType: 'full', barcodeRetryApplied: true, barcodeRetryConfidence: .83 };
}
function knownRow(line, product, quantity) {
  const total = r2(quantity * product.price);
  return { sourcePage: 1, lineNumber: line, barcode: product.barcode, barcodeObserved: product.barcode, barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
    description: product.name, quantity, unitPriceExVat: product.price, grossLineTotalExVat: total, lineDiscountExVat: null, lineTotalExVat: total, confidence: .9 };
}
const VEGAN_A = '7290119390519', VEGAN_B = '7290119371600', FLAVORED = '7290119387816';
const rows = [
  newProductRow(1, VEGAN_A, 'משקה פרו ויגן', 8, 8.51, { strongHint: products[1] }),
  newProductRow(2, VEGAN_B, 'משקה פרו ויגן', 8, 8.51, { strongHint: products[1] }),
  newProductRow(3, FLAVORED, 'משקה חלב בטעם', 12, 4.45, { nameHints: NAME_HINTS }),
  knownRow(4, products[0], 12)
];
const subtotal = r2(rows.reduce((n, r) => n + r.lineTotalExVat, 0)), units = rows.reduce((n, r) => n + r.quantity, 0); // 218.96, 40
const PAPER = { noteIndex: 0, invoiceNumber: '200', documentType: 'delivery', printedTitle: 'ת.משלוח', pageCount: 1, rows, confidence: .87,
  subtotalExVat: subtotal, vatAmount: r2(subtotal * .18), totalInclVat: r2(subtotal * 1.18), printedUnits: units, printedLines: rows.length, documentDiscountExVat: null,
  warnings: ['שורה 1: אותו ברקוד EAN-13 מלא ותקין נקרא בשתי קריאות עצמאיות ואינו קיים במאגר; נמצא מועמד להוספת מוצר חדש.'] };

const json = (c, e) => JSON.parse(c.run('JSON.stringify(' + e + ')'));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const settle = () => new Promise(r => setTimeout(r, 30));
const ean13 = s => s + (10 - [...s].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0) % 10) % 10;

async function scanned(opts = {}) {
  const cloud = fakeCloud();
  const catalog = opts.products || products;
  const c = runtime('yotvata', { cloud, storage: opts.storage, data: { products: catalog, promos: [], items: [], paper: { ok: true, scan: { warnings: [], documents: [] } } } });
  await cloud.tick();
  const original = c.context.fetch;
  c.context.fetch = async (url, options) => {
    if (!String(url).endsWith('/scan')) return original(url, options);
    const body = JSON.stringify({ ok: true, serviceVersion: 153, model: 'gpt-5.6-terra · gpt-5.6-luna', requestId: 'field-200', scan: { warnings: [], documents: [structuredClone(PAPER)] } });
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  // גבול הענן: בדיקת הברקוד מול המאגר בענן (findCloudProduct…) קוראת את המוצרים שבענן המדומה
  c.context.getDocs = async ref => ({ docs: cloud.documents.entries().filter(([k]) => k.startsWith(ref.path + '/') && k.split('/').length === ref.path.split('/').length + 1)
    .map(([k, v]) => ({ id: k.split('/').at(-1), data: () => structuredClone(v) })) });
  // ההרנס מזייף צמתים בלי API של תקינות טופס ובלי ערך-מחרוזת של input — כרטיס המוצר משתמש בשניהם (כמו ב-crate-button.test)
  Object.assign(c.node('prod_barcode'), { setCustomValidity() {}, reportValidity() { return true; }, checkValidity() { return true; } });
  for (const id of ['prod_name', 'prod_barcode', 'prod_sku', 'prod_price', 'prod_posPrice', 'prod_creditPrice', 'prod_deposit', 'prod_average', 'prod_billingPackSize', 'prod_boxSize', 'prod_cartonPrice', 'prod_cartonUnits']) {
    const n = c.node(id); let v = '';
    Object.defineProperty(n, 'value', { configurable: true, get: () => v, set: x => { v = x == null ? '' : String(x); } });
  }
  c.run(`todayStr = () => '2026-11-03'; currentView = 'receiving'; mainMode = 'receiving'; receiptDupConfirmed = true; pricingCatsLoaded = true;
    testConfirms = []; showConfirm = (title, message, label, cb) => { testConfirms.push({ title, message, label }); confirmCb = cb; };`);
  if (opts.restore) return { c, cloud };
  c.run(`aiScanDocuments = [{ noteIndex: 0, amount: null, units: null, lines: null, pages: [{ dataUrl: 'data:image/jpeg;base64,UEFQRVI=', orientationConfirmed: true }] }];`);
  await c.run('yotvataStartPaperScan()');
  assert.equal(c.run('receiptPaperScanState'), 'ok', 'התעודה נקראה ואומתה: ' + JSON.stringify(c.run('receiptPaperScanProblems')));
  return { c, cloud };
}
const pending = c => json(c, 'priceAuditPendingRows(receiptPriceAudit()).map(r => ({ line: r.line, kind: priceAuditPendingKind(r), barcode: r.newProduct && r.newProduct.barcode, reason: r.reason }))');
const auditRow = (c, rowIndex) => json(c, `receiptPriceAudit().rows.find(r => r.documentIndex === 0 && r.rowIndex === ${rowIndex})`);
const lastConfirm = c => json(c, 'testConfirms.at(-1)');
const modal = c => ({ target: c.run('prodAfterSaveTarget'), barcode: c.run("$('prod_barcode').value"), locked: c.run("$('prod_barcode').readOnly"),
  name: c.run("$('prod_name').value"), price: c.run("$('prod_price').value") });
async function save(c) { await c.run('saveProd(false)'); await settle(); }
const created = c => c.writes.filter(w => w.op === 'create-if-absent' && String(w.path).includes('products')).map(w => ({ id: w.path.at(-1), name: w.data.name, barcode: w.data.barcode, price: w.data.price }));

test('rows in the service-153 format are new products: a card that says so and offers to add them, not "which product is in the row?"', async () => {
  const { c } = await scanned();
  for (const i of [0, 1, 2]) {
    const resolution = json(c, `aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[${i}])`);
    assert.equal(resolution.suggestion && resolution.suggestion.unknownProduct, true, 'the barcode filled in by the consensus read is the read itself, not a product: ' + JSON.stringify(resolution));
  }
  assert.deepEqual(pending(c).map(r => [r.line, r.kind, r.barcode]), [[1, 'new', VEGAN_A], [2, 'new', VEGAN_B], [3, 'new', FLAVORED]]);
  assert.equal(auditRow(c, 3).result, 'match', 'the known product on the same paper is checked as before');
  const html = c.run('receiptPriceAuditHtml()'), text = strip(html);
  assert.match(text, /נשארו 3 שורות להוספת מוצר חדש/);
  assert.equal((text.match(/מוצר חדש — עוד לא קיים במאגר/g) || []).length, 3);
  assert.equal((html.match(/data-role="ai-add-unknown-product" data-doc="0" data-row="[012]"/g) || []).length, 3);
  assert.match(text, /הוסף את המוצר למאגר/);
  assert.match(text, /7290119390519/, 'the barcode that was read is on the card');
  assert.match(text, /בנייר מודפס ברקוד אחר — הקלד אותו/, 'typing the printed barcode stays available as the second way');
  assert.doesNotMatch(text, /איזה מוצר מופיע בשורה/);
  assert.doesNotMatch(text, /ייתכן שהשם שגוי/);
  assert.equal(c.run("priceAuditPendingTitle([{ newProduct: {} }, { choice: {} }])"), 'נשארו 2 שורות לטיפול: 1 להוספת מוצר חדש · 1 לבחירת מוצר');
  assert.equal(c.run("priceAuditPendingTitle([{ newProduct: {} }], true)"), 'שורה אחת להוספת מוצר חדש');
});

test('"add the product" opens the new-product window with the barcode locked and the paper name and price; saving links the row, which leaves the list, and survives reopening', async () => {
  const { c } = await scanned();
  c.click('ai-add-unknown-product', '', { doc: '0', row: '0' });
  assert.deepEqual(modal(c), { target: 'ai_unknown', barcode: VEGAN_A, locked: true, name: 'משקה פרו ויגן', price: '8.51' });
  c.run("$('prod_name').value = 'יטבתה פרו ויגן 350 מ\"ל'");
  await save(c);
  assert.deepEqual(created(c), [{ id: 'barcode_' + VEGAN_A, name: 'יטבתה פרו ויגן 350 מ"ל', barcode: VEGAN_A, price: 8.51 }]);
  const linked = json(c, 'aiResolveInvoiceBarcode(aiScanResponse.scan.documents[0].rows[0])');
  assert.equal(linked.product.id, 'barcode_' + VEGAN_A);
  assert.equal(linked.method, 'user_confirmed');
  const row = auditRow(c, 0);
  assert.equal(row.productId, 'barcode_' + VEGAN_A);
  assert.equal(row.result, 'match', 'the price is checked against the new product (8.51 on paper, 8.51 saved)');
  assert.deepEqual(pending(c).map(r => r.line), [2, 3]);
  assert.match(strip(c.node('rcPriceAudit').innerHTML), /נשארו 2 שורות להוספת מוצר חדש/, 'the receiving screen is refreshed at once');
  assert.match(c.toasts.at(-1), /המוצר נוסף/);
  assert.equal(c.run('prodAfterSaveTarget'), null);
  // the draft keeps the link: a phone that reopens the receiving sees the same thing
  const b = runtime('yotvata', { storage: c.storage, handoff: false, data: { products: [...products, { id: 'barcode_' + VEGAN_A, name: 'יטבתה פרו ויגן 350 מ"ל', barcode: VEGAN_A, price: 8.51 }], promos: [], items: [], paper: { ok: true, scan: { warnings: [], documents: [] } } } });
  b.run("todayStr = () => '2026-11-03'");
  assert.equal(json(b, 'receiptPriceAudit().rows.find(r => r.documentIndex === 0 && r.rowIndex === 0)').result, 'match');
  assert.deepEqual(pending(b).map(r => r.line), [2, 3]);
});

test('typing the same barcode that was read asks once, then opens the same window; cancelling the question or the window changes nothing', async () => {
  const { c } = await scanned();
  const before = c.run('JSON.stringify(aiScanResponse)');
  c.run(`showInputModal = async () => '${VEGAN_B}'`);
  assert.equal(await c.run('aiEnterPrintedBarcode(0, 1)'), true);
  const asked = lastConfirm(c);
  assert.equal(asked.title, 'הברקוד הזה עוד לא קיים במאגר');
  assert.equal(asked.label, 'הוסף מוצר חדש');
  assert.match(asked.message, /תעודה מס׳ 200/);
  assert.match(asked.message, /שורה מודפסת 2/);
  assert.match(asked.message, /ברקוד: 7290119371600/);
  assert.match(asked.message, /בשורה: משקה פרו ויגן/);
  assert.doesNotMatch(asked.message, /טעית בספרה/, 'the scan read the same digits');
  assert.equal(c.run('prodAfterSaveTarget'), null, 'nothing opens before the answer');
  assert.equal(c.run('JSON.stringify(aiScanResponse)'), before);
  c.run('confirmCb()');
  assert.deepEqual(modal(c), { target: 'ai_unknown', barcode: VEGAN_B, locked: true, name: 'משקה פרו ויגן', price: '8.51' });
  c.run('hideProdModal()'); // ביטול החלון
  assert.equal(c.run('aiUnknownProductCreateContext'), null);
  assert.equal(c.run('JSON.stringify(aiScanResponse)'), before);
  assert.deepEqual(created(c), []);
  // ...and again, this time saving
  await c.run('aiEnterPrintedBarcode(0, 1)');
  c.run('confirmCb()');
  await save(c);
  assert.equal(auditRow(c, 1).productId, 'barcode_' + VEGAN_B);
  assert.equal(auditRow(c, 1).result, 'match');
  assert.deepEqual(pending(c).map(r => r.line), [1, 3]);
});

test('typing a different barcode that is not in the catalog creates the product with the typed barcode and links the row as a barcode typed from the paper', async () => {
  const { c } = await scanned();
  const typed = ean13('729011938782'); // ספרה אחרת מהקריאה — כאילו הסריקה טעתה
  assert.notEqual(typed, FLAVORED);
  const before = c.run('JSON.stringify(aiScanResponse)');
  c.run(`showInputModal = async () => '${typed}'`);
  assert.equal(await c.run('aiEnterPrintedBarcode(0, 2)'), true);
  assert.match(lastConfirm(c).message, /אם טעית בספרה — בטל והקלד שוב/);
  c.run('confirmCb()');
  assert.deepEqual(modal(c), { target: 'ai_manual_new', barcode: typed, locked: true, name: 'משקה חלב בטעם', price: '4.45' });
  assert.equal(c.run('JSON.stringify(aiScanResponse)'), before, 'the row changes only after the product is saved');
  c.run("scanProdBarcode()");
  assert.match(c.toasts.at(-1), /נעול/, 'the typed barcode cannot be replaced by a camera scan inside the window');
  await save(c);
  assert.deepEqual(created(c), [{ id: 'barcode_' + typed, name: 'משקה חלב בטעם', barcode: typed, price: 4.45 }]);
  const row = json(c, 'aiScanResponse.scan.documents[0].rows[2]');
  assert.equal(row.barcodeMatchMethod, 'user_confirmed');
  assert.equal(row.barcodeUserConfirmedFromMethod, 'manual_paper_barcode');
  assert.equal(row.barcodeUserEntered, typed);
  assert.equal(row.barcodeUserConfirmedFromObserved, FLAVORED, 'what the scan read is kept');
  assert.equal(auditRow(c, 2).productId, 'barcode_' + typed);
  assert.equal(auditRow(c, 2).result, 'match');
  assert.equal(c.toasts.at(-1), 'המוצר נוסף למאגר ושויך לשורה. בדיקת המחיר עודכנה.');
  assert.equal(c.run('aiManualNewProductContext'), null);
  const audit = json(c, 'aiConfirmedMappingsAudit()').find(a => a.enteredBarcode === typed);
  assert.equal(audit && audit.confirmationSource, 'manual_paper_barcode');
});

test('a row that changed while the window was open is not linked — the product is saved and the message says what to do', async () => {
  const { c } = await scanned();
  const typed = ean13('729011938782');
  c.run(`showInputModal = async () => '${typed}'`);
  await c.run('aiEnterPrintedBarcode(0, 2)');
  c.run('confirmCb()');
  c.run('aiScanResponse.scan.documents[0].rows[2].quantity = 11');
  await save(c);
  assert.equal(created(c).length, 1);
  assert.match(c.toasts.at(-1), /השורה השתנתה ולכן לא שויכה/);
  assert.equal(json(c, 'aiScanResponse.scan.documents[0].rows[2]').barcodeMatchMethod, 'verified_unknown_full');
  // a cancelled window leaves no stale link behind for a later product save
  c.run(`showInputModal = async () => '${ean13('729011938783')}'`);
  await c.run('aiEnterPrintedBarcode(0, 1)');
  c.run('confirmCb()');
  assert.equal(c.run('prodAfterSaveTarget'), 'ai_manual_new');
  c.run('hideProdModal()');
  assert.equal(c.run('aiManualNewProductContext'), null);
  c.run("openProdModal(null, false, '')");
  assert.equal(c.run('aiManualNewProductContext'), null);
});

test('a product added from management (outside the receiving) is recognised on its own', async () => {
  const { c } = await scanned();
  c.run(`products.push({ id: 'from-management', name: 'משקה פרו ויגן וניל', barcode: '${VEGAN_A}', price: 8.51 })`);
  assert.equal(auditRow(c, 0).productId, 'from-management');
  assert.equal(auditRow(c, 0).result, 'match');
  assert.deepEqual(pending(c).map(r => r.line), [2, 3]);
});

test('the older format (empty barcode) works as before; a barcode resolved to other digits is still refused', async () => {
  const { c } = await scanned();
  c.run('aiScanResponse.scan.documents[0].rows[0].barcode = null');
  assert.equal(json(c, 'aiVerifiedUnknownProductData(aiScanResponse.scan.documents[0].rows[0])').ok, true);
  c.run(`aiScanResponse.scan.documents[0].rows[0].barcode = '${products[0].barcode}'`);
  assert.equal(json(c, 'aiVerifiedUnknownProductData(aiScanResponse.scan.documents[0].rows[0])').ok, false);
  assert.equal(json(c, 'receiptPriceAudit().rows[0]').newProduct, null);
});

test('the comparison screen offers "add and continue" for the same rows, and adding one links every row with that barcode', async () => {
  const { c } = await scanned();
  c.run('aiScanEvaluation = aiEvaluateInvoiceScan(aiScanResponse)');
  const ev = json(c, 'aiScanEvaluation.barcodeSuggestions.filter(s => s.unknownProduct).map(s => s.unknownBarcode)');
  assert.deepEqual(ev, [VEGAN_A, VEGAN_B, FLAVORED]);
  const html = strip(c.run('aiInvoiceCaptureHtml()'));
  assert.equal((html.match(/מוצר חדש בתעודה/g) || []).length, 3);
  assert.match(html, /הוסף והמשך/);
  c.run("currentView = 'reconcile'; rcStep = 'ai'");
  c.click('ai-add-unknown-product', '', { doc: '0', row: '2' });
  assert.equal(modal(c).barcode, FLAVORED);
  await save(c);
  assert.equal(json(c, 'aiScanEvaluation.barcodeSuggestions.filter(s => s.unknownProduct).map(s => s.unknownBarcode)').join(), [VEGAN_A, VEGAN_B].join());
  assert.equal(auditRow(c, 2).productId, 'barcode_' + FLAVORED);
});
