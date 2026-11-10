// v414 (כמו תנובה 158–159): תעודה ארוכה בצילום אחד מתחלקת לחלקים לפני השליחה. בתנובה, 10.11, חשבונית של 30
// שורות נשלחה ב-1850 פיקסל — כ-11 פיקסל לגובה ספרה — והמודלים קראו 7 כ-1 ו-5 כ-1 בחמש שורות; ועל נייר אמיתי
// השורות נטויות (3°, שתי שורות דפוס בין קצה לקצה), ולכן קו החיתוך נטוי כמו השורות.
// הבדיקות כאן מריצות את צינור התמונה על נייר מסונתז (שורות דפוס במרווח קבוע על רקע אפור, עם נטייה או
// בלעדיה), בלי מודל ובלי תמונה אמיתית: התכנון הטהור, מדידת הזווית והקו הנקי מהמקור, המשולשים שנצבעים לבן,
// ומה שקושר את החלקים במסך האישור — אישור אחד, סיבוב משותף, מחיקה ושחזור של הקבוצה כולה, ותקרת שמונת העמודים.
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
function constant(name) {
  const m = new RegExp('^const ' + name + ' = ([^;]+);', 'm').exec(html);
  assert.ok(m, 'Missing constant: ' + name);
  return Number(m[1]);
}
const names = ['aiCompressInvoiceImage', 'aiRenderInvoiceRegion', 'aiRenderSplitPages', 'aiPlanLongReceiptSplit', 'aiBandDarkMap', 'aiRowTilt', 'aiProfileWhitestLine', 'aiFindSplitLine', 'aiSplitSkipText', 'aiSplitSiblings',
  'aiSplitGroupPages', 'aiOrderSplitGroup', 'aiPageLabel', 'aiDetectPaperRegion', 'aiMeasurePageQuality', 'aiQualityAdvice', 'aiDrawCropMap',
  'aiCropInitFrame', 'aiCropResetOverlay', 'aiCropDraw', 'aiCropSyncCanvasBox', 'aiCropContainRect', 'aiCropFit', 'aiNormalizeQuarterTurns',
  'aiRenderInvoiceRotation', 'aiSetOrientationBusy', 'aiUpdateOrientationControls', 'aiRestoreOriginalImage', 'aiCropInfoText',
  'aiPaintOrientationReview', 'aiOrientationLocation', 'aiOpenOrientationReview', 'aiCloseOrientationReview', 'aiRotateOrientationReview',
  'aiConfirmOrientationReview', 'aiCancelOrientationReview', 'aiRemoveInvoicePage', 'aiAddInvoiceFiles', 'aiOpenNextUnconfirmedOrientation',
  'aiAllPagesOrientationConfirmed', 'aiInvoiceOutputScale', 'aiOrientationLocation', 'aiInvalidateOrientationLocation'];
const MIN_PITCH = constant('AI_SPLIT_MIN_PITCH'), MAX_SIDE = constant('AI_INVOICE_MAX_SIDE'), MAX_TILT = constant('AI_SPLIT_MAX_TILT');

