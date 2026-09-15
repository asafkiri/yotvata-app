import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, fakeCloud } from './receipt-scan-harness.mjs';
const path = 'artifacts/yotvata-app-classic/public/data/drafts/appOrders';
const mark = (key, amount = 1) => ({ key, name: key, amount, at: 100, fromOrderId: '' });
function device(cloud, storage = new Map()) {
  const c = runtime('yotvata', { storage });
  c.context.doc = (_db, ...parts) => parts.join('/');
  c.context.runTransaction = (_db, fn) => cloud.transaction(fn, c.context);
  c.run('restoreAppOrders()');
  return c;
}
function snapshot(c, cloud) {
  c.context.remoteOrders = structuredClone(cloud.documents.get(path) || {});
  c.run('receiveAppOrdersSnapshot({exists:()=>true,data:()=>remoteOrders,metadata:{hasPendingWrites:false,fromCache:false}})');
}
function edit(c, key, amount) {
  c.context.changeMark = mark(key, amount);
  c.run('appOrders=appOrders.filter(x=>x.key!==changeMark.key);if(changeMark.amount)appOrders.push(changeMark);saveAppOrders()');
}
const keys = cloud => cloud.documents.get(path).items.map(x => x.key).sort();

test('opening an empty old device with a future local timestamp cannot erase cloud marks', async () => {
  const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk')], updatedAt: 1 });
  const c = device(cloud, new Map([['yt_app_orders', '[]'], ['yt_app_orders_ts', '9999999999999']]));
  snapshot(c, cloud); await c.run('flushAppOrdersToCloudNow()');
  assert.deepEqual(keys(cloud), ['milk']); assert.equal(c.run('appOrders[0].key'), 'milk');
  assert.equal(c.run('appOrdersChanges.length'), 0);
});
test('two stale devices adding different products preserve both in either write order', async () => {
  for (const reverse of [false, true]) {
    const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk')], updatedAt: 1 });
    const a = device(cloud), b = device(cloud); snapshot(a, cloud); snapshot(b, cloud);
    edit(a, 'coffee', 2); edit(b, 'yogurt', 3);
    await Promise.all((reverse ? [b, a] : [a, b]).map(c => c.run('flushAppOrdersToCloudNow()')));
    assert.deepEqual(keys(cloud), ['coffee', 'milk', 'yogurt']);
  }
});
test('a stale deletion cannot delete a product another device reordered', async () => {
  const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk'), mark('coffee')] });
  const a = device(cloud), b = device(cloud); snapshot(a, cloud); snapshot(b, cloud);
  edit(a, 'milk', 0); edit(b, 'milk', 4);
  await b.run('flushAppOrdersToCloudNow()'); await a.run('flushAppOrdersToCloudNow()');
  assert.equal(cloud.documents.get(path).items.find(x => x.key === 'milk').amount, 4);
  assert.deepEqual(keys(cloud), ['coffee', 'milk']);
  assert.match(a.toasts.join(' '), /אותו מוצר השתנה/);
});
test('deleting one product preserves unrelated marks made on another device', async () => {
  const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk')] });
  const a = device(cloud), b = device(cloud); snapshot(a, cloud); snapshot(b, cloud);
  edit(a, 'milk', 0); edit(b, 'coffee', 2);
  await b.run('flushAppOrdersToCloudNow()'); await a.run('flushAppOrdersToCloudNow()');
  assert.deepEqual(keys(cloud), ['coffee']);
});
test('offline edits survive reload and merge without resurrecting unrelated deleted marks', async () => {
  const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk')] });
  const a = device(cloud); snapshot(a, cloud); edit(a, 'coffee', 2);
  a.context.networkFailure = true;
  assert.equal(await a.run('flushAppOrdersToCloudNow()'), false);
  cloud.documents.set(path, { items: [mark('yogurt')], syncRevision: 2 });
  const b = device(cloud, new Map(a.storage));
  await b.run('flushAppOrdersToCloudNow()');
  assert.deepEqual(keys(cloud), ['coffee', 'yogurt']);
  assert.equal(b.run('appOrdersChanges.length'), 0);
});
test('a repeated transaction is idempotent after its acknowledgement was lost', async () => {
  const cloud = fakeCloud(), a = device(cloud); edit(a, 'milk', 2);
  const unacknowledged = new Map(a.storage);
  await a.run('flushAppOrdersToCloudNow()');
  const b = device(cloud, unacknowledged); await b.run('flushAppOrdersToCloudNow()');
  assert.equal(cloud.documents.get(path).items.length, 1);
  assert.equal(cloud.documents.get(path).items[0].amount, 2);
});

