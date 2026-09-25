// v366: the verified driver-credit fixture, shared by credit-auto-attach.test.mjs and
// credit-on-gate.test.mjs (it used to live inside the former). Synthetic data only.
// The v149 service shape imitated here is kept honest by credit-service-contract.test.mjs,
// which checks the same keys against the real service code.
import { fixture } from './receipt-scan-harness.mjs';

export const PRODUCTS = { coffee: { barcode: '7290000000015', unit: 7.3, name: 'קפה בדיקה' }, milk: { barcode: '7290000000008', unit: 5, name: 'חלב בדיקה' } };
const cents = n => Math.round(n * 100) / 100;
const evidence = row => Object.fromEntries(['barcode', 'barcodeReadType', 'catalogHintId', 'catalogCandidateHintIds', 'description', 'sourcePage', 'lineNumber',
  'quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'].map(k => [k, row[k] ?? null]));

// The invoice of delivery-credit.test.mjs: 10 × milk (₪5.00) + 6 × coffee (₪7.30), ₪93.80 before VAT, 16 units.
export function creditInvoiceData() {
  const data = fixture('yotvata');
  data.products[1].price = 7.3;
  const doc = data.paper.scan.documents[0];
  Object.assign(doc, { invoiceNumber: 'TEST-INVOICE', subtotalExVat: 93.8, printedUnits: 16,
    printedLines: 2, itemsPrintedLines: 2, itemsSectionTotalExVat: 93.8 });
  doc.rows.push({ ...doc.rows[0], description: 'קפה בדיקה', barcode: '7290000000015',
    barcodeObserved: '7290000000015', itemCode: '222', lineNumber: 2, quantity: 6,
    unitPriceExVat: 7.3, grossLineTotalExVat: 43.8, lineTotalExVat: 43.8 });
  doc.__pricePaper = structuredClone(doc);
  return data;
}

// A credit row exactly as service v148 returns it after two agreeing reads.
export function verifiedRow(data, [product, qty, amount], index, { refused = false, issues = [] } = {}) {
  const p = PRODUCTS[product];
  const row = { ...structuredClone(data.paper.scan.documents[0].rows[0]), description: p.name, barcode: p.barcode, barcodeObserved: p.barcode,
    barcodeReadType: 'full', barcodeMatchMethod: 'model_consensus', barcodeResolvedProductId: product, catalogHintId: product, catalogCandidateHintIds: [],
    lineNumber: null, sourcePage: 1, quantity: -qty, unitPriceExVat: p.unit, grossLineTotalExVat: -amount, lineDiscountExVat: null, lineTotalExVat: -amount, confidence: 0.9 };
  const identity = { productId: product, barcode: p.barcode };
  const proof = { version: 1, status: issues.length || refused ? 'needs_review' : 'agreed', selectedRead: 0, strongSelected: false, issues: refused ? ['identity', ...issues] : issues,
    identity: refused ? null : identity, identitySupport: refused ? [] : [1], candidates: [identity],
    fieldSupport: Object.fromEntries(['quantity', 'unitPriceExVat', 'grossLineTotalExVat', 'lineDiscountExVat', 'lineTotalExVat'].map(f => [f, issues.includes(f) ? [] : [1]])),
    readings: [{ read: 0, identity, values: evidence(row) }, { read: 1, identity, values: evidence(row) }], evidence: evidence(row) };
  if (refused) Object.assign(row, { barcode: null, barcodeMatchMethod: 'suggested_name_multiple', barcodeResolvedProductId: null, catalogHintId: null,
    barcodeSuggestedCandidates: [identity, { productId: 'other', barcode: '7290000000022' }] });
  row.modelVerification = proof;
  return row;
}
// The service response for a verified credit: 6 × coffee (−43.80) and 1 × milk (−5.00),
// subtotal −48.80, printedUnits −7 (negative, as the real slip printed it).
// Service v149 shape: modelVerification.support lists, per summary field and (credit mode) for the
// credit number, the other reads that agreed with the selected read; issues are the keys without
// support. `numberSupport` is support.invoiceNumber; `support: false` is the v148 shape of the
// shop's backup (issues and values only), which carries no evidence about the number. This shape is
// an imitation: credit-service-contract.test.mjs checks the same keys against the real service code,
// so a key invented here (as support.invoiceNumber once was) cannot pass the suite on its own.
// `readings` (v149) is the per-read summary list; one entry means only one read parsed.
export function verifiedCredit(data, { number = '22229080', rows = [['coffee', 6, 43.8], ['milk', 1, 5]], docIssues = [], discount = null, rowOptions = {}, verification = true,
  support = true, numberSupport = [1], readings = null } = {}) {
  const amount = cents(rows.reduce((sum, r) => sum + r[2], 0)), units = rows.reduce((sum, r) => sum + r[1], 0);
  const supported = f => docIssues.includes(f) ? [] : f === 'invoiceNumber' ? numberSupport : [1];
  const doc = { noteIndex: 0, invoiceNumber: number, pageCount: 1, subtotalExVat: -amount, vatAmount: -cents(amount * 0.18), totalInclVat: -cents(amount * 1.18),
    printedUnits: -units, printedLines: rows.length, documentDiscountExVat: discount, confidence: 0.9, warnings: [],
    rows: rows.map((r, i) => verifiedRow(data, r, i, rowOptions[i] || {})),
    modelVerification: { version: 1, issues: docIssues, values: { pageCount: 1, subtotalExVat: -amount, printedUnits: -units, documentDiscountExVat: discount },
      ...(support ? { support: Object.fromEntries(['pageCount', 'subtotalExVat', 'printedUnits', 'documentDiscountExVat', 'rowCount', 'invoiceNumber'].map(f => [f, supported(f)])) } : {}),
      ...(readings ? { readings } : {}) } };
  if (!verification) { delete doc.modelVerification; doc.rows.forEach(r => delete r.modelVerification); }
  return { ok: true, serviceVersion: support ? 149 : 148, model: 'gpt-5.6-luna', requestId: 'resp-credit-' + number,
    scan: { warnings: [], documents: [doc], verification: { version: 1, status: verification ? 'verified' : 'needs_review', primaryReads: 2, escalationAttempted: false, selectedRead: 0, readCount: 2 } },
    scanAudit: { version: 1, id: 'audit-' + number, documentKind: 'credit', result: verification ? 'paper_verified' : 'needs_review' } };
}
