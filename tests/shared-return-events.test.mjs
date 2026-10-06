// בדיקות סינתטיות למנגנון עצמו: לקוחות מבודדים וענן משותף, בלי רשת אמיתית.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createCloud, memoryStorage, tick } from './shared-return-fake.mjs';

const localPath = new URL('./shared-return-events.js', import.meta.url);
const sourcePath = fs.existsSync(localPath) ? localPath : new URL('../shared-return-events.js', import.meta.url);
const source = () => fs.readFileSync(sourcePath, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const ROOT = 'artifacts/return-test/public/data';
const LEDGER = ROOT + '/drafts/return_events_v1';
const LEGACY = ROOT + '/drafts/returns';
const PRODUCT = { productId: 'synthetic-milk', name: 'מוצר בדיקה', barcode: '0000001' };
const records = cloud => cloud.paths('/returns/').map(path => ({ id: path.split('/').at(-1), ...cloud.get(path) }));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

function fixture(t) {
  const cloud = createCloud(); const phones = []; let uuid = 0;
  t.after(() => phones.forEach(phone => phone.module.stop()));
  function phone(options = {}) {
    const id = options.id || 'phone-' + (phones.length + 1);
    const storage = options.storage || memoryStorage();
    const client = cloud.client(options.client);
    class DeviceDate extends Date { static now() { return Date.now() + (options.clockOffset || 0); } }
    const context = vm.createContext({ console, Date: DeviceDate, JSON, Promise, Math, TextEncoder, TextDecoder,
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      navigator: { get onLine() { return client.isOnline(); } },
      crypto: { randomUUID: () => id + '-id-' + (++uuid) },
      addEventListener() {}, removeEventListener() {} });
    vm.runInContext(source(), context, { filename: fileURLToPath(sourcePath) });
    const ref = client.fs.doc(client.db, ...LEDGER.split('/'));
    const legacyRef = client.fs.doc(client.db, ...LEGACY.split('/'));
    const changes = [];
    const module = context.SharedReturnEvents.create({ app: 'synthetic', prefix: 'ts', storage, deviceId: id,
      slots: options.slots || ['weekly'], db: client.db, fs: client.fs, ref, legacyRef,
      recordRef: recordId => client.fs.doc(client.db, ...ROOT.split('/'), 'returns', recordId),
      legacy: options.legacy || (async (tx, data) => ({ slots: data?.slots || {}, writes: [] })),
      online: client.isOnline,
      timers: { set: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clear: clearTimeout },
      timeouts: { write: 100, transaction: 200, retry: 1000 },
      onChange: (view, state) => changes.push({ view: clone(view), state: clone(state) })
    });
    const result = { id, storage, client, module, ref, legacyRef, changes,
      async start() { const out = await module.start(); await settle(); return out; },
      view() { return clone(module.view()); },
      items(slot = 'weekly') { return clone(module.view().slots[slot].items); },
      qty(productId = PRODUCT.productId, slot = 'weekly') { return Number(module.view().slots[slot].items.find(item => item.productId === productId)?.qty || 0); },
      add(qty = 1, product = PRODUCT, slot = 'weekly') {
        const value = clone(module.view().slots[slot]);
        const item = value.items.find(row => row.productId === product.productId);
        if (item) item.qty += qty; else value.items.push({ ...product, qty });
        return module.change(slot, value);
      },
      async flush() { const out = await module.flush(); await settle(); return out; },
      finish(options = {}, slot = 'weekly') {
        return module.finish(slot, value => ({ items: clone(value.items), date: value.date || '', note: value.note || '', synthetic: true }), options);
      }
    };
    phones.push(result); return result;
  }
  return { cloud, phone };
}

test('שתי סריקות משני טלפונים באותה שנייה ועל אותו מוצר מצטברות', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]);
  assert.equal(a.add(1), true); assert.equal(b.add(1), true);
  await Promise.all([a.flush(), b.flush()]);
  assert.equal(a.qty(), 2); assert.equal(b.qty(), 2);
  const eventWrites = cloud.writes.filter(write => write.kind === 'write');
  assert.ok(eventWrites.length >= 2);
  for (const write of eventWrites) { assert.equal(write.op, 'update'); assert.ok(Object.keys(write.data).every(key => key.startsWith('events.'))); }
});

