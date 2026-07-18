// Yotvata AI invoice scanner — Cloudflare Worker v115
// Secret required in Cloudflare: OPENAI_API_KEY
// The key is never sent to the browser and invoice images are not stored here.

const ALLOWED_ORIGINS = new Set([
  "https://asafkiri.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

// The real flow normally has one or two invoices with up to three pages each.
// Keeping the ceiling tight prevents a single request from exhausting Worker memory
// or creating an unexpectedly expensive model call.
const MAX_DOCUMENTS = 4;
const MAX_PAGES = 8;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_PAGE_BYTES = 1600000;
const OPENAI_URL = "https://api.openai.com/v1/responses";
const FIREBASE_PROJECT_ID = "globrands-db";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const localRateBuckets = new Map();
let jwksCache = { keys: [], expiresAt: 0 };

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://asafkiri.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(origin, status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function nullable(type) {
  return { type: [type, "null"] };
}

const rowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sourcePage", "lineNumber", "barcode", "supplierItemCode", "description",
    "quantity", "unitPriceExVat", "grossLineTotalExVat", "lineDiscountExVat",
    "lineTotalExVat", "promotionText", "confidence"
  ],
  properties: {
    sourcePage: { type: "integer" },
    lineNumber: nullable("integer"),
    barcode: nullable("string"),
    supplierItemCode: nullable("string"),
    description: { type: "string" },
    quantity: nullable("number"),
    unitPriceExVat: nullable("number"),
    grossLineTotalExVat: nullable("number"),
    lineDiscountExVat: nullable("number"),
    lineTotalExVat: nullable("number"),
    promotionText: nullable("string"),
    confidence: { type: "number" },
  },
};

const documentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "noteIndex", "invoiceNumber", "pageCount", "subtotalExVat", "vatAmount",
    "totalInclVat", "printedUnits", "printedLines", "documentDiscountExVat",
    "confidence", "warnings", "rows"
  ],
  properties: {
    noteIndex: { type: "integer" },
    invoiceNumber: nullable("string"),
    pageCount: { type: "integer" },
    subtotalExVat: nullable("number"),
    vatAmount: nullable("number"),
    totalInclVat: nullable("number"),
    printedUnits: nullable("number"),
    printedLines: nullable("number"),
    documentDiscountExVat: nullable("number"),
    confidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: rowSchema },
  },
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documents", "warnings"],
  properties: {
    documents: { type: "array", items: documentSchema },
    warnings: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM_PROMPT = `אתה מפענח תעודות משלוח/חשבוניות ספק בעברית עבור חנות.
המטרה היא חילוץ חשבונאי מדויק של כל שורות המוצרים, לא ניחוש.

כללים מחייבים:
1. כל קבוצת תמונות שסומנה כמסמך היא חשבונית/תעודה אחת, והתמונות בתוכה הן עמודים של אותו מסמך. החזר בשדה noteIndex בדיוק את המספר שסומן בקלט (מספור שמתחיל ב-0).
2. חלץ כל שורת מוצר בדיוק פעם אחת. כותרות, סיכומים ופרטי לקוח אינם שורות מוצר.
3. שמור הופעות כפולות של אותו ברקוד אם הוא מופיע בשתי שורות או בשני מסמכים. אל תאחד אותן בפלט.
4. barcode הוא ספרות הברקוד המודפס בלבד. אל תמציא ספרות. אם אינך בטוח — null.
5. quantity היא כמות היחידות בשורה, unitPriceExVat הוא מחיר יחידה לפני מע״מ,
   grossLineTotalExVat הוא סכום לפני הנחת שורה, lineDiscountExVat הוא הנחת השורה,
   ו-lineTotalExVat הוא הסכום הסופי לתשלום בשורה לפני מע״מ.
6. promotionText מכיל כוכבית/מבצע/הנחה שמופיעים בנייר. אין להסיק מבצע מהקטלוג.
7. subtotalExVat חייב להיות הסכום המודפס לתשלום לפני מע״מ של המסמך כולו.
8. קטלוג המוצרים המצורף הוא עזר לזיהוי שם/ברקוד בלבד. אסור להעתיק ממנו מחיר או כמות.
9. אל תתקן מספרים כדי לגרום לסכומים להסתדר. אם ערך אינו קריא החזר null והוסף אזהרה.
10. documentDiscountExVat הוא רק הנחת מסמך כללית שמודפסת במפורש בסיכום המסמך. אסור להסיק או להמציא אותה מהפרש חשבונאי; אם אינה מודפסת או אינה קריאה החזר null.
11. pageCount הוא מספר התמונות שסומנו עבור אותו noteIndex, לא מספר עמוד שמודפס על הנייר.
12. confidence הוא ביטחון בקריאת הנתונים מהצילום. החזר רק את מבנה ה-JSON שנדרש.`;

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function hasModelRefusal(data) {
  return (data.output || []).some(item => (item.content || []).some(part => part && part.type === "refusal"));
}

function finiteOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

// Strict JSON Schema guarantees shape, while these checks enforce numeric ranges
// that are intentionally kept out of the Structured Outputs schema subset.
function validModelScan(scan, inputDocuments) {
  if (!scan || !Array.isArray(scan.documents) || scan.documents.length !== inputDocuments.length || !Array.isArray(scan.warnings)) return false;
  const seen = new Set();
  for (const doc of scan.documents) {
    if (!doc || !Number.isInteger(doc.noteIndex) || seen.has(doc.noteIndex)) return false;
    const input = inputDocuments.find(x => x.noteIndex === doc.noteIndex);
    if (!input || !Number.isInteger(doc.pageCount) || doc.pageCount !== input.pages.length) return false;
    if (typeof doc.confidence !== "number" || !Number.isFinite(doc.confidence) || doc.confidence < 0 || doc.confidence > 1) return false;
    if (!Array.isArray(doc.rows) || !Array.isArray(doc.warnings)) return false;
    for (const field of ["subtotalExVat", "vatAmount", "totalInclVat", "printedUnits", "printedLines", "documentDiscountExVat"]) {
      if (!finiteOrNull(doc[field])) return false;
    }
    for (const row of doc.rows) {
      if (!row || !Number.isInteger(row.sourcePage) || row.sourcePage < 1 || row.sourcePage > input.pages.length) return false;
      if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) return false;
      for (const field of ["quantity", "unitPriceExVat", "grossLineTotalExVat", "lineDiscountExVat", "lineTotalExVat"]) {
        if (!finiteOrNull(row[field])) return false;
      }
    }
    seen.add(doc.noteIndex);
  }
  return true;
}

