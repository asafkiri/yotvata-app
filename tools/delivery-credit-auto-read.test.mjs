// v364: the driver credit is read automatically when its last photo is confirmed.
// Field report (iPhone, v363): while the invoice was read in the background, the
// worker photographed the driver's credit slip, confirmed it, had to find a
// separate "decode" button, and the read failed at once with "Load failed".
// These tests run the complete app module (receipt-scan-harness); only fetch,
// timers, image preparation and the Firebase boundary are faked. No network,
// no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture, reply } from './receipt-scan-harness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
// Runs parked timers too (the harness parks every setTimeout callback).
async function flush(c, rounds = 30) {
  for (let i = 0; i < rounds; i++) { for (const cb of c.callbacks.splice(0)) cb(); await tick(); }
}
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const card = c => c.run('deliveryCreditsHtml()');
const OLD_BUTTON = /פענח את הזיכוי|מפענח את הזיכוי|הוסף עמוד לזיכוי/;
const health = version => ({ ok: true, keyConfigured: true, photoFirst: true, serviceVersion: version,
  ...(version >= 148 ? { scanResume: true, creditDocuments: true } : {}) });

// The invoice of delivery-credit.test.mjs: 10 × milk + 6 × coffee, with 6 coffee missing.
function invoiceData() {
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
// A valid driver credit for 6 × coffee, −43.80 before VAT.
function creditPaper(data, { pageCount = 1, amount = 43.8, subtotal } = {}) {
  const raw = structuredClone(data.paper.scan.documents[0].rows[1]);
  Object.assign(raw, { quantity: 6, lineNumber: 1, lineTotalExVat: -amount, grossLineTotalExVat: -amount, sourcePage: pageCount });
  return { ok: true, serviceVersion: 145, model: 'fixture', requestId: 'credit-fixture',
    scan: { warnings: [], documents: [{ noteIndex: 0, invoiceNumber: 'TEST-CREDIT', pageCount,
      subtotalExVat: subtotal ?? -amount, vatAmount: -Math.round(amount * 18) / 100,
      totalInclVat: -Math.round(amount * 118) / 100, printedUnits: 6, printedLines: 1, rows: [raw] }] } };
}

// A scripted scan service. answer(request) returns a Response double (or a
// promise of one) or throws a browser-level network failure.
function service(c, { version = 145, answer }) {
  const log = [], stats = { active: 0, maxActive: 0 };
  c.context.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(version)); }
    assert.ok(u.endsWith('/scan'), 'unexpected request ' + u);
    const body = JSON.parse(options.body);
    const request = { kind: body.resume ? 'resume' : 'full', body, credit: body.documentKind === 'credit' };
    log.push(request);
    // Runaway guard: a regression that reads again after every failure would loop
    // forever on microtasks; park it so the test fails on its counts instead of hanging.
    if (log.filter(e => e.kind !== 'health').length > 8) return new Promise(() => {});
    stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
    try { return await answer(request); } finally { stats.active--; }
  };
  const uploads = () => log.filter(e => e.kind === 'full');
  return { log, stats, uploads, kinds: () => log.map(e => e.kind + (e.credit ? ':credit' : '')) };
}

