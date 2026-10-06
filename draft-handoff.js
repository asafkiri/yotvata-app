/* draft-handoff.js — טיוטה בטלפון, גיבוי בענן, מעבר בין טלפונים.
 * המפרט: docs/local-first-sync.md (במאגר asafkiri/berman-app). המודול עצמאי: אותו קובץ בכל אפליקציה, ורק המתאם שונה.
 *
 * העיקר:
 * - העבודה לא מחכה לרשת. הטיוטה נשמרת בטלפון (אצל האפליקציה); המודול רק מגבה, מעביר ושומר בסוף.
 * - מסמך אחד בענן לכל מושב טיוטה: drafts/handoff_{app}_{kind}_{sessionId}. כל כתיבה אליו — וגם השמירה הסופית — היא
 *   טרנזקציה עם תנאי (maxAttempts: 1, עם גידור ותקרת זמן). אין כתיבה עיוורת, ולכן אין כתיבה ישנה שנוחתת מאוחר.
 * - החלטות ("שלי" / "עברה" / "נשמרה" / "בוטלה") רק מהשרת: קריאה בתוך טרנזקציה, או snapshot עם fromCache === false.
 * - מונה gen (לא שעון). deviceId אקראי לכל טלפון.
 *
 * שימוש:
 *   const h = DraftHandoff.create({ app, kind, prefix, db, fs, rootPath, recordCollection, adapter, appVersion, maxScanMs });
 *   h.start();                 // אחרי ההתחברות, איפה שמתחילים את שאר המאזינים
 *   h.changed({ user });       // אחרי כל שמירה מקומית של הטיוטה (user: true כשהשינוי נולד מאירוע של המשתמש)
 *   h.flush();                 // גיבוי מיד (מעבר לרקע, תחילת/סוף קריאה בתשלום)
 *   await h.take(sessionId);   // "המשך אותה כאן" / "החזר אותה לכאן"
 *   await h.finish(recordId, data);  // השמירה הסופית (במקום set עיוור)
 *   h.cancel(meta);            // לפני שהאפליקציה מרוקנת טיוטה שבוטלה (meta חוזר ב-onClosed כשהענן אישר)
 *   h.clear();                 // "נקה אותה מהטלפון הזה"
 *   h.openSide(sessionId);     // "פתח אותה" — עותק בצד
 *   h.tidy();                  // כשהרשומות השמורות התעדכנו (מנקה עותקים בצד של רשומות שכבר נשמרו)
 *   h.state();                 // זול. לשורה העליונה ולשומר: { readOnly, away, offers, side, status, checking, ... }
 *
 * המתאם (adapter):
 *   getDraft() → { sessionId, recordId, empty, scanRunning, expected }     — זול: נקרא הרבה (בכל לחיצה)
 *   getPayload() → { payload: מחרוזת JSON בלי תמונות, summary }            — יקר: רק בגיבוי, העברה ועותק בצד
 *   validatePayload(obj, doc) → true/false        applyPayload(text, meta)        emptyDraft()
 *   recordSaved(recordId) → true/false (לניקוי עותקים בצד בלבד, לא להחלטה)       deviceName() → מחרוזת
 *   onChange(state)   onNotice(code, info)   onClosed(meta)   finishedLate(sessionId)   log(title, text, meta)
 *   finishWrites(tx, ctx), finishReads(tx, ctx) — כתיבות/קריאות נוספות בתוך טרנזקציית הסיום (רשות)
 */
