// בדיקות המודול draft-handoff.js — בלי האפליקציה, עם ענן מדומה (tests/fake-firestore.mjs) וכמה "טלפונים".
// הקובץ הזה עובר כמו שהוא לכל אפליקציה שמקבלת את המודול (docs/local-first-sync.md, סעיף 10).
// כל טלפון: מופע של המודול בהקשר נפרד, localStorage משלו, מטמון משלו, ורשת שאפשר לכבות.
// הרצה: node --test tests/draft-handoff.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCloud, memoryStorage } from './fake-firestore.mjs';

const source = fs.readFileSync(new URL('../draft-handoff.js', import.meta.url), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = async (ms = 40) => { for (let i = 0; i < 6; i++) { await new Promise(r => setImmediate(r)); } await wait(ms); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const T = { backup: 250, take: 250, finish: 250, close: 250, read: 250, debounce: 5, retry: 60, grace: 10, settleCap: 400, scanBeat: 60 };
const j = x => JSON.parse(JSON.stringify(x)); // ערכים מהקשר אחר (vm) — להשוואה
const docPath = sid => 'root/drafts/handoff_test_receiving_' + sid;
const recPath = id => 'root/records/' + id;

const alive = [];
test.afterEach(() => { while (alive.length) { try { alive.pop().stop(); } catch (e) {} } });
function phone(cloud, name, opts = {}) {
  const client = cloud.client({ cache: opts.cache });
  const storage = opts.storage || memoryStorage();
  const ctx = vm.createContext({ console, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout });
  vm.runInContext(source, ctx);
  const p = { name, client, storage, notices: [], finished: [], applied: [], closed: [], payloadCalls: 0,
    d: opts.draft ? JSON.parse(JSON.stringify(opts.draft)) : { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' } };
  const adapter = {
    getDraft: () => ({ sessionId: p.d.sessionId, recordId: p.d.recordId || p.d.sessionId, empty: !p.d.sessionId, scanRunning: !!p.d.scan, expected: p.d.expected }),
    getPayload: () => { p.payloadCalls++; return { payload: JSON.stringify({ v: 1, sessionId: p.d.sessionId, recordId: p.d.recordId, items: p.d.items, expected: p.d.expected, big: p.d.big }),
      summary: { lines: Object.keys(p.d.items).length } }; },
    onClosed: meta => p.closed.push(meta),
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
    lifecycle: false, timeouts: T, adapter });
  alive.push(p.h);
  p.start = () => p.h.start();
  p.newDraft = (sid, expected = null, recordId = null) => { p.d = { sessionId: sid, recordId: recordId || sid, items: {}, scan: false, expected, big: '' }; p.h.changed({ user: true }); };
  p.set = (product, qty, user = true) => { p.d.items[product] = qty; p.h.changed({ user }); };
  p.state = () => j(p.h.state());
  p.debug = () => j(p.h._debug());
  return p;
}
const doc = (cloud, sid) => cloud.get(docPath(sid));

test('גיבוי: טיוטה חדשה נגבית למסמך אחד משלה; בלי שינוי — בלי כתיבה; בלי רשת — "מתעכב", וכשחוזרת — נגבית', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  let x = doc(cloud, 'r1');
  assert.equal(x.state, 'open'); assert.equal(x.gen, 1); assert.equal(x.deviceName, 'א'); assert.equal(x.openKey, 'test:receiving');
  assert.deepEqual(JSON.parse(x.payload).items, { bread: 3 });
  assert.equal(a.state().status, 'saved');
  const v = cloud._version(docPath('r1'));
  a.h.flush(); await settle();
  assert.equal(cloud._version(docPath('r1')), v, 'בלי שינוי — בלי כתיבה');
  a.client.setOnline(false); a.set('bread', 5); await settle();
  assert.equal(a.state().status, 'failed');
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { bread: 3 });
  assert.equal(a.d.items.bread, 5, 'העבודה לא נעצרה');
  a.client.setOnline(true); await settle(120);
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { bread: 5 });
  assert.equal(a.state().status, 'saved');
});

test('"המשך אותה כאן": ההצעה מהשרת; אותה טיוטה בדיוק (מהטרנזקציה); הראשון — "עברה", לקריאה בלבד, לא כותב ולא שומר', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  const offer = b.state().offers.find(o => o.sessionId === 'r1');
  assert.ok(offer && offer.button && offer.deviceName === 'א');
  assert.deepEqual(a.state().offers, [], 'הטיוטה שלי לא מוצעת לי');
  const r = await b.h.take('r1'); await settle();
  assert.equal(r.ok, true);
  assert.deepEqual(b.d.items, { bread: 3 });
  assert.equal(doc(cloud, 'r1').deviceName, 'ב'); assert.equal(doc(cloud, 'r1').gen, 2);
  assert.equal(a.state().away.away, 'moved'); assert.equal(a.state().readOnly, true); assert.equal(a.state().canTakeBack, true);
  a.set('bread', 99); await settle();
  assert.equal(doc(cloud, 'r1').deviceName, 'ב', 'הקודם לא כותב');
  const f = await a.h.finish('r1', { items: a.d.items });
  assert.equal(f.ok, false); assert.equal(f.reason, 'moved');
  assert.equal(cloud.get(recPath('r1')), null);
});

