// v366: the driver's credit can be photographed on the photo gate ("שלב 1 · צילום
// תעודה"), together with the invoices — not only after "התחל קליטת מוצרים".
// Field report (owner, iPhone, app v365): the gate showed "אין תעודה בכלל" but no
// credit button, because a no-document receipt (receiptNoDoc) hid the credit section
// on every screen, the gate included. These tests run the complete app module
// (receipt-scan-harness); only fetch, timers, image preparation and the Firebase
// boundary are faked. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, reply } from './receipt-scan-harness.mjs';
import { creditInvoiceData, verifiedCredit } from './credit-verified-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
// Runs parked timers too (the harness parks every setTimeout callback).
async function flush(c, rounds = 30) {
  for (let i = 0; i < rounds; i++) { for (const cb of c.callbacks.splice(0)) cb(); await tick(); }
}
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const app = c => c.node('app').innerHTML;
const creditStatus = c => c.run('receiptDeliveryCredits[0].status');
const CREDIT_BUTTON = /<button data-role="delivery-credit-add"[^>]*>[^<]*<i[^>]*><\/i> הנהג הביא זיכוי על חוסר\? צלם כאן<\/button>/;
const GATE = /שלב 1 · צילום תעודה/;
const GATE_HINT = /תעודת זיכוי מהנהג מצלמים בכפתור הירוק — היא נקראת לבד\./;
const DROP_TOAST = 'זיכוי מהנהג מצורף רק לקליטה עם תעודה.';
const AUTO_TOAST = 'הזיכוי צורף למשלוח. בסיום הספירה נבדוק איזה חוסר הוא מכסה.';
const CONFIRMED_CARD = /<details data-delivery-credit="[^"]+"[^>]*><summary[^>]*>זיכוי שאושר · ₪48\.80 לפני מע״מ · פרטים/;
const startEnabled = html => /<button data-role="rc-photo-start"  class="[^"]*bg-blue-600 text-white"/.test(html)
  && !/<button data-role="rc-photo-start" disabled/.test(html);
const health = version => ({ ok: true, keyConfigured: true, photoFirst: true, serviceVersion: version, scanResume: true, creditDocuments: true });

// A scripted scan service (as delivery-credit-auto-read.test.mjs). answer(request, fetchOptions)
// returns a Response double or a promise of one.
function service(c, { version = 149, answer }) {
  const log = [], stats = { active: 0, maxActive: 0 };
  c.context.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(version)); }
    assert.ok(u.endsWith('/scan'), 'unexpected request ' + u);
    const body = JSON.parse(options.body);
    const request = { kind: body.resume ? 'resume' : 'full', body, credit: body.documentKind === 'credit', signal: options.signal || null };
    log.push(request);
    if (log.filter(e => e.kind !== 'health').length > 8) return new Promise(() => {}); // runaway guard
    stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
    try { return await answer(request, options); } finally { stats.active--; }
  };
  return { log, stats, kinds: () => log.map(e => e.kind + (e.credit ? ':credit' : '')), uploads: () => log.filter(e => e.kind === 'full') };
}

