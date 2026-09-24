// v364: the paid scan transport — resume by key, warm-up, one paid upload at a
// time — and the driver-credit read that rides on it. Runs the complete app
// module (receipt-scan-harness); only fetch, timers and the Firebase boundary
// are faked. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fixture, reply } from './receipt-scan-harness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await tick(); };
const json = (c, expression) => JSON.parse(c.run('JSON.stringify(' + expression + ')'));
const INVOICE_PAGE = "{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}";
const CREDIT_PAGE = "{dataUrl:'data:image/jpeg;base64,Q1JFRElU',orientationConfirmed:true}";
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

// /health as served by v147 (deployed) and v148 (resume protocol).
const health = version => ({ ok: true, keyConfigured: true, photoFirst: true, serviceVersion: version,
  ...(version >= 148 ? { scanResume: true, creditDocuments: true } : {}) });

// The harness parks every timer. Here short ones (retry back-off, health back-off,
// visibility settle) run; the long request time-outs never fire.
function liveTimers(c) {
  c.context.setTimeout = (fn, ms) => { if ((Number(ms) || 0) < 10000) setImmediate(fn); return 0; };
}

// A scripted scan service. answer(request, index) returns a Response double, a
// promise of one, or throws (a browser-level network failure).
function service(c, { version = 148, healthAnswer = null, answer }) {
  const log = [], stats = { active: 0, maxActive: 0 };
  let healthCalls = 0;
  c.context.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.endsWith('/health')) {
      log.push({ kind: 'health', method: options.method || 'GET', cache: options.cache });
      healthCalls++;
      return healthAnswer ? healthAnswer(healthCalls) : reply(health(version));
    }
    assert.ok(u.endsWith('/scan'), 'unexpected request ' + u);
    const body = JSON.parse(options.body);
    const request = { kind: body.resume ? 'resume' : 'full', body, credit: body.documentKind === 'credit' };
    log.push(request);
    const index = log.filter(e => e.kind !== 'health').length - 1;
    stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
    try { return await answer(request, index); } finally { stats.active--; }
  };
  return { log, stats, kinds: () => log.map(e => e.kind + (e.credit ? ':credit' : '')),
    keys: () => new Set(log.filter(e => e.body).map(e => e.body.scanKey)) };
}