test('"החזר אותה לכאן": הספירה העדכנית מהשני חוזרת, והמקומי (שהשתנה) נשמר בצד', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  b.set('milk', 7); await settle();
  a.d.items.local = 1; // שינוי מקומי שלא עבר (הטלפון היה "עברה")
  const r = await a.h.take('r1'); await settle();
  assert.equal(r.ok, true);
  assert.deepEqual(a.d.items, { bread: 3, milk: 7 });
  assert.equal(doc(cloud, 'r1').gen, 3); assert.equal(doc(cloud, 'r1').deviceName, 'א');
  assert.equal(b.state().away.away, 'moved');
  const side = a.debug().side;
  assert.equal(side.length, 1); assert.equal(side[0].reason, 'same'); assert.equal(JSON.parse(side[0].payload).items.local, 1);
});

test('שמירה סופית: רשומה אחת במזהה, עם savedBy; המסמך נסגר; בטלפון השני — "נשמרה", ו"נקה" מנקה רק את העותק', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  const f = await b.h.finish('r1', { items: b.d.items }); await settle();
  assert.equal(f.ok, true);
  const rec = cloud.get(recPath('r1'));
  assert.deepEqual(rec.items, { bread: 3 }); assert.equal(rec.savedBy.sessionId, 'r1'); assert.equal(rec.savedBy.gen, 2);
  const x = doc(cloud, 'r1'); assert.equal(x.state, 'saved'); assert.equal(x.openKey, null); assert.equal(x.payload, null);
  assert.equal(a.state().away.away, 'saved');
  assert.equal(a.h.clear().ok, true);
  assert.equal(a.d.sessionId, null); assert.deepEqual(a.debug().side, [], 'נשמרה — בלי עותק בצד');
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 3 }, 'הרשומה לא השתנתה');
  const again = await b.h.finish('r1', { items: {} });
  assert.equal(again.ok, false);
});

test('שני טלפונים לוחצים "המשך" יחד — רק אחד מחזיק; "שמור" ו"המשך" באותו רגע — רק אחד מצליח', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'), c = phone(cloud, 'ג'); [a, b, c].forEach(p => p.start()); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  // שתי הטרנזקציות קוראות לפני שאחת כותבת
  let release; cloud.commitGate = new Promise(r => { release = r; });
  const pb = b.h.take('r1'), pc = c.h.take('r1');
  await settle(); cloud.commitGate = null; release();
  const [rb, rc] = await Promise.all([pb, pc]); await settle();
  assert.equal([rb.ok, rc.ok].filter(Boolean).length, 1, 'אחד בלבד');
  const holder = rb.ok ? b : c, other = rb.ok ? c : b;
  assert.equal(doc(cloud, 'r1').deviceName, holder.name);
  assert.equal(other.d.sessionId, null, 'הטלפון שנכשל לא השתנה');
  assert.deepEqual(other.debug().side, []);
  // "שמור" אצל המחזיק ו"המשך" אצל א' באותו רגע
  cloud.commitGate = new Promise(r => { release = r; });
  const pf = holder.h.finish('r1', { items: holder.d.items }), pt = a.h.take('r1');
  await settle(); cloud.commitGate = null; release();
  const [f, t] = await Promise.all([pf, pt]); await settle();
  assert.equal([f.ok, t.ok].filter(Boolean).length, 1);
  assert.ok(!f.unknown && !t.unknown, 'התנגשות היא כשל ודאי — לא "בודק…"');
  if (f.ok) { assert.equal(doc(cloud, 'r1').state, 'saved'); assert.ok(cloud.get(recPath('r1'))); }
  else { assert.equal(doc(cloud, 'r1').deviceName, 'א'); assert.equal(cloud.get(recPath('r1')), null); }
  // ובלי שער: מי שלחץ שני — לוקח מהראשון, והראשון רואה "עברה" (לעולם לא שניים מחזיקים)
});

