import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(m, 'Missing function: ' + name);
  const eol = html.indexOf('\n', m.index);
  const end = html.slice(m.index, eol).trimEnd().endsWith('}') ? eol : html.indexOf('\n}', eol) + 2;
  return html.slice(m.index, end);
}
const names = ['aiCompressInvoiceImage', 'aiDetectPaperRegion', 'aiMeasurePageQuality', 'aiQualityAdvice', 'aiDrawCropMap', 'aiCropInitFrame', 'aiCropResetOverlay', 'aiCropDraw',
  'aiCropSyncCanvasBox', 'aiCropContainRect', 'aiCropFit', 'aiCropHitTest', 'aiCropPointerPosition',
  'aiCropPointerDown', 'aiCropPointerMove', 'aiCropPointerUp', 'aiApplyCropIfMoved',
  'aiReprocessFromSource', 'aiUnrotateRect', 'aiNormalizeQuarterTurns', 'aiRenderInvoiceRotation',
  'aiSetOrientationBusy', 'aiUpdateOrientationControls', 'aiToggleCropMode', 'aiRestoreOriginalImage',
  'aiCropInfoText', 'aiPaintOrientationReview', 'aiOrientationLocation', 'aiOpenOrientationReview',
  'aiCloseOrientationReview', 'aiRotateOrientationReview', 'aiConfirmOrientationReview', 'aiInvalidateOrientationLocation'];

// Record real canvas source/destination rectangles; no model calls or external images.
function context() {
  const images = new Map([['source', { naturalWidth: 4000, naturalHeight: 3000 }]]);
  const draws = [], rotations = [], nodes = new Map();
  // null = מנוע הזיהוי לא מצא נייר. אובייקט = המסגרת שיחזיר, בקואורדינטות
  // הפרוקסי (1500x1125 עבור מקור 4000x3000).
  let cropPlan = null;
  let seq = 0;
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(id === 'aiCropCanvas' ? ['hidden'] : []);
    const n = { id, style: {}, width: 600, height: 450, clientWidth: 600, clientHeight: 450,
      naturalWidth: 3000, naturalHeight: 2250,
      classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v),
        toggle: (v, yes) => yes ? classes.add(v) : classes.delete(v) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 450 }),
      parentElement: { getBoundingClientRect: () => ({ width: 624, height: 474 }) },
      getContext: () => ({ clearRect() {}, fillRect() {}, strokeRect() {} }) };
    nodes.set(id, n); return n;
  }
  const c = vm.createContext({ console, Number, Math, Array, Object, String, Promise,
    aiScanEditingImages:false,receiptScanChanged(){},aiOrientationSession: null, aiOrientationBusy: false, aiCropState: null, aiScanBusy: false,
    aiScanDocuments: [], receiptDeliveryCredits: [], aiScanResponse: null, aiScanEvaluation: null, aiScanError: '',
    aiScanAutoRotationNote: '', aiScanAttemptCount: 0,
    $: node, setTimeout() {}, refreshScanHost() {}, aiOpenNextUnconfirmedOrientation() {},
    yotvataInvalidatePhotoDoc() {}, tnuvaInvalidatePhotoDoc() {},
    showToast: message => { c.lastToast = message; },
    aiReadFile: async () => 'source', aiLoadImage: async url => { assert.ok(images.has(url), url); return images.get(url); },
    aiEnhanceDocumentPixels: () => false,
    AI_INVOICE_MAX_SIDE: 1850, AI_CROP_PROXY_SIDE: 1500,
    Uint8ClampedArray, Uint8Array, Uint32Array,
    aiFlattenIllumination: (data, width, height, analysis) => { if (analysis) analysis.ready = true; return true; },
    // v180: האינווריאנט הישן היה "חיתוך אוטומטי לעולם לא רץ". הוא הוחלף
    // בשניים חזקים ממנו, שנבדקים למטה: חיתוך לעולם אינו חורג מגבולות המקור,
    // וכל סירוב נופל בדיוק על הפריים המלא ומדווח את סיבתו.
    aiComputePaperCropBox: (analysis, width, height, debug) => {
      if (!cropPlan) { debug.reason = 'box_97'; debug.value = 98; return null; }
      debug.reason = 'cropped';
      return { x: cropPlan.x, y: cropPlan.y, width: cropPlan.width, height: cropPlan.height };
    },
    aiCanvasToInvoiceJpeg: canvas => {
      const dataUrl = 'encoded-' + (++seq); images.set(dataUrl, { naturalWidth: canvas.width, naturalHeight: canvas.height });
      return { dataUrl, bytes: 100 };
    },
    aiDataUrlBytes: () => 100,
    document: { createElement: tag => {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ({ fillRect() {}, translate() {}, rotate: angle => rotations.push(angle),
        drawImage: (...args) => draws.push({ args, width: canvas.width, height: canvas.height }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} });
      return canvas;
    } }
  });
  vm.runInContext(names.map(source).join('\n'), c);
  Object.defineProperty(node('aiOrientationImage'), 'src', { set(url) {
    const img = images.get(url); if (img) { this.naturalWidth = img.naturalWidth; this.naturalHeight = img.naturalHeight; }
    c.aiCropInitFrame(); // The actual image load handler.
  } });
  return { c, node, images, draws, rotations, setCropPlan: (plan) => { cropPlan = plan; } };
}
async function capture(ctx) {
  const page = await ctx.c.aiCompressInvoiceImage({ name: 'fixture.jpg' });
  ctx.c.aiScanDocuments = [{ pages: [page] }];
  ctx.c.aiOpenOrientationReview(0, 0, true);
  return page;
}
const plain = value => JSON.parse(JSON.stringify(value));
// ציור הזיהוי לקנבס הפרוקסי הוא drawImage בן 5 ארגומנטים; ציור הפלט הוא
// בן 9. טענות על מה שנשלח מסתכלות רק על האחרון.
const output = draws => draws.filter(d => d.args.length === 9);
// מיפוי מסגרת מהתצוגה חזרה לקואורדינטות המקור מעגל לפי סקאלת ההקטנה,
// ולכן סטייה של פיקסל בודד היא התנהגות תקינה ולא רגרסיה.
const near = (actual, expected, slack = 2) => {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= slack,
      key + ': ' + actual[key] + ' is not within ' + slack + ' of ' + expected[key]);
  }
};

