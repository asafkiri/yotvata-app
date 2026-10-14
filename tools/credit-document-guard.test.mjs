// v394: a driver's credit photographed with the regular document buttons ("+ תעודה נוספת מהנהג / הספק")
// is recognised and STOPPED with one clear message; nothing is moved automatically. The worker removes it
// in «בדוק צילומים» and photographs it with the green button, or types the delivery note's own anchors.
// These tests run the complete app module (receipt-scan-harness); only fetch, timers, image preparation and
// the Firebase boundary are faked. Synthetic data only, no network, no paid calls. The last two tests hand
// the app's own request body to the REAL companion service in-process (as credit-service-contract.test.mjs),
// so the field names read here (printedTitle, modelVerification.readings / documentType) are the service's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime, reply } from './receipt-scan-harness.mjs';
import { creditInvoiceData, verifiedCredit } from './credit-verified-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush(c, rounds = 30) {
  for (let i = 0; i < rounds; i++) { for (const cb of c.callbacks.splice(0)) cb(); await tick(); }
}
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const page = name => 'data:image/jpeg;base64,' + Buffer.from(name).toString('base64');
const INVOICE = page('INVOICE'), SLIP = page('SLIP');
const TITLE = 'ביטול מכירה חלקי ת.משלוח';
const MESSAGE = (n, title = null) => 'תעודה ' + n + ' נראית כמו תעודת זיכוי' + (title ? ' («' + title + '»)' : '') +
  ' — הסר אותה מהתעודות (בדוק צילומים) וצלם אותה בכפתור הירוק «הנהג הביא זיכוי על חוסר? צלם כאן».';
const ATTACH_MESSAGE = (n, title = null) => 'תעודה ' + n + ' נראית כמו תעודת זיכוי' + (title ? ' («' + title + '»)' : '') +
  ' — הסר אותה מהתעודות (בדוק צילומים). את הזיכוי רושמים בקליטה השמורה ב«התקבל זיכוי מהספק».';
const MINUS_TOAST = 'סכום עם מינוס הוא תעודת זיכוי — אל תקליד אותו כתעודה. זיכוי מהנהג מצלמים בכפתור הירוק.';
const MINUS_ATTACH_TOAST = 'סכום עם מינוס הוא תעודת זיכוי — אל תקליד אותו כתעודה. את הזיכוי רושמים בקליטה השמורה ב«התקבל זיכוי מהספק».';
const FINISH_BLOCKED = 'השלם צילום או הזן ידנית את נתוני התעודה לפני הסיום';
const AUTO_TOAST = 'הזיכוי צורף למשלוח. בסיום הספירה נבדוק איזה חוסר הוא מכסה.';
const health = version => ({ ok: true, keyConfigured: true, photoFirst: true, serviceVersion: version, scanResume: true, creditDocuments: true,
  ...(version >= 151 ? { documentTypeDetection: true } : {}) });

// ---- invoice-mode answers (service v150 shape, plus the v151 type block when version >= 151) ----
// The summary values each read saw (modelVerification.readings, service >= 149).
const summary = (doc, subtotalExVat = doc.subtotalExVat) => ({ pageCount: doc.pageCount, subtotalExVat, printedUnits: doc.printedUnits,
  printedLines: doc.printedLines, documentDiscountExVat: doc.documentDiscountExVat ?? null, vatAmount: doc.vatAmount ?? null, totalInclVat: doc.totalInclVat ?? null });
// `subtotals`: what each read saw (read 0 is the selected one). `types`: [documentType, printedTitle] per read (v151).
// As in the service, `issues` is exactly the summary fields no other read supports.
function typed(doc, version, { subtotals = [doc.subtotalExVat, doc.subtotalExVat], types = null } = {}) {
  const support = { pageCount: [1], subtotalExVat: subtotals.slice(1).map((s, i) => s === subtotals[0] ? i + 1 : null).filter(i => i != null),
    printedUnits: [1], documentDiscountExVat: [1], rowCount: [1] };
  doc.modelVerification = { version: 1, issues: Object.keys(support).filter(field => !support[field].length), values: summary(doc), support,
    readings: subtotals.map((s, read) => ({ read, values: summary(doc, s), discountSeparate: false })) };
  if (version >= 151 && types) {
    Object.assign(doc, { documentType: types[0][0], printedTitle: types[0][1] });
    doc.modelVerification.documentType = { version: 1, value: types[0][0], printedTitle: types[0][1],
      support: types.slice(1).map((t, i) => t[0] === types[0][0] ? i + 1 : null).filter(i => i != null), invoiceNumberSupport: [1],
      readings: types.map(([documentType, printedTitle], read) => ({ read, documentType, printedTitle,
        creditSigns: subtotals[read] < 0 ? 'negative' : 'as_printed', subtotalExVat: subtotals[read] })) };
  }
  return doc;
}
const answer = (doc, version) => ({ ok: true, serviceVersion: version, ...(version >= 151 ? { documentTypeDetection: true } : {}), model: 'fixture', requestId: 'fixture-' + doc.invoiceNumber,
  scan: { warnings: [], documents: [doc], verification: { version: 1, status: 'agreed', primaryReads: 2, escalationAttempted: false, selectedRead: 0, readCount: 2 } },
  scanAudit: { version: 1, id: 'audit-' + doc.invoiceNumber, result: 'paper_verified', ...(version >= 151 ? { detectDocumentType: true } : {}) } });