function invoiceRuntime(data = fixture('yotvata')) {
  const c = runtime('yotvata', { data });
  c.run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true;
    aiScanDocuments = [{noteIndex:0, amount:null, units:null, pages:[${INVOICE_PAGE}]}];`);
  liveTimers(c);
  return { c, data };
}
const problems = c => json(c, 'receiptPaperScanProblems').join(' | ');

// A valid driver credit for 6 × coffee (−43.80 before VAT).
function creditPaper(data, { qty = 6, amount = 43.8, vat, total, barcode = '7290000000015', description = 'קפה בדיקה', sign = -1 } = {}) {
  const raw = structuredClone(data.paper.scan.documents[0].rows[0]);
  Object.assign(raw, { description, barcode, barcodeObserved: barcode, quantity: qty, lineNumber: 1,
    unitPriceExVat: Math.round(amount / qty * 100) / 100, lineTotalExVat: sign * amount, grossLineTotalExVat: sign * amount });
  const cents = n => Math.round(n * 100) / 100;
  return { ok: true, serviceVersion: 148, model: 'fixture', requestId: 'credit-fixture',
    scan: { warnings: [], documents: [{ noteIndex: 0, invoiceNumber: 'CREDIT-1', pageCount: 1,
      subtotalExVat: sign * amount, vatAmount: vat === undefined ? cents(sign * amount * .18) : vat,
      totalInclVat: total === undefined ? cents(sign * amount * 1.18) : total,
      printedUnits: qty, printedLines: 1, rows: [raw] }] } };
}
const addCredit = (c, id = 'credit-1') => c.run(`receiptDeliveryCredits.push({id:${JSON.stringify(id)},status:'capture',pageCount:1,pages:[${CREDIT_PAGE}]})`);

test('v148: a dropped connection is resumed by the same key; one paid upload, the result is collected', async () => {
  const { c, data } = invoiceRuntime();
  const s = service(c, { version: 148, answer: (req, i) => { if (i === 0) throw new TypeError('Load failed'); return reply(data.paper); } });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'resume']);
  assert.deepEqual(s.log[0], { kind: 'health', method: 'GET', cache: 'no-store' });
  const full = s.log[1].body, resume = s.log[2].body;
  assert.match(full.scanKey, KEY);
  assert.equal(full.reviewProtocolVersion, 1);
  assert.equal(full.documents.length, 1);
  assert.equal('documentKind' in full, false, 'an invoice read carries no credit marker');
  assert.deepEqual(resume, { reviewProtocolVersion: 1, scanKey: full.scanKey, resume: true });
  assert.equal(c.run('aiScanServiceStatus.scanResume'), true);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('receiptNoteTotal'), 50);
  assert.equal(c.run('aiScanCutKeys.size'), 0, 'a collected read leaves nothing to collect');
});

test('v148: every automatic retry collects by key, never re-uploads; after the last one the key is kept', async () => {
  const { c } = invoiceRuntime();
  const s = service(c, { version: 148, answer: () => { throw new TypeError('Load failed'); } });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'resume', 'resume']);
  assert.equal(s.keys().size, 1);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.match(problems(c), /אין חיבור יציב לשירות הפענוח\. הקריאה ממשיכה בשרת/);
  assert.doesNotMatch(problems(c), /Load failed/);
  assert.equal(c.run('aiScanCutKeys.size'), 1);
});

// v364: a v148 job store as the service keeps it after the fix — a failed read is
// stored like a success and every collection of its key gets the same failure
// until the job expires. `lost(i)` drops the reply of request i after the service
// wrote it (screen lock: the phone never reads it). `paid` counts model reads.
function jobService(c, { lost = () => false, read }) {
  const jobs = new Map(), log = [], stats = { paid: 0 };
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(148)); }
    const body = JSON.parse(options.body), i = log.filter(e => e.body).length;
    log.push({ kind: body.resume ? 'resume' : 'full', body });
    let payload;
    if (body.resume) payload = jobs.get(body.scanKey) || { ok: false, error: 'resume_unknown', serviceVersion: 148 };
    else { stats.paid++; payload = { ...read(stats.paid), scanKey: body.scanKey }; jobs.set(body.scanKey, payload); }
    if (lost(i)) throw new TypeError('Load failed');
    return reply(payload);
  };
  return { log, stats, jobs, kinds: () => log.map(e => e.kind), fullKeys: () => log.filter(e => e.kind === 'full').map(e => e.body.scanKey) };
}

test('v148: a stored failure whose collection reply was lost is collected again — never a second paid read on its own', async () => {
  const { c, data } = invoiceRuntime();
  const failure = { ok: false, error: 'openai_error', message: 'upstream timeout', serviceVersion: 148 };
  // The opening connection and the first collection both lose the stored failure.
  const s = jobService(c, { lost: i => i < 2, read: n => n === 1 ? failure : data.paper });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'resume', 'resume'], 'no automatic second full body');
  assert.equal(s.stats.paid, 1, 'one paid read');
  assert.equal(new Set(s.log.filter(e => e.body).map(e => e.body.scanKey)).size, 1);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.match(problems(c), /upstream timeout/, 'the stored failure is shown');
  assert.equal(c.run('aiScanCutKeys.size'), 0, 'a shown job result leaves no key to collect');
  // "נסה שוב" after the shown failure: exactly one new paid read, with a new key.
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds().slice(4), ['health', 'full']);
  assert.equal(s.stats.paid, 2);
  const [first, second] = s.fullKeys();
  assert.match(second, KEY);
  assert.notEqual(second, first, 'the worker\'s retry is a new read, not a collection of the old failure');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('aiScanCutKeys.size'), 0);
});

test('v148: a collection answered without a job result keeps the key; one carrying the key drops it', async () => {
  for (const [label, answer, status, kept] of [
    ['rate limited', { ok: false, error: 'rate_limited' }, 429, true],
    ['key missing on the server', { ok: false, error: 'missing_openai_key' }, 500, true],
    ['a stored failure of this key', { ok: false, error: 'internal_error', scanKey: 'SAME' }, 500, false],
    ['a failure carrying another key', { ok: false, error: 'internal_error', scanKey: 'other-key-123' }, 500, true]
  ]) {
    const { c } = invoiceRuntime();
    const s = service(c, { version: 148, answer: (req, i) => {
      if (i === 0) throw new TypeError('Load failed');
      return reply({ ...answer, ...(answer.scanKey === 'SAME' ? { scanKey: req.body.scanKey } : {}) }, status);
    } });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.kinds(), ['health', 'full', 'resume'], label);
    assert.equal(c.run('receiptPaperScanState'), 'failed', label);
    assert.equal(c.run('aiScanCutKeys.size'), kept ? 1 : 0, label);
  }
});

test('v147: a network failure is sent once; retrying the same photo first asks to collect, then re-sends exactly once', async () => {
  const { c, data } = invoiceRuntime();
  const s = service(c, { version: 147, answer: (req, i) => {
    if (i === 0) throw new TypeError('Load failed');
    // What the deployed v147 answers to a resume body.
    if (req.kind === 'resume') return reply({ ok: false, error: 'invalid_document_count', maxDocuments: 4, maxPages: 8 }, 400);
    return reply(data.paper);
  } });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full'], 'no automatic paid re-send without scanResume');
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.match(problems(c), /אין חיבור יציב לשירות הפענוח\. בדוק שיש קליטה ונסה שוב\./);
  assert.doesNotMatch(problems(c), /Load failed|ניסיונות/);
  assert.equal(c.run('aiScanCutKeys.size'), 1, 'the key of the cut read is remembered');
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'health', 'resume', 'full']);
  assert.equal(s.keys().size, 1, 'the manual retry reuses the key of the cut read');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('aiScanCutKeys.size'), 0);
});

for (const [code, status] of [['resume_unknown', 200], ['invalid_document_count', 400]]) {
  test('v148: ' + code + ' on collection falls back to exactly one full re-send with the same key', async () => {
    const { c, data } = invoiceRuntime();
    const s = service(c, { version: 148, answer: (req, i) => {
      if (i === 0) throw new TypeError('Load failed');
      if (req.kind === 'resume') return reply({ ok: false, error: code }, status);
      return reply(data.paper);
    } });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.kinds(), ['health', 'full', 'resume', 'full']);
    assert.equal(s.keys().size, 1);
    assert.equal(c.run('receiptPaperScanState'), 'ok');
  });
}

test('a 200 carrying only heartbeat whitespace is a cut connection: collected on v148, one attempt on v147', async () => {
  for (const version of [148, 147]) {
    const { c, data } = invoiceRuntime();
    const s = service(c, { version, answer: (req, i) => i === 0 ? reply('   \n   ', 200) : reply(data.paper) });
    await c.run('yotvataStartPaperScan()');
    if (version === 148) {
      assert.deepEqual(s.kinds(), ['health', 'full', 'resume']);
      assert.equal(c.run('receiptPaperScanState'), 'ok');
    } else {
      assert.deepEqual(s.kinds(), ['health', 'full']);
      assert.equal(c.run('receiptPaperScanState'), 'failed');
      assert.match(problems(c), /החיבור נקטע לפני שהתשובה הגיעה/);
      assert.equal(c.run('aiScanCutKeys.size'), 1);
    }
  }
});

test('a non-JSON 502 is a service answer: no resume, no retry, nothing remembered', async () => {
  const { c, data } = invoiceRuntime();
  const s = service(c, { version: 148, answer: (req, i) => i === 0 ? reply('<html><body>502 Bad Gateway</body></html>', 502) : reply(data.paper) });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full']);
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.match(problems(c), /שירות הפענוח לא הצליח לענות כרגע/);
  assert.doesNotMatch(problems(c), /html|Bad Gateway|ניסיונות/i);
  assert.equal(c.run('aiScanCutKeys.size'), 0);
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'health', 'full'], 'a later retry is a new read, not a collection');
  assert.notEqual(s.log[1].body.scanKey, s.log[3].body.scanKey);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
});

test('existing service error mappings survive the new transport', async () => {
  const cases = [
    [{ ok: false, error: 'rate_limited' }, 429, /יותר מדי ניסיונות/, true],
    [{ ok: false, error: 'client_update_required', message: 'רענן עכשיו.' }, 409, /רענן עכשיו/, true],
    [{ ok: false, error: 'incomplete_model_output' }, 200, /לא החזיר פענוח מלא/, false],
    [{ ok: false, error: 'anchor_pre_discount', message: 'הסכום שהוקלד הוא לפני הנחה.' }, 200, /לפני הנחה/, false]
  ];
  for (const [payload, status, message, fatal] of cases) {
    const { c } = invoiceRuntime();
    const s = service(c, { version: 148, answer: () => reply({ ...payload, scanAudit: { id: 'audit' } }, status) });
    c.context.aiScanServiceStatus = null;
    const error = await c.run(`aiRequestSingleDocScan('t', aiScanDocuments[0].pages, {}).then(() => null,
      e => ({ message: e.message, fatal: e.fatal, anchor: e.anchorExplained, audit: e.scanAudit && e.scanAudit.id, network: !!e.networkFailure, code: e.code }))`);
    assert.match(error.message, message);
    assert.equal(error.fatal, fatal);
    assert.equal(error.anchor, payload.error === 'anchor_pre_discount');
    assert.equal(error.audit, 'audit');
    assert.equal(error.network, false);
    assert.equal(error.code, payload.error);
    assert.deepEqual(s.kinds(), ['full'], 'a service answer is never retried');
  }
});

test('one paid upload at a time: a credit read waits for the invoice document in flight, then runs', async () => {
  const { c, data } = invoiceRuntime();
  const credit = creditPaper(data); let releaseInvoice;
  const s = service(c, { version: 147, answer: req => req.credit ? reply(credit)
    : new Promise(resolve => { releaseInvoice = () => resolve(reply(data.paper)); }) });
  const invoice = c.run('yotvataStartPaperScan()');
  await settle();
  assert.deepEqual(s.kinds(), ['health', 'full']);
  addCredit(c);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  assert.deepEqual(s.kinds(), ['health', 'full'], 'nothing of the credit (not even its warm-up) while the invoice upload is open');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'reading');
  assert.equal(c.run('receiptDeliveryCredits[0].waiting'), true, 'the card can say the credit is queued');
  assert.equal(c.run('aiScanProgressText'), 'קורא תעודה 1 מתוך 1…');
  releaseInvoice();
  assert.equal(await read, true);
  await invoice;
  assert.deepEqual(s.kinds(), ['health', 'full', 'health', 'full:credit'], 'the credit warms its own connection right before its upload');
  assert.equal(s.stats.maxActive, 1, 'no overlapping /scan');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run('receiptDeliveryCredits[0].waiting'), false);
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  const body = s.log.at(-1).body;
  assert.equal(body.documentKind, 'credit');
  assert.match(body.scanKey, KEY);
  assert.equal(body.documents[0].expectedSubtotalExVat, null);
  assert.equal(body.documents[0].expectedUnits, null);
  assert.deepEqual(body.documents[0].pages, ['data:image/jpeg;base64,Q1JFRElU']);
  assert.equal(JSON.stringify(json(c, 'deliveryCreditSnapshot()')).includes('waiting'), false, 'queue state is not saved in the draft');
});

test('an invoice document queued behind a running credit says so, never overlaps it, and honours cancellation', async () => {
  for (const cancel of [false, true]) {
    const { c, data } = invoiceRuntime();
    const credit = creditPaper(data); let releaseCredit;
    const s = service(c, { version: 147, answer: req => req.credit
      ? new Promise(resolve => { releaseCredit = () => resolve(reply(credit)); }) : reply(data.paper) });
    addCredit(c);
    const read = c.run("deliveryCreditRead('credit-1')");
    await settle();
    assert.deepEqual(s.kinds(), ['health', 'full:credit']);
    const invoice = c.run('yotvataStartPaperScan()');
    await settle();
    assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health']);
    assert.equal(c.run('aiScanProgressText'), 'קורא תעודה 1 מתוך 1… · ממתין לסיום קריאת הזיכוי…');
    if (cancel) c.run('yotvataResetPhotoReceipt(); aiScanBusy = false;');
    releaseCredit();
    await read; await invoice; await settle();
    assert.equal(s.stats.maxActive, 1);
    if (cancel) assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health'], 'a cancelled receipt never uploads after waiting');
    else {
      assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'full']);
      assert.equal(c.run('receiptPaperScanState'), 'ok');
      assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
    }
  }
});

test('warm-up retries the free GET, and a dead connection is explained in Hebrew before any paid upload', async () => {
  {
    const { c, data } = invoiceRuntime();
    const s = service(c, { version: 148, healthAnswer: n => { if (n < 3) throw new TypeError('Load failed'); return reply(health(148)); },
      answer: () => reply(data.paper) });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.kinds(), ['health', 'health', 'health', 'full']);
    assert.equal(c.run('receiptPaperScanState'), 'ok');
  }
  {
    const { c, data } = invoiceRuntime();
    const s = service(c, { version: 148, healthAnswer: n => n === 1 ? reply('<html>503</html>', 503) : reply(health(148)),
      answer: () => reply(data.paper) });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.kinds(), ['health', 'health', 'full'], 'a 5xx from the front end is also retried for free');
  }
  {
    const { c, data } = invoiceRuntime();
    const s = service(c, { version: 148, healthAnswer: () => { throw new TypeError('Load failed'); }, answer: () => reply(data.paper) });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.kinds(), ['health', 'health', 'health'], 'no paid upload without a working connection');
    assert.equal(c.run('receiptPaperScanState'), 'failed');
    assert.match(problems(c), /שירות הפענוח לא זמין כרגע\. בדוק שיש קליטה ונסה שוב\./);
    assert.doesNotMatch(problems(c), /Load failed|TypeError/);
    assert.equal(c.run('aiScanServiceStatus'), null);
    const error = await c.run('aiScanPrepareConnection().then(() => null, e => ({ message: e.message, network: e.networkFailure, detail: e.detail }))');
    assert.equal(error.network, true);
    assert.match(error.detail, /Load failed/);
    // The same failure on a credit read is a network error on the card, with the detail kept apart.
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
    const card = json(c, 'receiptDeliveryCredits[0]');
    assert.equal(card.status, 'error'); assert.equal(card.errorKind, 'network');
    assert.equal(card.error, 'שירות הפענוח לא זמין כרגע. בדוק שיש קליטה ונסה שוב.');
    assert.match(card.errorDetail, /Load failed/);
    assert.equal(s.log.filter(e => e.kind !== 'health').length, 0);
  }
  {
    // A page that is in the background waits until it is visible again before the GET.
    const { c, data } = invoiceRuntime();
    const s = service(c, { version: 148, answer: () => reply(data.paper) });
    let listener = null;
    Object.assign(c.context.document, { visibilityState: 'hidden',
      addEventListener: (type, fn) => { if (type === 'visibilitychange') listener = fn; },
      removeEventListener: (type, fn) => { if (listener === fn) listener = null; } });
    const warm = c.run('aiScanPrepareConnection()');
    await settle();
    assert.equal(s.log.length, 0, 'nothing is sent while the app is hidden');
    c.context.document.visibilityState = 'visible'; listener();
    assert.equal((await warm).scanResume, true);
    assert.equal(s.log.length, 1); assert.equal(listener, null);
  }
});

// v364: a credit read queued between two invoice documents warms its own
// connection. When that warm-up fails, the invoice document queued behind it must
// keep the automatic collection the run's own /health promised (scanResume).
for (const [label, failedHealth] of [
  ['no reception on every GET', () => { throw new TypeError('Load failed'); }],
  ['a 503 on every GET', () => reply({ ok: false, error: 'unavailable' }, 503)]
]) test('a failed credit warm-up (' + label + ') keeps scanResume for the invoice document queued behind it', async () => {
  const { c } = invoiceRuntime();
  c.run("aiScanDocuments.push({noteIndex:1, amount:null, units:null, pages:[{dataUrl:'data:image/jpeg;base64,U0VDT05E',orientationConfirmed:true}]})");
  let releaseFirst;
  const s = service(c, { version: 148, healthAnswer: n => n === 1 ? reply(health(148)) : failedHealth(),
    answer: (req, i) => {
      if (i === 0) return new Promise(resolve => { releaseFirst = () => resolve(reply(fixture('yotvata').paper)); });
      if (req.kind === 'full') throw new TypeError('Load failed'); // document 2: the connection drops
      return reply(fixture('yotvata').paper); // ...and is collected by key
    } });
  const invoice = c.run('yotvataStartPaperScan()');
  await settle();
  assert.deepEqual(s.kinds(), ['health', 'full']);
  addCredit(c);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  releaseFirst();
  assert.equal(await read, false);
  await invoice; await settle();
  assert.deepEqual(s.kinds(), ['health', 'full', 'health', 'health', 'health', 'full', 'resume'], 'document 2 is collected, not lost');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'error');
  assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), label.startsWith('no reception') ? 'network' : 'service');
  assert.equal(c.run('receiptPaperScanState'), 'ok', problems(c));
  assert.equal(c.run('aiScanServiceStatus.scanResume'), true, 'the last good answer is kept');
  assert.equal(new Set(s.log.filter(e => e.body).slice(1).map(e => e.body.scanKey)).size, 1);
});

test('a successful /health still replaces the kept answer: a service rolled back to v147 turns resume off', async () => {
  const { c } = invoiceRuntime();
  let version = 148;
  service(c, { healthAnswer: () => version ? reply(health(version)) : reply('<html>502</html>', 502), answer: () => { throw new Error('no scan'); } });
  assert.equal((await c.run('aiScanPrepareConnection()')).scanResume, true);
  version = 0;
  assert.equal(JSON.stringify(await c.run('aiScanPrepareConnection()')), '{"ok":false,"httpStatus":502}', 'the caller still sees the failure');
  assert.equal(c.run('aiScanServiceStatus.scanResume'), true);
  version = 147;
  await c.run('aiScanPrepareConnection()');
  assert.equal(c.run('aiScanServiceStatus.serviceVersion'), 147);
  assert.equal(c.run('aiScanServiceStatus.scanResume'), undefined);
});

test('credit reconnect text goes to the credit card only; the invoice banner is never written by a credit read', async () => {
  const { c, data } = invoiceRuntime();
  const credit = creditPaper(data); let failCredit, seen = null;
  const s = service(c, { version: 148, answer: req => {
    if (req.credit) return new Promise((resolve, reject) => { failCredit = () => reject(new TypeError('Load failed')); });
    if (req.kind === 'resume') {
      seen = { banner: c.run('aiScanProgressText'), credit: c.run('receiptDeliveryCredits[0].progress') };
      return reply(credit);
    }
    return reply(data.paper);
  } });
  addCredit(c);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  const invoice = c.run('yotvataStartPaperScan()');
  await settle();
  const banner = 'קורא תעודה 1 מתוך 1… · ממתין לסיום קריאת הזיכוי…';
  assert.equal(c.run('aiScanProgressText'), banner);
  failCredit();
  assert.equal(await read, true);
  await invoice;
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'resume', 'full']);
  assert.equal(seen.banner, banner, 'the credit retry never touched aiScanProgressText');
  assert.match(seen.credit, /החיבור נפל, מתחבר מחדש/);
  assert.equal(c.run('receiptDeliveryCredits[0].progress'), '');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
});

test('a credit and an invoice with the same photo never share a resume key', async () => {
  const { c } = invoiceRuntime();
  c.run('aiScanCutKeys.clear()');
  const pages = JSON.stringify([{ dataUrl: 'data:image/jpeg;base64,U0FNRQ==' }]);
  const invoice = c.run(`aiScanPagesFingerprint(${pages}, { amount: null, units: null })`);
  const credit = c.run(`aiScanPagesFingerprint(${pages}, { amount: null, units: null }, 'credit')`);
  assert.notEqual(invoice, credit);
});

test('an EAN-8 credit row resolves to its single catalog product; a wrong check digit does not', async () => {
  const data = fixture('yotvata');
  data.products.push({ id: 'gum', name: 'מסטיק בדיקה', barcode: '96385074', price: 2 });
  const c = runtime('yotvata', { data });
  service(c, { version: 147, answer: () => reply(creditPaper(data, { barcode: '96385074', description: 'מסטיק', qty: 2, amount: 4 })) });
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  const row = json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0];
  assert.equal(row.productId, 'gum'); assert.equal(row.name, 'מסטיק בדיקה');
  assert.equal(row.qty, 2); assert.equal(row.amount, 4);
  assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true);
  c.run("receiptDeliveryCredits[0].barcodes = ['96385075']");
  assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, null, 'bad check digit');
  c.run("receiptDeliveryCredits[0].barcodes = ['7290000000015']");
  assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, 'coffee', 'EAN-13 still resolves');
  c.run("products.push({ id: 'gum-2', name: 'כפילות', barcode: '96385074', price: 2 }); receiptDeliveryCredits[0].barcodes = []");
  assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, null, 'an ambiguous barcode never picks a product');
});

for (const [label, options, accepted] of [
  ['VAT and total printed without a minus sign', { vat: 7.88, total: 51.68 }, true],
  ['only the total printed without a minus sign', { vat: -7.88, total: 51.68 }, true],
  ['unsigned VAT and total that do not add up', { vat: 7.88, total: 50 }, false],
  ['a positive paper (an invoice, not a credit)', { sign: 1, vat: 7.88, total: 51.68 }, false]
]) test('credit paper check: ' + label, async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data });
  service(c, { version: 147, answer: () => reply(creditPaper(data, options)) });
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), accepted);
  const card = json(c, 'receiptDeliveryCredits[0]');
  if (accepted) { assert.equal(card.status, 'review'); assert.equal(card.paper.subtotalExVat, -43.8); }
  else {
    assert.equal(card.status, 'error'); assert.equal(card.errorKind, 'paper'); assert.equal(card.paper, null);
    assert.match(card.error, options.sign === 1 ? /לא נקרא סכום זיכוי שלילי/ : /לפני ואחרי מע״מ אינם תואמים/);
  }
});

test('a 1:5 credit slip keeps ~715×3580 pixels; the same photo as an invoice page stays 370×1850', async () => {
  const c = runtime('yotvata');
  c.context.document.createElement = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {},
    translate() {}, rotate() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} }) });
  c.run(`aiReadFile = async () => 'source'; aiLoadImage = async () => ({ naturalWidth: 1000, naturalHeight: 5000 });
    aiDetectPaperRegion = () => null; aiEnhanceDocumentPixels = () => false;
    aiCanvasToInvoiceJpeg = canvas => ({ dataUrl: 'data:image/jpeg;base64,' + btoa(canvas.width + 'x' + canvas.height), bytes: 1 });
    receiptDeliveryCredits = [{ id: 'credit-1', status: 'capture', pages: [], pageCount: 0 }];
    aiScanDocuments = [{ noteIndex: 0, amount: null, units: null, pages: [] }];`);
  const size = expression => c.run(`atob(${expression}.dataUrl.split(',')[1])`).split('x').map(Number);
  assert.equal(await c.run("deliveryCreditAddFiles('credit-1', [{ name: 'slip.jpg' }])"), true);
  const [w, h] = size('receiptDeliveryCredits[0].pages[0]');
  assert.ok(w >= 710 && w <= 720 && h >= 3570 && h <= 3590, 'credit ' + w + 'x' + h);
  assert.ok(w * h <= Math.round(1850 * 1850 * .75) * 1.002);
  assert.equal(c.run('receiptDeliveryCredits[0].pages[0].maxPixels'), c.run('AI_CREDIT_MAX_PIXELS'));
  await c.run("aiAddInvoiceFiles(0, [{ name: 'invoice.jpg' }])");
  assert.deepEqual(size('aiScanDocuments[0].pages[0]'), [370, 1850]);
  assert.equal(c.run("'maxPixels' in aiScanDocuments[0].pages[0]"), false);
});

test('a cloud draft that arrives during a credit read is deferred; the paid result is kept', async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data });
  let release;
  service(c, { version: 147, answer: () => new Promise(resolve => { release = () => resolve(reply(creditPaper(data))); }) });
  c.run(`receiptOpened = true; receiptList = [{ productId: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', qty: 3 }]; saveReceiptDraft();`);
  addCredit(c);
  c.context.otherDraft = { ...json(c, 'receiptDraftPayload(true)'), items: [{ productId: 'milk', qty: 7 }], deliveryCredits: [] };
  c.context.remoteEnvelope = await c.run(`(async () => ({ revision: receiptSync.revision + 5, mutationId: 'other-device',
    active: true, content: await packReceiptValue(otherDraft) }))()`);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  assert.equal(typeof release, 'function');
  c.run('receiptSync.dirty = false; receiptSyncConflict = null');
  await c.run('receiveReceiptCloudDraft(remoteEnvelope)');
  assert.equal(c.run('receiptSyncConflict === remoteEnvelope'), true, 'deferred to the conflict notice');
  c.run('receiptSyncConflict = null');
  await c.run('applyReceiptCloudDraft(remoteEnvelope)');
  assert.equal(c.run('receiptSyncConflict === remoteEnvelope'), true);
  assert.equal(c.run('receiptList[0].qty'), 3);
  assert.equal(c.run('receiptDeliveryCredits.length'), 1);
  release();
  assert.equal(await read, true);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  // Control: with no read running, the same draft is applied.
  c.run('receiptSyncConflict = null; receiptSync.dirty = false');
  await c.run('receiveReceiptCloudDraft(remoteEnvelope)');
  assert.equal(c.run('receiptList[0].qty'), 7);
  assert.equal(c.run('receiptDeliveryCredits.length'), 0);
});

// Firebase 11: getIdToken() hands back the cached token until 30 s before it
// expires; getIdToken(true) always mints a new one. The v148 server refuses a
// token whose exp is not after now − 30 s (401 invalid_auth) — before it looks
// up the job, which it keeps for 30 minutes after it settles.
function firebaseClock(c, { cachedLeft = 5 * 60 } = {}) {
  const clock = { now: 0, minted: [] };
  const expiry = new Map([['cached', cachedLeft]]);
  let cached = 'cached';
  c.context.firebaseGetIdToken = async force => {
    if (force || expiry.get(cached) - clock.now < 30) {
      cached = 'fresh-' + (clock.minted.length + 1); clock.minted.push(cached); expiry.set(cached, clock.now + 3600);
    }
    return cached;
  };
  c.run('auth.currentUser.getIdToken = force => firebaseGetIdToken(force)');
  clock.valid = token => expiry.has(token) && expiry.get(token) > clock.now - 30;
  return clock;
}

test('v148: a resume after a long screen lock goes out with a fresh token and collects the paid read', async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
  const clock = firebaseClock(c);
  const jobs = new Map(), log = []; let cut = true;
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push('health'); return reply(health(148)); }
    const body = JSON.parse(options.body), token = options.headers.Authorization.slice(7);
    const kind = body.resume ? 'resume' : 'full';
    if (!clock.valid(token)) { log.push(kind + ':401'); return reply({ ok: false, error: 'invalid_auth' }, 401); }
    log.push(kind + ':' + token);
    if (body.resume) return reply(jobs.get(body.scanKey) || { ok: false, error: 'resume_unknown' });
    jobs.set(body.scanKey, creditPaper(data)); // paid: the job keeps running on the server
    if (cut) { cut = false; c.context.document.visibilityState = 'hidden'; throw new TypeError('Load failed'); } // the phone locks
    return reply(jobs.get(body.scanKey));
  };
  addCredit(c);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  assert.deepEqual(log, ['health', 'full:cached'], 'nothing is sent while the phone is locked');
  clock.now = 10 * 60; // unlocked ten minutes later: the token taken before the upload has expired
  c.context.document.visibilityState = 'visible'; c.events.get('visibilitychange')();
  assert.equal(await read, true, c.run('receiptDeliveryCredits[0].error'));
  assert.deepEqual(log, ['health', 'full:cached', 'resume:fresh-1'], 'the collection carries a token taken after the lock');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(log.filter(e => e.startsWith('full')).length, 1, 'paid once');
  assert.equal(c.run('aiScanCutKeys.size'), 0);
});

