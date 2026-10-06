// ענן סינתטי: כמה לקוחות, מטמון ותור SDK נפרדים, וטרנזקציות אופטימיות.
export const tick = () => new Promise(resolve => setImmediate(resolve));
const DELETE = Object.freeze({ __returnFakeDelete: true });
const fault = (code, message = code) => Object.assign(new Error(message), { code });
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function merge(a, b) {
  const result = clone(a || {});
  for (const [key, value] of Object.entries(b || {})) {
    if (value && value.__returnFakeDelete) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) result[key] = merge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}
function patch(base, values) {
  if (base == null) throw fault('not-found');
  const result = clone(base);
  for (const [field, value] of Object.entries(values)) {
    const path = field.split('.'); let cursor = result;
    for (const key of path.slice(0, -1)) cursor = cursor[key] && typeof cursor[key] === 'object' ? cursor[key] : (cursor[key] = {});
    const last = path.at(-1);
    if (value && value.__returnFakeDelete) delete cursor[last];
    else cursor[last] = clone(value);
  }
  return result;
}

export function createCloud() {
  let version = 0;
  const server = new Map(), clients = new Set();
  const cloud = {
    server, clients, writes: [], transactions: 0, transactionRetries: 0,
    reject: null, commitGate: null, updateGate: null,
    loseReplyAfterCommit: false, loseReplyAfterUpdate: false,
    beforeCommit: null, afterCommit: null,
    get(path) { return clone(server.get(path)?.data ?? null); },
    put(path, data) { server.set(path, { version: ++version, data: clone(data) }); notify(path); },
    remove(path) { server.delete(path); version++; notify(path); },
    paths(part = '') { return [...server.keys()].filter(path => path.includes(part)); },
    find(suffix) { const path = [...server.keys()].find(path => path.endsWith(suffix)); return path ? cloud.get(path) : null; },
    client(options) { const client = makeClient(cloud, options); clients.add(client); return client; },
    _version(path) { return server.get(path)?.version || 0; },
    _commit(operations, reads = new Map(), kind = 'transaction') {
      for (const [path, expected] of reads) if (cloud._version(path) !== expected) throw fault('aborted', 'document changed');
      const staged = new Map();
      for (const operation of operations) {
        const old = staged.has(operation.path) ? staged.get(operation.path) : cloud.get(operation.path);
        let data;
        if (operation.op === 'update') data = patch(old, operation.data);
        else if (operation.op === 'delete') data = null;
        else data = operation.merge ? merge(old, operation.data) : clone(operation.data);
        staged.set(operation.path, data);
      }
      for (const [path, data] of staged) {
        if (data == null) server.delete(path);
        else server.set(path, { version: ++version, data });
      }
      cloud.writes.push(...operations.map(operation => ({ ...clone(operation), kind })));
      for (const path of staged.keys()) notify(path);
    }
  };
  function notify(path) { for (const client of clients) client._changed(path); }
  return cloud;
}