test('סריקה בלי רשת נשמרת מקומית ומתאחדת עם סריקה מקוונת אחרי התחברות', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.client.setOnline(false);
  assert.equal(a.add(3), true); b.add(2); await b.flush();
  assert.equal(a.qty(), 3); assert.equal(b.qty(), 2);
  assert.ok(a.storage.getItem('ts_return_events_v1').includes('synthetic-milk'));
  a.client.setOnline(true); await a.flush();
  assert.equal(a.qty(), 5); assert.equal(b.qty(), 5);
});

test('שעון מקדים או מאחר בשעות אינו משנה את סכום האירועים', async t => {
  const { phone } = fixture(t); const a = phone({ clockOffset: 36e6 }), b = phone({ clockOffset: -36e6 });
  await Promise.all([a.start(), b.start()]);
  a.add(7); b.add(4); await Promise.all([a.flush(), b.flush()]);
  assert.equal(a.qty(), 11); assert.equal(b.qty(), 11);
  a.module.change('weekly', { ...a.view().slots.weekly, items: [{ ...PRODUCT, qty: 9 }] }); await a.flush();
  assert.equal(a.qty(), 9); assert.equal(b.qty(), 9);
});

test('עדכון כמות, הסרה וביטול הסרה נשמרים כאירועים ומופיעים בשני טלפונים', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(9); await a.flush();
  a.module.change('weekly', { items: [{ ...PRODUCT, qty: 4 }], date: '2026-10-06', note: 'בדיקה' }); await a.flush();
  assert.equal(b.qty(), 4); assert.equal(b.view().slots.weekly.date, '2026-10-06');
  a.module.change('weekly', { items: [], date: '2026-10-06', note: 'בדיקה' }); await a.flush(); assert.equal(b.qty(), 0);
  a.add(4); await a.flush(); assert.equal(b.qty(), 4);
});

test('שליחה אטומית כוללת סריקה שהגיעה אחרי פתיחת הסיכום', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  const epoch = a.module.epoch('weekly'); b.add(3); await b.flush();
  const sent = await a.finish({ expectedEpoch: epoch }); await settle();
  assert.equal(sent.ok, true); assert.equal(records(cloud).length, 1);
  assert.equal(records(cloud)[0].items[0].qty, 5); assert.equal(a.qty(), 0); assert.equal(b.qty(), 0);
});

test('סריקה אחרי השליחה נכנסת לטיוטה הבאה ואינה משנה את הרשומה שנשלחה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  const before = records(cloud); b.add(1); await b.flush();
  assert.equal(a.qty(), 1); assert.equal(b.qty(), 1); assert.deepEqual(records(cloud), before);
});

test('שני טלפונים שולחים אותו דור: נוצרת רשומה אחת בלבד', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(5); await a.flush();
  const expectedEpoch = a.module.epoch('weekly');
  let release; cloud.commitGate = new Promise(resolve => { release = resolve; });
  const first = a.finish({ expectedEpoch }), second = b.finish({ expectedEpoch });
  await settle(); cloud.commitGate = null; release();
  const results = await Promise.all([first, second]); await settle();
  assert.equal(records(cloud).length, 1); assert.equal(records(cloud)[0].items[0].qty, 5);
  assert.equal(results.filter(result => result.ok && !result.already).length, 1);
});

