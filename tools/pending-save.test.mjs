// v421 — שמירה שלא אושרה אינה משאירה את הקליטה נעולה ובלי הסבר; ושמירת התעודה אינה מחכה למנתח (כמו תנובה 166, ברמן 156–157 ו-176).
// 26–27.11.2026: בתנובה (165) "אשר וקלוט" נשלח לענן ולא הגיע אישור; מאז כל לחיצה נבלעה, והפס לא אמר מה קרה — "עכשיו אני חסום
// לא יודע מה קורה פה". אותו מבנה כאן (420): שומר הלחיצות (guardDraftEvent) עוצר גם את "אשר וקלוט" — "בקשת הסיום עדיין לא אושרה —
// לחץ ״בדוק ושמור שוב״ למעלה", כשהפס מוסתר מאחורי חלון הסיכום; וכשהקליטה השתנתה מאז ניסיון שלא הגיע לענן, "בדוק ושמור שוב"
// לא משחרר אף פעם. ועוד: כשהמנתח רץ ("הרץ את המנתח", או אחרי סריקה ממסך ההשוואה), השמירה נדחתה — "קריאת התעודה עדיין רצה".
// כל הלחיצות כאן עוברות דרך שומר הלחיצות, כמו בטלפון — לא קריאה ישירה ל-confirmReceipt.
// 1. "אשר וקלוט" אחרי שמירה בלי תשובה: הלחיצה מגיעה, בודקת, שומרת פעם אחת והחלון נסגר.
// 2. הפס שלמעלה: מה קרה ומה לוחצים; "בודק ושומר…" בזמן הבדיקה; כפתור אחר — אותו הסבר; "בדוק ושמור שוב" שומר.
// 3. עדיין אין חיבור: נשאר נעול, בלי שמירה.
// 4. הניסיון הישן לא הגיע לענן והקליטה השתנתה מאז: הוא יורד, ו"אשר וקלוט" שומר את מה שיש עכשיו — באותה לחיצה, פעם אחת.
// 5. הניסיון הישן כן נשמר והקליטה השתנתה מאז: לא נשמר שוב ולא נדרס; ההודעה מפנה ל"שמור עותק בצד לבדיקה", שמפנה את המסך.
// 6. בלי תשובה מהשרת על הניסיון הישן: לא מוותרים עליו.
// 7. לחיצה נוספת בזמן שהבדיקה רצה נעצרת, ונשמר פעם אחת.
// 8. המנתח רץ: "אשר וקלוט" שומר מיד; התשובה שלו, כשהיא מגיעה, אינה משנה דבר. והשורה "בלי לחכות" רק כשהסגירה פתוחה.
// 9. מנתח שעונה לפני השמירה — מוביל, כמו עד היום.
// 10. סגירה ופתיחה של האפליקציה עם ניסיון תלוי: הפס מופיע, ו"בדוק ושמור שוב" שומר.
// 11. הגרסה.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as harness from './receipt-scan-harness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(n = 40) { for (let i = 0; i < n; i++) await tick(); }
const strip = s => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const OLD = /בקשת הסיום עדיין לא אושרה|בקשת הסיום ממתינה לאישור/;
const LOCKED = 'הקליטה נעולה עד שהשמירה תאושר. לחץ ״בדוק ושמור שוב״ בפס שלמעלה.';
const SAVING = 'הקליטה נשמרת עכשיו — רגע אחד.';
const NO_REPLY = 'אין חיבור — הטיוטה נשארה בטלפון הזה. נסה לסיים שוב כשיש רשת.';
const NO_WAIT = 'אפשר לסגור את התעודה בלי לחכות לו';
const SPINNER = 'המנתח מסביר את הפער…';
const saved = cloud => [...cloud.documents.entries()].filter(([key]) => key.includes('/receipts/')).map(([, value]) => value);
const items = rc => rc.items.map(item => [item.productId, item.qty, item.noteQty]);
const banner = r => { r.run('renderDraftHandoffBanner()'); return strip(r.node('draftHandoffBanner').innerHTML); };
const summaryOpen = r => !r.node('receiptSummaryModal').classList.contains('hidden');
const analyses = r => r.requests.filter(q => q.body && JSON.parse(q.body).mode === 'analyze').length;
const JOURNAL = "HANDOFF_PREFIX+'_receiving_final_v1'";
const SESSION = 'handoffSession({draftId:receiptDraftId,attach:receiptAttachTarget})';

