// v402: כפתור "+ ארגז" בחלון הכמות לפי גודל הארגז במוצר (כמו בתנובה);
// "המוצר מתקבל רק בארגזים שלמים" נפרד ממנו ומשפיע רק על הבלש; עמודת 📦
// במסך העריכה קובעת גודל בלבד ואינה מקשיחה מוצר שלא היה קפדני.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, fixture} from './receipt-scan-harness.mjs';

const json = (r, expr) => JSON.parse(r.run('JSON.stringify(' + expr + ')'));
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function app(mutate) {
  const data = fixture('yotvata');
  if (mutate) mutate(data);
  return runtime('yotvata', {data});
}
const hidden = (r, id) => r.run(`$('${id}').classList.contains('hidden')`);
const click = (r, id) => r.events.get(id + ':click')();
const qty = r => String(r.run("$('qtyVal').value"));
// הכתיבה המושהית של עמודת 📦 (setTimeout מזויף בהרנס) — מריצים רק את מה שנוסף מאז.
function flushSince(r, n) { r.callbacks.slice(n).forEach(fn => fn()); }

test('the quantity window and the product card carry the crate controls, and the 📦 column explains itself', () => {
  assert.match(html, /<div id="qtyBoxRow" class="hidden flex gap-2 mt-3">/);
  assert.match(html, /<button id="qty_minus_box"[^>]*><i class="fa-solid fa-minus"><\/i> ארגז<\/button>/);
  assert.match(html, /<button id="qty_plus_box"[^>]*><i class="fa-solid fa-boxes-stacked"><\/i> <span id="qtyBoxLabel">\+ ארגז<\/span><\/button>/);
  assert.match(html, /<p id="qtyBoxBreak" class="hidden text-xs font-black mt-1\.5"><\/p>/);
  assert.match(html, /הגדרות ארגז — לבלש ולכפתור "\+ ארגז"/);
  assert.match(html, /<div id="prod_boxSizeWrap">\s*<label[^>]*>כמה יחידות יש בארגז\? <span class="text-slate-400">\(מפעיל את כפתור "\+ ארגז" בקליטה\)<\/span><\/label>/, 'the size field is always visible');
  assert.doesNotMatch(html, /id="prod_boxSizeWrap" class="hidden/);
  assert.match(html, /המוצר מתקבל רק בארגזים שלמים<\/span><span[^>]*>הבלש יבדוק רק כפולות של ארגז שלם\. אל תסמן אם לפעמים מגיעות גם יחידות בודדות\.<\/span>/);
  assert.match(html, /title="יח׳ בארגז — מפעיל את כפתור ״\+ ארגז״ בקליטה"/);
  assert.match(html, /עמודת 📦: יח׳ בארגז — מפעיל את כפתור ״\+ ארגז״ בקליטה\. אכיפת ״רק ארגזים שלמים״ לבלש מסומנת בכרטיס המוצר/);
  assert.doesNotMatch(html, /מלא <b>רק<\/b> למוצרים שמגיעים אך ורק בארגזים שלמים/);
  assert.match(html, /const APP_VERSION = '402'/);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v402/);
});

test('"+ ארגז" shows only for a product with a crate size, replaces the untouched 1 and then adds whole crates', () => {
  const r = app(d => { d.products[0].boxSize = 12; });
  r.run("receiptOpened = true; promptQty(products[0], 'receipt')");
  assert.equal(hidden(r, 'qtyBoxRow'), false);
  assert.equal(r.run("$('qtyBoxLabel').textContent"), '+ ארגז (12)');
  assert.equal(hidden(r, 'qtyBoxBreak'), true, 'no breakdown under a single unit');
  assert.equal(qty(r), '1');
  click(r, 'qty_plus_box');
  assert.equal(qty(r), '12', 'the first crate replaces the untouched 1 — not 13');
  assert.equal(r.run("$('qtyBoxBreak').textContent"), '= ארגז אחד מלא');
  assert.equal(hidden(r, 'qtyBoxBreak'), false);
  click(r, 'qty_plus_box');
  assert.equal(qty(r), '24');
  assert.equal(r.run("$('qtyBoxBreak').textContent"), '= 2 ארגזים מלאים');
  click(r, 'qty_plus');
  assert.equal(qty(r), '25');
  assert.equal(r.run("$('qtyBoxBreak').textContent"), '= 2 ארגזים + 1 יח׳');
  click(r, 'qty_minus_box');
  assert.equal(qty(r), '13');
  assert.equal(r.run("$('qtyBoxBreak').textContent"), '= ארגז אחד + 1 יח׳');
  click(r, 'qty_done');
  assert.equal(r.run("receiptList.find(l => l.productId === 'milk').qty"), 13, 'the quantity is received exactly as shown');
  assert.equal(hidden(r, 'qtyBoxRow'), true, 'closing hides the crate row');
  assert.equal(hidden(r, 'qtyBoxBreak'), true);

  // a unit typed or stepped first is kept — the crate is then added to it
  r.run("promptQty(products[0], 'receipt'); $('qtyVal').value = '5'");
  r.events.get('qtyVal:input')();
  click(r, 'qty_plus_box');
  assert.equal(qty(r), '17');
  click(r, 'qty_cancel');
  r.run("promptQty(products[0], 'receipt')");
  click(r, 'qty_plus');
  click(r, 'qty_plus_box');
  assert.equal(qty(r), '14');
  click(r, 'qty_cancel');

  // the same crate buttons in returns
  r.run("promptQty(products[0], 'returns')");
  assert.equal(hidden(r, 'qtyBoxRow'), false);
  click(r, 'qty_plus_box');
  click(r, 'qty_done');
  assert.equal(r.run("returnsList.find(l => l.productId === 'milk').qty"), 12);

  // a product without a crate size: no crate row, and the crate buttons do nothing
  r.run("promptQty(products[1], 'receipt')");
  assert.equal(hidden(r, 'qtyBoxRow'), true);
  assert.equal(hidden(r, 'qtyBoxBreak'), true);
  click(r, 'qty_plus_box');
  assert.equal(qty(r), '1');
  click(r, 'qty_cancel');
});