test('לחיצת שליחה ישנה אינה שולחת אירוע שהגיע לדור הבא', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  const expectedEpoch = a.module.epoch('weekly'); await a.finish({ expectedEpoch }); await settle();
  b.add(1); await b.flush(); const oldClick = await b.finish({ expectedEpoch }); await settle();
  assert.equal(records(cloud).length, 1); assert.equal(b.qty(), 1); assert.ok(oldClick.already || !oldClick.ok);
});

test('אירוע ממתין מטלפון שהיה בלי רשת בעת השליחה מגיע לטיוטה הבאה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  b.client.setOnline(false); b.add(3);
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  b.client.setOnline(true); await b.flush();
  assert.equal(records(cloud)[0].items[0].qty, 2); assert.equal(a.qty(), 3); assert.equal(b.qty(), 3);
});

test('כתיבה חוזרת של אירוע שנשלח אינה מחזירה אותו לטיוטה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  const eventWrite = cloud.writes.find(write => write.kind === 'write' && Object.keys(write.data).some(key => key.startsWith('events.')));
  assert.ok(eventWrite); await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  await a.client.fs.updateDoc(a.ref, eventWrite.data); await settle();
  assert.equal(a.qty(), 0); assert.equal(records(cloud).length, 1);
  const next = await a.finish({ expectedEpoch: a.module.epoch('weekly') });
  assert.equal(records(cloud).length, 1); assert.ok(next.empty || !next.ok || next.already);
});

test('פתיחה עם מטמון ישן אינה משיבה אירועים שכבר נשלחו', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(4); await a.flush();
  const oldCache = new Map([[LEDGER, cloud.get(LEDGER)]]); const oldStorage = new Map(a.storage.map);
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  const b = phone({ storage: memoryStorage(oldStorage), client: { cache: oldCache } }); await b.start();
  b.add(1); await b.flush(); assert.equal(b.qty(), 1); assert.equal(a.qty(), 1); assert.equal(records(cloud).length, 1);
});

test('מטמון שהתיישן אינו מחזיר אירוע אחרי שכבר הגיע אישור שליחה מהשרת', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(1); await a.flush();
  const old = cloud.get(LEDGER); await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  a.client.emitCache(LEDGER, old); await settle(); assert.equal(a.qty(), 0);
});

test('אירוע נשאר ממתין עד אישור שרת, וממשיך אחרי הפעלה מחדש ללא כפילות', async t => {
  const { phone } = fixture(t); const a = phone(); await a.start(); a.client.setOnline(false); a.add(3);
  const stored = clone(JSON.parse(a.storage.getItem('ts_return_events_v1')));
  assert.ok(Object.keys(stored.pending).length > 0); a.module.stop();
  const b = phone({ id: a.id, storage: a.storage }); await b.start(); await b.flush(); assert.equal(b.qty(), 3);
  assert.equal(Object.keys(JSON.parse(b.storage.getItem('ts_return_events_v1')).pending).length, 0);
});

test('localStorage מלא אינו מאבד את האירועים שכבר נשמרו', async t => {
  const { phone } = fixture(t); const a = phone(); await a.start(); a.client.setOnline(false); a.add(2);
  const before = a.storage.getItem('ts_return_events_v1'); a.storage.full = true;
  assert.equal(a.add(1), false); assert.equal(a.storage.getItem('ts_return_events_v1'), before); assert.equal(a.qty(), 2);
});

test('שני טלפונים ממירים אותה טיוטה ישנה פעם אחת בלבד', async t => {
  const { cloud, phone } = fixture(t);
  cloud.put(LEGACY, { slots: { weekly: { draftId: 'old-synthetic', items: [{ ...PRODUCT, qty: 6 }], date: '2026-10-05', note: 'ישן' } } });
  const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  assert.equal(a.qty(), 6); assert.equal(b.qty(), 6);
  a.add(1); b.add(1); await Promise.all([a.flush(), b.flush()]); assert.equal(a.qty(), 8); assert.equal(b.qty(), 8);
});