// לחיצה כמו בטלפון: קודם שומר הלחיצות שעל המסמך, ורק אם הוא לא עצר — המאזין של הכפתור עצמו.
// start: true — לא מחכה לסיום; מחזיר { work } (עטוף, כי פונקציה אסינכרונית שמחזירה Promise מחכה לו).
async function tap(r, { id = '', role = '', inside }, { start = false } = {}) {
  let stopped = false;
  const el = { id, dataset: role ? { role } : {} };
  el.closest = selector => (selector === '[id]' && id) || (selector === '[data-role]' && role) || selector.split(',').includes(inside) ? el : null;
  r.context.__tap = { type: 'click', target: el, preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
  r.run('guardDraftEvent(__tap)');
  if (stopped) return 'blocked';
  const work = id ? r.events.get(id + ':click')?.() : role ? r.events.get('app:click')?.({ target: el }) : null;
  if (start) return { work };
  await work; await settle();
  return 'ran';
}
const OK_BUTTON = { id: 'rs_ok', inside: '#receiptSummaryModal' };
const confirmTap = (r, opts) => tap(r, OK_BUTTON, opts);
const bannerTap = (r, action) => r.events.get('draftHandoffBanner:click')({ target: { closest: s => s === '[data-handoff]' ? { dataset: { handoff: action, kind: 'receiving' } } : null } });
async function idle(r) { for (let i = 0; i < 20 && r.run('receiptFinalizing || !!handoffFinalizing.receiving'); i++) await settle(); }

// הנייר (ה-fixture של ה-harness): חלב ×10 ב-₪5, נספרו 9 — "חסר 1". עד מסך ההשוואה.
// קריאה מהשרת (getDocFromServer) עוברת דרך עטיפה, כדי שבדיקה תוכל לומר "השרת לא עונה" (readFailure).
async function toCompare({ storage = new Map(), cloud = harness.fakeCloud() } = {}) {
  const r = harness.runtime('yotvata', { cloud, storage });
  await cloud.tick();
  const read = r.context.getDocFromServer;
  r.context.getDocFromServer = (...args) => r.context.readFailure ? Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })) : read(...args);
  r.run('openScanner=()=>{}; closeScanner=()=>{}; scanBeep=()=>{}; buzz=()=>{}; refreshScanHost=()=>{}; showConfirm=(title,message,label,cb)=>cb();');
  await r.scan(1);
  r.run('finishReceipt()'); await settle();
  assert.equal(r.run('rcStep'), 'ai');
  assert.equal(r.run('aiScanEvaluation.valid'), true, 'המנוע סגר את החשבון: חסר 1');
  return { r, cloud, storage };
}
// ...ועד חלון הסיכום
async function toSummary(opts) {
  const p = await toCompare(opts);
  p.r.click('ai-confirm-findings'); p.r.click('ai-apply'); await settle();
  assert.ok(p.r.run('!!pendingReceipt') && summaryOpen(p.r), 'חלון הסיכום פתוח');
  return p;
}
// "אשר וקלוט" והענן לא עונה: הניסיון נשאר תלוי והקליטה נעולה.
async function lostSave(r) {
  r.context.networkFailure = true;
  assert.equal(await confirmTap(r), 'ran');
  r.context.networkFailure = false;
  assert.equal(r.run('localReceiptPending()'), true, 'הניסיון תלוי');
  assert.equal(r.run("canEditDraft('receiving', true)"), false, 'הקליטה נעולה');
  assert.equal(r.toasts.at(-1), NO_REPLY);
  // הפס כמו שנשאר על המסך (בלי ציור יזום של הבדיקה): עם הכפתור — לא "בודק ושומר…" שנשאר מזמן השמירה
  const left = strip(r.node('draftHandoffBanner').innerHTML);
  assert.ok(left.includes('השמירה נשלחה, ועוד לא הגיע אישור מהענן.') && left.includes('בדוק ושמור שוב') && !left.includes('בודק ושומר'), left);
}
// הקליטה השתנתה אחרי הניסיון: הטביעה של הניסיון השמור כבר אינה הטביעה של עכשיו (והנתונים שלו — לא מה שעל המסך).
function changedSince(r, { data = true } = {}) {
  r.run(`{ const list = JSON.parse(localStorage.getItem(${JOURNAL})), a = list[${SESSION}];
    a.fingerprint = 'changed-since'; ${data ? 'a.data.items[0].qty = 4;' : ''} localStorage.setItem(${JOURNAL}, JSON.stringify(list)); }`);
}