test('a credit queued behind a long invoice read uploads with a token taken after the wait', async () => {
  const { c, data } = invoiceRuntime();
  const clock = firebaseClock(c, { cachedLeft: 2 * 60 });
  const log = []; let releaseInvoice;
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push('health'); return reply(health(147)); }
    const body = JSON.parse(options.body), token = options.headers.Authorization.slice(7);
    const kind = body.documentKind || 'invoice';
    if (!clock.valid(token)) { log.push(kind + ':401'); return reply({ ok: false, error: 'invalid_auth' }, 401); }
    log.push(kind + ':' + token);
    if (body.documentKind === 'credit') return reply(creditPaper(data));
    return new Promise(resolve => { releaseInvoice = () => resolve(reply(data.paper)); });
  };
  const invoice = c.run('yotvataStartPaperScan()');
  await settle();
  addCredit(c);
  const read = c.run("deliveryCreditRead('credit-1')");
  await settle();
  clock.now = 5 * 60; // the invoice read takes minutes; the token the credit took before queueing expires
  releaseInvoice();
  assert.equal(await read, true, c.run('receiptDeliveryCredits[0].error'));
  await invoice;
  assert.deepEqual(log, ['health', 'invoice:cached', 'health', 'credit:fresh-1']);
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
});

test('a collection refused on sign-in keeps the key; "נסה שוב" collects the paid read without paying again', async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
  const jobs = new Map(), log = []; let cut = true, refuse = true;
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push('health'); return reply(health(148)); }
    const body = JSON.parse(options.body);
    if (body.resume) {
      if (refuse) { log.push('resume:401'); return reply({ ok: false, error: 'invalid_auth' }, 401); }
      log.push('resume'); return reply(jobs.get(body.scanKey) || { ok: false, error: 'resume_unknown' });
    }
    log.push('full'); jobs.set(body.scanKey, creditPaper(data));
    if (cut) { cut = false; throw new TypeError('Load failed'); }
    return reply(jobs.get(body.scanKey));
  };
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
  assert.deepEqual(log, ['health', 'full', 'resume:401', 'resume:401'], 'one more collection with a renewed token, never a new upload');
  assert.equal(c.run('aiScanCutKeys.size'), 1, 'a sign-in refusal says nothing about the read: its key is kept');
  refuse = false;
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  assert.deepEqual(log.slice(4), ['health', 'resume']);
  assert.equal(log.filter(e => e === 'full').length, 1, 'paid once');
  assert.equal(c.run('aiScanCutKeys.size'), 0);
});