test('מטמון ישן: טלפון שהטיוטה עברה ממנו נפתח מחדש — לא כותב, לא שומר, ורואה "עברה" לפי השרת', async () => {
  const cloud = createCloud();
  const a1 = phone(cloud, 'א'), b = phone(cloud, 'ב'); a1.start(); b.start(); await settle();
  a1.newDraft('r1'); a1.set('bread', 3); await settle();
  a1.client.setOnline(false); // האפליקציה בא' נסגרה
  await b.h.take('r1'); await settle(); b.set('milk', 2); await settle();
  // א' נפתח שוב: אותו localStorage, אותו מטמון (שבו המסמך עוד "שלו")
  const a2 = phone(cloud, 'א', { storage: a1.storage, cache: a1.client.cache, draft: a1.d });
  a2.start(); a2.h.flush(); await settle(80);
  assert.equal(doc(cloud, 'r1').deviceName, 'ב', 'לא דרס');
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { bread: 3, milk: 2 });
  assert.equal(a2.state().away.away, 'moved');
  const f = await a2.h.finish('r1', { items: a2.d.items });
  assert.equal(f.ok, false);
  assert.equal(cloud.get(recPath('r1')), null);
});

test('בלי רשת: "המשך" — "אין חיבור" ושום דבר לא משתנה; "שמור" — "אין חיבור", הטיוטה נשארת ושום דבר לא נכתב אחר כך', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  b.newDraft('r2'); b.set('milk', 1); await settle();
  b.client.setOnline(false);
  const t = await b.h.take('r1');
  assert.equal(t.ok, false); assert.equal(t.reason, 'offline');
  assert.equal(b.d.sessionId, 'r2'); assert.deepEqual(b.debug().side, []);
  const f = await b.h.finish('r2', { items: b.d.items });
  assert.equal(f.reason, 'offline');
  b.client.setOnline(true); await settle(150);
  assert.equal(cloud.get(recPath('r2')), null, 'שום שמירה לא נוחתת מאוחר');
  assert.equal(b.d.sessionId, 'r2');
});

test('שמירה שנכשלה בא\' בלי רשת, "המשך" ושמירה בב\' — כשא\' חוזר לרשת, הרשומה של ב\' לא נדרסת', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false);
  assert.equal((await a.h.finish('r1', { items: { bread: 3 } })).reason, 'offline');
  await b.h.take('r1'); await settle(); b.set('bread', 4); await settle();
  assert.equal((await b.h.finish('r1', { items: b.d.items })).ok, true);
  a.client.setOnline(true); a.h.retry(); await settle(150);
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 4 });
  assert.equal(a.state().away.away, 'saved');
});

test('commit שהתשובה שלו אבדה: "המשך" — "בודק…" ואז מוחל; "שמור" — "בודק…", ואז הצלחה (בלי שמירה כפולה)', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.loseReplyAfterCommit = true;
  const t = await b.h.take('r1');
  cloud.loseReplyAfterCommit = false;
  assert.equal(t.unknown, true);
  assert.equal(b.state().checking, 'take'); assert.equal(b.state().readOnly, true);
  await settle(80);
  assert.equal(b.state().checking, null);
  assert.deepEqual(b.d.items, { bread: 3 }); assert.ok(b.notices.includes('take-done'));
  cloud.loseReplyAfterCommit = true;
  const f = await b.h.finish('r1', { items: b.d.items });
  cloud.loseReplyAfterCommit = false;
  assert.equal(f.unknown, true); assert.equal(b.state().readOnly, true);
  const again = await b.h.finish('r1', { items: b.d.items });
  assert.equal(again.ok, false); assert.equal(again.reason, 'busy', 'בזמן הבדיקה — לא שומרים שוב');
  await settle(80);
  assert.deepEqual(b.finished, ['r1']); assert.ok(b.notices.includes('finish-done'));
  assert.equal(b.d.sessionId, null);
  assert.equal(doc(cloud, 'r1').state, 'saved');
});

test('commit שנכתב אחרי תקרת הזמן — "לא ידוע", ומוכרע לפי השרת; commit תקוע — אחרי התקרה מוכרע "לא נשמרה" והעריכה חוזרת', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  cloud.commitDelayMs = 400; // אחרי תקרת השמירה (250)
  const f = await a.h.finish('r1', { items: a.d.items });
  cloud.commitDelayMs = 0;
  assert.equal(f.unknown, true);
  await settle(300);
  assert.deepEqual(a.finished, ['r1'], 'נשמרה — והאפליקציה מסיימת');
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 3 });
  // commit תקוע: לא נכתב לעולם
  a.newDraft('r2'); a.set('milk', 1); await settle();
  cloud.hangCommits = true;
  const g = await a.h.finish('r2', { items: a.d.items });
  cloud.hangCommits = false;
  assert.equal(g.unknown, true);
  await settle(600);
  assert.equal(a.state().checking, null); assert.equal(a.state().readOnly, false);
  assert.ok(a.notices.includes('finish-not-saved'));
  assert.equal(cloud.get(recPath('r2')), null);
  assert.equal((await a.h.finish('r2', { items: a.d.items })).ok, true, 'אפשר לשמור שוב');
});