// הנייר המסונתז: מקור 3000×4000 (פורטרט), פרוקסי 1125×1500 (0.375). מסגרת הנייר בפרוקסי
// x 350..775, y 100..1400; שורות דפוס ברוחב 10 פיקסל כל PITCH פיקסל, החל מ-y=110. לובן נייר 230,
// דיו 40, רקע 120 (מחצלת אפורה).
const SRC_W = 3000, SRC_H = 4000, PROXY = 1500, SCALE = PROXY / SRC_H;
const BOX = { x: 350, y: 100, width: 425, height: 1300 };
// band: רוחב שורת הדפוס בפיקסלים של הפרוקסי (10 — רווח לבן של 14; 23 — רווח של פיקסל אחד, שאינו נחשב רווח).
// tilt: נטייה — בכמה פיקסלים (פרוקסי) השורות גבוהות יותר בקצה הימני של הנייר מבקצה השמאלי, כמו בצילום של 10.11.
// הסצנה כפונקציה של קואורדינטות הפרוקסי (גם שבריות), כדי שגם רצועה ברזולוציה מלאה (v159) תסונתז מאותו נייר.
function sceneLuma(pitch, { band = 10, tilt = 0 }, x, y) {
  const inside = x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height;
  if (!inside) return 120;
  const phase = y - BOX.y - 10 + tilt * (x - BOX.x) / BOX.width;
  const textRow = ((phase % pitch) + pitch) % pitch < band && x > BOX.x + 20 && x < BOX.x + BOX.width - 20;
  return textRow ? 40 : 230;
}
function synthetic(pitch, options = {}) {
  const pw = Math.round(SRC_W * SCALE), ph = Math.round(SRC_H * SCALE);
  const data = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const v = sceneLuma(pitch, options, x, y);
    const i = (y * pw + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { pw, ph, data, pixel: (xs, ys) => sceneLuma(pitch, options, xs * SCALE, ys * SCALE) };
}
function context({ pitch = 24, band = 10, tilt = 0, paper = true } = {}) {
  const scene = synthetic(pitch, { band, tilt });
  // רצועה ברזולוציה מלאה (קנבס נמוך): מסונתזת מהנייר לפי מלבן המקור שצויר; קנבסים גדולים (החלקים עצמם) — פיקסל לבן.
  const synthesizeBand = canvas => { const r = canvas._source; const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const v = scene.pixel(r.sx + (x + 0.5) * r.sw / canvas.width, r.sy + (y + 0.5) * r.sh / canvas.height);
      const i = (y * canvas.width + x) * 4; out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255; } return out; };
  const images = new Map([['source', { naturalWidth: SRC_W, naturalHeight: SRC_H }]]);
  const draws = [], fills = [], nodes = new Map();
  let seq = 0;
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(id === 'aiCropCanvas' ? ['hidden'] : []);
    const n = { id, style: {}, width: 600, height: 450, clientWidth: 600, clientHeight: 450, naturalWidth: 3000, naturalHeight: 2250, textContent: '', innerHTML: '',
      classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle: (v, yes) => yes ? classes.add(v) : classes.delete(v) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 450 }), parentElement: { getBoundingClientRect: () => ({ width: 624, height: 474 }) },
      getContext: () => ({ clearRect() {}, fillRect() {}, strokeRect() {} }) };
    nodes.set(id, n); return n;
  }
  const c = vm.createContext({ console, canEditDraft: () => true, Number, Math, Array, Object, String, Promise, Date, Set, Map,
    aiScanEditingImages: false, receiptScanChanged() {}, aiOrientationSession: null, aiOrientationBusy: false, aiCropState: null, aiScanBusy: false,
    aiScanDocuments: [], aiScanResponse: null, aiScanEvaluation: null, aiScanError: '', aiScanProgressText: '', aiScanRunId: 1,
    aiScanAutoRotationNote: '', aiScanAttemptCount: 0,
    $: node, setTimeout() {}, refreshScanHost() {}, yotvataInvalidatePhotoDoc() {}, receiptDeliveryCredits: [], deliveryCreditOpenPage() { return false; }, deliveryCreditInvalidate() {}, saveReceiptDraft() {}, renderReceiving() {},
    showToast: message => { c.lastToast = message; },
    aiReadFile: async () => 'source', aiLoadImage: async url => { assert.ok(images.has(url), url); return images.get(url); },
    aiEnhanceDocumentPixels: () => false,
    AI_INVOICE_MAX_SIDE: MAX_SIDE, AI_CROP_PROXY_SIDE: PROXY, AI_CREDIT_MAX_PIXELS: Math.round(MAX_SIDE * MAX_SIDE * 0.75), AI_CREDIT_MAX_LONG_SIDE: 4096,
    AI_SPLIT_MIN_PITCH: MIN_PITCH, AI_SPLIT_MAX_PARTS: constant('AI_SPLIT_MAX_PARTS'), AI_SPLIT_MIN_SOURCE_GAIN: constant('AI_SPLIT_MIN_SOURCE_GAIN'), AI_SPLIT_GAP_INK: constant('AI_SPLIT_GAP_INK'), AI_SPLIT_GAP_DEPTH: constant('AI_SPLIT_GAP_DEPTH'), AI_SPLIT_GAP_CLEAN: constant('AI_SPLIT_GAP_CLEAN'),
    AI_SPLIT_MAX_TILT: MAX_TILT, AI_SPLIT_TILT_STEP: constant('AI_SPLIT_TILT_STEP'), AI_SPLIT_TILT_PEAK: constant('AI_SPLIT_TILT_PEAK'),
    Uint8ClampedArray, Uint8Array, Uint32Array, Float32Array, Float64Array,
    aiFlattenIllumination: () => true,
    // שני העוגנים מסכימים על מסגרת הנייר, ועוגן המחזוריות מודד את מרווח השורות (P) — כמו על נייר אמיתי.
    aiTextAnchorBox: () => paper ? { ...BOX } : null,
    aiTextCropBox: () => paper ? { box: { ...BOX }, P: pitch } : null,
    aiCanvasToInvoiceJpeg: canvas => { const dataUrl = 'encoded-' + (++seq); images.set(dataUrl, { naturalWidth: canvas.width, naturalHeight: canvas.height }); return { dataUrl, bytes: 100 }; },
    aiDataUrlBytes: () => 100,
    document: { createElement: tag => {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      canvas.fills = []; canvas.polygons = [];
      let path = null;
      canvas.getContext = () => ({ fillRect: (...args) => { canvas.fills.push(args); fills.push({ canvas, args }); }, translate() {}, rotate() {}, putImageData() {},
        // המסכות (v159) הן מצולעים: נרשמים כרשימת נקודות בקואורדינטות הקנבס.
        beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, closePath() {}, fill() { canvas.polygons.push(path); path = null; },
        drawImage: (...args) => { draws.push({ args, width: canvas.width, height: canvas.height, canvas }); if (args.length >= 9) canvas._source = { sx: args[1], sy: args[2], sw: args[3], sh: args[4] }; },
        // הפרוקסי מקבל את הנייר המסונתז; רצועת מדידה (נמוכה) — מסונתזת מהמקור; כל קנבס אחר — פיקסל לבן אחד (השיפור ממילא מדומה).
        getImageData: () => canvas.width === scene.pw && canvas.height === scene.ph ? { data: scene.data }
          : canvas._source && canvas.height <= 700 ? { data: synthesizeBand(canvas) } : { data: new Uint8ClampedArray([255, 255, 255, 255]) } });
      return canvas;
    } }
  });
  vm.runInContext(names.map(source).join('\n'), c);
  Object.defineProperty(node('aiOrientationImage'), 'src', { set(url) {
    const img = images.get(url); if (img) { this.naturalWidth = img.naturalWidth; this.naturalHeight = img.naturalHeight; }
    c.aiCropInitFrame();
  } });
  return { c, node, images, draws, fills, scene };
}
// מערכים שנוצרו בתוך ה-vm שייכים למרחב אחר; להשוואה עמוקה מעתיקים אותם למרחב של הבדיקה.
const plain = value => JSON.parse(JSON.stringify(value));
// נייר בלי נטייה: האם גובה במקור נופל ברווח שבין שתי שורות דפוס.
const inGap = (sourceY, pitch) => { const proxyY = sourceY * SCALE - BOX.y - 10; const phase = ((proxyY % pitch) + pitch) % pitch; return phase >= 10; };
// הקנבס של חלק: זה שצויר ממלבן המקור שלו; המצולעים שנצבעו עליו — המסכות.
const tileCanvas = (h, page) => h.draws.find(d => d.canvas._source && d.canvas._source.sy === page.sourceRegion.y && d.canvas._source.sh === page.sourceRegion.height).canvas;
// נקודה על קנבס של חלק — חזרה לקואורדינטות המקור.
const toSource = (page, point) => [point[0] / page.processScale + page.sourceRegion.x, point[1] / page.processScale + page.sourceRegion.y];