test('1. "אשר וקלוט" אחרי שמירה בלי תשובה: הלחיצה מגיעה, בודקת, שומרת פעם אחת והחלון נסגר (עד 420 נבלעה)', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  assert.ok(summaryOpen(r), 'אחרי שמירה בלי תשובה החלון נשאר פתוח');
  assert.equal(saved(cloud).length, 0);
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran', 'שומר הלחיצות מעביר את "אשר וקלוט"');
  assert.equal(r.run('localReceiptPending()'), false);
  assert.equal(saved(cloud).length, 1, 'נשמרה פעם אחת');
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]]);
  assert.equal(summaryOpen(r), false);
  assert.equal(r.run('currentView'), 'receiptsHistory');
  assert.equal(r.run('receiptList.length'), 0);
  assert.ok(r.toasts.includes('התעודה נשמרה ✓'), r.toasts.join(' | '));
  assert.ok(!r.toasts.some(t => OLD.test(t)), r.toasts.join(' | '));
});

test('2. הפס שלמעלה: מה קרה, שלא אבד כלום ומה לוחצים; "בודק ושומר…" בזמן הבדיקה; כפתור אחר — אותו הסבר; "בדוק ושמור שוב" שומר', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  assert.equal(await tap(r, { id: 'rs_cancel', inside: '#receiptSummaryModal' }), 'ran');
  assert.equal(summaryOpen(r), false, '"חזרה" סוגר את החלון גם בזמן נעילה');
  assert.equal(await tap(r, { role: 'rc-recon-cancel', inside: '#app' }), 'ran');
  assert.equal(r.run('currentView'), 'receiving');
  let text = banner(r);
  assert.ok(text.includes('השמירה נשלחה, ועוד לא הגיע אישור מהענן. שום דבר לא אבד — הקליטה שמורה בטלפון הזה. עד שהשמירה תאושר, הקליטה נעולה. בדוק ושמור שוב לא עובר? סגור את האפליקציה, פתח אותה שוב ולחץ כאן שוב. שמור עותק בצד לבדיקה'), text);
  assert.doesNotMatch(text, OLD);
  r.toasts.length = 0;
  assert.equal(await tap(r, { role: 'rc-quantity-lines', inside: '#app' }), 'blocked');
  assert.equal(r.toasts.at(-1), LOCKED);
  // "בדוק ושמור שוב" כשהענן איטי: הפס אומר "בודק ושומר…", בלי כפתורים
  let release; cloud.commitGate = new Promise(resolve => { release = resolve; });
  bannerTap(r, 'retry-final');
  await settle();
  assert.equal(r.run('receiptFinalizing'), true);
  text = strip(r.node('draftHandoffBanner').innerHTML);
  assert.ok(text.includes('בודק ושומר… זה לוקח פחות מדקה. שום דבר לא אבד — הקליטה שמורה בטלפון הזה.'), text);
  assert.ok(!r.node('draftHandoffBanner').innerHTML.includes('data-handoff="retry-final"') && !r.node('draftHandoffBanner').innerHTML.includes('data-handoff="archive-final"'), 'בזמן הבדיקה — בלי כפתורים');
  r.toasts.length = 0;
  assert.equal(await tap(r, { role: 'rc-quantity-lines', inside: '#app' }), 'blocked');
  assert.equal(r.toasts.at(-1), SAVING, 'בזמן הבדיקה ההודעה אומרת שהשמירה רצה (עד 420: "לחץ בדוק ושמור שוב" גם אז)');
  release(); cloud.commitGate = null;
  await idle(r);
  assert.equal(saved(cloud).length, 1);
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]]);
  assert.equal(r.run('localReceiptPending()'), false);
  assert.equal(r.run('currentView'), 'receiptsHistory');
  assert.ok(r.toasts.includes('התעודה נשמרה ✓'), r.toasts.join(' | '));
});

