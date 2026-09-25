# Driver credit read automatically — v364

## Field report

On an iPhone running app v363, the invoice was still being read in the
background ("קורא תעודה 1 מתוך 2…") when the driver handed over a credit note.
The note was a long, narrow thermal slip. The worker photographed it, confirmed
the orientation, and then had to find a separate "פענח את הזיכוי" button. The
read failed at once: "הרשת נכשלה אחרי 1 ניסיונות — Load failed". The user said
it basically never works. Driver credits are usually one slip in one photo;
credits with several parts are rare.

## Root causes found

1. "Load failed" is WebKit's `TypeError` when no HTTP response with CORS
   headers reached the page. The credit POST had exactly one attempt
   (`retries = 0`), and unlike the invoice run it was not preceded by the
   `GET /health` warm-up. iOS silently retries an idempotent GET on a dead
   pooled connection, but not a POST. The credit could also run at the same
   time as the background invoice upload, which broke the v179 rule of one
   paid upload at a time.
2. The service wrote `200` headers but flushed nothing until its first
   10-second heartbeat. For those 10 seconds the phone's `fetch()` stayed
   pending while paid model work was already running. A drop in that window
   showed as "Load failed" while the service kept paying. There was no way to
   resume, so a blind retry could pay twice (hence v325's one-attempt rule).
3. Service: a malformed request path crashed the process, which dropped every
   scan in flight. Node's 5-second keep-alive, shorter than that of Cloud Run's
   front end, could produce 502/503 responses without CORS on reused
   connections.
4. Dead ends in the app:
   - While the invoice was read, the credit's photo check could not open, and
     nothing reopened it later.
   - The read needed a separate button.
   - The error card showed raw English, and its big button ("הוסף עמוד לזיכוי")
     added a duplicate page instead of retaking the photo.
   - The retry text went to the invoice banner.
5. Once the network worked, correct credits could still be rejected:
   - Rows accepted EAN-13 barcodes only.
   - VAT and total were compared with their signs, so a VAT line printed
     without a minus failed.
   - The service had no notion of a credit note, so credits got no arithmetic
     self-correction.
   - A slip that prints positive numbers under a "זיכוי" title was rejected.
6. Photos were limited to 1850 px on the long side, so a 1:5 slip was sent
   about 370 px wide.
7. A cloud draft that arrived during a credit read discarded the paid result.

## What changed in app v364

Transport (shared with invoices; see `tools/PHOTO-FIRST.md`, v364):

- Every paid `/scan` carries a random `scanKey`.
- A credit read warms the connection with `GET /health` right before its
  upload. The GET is retried up to three times, because it is free.
- The credit and the invoice wait for each other in one queue
  (`aiScanWithUploadLock`), so there is never more than one paid upload at a
  time.
- An automatic retry only collects the same read by key (`resume: true`, no
  photos). It happens only when the last successful `/health` answer reported
  `scanResume: true` (a warm-up that fails keeps that answer). Against
  v147 there is still exactly one attempt.
- The key of a read whose connection was cut is remembered for 25 minutes, so
  a manual "נסה שוב" with the same photos collects instead of paying again.
  A credit's key is also kept in the local draft, so after a reload the read
  can be collected without photos ("אסוף את הקריאה", see the third review round
  below).
- Errors are plain Hebrew. The browser's text is kept apart as `detail`.

Credit paper and photos (see `tools/DELIVERY-CREDITS-AND-PAPER-CORRECTIONS.md`):

- EAN-8 barcodes are accepted, with the invoice rules.
- VAT and total are compared by magnitude. The subtotal and every row must
  still be negative.
- Credit photos get an area budget (about 2.57 MP, long side at most 4096 px)
  instead of the 1850 px long-side cap.
- A cloud draft that arrives during a credit read is deferred, so the paid
  result is kept.

What the worker sees:

- **No read button.** Confirming the last unchecked photo of a credit is the
  read: the button says "אשר וקרא את הזיכוי" (`aiConfirmOrientationReview` →
  `deliveryCreditAutoRead`). This is the only automatic trigger. Rendering,
  saving, draft restore, cloud sync, cancelling or deleting a photo, confirming
  an invoice page and a review-only look never start a read.
- **Long slips.** "הפתק ארוך? צלם עוד חלק" appears only on the last unchecked
  photo of a credit, and only while it has fewer than four photos. It confirms
  the photo without reading and opens the camera within the same tap. The read
  starts when the last part is confirmed.
- **During the invoice read.** A credit photo opens for checking at once
  (`deliveryCreditOpenPage` and `aiOpenNextUnconfirmedOrientation` no longer
  wait for the invoice read to finish; invoice pages stay locked). The just-taken photo is
  the one that opens. The card says "ממתין לסיום קריאת החשבונית — הזיכוי ייקרא
  מיד אחריה. אפשר להמשיך לסרוק מוצרים." and then "קורא את הזיכוי…", plus any
  reconnect text.
- **One main action per card state:**
  - "צלם את תעודת הזיכוי" (no photo yet)
  - "בדוק ואשר את הצילום" (a photo not yet checked)
  - "קרא את הזיכוי" (all photos checked but no read started)
  - "נסה שוב" (network or service failure: the same photos; after a network
    failure also the same key, so on v148 this collects the read that is
    already running; after an accepted upload whose collections found no job,
    one more collection and then the photos with the same key; after a failure
    the service reported, one new read with a new key)
  - "אסוף את הקריאה" (photos lost in a reload, but the read that was cut by
    the reload or by the network can still be collected by its key: sends only
    the key, nothing is paid; "צלם את הזיכוי מחדש" is the second way)
  - "צלם את הזיכוי מחדש" (paper problem, or photos lost after a reload or cloud
    restore with nothing to collect; never a retry with photos that are gone)

  Photos that exist also get the small "הזיכוי ארוך? הוסף עוד צילום".
- **Retake replaces the photos.** "צלם את הזיכוי מחדש" uses its own camera
  input (`creditRetake_<id>`, `data-replace="1"`,
  `deliveryCreditAddFiles(id, files, true)`). The old photos are replaced only
  after the new one is prepared.
- **Technical text** such as "Load failed" or "HTTP 502" appears only as a
  small grey left-to-right line.
- **The finished read** refreshes only the credit cards
  (`deliveryCreditRefreshCards`), not the whole receiving screen. A quantity
  field the worker is typing in stays as it is. So does a credit number or
  barcode being typed in another credit's card: while such a field has focus,
  the refresh rebuilds every other card one by one (`deliveryCreditCardHtml`,
  keyed by `data-delivery-credit`) and leaves that card alone until the next
  render.

### Fixes from the v364 review (same release)

- **Fresh token for every send.** `aiRequestSingleDocScan` takes
  `getToken(force)` and asks for a token right before each send: after the
  queue wait and after a screen lock. Firebase hands back its cached token
  until 30 s before it expires, so a collection sent after a long lock used to
  get `401 invalid_auth`; the key was then dropped and "נסה שוב" paid for a
  second read of a job the service still held. A collection refused on sign-in
  is now sent once more with a renewed token, and a collection answered without
  a result keeps the key.
- **A shown result drops the key.** A collection that returns the read's own
  result — a success, or a stored failure carrying the same `scanKey` — deletes
  the remembered key (`aiScanCutKeys`). Before, a stored failure kept the key,
  so every "נסה שוב" collected the same failure again until the job expired.
  Now "נסה שוב" after a shown failure makes exactly one new paid read, with a
  new key, that the worker chose. Only answers without a result (no reply,
  sign-in or rate-limit refusal, missing key on the server, `resume_unknown`
  while its one full re-send is on the way, or after an accepted upload or on a
  collect-only read — see the fourth review round) keep the key.
- **A failed warm-up keeps the last good `/health` answer.** A credit read
  queued between two invoice documents warms its own connection. When every
  GET failed (no reception, or a 5xx/4xx from the front end), the global
  `aiScanServiceStatus` used to become `null` / `{ok:false}`, and the invoice
  document queued behind it lost `scanResume` — its dropped upload was then
  shown as failed instead of collected, exactly on a weak signal. Now only a
  successful answer replaces the status; the failure is returned to the caller
  only. A later successful answer from a rolled-back v147 still turns resume
  off.
- **Cancelled reads release the queue.** Each queued read is
  `{ kind, isCancelled(), abort() }` (`aiScanUploadQueue`). Cancelling a receipt
  or removing a credit aborts its upload (`aiScanDropCancelled`); nobody waits
  for a read whose result would be thrown away.
- **Waiting text names what is really ahead:** the invoice, another credit
  ("ממתין לסיום קריאת זיכוי אחר…"), or an earlier read of both kinds.
- **Looking is not reading.** Tapping the photo of a credit that was already
  confirmed (for example after a failed read) and confirming it unchanged only
  closes the window. A rotated, restored or cropped photo is read again. Paid
  rereads of the same photo stay on the card's own buttons. In crop mode on
  such a photo the green button says "אשר חיתוך והמשך" (and "צלם עוד חלק" is
  hidden) until the frame really moves; the first move switches it to "אשר
  חיתוך וקרא את הזיכוי", and a crop that fails switches it back.
- **No automatic product from a refused row.** When the service refused to
  pick a product (`ambiguous`, `conflicting_reads`, `suggested_*`), the row
  shows the digits it read and asks for the barcode. Before, an EAN-8 that is
  also the tail of another product's EAN-13 was picked on its own.
- **Hebrew main line.** A Firebase error (sign-in renewal without reception)
  or an OpenAI message passed through as `openai_error` goes only to the small
  technical line.
- **A failed retake after a reload shows its own error.** After a reload the
  credit has no photo but still counts one (`pageCount`), so the card says the
  photo was not saved. When the retake's photo then cannot be prepared,
  `deliveryCreditAddFiles` sets `pageCount` to the photos really left (none):
  the card shows "לא הצלחנו להכין את הצילום. צלם שוב." with its technical line,
  the camera as the main action and the gallery as a second way. A retake that
  failed before a reload kept the old photo, so after the reload that card
  still says the photo was not saved.
- **A failed extra part keeps part 1.** `errorKind: 'part'`; the main action is
  "צלם שוב את החלק הבא", with "קרא את הזיכוי" and a full retake as secondary
  actions.
- **Crop, then another part.** "הפתק ארוך? צלם עוד חלק" with a moved crop frame
  first saves the crop and keeps the window open; the next tap opens the camera
  inside the tap (the crop decodes the photo after the tap, and iOS would ignore
  a camera opened then). The window itself says so: the hint reads "החיתוך
  נשמר. עכשיו לחץ על "פתח מצלמה לחלק הבא"…" and the button is renamed "פתח
  מצלמה לחלק הבא" until the photo changes (rotate, restore, a new crop) or the
  window closes. A toast would be invisible: `#toast` (z-60) is under the
  full-screen window (z-95).

### Fixes from the third review round (same release)

- **A read the service accepted is never paid twice on its own.** When a full
  upload was answered `2xx` and the connection died while the body was read
  (`fetch` resolved, `text()` failed, or a `200` held only heartbeat
  whitespace), the service had the photos and was paying. `aiScanSendOnce`
  marks such a cut `accepted`, and the mark is kept with the remembered key
  (`aiScanCutKeys`). If a later collection of that key gets `resume_unknown`
  or `invalid_document_count` (v147), the app no longer sends the photos again
  by itself (v325). On v147 it forgets the key and shows "הקריאה הקודמת אבדה
  בשרת. נסה שוב — הצילום ייקרא מחדש." (code `resume_lost`, not a network error,
  so the credit card's main action is "נסה שוב"); that "נסה שוב" is one new read
  with a new key, chosen by the worker. For `resume_unknown` see the fourth
  review round below: the key is kept and "נסה שוב" re-sends it. The single
  automatic full re-send with the same key stays only for an upload that never
  got a `2xx` (the request itself failed), where the service most likely never
  received the photos.
- **Sign-in refused on a collection: "נסה שוב", not "רענן".** The key is kept;
  a reload would lose the photos (and an invoice's key, which lives only in
  memory), and the next read would be paid again. The message is "החיבור המאובטח נכשל. נסה שוב — הקריאה שכבר נעשתה
  תיאסף בלי תשלום נוסף." on the credit card (`errorKind: 'network'`, main action
  "נסה שוב") and in the invoice banner. "רענן את האפליקציה" stays only for a
  full upload refused on sign-in. Errors thrown by the transport after the key
  was chosen carry `resumable` (true: the key is kept; false: forgotten).