test('the plan: parts and ideal cut places from the sizes alone; a short receipt, a small source or no pitch means one image', () => {
  const { c } = context();
  // מרווח שורות של 64 פיקסל במקור ונייר של 3467 פיקסל: בפלט 34 — מתחת לסף, שני חלקים, החיתוך האידיאלי באמצע.
  const plan = c.aiPlanLongReceiptSplit({ pitchSource: 24 / SCALE, sourceLong: BOX.height / SCALE, outputLong: MAX_SIDE });
  assert.equal(plan.parts, 2);
  assert.ok(plan.pitchOut < MIN_PITCH && plan.pitchOut > 30, String(plan.pitchOut));
  assert.deepEqual(plain(plan.idealCuts), [BOX.height / SCALE / 2]);
  // תעודה קצרה: 12 שורות על אותו אורך נייר — מרווח גדול, אין חלוקה.
  const short = c.aiPlanLongReceiptSplit({ pitchSource: 60 / SCALE, sourceLong: BOX.height / SCALE, outputLong: MAX_SIDE });
  assert.equal(short.parts, 1); assert.equal(short.reason, 'pitch_ok'); assert.ok(short.pitchOut > MIN_PITCH);
  // מקור קטן (צילום של 1900 פיקסל): אין מה להרוויח מחלוקה.
  assert.equal(c.aiPlanLongReceiptSplit({ pitchSource: 12, sourceLong: 1900, outputLong: MAX_SIDE }).reason, 'source_too_small');
  // תעודה ארוכה במיוחד: מרווח של 24 פיקסל בפלט — שלושה חלקים, לא יותר, בשליש ובשני שלישים.
  const long = c.aiPlanLongReceiptSplit({ pitchSource: 24 / SCALE, sourceLong: 9000, outputLong: MAX_SIDE });
  assert.equal(long.parts, 3);
  assert.deepEqual(plain(long.idealCuts), [3000, 6000]);
  assert.equal(c.aiPlanLongReceiptSplit({ pitchSource: 10, sourceLong: 20000, outputLong: MAX_SIDE }).parts, 3, 'never more than three parts');
  // בלי מרווח שורות — אין תכנון.
  assert.equal(c.aiPlanLongReceiptSplit({ pitchSource: null, sourceLong: 4000, outputLong: MAX_SIDE }).reason, 'no_pitch');
});