test('ביטול: בטלפון השני "בוטלה" (לא "נשמרה"); ביטול בלי רשת נסגר כשחוזרת; ביטול של טיוטה שמישהו כבר לקח — לא סוגר', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  b.h.cancel(); b.h.clear(); await settle(80);
  assert.equal(doc(cloud, 'r1').state, 'canceled');
  assert.equal(a.state().away.away, 'canceled');
  assert.equal(a.h.clear().ok, true);
  assert.equal(a.debug().side[0].reason, 'canceled', 'בוטלה — עותק בצד לפני הניקוי');
  // ביטול בלי רשת
  a.newDraft('r2'); a.set('x', 1); await settle();
  a.client.setOnline(false); a.h.cancel(); a.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; a.h.changed();
  await settle();
  assert.equal(doc(cloud, 'r2').state, 'open');
  a.client.setOnline(true); a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r2').state, 'canceled');
  // ביטול אחרי שמישהו לקח
  a.newDraft('r3'); a.set('y', 1); await settle();
  a.client.setOnline(false); a.h.cancel(); a.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; a.h.changed();
  await b.h.take('r3'); await settle();
  a.client.setOnline(true); a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r3').state, 'open'); assert.equal(doc(cloud, 'r3').deviceName, 'ב');
});

test('הצעה בזמן קריאה: הכפתור מופיע כשהקריאה נגמרת, או אחרי החלון', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב', { maxScanMs: 200 }); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.d.scan = true; a.h.changed(); await settle();
  assert.equal(b.state().offers[0].button, false);
  a.d.scan = false; a.h.changed(); await settle();
  assert.equal(b.state().offers[0].button, true, 'הקריאה נגמרה');
  a.d.scan = true; a.h.changed(); await settle();
  assert.equal(b.state().offers[0].button, false);
  a.client.setOnline(false); // המחזיק נעלם באמצע הקריאה — בלי "דופק", החלון נגמר
  await settle(260);
  assert.equal(b.state().offers[0].button, true, 'עבר החלון');
});

test('גדולה מדי (עברית, לפי בתים): tooBig, בלי payload; בטלפון השני אין כפתור, ו"המשך" נעצר', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.d.big = 'ש'.repeat(500000); a.set('bread', 3); await settle();
  const x = doc(cloud, 'r1');
  assert.equal(x.tooBig, true); assert.equal(x.payload, null);
  assert.equal(b.state().offers[0].button, false); assert.equal(b.state().offers[0].tooBig, true);
  const t = await b.h.take('r1');
  assert.equal(t.ok, false); assert.equal(b.d.sessionId, null);
});

test('עותקים בצד: טיוטה אחרת נשמרת בצד ונפתחת; "other" לא יוצא בשקט — כשאין מקום ההעברה נעצרת; localStorage מלא — נעצרת', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  for (const id of ['s1', 's2', 's3', 's4']) {
    a.newDraft(id); a.set('k', 1); await settle();
    b.newDraft('mine_' + id); b.set('m', 1); await settle();
    const r = await b.h.take(id); await settle();
    if (id !== 's4') { assert.equal(r.ok, true, id); }
    else { assert.equal(r.ok, false); assert.equal(r.reason, 'side-full'); assert.equal(b.d.sessionId, 'mine_s4', 'שום דבר לא השתנה'); }
    a.h.clear(); await settle();
  }
  const side = b.debug().side;
  assert.deepEqual(side.map(x => x.sessionId).sort(), ['mine_s1', 'mine_s2', 'mine_s3']);
  assert.ok(side.every(x => x.reason === 'other'));
  // פתיחה של עותק בצד: מה שפתוח עובר לצד, והעותק יוצא מהרשימה
  b.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; b.h.changed();
  assert.equal(b.state().side.length, 3);
  assert.equal(b.h.openSide('mine_s2').ok, true); await settle();
  assert.equal(b.d.sessionId, 'mine_s2'); assert.equal(b.state().readOnly, false, 'שלי — אפשר לעבוד');
  assert.equal(b.debug().side.length, 2);
  // localStorage מלא
  const c = phone(cloud, 'ג'); c.start(); await settle();
  c.newDraft('c1'); c.set('z', 1); await settle();
  c.storage.full = true;
  const r = await c.h.take('s4');
  assert.equal(r.ok, false); assert.equal(r.reason, 'storage'); assert.equal(c.d.sessionId, 'c1');
});

