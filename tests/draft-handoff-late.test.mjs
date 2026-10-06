// v137 — שמירה שנכנסה מאוחר (אחרי "לא נשמרה") והעבודה שנעשתה אחריה; עותקים בצד של קליטה שנשמרה בטלפון אחר.
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


test('L1 stuck save lands after "not saved": the edit made after the failure message must not vanish', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.commitDelayMs = 1000;            // commit sent, stuck past the settle cap (400) — lands at ~1000ms
  const f = await a.h.finish('r1', { items: { ...a.d.items } });
  cloud.commitDelayMs = 0;
  assert.equal(f.unknown, true);
  await settle(450);
  assert.ok(a.notices.includes('finish-not-saved'), 'decided "not saved"');
  assert.equal(a.state().readOnly, false);
  a.client.setOnline(false);             // weak network: the backup of the next edit does not get through
  a.set('milk', 2);                      // the user keeps working after "not saved"
  await settle(450);                     // the stuck commit lands now
  a.client.setOnline(true); await settle(120);
  assert.equal(a.state().away.away, 'saved');            // "כבר נשמרה — כאן היא עותק ישן"
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 3 });
  a.h.clear();
  const kept = a.debug().side.some(x => JSON.parse(x.payload).items.milk === 2);
  assert.ok(kept, 'the edit made after "not saved" survives somewhere');   // FAILS on v137
});

test('S1 ping-pong: a "same" side copy of a receipt saved on the other phone is still offered with "פתח אותה"', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  a.d.items.local = 1;
  assert.equal((await a.h.take('r1')).ok, true); await settle();
  assert.equal((await b.h.take('r1')).ok, true); await settle();
  assert.equal((await b.h.finish('r1', { items: b.d.items })).ok, true); await settle();
  a.h.clear(); await settle();
  assert.deepEqual(a.state().side, [], 'record exists -> not offered (spec 5.8)');   // FAILS on v137
});

test('V1 already-path: late commit lands, user edited after "not saved", presses Save before snapshot -> ok:true already, new data never written', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.commitDelayMs = 1000;
  const f = await a.h.finish('r1', { items: { ...a.d.items } });
  cloud.commitDelayMs = 0;
  assert.equal(f.unknown, true);
  await settle(450);
  assert.ok(a.notices.includes('finish-not-saved'));
  a.client.setOnline(false);
  a.set('milk', 2);
  await settle(450);                     // stuck commit lands while A's listener is offline
  assert.equal(cloud.get(recPath('r1')).items.milk, undefined);
  a.client.setOnline(true);
  const g = await a.h.finish('r1', { items: { ...a.d.items } });
  console.log('second finish ->', JSON.stringify(g), 'record', JSON.stringify(cloud.get(recPath('r1')).items));
  assert.ok(!(g.ok && !cloud.get(recPath('r1')).items.milk), 'BUG: Save reported ok but milk:2 not in record');
});

test('V2 restart path: reply lost, app restarted before resolution, edit offline -> "saved, old copy", clear drops edit', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.loseReplyAfterCommit = true;
  const f = await a.h.finish('r1', { items: { ...a.d.items } });
  cloud.loseReplyAfterCommit = false;
  assert.equal(f.unknown, true);
  a.client.setOnline(false);
  a.h.stop();
  const a2 = phone(cloud, 'A', { storage: a.storage, cache: a.client.cache, draft: a.d });
  a2.client.setOnline(false);
  a2.start(); await settle();
  console.log('after restart offline', JSON.stringify(a2.state()));
  a2.set('milk', 2); await settle();
  a2.client.setOnline(true); a2.h.retry(); await settle(120);
  console.log('online', JSON.stringify(a2.state().away));
  a2.h.clear();
  const kept = a2.debug().side.some(x => JSON.parse(x.payload).items.milk === 2);
  assert.ok(kept, 'BUG: milk:2 lost after restart-path');
});

test('V2b restart after lost reply: edit offline, back online, press Save -> ok:true (already) and the edit is silently not saved', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.loseReplyAfterCommit = true;
  const f = await a.h.finish('r1', { items: { ...a.d.items } });
  cloud.loseReplyAfterCommit = false;
  assert.equal(f.unknown, true);
  a.client.setOnline(false); a.h.stop();                 // app killed while "בודק…"
  const a2 = phone(cloud, 'A', { storage: a.storage, cache: a.client.cache, draft: a.d });
  a2.client.setOnline(false); a2.start(); await settle();
  assert.equal(a2.state().readOnly, false);
  a2.set('milk', 2); await settle();                     // user keeps counting (weak network)
  a2.client.setOnline(true);
  const g = await a2.h.finish('r1', { items: { ...a2.d.items } });   // presses Save as soon as there is network
  console.log('finish after restart ->', JSON.stringify(g), 'record:', JSON.stringify(cloud.get(recPath('r1')).items), 'side:', JSON.stringify(a2.debug().side.map(x => x.reason)));
  assert.ok(!(g.ok && !cloud.get(recPath('r1')).items.milk), 'BUG: Save reported success but the record lacks milk:2');
});

test('G1 checking-undo: take whose commit was sent but is stuck past the timeout, while C takes it — side copy of B\'s own draft is removed', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'A'), b = phone(cloud, 'B'), c = phone(cloud, 'C'); [a, b, c].forEach(p => p.start()); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  b.newDraft('b1'); b.set('x', 1); await settle();
  cloud.commitDelayMs = 400;                 // B's commit is sent, reply later than T.take (250)
  const pb = b.h.take('r1');
  await settle(5); cloud.commitDelayMs = 0;
  assert.equal((await c.h.take('r1')).ok, true);   // C wins meanwhile
  const rb = await pb;
  assert.equal(rb.unknown, true, 'B: unknown');
  await settle(700);
  assert.equal(b.d.sessionId, 'b1');
  assert.deepEqual(b.debug().side, [], 'side copy removed after the server said "not yours"');
});

test('G2 scan start is backed up at once (not after the debounce) — the other phone loses the button immediately', async () => {
  const cloud = createCloud();
  const slow = { ...T, debounce: 5000 };
  const a = phone(cloud, 'A', { timeouts: slow }), b = phone(cloud, 'B'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); a.h.flush(); await settle();
  assert.equal(doc(cloud, 'r1').scanRunning, false);
  a.d.scan = true; a.h.changed(); await settle();
  assert.equal(doc(cloud, 'r1').scanRunning, true, 'scan flag written immediately');
  assert.equal(b.state().offers[0].button, false);
});