test('v414 (tnuva 159): the line follows the tilt of the printed rows — a receipt tilted by two rows across its width still splits, in a gap on both sides, and the triangles beyond the line are painted white', async () => {
  // נטייה של 20 פיקסל בפרוקסי בין קצה לקצה (53 במקור, יותר מגובה הרווח הלבן, 37; כ-2.7°): קו אופקי היה חוצה שורה.
  const h = context({ pitch: 24, tilt: 20 });
  const pages = await h.c.aiCompressInvoiceImage({ name: 'tilted.jpg' });
  assert.ok(Array.isArray(pages) && pages.length === 2, 'a tilted receipt splits: ' + JSON.stringify(Array.isArray(pages) ? pages.length : pages.cropInfo));
  const [top, bottom] = pages;
  assert.ok(Math.abs(top.cropInfo.tilt - (-2.75)) < 0.3, 'the measured angle (rows higher on the right): ' + top.cropInfo.tilt);
  assert.ok(top.cropInfo.skew >= 48 && top.cropInfo.skew <= 58, 'the shift across the paper: ' + top.cropInfo.skew);
  assert.match(h.c.aiCropInfoText(top), /v414 · תעודה ארוכה · חלק 1 מתוך 2 · הוסרו \d+% מהשוליים · נטייה 2\.75° \(החיתוך עוקב אחרי השורות\)/);
  // אזורי המקור חופפים בגובה הנטייה: כל חלק מכיל את הקו הנטוי כולו.
  const overlap = top.sourceRegion.y + top.sourceRegion.height - bottom.sourceRegion.y;
  assert.ok(overlap >= 48 && overlap <= 58, 'overlap = the shift: ' + overlap);
  // המסכות: משולש אחד בכל חלק — מתחת לקו בעליון, מעל הקו בתחתון — ושפתו היא אותו קו במקור.
  const topMasks = tileCanvas(h, top).polygons, bottomMasks = tileCanvas(h, bottom).polygons;
  assert.equal(topMasks.length, 1); assert.equal(bottomMasks.length, 1);
  assert.equal(topMasks[0].length, 4); assert.equal(bottomMasks[0].length, 4);
  const lineTop = [toSource(top, topMasks[0][0]), toSource(top, topMasks[0][1])];          // [x0, yLeft], [x1, yRight]
  const lineBottom = [toSource(bottom, bottomMasks[0][3]), toSource(bottom, bottomMasks[0][2])];
  assert.ok(Math.abs(lineTop[0][1] - lineBottom[0][1]) < 2 && Math.abs(lineTop[1][1] - lineBottom[1][1]) < 2, 'one line for both parts: ' + JSON.stringify([lineTop, lineBottom]));
  assert.ok(lineTop[0][1] > lineTop[1][1], 'the line is higher on the right, like the rows');
  // הקו עובר ברווח לאורך כל הטקסט: בקצה השמאלי של הטקסט, באמצע ובקצה הימני — נייר, לא דיו.
  const yAt = x => lineTop[0][1] + (lineTop[1][1] - lineTop[0][1]) * (x - lineTop[0][0]) / (lineTop[1][0] - lineTop[0][0]);
  for (const xProxy of [BOX.x + 25, BOX.x + BOX.width / 2, BOX.x + BOX.width - 25]) {
    const x = xProxy / SCALE;
    for (const dy of [-8, 0, 8]) assert.equal(h.scene.pixel(x, yAt(x) + dy), 230, 'paper around the line at x=' + xProxy + ' dy=' + dy);
  }
  // המשולש העליון יורד מהקו לתחתית החלק; התחתון — מראש החלק אל הקו.
  assert.ok(Math.abs(topMasks[0][2][1] - tileCanvas(h, top).height) <= 1 && Math.abs(topMasks[0][3][1] - tileCanvas(h, top).height) <= 1);
  assert.ok(Math.abs(bottomMasks[0][0][1]) <= 1 && Math.abs(bottomMasks[0][1][1]) <= 1);
  // נטייה מעבר לטווח (60 פיקסל, כ-8°): אין חלוקה, והמסך אומר למה.
  const steep = context({ pitch: 24, tilt: 60 });
  const page = await steep.c.aiCompressInvoiceImage({ name: 'steep.jpg' });
  assert.ok(!Array.isArray(page), 'no split');
  assert.equal(page.cropInfo.splitReason, 'tilted');
  assert.equal(page.quality.sourcePx, SRC_H);
  assert.match(steep.c.aiCropInfoText(page), /חיתוך אוטומטי · הוסרו \d+% מהשוליים · לא חולקה: התעודה נטויה בצילום \(\d+(\.\d+)?°\) \(\d+ פיקסל לשורה\)/);
  steep.c.aiScanDocuments = [{ noteIndex: 0, pages: [page] }];
  steep.c.aiOpenOrientationReview(0, 0, false);
  assert.match(steep.node('aiOrientationHint').textContent, /תעודה ארוכה לא חולקה: התעודה נטויה בצילום/);
  // צילום קצר שלא חולק מדווח למה — ובתווית אין "לא חולקה".
  const flat = await context({ pitch: 60 }).c.aiCompressInvoiceImage({ name: 'short.jpg' });
  assert.equal(flat.cropInfo.splitReason, 'pitch_ok');
  assert.doesNotMatch(context().c.aiCropInfoText(flat), /לא חולקה/);
});

