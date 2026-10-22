// v398: one sentence per saved receipt — what the state is and what to do — from the same
// calculations the history screen already uses (receiptDiscrepancyInfo); a "מה לעשות עכשיו" box
// with one button; the stored status (status, aiAudit.hasDiscrepancy) written back when a
// shortage closes or reopens; a plain-words summary at the top of the full backup; and the
// receiving panel and cards that say what to do instead of "לטיפול" / "צריך להשלים את הבדיקה".
// From the field (the store's backup, 22.10.2026, app v397): all 18 scanned receipts were read in
// full and balanced, but the file showed only needs_review / hasDiscrepancy: true / status: "open",
// and the owner asked whether anything had been received at all.
// Run: node --test tools/plain-receipt-status.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';

const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));

// Paper A×12 and B×10 at ₪5 (22 units, ₪110); scanned A×4 (short 8 = ₪40) and B×12 (over 2 = ₪10).
const LINE_A = { productId: 'A', name: 'מוצר א בדיקה', barcode: '7290000000008', qty: 4, noteQty: 12, unitPrice: 5, basePrice: 5, lineTotal: 20, promoPct: 0 };
const LINE_B = { productId: 'B', name: 'מוצר ב בדיקה', barcode: '7290000000015', qty: 12, noteQty: 10, unitPrice: 5, basePrice: 5, lineTotal: 60, promoPct: 0 };
function receipt(overrides = {}) {
  return { id: 'rc-1', timestamp: Date.parse('2026-10-20T09:34:00'), date: '2026-10-20', status: 'open', noDoc: false,
    noteParts: [{ units: 22, amount: 110 }], noteTotalInc: 110, totalExVat: 80, totalIncVat: 80, grossExVat: 80, calculatedExVat: 80,
    count: 2, supplierDiscount: 0, roundingAdjustment: 0, unresolvedAmountGap: 0, unresolvedUnitsGap: 0, supplierCreditClaim: null,
    items: [structuredClone(LINE_A), structuredClone(LINE_B)], aiAudit: null, shortCreditNotes: [], ...overrides };
}
const balancedLines = () => [{ ...structuredClone(LINE_A), qty: 12, lineTotal: 60 }, { ...structuredClone(LINE_B), qty: 10, lineTotal: 50 }];
const shortOnly = () => [structuredClone(LINE_A), { ...structuredClone(LINE_B), qty: 10, lineTotal: 50 }];
const shortAndOver8 = () => [structuredClone(LINE_A), { ...structuredClone(LINE_B), qty: 18, lineTotal: 90 }];
const SHORTAGE = { type: 'shortage', productId: 'A', qty: 8, name: 'מוצר א בדיקה', text: 'חסר 8 × מוצר א בדיקה' };
const audit = (findings, extra = {}) => ({ version: 6, hasDiscrepancy: true, findings, ...extra });
// A manual offset inside the receipt: A short 8 ⇄ B over 8, the same price.
const OFFSETS = [{ id: 'g|short', groupId: 'g', otherId: 'rc-1', productId: 'A', name: 'מוצר א בדיקה', qty: 8, dir: 'short', at: 1, source: 'manual' },
  { id: 'g|over', groupId: 'g', otherId: 'rc-1', productId: 'B', name: 'מוצר ב בדיקה', qty: 8, dir: 'over', at: 1, source: 'manual' }];

const runtime = () => harness.runtime('yotvata');
function plain(c, rc) { c.context.rcFixture = rc; return json(c, 'receiptPlainStatus(rcFixture)'); }
function patch(c, rc, changes) { c.context.rcFixture = rc; c.context.changesFixture = changes; return json(c, 'receiptStoredStatusPatch(rcFixture, changesFixture)'); }
function renderHistory(c, list) {
  c.context.historyFixture = list;
  c.run("receipts=historyFixture;returns=[];currentView='receiptsHistory';renderReceiptsHistory()");
  return c.node('app').innerHTML;
}