for (const [method, readType] of [['ambiguous', 'suffix'], ['suggested_name_multiple', 'full']]) {
  test('a credit row the server refused (' + method + ') never auto-picks a product from the digits it saw', async () => {
    const data = fixture('yotvata');
    data.products.push({ id: 'yogurt13', name: 'יוגורט', barcode: '7290896385074', price: 2 },
      { id: 'gum8', name: 'מסטיק', barcode: '96385074', price: 2 });
    const c = runtime('yotvata', { data });
    const paper = creditPaper(data, { barcode: '96385074', description: 'יוגורט', qty: 2, amount: 4 });
    // e.g. only the last 8 digits of the EAN-13 were legible, and they are also another product's EAN-8.
    Object.assign(paper.scan.documents[0].rows[0], { barcode: null, barcodeObserved: '96385074', barcodeReadType: readType, barcodeMatchMethod: method });
    service(c, { version: 148, answer: () => reply(paper) });
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
    const row = json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0];
    assert.equal(row.productId, null);
    assert.equal(row.barcode, '96385074', 'the digits that were read are shown for the worker to check');
    assert.match(c.run('deliveryCreditsHtml()'), /המוצר לא זוהה\. הקלד את הברקוד מהנייר/);
    assert.equal(c.run("deliveryCreditConfirm('credit-1')"), false);
    c.run("receiptDeliveryCredits[0].barcodes = ['7290896385074']");
    assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, 'yogurt13', 'the worker types the full barcode from the paper');
    c.run("receiptDeliveryCredits[0].barcodes = ['96385074']");
    assert.equal(json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0].productId, 'gum8', 'a barcode the worker typed is the worker\'s choice');
  });
}