test('one photo of a long receipt becomes two pages of one document, cut in a white gap, each at full source resolution', async () => {
  const h = context({ pitch: 24 });
  const { c, draws } = h;
  const pages = await c.aiCompressInvoiceImage({ name: 'receipt.jpg' });
  assert.ok(Array.isArray(pages), 'a split returns an array of pages');
  assert.equal(pages.length, 2);
  const [top, bottom] = pages;
  assert.equal(top.split.count, 2); assert.equal(top.split.index, 0); assert.equal(bottom.split.index, 1);
  assert.equal(top.split.group, bottom.split.group);
  // אזורי המקור רציפים ומכסים את כל הנייר, והחיתוך ברווח בין שורות; בלי נטייה — בלי מסכות.
  const regionTop = Math.floor(BOX.y / SCALE), regionHeight = Math.ceil(BOX.height / SCALE);
  assert.equal(top.sourceRegion.y, regionTop);
  assert.equal(top.sourceRegion.y + top.sourceRegion.height, bottom.sourceRegion.y);
  assert.equal(bottom.sourceRegion.y + bottom.sourceRegion.height, regionTop + regionHeight);
  assert.ok(inGap(bottom.sourceRegion.y, 24), 'cut at ' + bottom.sourceRegion.y + ' is between rows');
  assert.ok(Math.abs(bottom.sourceRegion.y - (BOX.y + BOX.height / 2) / SCALE) <= 24 / SCALE, 'the cut is within one row pitch of the middle');
  assert.equal(tileCanvas(h, top).polygons.length, 0); assert.equal(tileCanvas(h, bottom).polygons.length, 0);
  assert.equal(top.cropInfo.tilt, 0); assert.equal(top.cropInfo.skew, 0);
  // כל חלק גבוה מ-1850 בערך — ולכן נשלח כמעט בלי הקטנה: פי שניים פיקסלים לספרה.
  assert.ok(top.processScale > 0.98 && bottom.processScale > 0.98, [top.processScale, bottom.processScale].join());
  assert.deepEqual(plain(draws.slice(-2).map(d => [d.args[1], d.args[2], d.args[3], d.args[4]])), plain([
    [top.sourceRegion.x, top.sourceRegion.y, top.sourceRegion.width, top.sourceRegion.height],
    [bottom.sourceRegion.x, bottom.sourceRegion.y, bottom.sourceRegion.width, bottom.sourceRegion.height]]));
  // כל חלק מדווח על עצמו: סיבה, חלק, מרווח שורות, ומה הוא מהפריים המלא (לתרשים).
  assert.equal(top.cropInfo.reason, 'split'); assert.equal(top.cropInfo.parts, 2); assert.equal(bottom.cropInfo.part, 2);
  assert.ok(top.cropInfo.pitch > 30 && top.cropInfo.pitch < MIN_PITCH);
  assert.ok(top.cropInfo.kept.h < 0.6 && bottom.cropInfo.kept.y > top.cropInfo.kept.y);
  assert.equal(top.quality.splitParts, 2); assert.equal(top.quality.rowPitchPx, Math.round(24 / SCALE));
  assert.equal(top.quality.paperPx, top.sourceRegion.height);
  assert.match(c.aiCropInfoText(top), /v414 · תעודה ארוכה · חלק 1 מתוך 2/);
  assert.doesNotMatch(c.aiCropInfoText(top), /נטייה/);
  assert.equal(c.aiPageLabel(bottom, 1), 'חלק 2 מתוך 2');
  assert.equal(c.aiPageLabel({ split: null }, 1), 'עמוד 2');
  assert.equal(top.name, 'receipt-1.jpg'); assert.equal(bottom.name, 'receipt-2.jpg');
  assert.ok(top.autoCropped && top.cropped && !top.originalImage && top.sourceBlob, 'restore goes through the source file, like an auto-crop');
  // נטייה קטנה (3 פיקסלים בפרוקסי, 8 במקור — פחות ממדרגת הזווית): נמדדת כאפס או כמדרגה אחת, והחיתוך ברווח.
  const slight = await context({ pitch: 24, tilt: 3 }).c.aiCompressInvoiceImage({ name: 'slight.jpg' });
  assert.ok(Array.isArray(slight) && slight.length === 2, 'a slight tilt still splits');
  assert.ok(Math.abs(slight[0].cropInfo.tilt) <= 0.5 && slight[0].cropInfo.skew <= 12, 'tilt ' + slight[0].cropInfo.tilt + '°, skew ' + slight[0].cropInfo.skew);
});