- **A refused credit row can be identified by typing the paper's digits.** Such
  a row (`ambiguous`, `conflicting_reads`, `suggested_*`) was rendered with the
  read digits as the field's value. When the paper shows the same digits, typing
  them changed nothing, the browser fired no `change`, and the row stayed
  unidentified forever. Now the field is empty (placeholder "הקלד את הברקוד
  מהנייר") and the read digits are a hint above it ("נקרא בצילום: …"). The read
  digits are never accepted on their own.
- **The credit's key survives a reload.** When the upload starts against a
  service that can collect (`scanResume`), the credit gets
  `resume: { scanKey, at }` (`onUpload` of `aiRequestSingleDocScan`). It is
  written to the local draft only (`deliveryCreditLocalDraft` in
  `persistReceiptDraft`); `deliveryCreditSnapshot`, the cloud draft and its
  signature never contain it (another device signs in differently). It is
  cleared when a job result is shown (success, paper error, stored failure) or
  the transport forgets the key, and when the credit is removed or gets new
  photos. After a reload an `interrupted` or `network` credit whose key is
  younger than `AI_SCAN_RESUME_TTL_MS` shows "אסוף את הקריאה"
  (`deliveryCreditCollectable`, `deliveryCreditRead(id, true)`): only
  `{reviewProtocolVersion, scanKey, resume: true}` goes out
  (`aiRequestSingleDocScan(..., { resumeKey })`), through the same queue and
  warm-up, and the result continues to the normal review; the paper check uses
  the page count saved in the draft. An expired key leaves only "צלם את הזיכוי
  מחדש"; `resume_unknown` keeps the key (fourth review round below). There are
  no photos, so there is never a full body.
- **Manual-quantities mode keeps a credit field being typed.** An invoice
  document that waited behind a credit and then started (and every later
  progress update) called `refreshScanHost`, which rebuilt the whole manual
  screen and wiped a credit number or barcode being typed. While such a field
  has focus (`deliveryCreditEditingCard`, the same guard as
  `deliveryCreditRefreshCards`) only `#rcPaperStatus`
  (`receiptManualStatusHtml`), `#rcQuantityOptions` and `#rcPriceAudit` are
  refreshed; the next refresh without that focus renders the screen as before.

### Fixes from the fourth review round (same release)

`resume_unknown` says only that the instance that answered has no record of the
key. Cloud Run can run several instances, and a collection can land on another
instance than the one holding the paid read. Two paths gave up after one such
answer and lost a read that was still waiting (reproduced end to end with two
real `createServer()` instances of the service and the real app module):

- **An accepted upload keeps its key.** After a full body answered `2xx` and
  then cut, a collection answered `resume_unknown` used to forget the key at
  once. The one remaining automatic collection was never tried, and "נסה שוב"
  sent the photos with a new key, so a read that the instance holding the job
  would have answered for free was paid again. Now the remaining free automatic
  collections are tried (`AI_SCAN_NETWORK_RETRIES`, the same back-off, the same
  wait for the app to be visible). If they all get `resume_unknown`, the key is
  kept in `aiScanCutKeys` with `accepted` and `lost`, and the error is
  `resume_lost` with `resumable: true` and the message "הקריאה הקודמת לא נמצאה
  בשרת. נסה שוב — הצילום יישלח שוב." A credit keeps its `resume` key
  (`errorKind: 'network'`, main action "נסה שוב"). The worker's "נסה שוב" (or a
  new start of the invoice scan) with the same photos collects once more and,
  if that also gets `resume_unknown`, sends the photos once with the **same**
  key. On the instance that holds the read the service returns the stored
  success or joins the running read, with no model call. Anywhere else it is
  one read, the same as a new key, that the worker chose. v147
  (`invalid_document_count`) still forgets the key.