(function (global) {
  'use strict';
  const VERSION = 1;
  const MAX_BYTES = 900000, SIDE_MAX = 3, SIDE_BYTES = 1000000;
  const fault = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});
  const canonical = value => JSON.stringify(value === undefined ? null : value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
      : Object.fromEntries(Object.keys(value).filter(k => value[k] !== undefined).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
  const equal = (a, b) => canonical(a) === canonical(b);
  const without = (obj, key) => { if (!obj || typeof obj !== 'object') return obj; const out = Object.assign({}, obj); delete out[key]; return out; };
  const bytes = text => { try { return new global.TextEncoder().encode(text).length; } catch (e) { return text.length * 3; } };
  const randomId = () => (global.crypto && typeof global.crypto.randomUUID === 'function' ? global.crypto.randomUUID()
    : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  const safeId = id => String(id || '').replace(/[\/\s]/g, '_').slice(0, 300);
  // טביעה קצרה של התוכן (FNV-1a) — כדי לדעת אם מה שנשמר הוא בדיוק מה שבטלפון
  const digest = text => { text = String(text == null ? '' : text); let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16) + ':' + text.length; };
  // השרת דחה את ה-commit (לא נכתב בוודאות) — לא "לא ידוע"
  const DEFINITE = ['aborted', 'failed-precondition', 'already-exists', 'permission-denied', 'invalid-argument', 'not-found', 'out-of-range', 'unauthenticated'];

  function create(o) {
    const { app, kind, prefix, db, rootPath } = o;
    const fs = o.fs || null, A = o.adapter || {};
    if (!app || !kind || !prefix) throw new Error('draft-handoff: app, kind, prefix are required');
    const store = o.storage || (() => { try { return global.localStorage; } catch (e) { return null; } })();
    const timers = o.timers || { set: (fn, ms) => global.setTimeout(fn, ms), clear: id => global.clearTimeout(id) };
    const online = () => (o.isOnline ? o.isOnline() : !(global.navigator && global.navigator.onLine === false));
    const now = () => (o.now ? o.now() : Date.now());
    const maxScanMs = Number(o.maxScanMs) || 16 * 60000;
    const T = Object.assign({ backup: 12000, take: 12000, finish: 15000, close: 12000, read: 10000, debounce: 1500, retry: 20000,
      grace: 2500, settleCap: 60000, scanBeat: 60000 }, o.timeouts || {});
    const openKey = app + ':' + kind;
    const K = { device: prefix + '_device_id', claim: prefix + '_handoff_' + kind + '_claim', away: prefix + '_handoff_' + kind + '_away',
      side: prefix + '_handoff_' + kind + '_side', close: prefix + '_handoff_' + kind + '_close', legacy: prefix + '_handoff_' + kind + '_legacy' };
    const cloudReady = () => !!(db && fs && typeof fs.runTransaction === 'function' && typeof fs.doc === 'function');

    // ---- אחסון בטלפון (עם עותק בזיכרון: אם localStorage נכשל, לא ממציאים claim חדש בכל פעם) ----
    const memory = new Map();
    function readKey(key, fallback) {
      if (memory.has(key)) return memory.get(key);
      let value = fallback;
      try { const raw = store && store.getItem(key); if (raw != null) value = JSON.parse(raw); } catch (e) { value = fallback; }
      memory.set(key, value); return value;
    }
    function writeKey(key, value) {
      memory.set(key, value);
      try { if (!store) return false; if (value == null) store.removeItem(key); else store.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    }
    let deviceIdValue = null;
    function me() {
      if (deviceIdValue) return deviceIdValue;
      let id = null;
      try { id = store && store.getItem(K.device); } catch (e) { id = null; }
      if (!id) { id = 'dev_' + randomId(); try { store && store.setItem(K.device, id); } catch (e) {} } // נכשל → אקראי לריצה הזאת
      deviceIdValue = id; return id;
    }
    const name = () => { try { return String((A.deviceName && A.deviceName()) || '').slice(0, 60); } catch (e) { return ''; } };

    // claim: { sessionId, gen } — gen 0 = נוצרה כאן, הבעלות עוד לא אושרה. אין claim = טיוטה מלפני המנגנון בטלפון הזה
    const claim = () => readKey(K.claim, null);
    const claimFor = sessionId => { const c = claim(); return c && c.sessionId === sessionId ? c : null; };
    // fp — טביעת התוכן שהטלפון הזה אישר בענן לאחרונה (גיבוי / העברה): כך יודעים אם יש בו שינויים שלא הגיעו
    const setClaim = (sessionId, gen, fp) => { const c = claimFor(sessionId); writeKey(K.claim, { sessionId, gen: Number(gen) || 0, fp: fp !== undefined ? fp : (c ? c.fp || null : null) }); };
    const away = () => readKey(K.away, null);
    const awayFor = sessionId => { const a = away(); return a && a.sessionId === sessionId ? a : null; };
    function setAway(sessionId, kindOfAway, docData, extra) {
      const prev = awayFor(sessionId);
      const next = Object.assign({ sessionId, away: kindOfAway, by: docData ? docData.deviceName || '' : (prev && prev.away === kindOfAway ? prev.by : ''),
        byDevice: docData ? docData.deviceId || '' : '', gen: docData ? Number(docData.gen) || 0 : 0,
        at: docData ? Number(docData.updatedAt) || 0 : (prev && prev.away === kindOfAway ? prev.at : 0),
        localAhead: prev && prev.away === kindOfAway ? !!prev.localAhead : false }, extra || {});
      if (prev && equal(prev, next)) return;
      writeKey(K.away, next);
    }
    const clearAway = sessionId => { const a = away(); if (a && (!sessionId || a.sessionId === sessionId)) writeKey(K.away, null); };
    const sideList = () => (Array.isArray(readKey(K.side, [])) ? readKey(K.side, []) : []);
    const closeQueue = () => (Array.isArray(readKey(K.close, [])) ? readKey(K.close, []) : []);
    const closing = sessionId => closeQueue().some(q => q.sessionId === sessionId);

    // ---- הטיוטה דרך המתאם ----
    // זול (בכל לחיצה): בלי ה-payload
    function draft() {
      let d = null;
      try { d = A.getDraft ? A.getDraft() : null; } catch (e) { d = null; }
      if (!d) return { empty: true };
      const sessionId = d.sessionId ? safeId(d.sessionId) : null;
      return { sessionId, recordId: d.recordId ? safeId(d.recordId) : sessionId, empty: !!d.empty || !sessionId,
        scanRunning: !!d.scanRunning, expected: d.expected || null, _raw: d };
    }
    // יקר: רק בגיבוי, בהעברה ובעותק בצד
    function withPayload(d) {
      if (d.empty) return d;
      let p = null;
      try { p = A.getPayload ? A.getPayload() : d._raw; } catch (e) { p = null; }
      return Object.assign({}, d, { payload: p && typeof p.payload === 'string' ? p.payload : null, summary: (p && p.summary) || {} });
    }
    // הטיוטה שהייתה פתוחה כשהמודול עלה לראשונה בטלפון הזה — מלפני המנגנון (אולי פתוחה גם בטלפונים אחרים):
    // לא נתבעת בפתיחה ולא בלחיצה — רק כשהתוכן שלה באמת משתנה כאן
    function legacySession() { const l = readKey(K.legacy, null); return l && l.sessionId || null; }
    function isLegacy(sessionId) { return !!sessionId && legacySession() === sessionId && !claimFor(sessionId); }
    let legacyStartPayload = null;
    // טיוטה בלי claim שאינה הטיוטה הישנה → נוצרה כאן
    function ensureClaim(d) {
      if (!d || d.empty || !d.sessionId) return null;
      const c = claimFor(d.sessionId); if (c) return c;
      if (isLegacy(d.sessionId)) return null;
      setClaim(d.sessionId, 0); return claimFor(d.sessionId);
    }

    // טביעת התוכן שהמשתמש עבד עליו (המתאם יכול לתת טביעה יציבה — בלי שדות שמשתנים לבד; אחרת ה-payload)
    function fingerprint(d) {
      try { if (A.fingerprint) return digest(A.fingerprint()); } catch (e) {}
      return digest(withPayload(d).payload);
    }
    // השמירה של הטלפון הזה נכנסה (אולי באיחור), ובטלפון יש תוכן אחר ממה שנשמר — מה שנעשה אחריה נשמר בצד, גלוי
    function keepLate(sessionId, cur, d) {
      const by = cur && cur.savedBy;
      if (!by || by.deviceId !== me() || by.sessionId !== sessionId || !by.fp) return false;
      try {
        d = d || draft();
        if (d.empty || d.sessionId !== sessionId || fingerprint(d) === by.fp) return false;
        const p = withPayload(d);
        if (p.payload != null && sidePut(sideEntry(p, 'late')).ok) { notice('late-save', { sessionId }); return true; }
      } catch (e) {}
      return false;
    }

    // ---- ענן ----
    const handoffRef = sessionId => fs.doc(db, ...rootPath, 'drafts', 'handoff_' + safeId(app) + '_' + safeId(kind) + '_' + safeId(sessionId));
    const recordRef = recordId => fs.doc(db, ...rootPath, o.recordCollection, safeId(recordId));
    const exists = snap => !!snap && (typeof snap.exists === 'function' ? snap.exists() : !!snap.exists);
    const fromServer = snap => !!snap && !!snap.metadata && snap.metadata.fromCache === false;
    const errorCode = e => (e && e.code ? String(e.code).replace(/^firestore\//, '') : 'failed');
    const permanent = e => ['permission-denied', 'invalid-argument'].includes(errorCode(e));

    // טרנזקציה אחת: בלי ניסיונות חוזרים, עם גידור (כלום לא ייכתב אחרי תקרת הזמן), ו"לא ידוע" רק כשה-commit נשלח
    // והתשובה לא הגיעה (שגיאת רשת / תקרת זמן). שגיאה שהשרת החזיר על ה-commit — לא נכתב בוודאות.
    function transaction(body, ms) {
      if (!cloudReady()) return Promise.reject(fault('no-cloud'));
      if (!online()) return Promise.reject(fault('offline'));
      let active = true, commitSent = false, timer = null;
      const check = () => { if (!active) throw fault('timeout'); };
      const run = Promise.resolve().then(() => fs.runTransaction(db, async raw => {
        check();
        const fenced = {
          get: async ref => { check(); const snap = await raw.get(ref); check(); return snap; },
          set: (ref, data) => { check(); raw.set(ref, data); }
        };
        const out = await body(fenced);
        check();
        commitSent = true;
        return out;
      }, { maxAttempts: 1 }));
      const timeout = new Promise((_, reject) => { timer = timers.set(() => { active = false; reject(fault('timeout')); }, ms); });
      const settled = run.then(() => true, () => true);
      return Promise.race([run, timeout]).then(value => { active = false; timers.clear(timer); return value; }, error => {
        active = false; timers.clear(timer);
        const e = error && typeof error === 'object' ? error : fault('failed'); // גם שגיאה מ-realm אחר
        e.commitSent = commitSent && !DEFINITE.includes(errorCode(e)); e.settled = settled; throw e;
      });
    }

    // ---- מצב ----
    let started = false, stopped = false, status = 'idle', tooBigNow = false, writing = null, again = false, debounceTimer = null, retryTimer = null;
    let finishing = false, taking = false, checking = null, lastScan = false, scanStartedLocal = null, scanBeat = 0, scanTimer = null, beatTimer = null;
    let watched = new Map(), currentDoc = null, offerDocs = [], offersFromServer = false, unsubQuery = null;
    const closedHere = new Set(); // מושבים שנשמרו / בוטלו / נוקו כאן — לא מוצעים בחזרה עד שהשרת מראה שנסגרו
    const scanSeen = new Map();
    function setStatus(next) { if (status !== next) { status = next; emit(); } }
    function emit() { try { A.onChange && A.onChange(api.state()); } catch (e) { global.console && global.console.warn && global.console.warn('draft-handoff onChange', e); } }
    function notice(code, info) { try { A.onNotice && A.onNotice(code, info || {}); } catch (e) {} }
    function log(title, text, meta) { try { A.log && A.log(title, text, meta || {}); } catch (e) {} }

    function docData(d, gen) {
      const data = { handoff: VERSION, app, kind, openKey, sessionId: d.sessionId, recordId: d.recordId, editsExisting: !!d.expected,
        deviceId: me(), deviceName: name(), gen, state: 'open', parked: false, savedBy: null, payload: d.payload, tooBig: false,
        summary: d.summary || {}, scanRunning: !!d.scanRunning, scanStartedAt: d.scanRunning ? (scanStartedLocal || now()) : null,
        scanBeat: d.scanRunning ? scanBeat : 0, updatedAt: now(), writtenBy: String(o.appVersion || '') };
      if (data.payload == null || bytes(JSON.stringify(data)) > MAX_BYTES) { data.payload = null; data.tooBig = true; }
      return data;
    }
    function closedDoc(prev, d, state, savedBy) {
      return { handoff: VERSION, app, kind, openKey: null, sessionId: d.sessionId, recordId: d.recordId || (prev && prev.recordId) || d.sessionId,
        editsExisting: !!(d.expected || (prev && prev.editsExisting)), deviceId: me(), deviceName: name(),
        gen: prev ? Number(prev.gen) || 0 : (claimFor(d.sessionId) ? claimFor(d.sessionId).gen : 0),
        state, parked: false, savedBy: savedBy || null, payload: null, tooBig: false, summary: d.summary || (prev && prev.summary) || {},
        scanRunning: false, scanStartedAt: null, scanBeat: 0, updatedAt: now(), writtenBy: String(o.appVersion || '') };
    }
    const sameContent = (cur, next) => cur && cur.payload === next.payload && !!cur.tooBig === !!next.tooBig && !cur.parked && cur.openKey === next.openKey
      && equal(cur.summary || {}, next.summary || {}) && !!cur.scanRunning === !!next.scanRunning && (cur.scanBeat || 0) === (next.scanBeat || 0)
      && (cur.deviceName || '') === next.deviceName;

    // ---- מאזינים ----
    function watch(sessionId) {
      if (!sessionId || watched.has(sessionId) || !cloudReady() || typeof fs.onSnapshot !== 'function') return;
      let unsub = null;
      try {
        unsub = fs.onSnapshot(handoffRef(sessionId), { includeMetadataChanges: true }, snap => onDoc(sessionId, snap),
          e => global.console && global.console.warn && global.console.warn('draft-handoff doc listener', e));
      } catch (e) { unsub = null; }
      watched.set(sessionId, unsub);
    }
    function unwatchExcept(keep) {
      for (const [id, unsub] of watched) if (!keep.includes(id)) { try { unsub && unsub(); } catch (e) {} watched.delete(id); }
    }
    function syncWatches(d) {
      d = d || draft();
      const keep = [];
      if (!d.empty) keep.push(d.sessionId);
      if (checking) keep.push(checking.sessionId);
      unwatchExcept(keep); keep.forEach(watch);
      if (d.empty || !currentDoc || currentDoc.sessionId !== d.sessionId) currentDoc = null;
    }
    function onDoc(sessionId, snap) {
      if (!fromServer(snap)) return; // מטמון — לא מחליטים לפיו
      const cur = exists(snap) ? snap.data() : null;
      const d = draft();
      if (!d.empty && d.sessionId === sessionId) currentDoc = cur;
      if (cur && cur.state !== 'open') closedHere.delete(sessionId);
      if (checking && checking.sessionId === sessionId && checking.settledOk) resolveChecking(cur);
      if (!d.empty && d.sessionId === sessionId && cur) decide(sessionId, cur, d);
      emit();
    }
    // הכרעה לפי מסמך מהשרת, לטיוטה שפתוחה כאן
    function decide(sessionId, cur, d) {
      if (checking && checking.sessionId === sessionId) return;
      if (cur.state === 'saved') {
        if (cur.savedBy && cur.savedBy.deviceId === me() && finishing) return;
        // השמירה של הטלפון הזה נכנסה מאוחר (אחרי ש"לא נשמרה"), ובינתיים המשיכו לעבוד כאן — מה שנעשה אחריה נשמר בצד, גלוי
        if (!awayFor(sessionId)) keepLate(sessionId, cur, d);
        setAway(sessionId, 'saved', cur);
      } else if (cur.state === 'canceled') setAway(sessionId, 'canceled', cur);
      else if (cur.state === 'open' && cur.deviceId !== me()) {
        // האם בטלפון הזה יש ספירה שלא הגיעה לטלפון השני (לא נבנה בכל לחיצה: רק כשהשרת שולח מסמך)
        // רק שינויים שהטלפון הזה עשה אחרי הגיבוי האחרון שלו — לא כל שינוי שהטלפון השני עשה
        let ahead = false;
        try { const c = claimFor(sessionId); ahead = !!(c && c.fp && fingerprint(d || draft()) !== c.fp); } catch (e) { ahead = false; }
        setAway(sessionId, 'moved', cur, { localAhead: ahead });
      } else if (cur.state === 'open' && cur.deviceId === me()) {
        // שלי — "עברה" יורד. "נשמרה" שבא מהרשומה (נשמרה ממקום אחר, 'exists') — נשאר, גם כשהמסמך עוד פתוח
        const a0 = awayFor(sessionId);
        if (a0 && a0.away === 'moved') clearAway(sessionId);
        const c = claimFor(sessionId);
        if (!c || c.gen !== Number(cur.gen)) setClaim(sessionId, Number(cur.gen) || 0);
      }
    }
    function startQuery() {
      if (unsubQuery || !cloudReady() || typeof fs.onSnapshot !== 'function' || typeof fs.query !== 'function') return;
      try {
        const q = fs.query(fs.collection(db, ...rootPath, 'drafts'), fs.where('openKey', '==', openKey));
        unsubQuery = fs.onSnapshot(q, { includeMetadataChanges: true }, qs => {
          if (!qs || !qs.metadata || qs.metadata.fromCache !== false) return;
          offersFromServer = true;
          offerDocs = (qs.docs || []).map(s => s.data()).filter(x => x && x.handoff === VERSION && x.state === 'open' && x.sessionId);
          const live = new Set();
          for (const x of offerDocs) if (x.scanRunning) { const key = scanKey(x); live.add(key); if (!scanSeen.has(key)) scanSeen.set(key, now()); }
          for (const key of [...scanSeen.keys()]) if (!live.has(key)) scanSeen.delete(key);
          for (const id of [...closedHere]) if (!offerDocs.some(x => x.sessionId === id)) closedHere.delete(id);
          scheduleScanExpiry();
          emit();
        }, e => global.console && global.console.warn && global.console.warn('draft-handoff query listener', e));
      } catch (e) { unsubQuery = null; }
    }
    // חלון הקריאה נמדד בשעון של הטלפון הזה, מהרגע שראה את הקריאה (או את "הדופק" האחרון שלה)
    const scanKey = x => x.sessionId + ':' + (x.scanStartedAt || '') + ':' + (x.scanBeat || 0) + ':' + (x.deviceId || '');
    function scanWindowOpen(x) {
      if (!x || !x.scanRunning) return false;
      const key = scanKey(x), seen = scanSeen.get(key);
      if (seen == null) { scanSeen.set(key, now()); return true; } // ראינו עכשיו לראשונה — החלון מתחיל עכשיו
      return now() - seen < maxScanMs;
    }
    function scheduleScanExpiry() {
      if (scanTimer) { timers.clear(scanTimer); scanTimer = null; }
      if (stopped) return;
      const left = [...scanSeen.values()].map(at => at + maxScanMs - now()).filter(ms => ms > 0);
      if (left.length) scanTimer = timers.set(() => { scanTimer = null; emit(); }, Math.min(...left) + 50);
    }

    // ---- גיבוי ----
    function schedule(ms) {
      if (!cloudReady() || stopped) return;
      if (debounceTimer) timers.clear(debounceTimer);
      debounceTimer = timers.set(() => { debounceTimer = null; backup(); }, ms);
    }
    function scheduleRetry() {
      if (retryTimer || !cloudReady() || stopped) return;
      retryTimer = timers.set(() => { retryTimer = null; retryAll(); }, T.retry);
    }
    function retryAll() {
      if (!cloudReady() || stopped) return;
      processCloses();
      if (checking && checking.settledOk) resolveCheckingFromServer();
      backup();
    }
    // כתיבת גיבוי אחת בכל רגע; שמירה / העברה מחכות לה (אחרת הן מתנגשות בה)
    function backup() {
      if (writing) { again = true; return writing; }
      writing = backupOnce().finally(() => {
        writing = null;
        if (again) { again = false; schedule(0); }
      });
      return writing;
    }
    async function backupOnce() {
      if (!cloudReady()) return;
      const d0 = draft();
      if (d0.empty) { setStatus('idle'); return; }
      if (checking || finishing || taking) return;
      if (awayFor(d0.sessionId) || closing(d0.sessionId)) return;
      const c = ensureClaim(d0);
      if (!c) { setStatus('local'); return; } // טיוטה מלפני המנגנון שעוד לא השתנתה כאן — לא נתבעת
      if (!online()) { setStatus('failed'); scheduleRetry(); return; }
      const d = withPayload(d0);
      const fpNow = fingerprint(d0);
      setStatus('saving');
      try {
        const res = await transaction(async t => {
          const ref = handoffRef(d.sessionId);
          const snap = await t.get(ref);
          const cur = exists(snap) ? snap.data() : null;
          if (!cur) {
            if (!d.expected) { const rec = await t.get(recordRef(d.recordId)); if (exists(rec)) return { away: 'saved', doc: null }; }
            const next = docData(d, 1);
            t.set(ref, next); return { gen: 1, tooBig: next.tooBig };
          }
          if (cur.state !== 'open') return { away: cur.state === 'canceled' ? 'canceled' : 'saved', doc: cur };
          if (cur.deviceId !== me()) return { away: 'moved', doc: cur };
          const next = docData(d, Number(cur.gen) || 1);
          if (sameContent(cur, next)) return { gen: next.gen, tooBig: next.tooBig };
          t.set(ref, next); return { gen: next.gen, tooBig: next.tooBig };
        }, T.backup);
        const still = draft();
        if (res.away) {
          if (!still.empty && still.sessionId === d.sessionId) { if (res.away === 'saved' && !awayFor(d.sessionId)) keepLate(d.sessionId, res.doc, still); setAway(d.sessionId, res.away, res.doc); }
          setStatus('idle');
        } else {
          if (claimFor(d.sessionId)) setClaim(d.sessionId, res.gen, fpNow);
          tooBigNow = !!res.tooBig;
          setStatus(res.tooBig ? 'too-big' : 'saved');
        }
        if (retryTimer && !closeQueue().length) { timers.clear(retryTimer); retryTimer = null; }
      } catch (e) {
        setStatus(permanent(e) ? 'blocked' : 'failed');
        if (!permanent(e)) scheduleRetry();
      }
    }

    // ---- סגירות: ביטול, וטיוטה שנעלמה בלי שמירה ("חנייה" — יורדת מההצעות, לא מבוטלת) ----
    let closingNow = false;
    async function processCloses() {
      if (closingNow || !cloudReady() || !online()) return;
      const queue = closeQueue(); if (!queue.length) return;
      closingNow = true;
      try {
        for (const q of queue) {
          const drop = () => writeKey(K.close, closeQueue().filter(x => !(x.sessionId === q.sessionId && x.at === q.at)));
          try {
            const result = await transaction(async t => {
              const ref = handoffRef(q.sessionId), snap = await t.get(ref);
              const cur = exists(snap) ? snap.data() : null;
              if (q.mode === 'park') {
                const now0 = draft();
                if (!now0.empty && now0.sessionId === q.sessionId && !awayFor(q.sessionId)) return 'skip'; // חזרו לעבוד בה
                if (!cur || cur.state !== 'open' || cur.deviceId !== me() || (q.gen > 0 && Number(cur.gen) !== q.gen)) return 'skip';
                t.set(ref, Object.assign({}, cur, { openKey: null, parked: true, scanRunning: false, updatedAt: now() })); return 'parked';
              }
              if (!cur) {
                // טיוטה מלפני המנגנון (אולי פתוחה בטלפון אחר) — הביטול כאן מקומי בלבד
                if (q.legacy) return 'local'; // (המשתמש אישר את הביטול — הרשומות הקשורות יוצאות כמו בביטול רגיל)
                if (!q.editsExisting) { const rec = await t.get(recordRef(q.recordId)); if (exists(rec)) return 'declined'; }
                t.set(ref, closedDoc(null, { sessionId: q.sessionId, recordId: q.recordId, expected: q.editsExisting ? {} : null, summary: q.summary }, 'canceled'));
                return 'closed';
              }
              // כבר בוטלה על ידי הטלפון הזה (commit קודם שהתשובה שלו אבדה) — כמו "נסגרה"
              if (cur.state === 'canceled' && cur.deviceId === me()) return 'closed';
              if (cur.state !== 'open' || cur.deviceId !== me()) return cur.state === 'open' ? 'declined' : 'skip'; // טלפון אחר לקח — הוא ממשיך איתה
              if (q.gen != null && q.gen > 0 && Number(cur.gen) !== q.gen) return 'declined';
              t.set(ref, closedDoc(cur, { sessionId: q.sessionId, recordId: q.recordId, summary: cur.summary }, 'canceled'));
              return 'closed';
            }, T.close);
            drop();
            if (q.mode === 'park' && result === 'skip') { const n = draft(); if (!n.empty && n.sessionId === q.sessionId && !awayFor(q.sessionId)) schedule(0); }
            if (q.mode !== 'park') {
              if (result === 'closed' || result === 'local') { try { A.onClosed && A.onClosed(q.meta || {}, q.sessionId); } catch (e) {} }
              else if (result === 'declined') notice('cancel-declined', { sessionId: q.sessionId, meta: q.meta || {} });
            }
          } catch (e) { if (permanent(e)) drop(); else scheduleRetry(); }
        }
      } finally {
        closingNow = false; emit();
        // נוספו סגירות בזמן הריצה — עוד סבב
        if (closeQueue().some(x => !queue.some(y => y.sessionId === x.sessionId && y.at === x.at))) timers.set(() => processCloses(), 0);
      }
    }
    function queueClose(entry) {
      const queue = closeQueue().filter(x => x.sessionId !== entry.sessionId);
      queue.push(Object.assign({ at: now() }, entry));
      writeKey(K.close, queue);
      timers.set(() => processCloses(), 0);
    }
    // טיוטה שהייתה של הטלפון הזה נעלמה (רוקנה / הוחלפה) בלי שמירה, ביטול או עותק בצד — יורדת מההצעות
    // (לפי ה-claim שנשמר בטלפון — עובד גם אחרי פתיחה מחדש)
    function noticeGone(d) {
      const c = claim();
      if (!c || !(c.gen >= 1)) return;
      if (!d.empty && d.sessionId === c.sessionId) return;
      const gone = c.sessionId;
      if (!(closedHere.has(gone) || closing(gone) || sideList().some(x => x.sessionId === gone) || awayFor(gone)))
        queueClose({ mode: 'park', sessionId: gone, gen: c.gen });
      if (d.empty) writeKey(K.claim, null); // (טיוטה חדשה תקבל claim משלה)
    }

    // ---- עותקים בצד ----
    function sidePut(entry) {
      const before = sideList();
      let list = before.filter(x => x.sessionId !== entry.sessionId);
      list.push(entry);
      const order = { canceled: 0, same: 1, other: 2, late: 2 };
      while (list.length > SIDE_MAX || bytes(JSON.stringify(list)) > SIDE_BYTES) {
        const victims = list.filter(x => x !== entry && x.reason !== 'other' && x.reason !== 'late').sort((a, b) => (order[a.reason] - order[b.reason]) || (a.savedAt - b.savedAt));
        if (!victims.length) return { ok: false, reason: list.length > SIDE_MAX ? 'side-full' : 'storage' };
        list = list.filter(x => x !== victims[0]);
      }
      if (!writeKey(K.side, list)) { memory.set(K.side, before); return { ok: false, reason: 'storage' }; }
      return { ok: true, undo: () => { writeKey(K.side, before); } };
    }
    function sideEntry(d, reason) {
      const c = claimFor(d.sessionId);
      return { savedAt: now(), sessionId: d.sessionId, recordId: d.recordId, gen: c ? c.gen : null, legacy: !c, reason,
        summary: d.summary || {}, payload: d.payload, expected: !!d.expected };
    }
    const recordSaved = x => { try { return x.reason !== 'late' && !x.expected && !!A.recordSaved && !!A.recordSaved(x.recordId); } catch (e) { return false; } };
    function sideTidy() {
      const list = sideList();
      const keep = list.filter(x => !recordSaved(x));
      if (keep.length !== list.length) writeKey(K.side, keep);
    }

    // ---- "המשך אותה כאן" ----
    function applyTaken(sessionId, res) {
      A.applyPayload(res.payload, { source: 'handoff', doc: res.doc });
      setClaim(sessionId, res.gen, fingerprint(draft())); clearAway(sessionId); currentDoc = res.doc || null; closedHere.delete(sessionId);
      emit(); // המסך יוצא מ"לקריאה בלבד" מיד (לא מחכים ל-snapshot)
      if (closing(sessionId)) writeKey(K.close, closeQueue().filter(x => x.sessionId !== sessionId)); // המשתמש בחר להמשיך בה
      syncWatches(); setStatus('saved');
      log('הטיוטה עברה לטלפון הזה', (res.doc && res.doc.deviceName ? 'מ-' + res.doc.deviceName : 'מטלפון אחר'), { sessionId, gen: res.gen });
    }
    async function take(sessionId) {
      sessionId = safeId(sessionId);
      if (!cloudReady()) return { ok: false, reason: 'no-cloud' };
      if (!online()) return { ok: false, reason: 'offline' };
      if (taking || finishing || checking) return { ok: false, reason: 'busy' };
      // קליטה שבוטלה / נשמרה כאן ועוד שלי בענן — לא מחזירים אותה (טלפון אחר שכבר לקח אותה — מותר להמשיך ממנו)
      const known = offerDocs.find(x => x.sessionId === sessionId) || (currentDoc && currentDoc.sessionId === sessionId ? currentDoc : null);
      if ((closing(sessionId) || closedHere.has(sessionId)) && (!known || known.deviceId === me())) return { ok: false, reason: 'canceled' };
      const d0 = draft();
      if (!d0.empty && d0.sessionId !== sessionId && d0.scanRunning) return { ok: false, reason: 'scan-running-here' };
      taking = true; emit();
      let undo = null, expectGen = null;
      try {
        if (debounceTimer) { timers.clear(debounceTimer); debounceTimer = null; }
        if (writing) { try { await writing; } catch (e) {} }
        const d = withPayload(draft());
        const remote = offerDocs.find(x => x.sessionId === sessionId) || (currentDoc && currentDoc.sessionId === sessionId ? currentDoc : null);
        const localAway = d.empty ? null : awayFor(d.sessionId);
        const myClaim = d.empty ? null : claimFor(d.sessionId);
        const localAhead = d.empty ? false : myClaim && myClaim.fp ? fingerprint(d) !== myClaim.fp : (!remote || d.payload !== remote.payload);
        if (!d.empty && d.payload != null && !(localAway && localAway.away === 'saved') && (d.sessionId !== sessionId || localAhead)) {
          const put = sidePut(sideEntry(d, d.sessionId !== sessionId ? 'other' : 'same'));
          if (!put.ok) { taking = false; emit(); return { ok: false, reason: put.reason }; }
          undo = put.undo;
        }
        const res = await transaction(async t => {
          const ref = handoffRef(sessionId), snap = await t.get(ref);
          if (!exists(snap)) throw fault('gone');
          const cur = snap.data();
          if (cur.state === 'saved') throw fault('saved', null, { doc: cur });
          if (cur.state === 'canceled') throw fault('canceled', null, { doc: cur });
          if (cur.tooBig || cur.payload == null) throw fault('too-big-move');
          // קריאה בתשלום רצה אצל המחזיק — לפי מה שהשרת אומר עכשיו, לא לפי ההצעה
          if (cur.deviceId !== me() && cur.scanRunning && scanWindowOpen(cur)) throw fault('scan-running');
          let parsed = null;
          try { parsed = JSON.parse(cur.payload); } catch (e) { throw fault('invalid'); }
          if (A.validatePayload && !A.validatePayload(parsed, cur)) throw fault('invalid');
          if (cur.deviceId === me()) return { gen: Number(cur.gen) || 1, payload: cur.payload, doc: cur }; // כבר שלי (גם commit קודם שהתשובה שלו אבדה)
          const next = Object.assign({}, cur, { deviceId: me(), deviceName: name(), gen: (Number(cur.gen) || 1) + 1, openKey, parked: false,
            updatedAt: now(), scanRunning: false, scanStartedAt: null, scanBeat: 0 });
          expectGen = next.gen;
          t.set(ref, next);
          return { gen: next.gen, payload: cur.payload, doc: next };
        }, T.take);
        taking = false;
        try { applyTaken(sessionId, res); }
        catch (applyError) { emit(); notice('apply-failed', { sessionId }); return { ok: false, reason: 'apply' }; } // העותק בצד נשאר
        return { ok: true };
      } catch (e) {
        taking = false;
        if (e.commitSent) {
          checking = { type: 'take', sessionId, gen: expectGen, undo, settledOk: false };
          syncWatches(); emit();
          awaitSettle(e.settled, sessionId);
          return { ok: false, unknown: true };
        }
        if (undo) undo();
        const code = errorCode(e);
        const d = draft();
        if (['saved', 'canceled'].includes(code) && !d.empty && d.sessionId === sessionId) setAway(sessionId, code, e.doc || null);
        emit(); schedule(T.debounce);
        return { ok: false, reason: code };
      }
    }

    // ---- "לא ידוע" (commit נשלח והתשובה לא הגיעה) — השרת מכריע ----
    // מחכים שהטרנזקציה תיגמר (או לתקרה, אם היא תקועה), ועוד רגע — ואז קוראים את המסמך מהשרת
    function awaitSettle(settled, sessionId) {
      let done = false;
      const go = () => { if (done) return; done = true; timers.set(() => { if (checking && checking.sessionId === sessionId) { checking.settledOk = true; resolveCheckingFromServer(); } }, T.grace); };
      settled.then(go); timers.set(go, T.settleCap);
    }
    async function resolveCheckingFromServer() {
      if (!checking || !checking.settledOk) return;
      const c = checking;
      if (typeof fs.getDocFromServer !== 'function') return; // יוכרע מה-snapshot הבא מהשרת
      try {
        const snap = await Promise.race([fs.getDocFromServer(handoffRef(c.sessionId)),
          new Promise((_, reject) => timers.set(() => reject(fault('timeout')), T.read))]);
        if (checking === c) resolveChecking(exists(snap) ? snap.data() : null);
      } catch (e) { scheduleRetry(); }
    }
    function resolveChecking(cur) {
      const c = checking; if (!c) return;
      checking = null;
      if (c.type === 'take') {
        if (cur && cur.state === 'open' && cur.deviceId === me() && (c.gen == null || Number(cur.gen) === c.gen) && cur.payload != null) {
          try { applyTaken(c.sessionId, { gen: Number(cur.gen), payload: cur.payload, doc: cur }); notice('take-done'); }
          catch (e) { notice('take-failed'); }
        } else { if (c.undo) c.undo(); notice('take-failed', { state: cur && cur.state }); }
      } else if (c.type === 'finish') {
        if (cur && cur.state === 'saved' && cur.savedBy && cur.savedBy.deviceId === me() && cur.savedBy.sessionId === c.sessionId) {
          afterClose(c.sessionId);
          try { A.finishedLate && A.finishedLate(c.sessionId); } catch (e) {}
          notice('finish-done');
        } else notice('finish-not-saved');
      }
      syncWatches(); emit();
      schedule(T.debounce);
    }

    // ---- שמירה סופית ----
    function afterClose(sessionId) {
      if (claimFor(sessionId)) writeKey(K.claim, null);
      clearAway(sessionId);
      writeKey(K.side, sideList().filter(x => x.sessionId !== sessionId));
      closedHere.add(sessionId);
    }
    async function finish(recordId, data) {
      const d0 = draft();
      if (d0.empty) return { ok: false, reason: 'empty' };
      recordId = safeId(recordId || d0.recordId);
      if (!cloudReady()) return { ok: false, reason: 'no-cloud' };
      if (!online()) return { ok: false, reason: 'offline' };
      if (finishing || taking || checking) return { ok: false, reason: 'busy' };
      const a = awayFor(d0.sessionId); if (a) return { ok: false, reason: a.away };
      finishing = true; emit();
      const fp = fingerprint(d0);
      // גיבוי שבדרך — מחכים לו (אחרת השמירה מתנגשת בו ונכשלת)
      if (debounceTimer) { timers.clear(debounceTimer); debounceTimer = null; }
      if (writing) { try { await writing; } catch (e) {} }
      const d = d0;
      const attempt = () => transaction(async t => {
        const ref = handoffRef(d.sessionId);
        const hs = await t.get(ref), rs = await t.get(recordRef(recordId));
        const extra = A.finishReads ? await A.finishReads(t, { sessionId: d.sessionId, recordId }) : null;
        const cur = exists(hs) ? hs.data() : null, rec = exists(rs) ? rs.data() : null;
        const mine = by => by && by.deviceId === me() && by.sessionId === d.sessionId;
        // "כבר נשמר" רק אם נשמר בדיוק התוכן הזה; שמירה קודמת שלי עם תוכן אחר (נכנסה באיחור) — לא "הצלחה"
        const already = by => { if (by.fp == null || by.fp === fp) return { already: true }; throw fault('saved-late', null, { doc: cur }); };
        if (cur && cur.state === 'saved' && mine(cur.savedBy)) return already(cur.savedBy);
        if (cur && cur.state !== 'open') throw fault(cur.state === 'canceled' ? 'canceled' : 'saved', null, { doc: cur });
        if (cur && cur.deviceId !== me()) throw fault('moved', null, { doc: cur });
        if (!d.expected) {
          if (rec) { if (mine(rec.savedBy)) return already(rec.savedBy); throw fault('exists'); }
        } else {
          if (!rec) throw fault('changed');
          // "id" שנכתב לתוך המסמך (שחזור מסל / ביטול מחיקה) — לא שינוי
          if (!equal(without(rec, 'id'), without(d.expected, 'id'))) { if (mine(rec.savedBy)) return already(rec.savedBy); throw fault('changed'); }
        }
        const c = claimFor(d.sessionId);
        const savedBy = { deviceId: me(), sessionId: d.sessionId, gen: cur ? Number(cur.gen) || 1 : (c ? c.gen : 0), fp };
        t.set(recordRef(recordId), Object.assign({}, data, { savedBy }));
        if (A.finishWrites) A.finishWrites(t, { sessionId: d.sessionId, recordId, savedBy, extra });
        t.set(ref, closedDoc(cur, d, 'saved', savedBy));
        return { savedBy };
      }, T.finish);
      try {
        let out;
        try { out = await attempt(); }
        catch (e) { if (errorCode(e) === 'aborted' && !e.commitSent && online()) out = await attempt(); else throw e; } // התנגשות — עוד ניסיון אחד (הקריאות מחליטות מחדש)
        afterClose(d.sessionId);
        return { ok: true, already: !!out.already };
      } catch (e) {
        if (e.commitSent) {
          checking = { type: 'finish', sessionId: d.sessionId, settledOk: false };
          syncWatches(); emit();
          awaitSettle(e.settled, d.sessionId);
          return { ok: false, unknown: true };
        }
        const code = errorCode(e);
        if (['moved', 'saved', 'canceled'].includes(code)) { setAway(d.sessionId, code, e.doc || null); syncWatches(); }
        if (code === 'exists') { setAway(d.sessionId, 'saved', null); queueClose({ mode: 'park', sessionId: d.sessionId, gen: 0 }); syncWatches(); } // נשמרה ממקום אחר — "נקה" בלי למחוק כלום; המסמך יורד מההצעות
        // השמירה הקודמת שלי נכנסה עם תוכן אחר — מה שבטלפון נשמר בצד (גלוי), והקליטה "נשמרה"
        if (code === 'saved-late') { const by = (e.doc && e.doc.savedBy) || { deviceId: me(), sessionId: d.sessionId, fp: 'other' }; keepLate(d.sessionId, { savedBy: by }, d); setAway(d.sessionId, 'saved', e.doc || null); syncWatches(); }
        return { ok: false, reason: code };
      } finally {
        finishing = false; emit();
        if (!checking) schedule(0); // הגיבוי שנדחה בשביל השמירה — יוצא עכשיו (אם השמירה לא הצליחה)
      }
    }

    // ---- ביטול, ניקוי, פתיחת עותק ----
    function cancel(meta) {
      const d = draft(); if (d.empty) return;
      const c = claimFor(d.sessionId), a = awayFor(d.sessionId);
      closedHere.add(d.sessionId);
      if (!a && cloudReady()) queueClose({ mode: 'cancel', sessionId: d.sessionId, recordId: d.recordId, gen: c ? c.gen : null,
        legacy: !c && isLegacy(d.sessionId), editsExisting: !!d.expected, summary: {}, meta: meta || {} });
      else if (!cloudReady()) { try { A.onClosed && A.onClosed(meta || {}, d.sessionId); } catch (e) {} } // בלי ענן — כמו פעם
      if (c) writeKey(K.claim, null);
      clearAway(d.sessionId);
    }
    function clear() {
      const d0 = draft(); if (d0.empty) return { ok: true };
      const a = awayFor(d0.sessionId);
      if (!a || a.away !== 'saved') {
        const d = withPayload(d0);
        if (d.payload != null) { const put = sidePut(sideEntry(d, a && a.away === 'canceled' ? 'canceled' : 'same')); if (!put.ok) return { ok: false, reason: put.reason }; }
      } else writeKey(K.side, sideList().filter(x => x.sessionId !== d0.sessionId || x.reason === 'late')); // נשמרה — העותקים הישנים שלה יורדים (חוץ ממה שנעשה אחרי השמירה)
      if (claimFor(d0.sessionId)) writeKey(K.claim, null);
      clearAway(d0.sessionId);
      A.emptyDraft && A.emptyDraft();
      syncWatches(); emit();
      return { ok: true };
    }
    function dropSide(sessionId) {
      sessionId = safeId(sessionId);
      writeKey(K.side, sideList().filter(x => x.sessionId !== sessionId)); emit();
      return { ok: true };
    }
    function openSide(sessionId) {
      sessionId = safeId(sessionId);
      const entry = sideList().find(x => x.sessionId === sessionId); if (!entry) return { ok: false, reason: 'gone' };
      // מה שנשמר באיחור — לא נפתח כטיוטה (התעודה כבר נשמרה); בוטלה — נפתחת כקליטה חדשה (אם המתאם יודע)
      if (entry.reason === 'late') return { ok: false, reason: 'late' };
      const revive = entry.reason === 'canceled';
      if (revive && (entry.expected || !A.reviveDraft)) return { ok: false, reason: 'cannot-revive' };
      const d0 = draft();
      if (!d0.empty && d0.scanRunning) return { ok: false, reason: 'scan-running-here' };
      // העותק יוצא מהרשימה; מה שעל המסך נכנס במקומו (אותה טיוטה — מחליפים בין שתי הגרסאות, ושתיהן נשארות)
      const rest = sideList().filter(x => x.sessionId !== sessionId);
      writeKey(K.side, rest);
      if (!d0.empty) {
        const d = withPayload(d0);
        if (d.payload != null) {
          const put = sidePut(sideEntry(d, d.sessionId === sessionId ? 'same' : 'other'));
          if (!put.ok) { writeKey(K.side, rest.concat([entry])); return { ok: false, reason: put.reason }; }
        }
      }
      if (revive) {
        const newId = safeId(A.reviveDraft(entry.payload));
        setClaim(newId, 0, null); clearAway(); currentDoc = null;
        syncWatches(); emit(); schedule(0);
        return { ok: true, sessionId: newId };
      }
      A.applyPayload(entry.payload, { source: 'side' });
      if (entry.legacy) { if (claimFor(sessionId)) writeKey(K.claim, null); }
      else setClaim(sessionId, entry.gen || 0, null);
      clearAway(sessionId); currentDoc = null; closedHere.delete(sessionId);
      syncWatches(); emit(); schedule(0);
      return { ok: true };
    }

    // דופק בזמן קריאה בתשלום: כל דקה המסמך מתעדכן, וחלון ההמתנה בטלפון האחר מתחיל מחדש
    function beat() {
      if (beatTimer) { timers.clear(beatTimer); beatTimer = null; }
      if (stopped || !lastScan) return;
      beatTimer = timers.set(() => { beatTimer = null; if (lastScan) { scanBeat++; schedule(0); beat(); } }, T.scanBeat);
    }

    // ---- ציבורי ----
    const api = {
      version: VERSION,
      deviceId: me,
      start() {
        if (started) return; started = true;
        // הטיוטה שפתוחה כשהמנגנון עולה לראשונה בטלפון — מלפני המנגנון: לא נתבעת עד שהיא באמת משתנה כאן
        if (readKey(K.legacy, null) == null) { const d = draft(); writeKey(K.legacy, { sessionId: d.empty || claimFor(d.sessionId) ? null : d.sessionId, at: now() }); }
        const d = draft();
        if (!d.empty && isLegacy(d.sessionId)) legacyStartPayload = fingerprint(d);
        sideTidy();
        noticeGone(d); // טיוטה שהייתה של הטלפון הזה ונעלמה לפני שנסגר — יורדת מההצעות
        if (cloudReady()) {
          startQuery(); syncWatches();
          const on = (target, type, fn) => { try { target && target.addEventListener && target.addEventListener(type, fn); } catch (e) {} };
          if (o.lifecycle !== false) {
            on(global, 'online', retryAll);
            on(global.document, 'visibilitychange', () => { const v = global.document && global.document.visibilityState; if (v === 'hidden') api.flush(); else retryAll(); });
            on(global, 'pagehide', () => api.flush());
          }
          retryAll();
        }
        emit();
      },
      changed(opts) {
        const d = draft();
        noticeGone(d);
        // הטיוטה חזרה לעבודה לפני ש"החנייה" שלה נשלחה — לא חונים
        if (!d.empty && !awayFor(d.sessionId) && closeQueue().some(x => x.sessionId === d.sessionId && x.mode === 'park')) {
          writeKey(K.close, closeQueue().filter(x => !(x.sessionId === d.sessionId && x.mode === 'park')));
        }
        if (opts && opts.user) api.userEdit(d);
        syncWatches(d);
        const scan = !d.empty && d.scanRunning;
        if (scan !== lastScan) { lastScan = scan; scanStartedLocal = scan ? now() : null; scanBeat = 0; schedule(0); beat(); }
        else schedule(T.debounce);
        emit();
      },
      userEdit(d) {
        d = d || draft();
        if (d.empty || !isLegacy(d.sessionId) || awayFor(d.sessionId)) return;
        // רק שינוי אמיתי בתוכן — לא כל לחיצה על המסך
        // לפי טביעת התוכן (מה שנספר/הוקלד) — לא לפי מצב תצוגה (פתיחת בורר, פרטי קריאה)
        if (fingerprint(d) !== legacyStartPayload) setClaim(d.sessionId, 0);
      },
      flush() { schedule(0); },
      retry: retryAll,
      tidy() { const before = sideList().length; sideTidy(); if (sideList().length !== before) emit(); },
      // עותק בצד מבחוץ (למשל טיוטה שנשמרה בצד בגרסה קודמת של האפליקציה) — כדי שתהיה לו דרך חזרה
      importSide(entry) {
        if (!entry || !entry.sessionId || typeof entry.payload !== 'string') return { ok: false, reason: 'invalid' };
        if (sideList().some(x => x.sessionId === safeId(entry.sessionId))) return { ok: true };
        const put = sidePut({ savedAt: Number(entry.savedAt) || now(), sessionId: safeId(entry.sessionId), recordId: safeId(entry.recordId || entry.sessionId),
          gen: null, legacy: true, reason: entry.reason || 'other', summary: entry.summary || {}, payload: entry.payload, expected: !!entry.expected });
        if (put.ok) emit();
        return put;
      },
      // עוצר מאזינים וטיימרים (מעבר בין מצבים, בדיקות)
      stop() {
        stopped = true;
        try { unsubQuery && unsubQuery(); } catch (e) {} unsubQuery = null;
        unwatchExcept([]);
        [debounceTimer, retryTimer, scanTimer, beatTimer].forEach(t => { if (t) timers.clear(t); });
        debounceTimer = retryTimer = scanTimer = beatTimer = null;
      },
      take, finish, cancel, clear, openSide, dropSide,
      // זול: בלי ה-payload (נקרא בכל לחיצה)
      state() {
        const d = draft(), a = d.empty ? null : awayFor(d.sessionId);
        const cur = currentDoc && !d.empty && currentDoc.sessionId === d.sessionId ? currentDoc : null;
        const sides = sideList().filter(x => !recordSaved(x)).map(x => ({ sessionId: x.sessionId, savedAt: x.savedAt, reason: x.reason, summary: x.summary || {},
          canOpen: x.reason !== 'late' && !(x.reason === 'canceled' && (x.expected || !A.reviveDraft)) }));
        const sideIds = new Set(sides.map(x => x.sessionId));
        const offers = !offersFromServer ? [] : offerDocs.filter(x => (d.empty || x.sessionId !== d.sessionId) && !sideIds.has(x.sessionId)
          && !((closing(x.sessionId) || closedHere.has(x.sessionId)) && x.deviceId === me())
          && !(!x.editsExisting && recordSaved({ recordId: x.recordId, reason: 'offer' }))).map(x => ({
          sessionId: x.sessionId, mine: x.deviceId === me(), deviceName: x.deviceName || '', updatedAt: Number(x.updatedAt) || 0,
          summary: x.summary || {}, scanRunning: scanWindowOpen(x), tooBig: !!x.tooBig || x.payload == null,
          button: !x.tooBig && x.payload != null && !scanWindowOpen(x) }));
        const scanThere = !!(a && a.away === 'moved' && cur && cur.state === 'open' && scanWindowOpen(cur));
        const canTakeBack = !!(a && a.away === 'moved' && cur && cur.state === 'open' && cur.deviceId !== me() && !cur.tooBig && cur.payload != null && !scanThere);
        return {
          enabled: cloudReady(), status, tooBig: tooBigNow && status === 'too-big', deviceId: me(),
          sessionId: d.empty ? null : d.sessionId,
          legacy: !d.empty && isLegacy(d.sessionId),
          away: a ? { away: a.away, by: a.by, at: a.at, localAhead: !!a.localAhead } : null,
          scanThere,
          checking: checking ? checking.type : null,
          busy: taking || finishing,
          readOnly: !!a || !!checking || taking,
          canTakeBack,
          offers,
          // בצד: כשאין טיוטה פתוחה — הכל; כשיש — גם הגרסה הקודמת של אותה טיוטה (כדי שלא תיעלם בשקט)
          side: d.empty ? sides : sides.filter(x => x.sessionId === d.sessionId),
          closesPending: closeQueue().length
        };
      },
      // לבדיקות ולאבחון
      _debug: () => ({ claim: claim(), away: away(), side: sideList(), close: closeQueue(), legacy: readKey(K.legacy, null), currentDoc, offerDocs, checking, status })
    };
    return api;
  }
  global.DraftHandoff = { create, version: VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this);