test('a short receipt, a receipt wider than tall, a photo without paper and the full-frame path stay a single page', async () => {
  const short = await context({ pitch: 60 }).c.aiCompressInvoiceImage({ name: 'short.jpg' });
  assert.ok(!Array.isArray(short)); assert.equal(short.cropInfo.reason, 'cropped'); assert.ok(!short.split);
  assert.equal(short.quality.rowPitchPx, Math.round(60 / SCALE * Math.min(1, MAX_SIDE / (BOX.height / SCALE))), 'the measured pitch is kept for the audit');
  const none = await context({ paper: false }).c.aiCompressInvoiceImage({ name: 'mat.jpg' });
  assert.ok(!Array.isArray(none)); assert.equal(none.cropInfo.reason, 'no_text');
  const full = await context({ pitch: 24 }).c.aiCompressInvoiceImage({ name: 'long.jpg' }, true);
  assert.ok(!Array.isArray(full)); assert.equal(full.cropInfo.reason, 'full_image');
  const noSplit = await context({ pitch: 24 }).c.aiCompressInvoiceImage({ name: 'long.jpg' }, false, undefined, true);
  assert.ok(!Array.isArray(noSplit)); assert.equal(noSplit.cropInfo.reason, 'cropped'); assert.equal(noSplit.cropInfo.splitReason, undefined);
  // רווח לבן שלא נמצא (שורות דפוס כמעט רצופות — רווח של פיקסל אחד ב-24) — צילום אחד, והסיבה נרשמת.
  const solid = await context({ pitch: 24, band: 23 }).c.aiCompressInvoiceImage({ name: 'solid.jpg' });
  assert.ok(!Array.isArray(solid)); assert.ok(['no_gap', 'no_rows'].includes(solid.cropInfo.splitReason), solid.cropInfo.splitReason);
  assert.match(context().c.aiCropInfoText(solid), /לא חולקה: (לא נמצא רווח ברור בין שורות|שורות הדפוס לא נמדדו)/);
});