function makeClient(cloud, { cache = new Map(), queue = [], online: initiallyOnline = true } = {}) {
  let online = initiallyOnline, pumping = false;
  const listeners = new Set();
  const snapshot = (path, data, fromCache, hasPendingWrites = false) => ({
    id: path.split('/').at(-1), exists: () => data != null, data: () => clone(data),
    metadata: { fromCache, hasPendingWrites }
  });
  function pending(path) { return queue.some(item => item.operation.path === path); }
  function localData(path) {
    let data = clone(cache.get(path) ?? null);
    for (const item of queue.filter(item => item.operation.path === path)) {
      const op = item.operation;
      try { data = op.op === 'update' ? patch(data, op.data) : op.merge ? merge(data, op.data) : clone(op.data); } catch {}
    }
    return data;
  }
  async function deliver(listener, fromCache = false) {
    await tick();
    if (!listener.active || (!fromCache && !online)) return;
    if (!fromCache) cache.set(listener.path, cloud.get(listener.path));
    listener.next(snapshot(listener.path, localData(listener.path), fromCache, pending(listener.path)));
  }
  async function pump() {
    if (pumping || !online) return;
    pumping = true;
    try {
      while (online && queue.length) {
        const item = queue[0];
        try {
          if (cloud.updateGate) await cloud.updateGate;
          if (!online) break;
          if (cloud.reject) throw fault(cloud.reject);
          cloud._commit([item.operation], new Map(), 'write');
          queue.shift(); cache.set(item.operation.path, cloud.get(item.operation.path));
          client._changed(item.operation.path);
          if (cloud.loseReplyAfterUpdate) item.reject(fault('unavailable', 'reply lost'));
          else item.resolve();
        } catch (error) { queue.shift(); item.reject(error); client._changed(item.operation.path); }
      }
    } finally { pumping = false; }
  }
  function enqueue(operation) {
    const result = new Promise((resolve, reject) => queue.push({ operation: clone(operation), resolve, reject }));
    for (const listener of listeners) if (listener.path === operation.path) deliver(listener, !online);
    void pump(); return result;
  }
  const client = {
    cache, queue, db: { fake: true },
    isOnline: () => online,
    setOnline(value) { online = !!value; if (online) { void pump(); for (const listener of listeners) deliver(listener); } },
    listenerCount: () => listeners.size,
    emitCache(path, data, hasPendingWrites = false) {
      cache.set(path, clone(data));
      for (const listener of listeners) if (listener.path === path && listener.active) listener.next(snapshot(path, data, true, hasPendingWrites));
    },
    _changed(path) { if (online) for (const listener of listeners) if (listener.path === path) deliver(listener); },
    fs: {
      doc: (db, ...parts) => ({ path: parts.join('/') }),
      deleteField: () => DELETE,
      serverTimestamp: () => ({ seconds: 1800000000, nanoseconds: 0 }),
      onSnapshot(ref, options, next, error) {
        if (typeof options === 'function') { error = next; next = options; }
        const listener = { path: ref.path, next, error, active: true }; listeners.add(listener);
        void deliver(listener, true); if (online) void deliver(listener);
        return () => { listener.active = false; listeners.delete(listener); };
      },
      async getDocFromServer(ref) {
        await tick(); if (!online) throw fault('unavailable', 'offline');
        if (cloud.reject) throw fault(cloud.reject);
        const data = cloud.get(ref.path); cache.set(ref.path, data); return snapshot(ref.path, data, false, false);
      },
      updateDoc(ref, values) { return enqueue({ op: 'update', path: ref.path, data: values }); },
      setDoc(ref, values, options) { return enqueue({ op: 'set', path: ref.path, data: values, merge: !!options?.merge }); },
      async runTransaction(db, callback, options = {}) {
        cloud.transactions++;
        const attempts = options.maxAttempts || 5;
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (!online) throw fault('unavailable', 'offline');
          if (cloud.reject) throw fault(cloud.reject);
          const reads = new Map(), operations = [];
          const tx = {
            async get(ref) {
              if (operations.length) throw fault('failed-precondition', 'transaction read after write');
              await tick(); if (!online) throw fault('unavailable', 'offline');
              const data = cloud.get(ref.path); reads.set(ref.path, cloud._version(ref.path)); return snapshot(ref.path, data, false);
            },
            set(ref, data, options) { operations.push({ op: 'set', path: ref.path, data: clone(data), merge: !!options?.merge }); return tx; },
            update(ref, data) { operations.push({ op: 'update', path: ref.path, data: clone(data) }); return tx; },
            delete(ref) { operations.push({ op: 'delete', path: ref.path }); return tx; }
          };
          const result = await callback(tx);
          if (cloud.commitGate) await cloud.commitGate;
          if (!online) throw fault('unavailable', 'offline');
          if (cloud.beforeCommit) await cloud.beforeCommit({ attempt, operations, reads, client });
          try { cloud._commit(operations, reads); }
          catch (error) { if (error.code === 'aborted' && attempt + 1 < attempts) { cloud.transactionRetries++; continue; } throw error; }
          if (cloud.afterCommit) await cloud.afterCommit({ operations, client });
          if (cloud.loseReplyAfterCommit) throw fault('unavailable', 'reply lost');
          return result;
        }
        throw fault('aborted');
      }
    }
  };
  return client;
}

export function memoryStorage(map = new Map()) {
  const storage = {
    map, full: false,
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      if (storage.full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      map.set(String(key), String(value));
    },
    removeItem(key) { map.delete(String(key)); }, clear() { map.clear(); }
  };
  return storage;
}