test('one sentence per saved receipt: what is open and what to do, or balanced and how it closed', () => {
  const c = runtime();
  assert.deepEqual(plain(c, receipt()), { state: 'short', text: 'חסר 8 × מוצר א בדיקה · ₪40.00 · ממתין לזיכוי מהספק', action: 'התקבל זיכוי מהספק', role: 'rc-short-credit', open: true });
  assert.deepEqual(plain(c, receipt({ items: [{ ...structuredClone(LINE_A), qty: 12, lineTotal: 60 }, structuredClone(LINE_B)] })),
    { state: 'over', text: 'עודף 2 × מוצר ב בדיקה (₪10.00) · לא בתעודה — לקזז מול חוסר או לתקן', action: 'תקן הפרשים', role: 'rc-fix-open', open: true });
  assert.deepEqual(plain(c, receipt({ items: balancedLines() })), { state: 'balanced', text: 'נקלטה ומאוזנת ✓', action: '', role: '', open: false });
  // a partial credit names what is still owed
  assert.equal(plain(c, receipt({ shortCreditNotes: [{ amount: 30, at: 1 }] })).text, 'חסר 8 × מוצר א בדיקה · נותר ₪10.00 · ממתין לזיכוי מהספק');
  // closed by a full credit, by goods or by an offset — the sentence says how
  assert.equal(plain(c, receipt({ items: shortOnly(), shortCreditNotes: [{ amount: 40, at: 1 }] })).text, 'נקלטה ומאוזנת ✓ · החוסר נסגר בזיכוי');
  assert.equal(plain(c, receipt({ items: shortOnly(), shortGoodsNotes: [{ productId: 'A', name: 'מוצר א בדיקה', qty: 8, price: 5, at: 1 }] })).text, 'נקלטה ומאוזנת ✓ · החוסר הושלם בסחורה');
  assert.equal(plain(c, receipt({ items: shortAndOver8(), externalOffsets: OFFSETS, offsetSchemaVersion: 3 })).text, 'נקלטה ומאוזנת ✓ · קיזוז');
  // no paper yet, a supplier credit claim, a units gap
  const paperless = plain(c, receipt({ noDoc: true, noteParts: [], noteTotalInc: null, items: balancedLines() }));
  assert.deepEqual([paperless.state, paperless.text, paperless.role], ['awaiting_paper', 'נקלטה לפי ספירה בלי תעודה · ממתינה לנייר', 'rc-attach-doc']);
  const claim = plain(c, receipt({ items: balancedLines(), supplierCreditClaim: { status: 'open', amount: 12.5, items: [] } }));
  assert.deepEqual([claim.state, claim.text, claim.role], ['claim', 'ממתין לזיכוי ספק של ₪12.50 על מחיר או מבצע', 'rc-credit-verify']);
  assert.equal(plain(c, receipt({ items: balancedLines(), noteParts: [{ units: 30, amount: 110 }] })).text, 'פער של 8 יחידות חסרות שטרם שויך למוצר');
});

test('the history card: the sentence on the collapsed card, and "מה לעשות עכשיו" with one button only when something is open', () => {
  const c = runtime();
  const html = renderHistory(c, [receipt(), { ...receipt({ items: balancedLines() }), id: 'rc-2', timestamp: Date.parse('2026-10-18T09:00:00') }]);
  assert.match(html, /<div class="mt-1 text-xs font-black text-rose-700" data-plain-status="short">חסר 8 × מוצר א בדיקה · ₪40\.00 · ממתין לזיכוי מהספק<\/div>/);
  assert.match(html, /<div class="mt-1 text-xs font-black text-emerald-700" data-plain-status="balanced">נקלטה ומאוזנת ✓<\/div>/);
  const box = (html.match(/<div class="mt-2 bg-rose-50 border-2 border-rose-300 rounded-xl p-3" data-plain-action="short">[\s\S]*?<\/button><\/div>/) || [''])[0];
  assert.ok(box, 'the open receipt has the box');
  assert.match(box, /מה לעשות עכשיו/);
  assert.match(box, /חסר 8 × מוצר א בדיקה · ₪40\.00 · ממתין לזיכוי מהספק/);
  assert.match(box, /<button data-role="rc-short-credit" data-id="rc-1"[^>]*>התקבל זיכוי מהספק<\/button>/);
  assert.equal((html.match(/data-plain-action=/g) || []).length, 1, 'the balanced receipt has no box');
  // the existing state bar is untouched
  assert.match(html, /הפרש פתוח/); assert.match(html, /אומתה/);
});