async function withGroup(options) {
  const h = context(options);
  const pages = await h.c.aiCompressInvoiceImage({ name: 'receipt.jpg' });
  h.c.aiScanDocuments = [{ noteIndex: 0, pages: pages }];
  return { ...h, pages };
}
test('the parts of one photo are confirmed together, rotated together (180° reverses their order), deleted together and restored together', async () => {
  // אישור אחד — שני החלקים מאושרים.
  const confirm = await withGroup({ pitch: 24 });
  assert.ok(confirm.c.aiOpenOrientationReview(0, 0, false));
  assert.match(confirm.node('aiOrientationLabel').textContent, /חלק 1 מתוך 2/);
  assert.match(confirm.node('aiOrientationHint').textContent, /חולקה ל-2 חלקים/);
  await confirm.c.aiConfirmOrientationReview();
  assert.deepEqual(plain(confirm.c.aiScanDocuments[0].pages.map(p => p.orientationConfirmed)), [true, true]);
  assert.equal(confirm.c.aiAllPagesOrientationConfirmed(), true);
  // סיבוב של 180° — שני החלקים מסתובבים, והסדר מתהפך כדי שראש התעודה יישאר ראשון.
  const rotate = await withGroup({ pitch: 24 });
  rotate.c.aiOpenOrientationReview(0, 0, false);
  await rotate.c.aiRotateOrientationReview(2);
  const after = rotate.c.aiScanDocuments[0].pages;
  assert.deepEqual(plain(after.map(p => [p.rotation, p.split.index])), [[180, 1], [180, 0]]);
  await rotate.c.aiRotateOrientationReview(2);
  assert.deepEqual(plain(rotate.c.aiScanDocuments[0].pages.map(p => [p.rotation, p.split.index])), [[0, 0], [0, 1]]);
  // מחיקה של חלק אחד מוחקת את שניהם — גם מהכרטיס וגם ממסך האישור.
  const remove = await withGroup({ pitch: 24 });
  remove.c.aiRemoveInvoicePage(0, 1);
  assert.equal(remove.c.aiScanDocuments[0].pages.length, 0);
  const cancel = await withGroup({ pitch: 24 });
  cancel.c.aiOpenOrientationReview(0, 1, false);
  cancel.c.aiCancelOrientationReview();
  assert.equal(cancel.c.aiScanDocuments[0].pages.length, 0);
  // "השאר תמונה מלאה" על חלק אחד — הפריים המלא מחליף את כל החלקים.
  const restore = await withGroup({ pitch: 24 });
  restore.c.aiOpenOrientationReview(0, 1, false);
  await restore.c.aiRestoreOriginalImage();
  const kept = restore.c.aiScanDocuments[0].pages;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].split, null);
  assert.equal(kept[0].cropInfo.reason, 'full_image');
  assert.deepEqual(plain(kept[0].sourceRegion), { x: 0, y: 0, width: SRC_W, height: SRC_H });
});

test('adding photos spreads the parts into the document, and a long receipt that has no room under eight pages is sent as one image', async () => {
  const h = context({ pitch: 24 });
  h.c.aiScanDocuments = [{ noteIndex: 0, pages: [] }];
  await h.c.aiAddInvoiceFiles(0, [{ name: 'a.jpg' }]);
  assert.equal(h.c.aiScanDocuments[0].pages.length, 2);
  assert.ok(h.c.aiScanDocuments[0].pages.every(p => p.split && p.split.count === 2));
  const full = context({ pitch: 24 });
  full.c.aiScanDocuments = [{ noteIndex: 0, pages: Array.from({ length: 7 }, (_, i) => ({ dataUrl: 'p' + i, orientationConfirmed: true })) }];
  await full.c.aiAddInvoiceFiles(0, [{ name: 'b.jpg' }]);
  assert.equal(full.c.aiScanDocuments[0].pages.length, 8);
  const added = full.c.aiScanDocuments[0].pages[7];
  assert.ok(!added.split, 'no room for two parts: one cropped image');
  assert.equal(added.cropInfo.reason, 'cropped');
});