test('camera/gallery preparation and quick confirmation keep every source edge without an overlay', async () => {
  const ctx = context(), { c, node, draws } = ctx;
  const page = await capture(ctx), before = page.dataUrl;
  assert.equal(page.cropped, false);
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
  assert.deepEqual(output(draws)[0].args.slice(1), [0, 0, 4000, 3000, 0, 0, 1850, 1388]);
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiCropCanvas').classList.contains('hidden'), true);
  assert.match(node('aiOrientationConfirm').innerHTML, /אשר תמונה מלאה/);
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before);
  assert.equal(output(draws).length, 1, 'Confirmation must not reencode or crop');
  assert.equal(page.orientationConfirmed, true);
});

test('explicit crop starts on the full image; cancelling or confirming untouched never trims edges', async () => {
  const ctx = context(), { c, node } = ctx;
  const page = await capture(ctx), before = page.dataUrl;
  c.aiToggleCropMode();
  assert.deepEqual(plain(c.aiCropState.rect), { x: 0, y: 0, w: 1850, h: 1388 });
  assert.equal(node('aiCropCanvas').classList.contains('hidden'), false);
  c.aiCropState.rect = { x: 300, y: 225, w: 2400, h: 1800 }; c.aiCropState.moved = true;
  c.aiToggleCropMode();
  assert.equal(c.aiCropState, null); assert.equal(page.dataUrl, before);
  c.aiToggleCropMode();
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, false);
});

test('stale frame movement outside explicit crop mode cannot apply a crop', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiCropState = { moved: true, w: 3000, h: 2250, rect: { x: 300, y: 225, w: 2400, h: 1800 } };
  assert.equal(await c.aiApplyCropIfMoved(page), false);
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, false);
});

test('crop then restore recovers all original edges at each orientation without another file read', async () => {
  for (let turns = 0; turns < 4; turns++) {
    const ctx = context(), { c, node } = ctx;
    const page = await capture(ctx), original = page.baseDataUrl;
    await c.aiRotateOrientationReview(turns);
    c.aiToggleCropMode();
    const state = c.aiCropState;
    state.rect = { x: state.w * .1, y: state.h * .1, w: state.w * .8, h: state.h * .8 }; state.moved = true;
    await c.aiConfirmOrientationReview();
    assert.equal(page.cropped, true);
    near(page.sourceRegion, { x: 400, y: 300, width: 3200, height: 2400 });
    c.aiOpenOrientationReview(0, 0, true);
    assert.equal(node('aiOrientationRestore').classList.contains('hidden'), false);
    c.aiReadFile = () => { throw new Error('Use the saved original'); };
    await c.aiRestoreOriginalImage();
    assert.equal(page.baseDataUrl, original);
    assert.equal(page.cropped, false); assert.equal(page.rotation, turns * 90);
    assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
    assert.equal(c.aiCropState, null);
    assert.match(node('aiOrientationConfirm').innerHTML, /אשר תמונה מלאה/);
  }
});