test('3. עדיין אין חיבור: נשאר נעול, בלי שמירה; כשהחיבור חוזר — לחיצה אחת שומרת', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  r.context.networkFailure = true;
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran');
  assert.equal(r.run('localReceiptPending()'), true);
  assert.equal(saved(cloud).length, 0);
  assert.ok(summaryOpen(r));
  assert.equal(r.toasts.at(-1), NO_REPLY);
  assert.ok(banner(r).includes('בדוק ושמור שוב'), 'הפס חזר עם הכפתור');
  r.context.networkFailure = false;
  assert.equal(await confirmTap(r), 'ran');
  assert.equal(saved(cloud).length, 1);
  assert.equal(r.run('localReceiptPending()'), false);
});

test('4. הניסיון הישן לא הגיע לענן והקליטה השתנתה מאז: הוא יורד, ו"אשר וקלוט" שומר את מה שיש עכשיו — באותה לחיצה, פעם אחת (עד 420: נעול)', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  changedSince(r);
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran');
  assert.ok(r.toasts.includes('השמירה הקודמת לא הגיעה לענן, והקליטה השתנתה מאז. הקליטה פתוחה שוב — בדוק ולחץ ״אשר וקלוט״.'), r.toasts.join(' | '));
  assert.equal(saved(cloud).length, 1, 'נשמרה פעם אחת');
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]], 'מה שעל המסך — לא הנתונים של הניסיון הישן (4)');
  assert.equal(r.run('localReceiptPending()'), false);
  assert.equal(summaryOpen(r), false);
  assert.equal(r.run('currentView'), 'receiptsHistory');
  // אותו מצב מהפס: "בדוק ושמור שוב" מוריד את הניסיון ופותח את הקליטה (עד 420 הוא נשאר לנצח)
  const b = await toSummary();
  await lostSave(b.r); changedSince(b.r);
  await bannerTap(b.r, 'retry-final'); await idle(b.r);
  assert.equal(b.r.run('localReceiptPending()'), false, 'הניסיון ירד');
  assert.equal(b.r.run("canEditDraft('receiving', true)"), true, 'הקליטה פתוחה שוב');
  assert.equal(saved(b.cloud).length, 0, 'הניסיון הישן לא נשלח');
  assert.equal(await confirmTap(b.r), 'ran');
  assert.deepEqual(items(saved(b.cloud)[0]), [['milk', 9, 10]]);
});

test('5. הניסיון הישן כן נשמר והקליטה השתנתה מאז: לא נשמר שוב ולא נדרס; ההודעה מפנה ל"שמור עותק בצד לבדיקה", שמפנה את המסך', async () => {
  const { r, cloud, storage } = await toSummary();
  // נכתב בשרת, התשובה אבדה, וגם הבדיקה מהשרת לא ענתה — הניסיון תלוי, והתעודה כבר בענן
  cloud.loseReplyAfterCommit = true; r.context.readFailure = true;
  assert.equal(await confirmTap(r), 'ran');
  cloud.loseReplyAfterCommit = false; r.context.readFailure = false;
  assert.equal(r.run('localReceiptPending()'), true);
  assert.equal(saved(cloud).length, 1);
  const token = saved(cloud)[0].localFinal.token;
  changedSince(r, { data: false });
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran');
  assert.ok(r.toasts.includes('התעודה כבר נשמרה בענן, בלי מה ששונה כאן אחר כך. ״שמור עותק בצד לבדיקה״ בפס שלמעלה מפנה את המסך; את השינויים בדוק מול ההיסטוריה.'), r.toasts.join(' | '));
  assert.equal(saved(cloud).length, 1, 'לא נשמרה פעם שנייה');
  assert.equal(saved(cloud)[0].localFinal.token, token, 'ולא נדרסה');
  assert.equal(r.run('localReceiptPending()'), true, 'הניסיון נשאר — ואיתו הכפתור "שמור עותק בצד לבדיקה"');
  assert.ok(banner(r).includes('שמור עותק בצד לבדיקה'));
  // "שמור עותק בצד לבדיקה": המסך מתפנה, והעותק נשמר בטלפון
  assert.equal(await tap(r, { id: 'rs_cancel', inside: '#receiptSummaryModal' }), 'ran');
  r.run(`{ const list = JSON.parse(localStorage.getItem(${JOURNAL})); list[${SESSION}].fingerprint = handoffFingerprint('receiving'); localStorage.setItem(${JOURNAL}, JSON.stringify(list)); }`);
  await bannerTap(r, 'archive-final'); await settle();
  assert.equal(r.run('receiptList.length'), 0, 'המסך התפנה');
  assert.equal(r.run("canEditDraft('receiving', true)"), true);
  assert.equal(JSON.parse(storage.get(r.run("HANDOFF_PREFIX+'_local_receiving_archive'"))).length, 1, 'העותק נשמר בצד');
  assert.equal(saved(cloud).length, 1);
});