test('an offline retry cannot resurrect a successfully saved mark removed on another device', async () => {
  const cloud = fakeCloud(), a = device(cloud); edit(a, 'milk', 2);
  const unacknowledged = new Map(a.storage);
  await a.run('flushAppOrdersToCloudNow()');
  const b = device(cloud); snapshot(b, cloud); edit(b, 'milk', 0); await b.run('flushAppOrdersToCloudNow()');
  const restored = device(cloud, unacknowledged); await restored.run('flushAppOrdersToCloudNow()');
  assert.deepEqual(keys(cloud), []);
  assert.equal(restored.run('appOrders.length'), 0);
});
test('edits during an in-flight save are flushed as subsequent changes', async () => {
  const cloud = fakeCloud(), c = device(cloud); edit(c, 'milk', 1);
  const first = c.run('flushAppOrdersToCloudNow()'); edit(c, 'milk', 2); edit(c, 'coffee', 3);
  await first;
  assert.deepEqual(keys(cloud), ['coffee', 'milk']);
  assert.equal(cloud.documents.get(path).items.find(x => x.key === 'milk').amount, 2);
  assert.equal(c.run('appOrdersChanges.length'), 0);
});
test('cached snapshots and legacy queued whole-list writes cannot clear the list', async () => {
  const cloud = fakeCloud(); cloud.documents.set(path, { items: [mark('milk')] });
  const c = device(cloud); snapshot(c, cloud);
  c.run('receiveAppOrdersSnapshot({exists:()=>true,data:()=>({items:[]}),metadata:{fromCache:true}})');
  assert.equal(c.run('appOrders.length'), 1);
  await assert.rejects(c.run("executeCloudTask({op:'set',path:dataPath('drafts','appOrders'),data:{items:[]}})"), /רשימה ישנה נחסמה/);
  assert.deepEqual(keys(cloud), ['milk']);
});

test('a newer server snapshot is not replaced by an older transaction response', async () => {
  const cloud = fakeCloud(), a = device(cloud), b = device(cloud);
  let release, committed;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { committed = resolve; });
  a.context.runTransaction = async (_db, fn) => {
    const result = await cloud.transaction(fn, a.context);
    committed(); await gate; return result;
  };
  edit(a, 'milk', 2); const pending = a.run('flushAppOrdersToCloudNow()'); await ready;
  snapshot(b, cloud); edit(b, 'coffee', 3); await b.run('flushAppOrdersToCloudNow()');
  snapshot(a, cloud); release(); await pending;
  assert.equal(a.run('appOrders.length'), 2); assert.deepEqual(keys(cloud), ['coffee', 'milk']);
});

test('server timestamps cannot trigger a whole-list write and pending marks survive a snapshot', async () => {
  const cloud = fakeCloud(), c = device(cloud); edit(c, 'milk', 2);
  c.context.networkFailure = true;
  cloud.documents.set(path, { items: [mark('coffee')], updatedAt: 9999999999999 });
  snapshot(c, cloud); await c.run('flushAppOrdersToCloudNow()');
  assert.equal(c.run('appOrders.length'), 2);
  c.context.networkFailure = false; await c.run('flushAppOrdersToCloudNow()');
  assert.deepEqual(keys(cloud), ['coffee', 'milk']);
});

test('sending returns flushes pending order marks before leaving for WhatsApp', async () => {
  const cloud = fakeCloud(), c = device(cloud); edit(c, 'milk', 2);
  c.context.window.location = { href: '' };
  c.run(`returnsList=[{productId:'coffee',name:'קפה בדיקה',qty:1}];
    runCloudTaskSilent=async()=>true;openReturnsSend()`);
  await c.run("performSend({name:'בדיקה מקומית',phone:''})");
  assert.deepEqual(keys(cloud), ['milk']);
  assert.equal(c.run('appOrders.length'), 1); assert.equal(c.run('returnsList.length'), 0);
  assert.equal(c.run('appOrdersChanges.length'), 0);
});