// The delivery note of credit-verified-fixture: 10 milk + 6 coffee = ₪93.80 before VAT, 16 units.
function deliveryNote(data, version, types = [['delivery', 'תעודת משלוח'], ['delivery', 'תעודת משלוח']]) {
  return answer(typed(structuredClone(data.paper.scan.documents[0]), version, { types }), version);
}
// The driver's slip read in invoice mode: 6 coffee (₪43.80) + 1 milk (₪5.00) = ₪48.80, 7 units printed unsigned.
// `minus`: the money kept its printed minus (false = the read dropped it).
function slip(data, version, { minus = true, title = TITLE, subtotals = null, type = 'credit' } = {}) {
  const sign = minus ? -1 : 1, base = data.paper.scan.documents[0].rows[0];
  const rows = [['קפה בדיקה', '7290000000015', 6, 7.3, 43.8], ['חלב בדיקה', '7290000000008', 1, 5, 5]].map(([description, barcode, quantity, unit, total], i) => ({
    ...structuredClone(base), description, barcode, barcodeObserved: barcode, itemCode: String(i + 1), lineNumber: i + 1,
    quantity, unitPriceExVat: unit, grossLineTotalExVat: sign * total, lineTotalExVat: sign * total }));
  const doc = { noteIndex: 0, invoiceNumber: '22230011', pageCount: 1, subtotalExVat: sign * 48.8, vatAmount: sign * 8.78, totalInclVat: sign * 57.58,
    printedUnits: 7, printedLines: 2, documentDiscountExVat: null, confidence: 0.9, warnings: [], rows };
  const s = subtotals || [doc.subtotalExVat, doc.subtotalExVat];
  return answer(typed(doc, version, { subtotals: s, types: [[type, title], [type, title]] }), version);
}