test('6. בלי תשובה מהשרת על הניסיון הישן: לא מוותרים עליו — נשאר תלוי עד שיש תשובה, ואז יורד ונשמר מה שיש עכשיו', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  changedSince(r);
  r.context.readFailure = true;
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran');
  assert.equal(r.run('localReceiptPending()'), true, 'בלי תשובה — נשאר תלוי');
  assert.equal(saved(cloud).length, 0);
  assert.equal(r.run(`JSON.parse(localStorage.getItem(${JOURNAL}))[${SESSION}].fingerprint`), 'changed-since', 'הניסיון הישן נשמר כמו שהיה');
  assert.equal(r.toasts.at(-1), 'לא ניתן לאמת מול הענן את השמירה הקודמת, והקליטה השתנתה מאז. שום דבר לא אבד — נסה שוב כשיש חיבור, או ״שמור עותק בצד לבדיקה״.');
  r.context.readFailure = false;
  assert.equal(await confirmTap(r), 'ran');
  assert.equal(saved(cloud).length, 1);
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]]);
  assert.equal(r.run('localReceiptPending()'), false);
});

test('7. לחיצה נוספת על "אשר וקלוט" בזמן שהבדיקה רצה נעצרת, והתעודה נשמרת פעם אחת; בלי ניסיון תלוי — כמו תמיד', async () => {
  const { r, cloud } = await toSummary();
  await lostSave(r);
  let release; cloud.commitGate = new Promise(resolve => { release = resolve; });
  const { work } = await confirmTap(r, { start: true });
  await settle();
  assert.equal(r.run('receiptFinalizing'), true, 'הבדיקה רצה');
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'blocked', 'לחיצה כפולה לא מתחילה שמירה שנייה');
  assert.equal(r.toasts.at(-1), SAVING);
  release(); cloud.commitGate = null;
  await work; await settle();
  assert.equal(saved(cloud).length, 1);
  assert.equal(r.run('localReceiptPending()'), false);
  assert.equal(r.run('currentView'), 'receiptsHistory');
  // בלי ניסיון תלוי: שמירה רגילה, ולחיצה כפולה בזמן שהיא רצה נעצרת
  const b = await toSummary();
  b.cloud.commitGate = new Promise(resolve => { release = resolve; });
  const first = await confirmTap(b.r, { start: true });
  await settle();
  assert.equal(await confirmTap(b.r), 'blocked');
  release(); b.cloud.commitGate = null;
  await first.work; await settle();
  assert.equal(saved(b.cloud).length, 1);
  assert.ok(b.r.toasts.includes('התעודה נקלטה ✓'), b.r.toasts.join(' | '));
});

// ===== המנתח =====
// ביטבתה המנתח אינו רץ לבד כשמסך ההשוואה נפתח אחרי קריאת התעודה ברקע; הוא רץ אחרי "הרץ את המנתח", או אחרי סריקה ממסך ההשוואה.
// התשובה של השירות מוחזקת עד שהבדיקה משחררת אותה — הסבר שנסגר בדיוק (בדיקה 9 מראה שהוא היה מוביל).
const CLAIMS = [{ kind: 'shortage', productId: 'milk', quantity: 1, amountExVat: 5, evidence: 'שורה 1: 10 יח׳' }];
async function analyzerRunning() {
  const p = await toCompare();
  const { r } = p, original = r.context.fetch, held = [];
  r.context.fetch = (url, options) => {
    if (!(options?.body && JSON.parse(options.body).mode === 'analyze')) return original(url, options);
    r.requests.push({ url: String(url), body: options.body });
    return new Promise(resolve => held.push(() => resolve(harness.reply({ ok: true, analysis: { claims: CLAIMS, summary: 'fixture' } }))));
  };
  assert.equal(r.run('aiAnalyzeBusy'), false, 'המנתח לא רץ לבד כאן');
  r.run('aiRunAnalyzer = auditOriginalAnalyzer');
  r.click('ai-analyze'); await settle(); // "הרץ את המנתח"
  assert.equal(r.run('aiAnalyzeBusy'), true);
  assert.equal(analyses(r), 1);
  return { ...p, release: async () => { assert.ok(held.length, 'המנתח שלח בקשה'); held.shift()(); await settle(); } };
}