test('the stored status follows the real state: a full credit, goods or an offset closes it; a partial credit, a price finding or a cancelled offset keeps it open', () => {
  const c = runtime();
  const open = receipt({ items: shortOnly(), aiAudit: audit([SHORTAGE]) });
  const closed = patch(c, open, { shortCreditNotes: [{ amount: 40, at: 1 }] });
  assert.equal(closed.status, 'ok');
  assert.equal(closed.aiAudit.hasDiscrepancy, false);
  assert.ok(closed.aiAudit.resolvedAt > 0);
  assert.deepEqual(closed.aiAudit.findings, [SHORTAGE], 'the findings stay in the history');
  assert.deepEqual(patch(c, open, { shortCreditNotes: [{ amount: 30, at: 1 }] }), { status: 'open' }, 'still open and the flag already says so — nothing to rewrite');
  assert.deepEqual(patch(c, receipt({ items: shortOnly(), aiAudit: null }), { shortGoodsNotes: [{ productId: 'A', qty: 8, price: 5, at: 1 }] }), { status: 'ok' }, 'no aiAudit — only the status');
  assert.equal(patch(c, receipt({ items: shortAndOver8(), aiAudit: audit([SHORTAGE]) }), { externalOffsets: OFFSETS }).status, 'ok');
  // reopened: the flag comes back and resolvedAt goes
  const done = receipt({ status: 'ok', items: shortOnly(), shortCreditNotes: [{ amount: 40, at: 1 }], aiAudit: audit([SHORTAGE], { hasDiscrepancy: false, resolvedAt: 5 }) });
  const reopened = patch(c, done, { shortCreditNotes: [] });
  assert.equal(reopened.status, 'open'); assert.equal(reopened.aiAudit.hasDiscrepancy, true); assert.equal('resolvedAt' in reopened.aiAudit, false);
  // a real price finding keeps the receipt open even when the goods balance; a stale flag with no findings does not
  assert.deepEqual(patch(c, receipt({ items: balancedLines(), aiAudit: audit([{ type: 'price', productId: 'A', name: 'מוצר א בדיקה', text: 'המחיר שונה' }]) }), {}), { status: 'open' });
  const stale = patch(c, receipt({ items: balancedLines(), aiAudit: audit([]) }), {});
  assert.equal(stale.status, 'ok'); assert.equal(stale.aiAudit.hasDiscrepancy, false);
});

test('closing a shortage by goods or by a supplier credit writes the status with it; cancelling an offset reopens it', async () => {
  const c = runtime();
  c.context.historyFixture = [receipt({ items: shortOnly(), aiAudit: audit([SHORTAGE]) })];
  c.run("receipts=historyFixture;returns=[];currentView='receiptsHistory'");
  await c.run("saveShortGoods('rc-1', [{ productId: 'A', name: 'מוצר א בדיקה', n: 8, price: 5 }])");
  let write = c.writes.at(-1);
  assert.equal(write.data.status, 'ok'); assert.equal(write.data.aiAudit.hasDiscrepancy, false); assert.equal(write.data.shortGoodsNotes.length, 1);
  assert.deepEqual(json(c, '[receipts[0].status, receipts[0].aiAudit.hasDiscrepancy]'), ['ok', false], 'the local copy follows at once');
  // the supplier credit modal
  c.run("receipts[0].shortGoodsNotes=[]; receipts[0].status='open'; receipts[0].aiAudit={version:6,hasDiscrepancy:true,findings:[]}; shortCreditTarget='rc-1'");
  c.node('shortCreditAmount').value = '40';
  await c.run('confirmShortCredit()');
  write = c.writes.at(-1);
  assert.equal(write.data.status, 'ok'); assert.equal(write.data.aiAudit.hasDiscrepancy, false); assert.equal(write.data.shortCreditNotes[0].amount, 40);
  assert.equal(c.run('receipts[0].status'), 'ok');
  // cancelling an offset that had closed the receipt
  c.context.historyFixture = [receipt({ status: 'ok', items: shortAndOver8(), externalOffsets: OFFSETS, offsetSchemaVersion: 3, aiAudit: audit([SHORTAGE], { hasDiscrepancy: false, resolvedAt: 5 }) })];
  c.run('receipts=historyFixture');
  await c.run("cancelReceiptOffset('rc-1', 'g')");
  write = c.writes.at(-1).writes[0];
  assert.equal(write.data.status, 'open'); assert.equal(write.data.aiAudit.hasDiscrepancy, true); assert.equal('resolvedAt' in write.data.aiAudit, false);
  assert.deepEqual(write.data.externalOffsets, []);
  assert.deepEqual(json(c, '[receipts[0].status, receipts[0].aiAudit.hasDiscrepancy]'), ['open', true]);
});

test('an automatic offset between two receipts writes both statuses', async () => {
  const c = runtime();
  c.run('cloudLog = []; runCloudTaskSilent = async (name, task) => { cloudLog.push(task); return true; };');
  c.context.pairFixture = [
    receipt({ id: 'today', timestamp: Date.parse('2026-10-20T08:00:00Z'), items: [{ ...structuredClone(LINE_A), qty: 12, noteQty: 4, lineTotal: 60 }], noteParts: [{ units: 4, amount: 20 }], aiAudit: audit([{ type: 'surplus', productId: 'A', qty: 8, name: 'מוצר א בדיקה', text: 'עודף 8' }]) }),
    receipt({ id: 'yday', timestamp: Date.parse('2026-10-19T08:00:00Z'), date: '2026-10-19', items: [structuredClone(LINE_A)], noteParts: [{ units: 12, amount: 60 }], aiAudit: audit([SHORTAGE]) })];
  c.run('receipts = pairFixture');
  const applied = JSON.parse(await c.run('autoApplyExactOffsets().then(a => JSON.stringify(a.map(p => [p.rc.id, p.other.id, p.productId, p.qty])))'));
  assert.deepEqual(applied, [['today', 'yday', 'A', 8]]);
  const writes = json(c, 'cloudLog[0].writes');
  assert.deepEqual(writes.map(w => [String(w.path).endsWith('today') ? 'today' : 'yday', w.data.status, w.data.aiAudit.hasDiscrepancy, w.data.externalOffsets.length]), [['today', 'ok', false, 1], ['yday', 'ok', false, 1]]);
  assert.deepEqual(json(c, 'receipts.map(r => [r.status, r.aiAudit.hasDiscrepancy])'), [['ok', false], ['ok', false]]);
});