function dataUrlBytes(value) {
  if (typeof value !== "string") return Infinity;
  const comma = value.indexOf(",");
  if (comma < 0) return Infinity;
  const b64 = value.slice(comma + 1);
  return Math.max(0, Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : (b64.endsWith("=") ? 1 : 0)));
}

function validDataUrl(value) {
  return typeof value === "string" && /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value) && dataUrlBytes(value) <= MAX_PAGE_BYTES;
}

function base64UrlBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(decoder.decode(base64UrlBytes(value)));
}

async function firebaseKeys(force) {
  const now = Date.now();
  if (!force && jwksCache.expiresAt > now && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetch(FIREBASE_JWKS_URL, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!response.ok) throw new Error("firebase_keys_unavailable");
  const data = await response.json();
  const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], expiresAt: now + Math.min(maxAge, 21600) * 1000 };
  return jwksCache.keys;
}

async function verifyFirebaseToken(headerValue) {
  if (!headerValue || !headerValue.startsWith("Bearer ")) throw new Error("auth_required");
  const token = headerValue.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_token");
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("invalid_token");
  let keys = await firebaseKeys(false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await firebaseKeys(true); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error("invalid_token");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!verified || payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== "https://securetoken.google.com/" + FIREBASE_PROJECT_ID || !payload.sub || payload.exp <= now - 30 || payload.iat > now + 60) throw new Error("invalid_token");
  return String(payload.sub);
}

function enforceRateLimit(key, max) {
  const now = Date.now(), windowMs = 10 * 60 * 1000;
  const hits = (localRateBuckets.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now); localRateBuckets.set(key, hits);
  return true;
}