test('כתיבה ישנה לכל מסמך הטיוטה אינה מוחקת אירועים חדשים', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(3); await a.flush();
  cloud.put(LEGACY, { items: [{ ...PRODUCT, qty: 99 }], updatedAt: 9999999999999 }); await settle();
  assert.equal(a.qty(), 3); assert.equal(a.view().slots.weekly.items.length, 1);
});

test('תשובת שליחה שאבדה אינה מאפשרת לשמור את אותה החזרה פעמיים', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  const expectedEpoch = a.module.epoch('weekly'); cloud.loseReplyAfterCommit = true;
  await a.finish({ expectedEpoch }); cloud.loseReplyAfterCommit = false; await settle();
  await a.finish({ expectedEpoch }); await settle(); assert.equal(records(cloud).length, 1); assert.equal(a.qty(), 0);
});

test('אירוע שנכנס בין קריאת הטרנזקציה לכתיבה נכלל לאחר retry', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  let raced = false;
  cloud.beforeCommit = async ({ operations }) => {
    if (!raced && operations.some(operation => operation.path.includes('/returns/'))) { raced = true; b.add(3); await b.flush(); }
  };
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  assert.ok(raced); assert.ok(cloud.transactionRetries > 0); assert.equal(records(cloud)[0].items[0].qty, 5);
});

test('רשימות שבועית ויומית נשארות מופרדות בעת סריקה ושליחה', async t => {
  const { cloud, phone } = fixture(t); const a = phone({ slots: ['weekly', 'daily'] }), b = phone({ slots: ['weekly', 'daily'] });
  await Promise.all([a.start(), b.start()]); a.add(2); b.add(7, PRODUCT, 'daily'); await Promise.all([a.flush(), b.flush()]);
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  assert.equal(records(cloud)[0].items[0].qty, 2); assert.equal(b.qty(), 0); assert.equal(b.qty(PRODUCT.productId, 'daily'), 7);
});

test('פעולת העברה מתעודה מוסיפה אירועים ומעדכנת את התעודה אטומית ופעם אחת', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  const original = ROOT + '/returns/synthetic-original'; cloud.put(original, { synthetic: true, carried: false });
  const run = async current => {
    const ref = current.client.fs.doc(current.client.db, ...original.split('/'));
    return current.module.mutate([ref], async (snaps, view) => ({
      changes: { weekly: { ...view.slots.weekly, items: [{ ...PRODUCT, qty: 3 }] } },
      writes: [{ op: 'update', ref, data: { carried: true } }], result: { units: 3 }
    }), { key: 'carry-synthetic-original' });
  };
  const result = await run(a); await settle(); assert.equal(result.ok, true);
  await run(b); await settle(); assert.equal(a.qty(), 3); assert.equal(b.qty(), 3); assert.equal(cloud.get(original).carried, true);
});

test('תשובת טרנזקציה איטית אינה מסתירה סריקה חדשה שכבר הגיעה מהמאזין', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone();
  await Promise.all([a.start(), b.start()]); a.add(2); await a.flush();
  let appended = false;
  cloud.afterCommit = async ({ operations }) => {
    if (!appended && operations.some(operation => operation.path.includes('/returns/'))) {
      appended = true; await settle(); b.add(3); await b.flush();
      assert.equal(a.qty(), 3, 'המאזין כבר אישר את הסריקה החדשה');
    }
  };
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  assert.equal(records(cloud)[0].items[0].qty, 2); assert.equal(b.qty(), 3); assert.equal(a.qty(), 3);
});

test('מטמון עם האירוע אינו אישור ענן למחיקתו מתור ההמתנה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start();
  const prior = cloud.get(LEDGER); a.client.setOnline(false); a.add(2);
  const pending = JSON.parse(a.storage.getItem('ts_return_events_v1')).pending;
  a.client.emitCache(LEDGER, { ...prior, events: { ...prior.events, ...pending } }, false);
  assert.equal(Object.keys(JSON.parse(a.storage.getItem('ts_return_events_v1')).pending).length, Object.keys(pending).length);
  a.client.setOnline(true); await a.flush(); assert.equal(a.qty(), 2);
});

