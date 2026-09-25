// v367: the field case of the shop's backup (2026-09-25 12:03, app v366 / service v149): invoice
// 9073807997, 3 pages, 22 rows, ₪1,717.49 before VAT, 285 units, read three times. Rows 6 and 18 carry
// the backup's real values ("מארז 8 מילקי בטעם שוקולד": 6 × 16.03 = 96.18; "מארז 6 שקיות מוקה":
// 20 × 12.53 = 250.60) and the three readings the backup recorded for them: the selected cheap read
// (read 1) 6 / 20; the other cheap read (read 0) 3 / 10 — its units total 272 failed the paper check;
// the verifier (read 2, gpt-5.6-terra) 2 / 2 — it read the packages column of every row (1 on the
// other rows, 2 on rows 6, 18 and 21; 25 units in all) and failed the paper check too, so it was not
// selected. The backup's other 20 rows are not in this repository: they are synthetic and only fill
// the printed totals (Σ rows 1,717.49, Σ units 285). Synthetic barcodes (valid EAN-13) and names.
// Shared by quantity-arithmetic.test.mjs (the v149 answer shape, imitated) and
// quantity-arithmetic-contract.test.mjs (the three model reads through the real service code, which
// keeps the imitation honest).

const r2 = n => Math.round(n * 100) / 100;
export function ean13(body) {
  const digits = String(body).padStart(12, '0').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return digits + String((10 - (sum % 10)) % 10);
}

// [name, quantity, unit price]; rows 6 (index 5) and 18 (index 17) are the field rows.
const LINES = [];
for (let i = 0; i < 22; i++) {
  if (i === 5) LINES.push(['מארז 8 מילקי בטעם שוקולד', 6, 16.03]);
  else if (i === 17) LINES.push(['מארז 6 שקיות מוקה', 20, 12.53]);
  else if (i === 20) LINES.push(['מוצר בדיקה 21', 24, 4.5]);
  else if (i === 21) LINES.push(['מוצר בדיקה 22', 1, 92.71]);
  else LINES.push(['מוצר בדיקה ' + (i + 1), 13, 5]);
}
export const PRODUCTS = LINES.map(([name, , price], i) => ({ id: i === 5 ? 'prod_milky_8' : i === 17 ? 'prod_mocha_6' : 'prod_' + (i + 1),
  name, barcode: ean13('72900001' + String(i + 1).padStart(4, '0')), price }));
export const SUBTOTAL = r2(LINES.reduce((n, [, q, u]) => n + r2(q * u), 0)); // 1717.49
export const UNITS = LINES.reduce((n, [, q]) => n + q, 0); // 285
export const FIELD_ROWS = [5, 17];
const page = i => i < 8 ? 1 : i < 16 ? 2 : 3;

// A row as the model returns it (server output shape). `quantity` overrides the read quantity.
export function modelRow(i, quantity = LINES[i][1]) {
  const [name, , unit] = LINES[i], amount = r2(LINES[i][1] * unit);
  return { sourcePage: page(i), lineNumber: i + 1, rowRegion: null, barcode: PRODUCTS[i].barcode, barcodeReadType: 'full',
    catalogHintId: null, catalogCandidateHintIds: [], supplierItemCode: null, description: name,
    quantity, unitPriceExVat: unit, grossLineTotalExVat: amount, lineDiscountExVat: 0, lineTotalExVat: amount, promotionText: null, confidence: 0.9 };
}
// The three reads: 'selected' (every quantity right), 'halved' (rows 6 and 18 at 3 and 10), 'packages'
// (the packages column: 1 everywhere, 2 on rows 6, 18 and 21). The money is the same in all three.
export function readRows(kind) {
  return LINES.map((line, i) => modelRow(i, kind === 'halved' ? (i === 5 ? 3 : i === 17 ? 10 : line[1])
    : kind === 'packages' ? ([5, 17, 20].includes(i) ? 2 : 1) : line[1]));
}
export function modelDoc(rows) {
  return { noteIndex: 0, invoiceNumber: '9073807997', pageCount: 3, subtotalExVat: SUBTOTAL, vatAmount: r2(SUBTOTAL * 0.18),
    totalInclVat: r2(SUBTOTAL * 1.18), printedUnits: UNITS, printedLines: 22, documentDiscountExVat: null, confidence: 0.9, warnings: [], rows };
}
export const catalog = PRODUCTS.map(p => ({ id: p.id, name: p.name, barcode: p.barcode }));

const EVIDENCE_KEYS = ['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
  'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'];
const evidence = row => Object.fromEntries(EVIDENCE_KEYS.map(k => [k, row[k] ?? null]));
const summary = { pageCount: 3, subtotalExVat: SUBTOTAL, printedUnits: UNITS, printedLines: 22, documentDiscountExVat: null, vatAmount: r2(SUBTOTAL * 0.18), totalInclVat: r2(SUBTOTAL * 1.18) };

