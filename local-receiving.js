/* Final-only receiving. No listeners, ownership claims, draft uploads or retries in the background. */
(function (scope) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const withoutId = value => { const next = { ...value }; delete next.id; return next; };
  const same = (a, b) => canonical(withoutId(a)) === canonical(withoutId(b));
  const fault = reason => Object.assign(new Error(reason), { reason });
  function create(o) {
    const storage = o.storage || scope.localStorage, key = o.prefix + '_receiving_final_v1';
    const fs = o.fs, root = o.rootPath, timeoutMs = o.timeoutMs || 18000;
    const timers = o.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
    let running = false;
    const read = () => { const raw = storage.getItem(key); if (!raw) return {}; const list = JSON.parse(raw); if (!list || typeof list !== 'object' || Array.isArray(list)) throw fault('storage'); return list; };
    const write = list => storage.setItem(key, JSON.stringify(list));
    const online = () => o.online ? o.online() : !scope.navigator || scope.navigator.onLine !== false;
    const ref = (collection, id) => fs.doc(o.db, ...root, collection, id);
    const current = attempt => (!o.getSession || o.getSession() === attempt.sessionId)
      && (!o.getFingerprint || o.getFingerprint() === attempt.fingerprint);
    function bounded(promise) {
      let timer;
      const limit = new Promise((_, reject) => { timer = timers.set(() => reject(fault('unknown')), timeoutMs); });
      return Promise.race([promise, limit]).finally(() => timers.clear(timer));
    }
    function forget(sessionId) {
      try { const list = read(); delete list[sessionId]; write(list); return true; } catch (_) { return false; }
    }
    const exact = (record, attempt) => record && record.localFinal && record.localFinal.token === attempt.token
      && record.localFinal.sessionId === attempt.sessionId
      && same(record, { ...attempt.data, localFinal: { token: attempt.token, sessionId: attempt.sessionId } });
    async function finish(input) {
      if (running) return { ok: false, reason: 'busy' };
      if (!online()) return { ok: false, reason: 'offline' };
      if (!input || !input.sessionId || !input.recordId || !input.fingerprint) return { ok: false, reason: 'invalid' };
      running = true;
      let attempt;
      try {
        const list = read();
        attempt = list[input.sessionId];
        if (attempt && (attempt.sessionId !== input.sessionId || attempt.recordId !== input.recordId || !attempt.token || !attempt.data)) throw fault('storage');
        if (!attempt) {
          attempt = clone({ sessionId: input.sessionId, recordId: input.recordId, data: input.data,
            expected: input.expected || null, prices: input.prices || [], extras: input.extras || [], fingerprint: input.fingerprint,
            token: o.makeId ? o.makeId('receipt_final') : scope.crypto.randomUUID(), deviceName: o.deviceName ? o.deviceName() : '', createdAt: Date.now() });
          list[input.sessionId] = attempt;
          // Fail closed before submitting anything if the immutable retry payload cannot be persisted.
          write(list);
        }
        // Never submit an earlier unresolved payload after the user has changed this draft.
        if (attempt.fingerprint !== input.fingerprint || !current(attempt)) {
          try { const previous = await bounded(fs.getDocFromServer(ref('receipts', attempt.recordId)));
            if (previous.exists() && exact(previous.data(), attempt)) return { ok: false, reason: 'saved-late', saved: true };
          } catch (_) {}
          return { ok: false, reason: 'pending-changed' };
        }
        const transaction = fs.runTransaction(o.db, async tx => {
          const recordRef = ref('receipts', attempt.recordId), snap = await tx.get(recordRef), record = snap.exists() ? snap.data() : null;
          if (exact(record, attempt)) return { already: true };
          if (record && record.localFinal && record.localFinal.token === attempt.token) throw fault('changed');
          if (!attempt.expected && record) throw fault('exists');
          if (attempt.expected && (!record || !same(record, attempt.expected))) throw fault('changed');
          // Old installations may still hold this draft. Read the old ownership document only when finishing;
          // never create, mutate, delete or listen to it. A transferred/canceled legacy copy cannot be revived.
          const legacySnap = await tx.get(ref('drafts', 'handoff_' + o.app + '_receiving_' + attempt.sessionId));
          const legacy = legacySnap.exists() ? legacySnap.data() : null;
          if (legacy) {
            if (legacy.state !== 'open') throw fault(legacy.state === 'canceled' ? 'canceled' : 'saved');
            if (!legacy.deviceId || legacy.deviceId !== storage.getItem(o.prefix + '_device_id')) throw fault('moved');
            let claim = null;
            try { claim = JSON.parse(storage.getItem(o.prefix + '_handoff_receiving_claim') || 'null'); } catch (_) {}
            if (claim && claim.sessionId === attempt.sessionId && Number(claim.gen) > 0 && Number(claim.gen) !== Number(legacy.gen)) throw fault('moved');
          }
          const prices = [];
          for (const change of attempt.prices) {
            const productRef = ref('products', change.id), productSnap = await tx.get(productRef), product = productSnap.exists() ? productSnap.data() : null;
            if (!product || Number(product.price) !== Number(change.expected)) throw fault('changed');
            prices.push({ ref: productRef, data: { ...product, price: change.price } });
          }
          const extras = [];
          for (const extra of attempt.extras) {
            if (!extra.collection || !extra.id || extra.collection === 'receipts' || extra.collection === 'drafts') throw fault('invalid');
            const extraRef = ref(extra.collection, extra.id), extraSnap = await tx.get(extraRef), value = extraSnap.exists() ? extraSnap.data() : null;
            // Omitted/null expected means create-only. Every replacement carries an explicit expected record.
            if (extra.expected ? !value || !same(value, extra.expected) : value != null && !same(value, extra.data)) throw fault('changed');
            if(!extra.guardOnly)extras.push({ ref: extraRef, data: extra.data });
          }
          const logRef = ref('actionLog', 'receiving_final_' + attempt.token);
          await tx.get(logRef);
          tx.set(recordRef, { ...attempt.data, localFinal: { token: attempt.token, sessionId: attempt.sessionId } });
          for (const value of prices.concat(extras)) tx.set(value.ref, value.data);
          tx.set(logRef, { timestamp: attempt.createdAt, type: 'receiving', title: 'שמירת קליטה', details: 'רשומה ' + attempt.recordId,
            deviceName: attempt.deviceName, appVersion: o.appVersion, meta: { recordId: attempt.recordId, sessionId: attempt.sessionId } });
          return { already: false };
        }, { maxAttempts: 3 });
        let result;
        try { result = await bounded(transaction); }
        catch (error) {
          const code=String(error.code||'').replace(/^firestore\//,'');
          if(['permission-denied','invalid-argument','unauthenticated','failed-precondition','not-found','out-of-range','unimplemented'].includes(code)){forget(attempt.sessionId);return {ok:false,reason:code};}
          if (error.reason && error.reason !== 'unknown') { forget(attempt.sessionId); return { ok: false, reason: error.reason }; }
          // A lost response is resolved using a SERVER read, never a cached history entry.
          try {
            const check = await bounded(fs.getDocFromServer(ref('receipts', attempt.recordId)));
            if (check.exists() && exact(check.data(), attempt)) result = { already: true };
            else if (check.exists()) return { ok: false, reason: check.data()?.localFinal?.token === attempt.token ? 'changed' : 'exists' };
          } catch (_) {}
          if (!result) return { ok: false, reason: error.reason === 'unknown' ? 'unknown' : 'offline', unknown: true };
        }
        // A late acknowledgement must never erase new counts, a different receipt, or edited paper decisions.
        if (!current(attempt)) return { ok: false, reason: 'saved-late', saved: true };
        return { ok: true, already: result.already, sessionId: attempt.sessionId, token: attempt.token };
      } catch (error) {
        return { ok: false, reason: error.reason || 'storage' };
      } finally { running = false; }
    }
    return { finish, forget, attempt: sessionId => { try { return clone(read()[sessionId] || null); } catch (_) { return null; } }, busy: () => running, pending: sessionId => { try { return !!read()[sessionId]; } catch (_) { return true; } } };
  }
  scope.LocalReceiving = { create, canonical };
})(typeof globalThis !== 'undefined' ? globalThis : this);