// A scripted scan service: the invoice photo and the slip photo get their own answers; the green button's
// credit body gets a verified credit.
function service(c, version, { invoice, slip: slipAnswer, credit = null }) {
  const log = [];
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(version)); }
    assert.ok(String(url).endsWith('/scan'), 'unexpected request ' + url);
    const body = JSON.parse(options.body);
    const photo = body.documents ? body.documents[0].pages[0] : null;
    log.push({ kind: body.resume ? 'resume' : 'full', body, credit: body.documentKind === 'credit', photo });
    if (body.documentKind === 'credit') return reply(credit);
    return reply(structuredClone(photo === SLIP ? slipAnswer : invoice));
  };
  return { log, uploads: photo => log.filter(e => e.kind === 'full' && (!photo || e.photo === photo)) };
}
const doc = (dataUrl, extra = {}) => ({ noteIndex: 0, amount: null, units: null, pages: [{ dataUrl, orientationConfirmed: true }], ...extra });
function setup({ attach = false } = {}) {
  const data = creditInvoiceData();
  const c = runtime('yotvata', { data });
  c.context.gateDocs = [doc(INVOICE), doc(SLIP, { noteIndex: 1 })];
  c.run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true; showConfirm = (t, x, l, fn) => fn();
    aiCompressInvoiceImage = async (file) => { const url = 'data:image/jpeg;base64,' + btoa(file.name);
      return { name: file.name, dataUrl: url, baseDataUrl: url, rotation: 0, orientationConfirmed: false }; };
    aiRenderInvoiceRotation = async () => ({ dataUrl: 'data:image/jpeg;base64,AQ==', bytes: 1 });
    ${attach ? "receiptAttachTarget = { id: 'old', timestamp: 1, date: '2026-09-20', label: 'x' };" : ''}
    aiScanDocuments = gateDocs; renderReceiving();`);
  const opened = [];
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => opened.push(id); return n; };
  return { c, data, opened };
}
async function start(c) { await c.click('rc-photo-start'); await flush(c); }
function finishBlocked(c) {
  c.run(`receiptList = structuredClone(testData.items); receiptDupConfirmed = true; saveReceiptDraft(); pendingReceipt = null; finishReceipt();`);
  assert.equal(c.run('pendingReceipt'), null, 'nothing to save');
  assert.equal(c.toasts.at(-1), FINISH_BLOCKED);
}
function assertStopped(c, message) {
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), [message], 'one message, instead of "הסכום לא נקרא / צלם את העמוד האחרון"');
  assert.deepEqual(json(c, 'receiptNotes'), [], 'no anchor is adopted, the delivery note\'s neither');
  assert.equal(c.run('yotvataCachedDoc(aiScanDocuments[0])'), true, 'the delivery note is kept: it is not paid for again');
  const status = c.run('yotvataPaperStatusHtml()');
  assert.ok(status.includes(message), 'the receiving screen shows the message');
  assert.match(status, /data-role="rc-photo-repair"[^>]*>בדוק צילומים \/ הוסף עמוד חסר</);
  assert.match(status, /data-role="rc-photo-manual"[^>]*>או הקלד סכום ויחידות</);
  assert.doesNotMatch(status, /הסכום ללא מע״מ לא נקרא|ודא שצולם גם העמוד האחרון|חסרים כמות, סכום נטו/);
}

// ---- the pure rule ----
test('yotvataCreditLikeDocument: a negative subtotal, a negative read or a credit title; nothing else on its own', () => {
  const { c } = setup();
  const like = value => json(c, 'yotvataCreditLikeDocument(' + JSON.stringify(value) + ')');
  const delivery = { subtotalExVat: 93.8, rows: [{ quantity: 10, lineTotalExVat: 50 }] };
  assert.equal(like(null), null);
  assert.equal(like(delivery), null);
  assert.deepEqual(like({ ...delivery, subtotalExVat: -48.8 }), { title: null });
  const split = [{ read: 0, values: { subtotalExVat: 48.8 } }, { read: 1, values: { subtotalExVat: -48.8 } }];
  assert.deepEqual(like({ ...delivery, modelVerification: { issues: ['subtotalExVat'], readings: split } }), { title: null },
    'reads split on the sign');
  // Deliberate: two reads (or a read and the verifier) settled a positive subtotal and one read saw a minus.
  // By the signs alone this is a slip that lost its minus in two reads, so it is stopped too.
  assert.deepEqual(like({ ...delivery, modelVerification: { issues: [], readings: [...split, { read: 2, values: { subtotalExVat: 48.8 } }] } }), { title: null },
    'a settled positive subtotal with one negative read is still stopped (when in doubt, stop)');
  const types = (t, ...votes) => ({ ...delivery, printedTitle: t, modelVerification: { documentType: { readings: votes.map(documentType => ({ documentType, printedTitle: t })) } } });
  // Credit titles as printed by suppliers (the service lists זיכוי, ביטול מכירה and החזרה as credit).
  for (const t of ['חשבונית זכוי', 'חשבונית מס זכוי', 'ביטול מכירות', 'ביטול-מכירה', 'ביטול־מכירה', 'ביטול חשבונית', 'ביטולמכירה'])
    assert.deepEqual(like(types(t, 'delivery', 'unclear')), { title: t }, t + ': the title alone, whatever the reads typed it');
  assert.deepEqual(like(types('תעודת החזרה', 'credit', 'unclear')), { title: 'תעודת החזרה' }, '"החזרה" with a credit vote');
  assert.equal(like(types('תעודת משלוח והחזרה', 'delivery', 'unclear')), null, '"החזרה" without a credit vote: a delivery note with returns');
  assert.equal(like(types('תעודת משלוח והחזרות', 'credit', 'delivery')), null, '"החזרות" (return lines) is not a credit title');
  assert.deepEqual(like({ ...delivery, printedTitle: TITLE }), { title: TITLE }, 'v151: a slip whose minus signs were lost, by its title');
  assert.deepEqual(like({ ...delivery, printedTitle: null, modelVerification: { documentType: { readings: [{ printedTitle: null }, { printedTitle: 'תעודת זיכוי' }] } } }), { title: 'תעודת זיכוי' },
    'the title one of the other reads saw');
  assert.deepEqual(like({ ...delivery, printedTitle: 'ביטול  מכירה' }), { title: 'ביטול  מכירה' });
  assert.deepEqual(like({ ...delivery, printedTitle: 'Credit Note' }), { title: 'Credit Note' });
  assert.deepEqual(like({ ...delivery, subtotalExVat: -48.8, printedTitle: 'תעודת משלוח', modelVerification: { documentType: { readings: [{ printedTitle: 'תעודת משלוח' }, { printedTitle: 'חשבונית זיכוי' }] } } }),
    { title: 'חשבונית זיכוי' }, 'the first credit title is the one shown');
  // Not a credit on its own:
  assert.equal(like({ ...delivery, documentType: 'credit', printedTitle: 'תעודת משלוח',
    modelVerification: { documentType: { value: 'credit', readings: [{ documentType: 'credit', printedTitle: 'תעודת משלוח' }, { documentType: 'delivery', printedTitle: 'תעודת משלוח' }] } } }), null,
    'a "credit" vote with positive money and a delivery title');
  assert.equal(like({ subtotalExVat: 42.7, printedTitle: 'חשבונית מס', rows: [{ quantity: 10, lineTotalExVat: 50 }, { quantity: 1, lineTotalExVat: -7.3 }] }), null, 'a return row inside an invoice');
  assert.equal(like({ ...delivery, documentDiscountExVat: -5 }), null, 'a negative printed discount');
  assert.equal(like({ ...delivery, printedTitle: 'תעודת משלוח — כל הזכויות שמורות' }), null, '"זכויות" (rights reserved) is not a credit title');
  assert.deepEqual(like({ ...delivery, printedTitle: 'ריכוז זיכויים' }), { title: 'ריכוז זיכויים' }, '"זיכויים" (credits) is');
  // tools/photo-first-test.mjs extracts functions only: the rule must stand alone.
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const from = html.indexOf('function yotvataCreditLikeDocument(');
  const sandbox = vm.createContext({});
  vm.runInContext(html.slice(from, html.indexOf('\n}', from) + 2), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.yotvataCreditLikeDocument({ subtotalExVat: 1, printedTitle: 'זיכוי' }))), { title: 'זיכוי' });
});

// ---- the photo gate ----
for (const version of [150, 151]) {
  test(`v${version}: a slip with its minus signs, photographed as document 2, stops the paper with exactly the new message; finish is blocked`, async () => {
    const { c, data } = setup();
    const s = service(c, version, { invoice: deliveryNote(data, version), slip: slip(data, version) });
    await start(c);
    assertStopped(c, MESSAGE(2, version >= 151 ? TITLE : null));
    assert.equal(c.run('yotvataCachedDoc(aiScanDocuments[1])'), false, 'a failing paper is not cached (as before)');
    assert.equal(s.uploads(INVOICE).length, 1); assert.equal(s.uploads(SLIP).length, 1);
    assert.ok(s.uploads().every(e => e.body.detectDocumentType === true && !('documentKind' in e.body)), 'every invoice body asks for the document type');
    finishBlocked(c);
  });
}

test('v151: a slip whose minus signs were dropped is stopped by its printed title', async () => {
  const { c, data } = setup();
  const s = service(c, 151, { invoice: deliveryNote(data, 151), slip: slip(data, 151, { minus: false }) });
  await start(c);
  assertStopped(c, MESSAGE(2, TITLE));
  assert.equal(c.run('yotvataCachedDoc(aiScanDocuments[1])'), true, 'its paper balances, so the read is kept');
  finishBlocked(c);
  // "התחל" again without removing it: nothing is paid for again, and it is still stopped.
  await c.click('rc-photo-repair'); await start(c);
  assert.equal(s.uploads().length, 2);
  assertStopped(c, MESSAGE(2, TITLE));
});

test('v150: the same dropped-minus slip has no title to read — adopted as a second delivery note, as in v393 (documented limitation)', async () => {
  const { c, data } = setup();
  service(c, 150, { invoice: deliveryNote(data, 150), slip: slip(data, 150, { minus: false }) });
  await start(c);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 93.8, units: 16 }, { amount: 48.8, units: 7 }]);
});

test('reads split on the sign: the selected read is positive, another read saw the minus — stopped', async () => {
  for (const version of [150, 151]) {
    const { c, data } = setup();
    service(c, version, { invoice: deliveryNote(data, version), slip: slip(data, version, { minus: false, title: 'תעודה', type: 'unclear', subtotals: [48.8, -48.8] }) });
    await start(c);
    assertStopped(c, MESSAGE(2));
  }
});

// Two reads keep the dropped minus and one read sees it: on service 150 (no title) only the per-read sign
// can hold the slip. A real delivery note with one misread minus looks the same and is stopped too (the worker
// types its anchors) — the price of not billing a slip as goods.
test('reads split on the sign, the positive side settled (2 of 3): a slip is stopped — so is a delivery note with one misread minus', async () => {
  for (const version of [150, 151]) {
    const { c, data } = setup();
    const s = slip(data, version, { minus: false, title: null, type: 'unclear' });
    typed(s.scan.documents[0], version, { subtotals: [48.8, -48.8, 48.8], types: [['unclear', null], ['unclear', null], ['unclear', null]] });
    assert.deepEqual(s.scan.documents[0].modelVerification.issues, [], 'the service settled the positive subtotal');
    service(c, version, { invoice: deliveryNote(data, version), slip: s });
    await start(c);
    assertStopped(c, MESSAGE(2));
  }
  const { c, data } = setup();
  c.run('aiScanDocuments = [gateDocs[0]]');
  const note = deliveryNote(data, 151);
  typed(note.scan.documents[0], 151, { subtotals: [93.8, -93.8, 93.8], types: [['delivery', 'תעודת משלוח'], ['delivery', 'תעודת משלוח'], ['delivery', 'תעודת משלוח']] });
  service(c, 151, { invoice: note });
  await start(c);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), [MESSAGE(1)]);
  assert.match(c.run('yotvataPaperStatusHtml()'), /data-role="rc-photo-manual"[^>]*>או הקלד סכום ויחידות</, 'the typed way out is offered');
});

test('v151: a dropped-minus slip is stopped under every credit title spelling the service calls credit, even when every read typed it "delivery"', async () => {
  for (const [title, type] of [['חשבונית זכוי', 'credit'], ['חשבונית מס זכוי', 'credit'], ['תעודת החזרה', 'credit'], ['ביטול מכירות', 'credit'],
    ['ביטול-מכירה', 'credit'], ['ביטול חשבונית', 'credit'], [TITLE, 'delivery'], ['חשבונית זכוי', 'delivery']]) {
    const { c, data } = setup();
    service(c, 151, { invoice: deliveryNote(data, 151), slip: slip(data, 151, { minus: false, title, type }) });
    await start(c);
    assertStopped(c, MESSAGE(2, title));
  }
});

test('v151: a real delivery note with one "credit" vote, positive money and the title "תעודת משלוח" is adopted (no false alarm)', async () => {
  const { c, data } = setup();
  c.run('aiScanDocuments = [gateDocs[0]]');
  service(c, 151, { invoice: deliveryNote(data, 151, [['credit', 'תעודת משלוח'], ['delivery', 'תעודת משלוח']]) });
  await start(c);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), []);
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 93.8, units: 16 }]);
});

test('an invoice with a return row under a positive subtotal keeps its v393 problems and is never called a credit', async () => {
  for (const version of [150, 151]) {
    const { c, data } = setup();
    c.run('aiScanDocuments = [gateDocs[0]]');
    const note = deliveryNote(data, version, [['delivery', 'חשבונית מס'], ['credit', 'חשבונית מס']]);
    const d = note.scan.documents[0];
    d.rows.push({ ...structuredClone(d.rows[1]), lineNumber: 3, quantity: 1, grossLineTotalExVat: -7.3, lineTotalExVat: -7.3 });
    Object.assign(d, { subtotalExVat: 86.5, printedUnits: 17, printedLines: 3 });
    typed(d, version, { types: [['delivery', 'חשבונית מס'], ['credit', 'חשבונית מס']] });
    service(c, version, { invoice: note });
    await start(c);
    c.context.returnRowDoc = d;
    const expected = json(c, 'yotvataPaperCheck(returnRowDoc, 1).problems').map(p => 'תעודה 1: ' + p);
    assert.ok(expected.length > 0);
    assert.equal(c.run('receiptPaperScanState'), 'failed');
    assert.deepEqual(json(c, 'receiptPaperScanProblems'), expected, 'exactly the paper-check problems of v393');
    assert.doesNotMatch(json(c, 'receiptPaperScanProblems').join(' '), /זיכוי/);
  }
});

test('the way out: remove the slip in «בדוק צילומים» — the delivery note is adopted without a second paid read; the slip through the green button is read as a credit and attached', async () => {
  const { c, data, opened } = setup();
  const s = service(c, 151, { invoice: deliveryNote(data, 151), slip: slip(data, 151), credit: verifiedCredit(data, { number: '22230011' }) });
  await start(c);
  assertStopped(c, MESSAGE(2, TITLE));
  await c.click('rc-photo-repair');
  assert.match(c.node('app').innerHTML, /שלב 1 · צילום תעודה/);
  await c.click('rc-photo-remove-doc', undefined, { doc: '1' });
  assert.equal(c.run('aiScanDocuments.length'), 1);
  await start(c);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 93.8, units: 16 }]);
  assert.equal(s.uploads(INVOICE).length, 1, 'the delivery note was read once, in all');
  // The green button on the receiving screen.
  await c.click('delivery-credit-add');
  const id = c.run('receiptDeliveryCredits.at(-1).id');
  assert.equal(opened.at(-1), 'creditCam_' + id);
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-file', id }, files: [{ name: 'slip.jpg' }], value: 'x' } });
  await flush(c, 5);
  assert.match(c.node('aiOrientationConfirm').innerHTML, /אשר וקרא את הזיכוי/);
  c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
  await flush(c);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'confirmed', c.run('receiptDeliveryCredits[0].error'));
  assert.equal(c.run('receiptDeliveryCredits[0].autoConfirmed'), true);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
  const creditBody = s.log.find(e => e.credit).body;
  assert.equal('detectDocumentType' in creditBody, false, 'a credit body never asks for the document type');
  assert.equal(s.uploads().length, 3, 'delivery note, slip as a document (once), slip as a credit');
  // 9 milk counted: 1 milk and 6 coffee are missing; the credit covers them.
  c.run(`receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 9 }]; receiptDupConfirmed = true; priceAuditSetDate(0, '2026-09-15'); saveReceiptDraft();
    finishReceipt(); aiApplyInvoiceResult(); saveReconciledReceipt({ skipChecked: true });`);
  const p = json(c, 'pendingReceipt');
  assert.ok(p); assert.equal(p.status, 'ok'); assert.equal(p.ex, 45);
  assert.deepEqual(p.shortCreditNotes.map(n => [n.number, n.amount]), [['22230011', 48.8]]);
});

test('the message names the green button as it is shown: another credit, and the 4-credit limit', () => {
  const { c } = setup();
  const slipDoc = { subtotalExVat: -48.8, rows: [] };
  c.context.slipDoc = slipDoc;
  c.run(`receiptDeliveryCredits = [{ id: 'credit-a', status: 'confirmed', pages: [] }]`);
  assert.equal(c.run('yotvataCreditDocumentProblem(slipDoc, 1)'),
    'תעודה 2 נראית כמו תעודת זיכוי — הסר אותה מהתעודות (בדוק צילומים) וצלם אותה בכפתור הירוק «צלם תעודת זיכוי נוספת».');
  c.run(`receiptDeliveryCredits = ['a','b','c','d'].map(id => ({ id: 'credit-' + id, status: 'confirmed', pages: [] }))`);
  assert.equal(c.run('yotvataCreditDocumentProblem(slipDoc, 1)'),
    'תעודה 2 נראית כמו תעודת זיכוי — הסר אותה מהתעודות (בדוק צילומים). כבר צורפו לקליטה 4 זיכויים, וזה המקסימום.');
});

test('attach mode (paper for a saved receipt): the message does not point to a green button that is not there', async () => {
  const { c, data } = setup({ attach: true });
  c.run(`receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 9 }]; renderReceiving()`);
  service(c, 151, { invoice: deliveryNote(data, 151), slip: slip(data, 151) });
  await start(c);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.deepEqual(json(c, 'receiptPaperScanProblems'), [ATTACH_MESSAGE(2, TITLE)]);
});

// ---- typed anchors ----
test('a typed amount or units with a minus is refused and kept for correction (normal and attach mode)', async () => {
  for (const attach of [false, true]) {
    const { c } = setup({ attach });
    c.run(`receiptEntryMode = 'manual'; receiptOpened = true; editingNotes = true; receiptList = structuredClone(testData.items); renderReceiving()`);
    const amount = c.node('rcNoteInput'), units = c.node('rcNoteUnits');
    // Every dash parseNoteVal would strip: hyphen-minus, U+2010..U+2015 (hyphen, non-breaking hyphen,
    // figure dash, en dash, em dash, horizontal bar), minus sign, Hebrew maqaf, small and fullwidth
    // hyphen-minus, and accounting parentheses — in the amount and in the units.
    const dashes = ['-', '‐', '‑', '‒', '–', '—', '―', '−', '־', '﹣', '－'];
    const typedMinus = [['83.52-', '24'], ['(83.52)', '24'], ['83.52', '(24)'], ...dashes.flatMap(d => [[d + '83.52', '24'], ['83.52', d + '24']])];
    for (const [a, u] of typedMinus) {
      amount.value = a; units.value = u;
      await c.click('rc-note-add');
      assert.deepEqual(json(c, 'receiptNotes'), [], a + ' / ' + u + ' is not added');
      assert.equal(c.toasts.at(-1), attach ? MINUS_ATTACH_TOAST : MINUS_TOAST);
      assert.equal(amount.value, a); assert.equal(units.value, u);
    }
    amount.value = '93.80'; units.value = '16';
    await c.click('rc-note-add');
    assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 93.8, units: 16 }], 'a positive entry is added as before');
  }
  // The first entry ("rc-open") is refused the same way: the receipt does not open.
  for (const a of ['-48.80', '—48.80', '‐48.80', '(48.80)']) {
    const { c } = setup();
    c.run(`receiptEntryMode = 'manual'; renderReceiving()`);
    c.node('rcNoteInput').value = a; c.node('rcNoteUnits').value = '7';
    await c.click('rc-open');
    assert.equal(c.run('receiptOpened'), false, a);
    assert.deepEqual(json(c, 'receiptNotes'), []);
    assert.equal(c.toasts.at(-1), MINUS_TOAST);
  }
});

test('typed anchors, read at the comparison (classic path): the credit message comes first and the result cannot be applied', async () => {
  for (const version of [150, 151]) {
    const { c, data } = setup();
    const s = service(c, version, { invoice: deliveryNote(data, version), slip: slip(data, version) });
    // The worker typed the slip as a second delivery note (positive, as v393 forced it).
    c.run(`receiptEntryMode = 'manual'; receiptAnchorSource = 'manual'; receiptOpened = true; receiptNotes = [{ amount: 93.8, units: 16 }, { amount: 48.8, units: 7 }];
      recomputeNoteTotal(); receiptList = structuredClone(testData.items); saveReceiptDraft(); openReconcile();
      aiScanDocuments[0].pages = gateDocs[0].pages; aiScanDocuments[1].pages = gateDocs[1].pages;`);
    await c.click('ai-run'); await flush(c);
    assert.equal(s.uploads().length, 2);
    assert.ok(s.uploads().every(e => e.body.detectDocumentType === true));
    assert.equal(s.uploads(SLIP)[0].body.documents[0].expectedSubtotalExVat, 48.8, 'the typed anchor rides along, as before');
    const ev = c.run('aiScanEvaluation');
    assert.equal(ev.valid, false);
    assert.equal(ev.errors[0], MESSAGE(2, version >= 151 ? TITLE : null));
    // The rest of the evaluator is untouched (its own errors about the negative rows follow the message).
    assert.ok(ev.errors.length > 1);
    const before = json(c, 'reconcileData');
    c.run('aiApplyInvoiceResult()');
    assert.deepEqual(json(c, 'reconcileData'), before, 'nothing is applied');
    assert.equal(c.run('reconcilePaperEntered'), false);
  }
});

// ---- the request bodies ----
test('credit bodies and resume bodies carry no detectDocumentType', async () => {
  const { c, data } = setup();
  const s = service(c, 151, { invoice: deliveryNote(data, 151), credit: verifiedCredit(data) });
  c.run(`receiptDeliveryCredits.push({ id: 'credit-1', status: 'capture', pageCount: 1, pages: [{ dataUrl: '${SLIP}', orientationConfirmed: true }] });`);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true);
  const body = s.log.find(e => e.credit).body;
  assert.equal(body.documentKind, 'credit');
  assert.equal('detectDocumentType' in body, false);
  // A dropped invoice upload is collected by its key: the resume body is only the key (as scan-transport.test.mjs).
  const r = setup();
  r.c.context.setTimeout = (fn, ms) => { if ((Number(ms) || 0) < 10000) setImmediate(fn); return 0; };
  r.c.run('aiScanDocuments = [gateDocs[0]]');
  const bodies = [];
  r.c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return reply(health(151));
    const sent = JSON.parse(options.body); bodies.push(sent);
    if (bodies.length === 1) throw new TypeError('Load failed');
    return reply(deliveryNote(r.data, 151));
  };
  await r.c.run('yotvataStartPaperScan()');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].detectDocumentType, true);
  assert.deepEqual(bodies[1], { reviewProtocolVersion: 1, scanKey: bodies[0].scanKey, resume: true });
  assert.equal(r.c.run('receiptPaperScanState'), 'ok');
});

// ---- against the real companion service (skipped when it is not checked out) ----
const serviceDir = process.env.YOTVATA_AI_SCAN || fileURLToPath(new URL('../../yotvata-ai-scan/', import.meta.url));
const serverFile = new URL('server.js', pathToFileURL(serviceDir.endsWith('/') ? serviceDir : serviceDir + '/'));
const serviceSkip = fs.existsSync(serverFile) ? false : 'the companion service is not checked out next to this repo (set YOTVATA_AI_SCAN=<dir of yotvata-ai-scan>)';
const serviceModule = serviceSkip ? {} : await import(serverFile.href);
const typedSkip = serviceSkip || (serviceModule.DOCUMENT_TYPE_TEXT ? false : 'the companion service predates document type detection (v151)');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode({ aud: 'globrands-db', iss: 'https://securetoken.google.com/globrands-db', sub: 'fixture', iat: now, exp: now + 3600 });
const token = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
// The model's answers by photo: two agreeing cheap reads per document.
function modelDoc({ subtotal, rows, title, type }) {
  const row = ([description, barcode, quantity, unit, total], i) => ({ sourcePage: 1, supplierItemCode: null, barcodeReadType: 'full', lineDiscountExVat: null, promotionText: null,
    lineNumber: i + 1, rowRegion: { x: 10, y: 100 + 40 * i, width: 800, height: 30 }, barcode, catalogHintId: null, catalogCandidateHintIds: [], description,
    quantity, unitPriceExVat: unit, grossLineTotalExVat: total, lineTotalExVat: total, confidence: 0.95 });
  return { noteIndex: 0, invoiceNumber: type === 'credit' ? '22230011' : 'TEST-INVOICE', pageCount: 1, subtotalExVat: subtotal, vatAmount: Math.round(subtotal * 18) / 100,
    totalInclVat: Math.round(subtotal * 118) / 100, printedUnits: rows.reduce((n, r) => n + r[2], 0), printedLines: rows.length, documentDiscountExVat: null,
    confidence: 0.9, warnings: [], rows: rows.map(row), documentType: type, printedTitle: title };
}
const DELIVERY_MODEL = modelDoc({ subtotal: 93.8, type: 'delivery', title: 'תעודת משלוח',
  rows: [['חלב בדיקה', '7290000000008', 10, 5, 50], ['קפה בדיקה', '7290000000015', 6, 7.3, 43.8]] });
const slipModel = minus => modelDoc({ subtotal: minus ? -48.8 : 48.8, type: 'credit', title: TITLE,
  rows: [['קפה בדיקה', '7290000000015', 6, 7.3, minus ? -43.8 : 43.8], ['חלב בדיקה', '7290000000008', 1, 5, minus ? -5 : 5]] });
// The app's fetch goes straight into the real service: GET /health and POST /scan are its own code.
function bridge(c, byPhoto, typedModel) {
  const server = serviceModule.createServer({ env: { OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture-read',
    OPENAI_RETRY_MODEL: 'fixture-verifier', OPENAI_RETRY_SERVICE_TIER: 'priority' },
    logger: { info: () => {}, error: error => { throw error; } },
    fetchImpl: async (url, options) => {
      if (String(url).includes('googleapis.com')) return Response.json({ keys: [jwk] });
      const call = JSON.parse(options.body);
      const photo = JSON.stringify(call).includes(SLIP) ? SLIP : INVOICE;
      const d = structuredClone(byPhoto[photo]);
      if (!typedModel) { delete d.documentType; delete d.printedTitle; }
      return Response.json({ output_text: JSON.stringify({ documents: [d], warnings: [] }), model: call.model, id: 'model-' + Math.random(), usage: { input_tokens: 10, output_tokens: 20 } });
    } });
  const bodies = [];
  c.context.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (options.body) bodies.push(JSON.parse(options.body));
    const out = await new Promise(resolve => {
      const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
      req.method = options.method || 'GET'; req.url = u.pathname; req.socket = { remoteAddress: '127.0.0.1' };
      req.headers = { origin: 'https://asafkiri.github.io', authorization: 'Bearer ' + token };
      server.emit('request', req, { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, write() {}, end(body) { resolve({ status: this.status || 200, body }); } });
    });
    return reply(out.body, out.status);
  };
  return { bodies, close: () => server.close() };
}

test('real service: a slip with its minus signs, sent with the app\'s own invoice body, is stopped (service v150 and v151)', { skip: serviceSkip }, async () => {
  const { c } = setup();
  const typedService = !typedSkip;
  const b = bridge(c, { [INVOICE]: DELIVERY_MODEL, [SLIP]: slipModel(true) }, typedService);
  try {
    await start(c);
    assert.ok(b.bodies.every(body => body.detectDocumentType === true));
    assertStopped(c, MESSAGE(2, typedService ? TITLE : null));
  } finally { b.close(); }
});

test('real service v151: a slip whose minus signs were dropped is stopped by the title the service returned; a delivery note is adopted', { skip: typedSkip }, async () => {
  const { c } = setup();
  const b = bridge(c, { [INVOICE]: DELIVERY_MODEL, [SLIP]: slipModel(false) }, true);
  try {
    await start(c);
    const slipDoc = json(c, 'aiScanDocuments[1].cachedResult.doc');
    assert.equal(slipDoc.printedTitle, TITLE);
    assert.equal(slipDoc.modelVerification.documentType.readings.length, 2);
    assertStopped(c, MESSAGE(2, TITLE));
    await c.click('rc-photo-repair');
    await c.click('rc-photo-remove-doc', undefined, { doc: '1' });
    await start(c);
    assert.equal(c.run('receiptPaperScanState'), 'ok');
    assert.deepEqual(json(c, 'receiptNotes'), [{ amount: 93.8, units: 16 }]);
  } finally { b.close(); }
});