test('מעבר גרסה: שני טלפונים עם אותה טיוטה ישנה — אף אחד לא נתבע בפתיחה; העורך הראשון מחזיק; "החזר" בשני שומר בצד', async () => {
  const cloud = createCloud();
  const legacy = { sessionId: 'old1', recordId: 'old1', items: { bread: 2 }, scan: false, expected: null, big: '' };
  const a = phone(cloud, 'א', { draft: legacy }), b = phone(cloud, 'ב', { draft: { ...legacy, items: { bread: 5 } } });
  a.start(); a.h.flush(); await settle(); b.start(); b.h.flush(); await settle();
  assert.equal(doc(cloud, 'old1'), null, 'פתיחה לא תובעת');
  assert.equal(a.state().away, null); assert.equal(b.state().away, null);
  b.set('bread', 6, true); await settle(); // עריכה של המשתמש בב'
  assert.equal(doc(cloud, 'old1').deviceName, 'ב');
  a.set('bread', 9, false); await settle(); // שמירה אוטומטית בא' — לא תובעת
  assert.equal(doc(cloud, 'old1').deviceName, 'ב');
  assert.equal(a.state().away.away, 'moved');
  await a.h.take('old1'); await settle();
  assert.equal(a.d.items.bread, 6);
  assert.equal(a.debug().side[0].reason, 'same'); assert.equal(JSON.parse(a.debug().side[0].payload).items.bread, 9);
});

test('עריכה של רשומה שמורה: מושב חדש לכל עריכה; שתי עריכות רצופות נשמרות; שינוי ברשומה מאז ההתחלה עוצר; אפשר להעביר עריכה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  assert.equal((await a.h.finish('r1', { items: a.d.items, n: 1 })).ok, true); a.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; a.h.changed();
  let rec = cloud.get(recPath('r1'));
  a.newDraft('edit_r1_a', rec, 'r1'); a.set('paper', 1); await settle();
  assert.equal(doc(cloud, 'edit_r1_a').editsExisting, true);
  assert.equal(a.state().readOnly, false, 'המסמך הסגור של השמירה המקורית לא נוגע');
  assert.equal((await a.h.finish('r1', { items: a.d.items, n: 2 })).ok, true);
  rec = cloud.get(recPath('r1')); assert.equal(rec.n, 2);
  // עריכה שנייה, מועברת לב'
  a.newDraft('edit_r1_b', rec, 'r1'); a.set('paper', 2); await settle();
  assert.equal((await b.h.take('edit_r1_b')).ok, true); await settle();
  assert.equal((await b.h.finish('r1', { items: b.d.items, n: 3 })).ok, true);
  assert.equal(cloud.get(recPath('r1')).n, 3);
  // רשומה שהשתנתה מאז ההתחלה
  a.d = { sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' }; a.h.changed();
  a.newDraft('edit_r1_c', cloud.get(recPath('r1')), 'r1'); a.set('paper', 3); await settle();
  cloud.put(recPath('r1'), { ...cloud.get(recPath('r1')), linked: true });
  const f = await a.h.finish('r1', { items: a.d.items, n: 4 });
  assert.equal(f.ok, false); assert.equal(f.reason, 'changed');
  assert.equal(cloud.get(recPath('r1')).n, 3);
});

test('רשומה שכבר נשמרה (טיוטה ישנה שנשמרה ממקום אחר) — לא נגבית ולא נשמרת שוב', async () => {
  const cloud = createCloud();
  cloud.put(recPath('r9'), { items: { a: 1 } });
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r9'); a.set('a', 2); await settle();
  assert.equal(doc(cloud, 'r9'), null);
  assert.equal(a.state().away.away, 'saved');
  const f = await a.h.finish('r9', { items: a.d.items });
  assert.equal(f.ok, false);
  assert.deepEqual(cloud.get(recPath('r9')).items, { a: 1 });
});

test('השרת חוסם (permission-denied) — "חסום", בלי ניסיון חוזר אינסופי; העבודה ממשיכה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  cloud.reject = 'permission-denied';
  a.newDraft('r1'); a.set('bread', 1); await settle(200);
  assert.equal(a.state().status, 'blocked');
  const n = cloud.transactions; await settle(250);
  assert.ok(cloud.transactions - n <= 1, 'בלי לולאה');
  assert.equal(a.d.items.bread, 1);
});

test('אופליין ארוך עם הרבה שינויים — כשחוזרת הרשת נכתב רק המצב האחרון, בטרנזקציות מעטות', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.set('n', 0); await settle();
  a.client.setOnline(false);
  for (let i = 1; i <= 40; i++) { a.set('n', i); await settle(2); }
  const before = cloud.transactions;
  a.client.setOnline(true); a.h.retry(); await settle(150);
  assert.equal(JSON.parse(doc(cloud, 'r1').payload).items.n, 40);
  assert.ok(cloud.transactions - before <= 3, 'לא נערם תור של כתיבות');
});