// A fetch double that honours AbortSignal as a browser does. Uploads whose first
// page matches `held` stay open until released or aborted.
function heldService(c, held) {
  const log = [], releases = [];
  c.context.fetch = (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push('health'); return Promise.resolve(reply(health(147))); }
    const body = JSON.parse(options.body), page = body.documents[0].pages[0];
    const tag = held(page); log.push(tag);
    if (!tag.startsWith('held')) return Promise.resolve(reply({ ok: false, error: 'incomplete_model_output' }));
    return new Promise((resolve, reject) => {
      releases.push(() => resolve(reply({ ok: false, error: 'incomplete_model_output' })));
      if (options.signal) options.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
  };
  return { log, release: () => releases.forEach(fn => fn()) };
}

test('a cancelled receipt stops its invoice upload: the next receipt does not wait for it, and no credit is blamed', async () => {
  const { c } = invoiceRuntime();
  const s = heldService(c, page => page.includes('Zml4') ? 'held:old' : 'new');
  const first = c.run('yotvataStartPaperScan()'); await settle();
  assert.deepEqual(s.log, ['health', 'held:old']);
  c.run(`yotvataResetPhotoReceipt(); resetAiInvoiceScan(true); receiptOpened = false; receiptDupConfirmed = true;
    aiScanDocuments = [{noteIndex:0, amount:null, units:null, pages:[{dataUrl:'data:image/jpeg;base64,TkVXUEFHRQ==',orientationConfirmed:true}]}];`);
  const second = c.run('yotvataStartPaperScan()'); await settle();
  assert.deepEqual(s.log, ['health', 'held:old', 'health', 'new'], 'the new receipt uploads without waiting up to 7 minutes');
  assert.doesNotMatch(c.run('aiScanProgressText'), /הזיכוי/);
  s.release(); await first; await second; await settle();
  assert.equal(c.run('aiScanUploadQueue.length'), 0);
});

test('a removed credit stops its upload: a new credit reads at once and never says it waits for the invoice', async () => {
  const c = runtime('yotvata', { data: fixture('yotvata') }); liveTimers(c);
  const s = heldService(c, page => page.includes('T0xE') ? 'held:old' : 'new');
  c.run(`receiptDeliveryCredits.push({id:'old',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,T0xE',orientationConfirmed:true}]})`);
  const oldRead = c.run("deliveryCreditRead('old')"); await settle();
  c.run("deliveryCreditAction('delivery-credit-remove','old')");
  c.run(`receiptDeliveryCredits.push({id:'new',status:'capture',pageCount:1,pages:[{dataUrl:'data:image/jpeg;base64,TkVX',orientationConfirmed:true}]})`);
  const newRead = c.run("deliveryCreditRead('new')"); await settle();
  assert.deepEqual(s.log, ['health', 'held:old', 'health', 'new']);
  assert.equal(await oldRead, false);
  await newRead;
  assert.equal(c.run("deliveryCreditFind('new').waiting"), false);
  assert.equal(c.run('aiScanCutKeys.size'), 0, 'a cancelled read is not a cut connection: nothing to collect');
  s.release(); await settle();
  assert.equal(c.run('aiScanUploadQueue.length'), 0);
});

// v364 review round 3. A full body answered 2xx whose body was then cut: the
// service accepted the photos and is paying for the read. If a later collection
// finds no job (another or a restarted instance, or v147 which stores nothing),
// sending the photos again on its own is a second paid read the worker never chose (v325).
const acceptedThenCut = () => ({ ok: true, status: 200,
  text: async () => { throw new TypeError('Load failed'); }, json: async () => { throw new TypeError('Load failed'); } });

// v148: resume_unknown only says that this instance does not know the key. The
// remaining automatic collections are tried (free), then the key is kept (lost),
// and the worker's "נסה שוב" collects once and then sends the photos with the SAME
// key: on the instance that holds the read that is free, elsewhere one read he chose.
test('v148: a full body accepted (2xx) and then cut is never re-sent on its own after resume_unknown; the key is kept and "נסה שוב" re-sends with the same key', async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
  let full = 0;
  const s = service(c, { version: 148, answer: req => {
    if (req.kind === 'resume') return reply({ ok: false, error: 'resume_unknown', serviceVersion: 148 });
    return ++full === 1 ? acceptedThenCut() : reply(creditPaper(data));
  } });
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'resume', 'resume'], 'every automatic collection is tried; no second full body');
  assert.equal(s.log.filter(e => e.kind === 'full').length, 1, 'paid once so far');
  const key = s.log[1].body.scanKey;
  const card = json(c, 'receiptDeliveryCredits[0]');
  assert.equal(card.status, 'error');
  assert.equal(card.errorKind, 'network', 'the paid read may still be collected');
  assert.equal(card.error, 'הקריאה הקודמת לא נמצאה בשרת. נסה שוב — הצילום יישלח שוב.');
  assert.doesNotMatch(card.error, /[A-Za-z]/);
  assert.match(card.errorDetail, /resume_unknown · HTTP 200 · 3 attempts/);
  assert.deepEqual(json(c, '[...aiScanCutKeys.values()].map(({ key, accepted, lost }) => ({ key, accepted, lost }))'),
    [{ key, accepted: true, lost: true }], 'the accepted key is kept, marked lost');
  assert.equal(card.resume.scanKey, key, 'the credit keeps its key (for "אסוף את הקריאה" after a reload)');
  assert.match(c.run('deliveryCreditsHtml()'), /data-role="delivery-credit-read"[^>]*class="[^"]*bg-emerald-600[^"]*">נסה שוב</);
  // The worker's "נסה שוב": one free collection, then exactly one full body with the same key.
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  assert.deepEqual(s.kinds().slice(4), ['health', 'resume', 'full:credit']);
  const fulls = s.log.filter(e => e.kind === 'full');
  assert.equal(fulls.length, 2);
  assert.equal(fulls[1].body.scanKey, key, 'the same key: the instance holding the paid read answers it for free');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
  assert.equal(c.run('receiptDeliveryCredits[0].resume'), null);
  assert.equal(c.run('aiScanCutKeys.size'), 0, 'a shown result drops the key');
});