- **"אסוף את הקריאה" after a reload keeps the key.** A collect-only read
  (`resumeKey`) answered `resume_unknown` used to forget the key and clear
  `c.resume`, leaving only a retake (a second paid read) although the paid read
  could still be waiting on another instance. The key is the only link to it:
  there are no photos. Now the remaining free automatic collections are tried,
  and then the error is `resume_not_found` with `resumable: true`: the key stays
  in memory and in the local draft, the card keeps "אסוף את הקריאה" as the main
  action and "צלם את הזיכוי מחדש" as the second, until the key is older than
  `AI_SCAN_RESUME_TTL_MS` (25 minutes, within the service's 30-minute job
  retention). A collection costs nothing: it is checked before the rate
  limiter and makes no model call.

**Follow-up (not in this release): invoices after a reload.** An invoice
document whose read was cut by a reload still asks for its photos again, and
that new read is paid. The same local-draft key (`resumeKey`) could collect it;
it needs its own restore state on the photo gate and was left out of v364.

## Companion service v148 (yotvata-ai-scan)

- Scan jobs can be resumed by `scanKey`: the job survives a dropped
  connection, and `resume` collects it without another model call. A read that
  failed is collected as its own error, not `resume_unknown`, so the app shows
  it instead of paying for a second read on its own. The stored failure is kept
  like a success, until the job expires or is evicted, and every collection of
  that key returns it. (Dropping it after it was written to one collection
  connection was wrong: after a screen lock that reply can be lost, the next
  automatic collection got `resume_unknown` and the app sent the photos again —
  a second paid read nobody chose.)
- Headers and a first whitespace byte are flushed at once.
- A malformed URL answers `400 invalid_url` instead of crashing.
- `keepAliveTimeout` is 620 s.
- `/health` reports `scanResume` and `creditDocuments`.
- Credit mode (`documentKind: "credit"`) normalizes a real credit note to
  negative amounts and checks its arithmetic by magnitude, with the same
  arbitration read as invoices. An ordinary invoice is never flipped. v147
  ignores `scanKey` and `documentKind`.

## Release order

Either order is safe:

- **App v364 on a v147 service:** the app warms the connection, queues uploads
  and makes one attempt. The key is remembered, so a manual "נסה שוב" costs one
  free `400` and then one upload (when the cut upload had already been answered
  `2xx`, that first "נסה שוב" shows "הקריאה הקודמת אבדה בשרת" and the next one
  uploads). No credit key is kept for after a reload. Slips that print positive numbers are still
  rejected as "not a credit" until v148 is live.
- **v148 with an older app:** the older app sends no key or `documentKind` and
  gets the v147 behaviour.