test('שתי אפליקציות על אותו שורש — לא רואות זו את זו; deviceId אקראי גם כש-localStorage מלא', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  const ctx = vm.createContext({ console, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout }); vm.runInContext(source, ctx);
  const client = cloud.client(); const states = [];
  const other = ctx.DraftHandoff.create({ app: 'other', kind: 'receiving', prefix: 'oo', db: client.db, fs: client.fs, rootPath: ['root'], recordCollection: 'records',
    storage: memoryStorage(), isOnline: client.isOnline, lifecycle: false, timeouts: T, adapter: { getDraft: () => null, onChange: s => states.push(s) } });
  alive.push(other); other.start(); a.newDraft('r1'); a.set('x', 1); await settle();
  assert.equal(other.state().offers.length, 0);
  const full = memoryStorage(); full.full = true;
  const p1 = phone(cloud, 'ד', { storage: full }), p2 = phone(cloud, 'ה', { storage: (() => { const s = memoryStorage(); s.full = true; return s; })() });
  assert.notEqual(p1.h.deviceId(), p2.h.deviceId());
  assert.ok(!/unknown/.test(p1.h.deviceId()));
});


const emptyDraft = () => ({ sessionId: null, recordId: null, items: {}, scan: false, expected: null, big: '' });

test('"שמור" בזמן שגיבוי בדרך — מחכה לו ונשמר (לא "בודק…"); state() זול — בלי לבנות את ה-payload', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  let release; cloud.commitGate = new Promise(r => { release = r; });
  a.set('bread', 4); await settle(); // הגיבוי קרא וממתין ל-commit
  const pf = a.h.finish('r1', { items: { bread: 4 } });
  await settle(); cloud.commitGate = null; release();
  const f = await pf; await settle();
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.deepEqual(cloud.get(recPath('r1')).items, { bread: 4 });
  // state() / readOnly בכל לחיצה — בלי payload
  a.newDraft('r2'); a.set('x', 1); await settle();
  const before = a.payloadCalls;
  for (let i = 0; i < 50; i++) a.h.state();
  assert.equal(a.payloadCalls, before, 'state() לא בונה payload');
});

test('ביטול: הקליטה שבוטלה לא מוצעת בחזרה (גם כשהסגירה עוד לא נשלחה), ו"המשך" עליה נדחה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false);
  a.h.cancel({ paperIds: ['p1'] }); a.d = emptyDraft(); a.h.changed(); await settle();
  assert.deepEqual(a.state().offers, [], 'לא מוצעת');
  a.client.setOnline(true);
  const t = await a.h.take('r1');
  assert.equal(t.ok, false); assert.equal(t.reason, 'canceled');
  a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r1').state, 'canceled');
  assert.deepEqual(j(a.closed), [{ paperIds: ['p1'] }], 'הניירות יוצאים רק אחרי שהענן אישר');
});

test('ביטול של קליטה שטלפון אחר כבר לקח — לא נסגרת, הניירות לא נמחקים, והמשתמש יודע', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false); // א' לא שמע שהקליטה עברה
  await b.h.take('r1'); await settle();
  a.h.cancel({ paperIds: ['p1'] }); a.d = emptyDraft(); a.h.changed();
  a.client.setOnline(true); a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r1').state, 'open'); assert.equal(doc(cloud, 'r1').deviceName, 'ב');
  assert.deepEqual(a.closed, []);
  assert.ok(a.notices.includes('cancel-declined'));
});

test('טיוטה מלפני המנגנון שבוטלה — הביטול מקומי בלבד (לא סוגר עותק שאולי פתוח בטלפון אחר)', async () => {
  const cloud = createCloud();
  const legacy = { sessionId: 'old1', recordId: 'old1', items: { bread: 2 }, scan: false, expected: null, big: '' };
  const a = phone(cloud, 'א', { draft: legacy }); a.start(); await settle();
  a.h.cancel({ paperIds: ['p9'] }); a.d = emptyDraft(); a.h.changed(); a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'old1'), null, 'לא נוצר מסמך "בוטלה"');
  assert.deepEqual(j(a.closed), [{ paperIds: ['p9'] }], 'מה שהמשתמש אישר בביטול (הניירות) — כן יוצא');
  // ולחיצה בלי שינוי לא תובעת
  const b = phone(cloud, 'ב', { draft: legacy }); b.start(); await settle();
  b.h.changed({ user: true }); await settle();
  assert.equal(doc(cloud, 'old1'), null);
});

test('טיוטה שהתרוקנה בלי שמירה או ביטול — יורדת מההצעות ("חונה"), וחוזרת כשממשיכים בה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  assert.equal(b.state().offers.length, 1);
  const keep = a.d; a.d = emptyDraft(); a.h.changed(); a.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r1').state, 'open'); assert.equal(doc(cloud, 'r1').openKey, null, 'חונה — לא מבוטלת');
  assert.equal(b.state().offers.length, 0, 'לא מוצעת');
  a.d = keep; a.set('bread', 5); await settle(80);
  assert.equal(doc(cloud, 'r1').openKey, 'test:receiving');
  assert.equal(b.state().offers.length, 1, 'חזרה');
});

