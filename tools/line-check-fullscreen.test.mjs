// v409 — חלון הבדיקה (שורה-שורה ו"חוסרים ועודפים") במסך מלא בטלפון. 8.11.2026, בעל העסק: "למה זה לא נפתח על עמוד מסך שלם?"
// אותו חלון (receiptQuantityModal), אותם מזהים, אותם כפתורים ואותה שמירה — רק המעטפת: בטלפון בלי שוליים ובלי פינות, בגובה המסך,
// עם ריפוד לפס המצב (למעלה) ולפס הבית (למטה) כמו מסך המצלמה החי; מרוחב 640px (sm) — חלון ממורכז בגובה מוגבל, כמו קודם.
// מה שנבדק (על ה-HTML): 1. המעטפת והתיבה; 2. הכותרת והתחתית עם הריפוד; 3. בזמן ריצה הכול כמו קודם; 4. הגרסה.
// הדפדפן האמיתי: tools/line-check-scan-browser.mjs (390px — התיבה מהקצה לקצה והתחתית צמודה לתחתית המסך).
// הרצה: node --test tools/line-check-fullscreen.test.mjs
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './receipt-scan-harness.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('1. המעטפת: בטלפון על כל המסך (items-stretch, בלי p-3, התיבה h-full בלי max-height); מ-640px — ממורכז, p-3, פינות, max-height 90dvh', () => {
  const modal = html.match(/<div id="receiptQuantityModal"[^>]*class="([^"]*)"/)[1];
  assert.equal(modal, 'hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm items-stretch justify-center sm:items-center sm:p-3 z-[70]');
  const box = html.match(/<div id="receiptQuantityModal"[^>]*>\s*<div class="([^"]*)"([^>]*)>/);
  assert.equal(box[1], 'quantity-modal-box bg-white sm:rounded-2xl shadow-2xl w-full sm:max-w-lg flex flex-col h-full sm:h-auto');
  assert.doesNotMatch(box[2], /style=/, 'בלי max-height קבוע — בטלפון הגובה הוא המסך כולו');
  assert.match(html, /@media \(min-width: 640px\) \{ \.quantity-modal-box \{ max-height: 90vh; max-height: 90dvh; \} \}/, 'הגובה המוגבל — רק מ-640px, עם fallback ל-vh');
  // המצלמה נשארת מעל (שכבה 55 מתחת לחלון 70 — החלון מוסתר בזמן הסריקה, כמו ב-408)
  assert.match(html, /<div id="scanModal" class="hidden fixed inset-0 bg-black z-\[55\] flex-col">/);
});

test('2. הכותרת והתחתית: ריפוד לפס המצב ולפס הבית — אותו דפוס כמו מסך המצלמה החי', () => {
  assert.match(html, /<div class="px-4 pb-4 pt-\[max\(1rem,env\(safe-area-inset-top\)\)\] border-b border-slate-100 shrink-0"><div class="flex items-center justify-between gap-2"><h3 id="receiptQuantityTitle"/);
  assert.match(html, /<div id="receiptQuantityFooter" class="px-4 pt-4 pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\] border-t border-slate-100 shrink-0 grid gap-2"><button id="receiptLineScan"/);
  // הגוף הנגלל ביניהם — כמו קודם
  assert.match(html, /<div id="receiptQuantityBody" class="p-4 overflow-y-auto min-h-0"><div id="receiptQuantityRows"><\/div><div id="receiptQuantityExtras"><\/div><\/div>/);
  assert.ok((html.match(/env\(safe-area-inset-top\)/g) || []).length >= 2 && (html.match(/env\(safe-area-inset-bottom\)/g) || []).length >= 2, 'אותו דפוס כבר במסך המצלמה החי');
});

test('3. בזמן ריצה הכול כמו קודם: פתיחה, סגירה, שני המצבים של החלון', async () => {
  const c = runtime('yotvata');
  await c.scan();
  c.run('startReceiptQuantityReview(false)');
  assert.equal(c.run(`$('receiptQuantityModal').classList.contains('hidden')`), false);
  assert.equal(c.run(`$('receiptQuantityModal').classList.contains('flex')`), true);
  assert.equal(c.run(`$('receiptQuantityTitle').textContent`), 'חוסרים ועודפים');
  assert.equal(c.run(`$('receiptLineScan').classList.contains('hidden')`), true);
  c.run('closeReceiptQuantityReview()');
  assert.equal(c.run(`$('receiptQuantityModal').classList.contains('hidden')`), true);
});

test('4. הגרסה (409 ומעלה), כולל ה-service worker', () => {
  const v = html.match(/const APP_VERSION = '(\d+)'/)[1];
  assert.ok(Number(v) >= 409, v);
  assert.match(html, new RegExp('<title>הזמנות יטבתה - v' + v + ' ')); assert.match(html, new RegExp('id="verBadge"[^>]*>v' + v + ' '));
  assert.match(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), new RegExp('yotvata-v' + v));
});