test('הרשאת כתיבה שנכשלה משאירה את האירוע המקומי ואינה יוצרת החזרה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start();
  cloud.reject = 'permission-denied'; a.add(4); await a.flush();
  const out = await a.finish({ expectedEpoch: a.module.epoch('weekly') });
  assert.equal(out.ok, false); assert.equal(a.qty(), 4); assert.equal(records(cloud).length, 0);
  assert.ok(Object.keys(JSON.parse(a.storage.getItem('ts_return_events_v1')).pending).length > 0);
  cloud.reject = null; await a.flush(); assert.equal(a.qty(), 4);
});

test('מצבת אירוע שנשלח נשמרת גם אחרי יותר משישים יום', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  const eventWrite = cloud.writes.find(write => write.kind === 'write' && Object.keys(write.data).some(key => key.startsWith('events.')));
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle(); a.module.stop();
  const later = phone({ clockOffset: 90 * 86400e3 }); await later.start();
  await later.client.fs.updateDoc(later.ref, eventWrite.data); await settle();
  assert.equal(later.qty(), 0); assert.equal(records(cloud).length, 1);
});

test('אי אפשר לשמור שליחה אם מזהה הניסיון לא נשמר בטלפון', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  a.storage.full = true; const out = await a.finish({ expectedEpoch: a.module.epoch('weekly') });
  assert.equal(out.ok, false); assert.equal(records(cloud).length, 0); assert.equal(a.qty(), 2);
});

test('שתי שליחות בשבועות עוקבים מקבלות מזהים נפרדים ושומרות את ההחזרה הקודמת', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle(); const before = records(cloud)[0];
  a.add(4); await a.flush(); await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle();
  const all = records(cloud); assert.equal(all.length, 2); assert.deepEqual(all.find(row => row.id === before.id), before);
  assert.deepEqual(all.map(row => row.items[0].qty).sort(), [2, 4]);
});

test('הפחתה מאוחרת של טיוטה שנשלחה אינה בולעת סריקה בטיוטה החדשה', async t => {
  const { cloud, phone } = fixture(t); const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  a.add(2); await a.flush(); b.client.setOnline(false);
  b.module.change('weekly', { items: [], date: '', note: '' });
  await a.finish({ expectedEpoch: a.module.epoch('weekly') }); await settle(); a.add(1); await a.flush();
  b.client.setOnline(true); await b.flush(); assert.equal(a.qty(), 1); assert.equal(b.qty(), 1); assert.equal(records(cloud)[0].items[0].qty, 2);
});

test('סריקה והסרה בלי רשת מתבטלות מקומית ואחרי חיבור', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  a.client.setOnline(false); a.add(3); a.module.change('weekly', { items: [], date: '', note: '' });
  assert.equal(a.qty(), 0); a.client.setOnline(true); await a.flush(); assert.equal(a.qty(), 0); assert.equal(b.qty(), 0);
});

test('שתי הסרות מקבילות אינן מסירות סריקה שלא נצפתה באף אחת מהן', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone(), c = phone(); await Promise.all([a.start(), b.start(), c.start()]);
  a.add(4); await a.flush(); a.client.setOnline(false); b.client.setOnline(false);
  a.module.change('weekly', { items: [], date: '', note: '' }); b.module.change('weekly', { items: [], date: '', note: '' });
  c.add(1); await c.flush(); a.client.setOnline(true); b.client.setOnline(true); await Promise.all([a.flush(), b.flush()]);
  assert.equal(a.qty(), 1); assert.equal(b.qty(), 1); assert.equal(c.qty(), 1);
});