// The service answer as the backup recorded it (v149 shape), after the server resolved the barcodes:
// every row `model_consensus`, rows 6 and 18 `needs_review` with issues ['quantity'] and no read
// supporting the quantity, the money supported by reads 0 and 2, three readings per row, the summary
// agreed, `scan.verification.verifier` disagreed and not selected.
// Options: `unit` (unit price of row 6 in the selected read and its money — the arithmetic then fails);
// `unitUnsupported` (row 6's unit price supported by no read: issues ['quantity', 'unitPriceExVat']);
// `printedUnits` (the printed units total — 284 leaves the paper unbalanced); `verifier` ('failed'
// drops the verifier's reading and marks its outcome failed with error 'timeout'); `server` (150: the
// v150 answer — rows 6 and 18 'verified' with fieldSupport.quantity ['arithmetic'] and
// modelVerification.arithmetic.quantity, the scan 'verified').
export function fieldInvoice({ unit = null, unitUnsupported = false, printedUnits = UNITS, verifier = 'disagreed', server = 149 } = {}) {
  const selected = readRows('selected'), halved = readRows('halved'), packages = readRows('packages');
  if (unit != null) { selected[5].unitPriceExVat = unit; halved[5].unitPriceExVat = unit; packages[5].unitPriceExVat = unit; }
  if (unitUnsupported) { halved[5].unitPriceExVat = r2(selected[5].unitPriceExVat + 0.27); packages[5].unitPriceExVat = halved[5].unitPriceExVat; }
  const marker = server >= 150;
  const rows = selected.map((row, i) => {
    const identity = { productId: PRODUCTS[i].id, barcode: PRODUCTS[i].barcode };
    const disputed = FIELD_ROWS.includes(i);
    const issues = disputed ? (marker ? [] : ['quantity']) : [];
    if (disputed && unitUnsupported && i === 5) issues.push('unitPriceExVat');
    const fieldSupport = { quantity: disputed ? (marker ? ['arithmetic'] : []) : [0], unitPriceExVat: unitUnsupported && i === 5 ? [] : [0, 2],
      grossLineTotalExVat: [0, 2], lineDiscountExVat: [0, 2], lineTotalExVat: [0, 2] };
    const readings = [{ read: 1, identity, values: evidence(row) }, { read: 0, identity, values: evidence(halved[i]) }];
    if (verifier !== 'failed') readings.push({ read: 2, identity, values: evidence(packages[i]) });
    const arithmetic = marker && disputed ? { quantity: { unit: row.unitPriceExVat, gross: row.grossLineTotalExVat, net: row.lineTotalExVat, printedUnitsBalanced: true } } : null;
    return { ...row, barcodeObserved: row.barcode, barcodeMatchMethod: 'model_consensus', barcodeResolvedProductId: PRODUCTS[i].id, barcodeRetryConflict: false,
      modelVerification: { version: 1, status: issues.length ? 'needs_review' : marker && disputed ? 'verified' : 'agreed', selectedRead: 1, strongSelected: false,
        issues, identity, identitySupport: verifier === 'failed' ? [0] : [0, 2], candidates: [identity], fieldSupport, ...(arithmetic ? { arithmetic } : {}), readings, evidence: evidence(row) } };
  });
  const doc = { ...modelDoc(rows), printedUnits, modelVerification: { version: 1, issues: [],
    values: { pageCount: 3, subtotalExVat: SUBTOTAL, printedUnits, documentDiscountExVat: null },
    readings: [{ read: 1, values: { ...summary, printedUnits }, discountSeparate: false }, { read: 0, values: { ...summary, printedUnits }, discountSeparate: false },
      ...(verifier === 'failed' ? [] : [{ read: 2, values: { ...summary, printedUnits }, discountSeparate: false }])],
    support: Object.fromEntries(['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount'].map(f => [f, verifier === 'failed' ? [0] : [0, 2]])) } };
  const unresolved = rows.some(r => r.modelVerification.issues.length);
  const verification = { version: 1, status: unresolved ? 'needs_review' : 'verified', primaryReads: 2, escalationAttempted: true, selectedRead: 1, readCount: 3,
    verifier: verifier === 'failed' ? { attempted: true, model: 'gpt-5.6-terra', requestId: null, outcome: 'failed', error: 'timeout', selected: false }
      : { attempted: true, model: 'gpt-5.6-terra', requestId: 'resp-verifier-9073807997', outcome: unresolved ? 'disagreed' : 'agreed', error: null, selected: false } };
  return { ok: true, serviceVersion: server, model: 'gpt-5.6-luna', requestId: 'resp-9073807997', scan: { warnings: [], documents: [doc], verification },
    checksumRetryAttempted: true, paperValidation: null, scanAudit: { version: 1, id: 'audit-9073807997', documentKind: 'invoice', result: unresolved ? 'needs_review' : 'paper_verified' } };
}