// v147 stores nothing: the key is forgotten and "נסה שוב" is one new read with a new key.
test('v147: a full body accepted (2xx) and then cut is never re-sent on its own after invalid_document_count; "נסה שוב" is one new read', async () => {
  const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
  let full = 0;
  const s = service(c, { version: 147, answer: req => {
    if (req.kind === 'resume') return reply({ ok: false, error: 'invalid_document_count', serviceVersion: 147 }, 400);
    return ++full === 1 ? acceptedThenCut() : reply(creditPaper(data));
  } });
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
  // v147: one attempt; the key is remembered as accepted, and "נסה שוב" first asks to collect.
  assert.deepEqual(s.kinds(), ['health', 'full:credit']);
  assert.equal(c.run('[...aiScanCutKeys.values()][0].accepted'), true);
  assert.equal(c.run('receiptDeliveryCredits[0].errorKind'), 'network');
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
  assert.deepEqual(s.kinds(), ['health', 'full:credit', 'health', 'resume']);
  assert.equal(s.log.filter(e => e.kind === 'full').length, 1, 'paid once so far');
  const card = json(c, 'receiptDeliveryCredits[0]');
  assert.equal(card.status, 'error');
  assert.equal(card.errorKind, 'service', 'not a network error: there is nothing left to collect');
  assert.equal(card.error, 'הקריאה הקודמת אבדה בשרת. נסה שוב — הצילום ייקרא מחדש.');
  assert.doesNotMatch(card.error, /[A-Za-z]/);
  assert.match(card.errorDetail, /invalid_document_count/);
  assert.equal(c.run('aiScanCutKeys.size'), 0, 'the lost key is forgotten');
  assert.match(c.run('deliveryCreditsHtml()'), /data-role="delivery-credit-read"[^>]*class="[^"]*bg-emerald-600[^"]*">נסה שוב</);
  // The worker's "נסה שוב": exactly one full body, with a new key.
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, c.run('receiptDeliveryCredits[0].error'));
  const fulls = s.log.filter(e => e.kind === 'full');
  assert.equal(fulls.length, 2);
  assert.notEqual(fulls[1].body.scanKey, fulls[0].body.scanKey);
  assert.equal(s.log.at(-1).kind, 'full');
  assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review');
});