// A fresh receipt on the photo gate, a camera that records which hidden input was opened,
// and image preparation replaced by a fake that names the photo in its data URL.
function setup() {
  const data = creditInvoiceData();
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true; showConfirm = (t, x, l, fn) => fn();
    invoicePage = () => ({ noteIndex: 0, amount: null, units: null, pages: [{ dataUrl: 'data:image/jpeg;base64,SU5WT0lDRQ==', orientationConfirmed: true }] });
    aiCompressInvoiceImage = async (file) => { const url = 'data:image/jpeg;base64,' + btoa(file.name);
      return { name: file.name, dataUrl: url, baseDataUrl: url, rotation: 0, orientationConfirmed: false }; };
    aiRenderInvoiceRotation = async () => ({ dataUrl: 'data:image/jpeg;base64,AQ==', bytes: 1 });`);
  const opened = [];
  c.context.document.getElementById = id => { const n = c.node(id); n.click = () => opened.push(id); return n; };
  return { c, data, opened };
}
// The green button: creates the card and opens its camera.
async function addCredit(c, opened) {
  await c.click('delivery-credit-add');
  const id = c.run('receiptDeliveryCredits.at(-1).id');
  assert.equal(opened.at(-1), 'creditCam_' + id, 'the camera opens straight away');
  return id;
}
// The camera input's change event, exactly as the app listens for it.
async function photograph(c, id, names) {
  c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-file', id }, files: names.map(name => ({ name })), value: 'x' } });
  await flush(c, 5);
}
const confirmButton = c => c.node('aiOrientationConfirm').innerHTML;
const pressConfirm = c => c.events.get('aiOrientationConfirm:click')({ type: 'click', target: c.node('aiOrientationConfirm') });
// Photographs one slip on the gate and confirms it — the automatic read starts from the confirmation.
async function gateCredit(c, opened, name = 'slip.jpg') {
  c.run('renderReceiving()');
  assert.match(app(c), GATE);
  const id = await addCredit(c, opened);
  assert.match(app(c), GATE, 'adding a credit keeps the gate');
  await photograph(c, id, [name]);
  assert.equal(c.run('aiOrientationSession && aiOrientationSession.page === receiptDeliveryCredits.at(-1).pages[0]'), true, 'the new photo opens for checking');
  assert.match(confirmButton(c), /אשר וקרא את הזיכוי/);
  pressConfirm(c);
  return id;
}
function finish(c) {
  c.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt({skipChecked:true})');
  return json(c, 'pendingReceipt');
}

test('a: a fresh receipt after a finished no-document receipt starts with a whole photo gate — credit button included', async () => {
  const { c } = setup();
  c.run('renderReceiving()');
  assert.match(app(c), CREDIT_BUTTON);
  await c.click('rc-open-nodoc');
  assert.equal(c.run('receiptNoDoc'), true);
  assert.doesNotMatch(app(c), /delivery-credit-add/, 'a no-document receiving screen has no credit');
  c.run(`receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 9 }]; receiptDupConfirmed = true; saveReceiptDraft(); finishReceipt()`);
  const p = json(c, 'pendingReceipt');
  assert.ok(p); assert.equal(p.noDoc, true); assert.equal(p.status, 'open');
  c.run('flushReceiptDraftToCloud = async () => { receiptSync.dirty = false; return true; }');
  await c.run('confirmReceipt()');
  const saved = c.writes.find(w => w.path?.includes('receipts'))?.data;
  assert.ok(saved); assert.equal(saved.noDoc, true); assert.equal(saved.status, 'open'); assert.equal(saved.totalExVat, 45);
  assert.equal(c.run('receiptNoDoc'), false, 'the flag belongs to the finished receipt');
  assert.equal(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY))').noDoc, false, 'and is not persisted into the next draft');
  c.run("currentView = 'receiving'; renderReceiving()");
  assert.match(app(c), GATE);
  assert.match(app(c), CREDIT_BUTTON);
  assert.match(app(c), GATE_HINT);
  assert.match(app(c), /rc-open-nodoc/, '"אין תעודה בכלל" is still offered');
  // v366: the reset of the photo receipt itself clears the flag, whoever calls it.
  assert.equal(c.run('receiptNoDoc = true; yotvataResetPhotoReceipt(); receiptNoDoc'), false);
  assert.equal(c.run('receiptAttachTarget'), null);
});

test('b: a no-document receipt back on the gate shows the credit button; its receiving screen and attach mode hide it', async () => {
  const { c, data } = setup();
  await c.click('rc-open-nodoc');
  c.run(`receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 3 }]; saveReceiptDraft(); renderReceiving()`);
  assert.equal(c.run('receiptNoDoc'), true);
  assert.match(app(c), /קליטה בלי תעודה/);
  assert.doesNotMatch(app(c), /delivery-credit-add|rcDeliveryCredits/, 'no paper → no shortage claim → no credit on the receiving screen');
  assert.equal(c.run('deliveryCreditsHtml()'), '');
  assert.equal(c.run('deliveryCreditsAllowed()'), false);
  assert.equal(c.run('deliveryCreditsAllowed(true)'), true);
  await c.click('delivery-credit-add');
  assert.equal(c.run('receiptDeliveryCredits.length'), 0, 'the action is refused where the button is hidden');
  // "הנייר הגיע" opens the anchors; from there "חזרה לצילום התעודה / גלריה" leads back to the gate.
  await c.click('rc-nodoc-found');
  assert.match(app(c), /data-role="rc-photo-capture"/);
  await c.click('rc-photo-capture');
  assert.equal(c.run('receiptNoDoc'), true, 'the flag itself changes only with "התחל" or "אין תעודה בכלל"');
  assert.match(app(c), GATE);
  assert.match(app(c), CREDIT_BUTTON, 'v365 hid the section here');
  assert.match(app(c), GATE_HINT);
  assert.match(app(c), /rc-open-nodoc/);
  assert.equal(c.run('deliveryCreditsAllowed()'), true, 'the default follows the screen that is shown');
  // The persisted draft carries the flag: a reload lands on the same gate, with the button.
  const reloaded = runtime('yotvata', { data, storage: c.storage });
  reloaded.run('renderReceiving()');
  assert.equal(reloaded.run('receiptNoDoc'), true);
  assert.match(reloaded.node('app').innerHTML, GATE);
  assert.match(reloaded.node('app').innerHTML, CREDIT_BUTTON);
  // "התחל קליטת מוצרים" turns it into a receipt with paper, as before.
  c.run('aiScanDocuments = [invoicePage()]');
  const s = service(c, { answer: req => reply(req.credit ? verifiedCredit(data) : data.paper) });
  await c.click('rc-photo-start'); await flush(c);
  assert.equal(c.run('receiptNoDoc'), false);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.deepEqual(s.kinds(), ['health', 'full']);
  assert.match(app(c), CREDIT_BUTTON, 'the receiving screen of a paper receipt offers the credit');
  // Once the paper arrived and its anchors were typed, the receipt has paper again: the credit returns
  // (the same rule as the finish's savingNoDoc and the "קליטה בלי תעודה" bar).
  const n = setup().c;
  await n.click('rc-open-nodoc');
  await n.click('rc-nodoc-found');
  assert.equal(n.run('receiptNoDoc && receiptWithoutPaper()'), true);
  assert.doesNotMatch(n.node('app').innerHTML, /delivery-credit-add/, 'nothing typed yet');
  n.node('rcNoteInput').value = '93.8'; n.node('rcNoteUnits').value = '16';
  await n.click('rc-note-add');
  assert.equal(n.run('receiptNoteTotal'), 93.8);
  assert.equal(n.run('receiptNoDoc'), true, 'the flag stays; the typed anchors are what make it a paper receipt');
  assert.equal(n.run('receiptWithoutPaper()'), false);
  assert.equal(n.run('deliveryCreditsAllowed()'), true);
  assert.match(n.node('app').innerHTML, CREDIT_BUTTON, 'the receiving screen offers the credit again');
  // Attach mode (paper for a saved no-document receipt): no credit on the gate nor on the receiving screen.
  const a = setup().c;
  a.run(`receiptAttachTarget = { id: 'old', timestamp: 1, date: '2026-09-20', label: 'x' }; receiptList = [{ productId: 'milk', name: 'חלב בדיקה', qty: 3 }];
    receiptOpened = false; receiptEntryMode = 'photo'; renderReceiving()`);
  assert.match(a.node('app').innerHTML, GATE);
  assert.doesNotMatch(a.node('app').innerHTML, /delivery-credit-add|rcDeliveryCredits/);
  assert.doesNotMatch(a.node('app').innerHTML, GATE_HINT, 'no hint about a button that is not on the screen');
  assert.equal(a.run('deliveryCreditsHtml({ gate: true })'), '');
  a.run(`receiptOpened = true; receiptEntryMode = 'manual'; receiptNotes = [{ amount: 15, units: 3 }]; recomputeNoteTotal(); renderReceiving()`);
  assert.doesNotMatch(a.node('app').innerHTML, /delivery-credit-add|rcDeliveryCredits|שלב 1 · צילום/);
  assert.equal(a.run('deliveryCreditsHtml()'), '');
});

test('c: a credit photographed on the gate is read at once and attached; "התחל" reads the invoices after it, and the receiving screen shows the attached card', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? verifiedCredit(data) : data.paper) });
  c.run('aiScanDocuments = [invoicePage()]');
  const id = await gateCredit(c, opened);
  assert.equal(creditStatus(c), 'reading', 'the read starts from the confirmation itself — the queue is empty');
  await flush(c);
  assert.equal(creditStatus(c), 'confirmed', c.run('receiptDeliveryCredits[0].error'));
  assert.equal(c.run('receiptDeliveryCredits[0].autoConfirmed'), true);
  assert.deepEqual(s.kinds(), ['health', 'full:credit'], 'one warm-up and exactly one paid read — the credit');
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
  assert.match(app(c), GATE, 'still on the gate after the read');
  assert.match(c.node('rcDeliveryCredits').outerHTML, CONFIRMED_CARD, 'the gate card shows the attached credit');
  assert.equal(startEnabled(app(c)), true);
  assert.equal(c.run('receiptOpened'), false, 'nothing started the receipt');
  c.run('gateCreditObject = receiptDeliveryCredits[0]');
  await c.click('rc-photo-start'); await flush(c);
  assert.equal(c.run('receiptDeliveryCredits.length === 1 && receiptDeliveryCredits[0] === gateCreditObject'), true, 'the same credit object survives "התחל"');
  assert.equal(creditStatus(c), 'confirmed');
  assert.equal(c.run('receiptDeliveryCredits[0].confirmedSignature === deliveryCreditSignature(receiptDeliveryCredits[0])'), true);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'full'], 'the invoice request goes out after the credit\'s');
  assert.equal(s.stats.maxActive, 1, 'never two paid uploads at once');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoDoc'), false);
  assert.equal(c.run('receiptOpened && receiptEntryMode === "photo" && !receiptPhotoCaptureOpen'), true);
  assert.match(app(c), /שלב 2 · סריקת מוצרים/);
  assert.match(app(c), CONFIRMED_CARD, 'the receiving screen shows the confirmed card, not a fresh capture card');
  assert.doesNotMatch(app(c), /data-role="delivery-credit-(confirm|read|camera|barcode)"/, 'nothing to confirm, read or type');
  assert.equal(c.run('deliveryCreditReady()'), true);
  // 9 milk counted: 1 milk (₪5.00) and 6 coffee (₪43.80) are missing — the gate credit covers them.
  c.run(`receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 9 }]; receiptDupConfirmed = true; priceAuditSetDate(0, '2026-09-15'); saveReceiptDraft(); renderReceiving()`);
  assert.match(c.run('receivingProgressHtml(receiptTotals())'), /החוסר מכוסה בזיכוי/);
  const p = finish(c);
  assert.ok(p); assert.equal(p.status, 'ok'); assert.equal(p.ex, 45);
  assert.equal(p.lines.find(x => x.productId === 'coffee').qty, 0);
  assert.equal(p.shortCreditNotes.length, 1);
  assert.equal(p.shortCreditNotes[0].number, '22229080');
  assert.equal(p.shortCreditNotes[0].amount, 48.8);
  assert.equal(p.shortCreditNotes[0].autoConfirmed, true);
  assert.equal(p.shortCreditNotes[0].paper.subtotalExVat, -48.8);
  c.context.pendingFixture = p;
  const di = json(c, 'receiptDiscrepancyInfo({ ...pendingFixture, items: pendingFixture.lines })');
  assert.equal(di.shortValRaw, 48.8); assert.equal(di.shortVal, 0); assert.equal(di.shortFullyCredited, true);
  assert.equal(s.uploads().length, 2, 'no further paid read: one credit, one invoice');
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
});

test('d: "התחל" is enabled while the gate credit is still read; the invoice waits behind it and the credit survives', async () => {
  const { c, data, opened } = setup();
  let releaseCredit = null;
  const s = service(c, { answer: req => req.credit ? new Promise(resolve => { releaseCredit = () => resolve(reply(verifiedCredit(data))); }) : reply(data.paper) });
  c.run('aiScanDocuments = [invoicePage()]');
  await gateCredit(c, opened); await flush(c, 5);
  assert.equal(creditStatus(c), 'reading');
  assert.equal(typeof releaseCredit, 'function', 'the credit upload is in flight');
  assert.equal(c.run('yotvataPhotoReady()'), true, 'readiness never looks at credits');
  assert.equal(c.run('aiScanBusy'), false);
  assert.equal(startEnabled(app(c)), true, 'the start button does not wait for the credit');
  assert.match(app(c), /קורא את הזיכוי… אפשר להמשיך לצלם את התעודות וללחוץ "התחל קליטת מוצרים"\./, 'the gate shows the reading card, worded for the gate');
  assert.doesNotMatch(app(c), /אפשר להמשיך לסרוק מוצרים/, 'the gate has no product scanner, so it never says so');
  c.run('gateCreditObject = receiptDeliveryCredits[0]');
  await c.click('rc-photo-start'); await flush(c, 5);
  assert.equal(c.run('receiptOpened && receiptEntryMode === "photo" && !receiptPhotoCaptureOpen'), true, 'the receipt opened');
  assert.equal(c.run('aiScanBusy'), true);
  assert.equal(c.run('receiptPaperScanState'), 'running');
  assert.match(c.run('aiScanProgressText'), /ממתין לסיום קריאת הזיכוי…/, 'the invoice banner says it waits for the credit');
  assert.match(c.node('rcPaperStatus').innerHTML, /ממתין לסיום קריאת הזיכוי…/);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health'], 'the invoice warm-up ran, but no invoice upload while the credit is read');
  assert.equal(c.run('receiptDeliveryCredits[0] === gateCreditObject'), true);
  assert.equal(creditStatus(c), 'reading');
  assert.equal(c.run('receiptDeliveryCredits[0].waiting'), false, 'the credit is the read in progress, not a waiting one');
  assert.match(app(c), /קורא את הזיכוי… אפשר להמשיך לסרוק מוצרים\./, 'the receiving screen shows the same reading card');
  releaseCredit(); await flush(c);
  assert.equal(creditStatus(c), 'confirmed', c.run('receiptDeliveryCredits[0].error'));
  assert.equal(c.run('receiptDeliveryCredits[0] === gateCreditObject'), true);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'full']);
  assert.equal(s.stats.maxActive, 1);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('aiScanBusy'), false);
  assert.match(c.node('rcDeliveryCredits').outerHTML, CONFIRMED_CARD);
  assert.match(c.run('deliveryCreditsHtml()'), CONFIRMED_CARD);
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 1);
});

test('e: "אין תעודה בכלל" after a gate credit asks first, then drops it, stops its read, closes its photo and says why — no paid read leaks', async () => {
  const CONFIRM = [['אין תעודה בכלל', 'המשך בלי זיכוי']];
  // showConfirm records the question instead of accepting it; pendingNoDoc is the "המשך בלי זיכוי" action.
  const askFirst = c => c.run('confirmCalls = []; pendingNoDoc = null; showConfirm = (t, x, l, fn) => { confirmCalls.push([t, l]); pendingNoDoc = fn; }');
  // 1. The credit is being read (upload in flight).
  const { c, data, opened } = setup();
  let releaseCredit = null;
  const s = service(c, { answer: req => req.credit ? new Promise(resolve => { releaseCredit = () => resolve(reply(verifiedCredit(data))); }) : reply(data.paper) });
  await gateCredit(c, opened); await flush(c, 5);
  assert.equal(creditStatus(c), 'reading');
  assert.deepEqual(s.kinds(), ['health', 'full:credit']);
  askFirst(c);
  await c.click('rc-open-nodoc');
  assert.deepEqual(json(c, 'confirmCalls'), CONFIRM, 'a photographed (paid) credit is not dropped without asking');
  assert.equal(c.run('receiptNoDoc'), false, 'nothing changes before "המשך בלי זיכוי"');
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  assert.equal(creditStatus(c), 'reading');
  assert.equal(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY)).deliveryCredits').length, 1, 'the draft still carries it');
  assert.equal(c.toasts.filter(t => t === DROP_TOAST).length, 0);
  assert.match(app(c), GATE);
  c.run('pendingNoDoc()');
  assert.equal(c.run('receiptNoDoc'), true);
  assert.equal(c.run('receiptOpened'), true);
  assert.deepEqual(json(c, 'receiptDeliveryCredits'), [], 'the credit is dropped');
  assert.equal(s.log[1].signal && s.log[1].signal.aborted, true, 'the in-flight credit upload is aborted');
  assert.equal(c.toasts.filter(t => t === DROP_TOAST).length, 1);
  assert.match(app(c), /קליטה בלי תעודה/);
  assert.doesNotMatch(app(c), /delivery-credit|rcDeliveryCredits/);
  releaseCredit(); await flush(c);
  assert.deepEqual(json(c, 'receiptDeliveryCredits'), []);
  assert.deepEqual(s.kinds(), ['health', 'full:credit'], 'nothing else was sent');
  assert.equal(c.toasts.filter(t => t === AUTO_TOAST).length, 0, 'a dropped credit never attaches');
  assert.deepEqual(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY)).deliveryCredits'), [], 'the draft no longer carries it');
  assert.equal(c.run('deliveryCreditReady()'), true, 'finishing the no-document receipt is not blocked by an invisible credit');
  // 2. The credit photo is still open for checking (no read yet).
  const d = setup();
  const s2 = service(d.c, { answer: req => reply(req.credit ? verifiedCredit(d.data) : d.data.paper) });
  d.c.run('renderReceiving()');
  const id = await addCredit(d.c, d.opened);
  await photograph(d.c, id, ['slip.jpg']);
  assert.equal(d.c.run('aiOrientationSession && aiOrientationSession.page === receiptDeliveryCredits[0].pages[0]'), true);
  assert.equal(d.c.node('aiOrientationModal').classList.contains('hidden'), false);
  askFirst(d.c);
  await d.c.click('rc-open-nodoc');
  assert.deepEqual(json(d.c, 'confirmCalls'), CONFIRM, 'a photo that is still checked is asked about too');
  assert.equal(d.c.run('aiOrientationSession !== null && receiptDeliveryCredits.length === 1 && !receiptNoDoc'), true, 'nothing changes before the answer');
  d.c.run('pendingNoDoc()');
  assert.equal(d.c.run('aiOrientationSession'), null, 'the credit photo window is closed');
  assert.equal(d.c.node('aiOrientationModal').classList.contains('hidden'), true);
  assert.deepEqual(json(d.c, 'receiptDeliveryCredits'), []);
  assert.deepEqual(s2.kinds(), [], 'no paid call at all');
  assert.equal(d.c.toasts.filter(t => t === DROP_TOAST).length, 1);
  await flush(d.c);
  assert.deepEqual(s2.kinds(), []);
  // 3. Without any credit: no question, no toast — the plain path is unchanged.
  const e = setup();
  e.c.run('renderReceiving()');
  askFirst(e.c);
  await e.c.click('rc-open-nodoc');
  assert.deepEqual(json(e.c, 'confirmCalls'), []);
  assert.equal(e.c.run('receiptNoDoc'), true);
  assert.equal(e.c.toasts.filter(t => t === DROP_TOAST).length, 0);
  // 4. An empty credit card (camera cancelled, nothing photographed) is not worth a question either.
  const f = setup();
  f.c.run('renderReceiving()');
  await addCredit(f.c, f.opened);
  assert.equal(f.c.run('receiptDeliveryCredits[0].status === "capture" && receiptDeliveryCredits[0].pages.length === 0'), true);
  askFirst(f.c);
  await f.c.click('rc-open-nodoc');
  assert.deepEqual(json(f.c, 'confirmCalls'), []);
  assert.equal(f.c.run('receiptNoDoc'), true);
  assert.deepEqual(json(f.c, 'receiptDeliveryCredits'), []);
});

test('f: "פענח תעודה — הכמויות נבדקות ידנית" and "הקלדת סכום ויחידות ידנית" keep a credit photographed on the gate', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? verifiedCredit(data) : data.paper) });
  c.run('aiScanDocuments = [invoicePage()]');
  await gateCredit(c, opened); await flush(c);
  assert.equal(creditStatus(c), 'confirmed');
  c.run('gateCreditObject = receiptDeliveryCredits[0]');
  await c.click('rc-photo-quantity'); await flush(c);
  assert.equal(c.run('receiptUsesManualQuantities()'), true);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptDeliveryCredits[0] === gateCreditObject'), true);
  assert.match(app(c), /data-manual-receiving/);
  assert.match(app(c), CONFIRMED_CARD, 'the manual-quantities screen shows the attached credit');
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'full']);
  // The manual anchors path: no invoice read, the credit waits on the receiving screen.
  const m = setup();
  const s2 = service(m.c, { answer: req => reply(req.credit ? verifiedCredit(m.data) : m.data.paper) });
  m.c.run('aiScanDocuments = [invoicePage()]');
  await gateCredit(m.c, m.opened); await flush(m.c);
  assert.equal(creditStatus(m.c), 'confirmed');
  m.c.run('gateCreditObject = receiptDeliveryCredits[0]');
  await m.c.click('rc-photo-manual');
  assert.equal(m.c.run('receiptEntryMode'), 'manual');
  assert.equal(m.c.run('receiptDeliveryCredits[0] === gateCreditObject'), true);
  assert.match(m.c.node('app').innerHTML, /נתוני התעודה/);
  m.c.node('rcNoteInput').value = '93.8'; m.c.node('rcNoteUnits').value = '16';
  await m.c.click('rc-open');
  assert.equal(m.c.run('receiptOpened'), true);
  assert.equal(m.c.run('receiptNoteTotal'), 93.8);
  assert.equal(m.c.run('receiptDeliveryCredits[0] === gateCreditObject'), true);
  assert.match(m.c.node('app').innerHTML, CONFIRMED_CARD, 'the receiving screen shows the attached credit');
  assert.deepEqual(s2.kinds(), ['health', 'full:credit'], 'no invoice read on the manual path');
});

test('g: while gate credits are read, only their cards refresh — the gate\'s document cards, photos and inputs are never rebuilt', async () => {
  const { c, data, opened } = setup();
  let releaseA = null;
  const s = service(c, { answer: req => {
    if (!req.credit) return reply(data.paper);
    if (req.body.documents[0].pages[0].includes(btoa('a.jpg'))) return new Promise(resolve => { releaseA = () => resolve(reply(verifiedCredit(data))); });
    return reply(verifiedCredit(data, { number: '22229081' }));
  } });
  c.run('aiScanDocuments = [invoicePage()]');
  await gateCredit(c, opened, 'a.jpg'); await flush(c, 5);
  assert.equal(creditStatus(c), 'reading');
  assert.equal(typeof releaseA, 'function');
  await gateCredit(c, opened, 'b.jpg'); await flush(c, 5);
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => [x.status, x.waiting, x.waitingFor])'), [['reading', false, null], ['reading', true, 'credit']]);
  // From here nothing may rebuild the gate.
  let renders = 0;
  c.run('realRenderReceiving = renderReceiving');
  c.context.countRender = () => { renders++; };
  c.run('renderReceiving = () => { countRender(); realRenderReceiving(); }');
  const gateBefore = app(c);
  assert.match(gateBefore, GATE);
  assert.match(gateBefore, /id="aiDocCam_0"/); assert.match(gateBefore, /SU5WT0lDRQ==/, 'the invoice photo is on the gate');
  const host = c.node('rcDeliveryCredits');
  assert.match(host.outerHTML, /ממתין לסיום קריאת זיכוי אחר — הזיכוי ייקרא מיד אחריו\. אפשר להמשיך לצלם את התעודות וללחוץ "התחל קליטת מוצרים"\./);
  assert.doesNotMatch(gateBefore, /ממתין לסיום קריאת זיכוי אחר/, 'the waiting text arrived through the card refresh, not through a render of the gate');
  assert.match(gateBefore, /קורא את הזיכוי…/, 'the last full render (the start of B\'s read) showed B reading');
  c.run("receiptDeliveryCredits[1].progress = 'מתחבר מחדש…'; deliveryCreditRefreshCards()");
  assert.match(host.outerHTML, /מתחבר מחדש…/, 'progress text reaches the gate card');
  assert.equal(renders, 0);
  releaseA(); await flush(c);
  assert.deepEqual(json(c, 'receiptDeliveryCredits.map(x => [x.status, x.number])'), [['confirmed', '22229080'], ['confirmed', '22229081']]);
  assert.equal(renders, 0, 'the reads never rebuilt the gate');
  assert.equal(app(c), gateBefore, 'document cards, photos and inputs are exactly as they were');
  assert.match(host.outerHTML, /זיכוי שאושר · ₪48\.80 לפני מע״מ · פרטים/);
  assert.doesNotMatch(host.outerHTML, /ממתין|קורא את הזיכוי|מתחבר מחדש/);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'full:credit'], 'one paid read per credit, one after the other');
  assert.equal(s.stats.maxActive, 1);
  assert.equal(startEnabled(gateBefore), true);
  assert.equal(c.run('receiptOpened'), false);
});

// v366 review: the field-report receipt end to end. A no-document receipt back on its gate
// photographs the credit — from that moment the receipt has paper (the flag is cleared by the
// green button itself), so the card stays visible on the receiving screen and after a reload,
// and the finish asks for the invoice amount instead of opening the reconcile screen against ₪0.
const AMOUNT_TOAST = 'לפני האישור חובה להזין לכל תעודה סכום ללא מע״מ';
const COMPLETE_TOAST = 'לפני הסיום צריך להשלים ולאשר את תעודות הזיכוי שצורפו, או להסיר אותן.';
const NODOC_TOAST = 'לקליטה בלי תעודה אי אפשר לצרף זיכוי — הסר את הזיכוי או הקלד את נתוני התעודה.';
const MILK = qty => `receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: ${qty} }]; receiptDupConfirmed = true; saveReceiptDraft(); renderReceiving()`;
// The floating "סיים תעודה" button, as the worker presses it.
const pressCart = c => { c.run("mainMode = 'receiving'; currentView = 'receiving'"); c.toasts.length = 0; c.events.get('cartBtn:click')({ type: 'click' }); };
// "אין תעודה בכלל" → milk counted → "מצאתי את התעודה" → "חזרה לצילום התעודה / גלריה".
async function noDocBackOnGate(c, qty = 9) {
  c.run('renderReceiving()');
  await c.click('rc-open-nodoc');
  c.run(MILK(qty));
  await c.click('rc-nodoc-found');
  await c.click('rc-photo-capture');
  assert.equal(c.run('receiptNoDoc'), true);
  assert.match(app(c), GATE);
}

test('h: a credit photographed on the gate of a no-document receipt makes it a paper receipt — card visible after "הקלדת סכום ויחידות ידנית" and after a reload, finish asks for the amount', async () => {
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? verifiedCredit(data) : data.paper) });
  await noDocBackOnGate(c);
  await gateCredit(c, opened);
  assert.equal(c.run('receiptNoDoc'), false, 'photographing a credit says the receipt has paper');
  assert.equal(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY))').noDoc, false, 'the draft agrees');
  assert.match(app(c), GATE); assert.match(app(c), /rc-open-nodoc/, '"אין תעודה בכלל" is still offered on the gate');
  await flush(c);
  assert.equal(creditStatus(c), 'confirmed');
  assert.deepEqual(s.kinds(), ['health', 'full:credit']);
  await c.click('rc-photo-manual');
  assert.equal(c.run('receiptEntryMode === "manual" && editingNotes && receiptNotes.length === 0'), true);
  assert.equal(c.run('receiptWithoutPaper()'), false);
  assert.match(app(c), CONFIRMED_CARD, 'the receiving screen shows the attached credit');
  assert.doesNotMatch(app(c), /קליטה בלי תעודה/);
  pressCart(c);
  assert.equal(c.run('currentView'), 'receiving', 'no reconcile screen for a receipt without an invoice amount');
  assert.equal(c.run('pendingReceipt'), null);
  assert.deepEqual(c.toasts, [AMOUNT_TOAST]);
  assert.match(app(c), CONFIRMED_CARD);
  // A reload of that draft is an ordinary paper receipt with the card — never the "קליטה בלי תעודה" bar.
  const r = runtime('yotvata', { data, storage: c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; receiptDupConfirmed = true; renderReceiving()");
  assert.equal(r.run('receiptNoDoc'), false);
  assert.equal(r.run('receiptDeliveryCredits.length'), 1);
  assert.doesNotMatch(r.node('app').innerHTML, /קליטה בלי תעודה|שלב 1 · צילום/);
  assert.match(r.node('app').innerHTML, CONFIRMED_CARD);
  pressCart(r);
  assert.equal(r.run('currentView'), 'receiving');
  assert.deepEqual(r.toasts, [AMOUNT_TOAST]);
  // With the amounts typed the finish is the ordinary one: a comparison against the paper (₪93.80), not against ₪0.
  c.node('rcNoteInput').value = '93.8'; c.node('rcNoteUnits').value = '16';
  await c.click('rc-notes-done');
  assert.equal(c.run('receiptNoteTotal'), 93.8);
  pressCart(c);
  assert.equal(c.run('currentView'), 'reconcile');
  assert.deepEqual(c.toasts, []);
  assert.match(app(c), /93\.80/);
  assert.equal(c.run('receiptDeliveryCredits.length === 1 && receiptNoDoc === false'), true);
  assert.deepEqual(s.kinds(), ['health', 'full:credit'], 'no further paid read');
  // A credit the service left for review: the finish points at a card that is on the screen.
  const v = setup();
  service(v.c, { answer: req => reply(req.credit ? verifiedCredit(v.data, { verification: false }) : v.data.paper) });
  await noDocBackOnGate(v.c);
  await gateCredit(v.c, v.opened); await flush(v.c);
  assert.equal(creditStatus(v.c), 'review');
  await v.c.click('rc-photo-manual');
  assert.equal(v.c.run('receiptNoDoc'), false);
  pressCart(v.c);
  assert.equal(v.c.run('currentView'), 'receiving');
  assert.deepEqual(v.c.toasts, [COMPLETE_TOAST]);
  assert.match(app(v.c), /id="rcDeliveryCredits"/, 'the card the toast points at is on the screen');
  assert.match(app(v.c), /data-role="delivery-credit-(confirm|remove)"/);
  // No gate at all: anchors typed on the no-document receipt, the credit photographed on the receiving
  // screen, then the note removed — the credit does not disappear and the finish asks for the amount.
  const b = setup();
  service(b.c, { answer: req => reply(req.credit ? verifiedCredit(b.data) : b.data.paper) });
  b.c.run('renderReceiving()');
  await b.c.click('rc-open-nodoc');
  b.c.run(MILK(9));
  await b.c.click('rc-nodoc-found');
  b.c.node('rcNoteInput').value = '93.8'; b.c.node('rcNoteUnits').value = '16';
  await b.c.click('rc-note-add');
  b.c.node('rcNoteInput').value = ''; b.c.node('rcNoteUnits').value = '';
  await b.c.click('rc-notes-done');
  assert.equal(b.c.run('receiptNoDoc && !receiptWithoutPaper()'), true);
  assert.match(app(b.c), CREDIT_BUTTON);
  const id = await addCredit(b.c, b.opened);
  assert.equal(b.c.run('receiptNoDoc'), true, 'the tap alone photographs nothing — the flag waits for the photo');
  await photograph(b.c, id, ['slip.jpg']);
  assert.equal(b.c.run('receiptNoDoc'), false, 'a credit photographed on the receiving screen says the same');
  pressConfirm(b.c); await flush(b.c);
  assert.equal(creditStatus(b.c), 'confirmed');
  await b.c.click('rc-notes-edit');
  await b.c.click('rc-note-remove', undefined, { idx: '0' });
  assert.equal(b.c.run('receiptNotes.length'), 0);
  assert.equal(b.c.run('receiptWithoutPaper()'), false);
  assert.match(app(b.c), CONFIRMED_CARD, 'removing the note does not hide the credit');
  pressCart(b.c);
  assert.equal(b.c.run('currentView'), 'receiving');
  assert.deepEqual(b.c.toasts, [AMOUNT_TOAST]);
});

test('i: a credit an older draft left on a no-document receipt is shown and removable on its receiving screen; the finish explains instead of opening the reconcile screen', async () => {
  // A v365 draft: a credit photographed on a fresh gate, then "אין תעודה בכלל" — v365 kept the credit and hid it.
  async function oldDraft({ verification = true } = {}) {
    const { c, data, opened } = setup();
    service(c, { answer: req => reply(req.credit ? verifiedCredit(data, { verification }) : data.paper) });
    await gateCredit(c, opened); await flush(c);
    assert.equal(creditStatus(c), verification ? 'confirmed' : 'review');
    c.run(`receiptNoDoc = true; receiptEntryMode = 'manual'; receiptOpened = true; editingNotes = false; receiptNotes = []; recomputeNoteTotal();`);
    c.run(MILK(9));
    const r = runtime('yotvata', { data, storage: c.storage });
    r.run("receiptDupConfirmed = true; showConfirm = (t, x, l, fn) => fn(); mainMode = 'receiving'; currentView = 'receiving'; renderReceiving()");
    assert.equal(r.run('receiptNoDoc && receiptWithoutPaper() && receiptDeliveryCredits.length === 1'), true);
    return r;
  }
  const r = await oldDraft();
  const html = app(r);
  assert.match(html, /קליטה בלי תעודה/);
  assert.match(html, CONFIRMED_CARD, 'the card is on the screen');
  assert.match(html, /data-role="delivery-credit-remove"/, '"הסר זיכוי" is reachable');
  assert.doesNotMatch(html, /delivery-credit-add/, 'but no new credit can be photographed without paper');
  assert.equal(r.run('deliveryCreditsAllowed()'), false);
  pressCart(r);
  assert.equal(r.run('currentView'), 'receiving', 'no reconcile screen for a receipt without paper');
  assert.equal(r.run('pendingReceipt'), null);
  assert.deepEqual(r.toasts, [NODOC_TOAST]);
  assert.match(app(r), /data-role="delivery-credit-remove"/, 'the card the toast points at is still there');
  // "הסר זיכוי" → the no-document finish works as before.
  await r.click('delivery-credit-remove', r.run('receiptDeliveryCredits[0].id'));
  assert.equal(r.run('receiptDeliveryCredits.length'), 0);
  assert.doesNotMatch(app(r), /rcDeliveryCredits/, 'no credits, no section');
  r.run('finishReceipt()');
  const p = json(r, 'pendingReceipt');
  assert.ok(p); assert.equal(p.noDoc, true); assert.equal(p.status, 'open'); assert.equal(p.ex, 45);
  // Typing the invoice data instead keeps the credit: the receipt becomes an ordinary one.
  const t = await oldDraft();
  await t.click('rc-nodoc-found');
  t.node('rcNoteInput').value = '93.8'; t.node('rcNoteUnits').value = '16';
  await t.click('rc-notes-done');
  assert.equal(t.run('receiptWithoutPaper()'), false);
  assert.match(app(t), CONFIRMED_CARD);
  pressCart(t);
  assert.equal(t.run('currentView'), 'reconcile', 'a comparison against the typed paper, with the credit');
  assert.deepEqual(t.toasts, []);
  assert.equal(t.run('receiptDeliveryCredits.length'), 1);
  // A credit still waiting for review gets the same explanation — not "complete the credits" about a hidden card.
  const v = await oldDraft({ verification: false });
  assert.match(app(v), /data-role="delivery-credit-(confirm|remove)"/);
  pressCart(v);
  assert.equal(v.run('currentView'), 'receiving');
  assert.deepEqual(v.toasts, [NODOC_TOAST]);
  assert.match(app(v), /id="rcDeliveryCredits"/);
});

test('j: the green button tapped and the camera cancelled photographs nothing — the no-document receipt stays one, with or without the empty card', async () => {
  // The camera opened and was dismissed: no change event, an empty capture card, and the flag untouched.
  const { c, data, opened } = setup();
  const s = service(c, { answer: req => reply(req.credit ? verifiedCredit(data) : data.paper) });
  await noDocBackOnGate(c);
  const id = await addCredit(c, opened);
  assert.equal(c.run('receiptDeliveryCredits[0].pages.length === 0 && receiptDeliveryCredits[0].status === "capture"'), true);
  assert.equal(c.run('receiptNoDoc'), true, 'nothing was photographed — the receipt still has no paper');
  assert.equal(json(c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY))').noDoc, true, 'the draft agrees');
  assert.match(app(c), GATE);
  assert.match(app(c), /data-role="delivery-credit-camera"/, 'the empty card offers the camera again');
  // "הסר זיכוי" on the empty card, then "הקלדת סכום ויחידות ידנית" and the finish: the no-document
  // summary, exactly as if the button had never been tapped.
  await c.click('delivery-credit-remove', id);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
  assert.equal(c.run('receiptNoDoc'), true);
  await c.click('rc-photo-manual');
  pressCart(c);
  const p = json(c, 'pendingReceipt');
  assert.ok(p, 'the no-document summary opens');
  assert.equal(p.noDoc, true); assert.equal(p.status, 'open'); assert.equal(p.ex, 45);
  assert.deepEqual(c.toasts, []);
  assert.deepEqual(s.kinds(), [], 'no read of any kind');
  // The empty card left in place: it is on the manual screen with "הסר זיכוי", the finish explains,
  // and a reload of the draft is still a no-document receipt. The photo, not the tap, drops the flag.
  const k = setup();
  service(k.c, { answer: req => reply(req.credit ? verifiedCredit(k.data) : k.data.paper) });
  await noDocBackOnGate(k.c);
  const kid = await addCredit(k.c, k.opened);
  await k.c.click('rc-photo-manual');
  assert.equal(k.c.run('receiptNoDoc && receiptWithoutPaper()'), true);
  assert.match(app(k.c), /id="rcDeliveryCredits"/, 'the empty card is on the manual screen');
  assert.match(app(k.c), /data-role="delivery-credit-remove"/);
  assert.doesNotMatch(app(k.c), /data-role="delivery-credit-add"/, 'no further credit without paper');
  pressCart(k.c);
  assert.equal(k.c.run('pendingReceipt'), null);
  assert.deepEqual(k.c.toasts, [NODOC_TOAST]);
  const r = runtime('yotvata', { data: k.data, storage: k.c.storage });
  r.run("mainMode = 'receiving'; currentView = 'receiving'; receiptDupConfirmed = true; renderReceiving()");
  assert.equal(r.run('receiptNoDoc'), true);
  assert.equal(r.run('receiptDeliveryCredits.length'), 1);
  await photograph(k.c, kid, ['slip.jpg']);
  assert.equal(k.c.run('receiptNoDoc'), false, 'the photo says the receipt has paper');
  assert.equal(json(k.c, 'JSON.parse(localStorage.getItem(RECEIPT_DRAFT_KEY))').noDoc, false);
  pressConfirm(k.c); await flush(k.c);
  assert.equal(creditStatus(k.c), 'confirmed');
  pressCart(k.c);
  assert.equal(k.c.run('currentView'), 'receiving');
  assert.deepEqual(k.c.toasts, [AMOUNT_TOAST], 'now an ordinary paper receipt: the finish asks for the amount');
  // A photo that could not be prepared is not a photo either: the flag stays.
  const f = setup();
  await noDocBackOnGate(f.c);
  const fid = await addCredit(f.c, f.opened);
  f.c.run('aiCompressInvoiceImage = async () => { throw new Error("boom"); }');
  await photograph(f.c, fid, ['slip.jpg']);
  assert.equal(f.c.run('receiptDeliveryCredits[0].status === "error" && receiptDeliveryCredits[0].pages.length === 0'), true);
  assert.equal(f.c.run('receiptNoDoc'), true);
});