test('8. המנתח רץ: "אשר וקלוט" שומר מיד (עד 420: "קריאת התעודה עדיין רצה"); התשובה שלו, כשהיא מגיעה, אינה משנה דבר; והשורה "בלי לחכות" רק כשהסגירה פתוחה', async () => {
  const { r, cloud, storage, release } = await analyzerRunning();
  let html = r.node('app').innerHTML;
  assert.ok(html.includes(SPINNER) && html.includes(NO_WAIT), 'מתחת לספינר: אין צורך לחכות');
  // כשהסגירה נעולה — בלי השורה: שם ייתכן שדווקא המנתח יפתח אותה
  r.run('aiScanEvaluation.valid = false; renderReconcile()');
  html = r.node('app').innerHTML;
  assert.ok(html.includes(SPINNER) && !html.includes(NO_WAIT));
  r.run('aiScanEvaluation.valid = true; renderReconcile()');
  r.click('ai-confirm-findings'); r.click('ai-apply'); await settle();
  assert.ok(summaryOpen(r));
  r.toasts.length = 0;
  assert.equal(await confirmTap(r), 'ran');
  assert.ok(!r.toasts.some(t => /קריאת התעודה עדיין רצה/.test(t)), r.toasts.join(' | '));
  assert.equal(saved(cloud).length, 1, 'התעודה נשמרה');
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]]);
  assert.equal(r.run('receiptList.length'), 0);
  assert.equal(r.run('currentView'), 'receiptsHistory');
  assert.equal(r.run('aiAnalyzeBusy'), false);
  assert.ok(r.toasts.includes('התעודה נקלטה ✓'), r.toasts.join(' | '));
  // המנתח עונה אחרי שהתעודה נשמרה
  const before = JSON.stringify(saved(cloud)), draft = storage.get('yt_receipt_draft');
  await release();
  assert.equal(r.run('aiAnalyzeResult'), null);
  assert.equal(r.run('aiScanEvaluation'), null);
  assert.equal(r.run('currentView'), 'receiptsHistory', 'מסך ההשוואה אינו מצויר מחדש');
  assert.equal(storage.get('yt_receipt_draft'), draft, 'הטיוטה הריקה אינה נכתבת שוב');
  assert.equal(JSON.stringify(saved(cloud)), before);
  assert.equal(analyses(r), 1, 'בלי קריאה נוספת בתשלום');
});

test('9. מנתח שעונה לפני השמירה — מוביל, כמו עד היום, והתעודה נשמרת עם אותן כמויות; ריצה שנותקה אינה מאפסת ריצה חדשה', async () => {
  const { r, cloud, release } = await analyzerRunning();
  await release();
  assert.equal(r.run('aiAnalyzeBusy'), false);
  assert.equal(r.run('!!(aiAnalyzeResult && aiAnalyzeResult.accepted && aiScanEvaluation.analyzerLed)'), true);
  const html = r.node('app').innerHTML;
  assert.ok(html.includes('נסגר בדיוק ✓') && !html.includes(SPINNER) && !html.includes(NO_WAIT));
  r.click('ai-confirm-findings'); r.click('ai-apply'); await settle();
  assert.equal(await confirmTap(r), 'ran');
  assert.equal(saved(cloud).length, 1);
  assert.deepEqual(items(saved(cloud)[0]), [['milk', 9, 10]]);
  // ריצה שנותקה מול ריצה חדשה על אותה הערכה: אותה בקשה (בלי קריאה שנייה בתשלום), והישנה לא מסמנת את החדשה כ"סיימה"
  const b = await analyzerRunning();
  assert.equal(b.r.run('aiAnalyzeDetach()'), true);
  assert.equal(b.r.run('aiAnalyzeBusy'), false);
  assert.equal(b.r.run('aiAnalyzeDetach()'), false, 'אין מה לנתק');
  const again = b.r.run('aiRunAnalyzer()');
  await settle();
  assert.equal(b.r.run('aiAnalyzeBusy'), true);
  assert.equal(analyses(b.r), 1);
  await b.release(); await again;
  assert.equal(b.r.run('aiAnalyzeBusy'), false);
  assert.equal(b.r.run('!!(aiAnalyzeResult && aiAnalyzeResult.accepted && aiScanEvaluation.analyzerLed)'), true);
});