test('restore while dragging discards the pending crop without modifying pixels', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiToggleCropMode(); c.aiCropState.moved = true;
  await c.aiRestoreOriginalImage();
  assert.equal(page.dataUrl, before); assert.equal(c.aiOrientationSession.cropMode, false);
  assert.equal(c.aiCropState, null);
});

test('restoring old auto-cropped pages uses the full source; failures keep the current image intact', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx);
  delete page.originalImage; page.cropped = true; page.sourceRegion = { x: 400, y: 300, width: 3200, height: 2400 };
  const before = page.dataUrl;
  c.aiReadFile = async () => { throw new Error('decode failed'); };
  await c.aiRestoreOriginalImage();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, true); assert.equal(c.aiOrientationBusy, false);
  assert.match(c.lastToast, /התמונה הנוכחית נשמרה/);
  c.aiReadFile = async () => 'source';
  await c.aiRestoreOriginalImage();
  assert.equal(page.cropped, false);
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
});

test('crop fallback without a source blob preserves full image and rotation for restoration', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), original = page.dataUrl;
  delete page.sourceBlob; delete page.originalImage;
  await c.aiRotateOrientationReview(1); c.aiToggleCropMode();
  const state = c.aiCropState;
  state.rect = { x: 100, y: 100, w: 1000, h: 1200 }; state.moved = true;
  await c.aiConfirmOrientationReview();
  c.aiOpenOrientationReview(0, 0, true);
  await c.aiRotateOrientationReview(1);
  await c.aiRestoreOriginalImage();
  assert.equal(page.baseDataUrl, original); assert.equal(page.rotation, 180); assert.equal(page.cropped, false);
});

test('viewing a page already used for OCR never enables cropping or restoration', async () => {
  const ctx = context(), { c, node } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiScanResponse = { ok: true }; c.aiCloseOrientationReview(); c.aiOpenOrientationReview(0, 0, false);
  c.aiToggleCropMode(); await c.aiRestoreOriginalImage(); await c.aiRotateOrientationReview(1);
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiOrientationCropRow').classList.contains('hidden'), true);
  assert.equal(page.dataUrl, before);
});

test('crop controls are wired outside the app container and disabled during image processing', async () => {
  const ctx = context(), { c, node } = ctx; await capture(ctx);
  for (const [id, fn] of [['aiOrientationCrop', 'aiToggleCropMode'], ['aiOrientationRestore', 'aiRestoreOriginalImage']]) {
    assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes(`$('${id}').addEventListener('click', ${fn});`));
  }
  c.aiSetOrientationBusy(true); c.aiToggleCropMode(); await c.aiRestoreOriginalImage();
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiOrientationCrop').disabled, true); assert.equal(node('aiOrientationRestore').disabled, true);
});

test('a detected paper frame crops from the source before the downscale and reports what it removed', async () => {
  const ctx = context(), { c, draws } = ctx;
  // מסגרת במרכז הפרוקסי, הרחק מארבעת הקצוות.
  ctx.setCropPlan({ x: 150, y: 112, width: 1200, height: 900 });
  const page = await capture(ctx);
  assert.equal(page.autoCropped, true, 'a confident frame must actually crop');
  assert.equal(page.cropped, true);
  assert.equal(page.cropInfo.reason, 'cropped');
  assert.ok(page.cropInfo.value > 0 && page.cropInfo.value < 70, 'removed share must be reported');
  // מה שדווח הוא בדיוק מה שצויר: אין פער בין הטענה לפיקסלים.
  const drawn = output(draws)[0].args;
  assert.deepEqual(drawn.slice(1, 5), [page.sourceRegion.x, page.sourceRegion.y, page.sourceRegion.width, page.sourceRegion.height]);
  // החיתוך לעולם אינו חורג מגבולות המקור.
  assert.ok(page.sourceRegion.x >= 0 && page.sourceRegion.y >= 0);
  assert.ok(page.sourceRegion.x + page.sourceRegion.width <= 4000);
  assert.ok(page.sourceRegion.y + page.sourceRegion.height <= 3000);
  assert.ok(page.sourceRegion.width < 4000, 'a crop must be smaller than the full frame');
  // הקטנה אחת בלבד, אל יעד ה-patches.
  assert.equal(Math.max(drawn[7], drawn[8]), 1850);
  assert.equal(output(draws).length, 1, 'exactly one resample reaches the model');
  // התרשים מקבל ארבעה מספרים מנורמלים כדי להראות מה הוסר.
  const kept = page.cropInfo.kept;
  assert.ok(kept && kept.w > 0 && kept.w <= 1 && kept.h > 0 && kept.h <= 1);
  assert.equal(page.originalImage, null, 'the cropped encode must never pose as the original');
});