test('קריאה בתשלום אצל המחזיק — "החזר" לא מוצע, ו"המשך" ישיר נדחה לפי השרת; קריאה בטיוטה שפתוחה כאן — "המשך" אחרת נדחה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  b.d.scan = true; b.h.changed(); await settle();
  const st = a.state();
  assert.equal(st.away.away, 'moved'); assert.equal(st.canTakeBack, false); assert.equal(st.scanThere, true);
  const t = await a.h.take('r1');
  assert.equal(t.ok, false); assert.equal(t.reason, 'scan-running');
  assert.equal(doc(cloud, 'r1').deviceName, 'ב');
  // טלפון ג' שלא ראה את ההצעה — גם נדחה
  const c = phone(cloud, 'ג'); c.start(); await settle();
  assert.equal((await c.h.take('r1')).reason, 'scan-running');
  // קריאה רצה בטיוטה שפתוחה כאן — לא מחליפים אותה
  b.d.scan = false; b.h.changed(); await settle();
  c.newDraft('c1'); c.d.scan = true; c.h.changed(); await settle();
  assert.equal((await c.h.take('r1')).reason, 'scan-running-here');
});

test('קריאה ארוכה עם "דופק" — החלון בטלפון השני מתחיל מחדש בכל דופק, ולא נפתח באמצע', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב', { maxScanMs: 150 }); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.d.scan = true; a.h.changed(); await settle();
  for (let i = 0; i < 5; i++) { await settle(50); assert.equal(b.state().offers[0].button, false, 'עדיין רצה — ' + i); }
  a.client.setOnline(false); // המחזיק נעלם באמצע (סוללה) — אחרי החלון הכפתור חוזר
  await settle(300);
  assert.equal(b.state().offers[0].button, true);
});

test('עריכה של רשומה ששוחזרה (יש בה שדה id) — נשמרת; רשומה שנשמרה ממקום אחר ("exists") — "נשמרה" + "נקה" בלי עותק', async () => {
  const cloud = createCloud();
  cloud.put(recPath('r1'), { id: 'r1', items: { a: 1 }, n: 1 });
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('edit_r1_x', { items: { a: 1 }, n: 1 }, 'r1'); a.set('paper', 1); await settle();
  assert.equal((await a.h.finish('r1', { items: { a: 1 }, n: 2 })).ok, true);
  assert.equal(cloud.get(recPath('r1')).n, 2);
  // "exists"
  a.d = emptyDraft(); a.h.changed();
  a.newDraft('r5'); a.set('b', 1); await settle();
  cloud.put(recPath('r5'), { items: { b: 9 } });
  const f = await a.h.finish('r5', { items: { b: 1 } });
  assert.equal(f.reason, 'exists');
  assert.equal(a.state().away.away, 'saved'); assert.equal(a.state().readOnly, true);
  assert.equal(a.h.clear().ok, true); assert.deepEqual(a.debug().side, []);
});

test('עותקים בצד: של רשומה שכבר נשמרה — יורדים לבד; הגרסה הקודמת של אותה טיוטה — גלויה כשהיא פתוחה, ואפשר להחליף אליה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  a.client.setOnline(false); a.set('bread', 9); await settle(); // ספירה בא' שלא הגיעה לענן
  await b.h.take('r1'); await settle(); b.set('bread', 7); await settle();
  a.client.setOnline(true); await settle(80);
  assert.equal(a.state().away.localAhead, true, 'הטלפון יודע שיש בו ספירה שלא הגיעה');
  await a.h.take('r1'); await settle();
  assert.equal(a.d.items.bread, 7);
  let st = a.state();
  assert.equal(st.side.length, 1); assert.equal(st.side[0].sessionId, 'r1', 'הגרסה הקודמת גלויה');
  assert.equal(a.h.openSide('r1').ok, true); await settle();
  assert.equal(a.d.items.bread, 9, 'הוחלף לגרסה המקומית');
  assert.equal(JSON.parse(a.debug().side[0].payload).items.bread, 7, 'והשנייה בצד');
  // רשומה שנשמרה — העותק יורד
  cloud.put(recPath('r1'), { items: {} }); a.h.tidy();
  assert.deepEqual(a.state().side, []);
});

test('גדולה מדי — הסטטוס אומר את זה (לא "מגובה")', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'); a.start(); await settle();
  a.newDraft('r1'); a.d.big = 'ש'.repeat(500000); a.set('bread', 3); await settle();
  assert.equal(a.state().status, 'too-big'); assert.equal(a.state().tooBig, true);
});