test('10. סגירה ופתיחה של האפליקציה עם ניסיון תלוי (מה שהפס מציע כשזה "לא עובר"): הקליטה חוזרת, הפס מופיע, ו"בדוק ושמור שוב" שומר (עד 420: נעול לנצח)', async () => {
  const a = await toSummary();
  await lostSave(a.r);
  const fingerprint = a.r.run("handoffFingerprint('receiving')");
  // אותו טלפון, אחרי סגירה ופתיחה: אותו זיכרון ואותו ענן, דף חדש — בלי הצילומים, שאינם נשמרים
  const b = harness.runtime('yotvata', { cloud: a.cloud, storage: a.storage });
  await a.cloud.tick();
  assert.equal(b.run('aiScanDocuments[0].pages.length'), 0, 'הצילומים לא חזרו');
  assert.equal(b.run("handoffFingerprint('receiving')"), fingerprint, 'טביעת הקליטה לא משתנה בפתיחה מחדש');
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(SCAN_PAGE_AUDIT_FIELDS.map(f => aiScanResponse.perDocument[0][f]))')), [1, ['?'], [null], [null], ['ok']], 'נתוני הצילום נשארו עם הקריאה');
  assert.equal(b.run('localReceiptPending()'), true, 'הניסיון התלוי נשאר אחרי הפתיחה');
  assert.equal(b.run("canEditDraft('receiving', true)"), false);
  assert.ok(banner(b).includes('השמירה נשלחה, ועוד לא הגיע אישור מהענן.'), banner(b));
  await bannerTap(b, 'retry-final'); await idle(b);
  assert.equal(b.run('localReceiptPending()'), false);
  assert.equal(b.run('currentView'), 'receiptsHistory');
  assert.equal(saved(a.cloud).length, 1, 'נשמרה פעם אחת');
  assert.deepEqual(items(saved(a.cloud)[0]), [['milk', 9, 10]]);
  assert.ok(b.toasts.includes('התעודה נשמרה ✓'), b.toasts.join(' | '));
  // ואם השמירה כן הגיעה לענן ורק התשובה אבדה: אחרי הפתיחה הכפתור מזהה שזו אותה תעודה — נסגר, בלי כפילות ובלי "שינויים מאוחרים"
  const c = await toSummary();
  c.cloud.loseReplyAfterCommit = true; c.r.context.readFailure = true;
  assert.equal(await confirmTap(c.r), 'ran');
  c.cloud.loseReplyAfterCommit = false;
  assert.equal(c.r.run('localReceiptPending()'), true);
  assert.equal(saved(c.cloud).length, 1);
  const d = harness.runtime('yotvata', { cloud: c.cloud, storage: c.storage });
  await c.cloud.tick();
  await bannerTap(d, 'retry-final'); await idle(d);
  assert.equal(d.run('localReceiptPending()'), false);
  assert.equal(d.run('currentView'), 'receiptsHistory');
  assert.equal(saved(c.cloud).length, 1, 'לא נשמרה פעם שנייה');
  assert.ok(d.toasts.includes('התעודה נשמרה ✓'), d.toasts.join(' | '));
});

test('11. הגרסה עלתה ל-421, כולל הכותרת וה-service worker', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const APP_VERSION = '421'/);
  assert.match(html, /<title>הזמנות יטבתה - v421 שמירה שלא אושרה אינה נועלת את הקליטה<\/title>/);
  assert.match(html, /id="verBadge"[^>]*>v421 שמירה שלא אושרה אינה נועלת את הקליטה</);
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), /yotvata-v421/);
});