test('the crate button follows the crate size even when the product is not "whole crates only"', () => {
  const r = app(d => { d.products[0].boxSize = 12; d.products[0].boxStrict = false; });
  r.run("receiptOpened = true; promptQty(products[0], 'receipt')");
  assert.equal(hidden(r, 'qtyBoxRow'), false);
  assert.equal(r.run("$('qtyBoxLabel').textContent"), '+ ארגז (12)');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 0, 'the detective is not bound by the crate');
  click(r, 'qty_cancel');
});

test('the product card saves the crate size on its own, and the whole-crate rule only together with a size', async () => {
  const r = app(d => { d.products[0].boxSize = 12; d.products[1].boxSize = 6; d.products[1].boxStrict = false; });
  r.run('pricingCatsLoaded = true');
  // ההרנס מזייף צמתים בלי API של תקינות טופס ובלי ערך-מחרוזת של input — כרטיס המוצר משתמש בשניהם.
  Object.assign(r.node('prod_barcode'), { setCustomValidity() {}, reportValidity() { return true; }, checkValidity() { return true; } });
  for (const id of ['prod_name', 'prod_barcode', 'prod_sku', 'prod_price', 'prod_posPrice', 'prod_creditPrice', 'prod_deposit', 'prod_average', 'prod_billingPackSize', 'prod_boxSize', 'prod_cartonPrice', 'prod_cartonUnits']) {
    const n = r.node(id); let v = '';
    Object.defineProperty(n, 'value', { configurable: true, get: () => v, set: x => { v = x == null ? '' : String(x); } });
  }
  r.run('openProdModal(products[0], false, "")');
  assert.equal(r.run("$('prod_wholeCarton').checked"), true, 'a product that got its crate size before v402 was saved through the strict checkbox — it stays strict');
  assert.equal(r.run("$('prod_boxSize').value"), '12');
  r.run("$('prod_wholeCarton').checked = false");
  await r.run('saveProd(false)');
  let w = r.writes.at(-1);
  assert.equal(w.data.boxSize, 12, 'the size is kept for the "+ ארגז" button');
  assert.equal(w.data.boxStrict, false);
  assert.equal(r.run('products[0].boxStrict'), false);
  assert.equal(r.run('detectiveBoxSize(products[0])'), 0);
  r.run('qtyProduct = products[0]');
  assert.equal(r.run('qtyBoxSize()'), 12);

  r.run('openProdModal(products[0], false, "")');
  assert.equal(r.run("$('prod_wholeCarton').checked"), false, 'reopening shows the size without the rule');
  assert.equal(r.run("$('prod_boxSize').value"), '12');
  r.run("$('prod_boxSize').value = ''; $('prod_wholeCarton').checked = true");
  const before = r.writes.length;
  await r.run('saveProd(false)');
  assert.equal(r.writes.length, before, 'the rule without a size is refused');
  assert.equal(r.toasts.at(-1), 'הזן כמה יחידות יש בארגז');
  r.run("$('prod_boxSize').value = '12'");
  await r.run('saveProd(false)');
  w = r.writes.at(-1);
  assert.equal(w.data.boxSize, 12);
  assert.equal(w.data.boxStrict, true);
  assert.equal(r.run('detectiveBoxSize(products[0])'), 12);

  r.run('openProdModal(products[1], false, "")');
  assert.equal(r.run("$('prod_wholeCarton').checked"), false, 'a product saved without the rule opens unchecked');
  assert.equal(r.run("$('prod_boxSize').value"), '6');
  r.run("$('prod_boxSize').value = ''");
  await r.run('saveProd(false)');
  w = r.writes.at(-1);
  assert.equal(w.data.boxSize, 0, 'clearing the size clears the crate');
  assert.equal(w.data.boxStrict, false);
  r.run('qtyProduct = products[1]');
  assert.equal(r.run('qtyBoxSize()'), 0);

  // the carton-price calculator still fills an empty size when the rule is ticked
  r.run('openProdModal(products[1], false, "")');
  r.run("$('prod_cartonPrice').value = '60'; $('prod_cartonUnits').value = '6'; calcCartonPrice()");
  assert.equal(r.run("$('prod_boxSize').value"), '', 'the calculator alone does not set a crate size');
  r.run("$('prod_wholeCarton').checked = true; refreshProdWholeCartonUi()");
  assert.equal(r.run("$('prod_boxSize').value"), '6');
});