// v364: two Cloud Run instances, each with its own v148 job store (as the service
// keeps it): a resume answers the stored job or resume_unknown; a full body whose
// key holds a finished success for the same documents gets it back with no model
// call, any other full body is a paid read. `route(kind, i)` picks the instance of
// scan request i; `cut(i)` answers 2xx and then drops the body (screen lock).
function twoInstances(c, { route, cut = () => false, read }) {
  const inst = { A: { jobs: new Map(), paid: 0 }, B: { jobs: new Map(), paid: 0 } }, log = [];
  c.context.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) { log.push({ kind: 'health' }); return reply(health(148)); }
    const body = JSON.parse(options.body), i = log.filter(e => e.body).length;
    const kind = body.resume ? 'resume' : 'full', name = route(kind, i), at = inst[name];
    log.push({ kind, at: name, body });
    if (i > 10) return new Promise(() => {});
    let payload;
    if (body.resume) payload = at.jobs.get(body.scanKey)?.payload || { ok: false, error: 'resume_unknown', serviceVersion: 148 };
    else {
      const same = JSON.stringify([body.documentKind || null, body.documents]);
      const job = at.jobs.get(body.scanKey);
      if (job && job.payload.ok === true && job.same === same) payload = job.payload;
      else { at.paid++; payload = { ...read(), scanKey: body.scanKey }; at.jobs.set(body.scanKey, { payload, same }); }
    }
    if (cut(i)) return acceptedThenCut();
    return reply(payload);
  };
  return { log, paid: () => inst.A.paid + inst.B.paid, trail: () => log.map(e => e.kind + (e.at ? '@' + e.at : '')) };
}

test('two instances: the accepted read waits on A while every collection lands on B — "נסה שוב" still pays for one read in total', async () => {
  // retryOn: where the worker's "נסה שוב" collection lands (its full body, if any, lands on A).
  for (const retryOn of ['B', 'A']) {
    const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
    let automatic = true;
    const s = twoInstances(c, { read: () => creditPaper(data), cut: i => i === 0,
      route: kind => kind === 'full' ? 'A' : automatic ? 'B' : retryOn });
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), false, retryOn);
    assert.deepEqual(s.trail(), ['health', 'full@A', 'resume@B', 'resume@B'], retryOn);
    assert.equal(s.paid(), 1, retryOn);
    automatic = false;
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, retryOn + ': ' + c.run('receiptDeliveryCredits[0].error'));
    assert.deepEqual(s.trail().slice(4), retryOn === 'A' ? ['health', 'resume@A'] : ['health', 'resume@B', 'full@A'], retryOn);
    assert.equal(s.paid(), 1, retryOn + ': the read A already paid for is the one shown');
    assert.equal(new Set(s.log.filter(e => e.body).map(e => e.body.scanKey)).size, 1, retryOn);
    assert.equal(c.run('receiptDeliveryCredits[0].status'), 'review', retryOn);
    assert.equal(c.run('aiScanCutKeys.size'), 0, retryOn);
  }
  {
    // The invoice: every collection on B; the next start of the scan reaches A — one paid read.
    const { c, data } = invoiceRuntime();
    const s = twoInstances(c, { read: () => data.paper, cut: i => i === 0,
      route: kind => kind === 'full' ? 'A' : 'B' });
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.trail(), ['health', 'full@A', 'resume@B', 'resume@B']);
    assert.equal(c.run('receiptPaperScanState'), 'failed');
    assert.match(problems(c), /הקריאה הקודמת לא נמצאה בשרת\. נסה שוב/);
    await c.run('yotvataStartPaperScan()');
    assert.deepEqual(s.trail().slice(4), ['health', 'resume@B', 'full@A']);
    assert.equal(s.paid(), 1, 'the read A already paid for is the one shown');
    assert.equal(c.run('receiptPaperScanState'), 'ok');
    assert.equal(c.run('aiScanCutKeys.size'), 0);
  }
});