test('every refusal falls back to the exact full frame and names its reason', async () => {
  const refusals = [
    [null, 'box_97'],
    [{ x: 700, y: 520, width: 90, height: 70 }, 'too_small'],
    [{ x: 60, y: 300, width: 1300, height: 320 }, 'aspect'],
    [{ x: 0, y: 0, width: 1500, height: 1000 }, 'overflow'],
  ];
  for (const [plan, reason] of refusals) {
    const ctx = context(), { draws } = ctx;
    ctx.setCropPlan(plan);
    const page = await capture(ctx);
    assert.equal(page.autoCropped, false, reason + ' must not crop');
    assert.equal(page.cropped, false);
    assert.equal(page.cropInfo.reason, reason);
    assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 },
      reason + ' must keep every source pixel');
    assert.deepEqual(output(draws)[0].args.slice(1), [0, 0, 4000, 3000, 0, 0, 1850, 1388]);
    assert.ok(page.originalImage, reason + ' keeps the full image available for restore');
  }
});

test('a detection failure never loses the photo', async () => {
  const ctx = context(), { c } = ctx;
  c.aiComputePaperCropBox = () => { throw new Error('engine exploded'); };
  const page = await capture(ctx);
  assert.equal(page.autoCropped, false);
  assert.equal(page.cropInfo.reason, 'error');
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
});

test('an automatic crop is undone in one tap back to the full frame', async () => {
  const ctx = context(), { c, node } = ctx;
  ctx.setCropPlan({ x: 150, y: 112, width: 1200, height: 900 });
  const page = await capture(ctx);
  assert.equal(page.autoCropped, true);
  // הכפתור נפתח לבד, ומנוסח כביטול ולא כשחזור — העובד לא ביקש לחתוך.
  assert.equal(node('aiOrientationRestore').classList.contains('hidden'), false);
  assert.equal(node('aiOrientationRestore').textContent, 'השאר תמונה מלאה');
  await c.aiRestoreOriginalImage();
  assert.equal(page.cropped, false);
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 },
    'restoring must recover every source edge');
});

test('quality measurement is recorded but never blocks confirmation', async () => {
  const ctx = context(), { c, node } = ctx;
  const page = await capture(ctx);
  // המדידה היא שדה על העמוד, לא שער. הרתמה אינה מספקת פיקסלים אמיתיים
  // ולכן quality יוצא null — וזה בדיוק המסלול שחייב להישאר בלתי חוסם.
  assert.ok('quality' in page, 'the page must carry a quality field');
  assert.ok('qualityAdvice' in page, 'the page must carry an advice field');
  assert.equal(node('aiOrientationConfirm').disabled, false, 'measurement must never disable confirmation');
  await c.aiConfirmOrientationReview();
  assert.equal(page.orientationConfirmed, true, 'measurement must never block a confirmed page');
});

test('a blurry or dark measurement still advises rather than blocks', async () => {
  const ctx = context(), { c, node } = ctx;
  const page = await capture(ctx);
  // מזריקים מדידה שנכשלת בכל אחד מהספים בתורו. כל עוד השלב הוא מדידה
  // בלבד, אף אחד מהם אינו רשאי לחסום. הבדיקה הזו היא השומר: מי שיוסיף
  // חסימה בעתיד חייב לעדכן אותה במפורש ולא בטעות.
  for (const quality of [
    { v: 1, paperPx: 400, sharpness: 1.9, contrast: 150, glarePct: 0, paperLuma: 240 },
    { v: 1, paperPx: 1800, sharpness: 0.6, contrast: 150, glarePct: 0, paperLuma: 240 },
    { v: 1, paperPx: 1800, sharpness: 1.9, contrast: 150, glarePct: 40, paperLuma: 240 },
    { v: 1, paperPx: 1800, sharpness: 1.9, contrast: 150, glarePct: 0, paperLuma: 60 },
  ]) {
    page.quality = quality;
    page.qualityAdvice = c.aiQualityAdvice(quality);
    page.orientationConfirmed = false;
    assert.ok(page.qualityAdvice, 'each failing metric must produce an advice');
    c.aiOpenOrientationReview(0, 0, true);
    assert.equal(node('aiOrientationConfirm').disabled, false, quality.paperPx + ' must not disable confirmation');
    await c.aiConfirmOrientationReview();
    assert.equal(page.orientationConfirmed, true, 'advice must never block');
  }
});

test('a sharp well-lit measurement produces no advice at all', () => {
  const ctx = context();
  assert.equal(ctx.c.aiQualityAdvice({ v: 1, paperPx: 1800, sharpness: 1.7, contrast: 150, glarePct: 2, paperLuma: 243 }), null);
  assert.equal(ctx.c.aiQualityAdvice(null), null);
});