test('the 📦 column sets the crate size for the button and leaves the detective rule as it was', () => {
  const r = app(d => { d.products[0].boxSize = 12; });
  r.run('runCloudTaskSilent = async (name, task) => { testWrites.push(structuredClone(task)); return true; }');
  // כל הקשה היא אירוע input משלה, כמו בטלפון: "12" עובר דרך "1"
  const type = (id, keys) => { const n = r.callbacks.length; keys.forEach(v => r.run(`saveBoxSize('${id}', '${v}')`)); flushSince(r, n); return r.writes.at(-1).data; };
  assert.deepEqual(type('milk', ['6']), {boxSize: 6, boxStrict: true}, 'a product that was already strict stays strict with the new size');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 6);
  assert.deepEqual(type('milk', ['1', '12']), {boxSize: 12, boxStrict: true}, 'the pass through "1" does not drop the rule');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 12);
  assert.deepEqual(type('coffee', ['1', '12']), {boxSize: 12, boxStrict: false}, 'a product without a crate gets a size for the button only');
  assert.equal(r.run('detectiveBoxSize(products[1])'), 0);
  r.run('qtyProduct = products[1]');
  assert.equal(r.run('qtyBoxSize()'), 12);
  assert.deepEqual(type('milk', ['']), {boxSize: 0, boxStrict: false}, 'clearing the size removes the crate');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 0);
  assert.deepEqual(type('milk', ['6']), {boxSize: 6, boxStrict: false}, 'a size typed later, after the save, is for the button only');
  const strictProduct = app(d => { d.products[0].boxSize = 6; d.products[0].boxStrict = true; });
  strictProduct.run('runCloudTaskSilent = async (name, task) => { testWrites.push(structuredClone(task)); return true; }');
  const n = strictProduct.callbacks.length;
  ['', '1', '12'].forEach(v => strictProduct.run(`saveBoxSize('milk', '${v}')`)); flushSince(strictProduct, n);
  assert.deepEqual(strictProduct.writes.at(-1).data, {boxSize: 12, boxStrict: true}, 'an explicit rule survives clearing and retyping in one go');
});

test('the detective enforces crate multiples only for a product marked "whole crates only"', () => {
  const r = app(d => { d.products[0].boxSize = 12; });
  assert.equal(r.run('detectiveBoxSize(products[0])'), 12, 'no flag: a legacy crate product stays strict');
  r.run('products[0].boxStrict = false');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 0);
  r.run('products[0].boxStrict = true');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 12);
  r.run('products[0].boxSize = 1');
  assert.equal(r.run('detectiveBoxSize(products[0])'), 0, 'a size below 2 is no crate');

  // מקצה לקצה, קליטה בלי צילום: הנייר אומר 10 × ₪5 = ₪50 ו-10 יחידות, נסרקו 9.
  const setup = strict => {
    const c = app(d => { d.products[0].boxSize = 12; d.products[0].boxStrict = strict; d.products[1].price = 7; });
    c.run(`receiptOpened = true; receiptEntryMode = 'manual'; receiptAnchorSource = 'manual';
      receiptNotes = [{amount: 50, units: 10}]; recomputeNoteTotal();
      receiptList = [{productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 9}]; saveReceiptDraft(); openReconcile();`);
    return c;
  };
  const loose = setup(false);
  assert.equal(json(loose, 'detectiveBuildPriceGroups()').flatMap(g => g.actors).find(a => a.productId === 'milk').bs, 0);
  assert.equal(loose.run('rcStep'), 'detective', 'one missing unit of a 12-crate product is proposed when the rule is off');
  const sol = json(loose, 'detectiveSolutions()');
  assert.equal(sol.solutions.length, 1);
  assert.deepEqual(sol.solutions[0].components[0].allocations[0].moves.map(m => [m.productId, m.delta]), [['milk', 1]]);

  const strict = setup(true);
  assert.equal(json(strict, 'detectiveBuildPriceGroups()').flatMap(g => g.actors).find(a => a.productId === 'milk').bs, 12);
  assert.notEqual(strict.run('rcStep'), 'detective', '9 + 1 = 10 is not a whole crate of 12 — nothing is proposed');
  assert.equal(strict.run('detectiveSolutions()'), null);
});
