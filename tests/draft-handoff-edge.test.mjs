// v137 — מקרי קצה של draft-handoff.js (מהסקירה: כל בדיקה כאן נכשלת על מוטציה ששרדה את שאר הבדיקות).
// K1–K3: תנאי השמירה בתוך הטרנזקציה (עברה / בוטלה / כבר קיימת) כשהטלפון עוד לא שמע. K4/K11: מטמון לא מחליט.
// K5: "עברה" נשמר גם אחרי פתיחה מחדש. K6: "המשך" שנכשל מוחק את העותק בצד שיצר. K7: ביטול ישן לא סוגר קליטה שנלקחה שוב.
// K8: ניסיון חוזר ברשת חלשה. K9: גידור — מה שלא הספיק עד תקרת הזמן לא נכתב אחר כך. K10: חלון הקריאה בשעון של המקבל.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud, memoryStorage } from './fake-firestore.mjs';

const source = fs.readFileSync(new URL('../draft-handoff.js', import.meta.url), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = async (ms = 40) => { for (let i = 0; i < 6; i++) { await new Promise(r => setImmediate(r)); } await wait(ms); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const T = { backup: 250, take: 250, finish: 250, close: 250, read: 250, debounce: 5, retry: 60, grace: 10, settleCap: 400 };
const j = x => JSON.parse(JSON.stringify(x));
const docPath = sid => 'root/drafts/handoff_test_receiving_' + sid;
const recPath = id => 'root/records/' + id;
const alive = [];
test.afterEach(() => { while (alive.length) { try { alive.pop().stop(); } catch (e) {} } });
function phone(cloud, name, opts = {}) {
  const client = cloud.client({ cache: opts.cache });
  const storage = opts.storage || memoryStorage();
  const ctx = vm.createContext({ console, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout });
  vm.runInContext(source, ctx);
  const p = { name, client, storage, notices: [], finished: [], applied: [],
    d: opts.draft ? JSON.parse(JSON.stringify(opts.draft)) : { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' } };
  const adapter = {
    getDraft: () => ({ sessionId: p.d.sessionId, recordId: p.d.recordId || p.d.sessionId, empty: !p.d.sessionId,
      payload: p.d.sessionId ? JSON.stringify({ v: 1, sessionId: p.d.sessionId, recordId: p.d.recordId, items: p.d.items, expected: p.d.expected, big: p.d.big }) : null,
      summary: { lines: Object.keys(p.d.items).length }, scanRunning: !!p.d.scan, expected: p.d.expected }),
    validatePayload: (x, doc) => x && x.v === 1 && x.sessionId === doc.sessionId,
    applyPayload: text => { const x = JSON.parse(text); p.applied.push(x.sessionId); p.d = { sessionId: x.sessionId, recordId: x.recordId, items: x.items, scan: false, expected: x.expected || null, big: x.big || '' }; p.h && p.h.changed(); },
    emptyDraft: () => { p.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; p.h && p.h.changed(); },
    recordSaved: id => !!cloud.get(recPath(id)),
    deviceName: () => name,
    onNotice: code => p.notices.push(code),
    finishedLate: sid => { p.finished.push(sid); adapter.emptyDraft(); }
  };
  p.h = ctx.DraftHandoff.create({ app: 'test', kind: 'receiving', prefix: 'tt', db: client.db, fs: client.fs, rootPath: ['root'],
    recordCollection: 'records', storage, isOnline: client.isOnline, appVersion: 't1', maxScanMs: opts.maxScanMs || 300,
    lifecycle: false, timeouts: opts.timeouts || T, adapter, now: opts.now });
  alive.push(p.h);
  p.start = () => p.h.start();
  p.newDraft = (sid, expected = null, recordId = null) => { p.d = { sessionId: sid, recordId: recordId || sid, items: {}, scan: false, expected, big: '' }; p.h.changed({ user: true }); };
  p.set = (product, qty, user = true) => { p.d.items[product] = qty; p.h.changed({ user }); };
  p.state = () => j(p.h.state());
  p.debug = () => j(p.h._debug());
  return p;
}
const doc = (cloud, sid) => cloud.get(docPath(sid));
const empty = () => ({ sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' });

test('K1 finish-tx-moved: A saves right after B took it (A has not heard yet) — B keeps it, no record', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false);          // A's watch stream lags (weak network)
  assert.equal((await b.h.take('r1')).ok, true);
  b.set('milk', 5); await settle();
  a.client.setOnline(true);           // A is back; the snapshot is still on its way
  const f = await a.h.finish('r1', { items: a.d.items });
  await settle();
  assert.equal(f.ok, false, 'A must not save');
  assert.equal(cloud.get(recPath('r1')), null, 'no stale record from A');
  assert.equal(doc(cloud, 'r1').state, 'open'); assert.equal(doc(cloud, 'r1').deviceName, 'B');
});

test('K2 finish-tx-state: A saves right after B canceled (A has not heard yet) — not saved', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  // B never took it; A shares the doc... make B the holder first, then A takes back, then B... simpler: B takes, A takes back, B cancels? B is away then.
  // Holder B cancels while A lags:
  a.client.setOnline(false);
  assert.equal((await b.h.take('r1')).ok, true); await settle();
  b.h.cancel(); b.d = empty(); b.h.changed(); await settle(80);
  assert.equal(doc(cloud, 'r1').state, 'canceled');
  a.client.setOnline(true);
  const f = await a.h.finish('r1', { items: a.d.items });
  await settle();
  assert.equal(f.ok, false);
  assert.equal(cloud.get(recPath('r1')), null, 'canceled receipt must not be saved');
  assert.equal(doc(cloud, 'r1').state, 'canceled');
});

test('K3 finish-exists: record saved elsewhere blindly (v136 phone / old queue) before A backed up — A must not overwrite', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.client.setOnline(false);
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.put(recPath('r1'), { items: { bread: 7 }, by: 'v136' });
  a.client.setOnline(true);
  const f = await a.h.finish('r1', { items: a.d.items });
  assert.equal(f.ok, false);
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 7 });
});