test('מניחים את הטלפון (pagehide / מעבר לרקע) — הגיבוי יוצא מיד, בלי לחכות להשהיה', async () => {
  const cloud = createCloud();
  const client = cloud.client();
  const listeners = {}, docListeners = {};
  const ctx = vm.createContext({ console, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout,
    addEventListener: (t, fn) => { listeners[t] = fn; },
    document: { visibilityState: 'visible', addEventListener: (t, fn) => { docListeners[t] = fn; } } });
  vm.runInContext(source, ctx);
  let d = { sessionId: null, items: {} };
  const h = ctx.DraftHandoff.create({ app: 'test', kind: 'receiving', prefix: 'tt', db: client.db, fs: client.fs, rootPath: ['root'], recordCollection: 'records',
    storage: memoryStorage(), isOnline: client.isOnline, timeouts: { ...T, debounce: 60000 },
    adapter: { getDraft: () => ({ sessionId: d.sessionId, recordId: d.sessionId, empty: !d.sessionId }),
      getPayload: () => ({ payload: JSON.stringify({ v: 1, sessionId: d.sessionId, items: d.items }), summary: {} }) } });
  alive.push(h); h.start(); await settle();
  d = { sessionId: 'r1', items: { a: 1 } }; h.changed({ user: true }); await settle();
  assert.equal(doc(cloud, 'r1'), null, 'ההשהיה ארוכה — עוד לא');
  listeners.pagehide(); await settle();
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { a: 1 }, 'pagehide — מיד');
  d.items.a = 2; h.changed(); ctx.document.visibilityState = 'hidden'; docListeners.visibilitychange(); await settle();
  assert.deepEqual(JSON.parse(doc(cloud, 'r1').payload).items, { a: 2 }, 'מעבר לרקע — מיד');
});


test('מעבר רגיל: הטלפון הראשון לא שינה כלום אחרי המעבר — לא "יש כאן ספירה שלא הגיעה", ו"החזר" לא שומר בצד גרסה ישנה', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle(); b.set('bread', 9); await settle();
  assert.equal(a.state().away.localAhead, false);
  await a.h.take('r1'); await settle();
  assert.equal(a.d.items.bread, 9);
  assert.deepEqual(a.debug().side, [], 'בלי "גרסה קודמת" מטעה');
});

test('טיוטה שהתרוקנה אחרי פתיחה מחדש (בלי רשת) — גם אז יורדת מההצעות; "כבר נשמרה" ממקום אחר — המסמך יורד מההצעות', async () => {
  const cloud = createCloud();
  const a1 = phone(cloud, 'א'), b = phone(cloud, 'ב'); a1.start(); b.start(); await settle();
  a1.newDraft('r1'); a1.set('bread', 3); await settle();
  a1.client.setOnline(false); a1.h.stop();
  const a2 = phone(cloud, 'א', { storage: a1.storage, cache: a1.client.cache, draft: a1.d });
  a2.client.setOnline(false); a2.start(); await settle();
  a2.d = emptyDraft(); a2.h.changed();
  a2.client.setOnline(true); a2.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r1').openKey, null, 'חונה');
  assert.equal(b.state().offers.length, 0);
  // exists
  a2.newDraft('r5'); a2.set('x', 1); await settle();
  cloud.put(recPath('r5'), { items: { x: 4 } });
  assert.equal((await a2.h.finish('r5', { items: { x: 1 } })).reason, 'exists');
  a2.h.retry(); await settle(120);
  assert.equal(doc(cloud, 'r5').openKey, null);
  a2.h.clear(); await settle();
  assert.deepEqual(a2.state().offers, [], 'לא מוצעת לעצמי');
});

test('עותק בצד של קליטה שבוטלה — נפתח כקליטה חדשה (מזהה חדש) ואפשר לשמור אותה; "מחק את העותק"', async () => {
  const cloud = createCloud();
  const a = phone(cloud, 'א'), b = phone(cloud, 'ב'); a.start(); b.start(); await settle();
  a.newDraft('r1'); a.set('bread', 3); await settle();
  await b.h.take('r1'); await settle();
  b.h.cancel(); b.d = emptyDraft(); b.h.changed(); b.h.retry(); await settle(120);
  assert.equal(a.state().away.away, 'canceled');
  a.h.clear(); await settle();
  assert.equal(a.state().side[0].canOpen, false, 'בלי reviveDraft — לא נפתח');
  // מתאם שיודע לפתוח כקליטה חדשה
  const c = phone(cloud, 'ג'); c.start(); await settle();
  c.h.importSide({ sessionId: 'old', payload: JSON.stringify({ v: 1, sessionId: 'old', items: { milk: 2 } }), reason: 'canceled' });
  assert.equal(c.h.dropSide('old').ok, true); assert.deepEqual(c.debug().side, []);
});