test('שתי הפחתות של יחידה הן שני שינויים בכמות, גם כשנעשו יחד', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  a.add(4); await a.flush(); a.client.setOnline(false); b.client.setOnline(false);
  a.module.change('weekly', { items: [{ ...PRODUCT, qty: 3 }], date: '', note: '' });
  b.module.change('weekly', { items: [{ ...PRODUCT, qty: 3 }], date: '', note: '' });
  a.client.setOnline(true); b.client.setOnline(true); await Promise.all([a.flush(), b.flush()]);
  assert.equal(a.qty(), 2); assert.equal(b.qty(), 2);
});

test('לחיצה כפולה באותו טלפון אינה מקבלת שתי הרשאות לפתיחת וואטסאפ', async t => {
  const { cloud, phone } = fixture(t); const a = phone(); await a.start(); a.add(2); await a.flush();
  let release; cloud.commitGate = new Promise(resolve => { release = resolve; });
  const expectedEpoch = a.module.epoch('weekly'); const first = a.finish({ expectedEpoch }), second = a.finish({ expectedEpoch });
  await settle(); cloud.commitGate = null; release(); const results = await Promise.all([first, second]);
  assert.equal(records(cloud).length, 1); assert.equal(results.filter(result => result.ok && !result.already).length, 1);
});

test('הגירה יכולה לבדוק בשרת שהטיוטה הישנה כבר נסגרה ולא לפתוח אותה שוב', async t => {
  const { cloud, phone } = fixture(t); const draftId = 'synthetic-already-sent';
  cloud.put(LEGACY, { slots: { weekly: { draftId, items: [{ ...PRODUCT, qty: 6 }], date: '', note: '' } } });
  cloud.put(ROOT + '/returns/' + draftId, { synthetic: true, items: [{ ...PRODUCT, qty: 6 }] });
  const legacy = async (tx, data) => {
    const saved = await tx.get({ path: ROOT + '/returns/' + data.slots.weekly.draftId });
    return { slots: saved.exists() ? {} : data.slots, writes: [] };
  };
  const a = phone({ legacy }), b = phone({ legacy }); await Promise.all([a.start(), b.start()]);
  assert.equal(a.qty(), 0); assert.equal(b.qty(), 0); assert.equal(records(cloud).length, 1);
  a.add(1); await a.flush(); assert.equal(b.qty(), 1);
});

test('כישלון אחסון מקומי בזמן אישור ענן משאיר גיבוי ו-retry אינו מכפיל כמות', async t => {
  const { phone } = fixture(t); const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  a.client.setOnline(false); a.add(3); const stored = a.storage.getItem('ts_return_events_v1');
  a.storage.full = true; a.client.setOnline(true); await a.flush();
  assert.equal(a.storage.getItem('ts_return_events_v1'), stored); assert.equal(a.qty(), 3); assert.equal(b.qty(), 3);
  a.storage.full = false; await a.flush(); assert.equal(a.qty(), 3); assert.equal(b.qty(), 3);
  assert.equal(Object.keys(JSON.parse(a.storage.getItem('ts_return_events_v1')).pending).length, 0);
});

test('מזהי מוצר date ו-note אינם מתנגשים באירועי תאריך והערה בזמן הגירה', async t => {
  const { cloud, phone } = fixture(t);
  cloud.put(LEGACY, { slots: { weekly: { draftId: 'migration-synthetic', date: '2026-10-06', note: 'הערת בדיקה', items: [
    { productId: 'date', name: 'מוצר תאריך סינתטי', qty: 2 }, { productId: 'note', name: 'מוצר הערה סינתטי', qty: 3 }
  ] } } });
  const a = phone(), b = phone(); await Promise.all([a.start(), b.start()]);
  assert.equal(a.qty('date'), 2); assert.equal(a.qty('note'), 3);
  assert.equal(b.view().slots.weekly.date, '2026-10-06'); assert.equal(b.view().slots.weekly.note, 'הערת בדיקה');
  assert.equal(Object.keys(cloud.get(LEDGER).events).length, 4);
});