test('K4 onDoc-fromCache: A took it back, app killed before the snapshot; reopened offline with old cache — still editable', async () => {
  const cloud = createCloud();
  const a1 = phone(cloud, 'A'), b = phone(cloud, 'B'); a1.start(); b.start(); await settle();
  a1.newDraft('r1'); a1.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  assert.equal(a1.state().away.away, 'moved');
  assert.equal((await a1.h.take('r1')).ok, true);
  a1.client.setOnline(false); a1.h.stop();          // killed before its listener heard gen 3
  const a2 = phone(cloud, 'A', { storage: a1.storage, cache: a1.client.cache, draft: a1.d });
  a2.client.setOnline(false);
  a2.start(); await settle(80);
  assert.equal(a2.state().readOnly, false, 'offline + stale cache must not lock the phone that holds the receipt');
});

test('K5 away-persisted: phone that lost the receipt restarts offline — still read-only (cancel must stay blocked)', async () => {
  const cloud = createCloud();
  const a1 = phone(cloud, 'A'), b = phone(cloud, 'B'); a1.start(); b.start(); await settle();
  a1.newDraft('r1'); a1.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  assert.equal(a1.state().readOnly, true);
  a1.h.stop();
  const a2 = phone(cloud, 'A', { storage: a1.storage, draft: a1.d });
  a2.client.setOnline(false); a2.start(); await settle();
  assert.equal(a2.state().readOnly, true);
  assert.equal(a2.state().away && a2.state().away.away, 'moved');
});

test('K6a take-undo: take that fails before commit (already saved) removes the side copy it just made', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  b.newDraft('b1'); b.set('x', 1); await settle();
  assert.equal((await a.h.finish('r1', { items: a.d.items })).ok, true);
  const r = await b.h.take('r1');
  assert.equal(r.ok, false); assert.equal(r.reason, 'saved');
  assert.equal(b.d.sessionId, 'b1');
  assert.deepEqual(b.debug().side, [], 'failed take must remove the side copy it just made');
});