Recommended order: deploy service v148 (confirm that `/health` shows
`serviceVersion:148`, `scanResume:true` and `creditDocuments:true`), then
release app v364 (`sw.js` `CACHE_NAME` is `yotvata-v364`, and the badge reads
"v364 זיכוי מהנהג נקרא אוטומטית").

## What was verified, and what was not

- `node --test --test-reporter=tap tools/*.test.mjs tools/photo-first-test.mjs`
  runs 371 tests; 369 pass. The two failures (the actual price gap "yes" action
  and unresolved paper values in `receipt-review-fixes.test.mjs`) already fail
  on the v363 main branch with the same assertions and are unrelated.
- `tools/delivery-credit-auto-read.test.mjs` (27 tests) runs the complete app
  module with simulated browser, fetch, timers, image preparation and Firebase.
  It covers:
  - one photo, one confirmation and exactly one paid upload, with no second
    read from a repeated confirmation, a tap while reading, a reopen, a
    re-render, a save, timers or a review-only view;
  - two parts through "הפתק ארוך? צלם עוד חלק": zero uploads after part 1 and
    one upload with both pages after part 2;
  - a credit photographed during the background invoice read: it opens, waits
    in the queue with the waiting text, never overlaps the invoice upload, and
    leaves `aiScanRunId` unchanged;
  - invoice pages locked during the read while credit pages open from the
    queue and from the card;
  - an invoice confirmation never reads a credit;
  - a v147 "Load failed" shown in Hebrew, with the English only in the
    technical line, and "נסה שוב" collecting (free 400) and then uploading
    once with the same key;
  - on v148, "נסה שוב" collecting the running read after the automatic
    reconnects gave up, so the photo is paid for once;
  - a paper error: retake is the main action, a failed preparation keeps the
    old photo, and the new photo replaces it and is read;
  - reload and cloud restore with zero uploads and only retake offered;
  - deleting an extra photo, or sign-in not ready: no read, and "קרא את
    הזיכוי" remains;
  - the old "decode" step absent from every card state;
  - the finished read not rebuilding the receiving screen;
  - the review fixes: looking at a failed credit's photo never pays again
    (a rotated one is read), Hebrew main line for Firebase and OpenAI errors,
    a credit queued behind another credit, a failed extra part, and a moved
    crop followed by "צלם עוד חלק" opening the camera within the second tap;
  - the second review round: the crop instruction shown inside the window
    (hint and button, cleared by a rotation or the next part), the crop-mode
    button on a confirmed photo promising a read only after the frame moved
    (and not after a failed crop), a failed retake after a reload showing its
    own error, and a credit number or barcode being typed in one card surviving
    another credit's read finishing;
  - the third review round: a reload during a read (and after a network
    failure) offering "אסוף את הקריאה", which sends only the key through the
    same warm-up and reaches the review with one paid read in total; the key in
    the local draft and never in the cloud draft; an expired key, a cloud
    restore and a v147 service leaving only "צלם את הזיכוי מחדש", with no full
    body; a collection whose automatic collections all land on an instance
    without the job (`resume_unknown`) keeping the key and "אסוף את הקריאה"
    (retake second) until the key expires, and the next collection reaching the
    instance with the job and the review with one paid read and no full body;
    and, in manual-quantities mode, an
    invoice read that waited behind a credit updating only the status areas
    (no full render) while a credit number or barcode is being typed.
- `tools/scan-transport.test.mjs` also covers the review fixes: a collection
  after a ten-minute lock and a credit queued behind a long invoice read both
  go out with a token taken after the wait (Firebase cache and service expiry
  modelled); a collection refused on sign-in keeps the key and "נסה שוב"
  collects without paying again; a refused (`ambiguous` /
  `suggested_name_multiple`) credit row never picks a product; a cancelled
  receipt and a removed credit abort their uploads and release the queue; a
  stored failure whose collection reply was lost is collected again (no second
  full body), is shown, drops the key, and "נסה שוב" then sends one full body
  with a new key; a collection without a job result (rate limit, missing key,
  another key) keeps the key; a failed credit warm-up keeps `scanResume` for
  the invoice document queued behind it, while a successful v147 answer still
  turns it off. Each of these tests fails when its fix alone is taken out.
  Third and fourth review rounds (7 tests): a full body answered `200` whose
  body read then failed sends no second full body on its own. Collected as
  `invalid_document_count` (v147) it shows the Hebrew "lost" message with
  "נסה שוב" as the main action, and that "נסה שוב" sends one full body with a
  new key. Collected as `resume_unknown` (v148) it uses every automatic
  collection, keeps the key (`lost`, the credit's `resume` too) with "נסה שוב"
  as the main action, and that "נסה שוב" collects once and then sends the
  photos with the same key. Two scripted instances, each with its own job
  store: the upload on A, every automatic collection on B, and the worker's
  "נסה שוב" (credit) or new scan start (invoice) reaching A pays for one read in
  total; an upload that never got a `2xx` still re-sends once with the same
  key; the same for an invoice document; a collection refused on sign-in says
  "נסה שוב" (credit card, `network`, and invoice banner) while a refused full
  upload still says "רענן"; and a refused credit row renders an empty field
  with the read digits as a hint, so typing the paper's digits (with browser
  `change` semantics) identifies the row and the credit can be attached.
- `tools/delivery-credit.test.mjs` was updated to the new contract. Its
  money, identity and invoice-state assertions are unchanged. It also covers a
  credit with a separate document discount: the specific message, "הסר את
  הזיכוי" as the only action (also after a reload), one upload, and the
  amount-only "התקבל זיכוי מהספק" on the saved receipt closing the shortage; a
  discount that does not close, or a read that also contradicts the units,
  still asks for a retake.
- The new tests were checked by breaking the code on purpose. Each of 21
  deliberate regressions (for example no automatic read, a read from render or
  cancel, an invoice unlocked during its read, a retake that appends, a retake
  replaced before preparation, a retry offered without photos, English in the
  main text, a full-screen render when the read finishes) made at least one
  test fail. The third review round was checked the same way: each of 13
  deliberate regressions (the automatic full re-send after an accepted upload,
  no `accepted` mark, a prefilled refused row, "רענן" or `service` for a
  refused collection, no key stored, the key not persisted, no age limit, a full
  body in collect-only mode, the key sent to the cloud draft, no collect button,
  a lost key kept, no focus guard in manual mode) made at least one new test
  fail. The fourth review round too: forgetting a collect-only key on
  `resume_unknown`, forgetting an accepted key on `resume_unknown`, and keeping
  it without the same-key re-send each made at least one of its tests fail.