test('an upload that never got a 2xx still falls back to exactly one full re-send (same key) after resume_unknown', async () => {
  for (const [label, first] of [['fetch rejected', () => { throw new TypeError('Load failed'); }],
    ['front-end 200 never arrived (aborted)', () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e; }]]) {
    const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
    let full = 0;
    const s = service(c, { version: 148, answer: req => {
      if (req.kind === 'resume') return reply({ ok: false, error: 'resume_unknown' });
      return ++full === 1 ? first() : reply(creditPaper(data));
    } });
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, label + ': ' + c.run('receiptDeliveryCredits[0].error'));
    assert.deepEqual(s.kinds(), ['health', 'full:credit', 'resume', 'full:credit'], label);
    assert.equal(s.keys().size, 1, label);
  }
});

test('invoice: a document accepted and then cut, whose job is not found, is not re-sent on its own; the next start collects once, then reads with the same key', async () => {
  const { c, data } = invoiceRuntime();
  let full = 0;
  const s = service(c, { version: 148, answer: req => req.kind === 'resume' ? reply({ ok: false, error: 'resume_unknown' })
    : ++full === 1 ? acceptedThenCut() : reply(data.paper) });
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds(), ['health', 'full', 'resume', 'resume'], 'every automatic collection is tried; no second full body');
  assert.equal(c.run('receiptPaperScanState'), 'failed');
  assert.match(problems(c), /הקריאה הקודמת לא נמצאה בשרת\. נסה שוב — הצילום יישלח שוב\./);
  assert.equal(c.run('aiScanCutKeys.size'), 1, 'the accepted key is kept');
  assert.equal(c.run('[...aiScanCutKeys.values()][0].lost'), true);
  await c.run('yotvataStartPaperScan()');
  assert.deepEqual(s.kinds().slice(4), ['health', 'resume', 'full']);
  assert.equal(s.log[6].body.scanKey, s.log[1].body.scanKey, 'the same key: free on the instance that holds the read');
  assert.equal(c.run('receiptPaperScanState'), 'ok');
  assert.equal(c.run('aiScanCutKeys.size'), 0);
});

// A collection refused on sign-in keeps the key: the paid read is still on the
// server. "Refresh the app" there would drop the in-memory key and photos, and the
// next read would be paid again.
test('a collection refused on sign-in says "נסה שוב", never "רענן"; a refused full upload still says "רענן"', async () => {
  {
    const data = fixture('yotvata'); const c = runtime('yotvata', { data }); liveTimers(c);
    let cut = true;
    service(c, { version: 148, answer: req => {
      if (req.kind === 'resume') return reply({ ok: false, error: 'invalid_auth' }, 401);
      if (cut) { cut = false; throw new TypeError('Load failed'); }
      return reply(creditPaper(data));
    } });
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), false);
    const card = json(c, 'receiptDeliveryCredits[0]');
    assert.equal(card.error, 'החיבור המאובטח נכשל. נסה שוב — הקריאה שכבר נעשתה תיאסף בלי תשלום נוסף.');
    assert.doesNotMatch(card.error, /רענן/);
    assert.equal(card.errorKind, 'network');
    assert.match(card.errorDetail, /invalid_auth/);
    assert.equal(c.run('aiScanCutKeys.size'), 1);
    const html = c.run('deliveryCreditsHtml()');
    assert.match(html, /data-role="delivery-credit-read"[^>]*class="[^"]*bg-emerald-600[^"]*">נסה שוב</);
    assert.doesNotMatch(html, /רענן/);
  }
  {
    // The invoice banner uses the same wording.
    const { c } = invoiceRuntime();
    service(c, { version: 148, answer: req => {
      if (req.kind === 'resume') return reply({ ok: false, error: 'auth_required' }, 401);
      throw new TypeError('Load failed');
    } });
    await c.run('yotvataStartPaperScan()');
    assert.equal(c.run('receiptPaperScanState'), 'failed');
    assert.match(problems(c), /החיבור המאובטח נכשל\. נסה שוב — הקריאה שכבר נעשתה תיאסף בלי תשלום נוסף\./);
    assert.doesNotMatch(problems(c), /רענן/);
    assert.equal(c.run('aiScanCutKeys.size'), 1);
  }
  {
    // A full upload refused on sign-in paid nothing and has nothing to collect: "רענן" stays.
    const { c } = invoiceRuntime();
    service(c, { version: 148, answer: () => reply({ ok: false, error: 'invalid_auth' }, 401) });
    await c.run('yotvataStartPaperScan()');
    assert.match(problems(c), /האימות המאובטח נכשל\. רענן את האפליקציה ונסה שוב\./);
    assert.equal(c.run('aiScanCutKeys.size'), 0);
  }
});

// A refused credit row (the service would not pick a product) used to be rendered
// with the digits it read as the field's value. A worker who types the same digits
// from the paper changes nothing, so the browser fires no `change` and the row can
// never be identified.
test('a refused credit row renders an empty barcode field with the read digits as a hint; typing them identifies the row', async () => {
  for (const method of ['conflicting_reads', 'ambiguous', 'suggested_name_multiple']) {
    const data = fixture('yotvata'); const c = runtime('yotvata', { data });
    const paper = creditPaper(data, { barcode: '7290000000015' });
    Object.assign(paper.scan.documents[0].rows[0], { barcode: null, barcodeObserved: '7290000000015', barcodeMatchMethod: method });
    service(c, { version: 148, answer: () => reply(paper) });
    addCredit(c);
    assert.equal(await c.run("deliveryCreditRead('credit-1')"), true, method);
    const html = c.run('deliveryCreditsHtml()');
    const field = html.match(/<input data-role="delivery-credit-barcode"[^>]*>/)[0];
    const rendered = field.match(/ value="([^"]*)"/)[1];
    assert.equal(rendered, '', method + ': the field is empty, the read digits are not accepted on their own');
    assert.match(html, /נקרא בצילום: <span dir="ltr">7290000000015<\/span>/, method);
    assert.equal(c.run("deliveryCreditConfirm('credit-1')"), false, method);
    // The worker types the digits printed on the paper. A browser fires `change`
    // only when the value differs from what was rendered.
    const typed = '7290000000015';
    if (typed !== rendered) c.events.get('app:change')({ target: { dataset: { role: 'delivery-credit-barcode', id: 'credit-1', row: '0' }, value: typed } });
    const row = json(c, 'deliveryCreditRows(receiptDeliveryCredits[0])')[0];
    assert.equal(row.productId, 'coffee', method + ': the typed barcode identifies the row');
    assert.equal(c.run("deliveryCreditConfirm('credit-1')"), true, method + ': the credit can be attached');
    assert.equal(c.run('receiptDeliveryCredits[0].status'), 'confirmed', method);
  }
  // A row the service did identify keeps its barcode in the field.
  const data = fixture('yotvata'); const c = runtime('yotvata', { data });
  service(c, { version: 148, answer: () => reply(creditPaper(data)) });
  addCredit(c);
  assert.equal(await c.run("deliveryCreditRead('credit-1')"), true);
  assert.match(c.run('deliveryCreditsHtml()'), /<input data-role="delivery-credit-barcode"[^>]* value="7290000000015"/);
  assert.doesNotMatch(c.run('deliveryCreditsHtml()'), /נקרא בצילום/);
});
