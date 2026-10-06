// ענן Firestore מדומה לבדיקות של draft-handoff.js — כמה "טלפונים" על שרת אחד.
// מה שמדומה (כמו ב-SDK האמיתי, v11):
// - מטמון לכל טלפון: מאזין מקבל קודם snapshot מהמטמון (fromCache: true) ורק אחר כך מהשרת (fromCache: false).
//   אפשר להעביר מטמון בין "הפעלות" של אותו טלפון (persistentLocalCache).
// - טרנזקציה: הקריאות תמיד מהשרת; commit נכשל ('aborted') אם מסמך שנקרא השתנה; בלי רשת — 'unavailable'.
//   maxAttempts נשמר (אנחנו מעבירים 1). אפשר לעכב commit, לתקוע אותו, או "לאבד" את התשובה אחרי שנכתב.
// - getDocFromServer.
// אין כאן setDoc: המודול לא כותב בלי טרנזקציה.
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setImmediate(r));
const fault = (code, message) => Object.assign(new Error(message || code), { code });

export function createCloud() {
  const server = new Map(); // path → { data, version }
  let version = 0;
  const clients = new Set();
  const cloud = {
    server, clients,
    // שליטה בבדיקות:
    commitDelayMs: 0,        // commit נכתב אחרי השהיה
    hangCommits: false,      // commit לא חוזר לעולם (ולא נכתב)
    loseReplyAfterCommit: false, // נכתב בשרת, אבל הטלפון מקבל שגיאה
    reject: null,            // קוד שגיאה קבוע לכל טרנזקציה (למשל 'permission-denied')
    commitGate: null,        // Promise: כל commit מחכה לו (כדי ששתי טרנזקציות יקראו לפני שאחת כותבת)
    transactions: 0,
    get(path) { const e = server.get(path); return e ? clone(e.data) : null; },
    put(path, data) { version++; server.set(path, { data: clone(data), version }); notifyAll(path); },
    find(suffix) { for (const [p, e] of server) if (p.endsWith(suffix)) return clone(e.data); return null; },
    paths(prefix = '') { return [...server.keys()].filter(p => p.includes(prefix)); },
    client(opts = {}) { const c = makeClient(cloud, opts); clients.add(c); return c; },
    _commit(writes, reads) {
      for (const [path, v] of reads) { const e = server.get(path); if ((e ? e.version : 0) !== v) throw fault('aborted', 'document changed'); }
      for (const [path, data] of writes) { version++; server.set(path, { data: clone(data), version }); }
      for (const path of writes.keys()) notifyAll(path);
    },
    _version(path) { const e = server.get(path); return e ? e.version : 0; }
  };
  function notifyAll(path) { for (const c of clients) c._changed(path); }
  return cloud;
}

function makeClient(cloud, { cache = new Map() } = {}) {
  let online = true;
  const listeners = new Set();
  const snap = (path, data, fromCache) => ({ id: path.split('/').pop(), exists: () => data != null, data: () => clone(data), metadata: { fromCache } });
  const matches = (l, path) => l.kind === 'doc' ? l.path === path : path.startsWith(l.path + '/') && path.split('/').length === l.path.split('/').length + 1;
  function queryDocs(l, source) {
    const out = [];
    for (const [path, e] of (source === 'server' ? [...cloud.server].map(([p, x]) => [p, x.data]) : [...cache])) {
      if (!matches(l, path) || e == null) continue;
      if (l.wheres.every(w => w.op === '==' && e[w.field] === w.value)) out.push(snap(path, e, source !== 'server'));
    }
    return out;
  }
  async function deliver(l) {
    await tick();
    if (!online || !l.active) return;
    if (l.kind === 'doc') {
      const data = cloud.get(l.path); cache.set(l.path, data);
      l.next(snap(l.path, data, false));
    } else {
      for (const [path, e] of cloud.server) if (matches(l, path)) cache.set(path, clone(e.data));
      const docs = queryDocs(l, 'server');
      l.next({ docs, metadata: { fromCache: false } });
    }
  }
  const client = {
    cache,
    db: { fake: true },
    isOnline: () => online,
    setOnline(v) { online = v; if (v) for (const l of listeners) deliver(l); },
    listenerCount: () => [...listeners].filter(l => l.active).length,
    _changed(path) { if (!online) return; for (const l of listeners) if (l.active && matches(l, path)) deliver(l); },
    fs: {
      doc: (db, ...path) => ({ kind: 'doc', path: path.join('/') }),
      collection: (db, ...path) => ({ kind: 'collection', path: path.join('/') }),
      where: (field, op, value) => ({ field, op, value }),
      query: (col, ...wheres) => ({ kind: 'query', path: col.path, wheres }),
      onSnapshot(ref, opts, next) {
        if (typeof opts === 'function') next = opts;
        const l = { kind: ref.kind === 'doc' ? 'doc' : 'query', path: ref.path, wheres: ref.wheres || [], next, active: true };
        listeners.add(l);
        (async () => {
          await tick();
          if (!l.active) return;
          if (l.kind === 'doc') { if (cache.has(l.path)) l.next(snap(l.path, cache.get(l.path), true)); }
          else l.next({ docs: queryDocs(l, 'cache'), metadata: { fromCache: true } });
          if (online) deliver(l);
        })();
        return () => { l.active = false; listeners.delete(l); };
      },
      async getDocFromServer(ref) {
        await tick();
        if (!online) throw fault('unavailable', 'offline');
        const data = cloud.get(ref.path); cache.set(ref.path, data);
        return snap(ref.path, data, false);
      },
      async runTransaction(db, fn, options = {}) {
        cloud.transactions++;
        const attempts = Math.max(1, Number(options.maxAttempts) || 5);
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (!online) throw fault('unavailable', 'offline');
          if (cloud.reject) throw fault(cloud.reject);
          const reads = new Map(), writes = new Map();
          const tx = {
            async get(ref) {
              await tick();
              if (!online) throw fault('unavailable', 'offline');
              reads.set(ref.path, cloud._version(ref.path));
              return snap(ref.path, cloud.get(ref.path), false);
            },
            set(ref, data) { writes.set(ref.path, clone(data)); return tx; }
          };
          const out = await fn(tx);
          if (cloud.commitGate) await cloud.commitGate;
          if (cloud.hangCommits) return new Promise(() => {});
          if (cloud.commitDelayMs) await new Promise(r => setTimeout(r, cloud.commitDelayMs));
          try { cloud._commit(writes, reads); }
          catch (e) { lastError = e; continue; }
          if (cloud.loseReplyAfterCommit) throw fault('unavailable', 'reply lost');
          return out;
        }
        throw lastError || fault('aborted');
      }
    }
  };
  return client;
}

// localStorage מדומה (Map), עם אפשרות לסמן "מלא"
export function memoryStorage(map = new Map()) {
  const s = { map, full: false,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (s.full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }); map.set(k, String(v)); },
    removeItem: k => { map.delete(k); } };
  return s;
}