- Service: `npm test` in `yotvata-ai-scan` passed 70 of 70 at the time of
  writing, with mocked model responses and fixture tokens. The fourth review
  round was also checked end to end (outside the suite) with the real app module
  and two real `createServer()` instances (only the model and Google's keys
  faked): an accepted upload collected on the other instance, and "אסוף את
  הקריאה" after a reload, each end with one paid read.
- **Not verified:**
  - no native iPhone or WebKit test;
  - no deployed Cloud Run service;
  - no paid model call.

  In particular, these still need a real device:
  - that the camera opens from the second tap of "הפתק ארוך? צלם עוד חלק"
    after a manual crop (the tests model the tap, not WebKit);
  - that the `/health` warm-up really prevents "Load failed" on a stale
    connection;
  - that "אסוף את הקריאה" after a real reload (iOS may also evict the page in
    the background) collects the read from the Cloud Run instance that ran it.

  Acceptance on a phone: while an invoice is being read, photograph a one-slip
  credit, confirm it once, keep scanning products, and check that the credit
  turns into a review card without pressing anything else.

Synthetic test documents only. No customer receipt, image, credential or live
data was used or changed.

## v365: a verified credit is attached by itself

### Field report (the shop's backup of 2026-09-25, app v364 / service v148)

Credit 22229080, one slip, two rows. Both cheap reads agreed on everything:
rows `agreed`, doc issues `[]`, `paper_verified`, `creditSigns: "negative"`,
subtotal −155.50, printed units −12, both products resolved by the server
(`model_consensus`), the number read. The app still showed the confirm card
("בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר. האם זה זיכוי על חוסר
במשלוח הנוכחי?") with a barcode field under every row. The owner's decision:
a driver's credit is always part of the current delivery — it arrives together
with the delivery documents, it is not a separate credit for something else —
so there is nothing to confirm document by document; ask only when something
is genuinely unclear.

The same backup showed a false summary review on invoice 407300217607; that
part is described in `tools/RECEIPT-REVIEW-V359.md` (v365 section).

### What changed in app v365

- **Automatic attach** (`deliveryCreditRead`, after the paper check, and only
  there — never from a draft restore, cloud sync, render or refresh). When
  `deliveryCreditReviewReasons(c)` is empty the credit becomes `confirmed`
  with `confirmedAt`, `confirmedSignature` and `autoConfirmed: true` (kept in
  the draft and, through `deliveryCreditNotes`, in the saved receipt's
  `shortCreditNotes`, for audit). The toast is "הזיכוי צורף למשלוח. בסיום
  הספירה נבדוק איזה חוסר הוא מכסה." — once, from the read itself. Empty
  reasons means all of: the paper carries consensus evidence
  (`paper.modelVerification` version 1 with no disputed field, and every row
  `agreed`/`verified` with no issue — `deliveryCreditConsensus`), every row
  resolves to one catalog product (none refused), the credit number is not
  empty and at least one other read saw the same number (next bullet), it is
  not a duplicate (`deliveryCreditDuplicate`) and `deliveryCreditPaperCheck`
  passed. A disputed `documentDiscountExVat` alone is not a dispute for a
  credit whose rows close to the subtotal exactly (the paper check already
  rejects a separate discount): it is the printed discount total, information
  only.
- **The credit number is part of the evidence.** The review of this release
  found that the number was outside the consensus: service v148 compared
  `pageCount`, `subtotalExVat`, `printedUnits`, `documentDiscountExVat`, the
  row count and the rows, never `invoiceNumber`. Two cheap reads that differed
  only in the number (read 0: 22229030, read 1: 22229080) came back `agreed`,
  `paper_verified`, issues `[]`, with the selected read's number and no trace
  of the other, and the app's only check on the number was "not empty" — so
  the credit was attached by itself with a number nobody looked at. That
  number is the key of the duplicate guard (`deliveryCreditDuplicate`, receipt
  history included): the same slip read in a later delivery with the printed
  number was not a duplicate, attached again and reduced that receipt's
  payable a second time. OCR digit confusion is real in this backup (barcodes
  a digit off in two of three documents). Now
  `deliveryCreditNumberUnsupported(c)` requires positive support before a
  credit whose number is still the OCR one is attached by itself:
  `paper.modelVerification.support.invoiceNumber` (service v149, credit mode
  only: the other reads that saw the same number, whitespace-insensitive) must
  name at least one read. Empty support keeps the credit in review with
  "הקריאות לא הסכימו על מספר הזיכוי — בדוק מול הנייר" (when v149 also lists
  `invoiceNumber` in `issues`, the existing "הקריאות לא הסכימו על …" line of
  `deliveryCreditConsensus` carries it once, with `PAPER_SUMMARY_FIELD_NAMES.
  invoiceNumber`). No evidence at all — a v148 answer, or one without
  `support` — keeps it in review with "מספר הזיכוי לא אומת בשרת — בדוק אותו מול
  הנייר": the v364 behaviour, one tap after a look at the number. The number
  field shows the read digits; a number the worker typed (different from the
  read one) is their decision, so it is not checked against the reads and a
  v149 `invoiceNumber` dispute no longer counts for that credit (as a typed
  barcode settles identity). `deliveryCreditConfirm` is unchanged and never
  goes through this gate; the OCR value is never altered.
- **The sticky bar is refreshed after an automatic attach.** `deliveryCreditRead`
  rendered the receiving screen when the read started, so `#rcProgress` said
  "פער ₪48.80 · יש זיכוי שעדיין דורש אישור או תיקון." and `#rcTotals` lacked
  "· 7 בזיכוי ✓" while the card underneath already said "זיכוי שאושר". After
  an automatic attach (and only then, on the receiving screen) the read now
  calls `refreshReceiptTotals()` — v234's surgical refresh of `#rcProgress`,
  `#rcTotals` and `#rcCount`, the same as a quantity keystroke — never a full
  render, so the active quantity field and a credit card being edited stay. A
  read that ends in review changes nothing (the bar already said a credit is
  waiting). Money and finish were never affected.
- **Review says why.** A credit that is not attached stays in `review`, and
  the card carries one plain line (`data-credit-review-reason`): "מוצר אחד לא
  זוהה — הקלד את הברקוד מהנייר" (or "N מוצרים לא זוהו…"), "מספר הזיכוי לא נקרא
  — הקלד אותו מהנייר", "הקריאות לא הסכימו על הסכום לפני מע״מ / הכמות בשורה 2 …
  — בדוק מול הנייר", "הקריאה לא אומתה בשרת — …" (a v147-shaped answer without
  `modelVerification`). When only one read parsed (v149 `readings` with a
  single read: the other cheap read and the verifier dropped, so every field
  is an issue with no support) nothing disagreed, and the line is "רק קריאה
  אחת של הנייר הצליחה — בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר"
  (`deliveryCreditConsensus().lone`, `priceAuditDocumentLoneRead`) rather than
  a list of "disagreements"; the `invoiceNumber` issue is not repeated as a
  second reason. A duplicate keeps its own existing line ("מספר הזיכוי
  הזה כבר צורף…") and is not repeated. The ownership question is gone; the
  button is still "כן, צרף זיכוי של ₪… למשלוח" and the worker's confirmation
  clears `autoConfirmed`.
- **Barcode fields only where needed.** In the review card an identified row
  shows name · quantity · amount and a small "תקן ברקוד" link
  (`delivery-credit-edit-barcode`, `data-row`), which reveals that row's field
  (`c.editBarcode[i]`, display state in memory only: `deliveryCreditSnapshot`
  and `restoreReceiptDraft` drop it). A row without a product (refused or
  unidentified) and a row whose barcode the worker typed keep their field.
  Typing goes through the existing `change` handler; a barcode typed by the
  worker is their decision on identity, so an `identity` dispute on that row
  no longer counts (quantities and amounts still do). The number field is
  unchanged.
- **The attached card** ("זיכוי שאושר · ₪… · פרטים") gets one line when the
  attach was automatic: "צורף אוטומטית — לא של המשלוח הזה? הסר זיכוי" (the
  same remove action as the header), and keeps "תקן פרטי זיכוי".
- **Money is unchanged.** Coverage (`deliveryCreditCoverage`), the live status,
  the finish checks and the block on a credit that matches no counted shortage
  ("הזיכוי אינו תואם לחוסר שנספר…") are exactly v364; an auto-attached credit
  goes through the same checks as one confirmed by hand.

### Companion service v149 (yotvata-ai-scan)

- `documentDiscountExVat` is compared by its effect (the separate document
  discount in agorot), so the printed discount total already inside the net
  rows no longer disputes a summary that every read agreed on.
- `doc.modelVerification.readings` (`[{ read, values: { pageCount,
  subtotalExVat, printedUnits, printedLines, documentDiscountExVat, vatAmount,
  totalInclVat }, discountSeparate }]`) and `.support` (`{ field: [reads] }`).
- `scan.verification.verifier` (`{ attempted, model, requestId, outcome:
  not_needed | failed | agreed | disagreed, error, selected }`).
- The credit number is part of the credit consensus: `support.invoiceNumber`
  lists the other reads that saw the same number, and in credit mode a number
  no other read saw is an `invoiceNumber` issue that escalates to the verifier
  like any other summary field. Invoice outcomes, paid-call counts and request
  bodies are unchanged.

The app works with v148 answers too (no readings, support or verifier): the
summary panel falls back to a field-specific sentence without the per-read
list, and a credit stays in review with "מספר הזיכוי לא אומת בשרת" — one tap,
as in v364. **The automatic attach therefore needs service v149 to be live**;
either release order is safe, but only v149 answers carry the number's
support.

### Verification

- `node --test --test-reporter=tap tools/*.test.mjs tools/photo-first-test.mjs`
  runs 398 tests; 396 pass. The two failures are the same pre-existing ones as
  in v364 (`receipt-review-fixes.test.mjs`: the actual price gap "yes" action,
  and unresolved paper values confirmed as-is).
- `tools/credit-service-contract.test.mjs` (3 tests) is the guard against a
  contract drift between the two repos: the review of this release found the
  app suite proving the automatic attach with a fixture that invented
  `support.invoiceNumber` while the service did not emit it — against the real
  service no credit ever attached by itself. The tests run the service's
  `createServer` in-process (the checkout next to this one, `../yotvata-ai-scan`,
  or `YOTVATA_AI_SCAN=<dir>`; fake OpenAI, a locally signed token, no paid call;
  skipped with a message when the service is not checked out) on the backup's
  credit 22229080 — the two cheap reads exactly as its `readings` recorded them,
  the real catalog rows — and hand the exact answer to the app: two agreeing
  reads → `support.invoiceNumber: [1]`, issues `[]`, `paper_verified`, both rows
  `model_consensus`, and the app attaches the credit by itself (one paid read,
  one toast, ₪155.50, no confirm button, OCR untouched); the numbers 22229030 /
  22229080 with a failed verifier → three calls, issue `['invoiceNumber']`, one
  review line about the number, and with the verifier reading the printed
  number → verified and attached; one parsed read (the other cheap read and the
  verifier dropped) → "רק קריאה אחת של הנייר הצליחה …", one tap. Against the
  v148 service code all three fail (`service v148`, no support).
- `tools/credit-auto-attach.test.mjs` (14 tests, the complete app module; the
  verified fixture imitates the v149 `support` map — the contract test above
  keeps it honest — and `support: false` is the backup's v148 shape): the
  lone-read card line (one reading, every field unsupported → one line "רק
  קריאה אחת של הנייר הצליחה", no "לא הסכימו", no second number reason, one tap
  attaches; two disagreeing readings keep the field sentence); the
  field-shaped verified credit (two agreed rows,
  resolved products, a number another read saw too, negative sums) is
  `confirmed` with `autoConfirmed` right after the read and after the real
  trigger (confirming the last photo), with one paid read, one toast, no
  confirm button, no barcode fields, the automatic note, the sticky bar and
  totals refreshed in place ("החוסר מכוסה בזיכוי ✓", "7 בזיכוי", no "דורש
  אישור") while a read that ends in review or a read on another screen
  rewrites nothing, coverage and finish as before (₪45 payable,
  `shortCreditNotes[0].autoConfirmed`), and the saved receipt; a number no
  other read saw (issue or empty support) → review with its line, the field
  showing the read digits, nothing saved until the worker typed the printed
  number or confirmed by hand, the OCR value kept; a v148 answer → review with
  "מספר הזיכוי לא אומת בשרת", one tap, a subtotal dispute still named beside
  it; an auto-attached credit that covers no shortage is
  still blocked at finish; one refused row → review, the reason line, a field
  only under that row, typing the paper's barcode and confirming by hand; a
  number that was not read; a duplicate (this delivery and receipt history);
  a v147-shaped answer, a subtotal dispute, a quantity dispute, and the
  informational discount (still attached, OCR value kept); "תקן ברקוד"
  revealing one row, typing a different barcode, the state never entering the
  draft; reload and cloud restore keeping the credit confirmed with no read,
  no toast and no re-fire, and "תקן פרטי זיכוי" clearing the automatic mark;
  "הסר זיכוי" from the note reopening the gap.
- `tools/delivery-credit.test.mjs`, `delivery-credit-auto-read.test.mjs` and
  `scan-transport.test.mjs` were updated to the new contract only where they
  matched the old review sentence or the always-present barcode field; every
  money, identity and invoice-state assertion is unchanged. Their fixtures
  carry no `modelVerification`, so those credits still go through the
  worker's confirmation, as a v147 service's answer would.
- Not verified: no phone, no deployed service, no paid model call.

# The credit is photographed on the photo gate — v366

## Field report

Owner, iPhone, app v365. On "שלב 1 · צילום תעודה — מצלמים ומתחילים לקלוט"
there was nowhere to photograph the driver's credit note. He had to photograph
the invoices, press "התחל קליטת מוצרים", and only then did the green credit
button appear on the receiving screen. He wants to photograph the credit right
there, together with the invoices.

## Root cause

`yotvataPhotoGateHtml` already rendered `deliveryCreditsHtml()`, but that
section returned nothing while `receiptNoDoc` was set (or in attach mode). The
screenshot showed "אין תעודה בכלל — קלוט לפי ספירה" (hidden only in attach
mode), so the receipt was a no-document one: "אין תעודה בכלל" was pressed at
some point (`rc-open-nodoc` sets the flag), and the gate was reached again
through "הנייר הגיע" → "חזרה לצילום התעודה / גלריה"
(`switchReceiptEntryMode('photo')`) — or after a reload, since the draft
persists `noDoc`. Nothing on that gate offered the credit until "התחל" cleared
the flag. The finish path (`confirmReceipt`) did already reset the flag in
v365, so a receipt saved as "open" did not leak it into the next one; the
stale gate came from the same receipt returning to its photo step.

## What changed

- `deliveryCreditsAllowed(gate)` / `receivingPhotoGateShown()` /
  `receivingOpened()`: one rule for the credit *button*. Attach mode
  (`receiptAttachTarget`) hides the whole section everywhere, as before.
  `receiptNoDoc` hides the button only on the receiving screen of a
  no-document receipt (no paper → no shortage to claim) — "no document" in the
  sense the finish (`savingNoDoc`) and the "קליטה בלי תעודה" bar already use,
  `receiptWithoutPaper()`: the flag is set and no anchor has been typed. Once
  "הנייר הגיע" and a sum was typed the receipt has paper and the button
  returns. Cards of credits that already exist are always rendered
  (`deliveryCreditsHtml` drops only the add button when it is not allowed), so
  "הסר זיכוי" and the review/error actions stay reachable and
  `deliveryCreditOpenWork` has a card to scroll to. On the photo gate the
  section is always rendered (`deliveryCreditsHtml({ gate: true })`):
  photographing paper means the receipt will have paper. The default `gate`
  follows the screen that is shown, so `deliveryCreditRefreshCards` keeps
  refreshing the gate card in place (reading, waiting, progress, attached)
  without rebuilding the gate's document cards; `renderReceiving` uses the
  same predicates. `delivery-credit-add` is refused where the button is not
  rendered.
- Photographing a credit clears `receiptNoDoc` (`delivery-credit-add`), not
  only "התחל" (`yotvataStartPaperScan`): a credit photographed on the gate of
  a no-document receipt — or on its receiving screen after the anchors were
  typed — says the receipt has paper. So "הקלדת סכום ויחידות ידנית" after a
  gate credit is an ordinary paper receipt (card visible, also after a reload;
  the finish asks for the invoice amount) instead of a no-document receipt
  with a hidden credit, whose finish was diverted into the reconcile screen
  against ₪0 and then bounced ("הזיכוי אינו תואם לחוסר שנספר…") to a screen
  without the card. Removing the typed note afterwards keeps the credit
  visible and the finish still asks for the amount.
- `finishReceipt` guard, before `deliveryCreditReady()`: a credit on a receipt
  without paper (`receiptWithoutPaper() && receiptDeliveryCredits.length`,
  reachable only from a draft saved before this change) stops with "לקליטה
  בלי תעודה אי אפשר לצרף זיכוי — הסר את הזיכוי או הקלד את נתוני התעודה." and
  scrolls to the card, which is on the screen; after "הסר זיכוי" the
  no-document finish opens the summary as before, and after "מצאתי את
  התעודה" + anchors it is an ordinary comparison with the credit.
- `yotvataResetPhotoReceipt` also clears `receiptNoDoc`, so every reset of the
  photo receipt (finish, cancel, attach and its cancel) starts the next one
  with a whole gate whoever calls it; `receiptAttachTarget` is untouched there.
- "אין תעודה בכלל" (`rc-open-nodoc`) after a credit was photographed on the
  gate first asks — `showConfirm('אין תעודה בכלל', 'צילמת זיכוי מהנהג. בקליטה
  בלי תעודה הזיכוי יוסר ויהיה צריך לצלם אותו שוב. להמשיך בלי הזיכוי?', 'המשך
  בלי זיכוי')`, the same pattern as "ביטול תעודה" — because the credit was
  already read (paid), or its read is waiting on the server, and a mis-tap
  would otherwise cost a second paid read with no undo; nothing changes before
  the answer. A receipt without credits, and an empty capture card (camera
  cancelled, no photo), take the immediate path. On "המשך בלי זיכוי" it drops
  the credits (`receiptDeliveryCredits = []`, `pendingReceipt` cleared),
  aborts a read in flight or waiting (`aiScanDropCancelled`: the credit is no
  longer in the list, so its entry is cancelled — the aborted upload's answer
  is discarded and nothing else is sent), closes the photo window if it shows
  a credit page (`aiCloseOrientationReview` inside `resetAiInvoiceScan(true)`),
  and shows "זיכוי מהנהג מצורף רק לקליטה עם תעודה." — only when something was
  dropped.
- Gate wording: the green button stays right under "+ תעודה נוספת מהנהג /
  הספק"; one grey line under the intro: "תעודת זיכוי מהנהג מצלמים בכפתור
  הירוק — היא נקראת לבד." The line is omitted in attach mode, where the gate
  has no credit button (`deliveryCreditsAllowed(true)`, the predicate the
  section itself uses). On the gate a reading card ends with "אפשר להמשיך
  לצלם את התעודות וללחוץ "התחל קליטת מוצרים"." — step 1 has no product
  scanner — while the receiving screen keeps "אפשר להמשיך לסרוק מוצרים."
  (`deliveryCreditNoticeHtml`, by `receivingPhotoGateShown()`).
- A credit photographed before "התחל" is read at once (the queue is empty),
  attached by itself when verified (v365) or left for review, and survives
  "התחל קליטת מוצרים", "פענח תעודה — הכמויות נבדקות ידנית" and "הקלדת סכום
  ויחידות ידנית": none of `yotvataStartPaperScan`, `renderReceiving`,
  `aiRunInvoiceScan` or the draft save replaces the credit objects. The invoice
  uploads queue behind a credit still being read (FIFO lock; the invoice banner
  says "ממתין לסיום קריאת הזיכוי…"), and `yotvataPhotoReady()` never looks at
  credits, so "התחל" is not blocked by a credit that is still read.
- Version: v366 "זיכוי מצלמים כבר במסך הצילום"; `sw.js` cache `yotvata-v366`.

## Verification

- `tools/credit-on-gate.test.mjs` (9 tests, the complete app module; fetch,
  timers, image preparation and Firebase are faked; no paid call): (a) a
  finished no-document receipt (saved `open`, ₪45) → the next gate has the
  button, the flag is not persisted, `yotvataResetPhotoReceipt` clears it;
  (b) a no-document receipt back on the gate → button and hint shown, the
  receiving screen hides the section and refuses `delivery-credit-add`, the
  reloaded draft lands on the same gate with the button, "התחל" turns it into a
  paper receipt, attach mode hides it on both screens and the gate hint with
  it; (c) credit on the gate →
  confirm → exactly one `/scan` (credit) → `confirmed` with the v149 verified
  fixture → "התחל" → the invoice `/scan` goes out after the credit's, the same
  credit object, the confirmed card on the receiving screen, finish coverage
  unchanged (₪45 payable, `shortCreditNotes[0].autoConfirmed`, two uploads in
  all); (d) "התחל" enabled while the credit is read, the invoice waits with its
  banner text, the credit survives and attaches, one upload at a time, the
  gate's reading card is worded for the gate (no "לסרוק מוצרים" there); (e)
  "אין תעודה בכלל" with a read in flight → asks first (credit, draft and read
  untouched before "המשך בלי זיכוי"), then credit dropped, upload aborted, the
  late answer changes nothing, toast once, draft without it, finish not
  blocked; with the photo still open → asks, then window closed, no request
  at all; without a credit → no question, no toast; an empty capture card →
  no question; (f) manual quantities and manual anchors keep the credit (no
  invoice read on the manual path); (g) two gate credits → the waiting and
  progress texts reach the gate card through `deliveryCreditRefreshCards`,
  the gate HTML (document cards, photos, inputs) is byte-identical before and
  after both reads, one paid read each; (h) the field-report receipt end to
  end: no-document → "מצאתי את התעודה" → "חזרה לצילום" → gate credit clears
  the flag (draft too) → "הקלדת סכום ויחידות ידנית" shows the card, the
  floating "סיים תעודה" asks for the amount and never opens the reconcile
  screen, a reload of that draft is the same paper receipt, typed anchors
  open the ordinary comparison against ₪93.80; a review-status credit gets
  "לפני הסיום צריך להשלים…" with the card on screen; the no-gate route
  (anchors typed → credit on the receiving screen → note removed) keeps the
  card and asks for the amount; (i) a v365 draft with a hidden credit on a
  no-document receipt → card and "הסר זיכוי" rendered, no add button, finish
  stops with the no-document explanation (confirmed and review credit alike),
  after removal the no-document summary opens (`noDoc`, `open`, ₪45), after
  "מצאתי את התעודה" + anchors the comparison opens with the credit.
  Against the v365 app, (a), (b) and (e) fail; reverting each v366 review fix
  alone fails its own test: cards + finish guard → (i), the confirmation →
  (e), the flag cleared on add → (h), the attach-mode hint → (b), the gate
  wording → (d) and (g).
- The verified fixture (`verifiedCredit`, `verifiedRow`) moved from
  `credit-auto-attach.test.mjs` to `tools/credit-verified-fixture.mjs`,
  shared with the new tests; shape and values unchanged.
- Full suite: 407 tests, 405 pass; the only failures are the two pre-existing
  ones ("an actual price gap has a working yes action…", "unresolved paper
  values can be confirmed as-is…").
- Not verified: no phone, no deployed service, no paid model call.

## Follow-ups

- Attach mode (paper for a receipt saved without a document) still offers no
  credit on any screen; a driver credit handed over with the late paper has
  to be recorded from the receipt card ("התקבל זיכוי מהספק").
- A draft saved before this change that holds a credit on a no-document
  receipt (photographed on the gate, then "אין תעודה בכלל" — v365 kept the
  credit) is now the only way into that state, since photographing a credit
  clears the flag. Such a draft shows the card on its receiving screen (no add
  button), and the finish stops with "לקליטה בלי תעודה אי אפשר לצרף זיכוי —
  הסר את הזיכוי או הקלד את נתוני התעודה." until "הסר זיכוי" or "מצאתי את
  התעודה" + anchors (test i).
- On the manual-anchors path (no invoice read) a credit cannot be matched to a
  per-product shortage, so the comparison still ends with "הזיכוי אינו תואם
  לחוסר שנספר…" unless the counted lines explain it — unchanged since v364,
  not part of this change.