export default {
  async fetch(request, env) {
    // The existing Cloudflare secret remains named OPENAI_API_KEY.
    // These status values reveal no part of the key; they only make setup failures clear.
    const rawOpenAIKey = env && env.OPENAI_API_KEY;
    const openaiKey = typeof rawOpenAIKey === "string" ? rawOpenAIKey.trim() : "";
    const keyStatus = rawOpenAIKey === undefined ? "missing" : (openaiKey ? "ready" : "empty");
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return json(origin, 403, { ok: false, error: "origin_not_allowed" });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(origin, 200, { ok: true, service: "yotvata-ai-scan", version: 115, keyConfigured: keyStatus === "ready", keyStatus });
    }

    if (request.method !== "POST" || url.pathname !== "/scan") {
      return json(origin, 404, { ok: false, error: "not_found" });
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json(origin, 403, { ok: false, error: "origin_not_allowed" });
    if (keyStatus !== "ready") return json(origin, 500, { ok: false, error: "missing_openai_key", keyStatus });

    let uid;
    try { uid = await verifyFirebaseToken(request.headers.get("Authorization")); }
    catch (error) { return json(origin, 401, { ok: false, error: error && error.message === "auth_required" ? "auth_required" : "invalid_auth" }); }
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    // מגבילים גם לפי משתמש וגם לפי כתובת רשת, כדי שפתיחת משתמש אנונימי חדש
    // לא תאפס לבדה את מגבלת העלות. מגבלת האשראי בחשבון OpenAI היא שכבת ההגנה הסופית.
    if (!enforceRateLimit("uid:" + uid, 6) || !enforceRateLimit("ip:" + clientIp, 8)) {
      return json(origin, 429, { ok: false, error: "rate_limited", retryAfterMinutes: 10 });
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json(origin, 413, { ok: false, error: "request_too_large" });

    let body;
    try {
      const rawBody = await request.arrayBuffer();
      if (rawBody.byteLength > MAX_BODY_BYTES) return json(origin, 413, { ok: false, error: "request_too_large" });
      body = JSON.parse(decoder.decode(rawBody));
    }
    catch { return json(origin, 400, { ok: false, error: "invalid_json" }); }

    const documents = Array.isArray(body.documents) ? body.documents : [];
    const catalog = Array.isArray(body.catalog) ? body.catalog.slice(0, 500) : [];
    const pageCount = documents.reduce((sum, doc) => sum + (Array.isArray(doc.pages) ? doc.pages.length : 0), 0);
    if (!documents.length || documents.length > MAX_DOCUMENTS || !pageCount || pageCount > MAX_PAGES) {
      return json(origin, 400, { ok: false, error: "invalid_document_count", maxDocuments: MAX_DOCUMENTS, maxPages: MAX_PAGES });
    }
    const noteIndexes = new Set();
    let decodedImageBytes = 0;
    for (const doc of documents) {
      if (!Number.isInteger(doc.noteIndex) || !Array.isArray(doc.pages) || !doc.pages.length || doc.pages.some(page => !validDataUrl(page))) {
        return json(origin, 400, { ok: false, error: "invalid_document" });
      }
      if (doc.noteIndex < 0 || doc.noteIndex >= documents.length || noteIndexes.has(doc.noteIndex)) {
        return json(origin, 400, { ok: false, error: "invalid_document_index" });
      }
      noteIndexes.add(doc.noteIndex);
      decodedImageBytes += doc.pages.reduce((sum, page) => sum + dataUrlBytes(page), 0);
    }
    if (decodedImageBytes > MAX_PAGE_BYTES * MAX_PAGES) return json(origin, 413, { ok: false, error: "request_too_large" });

    const catalogText = catalog.map(p => ({
      id: String(p.id || ""),
      name: String(p.name || "").slice(0, 120),
      barcode: String(p.barcode || "").replace(/\D/g, "").slice(0, 20),
    }));

    // The explicit any[] annotation keeps Cloudflare Quick Edit from rejecting input_image pushes.
    const content = /** @type {any[]} */ ([{
      type: "input_text",
      text: "קטלוג לזיהוי בלבד:\n" + JSON.stringify(catalogText),
    }]);
    for (const doc of documents) {
      for (let i = 0; i < doc.pages.length; i++) {
        content.push({ type: "input_text", text: `מסמך noteIndex=${doc.noteIndex}, עמוד ${i + 1} מתוך ${doc.pages.length}` });
        content.push({ type: "input_image", image_url: doc.pages[i], detail: "high" });
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 115000);
    let response;
    try {
      response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          store: false,
          max_output_tokens: 24000,
          reasoning: { effort: "low" },
          input: [
            { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
            { role: "user", content },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "invoice_scan",
              strict: true,
              schema: outputSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      return json(origin, error && error.name === "AbortError" ? 504 : 502, {
        ok: false,
        error: error && error.name === "AbortError" ? "openai_timeout" : "openai_network_error",
      });
    }
    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(origin, response.status, {
        ok: false,
        error: "openai_error",
        message: data && data.error && data.error.message ? data.error.message : "OpenAI request failed",
        requestId: response.headers.get("x-request-id") || null,
      });
    }

    if (data.status === "incomplete") {
      return json(origin, 502, { ok: false, error: "incomplete_model_output", reason: data.incomplete_details && data.incomplete_details.reason || null, requestId: data.id || null });
    }
    if (hasModelRefusal(data)) {
      return json(origin, 502, { ok: false, error: "model_refusal", requestId: data.id || null });
    }

    const text = extractOutputText(data);
    let scan;
    try { scan = JSON.parse(text); }
    catch { return json(origin, 502, { ok: false, error: "invalid_model_output", requestId: data.id || null }); }
    if (!validModelScan(scan, documents)) {
      return json(origin, 502, { ok: false, error: "invalid_model_output", requestId: data.id || null });
    }

    return json(origin, 200, {
      ok: true,
      scan,
      model: data.model || "gpt-5-mini",
      requestId: data.id || response.headers.get("x-request-id") || null,
      usage: data.usage || null,
    });
  },
};