// Receiving with an already read invoice (as delivery-credit.test.mjs), a camera
// that records which hidden input was opened, and image preparation replaced by
// a fake that names the photo in its data URL.
function setup({ paperFirst = false } = {}) {
  const data = invoiceData();
  const c = runtime('yotvata', { data });
  if (paperFirst) {
    c.run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true;
      aiScanDocuments = [{noteIndex:0, amount:null, units:null, pages:[{dataUrl:'data:image/jpeg;base64,SU5WT0lDRQ==', orientationConfirmed:true}]}];`);
  } else {
    c.context.creditInvoiceFixture = { ...data.paper, docInputs: [{ amount: 93.8, units: 16, pageCount: 1 }] };
    c.run(`receiptOpened=true;receiptDupConfirmed=true;receiptNotes=[{amount:93.8,units:16}];
      receiptList=[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:10}];
      recomputeNoteTotal();restoreDraftScan(creditInvoiceFixture);aiScanFromDraft=true;receiptPaperScanState='ok';
      showConfirm=(t,x,l,fn)=>fn();saveReceiptDraft();`);
  }
  c.run(`aiCompressInvoiceImage = async (file, forceFullFrame, maxPixels) => {
      if (file.fail) throw new Error('decode failed');
      const url = 'data:image/jpeg;base64,' + btoa(file.name);
      return { name: file.name, dataUrl: url, baseDataUrl: url, rotation: 0, orientationConfirmed: false, maxPixels };
    };
    aiRenderInvoiceRotation = async () => ({ dataUrl: 'data:image/jpeg;base64,AQ==', bytes: 1 });`);
  const opened = [];
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => opened.push(id); return n; };
  // The same runaway guard for the harness's own fetch (tests without service()).
  const base = c.context.fetch; let scans = 0;
  c.context.fetch = async (url, options) => String(url).endsWith('/scan') && ++scans > 8 ? new Promise(() => {}) : base(url, options);
  return { c, data, opened };
}
// "הנהג הביא זיכוי על חוסר? צלם כאן": creates the card and opens its camera.
async function addCredit(c, opened) {
  await c.click('delivery-credit-add');
  const id = c.run('receiptDeliveryCredits.at(-1).id');
  assert.equal(opened.at(-1), 'creditCam_' + id, 'the camera opens straight away');
  return id;
}
// The camera/gallery input's change event, exactly as the app listens for it.
async function photograph(c, id, names, { replace = false } = {}) {
  const files = names.map(name => typeof name === 'string' ? { name } : name);
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-file', id, ...(replace ? { replace: '1' } : {}) }, files, value: 'x' } });
  await flush(c, 5);
}
const confirmButton = c => c.node('aiOrientationConfirm').innerHTML;
const morePartShown = c => !c.node('aiOrientationMorePart').classList.contains('hidden');
const pressConfirm = c => c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
const pressMorePart = c => c.events.get('aiOrientationMorePart:click')({ type: 'click' });
const creditStatus = c => c.run('receiptDeliveryCredits[0].status');

test('one photo, one confirmation: exactly one paid read and nothing reads it again', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? creditPaper(data) : data.paper) });
  const invoiceBefore = c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal,receiptNoteUnits])');
  const id = await addCredit(c, opened);
  assert.match(card(c), /data-role="delivery-credit-camera"[^>]*>צלם את תעודת הזיכוי</);
  assert.match(card(c), /data-role="delivery-credit-gallery"[^>]*>בחר צילום מהגלריה</);
  await photograph(c, id, ['slip.jpg']);
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true, 'the new photo opens for checking');
  assert.equal(s.log.length, 0, 'nothing is sent before the photo is confirmed');
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  assert.equal(morePartShown(c), true);
  pressConfirm(c);
  assert.equal(creditStatus(c), 'reading', 'the read starts from the confirmation itself');
  const reading = card(c);
  assert.match(reading, /קורא את הזיכוי… אפשר להמשיך לסרוק מוצרים\./);
  assert.doesNotMatch(reading, /data-role="delivery-credit-(read|retake|camera|page)"/, 'no action can start a second read');
  // Everything that could plausibly double the paid read, while it runs:
  pressConfirm(c); await c.run('aiConfirmOrientationReview()');
  await c.click('delivery-credit-read', id);
  assert.equal(c.run(`deliveryCreditOpenPage(${JSON.stringify(id)}, 0)`), false, 'the photo cannot be reopened while it is read');
  c.run('renderReceiving(); saveReceiptDraft(); deliveryCreditsHtml()');
  await flush(c);
  assert.equal(creditStatus(c), 'review', c.run('receiptDeliveryCredits[0].error'));
  assert.deepEqual(s.kinds(), ['health', 'full:credit'], 'one warm-up and one paid upload');
  assert.deepEqual(s.uploads()[0].body.documents[0].pages, ['data:image/jpeg;base64,' + btoa('slip.jpg')]);
  // …and after it finished: re-render, save, timers, a review-only look at the photo.
  c.run('renderReceiving(); saveReceiptDraft(); deliveryCreditRefreshCards()');
  await flush(c);
  await c.click('delivery-credit-page', id, { page: '0' });
  assert.equal(c.run('aiOrientationSession.reviewOnly'), true);
  assert.equal(morePartShown(c), false, 'no "another part" in a review-only view');
  assert.match(confirmButton(c), /סגור וחזור לתוצאות/);
  pressConfirm(c); await flush(c);
  assert.equal(s.uploads().length, 1);
  assert.equal(c.run('JSON.stringify([aiScanResponse,aiScanRunId,receiptNoteTotal,receiptNoteUnits])'), invoiceBefore);
  assert.match(card(c), /האם זה זיכוי על חוסר במשלוח הנוכחי/);
  assert.doesNotMatch(reading + card(c), OLD_BUTTON);
});

test('a long slip in two parts: "הפתק ארוך? צלם עוד חלק" reads nothing until the last part is confirmed', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? creditPaper(data, { pageCount: 2 }) : data.paper) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['top.jpg']);
  assert.equal(morePartShown(c), true);
  pressMorePart(c);
  assert.equal(opened.at(-1), 'creditCam_' + id, 'the camera opens for the next part within the same tap');
  assert.equal(c.run('aiOrientationSession'), null);
  await flush(c);
  assert.equal(s.log.length, 0, 'part 1 alone is never read');
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].orientationConfirmed'), true);
  await photograph(c, id, ['bottom.jpg']);
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[1]'), true);
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  pressConfirm(c); await flush(c);
  assert.deepEqual(s.kinds(), ['health', 'full:credit']);
  assert.deepEqual(s.uploads()[0].body.documents[0].pages,
    ['data:image/jpeg;base64,' + btoa('top.jpg'), 'data:image/jpeg;base64,' + btoa('bottom.jpg')], 'one upload with both parts in order');
  assert.equal(creditStatus(c), 'review', c.run('receiptDeliveryCredits[0].error'));
});

test('a camera that is closed without a photo leaves one clear "קרא את הזיכוי"', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: () => reply(creditPaper(data)) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['slip.jpg']);
  pressMorePart(c); await flush(c);
  const html = card(c);
  assert.match(html, /data-role="delivery-credit-read"[^>]*>קרא את הזיכוי</);
  assert.match(html, /data-role="delivery-credit-camera"[^>]*>הזיכוי ארוך\? הוסף עוד צילום</);
  assert.doesNotMatch(html, OLD_BUTTON);
  assert.equal(s.log.length, 0);
  await c.click('delivery-credit-read', id);
  assert.equal(s.uploads().length, 1); assert.equal(creditStatus(c), 'review');
});

test('a credit photographed during the background invoice read opens for checking and waits its turn', async () => {
  const { c, data, opened } = setup({ paperFirst: true });
  let releaseInvoice;
  const s = service(c, { answer: req => req.credit ? reply(creditPaper(data))
    : new Promise(resolve => { releaseInvoice = () => resolve(reply(data.paper)); }) });
  const invoice = c.run('yotvataStartPaperScan()');
  await flush(c, 10);
  assert.equal(c.run('aiScanBusy'), true);
  assert.deepEqual(s.kinds(), ['health', 'full']);
  const runId = c.run('aiScanRunId'), banner = c.run('aiScanProgressText');
  const id = await addCredit(c, opened);
  await photograph(c, id, ['slip.jpg']);
  assert.equal(c.run('aiOrientationSession && aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true,
    'v363 never opened this window while the invoice was read');
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  pressConfirm(c); await flush(c, 10);
  assert.equal(creditStatus(c), 'reading');
  assert.equal(c.run('receiptDeliveryCredits[0].waiting'), true);
  assert.deepEqual(s.kinds(), ['health', 'full'], 'not even the credit warm-up while the invoice upload is open');
  assert.match(card(c), /ממתין לסיום קריאת החשבונית — הזיכוי ייקרא מיד אחריה\. אפשר להמשיך לסרוק מוצרים\./);
  assert.equal(c.run('aiScanProgressText'), banner, 'the invoice banner is untouched');
  releaseInvoice();
  await invoice; await flush(c);
  assert.deepEqual(s.kinds(), ['health', 'full', 'health', 'full:credit']);
  assert.equal(s.stats.maxActive, 1, 'never two paid uploads at once');
  assert.equal(creditStatus(c), 'review', c.run('receiptDeliveryCredits[0].error'));
  assert.equal(c.run('receiptDeliveryCredits[0].waiting'), false);
  assert.equal(c.run('aiScanRunId'), runId, 'the credit never restarts or cancels the invoice read');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
});

test('invoice pages stay locked during their read; credit pages open, from the queue and from the card', async () => {
  const { c, opened } = setup();
  c.run(`aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:[{dataUrl:'data:image/jpeg;base64,SU5W',orientationConfirmed:false}]}];
    receiptDeliveryCredits=[{id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Q1I=',orientationConfirmed:false}]}];
    aiScanBusy=true`);
  const html = card(c);
  assert.match(html, /data-role="delivery-credit-page" data-id="credit-1" data-page="0"[^>]*>בדוק ואשר את הצילום</);
  assert.doesNotMatch(html, /data-role="delivery-credit-read"/, 'an unchecked photo is never read');
  assert.equal(c.run('aiOpenOrientationReview(0,0,false)'), false, 'the invoice page is locked as before');
  assert.equal(c.run('aiOpenNextUnconfirmedOrientation()'), true);
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true, 'the credit page opens instead');
  c.run('aiCloseOrientationReview()');
  await c.click('delivery-credit-page', 'credit-1', { page: '0' });
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true, 'the card button opens it');
  c.run('aiCloseOrientationReview(); aiScanBusy=false');
  assert.equal(c.run('aiOpenNextUnconfirmedOrientation()'), true);
  assert.equal(c.run('aiOrientationSession.page === aiScanDocuments[0].pages[0]'), true, 'without a read the invoice still comes first');
  // A photo just taken for a credit is what opens, not an older unchecked page elsewhere.
  c.run('aiCloseOrientationReview()');
  const id = await addCredit(c, opened);
  await photograph(c, id, ['new.jpg']);
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[1].pages[0]'), true);
});

test('confirming an invoice page never reads a credit, and its buttons are unchanged', async () => {
  const { c, data } = setup();
  const s = service(c, { answer: req => reply(req.credit ? creditPaper(data) : data.paper) });
  c.run(`receiptDeliveryCredits=[{id:'credit-1',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,Q1I=',orientationConfirmed:true}]}];
    aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:[{dataUrl:'data:image/jpeg;base64,SU5W',orientationConfirmed:false}]}];
    aiOpenOrientationReview(0,0,true)`);
  assert.match(confirmButton(c), /אשר תמונה מלאה/);
  assert.doesNotMatch(confirmButton(c), /זיכוי/);
  assert.equal(morePartShown(c), false);
  pressConfirm(c); await flush(c);
  assert.equal(s.log.filter(e => e.credit).length, 0);
  assert.equal(creditStatus(c), 'capture');
  assert.match(card(c), /data-role="delivery-credit-read"[^>]*>קרא את הזיכוי</);
});

test('v147: a dropped connection is explained in Hebrew; "נסה שוב" reads the same photo again', async () => {
  const { c, data, opened } = setup();
  let drop = true;
  const s = service(c, { version: 147, answer: req => {
    if (req.kind === 'resume') return reply({ ok: false, error: 'invalid_document_count', serviceVersion: 147 }, 400);
    if (drop) { drop = false; throw new TypeError('Load failed'); }
    return reply(creditPaper(data));
  } });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['slip.jpg']);
  pressConfirm(c); await flush(c);
  assert.deepEqual(s.kinds(), ['health', 'full:credit'], 'v147: one attempt, never a blind paid retry');
  const credit = json(c, 'receiptDeliveryCredits[0]');
  assert.equal(credit.status, 'error'); assert.equal(credit.errorKind, 'network');
  const html = card(c), main = html.match(/<p class="mt-2 text-amber-800 font-bold">([^<]*)<\/p>/)[1];
  assert.match(main, /בדוק שיש קליטה ונסה שוב/);
  assert.doesNotMatch(main, /[A-Za-z]/, 'no English in the message: ' + main);
  assert.doesNotMatch(html, /ניסיונות/);
  assert.match(html, /<p class="[^"]*text-\[11px\][^"]*" dir="ltr">Load failed[^<]*<\/p>/, 'the browser text only as a small technical line');
  assert.doesNotMatch(html.replace(/<p[^>]*dir="ltr"[^>]*>[^<]*<\/p>/g, ''), /Load failed/);
  assert.match(html, /data-role="delivery-credit-read"[^>]*>נסה שוב</);
  assert.match(html, /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
  assert.match(html, /<img src="data:image\/jpeg;base64,/, 'the photo is still there');
  assert.equal(await c.click('delivery-credit-read', id), true);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'resume', 'full:credit'],
    'the retry first asks to collect (free on v147), then sends the photo once');
  assert.equal(new Set(s.uploads().map(e => e.body.scanKey)).size, 1, 'both uploads carry the same key');
  assert.deepEqual(s.uploads()[1].body.documents[0].pages, s.uploads()[0].body.documents[0].pages);
  assert.equal(creditStatus(c), 'review');
  assert.doesNotMatch(card(c), OLD_BUTTON);
});

test('v148: after the automatic reconnects give up, "נסה שוב" collects the running read without paying again', async () => {
  const { c, data, opened } = setup();
  let resumes = 0;
  const s = service(c, { version: 148, answer: req => {
    if (req.kind === 'full') throw new TypeError('Load failed');
    if (++resumes <= 2) throw new TypeError('Load failed');
    return reply({ ...creditPaper(data), serviceVersion: 148 });
  } });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['slip.jpg']);
  pressConfirm(c); await flush(c, 60);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'resume', 'resume']);
  assert.equal(creditStatus(c), 'error');
  assert.match(c.run('receiptDeliveryCredits[0].error'), /ניסיון נוסף יאסוף אותה בלי צילום חדש/);
  assert.equal(c.run('receiptDeliveryCredits[0].progress'), '', 'no stale reconnect text on the error card');
  assert.match(card(c), /data-role="delivery-credit-read"[^>]*>נסה שוב</);
  await c.click('delivery-credit-read', id); await flush(c);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'resume', 'resume', 'health', 'resume']);
  assert.equal(s.uploads().length, 1, 'the photo was paid for exactly once');
  assert.equal(creditStatus(c), 'review');
});

test('a read that finishes while the worker counts updates only the credit card, not the whole screen', async () => {
  for (const good of [true, false]) {
    const { c, data, opened } = setup();
    let release;
    service(c, { answer: () => new Promise(resolve => { release = () => resolve(reply(good ? creditPaper(data) : creditPaper(data, { subtotal: -40 }))); }) });
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']); pressConfirm(c); await flush(c);
    assert.equal(typeof release, 'function');
    c.node('app').innerHTML = '<input data-role="amount" data-id="milk" value="7">'; // the worker is typing a quantity
    release(); await flush(c);
    assert.equal(creditStatus(c), good ? 'review' : 'error');
    assert.equal(c.node('app').innerHTML, '<input data-role="amount" data-id="milk" value="7">', 'the receiving screen was not rebuilt');
    assert.match(c.node('rcDeliveryCredits').outerHTML, good ? /האם זה זיכוי על חוסר במשלוח הנוכחי/ : /צלם את הזיכוי מחדש/);
  }
});

// v364: credit A is in review and the worker is typing its number (not committed
// yet: the app saves it on `change`) while credit B's read finishes. Rebuilding
// the whole credits section would wipe the typed text and close the keyboard.
test('a credit read that finishes while the worker types in another credit never rebuilds the field being typed in', async () => {
  for (const role of ['delivery-credit-number', 'delivery-credit-barcode']) {
    const { c, data, opened } = setup();
    const releases = [];
    service(c, { answer: () => new Promise(resolve => {
      const number = releases.length ? 'CR-B' : 'CR-A';
      releases.push(() => resolve(reply({ ...creditPaper(data), scan: { ...creditPaper(data).scan,
        documents: [{ ...creditPaper(data).scan.documents[0], invoiceNumber: number }] } })));
    }) });
    const a = await addCredit(c, opened);
    await photograph(c, a, ['a.jpg']); pressConfirm(c); await flush(c);
    const b = await addCredit(c, opened);
    await photograph(c, b, ['b.jpg']); pressConfirm(c); await flush(c);
    releases.shift()(); await flush(c);
    assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => x.status)'), ['review', 'reading'], role);
    // The DOM the worker sees: two cards inside the section, the cursor in card A.
    const writes = { section: 0, cards: {} };
    const cardNode = id => ({ set outerHTML(html) { writes.cards[id] = html; } });
    const cards = { [a]: cardNode(a), [b]: cardNode(b) };
    const input = { dataset: { role, id: a, row: '0' }, value: '555', closest: s => s === '[data-delivery-credit]' ? cards[a] : null };
    const host = c.node('rcDeliveryCredits');
    Object.defineProperty(host, 'outerHTML', { configurable: true, get: () => '', set: () => { writes.section++; } });
    host.contains = el => el === input;
    host.querySelector = selector => Object.entries(cards).find(([id]) => selector === '[data-delivery-credit="' + id + '"]')?.[1] || null;
    c.context.document.activeElement = input;
    c.run('renderReceiving = () => { throw new Error("no full render while a credit is read"); }');
    releases.shift()(); await flush(c);
    assert.equal(c.run('receiptDeliveryCredits[1].status'), 'review', role);
    assert.equal(writes.section, 0, role + ': the section holding the typed field is not rebuilt');
    assert.equal(writes.cards[a], undefined, role + ': the card being typed in is left alone');
    assert.match(writes.cards[b] || '', /^<article data-delivery-credit="[^"]+"[\s\S]*האם זה זיכוי על חוסר במשלוח הנוכחי/, role + ': the finished credit shows its result');
    assert.equal(c.run('receiptDeliveryCredits[0].number'), 'CR-A', role + ': nothing committed behind the worker\'s back');
    // Typing somewhere else (a quantity field) or nowhere: the whole section refreshes as before.
    c.context.document.activeElement = { dataset: { role: 'amount' }, closest: () => null };
    c.run('deliveryCreditRefreshCards()');
    assert.equal(writes.section, 1, role);
    c.context.document.activeElement = null;
    c.run('deliveryCreditRefreshCards()');
    assert.equal(writes.section, 2, role);
  }
});

test('the reconnect text shows on the credit card while it is read', () => {
  const { c } = setup();
  c.run(`receiptDeliveryCredits=[{id:'credit-1',status:'reading',pageCount:1,progress:'החיבור נפל, מתחבר מחדש לקריאה שכבר רצה (ניסיון 2 מתוך 3)…',
    pages:[{dataUrl:'data:image/jpeg;base64,Q1I=',orientationConfirmed:true}]}]`);
  assert.match(card(c), /קורא את הזיכוי…[\s\S]*מתחבר מחדש לקריאה שכבר רצה \(ניסיון 2 מתוך 3\)/);
});

test('unreadable paper asks for a new photo; the retake replaces it only after it is ready, and reads the new one', async () => {
  const { c, data, opened } = setup();
  let paper = creditPaper(data, { subtotal: -40 });
  const s = service(c, { answer: () => reply(paper) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['blurry.jpg']);
  pressConfirm(c); await flush(c);
  assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), 'paper');
  let html = card(c);
  assert.match(html, /סכום שורות הזיכוי אינו תואם/);
  assert.match(html, /data-role="delivery-credit-retake"[^>]*class="[^"]*bg-emerald-600[^"]*">צלם את הזיכוי מחדש</, 'retake is the main action');
  assert.match(html, /data-role="delivery-credit-read"[^>]*>נסה לקרוא שוב את אותו צילום</);
  assert.match(html, /id="creditRetake_[^"]+" data-role="delivery-credit-file" data-replace="1"[^>]*capture="environment"/);
  await c.click('delivery-credit-retake', id);
  assert.equal(opened.at(-1), 'creditRetake_' + id);
  // A photo that cannot be prepared keeps the old one.
  await photograph(c, id, [{ name: 'broken.jpg', fail: true }], { replace: true });
  assert.deepEqual(json(c, 'receiptDeliveryCredits[0].pages.map(p => p.name)'), ['blurry.jpg']);
  assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), 'photo');
  assert.match(card(c), /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
  assert.equal(s.uploads().length, 1);
  paper = creditPaper(data);
  await photograph(c, id, ['sharp.jpg'], { replace: true });
  assert.deepEqual(json(c, 'receiptDeliveryCredits[0].pages.map(p => p.name)'), ['sharp.jpg'], 'replaced, not appended');
  assert.equal(c.run('receiptDeliveryCredits[0].error'), '');
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true);
  assert.equal(s.uploads().length, 1, 'the retake is not read before it is confirmed');
  pressConfirm(c); await flush(c);
  assert.equal(s.uploads().length, 2);
  assert.deepEqual(s.uploads()[1].body.documents[0].pages, ['data:image/jpeg;base64,' + btoa('sharp.jpg')]);
  assert.equal(creditStatus(c), 'review', c.run('receiptDeliveryCredits[0].error'));
});

test('reload and cloud restore of reading or failed credits never read; only a new photo is offered', async () => {
  const { c, data, opened } = setup();
  let hold = null, drop = true;
  service(c, { answer: () => {
    if (drop) { drop = false; throw new TypeError('Load failed'); }
    return new Promise(resolve => { hold = resolve; });
  } });
  const failed = await addCredit(c, opened);
  await photograph(c, failed, ['a.jpg']); pressConfirm(c); await flush(c);
  const pending = await addCredit(c, opened);
  await photograph(c, pending, ['b.jpg']); pressConfirm(c); await flush(c);
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => x.status)'), ['error', 'reading']);
  assert.equal(typeof hold, 'function');
  c.run('saveReceiptDraft()');
  const payload = json(c, 'receiptDraftPayload(true)');
  const check = async (restored, label) => {
    await flush(restored);
    restored.run('renderReceiving(); saveReceiptDraft()'); await flush(restored);
    assert.equal(restored.requests.filter(r => r.url.endsWith('/scan')).length, 0, label + ': no paid read');
    assert.deepEqual(json(restored, 'receiptDeliveryCredits.map(x => x.status)'), ['error', 'interrupted'], label);
    const html = card(restored);
    assert.equal((html.match(/data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</g) || []).length, 2, label);
    assert.doesNotMatch(html, /data-role="delivery-credit-(read|page|gallery)"/, label + ': no retry without photos');
    assert.doesNotMatch(html, /Load failed|נסה שוב</, label);
    assert.match(html, /לא הושלם.*צלם אותו שוב/, label);
  };
  await check(runtime('yotvata', { data, storage: c.storage }), 'reload');
  const remote = runtime('yotvata', { data });
  remote.context.remoteDraft = payload;
  remote.run('restoreReceiptDraft(remoteDraft)');
  await check(remote, 'cloud');
});

// v364: after a reload the credit has pages=[] and pageCount 1. The retake's photo
// then fails to prepare: the card must show that new error, not the reload text.
test('after a reload, a retake photo that cannot be prepared shows its own error and a working camera', async () => {
  const LOST = /פענוח הזיכוי לא הושלם והצילום לא נשמר/;
  const fakeImages = r => {
    r.run(`aiCompressInvoiceImage = async file => { if (file.fail) throw new Error('decode failed');
      const url = 'data:image/jpeg;base64,' + btoa(file.name);
      return { name: file.name, dataUrl: url, baseDataUrl: url, rotation: 0, orientationConfirmed: false }; }`);
    const opened = [];
    r.context.document.getElementById = id => { const n = r.node(id); n.click = () => opened.push(id); return n; };
    return opened;
  };
  for (const how of ['network', 'interrupted']) {
    const { c, data, opened } = setup();
    service(c, { answer: () => { if (how === 'network') throw new TypeError('Load failed'); return new Promise(() => {}); } });
    const id = await addCredit(c, opened);
    await photograph(c, id, ['a.jpg']); pressConfirm(c); await flush(c);
    assert.equal(creditStatus(c), how === 'network' ? 'error' : 'reading', how);
    c.run('saveReceiptDraft()');
    const r = runtime('yotvata', { data, storage: c.storage }); await flush(r);
    const camera = fakeImages(r);
    assert.match(card(r), LOST, how);
    await r.click('delivery-credit-retake', id);
    assert.equal(camera.at(-1), 'creditRetake_' + id);
    await photograph(r, id, [{ name: 'broken.jpg', fail: true }], { replace: true });
    const credit = json(r, 'receiptDeliveryCredits[0]'), html = card(r);
    assert.equal(credit.errorKind, 'photo', how); assert.equal(credit.pageCount, 0, how);
    assert.match(html, /לא הצלחנו להכין את הצילום/, how + ': the new error is shown');
    assert.doesNotMatch(html, LOST, how + ': not the stale reload text');
    assert.match(html, /dir="ltr">decode failed</, how);
    assert.equal((html.match(/bg-emerald-600 text-white rounded-xl/g) || []).length, 1, how + ': one main action');
    assert.match(html, /data-role="delivery-credit-camera"[^>]*bg-emerald-600[^>]*>צלם את תעודת הזיכוי</, how);
    assert.match(html, /data-role="delivery-credit-gallery"/, how);
    // The same card after another reload, and a good photo afterwards.
    r.run('saveReceiptDraft()');
    const again = runtime('yotvata', { data, storage: r.storage }); await flush(again);
    assert.match(card(again), /לא הצלחנו להכין את הצילום/, how); assert.doesNotMatch(card(again), LOST, how);
    await photograph(r, id, ['good.jpg']);
    assert.deepEqual(json(r, 'receiptDeliveryCredits[0].pages.map(p => p.name)'), ['good.jpg'], how);
    assert.equal(r.requests.filter(x => x.url.endsWith('/scan')).length, 0, how + ': nothing read on its own');
  }
  // A retake that failed before the reload kept the old photo, so after the reload
  // the photo is really lost: that card still says so and asks for a new photo.
  const { c, data, opened } = setup();
  service(c, { answer: () => { throw new TypeError('Load failed'); } });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['a.jpg']); pressConfirm(c); await flush(c);
  await photograph(c, id, [{ name: 'broken.jpg', fail: true }], { replace: true });
  assert.equal(c.run('receiptDeliveryCredits[0].pageCount'), 1);
  c.run('saveReceiptDraft()');
  const r = runtime('yotvata', { data, storage: c.storage }); await flush(r);
  assert.match(card(r), LOST);
  assert.match(card(r), /data-role="delivery-credit-retake"[^>]*bg-emerald-600[^>]*>צלם את הזיכוי מחדש</);
});

test('deleting an extra photo or a sign-in that is not ready never sends silently; "קרא את הזיכוי" remains', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: () => reply(creditPaper(data)) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['a.jpg', 'b.jpg']);
  assert.match(confirmButton(c), /אשר תמונה מלאה/, 'page 1 of 2 is not the last one');
  assert.equal(morePartShown(c), false);
  pressConfirm(c);
  assert.equal(s.log.length, 0);
  await flush(c);
  assert.equal(c.run('aiOrientationSession.page === receiptDeliveryCredits[0].pages[1]'), true);
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  c.run('aiCancelOrientationReview()'); await flush(c);
  assert.equal(c.run('receiptDeliveryCredits[0].pages.length'), 1);
  assert.equal(s.log.length, 0, 'deleting a photo never starts a read');
  assert.match(card(c), /data-role="delivery-credit-read"[^>]*class="[^"]*bg-emerald-600[^"]*">קרא את הזיכוי</);
  // Sign-in not ready at the moment of confirmation: a message, no read, the same button stays.
  const second = await addCredit(c, opened);
  c.run('savedAuth = auth; auth = { currentUser: null }');
  await photograph(c, second, ['c.jpg']); pressConfirm(c); await flush(c);
  assert.equal(s.log.length, 0);
  assert.match(c.toasts.at(-1), /המתן לחיבור המאובטח/);
  assert.equal(c.run('receiptDeliveryCredits[1].status'), 'capture');
  c.run('auth = savedAuth');
  await c.click('delivery-credit-read', second);
  assert.equal(s.uploads().length, 1);
  assert.equal(c.run('receiptDeliveryCredits[1].status'), 'review', c.run('receiptDeliveryCredits[1].error'));
});

test('the old separate "decode" step is gone from every state of the card', async () => {
  const { c } = setup();
  const page = (confirmed) => `{dataUrl:'data:image/jpeg;base64,Q1I=',orientationConfirmed:${confirmed}}`;
  const states = [
    `{id:'s1',status:'capture',pageCount:0,pages:[]}`,
    `{id:'s2',status:'preparing',pageCount:0,pages:[]}`,
    `{id:'s3',status:'capture',pageCount:1,pages:[${page(false)}]}`,
    `{id:'s4',status:'capture',pageCount:1,pages:[${page(true)}]}`,
    `{id:'s5',status:'reading',waiting:true,pageCount:1,pages:[${page(true)}]}`,
    `{id:'s6',status:'error',errorKind:'service',error:'שירות הפענוח לא הצליח לענות כרגע. נסה שוב בעוד רגע.',errorDetail:'HTTP 502',pageCount:1,pages:[${page(true)}]}`,
    `{id:'s7',status:'interrupted',pageCount:1,pages:[]}`
  ];
  for (const state of states) {
    c.run(`receiptDeliveryCredits=[${state}]`);
    const html = card(c);
    assert.doesNotMatch(html, OLD_BUTTON, state);
    assert.ok((html.match(/bg-emerald-600 text-white rounded-xl/g) || []).length <= 1, 'one main action: ' + state);
  }
  c.run(`receiptDeliveryCredits=[${states[5]}]`);
  assert.match(card(c), /data-role="delivery-credit-read"[^>]*>נסה שוב<[\s\S]*data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
  assert.match(card(c), /dir="ltr">HTTP 502</);
  c.run(`receiptDeliveryCredits=[${states[1]}]`);
  assert.match(card(c), /מכין את הצילום…/);
});

const mainText = html => (html.match(/<p class="mt-2 text-amber-800 font-bold">([^<]*)<\/p>/) || [])[1] || '';

for (const kind of ['paper', 'service']) test('looking at the photo of a credit whose read failed (' + kind + ') never pays for another read', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: () => kind === 'paper' ? reply(creditPaper(data, { subtotal: -40 }))
    : reply({ ok: false, error: 'openai_error', message: 'The server had an error while processing your request.' }, 500) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['slip.jpg']);
  pressConfirm(c); await flush(c);
  assert.equal(creditStatus(c), 'error'); assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), kind);
  const error = c.run('receiptDeliveryCredits[0].error');
  await c.click('delivery-credit-page', id, { page: '0' });
  assert.doesNotMatch(confirmButton(c), /קרא/, 'the green button does not promise a read');
  assert.equal(morePartShown(c), false);
  pressConfirm(c); await flush(c);
  assert.equal(c.run('aiOrientationSession'), null, 'the window closes');
  assert.equal(s.uploads().length, 1, 'viewing the photo is never a paid read');
  assert.equal(creditStatus(c), 'error', 'the card keeps its message and its actions');
  assert.equal(c.run('receiptDeliveryCredits[0].error'), error);
  // A photo that was changed (rotated) is a new photo: confirming it reads it.
  await c.click('delivery-credit-page', id, { page: '0' });
  c.events.get('aiOrientationRight:click')({ type: 'click' }); await flush(c);
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  pressConfirm(c); await flush(c);
  assert.equal(s.uploads().length, 2);
});

test('the main line of a failed credit is Hebrew; Firebase and OpenAI English goes only to the small technical line', async () => {
  const cases = [
    ['sign-in renewal without reception', { getIdToken: true }, 'network', /Firebase: Error \(auth\/network-request-failed\)/],
    ['OpenAI error passed through', { status: 429, message: 'Rate limit reached for gpt-5 in organization org-x on tokens per min (TPM).' }, 'service', /^Rate limit reached for gpt-5/],
    ['OpenAI error without a message', { status: 500 }, 'service', /^openai_error$/]
  ];
  for (const [label, how, errorKind, detail] of cases) {
    const { c, data, opened } = setup();
    const s = service(c, { answer: () => reply({ ok: false, error: 'openai_error', ...(how.message ? { message: how.message } : {}) }, how.status) });
    if (how.getIdToken) c.run(`auth = { currentUser: { getIdToken: async () => { const e = new Error('Firebase: Error (auth/network-request-failed).');
      e.code = 'auth/network-request-failed'; e.name = 'FirebaseError'; throw e; } } }`);
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']);
    pressConfirm(c); await flush(c);
    const credit = json(c, 'receiptDeliveryCredits[0]'), html = card(c);
    assert.equal(credit.status, 'error', label); assert.equal(credit.errorKind, errorKind, label);
    assert.ok(mainText(html), label);
    assert.doesNotMatch(mainText(html), /[A-Za-z]/, label + ': ' + mainText(html));
    assert.match(credit.errorDetail, detail, label);
    assert.match(html, /<p class="mt-1 text-\[11px\] text-slate-400" dir="ltr">[^<]+<\/p>/, label);
    assert.match(html, /data-role="delivery-credit-read"[^>]*class="[^"]*bg-emerald-600[^"]*">נסה שוב</, label);
    assert.equal(s.uploads().length, how.getIdToken ? 0 : 1, label);
  }
});

test('a credit queued behind another credit says so — not the invoice — and both are read one after the other', async () => {
  const { c, data, opened } = setup();
  const releases = [];
  const s = service(c, { answer: () => new Promise(resolve => { releases.push(() => resolve(reply(creditPaper(data)))); }) });
  const a = await addCredit(c, opened);
  await photograph(c, a, ['a.jpg']); pressConfirm(c); await flush(c);
  const b = await addCredit(c, opened);
  await photograph(c, b, ['b.jpg']); pressConfirm(c); await flush(c);
  assert.equal(c.run('aiScanBusy'), false, 'no invoice read at all');
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => [x.status, !!x.waiting])'), [['reading', false], ['reading', true]]);
  const notice = c.run('deliveryCreditNoticeHtml(receiptDeliveryCredits[1])');
  assert.match(notice, /ממתין לסיום קריאת זיכוי אחר — הזיכוי ייקרא מיד אחריו\. אפשר להמשיך לסרוק מוצרים\./);
  assert.doesNotMatch(notice, /החשבונית/);
  releases.shift()(); await flush(c);
  assert.equal(c.run('receiptDeliveryCredits[1].waiting'), false);
  releases.shift()(); await flush(c);
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => x.status)'), ['review', 'review']);
  assert.equal(s.stats.maxActive, 1);
  assert.equal(JSON.stringify(json(c, 'deliveryCreditSnapshot()')).includes('waitingFor'), false);
});

test('a second part that cannot be prepared keeps part 1; the main action photographs the next part again', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: () => reply(creditPaper(data, { pageCount: 2 })) });
  const id = await addCredit(c, opened);
  await photograph(c, id, ['top.jpg']);
  pressMorePart(c); await flush(c);
  await photograph(c, id, [{ name: 'bottom.jpg', fail: true }]);
  assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), 'part');
  assert.deepEqual(json(c, 'receiptDeliveryCredits[0].pages.map(p => [p.name, p.orientationConfirmed])'), [['top.jpg', true]]);
  const html = card(c);
  assert.equal((html.match(/bg-emerald-600 text-white rounded-xl/g) || []).length, 1, 'one main action');
  assert.match(html, /data-role="delivery-credit-camera"[^>]*class="[^"]*bg-emerald-600[^"]*">צלם שוב את החלק הבא</);
  assert.match(html, /data-role="delivery-credit-read"[^>]*>קרא את הזיכוי</);
  assert.match(html, /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
  assert.match(html, /לא הצלחנו להכין את הצילום/);
  await c.click('delivery-credit-camera', id);
  assert.equal(opened.at(-1), 'creditCam_' + id, 'the camera that adds a part, not the one that replaces');
  await photograph(c, id, ['bottom.jpg']);
  assert.deepEqual(json(c, 'receiptDeliveryCredits[0].pages.map(p => [p.name, p.orientationConfirmed])'), [['top.jpg', true], ['bottom.jpg', false]]);
  assert.equal(s.log.length, 0);
  pressConfirm(c); await flush(c);
  assert.deepEqual(s.uploads()[0].body.documents[0].pages, ['top.jpg', 'bottom.jpg'].map(n => 'data:image/jpeg;base64,' + btoa(n)));
  assert.equal(creditStatus(c), 'review', c.run('receiptDeliveryCredits[0].error'));
  // A failed replacement is still a full retake, and after a reload only a new photo is offered.
  c.run(`receiptDeliveryCredits=[{id:'p1',status:'error',errorKind:'part',error:'לא הצלחנו להכין את הצילום. צלם שוב.',pageCount:1,pages:[]}]`);
  assert.match(card(c), /data-role="delivery-credit-retake"[^>]*bg-emerald-600[^>]*>צלם את הזיכוי מחדש</);
});

test('"הפתק ארוך? צלם עוד חלק" after moving the crop frame: the crop is saved first, the camera opens inside the next tap', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: () => reply(creditPaper(data, { pageCount: 2 })) });
  // Like the real crop: the source photo is decoded in a later task, never inside the tap.
  c.run(`aiApplyCropIfMoved = async page => { await new Promise(resolve => setTimeout(resolve, 0));
    page.cropped = true; page.dataUrl = 'data:image/jpeg;base64,Q1JPUA=='; return true; }`);
  let gesture = false; const camera = [];
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => { opened.push(id); camera.push({ id, gesture }); }; return n; };
  const tap = id => { gesture = true; try { return c.events.get(id + ':click')({ type: 'click', target: c.node(id) }); } finally { gesture = false; } };
  const id = await addCredit(c, opened);
  await photograph(c, id, ['top.jpg']);
  c.run('aiOrientationSession.cropMode = true; aiCropState = { moved: true }; aiUpdateOrientationControls();');
  assert.equal(morePartShown(c), true);
  const before = camera.length;
  await Promise.all([tap('aiOrientationMorePart'), flush(c)]); await flush(c);
  assert.equal(camera.length, before, 'no camera request after the tap is over (iOS would ignore it)');
  assert.equal(c.run('aiOrientationSession !== null && aiOrientationSession.cropMode === false'), true, 'the window stays open');
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].cropped'), true);
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].orientationConfirmed'), false);
  assert.equal(morePartShown(c), true);
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  // v364: the full-screen window (z-95) covers the toast (z-60), so the next step
  // is said inside the window itself: in the hint and on the button.
  assert.match(c.node('aiOrientationHint').textContent, /החיתוך נשמר\. עכשיו לחץ על "פתח מצלמה לחלק הבא"/);
  assert.match(c.node('aiOrientationMorePart').innerHTML, /פתח מצלמה לחלק הבא/);
  tap('aiOrientationMorePart');
  assert.deepEqual(camera.at(-1), { id: 'creditCam_' + id, gesture: true }, 'the second tap opens the camera within the tap');
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].orientationConfirmed'), true);
  await flush(c);
  assert.equal(s.log.length, 0, 'part 1 alone is never read');
  // The next part's window starts clean.
  await photograph(c, id, ['bottom.jpg']);
  assert.equal(c.run('aiOrientationSession.page.name'), 'bottom.jpg');
  assert.doesNotMatch(c.node('aiOrientationHint').textContent, /החיתוך נשמר/);
  assert.match(c.node('aiOrientationMorePart').innerHTML, /הפתק ארוך\? צלם עוד חלק/);
});

test('after the crop is saved by "צלם עוד חלק", rotating the photo drops the camera instruction', async () => {
  const { c, data, opened } = setup();
  service(c, { answer: () => reply(creditPaper(data, { pageCount: 2 })) });
  c.run(`aiApplyCropIfMoved = async page => { page.cropped = true; page.dataUrl = 'data:image/jpeg;base64,Q1JPUA=='; return true; }`);
  const id = await addCredit(c, opened);
  await photograph(c, id, ['top.jpg']);
  c.run('aiOrientationSession.cropMode = true; aiCropState = { moved: true }; aiUpdateOrientationControls();');
  pressMorePart(c); await flush(c);
  assert.match(c.node('aiOrientationMorePart').innerHTML, /פתח מצלמה לחלק הבא/);
  c.events.get('aiOrientationRight:click')({ type: 'click' }); await flush(c);
  assert.doesNotMatch(c.node('aiOrientationHint').textContent, /החיתוך נשמר/);
  assert.match(c.node('aiOrientationMorePart').innerHTML, /הפתק ארוך\? צלם עוד חלק/);
});

// v364: a confirmed credit photo opened from the card (its read failed) and put in
// crop mode. Confirming it without moving the frame only closes the window, so the
// button must not promise a read until the frame really moved.
test('crop mode on an already confirmed credit photo promises a read only once the frame moved', async () => {
  const pointer = (x, y) => `({ clientX: ${x}, clientY: ${y}, pointerId: 1, preventDefault() {} })`;
  const openCrop = async () => {
    const { c, data, opened } = setup();
    const s = service(c, { answer: () => reply({ ok: false, error: 'openai_error' }, 500) });
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']);
    pressConfirm(c); await flush(c);
    assert.equal(creditStatus(c), 'error');
    await c.click('delivery-credit-page', id, { page: '0' });
    Object.assign(c.node('aiOrientationImage'), { naturalWidth: 1000, naturalHeight: 1500 });
    Object.assign(c.node('aiCropCanvas'), { clientWidth: 400, clientHeight: 600 });
    c.events.get('aiOrientationCrop:click')({ type: 'click' });
    assert.equal(c.run('aiOrientationSession.cropMode && aiCropState.moved === false'), true);
    return { c, s, data };
  };
  {
    const { c, s } = await openCrop();
    assert.doesNotMatch(confirmButton(c), /זיכוי/);
    assert.match(confirmButton(c), /אשר חיתוך והמשך/);
    assert.equal(morePartShown(c), false);
    pressConfirm(c); await flush(c);
    assert.equal(c.run('aiOrientationSession'), null, 'the window closes');
    assert.equal(s.uploads().length, 1, 'nothing is read');
    assert.equal(creditStatus(c), 'error');
  }
  {
    const { c, s, data } = await openCrop();
    s.log.length = 0;
    c.context.fetch = async (url, options = {}) => String(url).endsWith('/health') ? reply(health(145))
      : (s.log.push({ kind: 'full', body: JSON.parse(options.body) }), reply(creditPaper(data)));
    c.run('aiCropPointerDown(' + pointer(2, 2) + ')');
    assert.doesNotMatch(confirmButton(c), /זיכוי/, 'touching the frame is not moving it');
    c.run('aiCropPointerMove(' + pointer(40, 60) + ')');
    assert.equal(c.run('aiCropState.moved'), true);
    assert.match(confirmButton(c), /אשר חיתוך וקרא את הזיכוי/, 'the first move switches the button');
    assert.equal(morePartShown(c), true);
    c.run(`aiApplyCropIfMoved = async page => { page.cropped = true; page.dataUrl = 'data:image/jpeg;base64,Q1JPUA=='; return true; }`);
    pressConfirm(c); await flush(c);
    assert.equal(s.log.filter(e => e.body.documentKind === 'credit').length, 1, 'the cropped photo is read once');
    assert.equal(creditStatus(c), 'review');
  }
  {
    const { c, s } = await openCrop();
    c.run('aiCropPointerDown(' + pointer(2, 2) + '); aiCropPointerMove(' + pointer(40, 60) + ')');
    assert.match(confirmButton(c), /וקרא את הזיכוי/);
    c.run(`aiApplyCropIfMoved = async () => { throw new Error('canvas_failed'); }`);
    await pressConfirm(c); await flush(c);
    assert.doesNotMatch(confirmButton(c), /זיכוי/, 'a failed crop leaves the frame unmoved, and the button says so');
    assert.equal(s.uploads().length, 1);
  }
});

// v364 review round 3: the resume key of a credit survives a reload. The photos
// live only in memory, so after a reload "נסה שוב" is impossible; the key (in the
// local draft only) lets the worker collect the read that was already paid for.
const DRAFT = 'yt_receipt_draft';
const localDraft = r => JSON.parse(r.storage.get(DRAFT));
// A v148-style job store shared by the phone before and after the reload.
function jobStore(data, { version = 148 } = {}) {
  const jobs = new Map(), log = []; let paid = 0;
  const attach = (r, { full = () => new Promise(() => {}), resume = key => reply(jobs.get(key) || { ok: false, error: 'resume_unknown' }) } = {}) => {
    r.context.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(version)); }
      const body = JSON.parse(options.body);
      log.push({ kind: body.resume ? 'resume' : 'full', body });
      if (log.filter(e => e.body).length > 8) return new Promise(() => {});
      if (body.resume) return resume(body.scanKey);
      paid++; jobs.set(body.scanKey, { ...creditPaper(data), serviceVersion: 148, scanKey: body.scanKey });
      return full(body.scanKey);
    };
  };
  return { jobs, log, attach, paid: () => paid, kinds: () => log.map(e => e.kind) };
}

test('reload during a credit read: "אסוף את הקריאה" collects it without photos and continues to the review — one paid read', async () => {
  for (const how of ['interrupted', 'network']) {
    const { c, data, opened } = setup();
    const store = jobStore(data);
    // interrupted: the app is reloaded while the upload is open; network: every reply is lost.
    store.attach(c, how === 'interrupted' ? {} : { full: () => { throw new TypeError('Load failed'); }, resume: () => { throw new TypeError('Load failed'); } });
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']); pressConfirm(c); await flush(c, 60);
    assert.equal(creditStatus(c), how === 'interrupted' ? 'reading' : 'error', how);
    const key = store.log.find(e => e.kind === 'full').body.scanKey;
    const saved = localDraft(c).deliveryCredits[0].resume;
    assert.equal(saved.scanKey, key, how + ': the key is in the local draft from the moment the upload starts');
    assert.ok(Date.now() - saved.at < 60000, how);
    assert.doesNotMatch(c.run('JSON.stringify(receiptDraftPayload(true))'), new RegExp(key), how + ': the key never goes to the cloud draft');
    // Reload: new page, no photos, the draft from this device.
    const r = runtime('yotvata', { data, storage: c.storage });
    const before = store.log.length;
    store.attach(r);
    await flush(r); r.run('renderReceiving(); saveReceiptDraft()'); await flush(r);
    assert.equal(store.log.length, before, how + ': nothing is sent on its own after the reload');
    assert.equal(r.run('receiptDeliveryCredits[0].status'), how === 'interrupted' ? 'interrupted' : 'error', how);
    const html = card(r);
    assert.match(html, /data-role="delivery-credit-collect"[^>]*class="[^"]*bg-emerald-600[^"]*">אסוף את הקריאה</, how);
    assert.match(html, /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</, how);
    assert.equal((html.match(/bg-emerald-600 text-white rounded-xl/g) || []).length, 1, how + ': one main action');
    assert.doesNotMatch(html, /data-role="delivery-credit-read"/, how + ': no "נסה שוב" without photos');
    assert.match(html, /בלי תשלום נוסף/, how);
    await r.click('delivery-credit-collect', id); await flush(r, 60);
    assert.deepEqual(store.kinds().slice(before), ['health', 'resume'], how + ': the same warm-up, then only the collection');
    assert.deepEqual(store.log.at(-1).body, { reviewProtocolVersion: 1, scanKey: key, resume: true }, how + ': no photos in the collection');
    assert.equal(store.paid(), 1, how + ': paid once');
    assert.equal(r.run('receiptDeliveryCredits[0].status'), 'review', how + ': ' + r.run('receiptDeliveryCredits[0].error'));
    assert.match(card(r), /האם זה זיכוי על חוסר במשלוח הנוכחי/, how);
    assert.equal(r.run('receiptDeliveryCredits[0].resume'), null, how + ': a shown result drops the key');
    assert.equal('resume' in localDraft(r).deliveryCredits[0], false, how);
    assert.equal(r.run(`deliveryCreditConfirm(${JSON.stringify(id)})`), true, how + ': the paper check needs no photo');
  }
});

test('after a reload, an expired key offers only "צלם את הזיכוי מחדש"; a collection that finds no job keeps the key and "אסוף את הקריאה" — never a full body', async () => {
  const LOST = /פענוח הזיכוי לא הושלם והצילום לא נשמר/;
  const readThenReload = async ({ age = 0 } = {}) => {
    const { c, data, opened } = setup();
    const store = jobStore(data); store.attach(c);
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']); pressConfirm(c); await flush(c);
    if (age) {
      const draft = localDraft(c); draft.deliveryCredits[0].resume.at -= age;
      c.storage.set(DRAFT, JSON.stringify(draft));
    }
    const r = runtime('yotvata', { data, storage: c.storage });
    store.attach(r); await flush(r);
    return { r, store, id };
  };
  {
    const { r, store, id } = await readThenReload({ age: 25 * 60 * 1000 + 1000 });
    const html = card(r);
    assert.doesNotMatch(html, /delivery-credit-collect|אסוף את הקריאה/, 'expired: no collection');
    assert.match(html, /data-role="delivery-credit-retake"[^>]*bg-emerald-600[^>]*>צלם את הזיכוי מחדש</);
    assert.match(html, LOST);
    const sent = store.log.length;
    assert.equal(await r.run(`deliveryCreditRead(${JSON.stringify(id)}, true)`), false);
    assert.equal(store.log.length, sent);
  }
  {
    // v364: two instances. The paid read waits on instance A (store.jobs); every collection of
    // the first tap lands on instance B, which answers resume_unknown. That says only that B
    // does not know the key — and the key is the only link to the paid read (no photos). The
    // free automatic collections are tried, then the key is kept and "אסוף את הקריאה" stays.
    const { r, store, id } = await readThenReload();
    const key = store.log.find(e => e.kind === 'full').body.scanKey;
    let on = 'B';
    store.attach(r, { resume: k => reply(on === 'A' && store.jobs.get(k) || { ok: false, error: 'resume_unknown' }) });
    const sent = store.log.length;
    const first = r.click('delivery-credit-collect', id); await flush(r, 60); await first;
    assert.deepEqual(store.kinds().slice(sent), ['health', 'resume', 'resume', 'resume'], 'free collections only, no full body');
    assert.equal(store.paid(), 1);
    assert.equal(r.run('receiptDeliveryCredits[0].status'), 'error');
    assert.equal(r.run('receiptDeliveryCredits[0].errorKind'), 'network');
    assert.equal(r.run('receiptDeliveryCredits[0].resume.scanKey'), key, 'the key is kept');
    assert.equal(localDraft(r).deliveryCredits[0].resume.scanKey, key, 'also in the local draft');
    assert.match(r.run('receiptDeliveryCredits[0].errorDetail'), /resume_unknown/);
    const html = card(r);
    assert.match(html, /data-role="delivery-credit-collect"[^>]*class="[^"]*bg-emerald-600[^"]*">אסוף את הקריאה</);
    assert.match(html, /data-role="delivery-credit-retake"[^>]*>צלם את הזיכוי מחדש</);
    assert.equal((html.match(/bg-emerald-600 text-white rounded-xl/g) || []).length, 1, 'one main action');
    assert.doesNotMatch(html, /data-role="delivery-credit-read"/);
    r.run('renderReceiving(); saveReceiptDraft()'); await flush(r);
    assert.equal(store.log.length, sent + 4, 'nothing more is sent on its own');
    // The next tap reaches instance A: the paid read is collected — one paid read in total.
    on = 'A';
    const second = r.click('delivery-credit-collect', id); await flush(r, 60); await second;
    assert.deepEqual(store.kinds().slice(sent + 4), ['health', 'resume']);
    assert.equal(store.paid(), 1, 'paid once');
    assert.equal(store.log.filter(e => e.kind === 'full').length, 1, 'no full body after the reload');
    assert.equal(r.run('receiptDeliveryCredits[0].status'), 'review', r.run('receiptDeliveryCredits[0].error'));
    assert.equal(r.run('receiptDeliveryCredits[0].resume'), null, 'a shown result drops the key');
  }
  {
    // The job is really gone (the instance restarted): "אסוף את הקריאה" stays only until the key
    // expires; then only the retake is left.
    const { r, store, id } = await readThenReload();
    store.jobs.clear();
    const sent = store.log.length;
    const tap = r.click('delivery-credit-collect', id); await flush(r, 60); await tap;
    assert.deepEqual(store.kinds().slice(sent), ['health', 'resume', 'resume', 'resume']);
    assert.match(card(r), /data-role="delivery-credit-collect"[^>]*bg-emerald-600/);
    r.run('receiptDeliveryCredits[0].resume.at -= 25 * 60 * 1000');
    const html = card(r);
    assert.doesNotMatch(html, /delivery-credit-collect|אסוף את הקריאה|data-role="delivery-credit-read"/);
    assert.match(html, /data-role="delivery-credit-retake"[^>]*bg-emerald-600[^>]*>צלם את הזיכוי מחדש</);
    assert.match(html, LOST);
    assert.equal(await r.run(`deliveryCreditRead(${JSON.stringify(id)}, true)`), false);
    assert.equal(store.log.length, sent + 4, 'an expired key sends nothing');
    assert.equal(store.paid(), 1);
  }
  {
    // A cloud restore carries no key: another device (another sign-in) cannot collect it.
    const { c, data, opened } = setup();
    const store = jobStore(data); store.attach(c);
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']); pressConfirm(c); await flush(c);
    const remote = runtime('yotvata', { data });
    remote.context.remoteDraft = json(c, 'receiptDraftPayload(true)');
    remote.run('restoreReceiptDraft(remoteDraft)');
    assert.doesNotMatch(card(remote), /אסוף את הקריאה/);
    assert.match(card(remote), /data-role="delivery-credit-retake"[^>]*bg-emerald-600/);
  }
  {
    // A v147 service cannot collect: no key is stored for after a reload.
    const { c, data, opened } = setup();
    const store = jobStore(data, { version: 147 }); store.attach(c);
    const id = await addCredit(c, opened);
    await photograph(c, id, ['slip.jpg']); pressConfirm(c); await flush(c);
    assert.equal(store.paid(), 1);
    assert.equal('resume' in localDraft(c).deliveryCredits[0], false);
    const r = runtime('yotvata', { data, storage: c.storage }); await flush(r);
    store.attach(r);
    assert.doesNotMatch(card(r), /אסוף את הקריאה/);
    assert.equal(await r.run(`deliveryCreditRead(${JSON.stringify(id)}, true)`), false);
    assert.equal(store.log.filter(e => e.body).length, 1, 'nothing more is sent');
  }
});

// v364 review round 3: in manual-quantities mode every invoice progress update
// used to rebuild the whole receiving screen — also the invoice document that
// waited behind a credit and now starts. A credit number or barcode being typed
// at that moment was wiped and the keyboard closed.
test('manual quantities: an invoice read that waited behind a credit never rebuilds the screen while a credit field is being typed in', async () => {
  for (const role of ['delivery-credit-number', 'delivery-credit-barcode']) {
    const { c, data, opened } = setup({ paperFirst: true });
    let releaseB = null;
    const s = service(c, { version: 148, answer: req => {
      if (!req.credit) return reply(data.paper);
      if (req.body.documents[0].pages[0].includes(btoa('b.jpg'))) return new Promise(resolve => { releaseB = () => resolve(reply(creditPaper(data))); });
      return reply(creditPaper(data));
    } });
    const a = await addCredit(c, opened);
    await photograph(c, a, ['a.jpg']); pressConfirm(c); await flush(c);
    assert.equal(creditStatus(c), 'review', role);
    const b = await addCredit(c, opened);
    await photograph(c, b, ['b.jpg']); pressConfirm(c); await flush(c);
    assert.equal(typeof releaseB, 'function', role);
    const invoice = c.run('yotvataStartPaperScan({ manualQuantities: true })');
    await flush(c);
    assert.equal(c.run('receiptUsesManualQuantities()'), true, role);
    assert.match(c.run('aiScanProgressText'), /ממתין לסיום קריאת הזיכוי/, role + ': the invoice waits behind credit B');
    // The worker types in credit A's card (not committed yet: the app saves on `change`).
    const cardA = {};
    const input = { dataset: { role, id: a, row: '0' }, value: '55', closest: sel => sel === '[data-delivery-credit]' ? cardA : null };
    const host = c.node('rcDeliveryCredits');
    host.contains = el => el === input;
    c.context.document.activeElement = input;
    let renders = 0;
    c.run('realRenderReceiving = renderReceiving');
    c.context.countRender = () => { renders++; };
    c.run('renderReceiving = () => { countRender(); realRenderReceiving(); }');
    const status = c.node('rcPaperStatus'), qty = c.node('rcQuantityOptions');
    status.innerHTML = 'stale'; qty.innerHTML = 'stale';
    releaseB(); await invoice; await flush(c);
    assert.deepEqual(s.kinds().filter(k => k !== 'health'), ['full:credit', 'full:credit', 'full'], role);
    assert.equal(c.run('receiptPaperScanState'), 'ok', role);
    assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => x.status)'), ['review', 'review'], role);
    assert.equal(renders, 0, role + ': the screen holding the typed field is not rebuilt');
    assert.equal(status.innerHTML, '', role + ': the status area alone follows the read (done: no banner)');
    assert.match(qty.innerHTML, /data-role="rc-quantity-all"/, role + ': the quantity buttons appear without a full render');
    assert.equal(c.run('receiptDeliveryCredits[0].number'), 'TEST-CREDIT', role + ': nothing committed behind the worker\'s back');
    // The field loses focus: the next refresh rebuilds the screen as before.
    c.context.document.activeElement = null;
    c.run('refreshScanHost()');
    assert.equal(renders, 1, role);
    assert.match(c.node('app').innerHTML, /data-manual-receiving/, role);
  }
});