test('K6b checking-undo: take that loses the race (commit aborted -> "unknown") removes the side copy after the server decides', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'), c = phone(cloud, 'C'); [a, b, c].forEach(p => p.start()); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  b.newDraft('b1'); b.set('x', 1); await settle();
  c.newDraft('c1'); c.set('y', 1); await settle();
  let release; cloud.commitGate = new Promise(r => { release = r; });
  const pb = b.h.take('r1'), pc = c.h.take('r1');
  await settle(); cloud.commitGate = null; release();
  const [rb, rc] = await Promise.all([pb, pc]); await settle(120);
  const loser = (rb.ok || (rb.unknown && b.d.sessionId === 'r1')) ? c : b;
  assert.equal(loser.d.sessionId, loser.name === 'B' ? 'b1' : 'c1');
  assert.deepEqual(loser.debug().side, [], 'failed take must remove the side copy it just made');
});

test('K7 close-gen: queued cancel (gen 1) must not close a session this phone took back later (gen 3)', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false); a.h.cancel(); a.d = empty(); a.h.changed(); await settle();
  assert.equal((await b.h.take('r1')).ok, true); await settle();
  a.client.setOnline(true); await settle();
  assert.equal((await a.h.take('r1')).ok, true); await settle();
  assert.equal(doc(cloud, 'r1').gen, 3);
  a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r1').state, 'open', 'the session A holds now is not canceled by the old queue entry');
  assert.equal(a.state().readOnly, false);
});

test('K7b (real code) cancel pending + "המשך" on own offer — the restored receipt gets canceled under the user', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.reject = 'unavailable';         // weak network: navigator says online, the close tx fails
  a.h.cancel(); a.d = empty(); a.h.changed(); await settle();
  cloud.reject = null;
  await settle(10);
  const offer = a.state().offers.find(o => o.sessionId === 'r1');
  const offered = !!(offer && offer.button);
  if (offered) {
    assert.equal((await a.h.take('r1')).ok, true); await settle(150);
    assert.equal(doc(cloud, 'r1').state, 'open', 'BUG: restored receipt canceled by the pending close');
  }
  assert.equal(offered, false, 'BUG: own just-canceled receipt offered as "המשך אותה כאן"');
});

test('K8 backup-retry: tx fails while navigator says online (weak network) — retried by the 20s timer', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.reject = 'unavailable';
  a.set('bread', 4); await settle();
  assert.equal(a.state().status, 'failed');
  cloud.reject = null;
  await settle(150);
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { bread: 4 });
});

test('K9 fencing: take whose read is slower than the timeout reports failure and must not write later', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  const orig = b.client.fs.runTransaction;
  b.client.fs.runTransaction = (db, fn, opts) => orig(db, async tx => fn({ get: async ref => { await wait(400); return tx.get(ref); }, set: (r, d) => tx.set(r, d) }), opts);
  const r = await b.h.take('r1');
  assert.equal(r.ok, false); assert.ok(!r.unknown, 'timed out before commit — a definite failure');
  await settle(600);
  assert.equal(doc(cloud, 'r1').deviceName, 'A', 'nothing written after the timeout');
  assert.equal(a.state().readOnly, false);
});

test('K10 scan window on B\'s clock: A\'s clock is 30 min behind — B still has no button while A scans', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A', { now: () => Date.now() - 30 * 60000 }), b = phone(cloud, 'B', { maxScanMs: 5 * 60000 }); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.d.scan = true; a.h.changed(); await settle();
  assert.equal(b.state().offers[0].scanRunning, true);
  assert.equal(b.state().offers[0].button, false, 'no take button while the paid scan runs');
});

test('K11 query-fromCache: reopened offline with a cached open doc that was saved since — no offer from cache', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b1 = phone(cloud, 'B'); a.start(); b1.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  assert.ok(b1.state().offers.length);
  b1.client.setOnline(false); b1.h.stop();
  assert.equal((await a.h.finish('r1', { items: a.d.items })).ok, true);
  const b2 = phone(cloud, 'B', { storage: b1.storage, cache: b1.client.cache });
  b2.client.setOnline(false); b2.start(); await settle();
  assert.deepEqual(b2.state().offers, [], 'no decision from cache');
});