test('the full backup opens with a plain summary: a line per receipt, counts and a glossary — and the import still accepts the file', () => {
  const c = runtime();
  const { id: openId, ...openData } = receipt();
  const { id: doneId, ...doneData } = receipt({ items: balancedLines(), timestamp: Date.parse('2026-10-18T09:00:00'), date: '2026-10-18', priceAudit: { documents: [{ number: '407300217689' }] } });
  c.context.payloadFixture = { backupType: 'yotvata-firestore-full', backupVersion: 1, appId: 'yotvata-app-classic', collections: { receipts: { [openId]: openData, 'rc-2': doneData }, products: {} } };
  const summary = json(c, 'backupPlainSummary(payloadFixture)');
  assert.deepEqual(summary.counts, { receipts: 2, balanced: 1, open: 1 });
  assert.deepEqual(summary.receipts.map(r => [r.id, r.date, r.state, r.status, r.action, r.documents, r.items, r.totalExVat]), [
    ['rc-1', '2026-10-20', 'short', 'חסר 8 × מוצר א בדיקה · ₪40.00 · ממתין לזיכוי מהספק', 'התקבל זיכוי מהספק', [], 2, 80],
    ['rc-2', '2026-10-18', 'balanced', 'נקלטה ומאוזנת ✓', '', ['407300217689'], 2, 80]]);
  assert.ok(summary.about.includes('הייבוא מתעלם'));
  assert.ok('status' in summary.glossary && Object.keys(summary.glossary).some(k => k.includes('needs_review')));
  c.context.summaryFixture = summary;
  assert.equal(c.run('validBackupPayload({ ...payloadFixture, summary: summaryFixture })'), true);
  assert.deepEqual(json(c, 'backupPlainSummary({ collections: {} }).counts'), { receipts: 0, balanced: 0, open: 0 });
  assert.equal(c.run('APP_VERSION'), '398'); assert.equal(c.run('APP_VERSION_LABEL'), 'v398_plain_receipt_status');
});

test('the receiving panel says what to do: a product choice, a check against the paper, a price gap — one kind, or each kind counted', () => {
  const c = runtime();
  const title = (rows, short) => { c.context.rowsFixture = rows; return c.run('priceAuditPendingTitle(rowsFixture, ' + !!short + ')'); };
  assert.equal(title([{ choice: {} }]), 'נשארה שורה אחת לבחירת מוצר');
  assert.equal(title([{ capability: 'unidentified' }, { choice: {} }]), 'נשארו 2 שורות לבחירת מוצר');
  assert.equal(title([{ modelReviewIssues: ['quantity'], capability: 'partial' }]), 'נשארה שורה אחת לבדיקה מול הנייר');
  assert.equal(title([{ result: 'difference', capability: 'checkable' }], true), 'שורה אחת עם פער מחיר');
  assert.equal(title([{ choice: {} }, { modelReviewIssues: ['unitPriceExVat'] }, { capability: 'missing_catalog_price' }]), 'נשארו 3 שורות לטיפול: 1 לבחירת מוצר · 1 לבדיקה מול הנייר · 1 להשלמת מחיר במאגר');
  assert.deepEqual(['quantity', 'unitPriceExVat', 'lineTotalExVat'].map(f => c.run('priceAuditPlainCheckTitle(' + JSON.stringify([f]) + ')')),
    ['בדוק את הכמות מול הנייר', 'בדוק את המחיר והסכום מול הנייר', 'בדוק את המחיר והסכום מול הנייר']);
  assert.equal(c.run('priceAuditPlainCheckTitle(["quantity","lineTotalExVat","identity"])'), 'בדוק את הכמות והמחיר מול הנייר');
  assert.equal(c.run('priceAuditTechnicalFoldHtml("", "data-x")'), '', 'nothing to fold — no fold');
  assert.equal(c.run('priceAuditTechnicalFoldHtml("<p>x</p>", "data-x")'), '<details class="mt-2" data-x><summary class="cursor-pointer text-xs font-bold text-slate-500">פרטים טכניים — מה כל קריאה ראתה</summary><p>x</p></details>');
});
