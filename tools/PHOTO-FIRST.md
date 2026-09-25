# v325 — photo first receiving

The default receipt entry screen accepts up to four invoices and eight pages.
Pages of one invoice remain grouped; a separate driver invoice gets its own
card. After orientation confirmation, “התחל קליטת מוצרים” opens the existing
barcode flow while the invoice is decoded in the background.

Only printed summary values that close against that invoice's rows become
anchors. The original receipt count is never populated from OCR. Finishing
compares individual products even when grand totals happen to match.
Manual entry, explicit no-units waiver, deposits, no-document receiving and
attaching a later invoice retain their existing rules. No Berman promotion
rules were copied.

Completed reads and per-call model audits are checkpointed in the local draft
after each invoice. Images remain in memory. Refreshing during an unfinished
read preserves the physical counts and completed reads, and requests the
unfinished invoice's images again. It never silently repeats an upload.
Cancelling a receipt prevents its pending OCR from writing into a new receipt.
Final receipt records contain `scanAudit`; their expanded history shows model
attempts and outcomes.

An ambiguous network failure never automatically re-submits a paid invoice
POST. Since v364 the only automatic retry is collecting the same read by its
`scanKey` (`resume: true`, no photos), and only when the last successful
`/health` answer reported `scanResume: true` (service v148+); otherwise there is one attempt (see
v364 below). A deliberate continuation reuses completed invoices and submits
only uncached ones. Automatic photo rotation retries are disabled for photo-first
receipts, whose orientation was explicitly confirmed before submission.

### v364 — resumable transport, warm-up, one paid upload at a time

Every paid `/scan` (invoice document or driver credit) now carries a random
`scanKey`. Before an upload the app sends a free `GET /health` (retried up to 3
times on a network drop, a cut body or a 5xx; a successful answer is kept in
`aiScanServiceStatus`, and a failed warm-up leaves the previous answer there, so
an invoice document queued behind a credit whose warm-up failed keeps its
automatic collection). Automatic retries after a network failure happen only
when that answer says `scanResume: true` (service v148+), and they *collect* by
key (`{reviewProtocolVersion: 1, scanKey, resume: true}`) instead of uploading
again. `resume_unknown` or `invalid_document_count` falls back to one full send
with the same key only while no full body with that key was ever answered 2xx.
Once one was (the connection died while the body was read, or a `200` carried
only heartbeat whitespace — the service had accepted the photos and was paying),
a collection that finds no job never sends the photos again on its own (v325).
`resume_unknown` there says only that the instance that answered has no record
of the key (Cloud Run may have sent the collection to another instance than the
one holding the paid read), so the remaining free automatic collections are
tried first. If they all get `resume_unknown`, the key is kept, marked `lost`,
and the worker sees "הקריאה הקודמת לא נמצאה בשרת. נסה שוב — הצילום יישלח שוב."
(code `resume_lost`, `resumable: true`; a credit keeps its `resume` key and its
main action "נסה שוב"). That "נסה שוב" collects once more and, if the job is still
not found, sends the photos with the **same** key: on the instance that holds the
read the service returns the stored success or joins the running read, for free;
anywhere else it is one read the worker chose. `invalid_document_count` (v147,
which stores nothing) still forgets the key and shows "הקריאה הקודמת אבדה בשרת.
נסה שוב — הצילום ייקרא מחדש." (not a network error); the next "נסה שוב" is one new
read with a new key. The accepted and lost marks travel with the remembered key,
so a manual retry knows them too. A credit collected without photos after a
reload (`resumeKey`) that gets `resume_unknown` on every automatic collection
keeps its key too (`resume_not_found`, `resumable: true`): "אסוף את הקריאה" stays
until the key expires, with the retake as the second action.
`resume_unknown` means the service has no record of the read
(a restarted or different instance, or an expired job); a read that ran and
failed comes back as its own error and is shown, never re-sent. v148 keeps that
stored failure until the job expires or is evicted and returns it on every
collection of the key, so a failure whose reply was lost (screen lock) is still
the answer to the next automatic collection, never a second paid read. A result
of the read itself — a success, or a failure carrying the same `scanKey` — drops
the remembered key: after a shown failure "נסה שוב" is exactly one new read with
a new key, chosen by the worker. Against v147 the v325 rule above still holds: one attempt.
Either way the key of a cut read is remembered for 25 minutes, so a deliberate
retry with the same photos collects on v148 (on v147 it gets a free 400 and then
sends once, unless the cut upload had been answered 2xx — then the worker sees the
"lost" message above and the next "נסה שוב" sends). A `200` whose body is only heartbeat whitespace is a cut connection;
a non-JSON error status (e.g. a gateway 502) is a service answer and is never
retried or collected. Paid uploads are serialised: a credit read waits for the
invoice document in flight and vice versa (`aiScanWithUploadLock`). Network
errors are plain Hebrew; the browser's own message is kept in `error.detail`.
The Firebase token is taken right before every send (after the queue wait and
after a screen lock), not once per run; a collection refused on sign-in is sent
once more with a renewed token, and a collection answered without a result
(sign-in, rate limit, missing key — none of these carries `scanKey`) keeps the
key, so "נסה שוב" still collects instead of paying again. A collection refused
on sign-in therefore says "החיבור המאובטח נכשל. נסה שוב — הקריאה שכבר נעשתה
תיאסף בלי תשלום נוסף." (invoice banner and credit card alike; on the credit card
it is a `network` error, main action "נסה שוב"). It never says "רענן": a reload
drops the in-memory key and photos, and the next read would be paid again. Only
a full upload refused on sign-in (nothing paid, nothing to collect) still says
"רענן את האפליקציה". A thrown error carries `resumable` (true: the key is still
kept; false: it was forgotten). A read whose receipt was cancelled, or whose credit was removed,
has its upload aborted and never holds the queue.
Tests: `tools/scan-transport.test.mjs`.

A driver credit rides on the same transport and is read automatically when its
last photo is confirmed; a credit photo can be checked while the invoice is
still being read (invoice pages stay locked). A credit's key also survives a
reload (local draft only): `aiRequestSingleDocScan(..., { resumeKey })` sends
only the collection body, never a full one, through the same queue and warm-up
("אסוף את הקריאה"). Invoices do not have this yet: after a reload an unfinished
invoice still asks for its photos again (follow-up in
`tools/CREDIT-AUTO-READ-V364.md`). In manual-quantities mode an invoice progress
update no longer rebuilds the screen while a credit number or barcode field has
focus; only the status, quantity-button and price areas are refreshed. See
`tools/DELIVERY-CREDITS-AND-PAPER-CORRECTIONS.md` and
`tools/CREDIT-AUTO-READ-V364.md`; tests: `tools/delivery-credit-auto-read.test.mjs`.

### v366 — the driver credit is photographed on the gate

The photo gate always renders the credit section (`deliveryCreditsHtml({ gate:
true })`), also for a no-document receipt that came back to its photos; a
credit photographed there clears `receiptNoDoc` (the receipt has paper) — when
the photo is actually added (`deliveryCreditAddFiles`), not on the tap of the
green button: a cancelled camera leaves an empty card and the flag, and the
no-document receipt still finishes "לפי ספירה" — is read at once, its card refreshes in place on the gate (worded for the gate:
"… אפשר להמשיך לצלם את התעודות וללחוץ "התחל קליטת מוצרים"."), and "התחל קליטת
מוצרים" keeps it while the invoice uploads queue behind its read ("ממתין
לסיום קריאת הזיכוי…"). `yotvataPhotoReady()` ignores credits. "אין תעודה
בכלל" asks before dropping gate credits ("המשך בלי זיכוי"), then drops them
with a toast. The gate says under its intro: "תעודת זיכוי מהנהג מצלמים בכפתור
הירוק — היא נקראת לבד." — not in attach mode, where the gate has no credit
button. A credit on a receipt without paper (drafts from before this change)
is still shown on the receiving screen, and the finish stops with an
explanation until it is removed or the anchors are typed. See
`tools/CREDIT-AUTO-READ-V364.md` (v366); tests: `tools/credit-on-gate.test.mjs`.

## Validation

`node --test tools/photo-first-test.mjs`

Tests execute the actual inline app functions, including the physical count,
reconciliation evaluator, draft restore, renderer's review gate and legacy
manual finishing path. All inputs are synthetic. No Firebase writes or paid
model requests are made. Browser testing of the local preview was blocked by
the execution environment; an iPhone test remains required.

## Real-device acceptance (after server v145 and app v325 are released)

1. Confirm the visible v325 badge. Open receiving and photograph every page,
   including the last page's summary/signature. Add a separate card for a driver
   invoice, if present.
2. Start receiving and scan/count products immediately. OCR progress must not
   close the scanner or replace an active quantity field.
3. Finish: verify the printed subtotal, units and actual item quantities.
   Correct a counted quantity and return to review: no new OCR request should
   be sent.
4. Save and expand the receipt's scan details. Check the model(s), retry stages
   and results. Inspect Cloud Run `invoice_scan_audit` if needed.
5. Compare with the actual paper before proceeding to the Tnuva implementation.

Deploy the existing scanner service first: app v325 checks for service v145+
and `photoFirst:true` before sending an invoice image. An older service offers
manual fallback and receives no paid photo-first request.
