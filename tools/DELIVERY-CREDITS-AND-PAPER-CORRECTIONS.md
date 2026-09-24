# Receiving credits and correcting paper readings — v346

Drivers can supply a credit note with the delivery. Previously the receiver had
to finish first, then find the saved receipt and enter a credit amount. Also,
confirming a product fixed its identity but offered only catalog-price editing
when its OCR price was wrong.

## Receiving flow

- “הנהג הביא זיכוי על חוסר? צלם כאן” is available during ordinary receiving,
  including the invoice capture screen and manual entry.
- Camera and gallery use the existing full-image, rotation and explicit-crop
  controls. Since v364 there is no separate read button: confirming the last
  photo of a credit (“אשר וקרא את הזיכוי”) starts its read. A long slip in
  several parts uses “הפתק ארוך? צלם עוד חלק”, which confirms without reading
  and opens the camera; the read starts when the last part is confirmed. Each
  read makes one paid request for that credit only; it never rereads the
  invoices.
- Review the credit number, product, quantity and amount excluding VAT, then
  confirm that the credit belongs to the current delivery. Up to four credits,
  each with up to four pages, can be attached.
- Number and barcode can be corrected. Credit pages require negative printed
  amounts, internally consistent rows and summary, and exact catalog barcodes.
  A positive invoice is never silently converted into a credit.
- Confirmed values and source evidence survive local/cloud draft restoration.
  Image bytes remain transient, consistently with invoice images. Interrupted
  reads request recapture and do not automatically run paid OCR again.
- Finishing checks each credit against the same missing products, quantities
  and money. An unrelated, overlapping or excessive credit blocks completion
  with an explanation. Duplicate credit numbers are checked within the draft
  and loaded receipt history.
- Final persistence writes the receipt and credits using the existing atomic
  draft revision guard. Partial credits leave the remaining debt open.

Credits are stored as `shortCreditNotes` with `source: delivery_credit_scan` and
their product rows and signed paper evidence. They close the existing shortage
claim; the payable amount continues to subtract the original shortage exactly
once. They never become returned goods, scanned stock, invoice anchors or an
additional supplier discount. Credited products are excluded from later goods
offsets. Legacy amount-only credits retain their existing behavior.

The deployed OCR protocol already preserves signed document values. A local
contract check against the service source, with a mocked model response and
test authentication, returned the negative credit without checksum/barcode
retries. No backend change or paid model call was needed for this update.
The protocol does not return a reference invoice number for credit notes, so
the user explicitly confirms ownership by the current delivery.

### v364: credit read transport and paper acceptance

- A credit read warms the connection (`GET /health`) right before its upload and
  waits its turn behind an invoice document that is being read (one paid upload
  at a time). While queued the card object has `waiting: true` and `waitingFor`
  (`'invoice'`, `'credit'` or `null`), so the card names what it really waits
  for; reconnect text is in `progress` (never the invoice banner). Failures set
  `errorKind` (`network` | `service` | `paper` | `photo` | `part` | `discount`), a Hebrew
  `error` and a technical `errorDetail`. The main `error` is always Hebrew: an
  English Firebase or OpenAI message goes only to `errorDetail`. See
  `tools/PHOTO-FIRST.md` (v364) for resume-by-key.
- Rows accept EAN-8 as well as EAN-13 with the invoice path's check-digit and
  single-product rules. A row the service refused to resolve (`barcode: null`
  with `ambiguous`, `conflicting_reads` or a `suggested_*` method — for example
  the last 8 digits of an EAN-13 that are also another product's EAN-8) shows
  the digits it read as a hint above an empty barcode field (“נקרא בצילום: …”)
  and never picks a product by itself; the worker types the barcode from the
  paper. The field is empty on purpose: with the read digits as its value, a
  worker typing the same digits changed nothing, the browser fired no `change`,
  and the row could never be identified. VAT and total are compared by magnitude, because slips
  often print them without a minus sign; the subtotal and every row must still
  be negative.
- Credit pages use an area budget (≈2.57MP, long side ≤ 4096) instead of the
  1850px long-side cap, so a long 1:5 thermal slip keeps about 715×3580 pixels.
  The budget is stored on the page and kept by manual crop and restore. Invoice
  pages are unchanged. The gain needs the slip isolated by the automatic or a
  manual crop; an uncropped 4:3 frame gets the same pixels as before.
- A cloud draft that arrives during a credit read is deferred to the existing
  conflict notice instead of discarding the paid result.
- A credit that prints a separate discount on the whole document (rows −60 and
  −40, discount 5, subtotal −95) is not supported: coverage matches row totals
  to the shortage, and the discount belongs to no product. Service v148 accepts
  such a paper, so a retake would only pay for the same answer again. When the
  rows close to the subtotal exactly through the discount (in agorot, by
  magnitude) and every other check passes, the card gets `errorKind:
  'discount'`: the message says a new photo will not help, and the only action
  is “הסר את הזיכוי” (no retake, no read of the same photo, no extra photo, and
  the photo is not shown for rotating). The worker then finishes the receipt
  and records the credit on the saved receipt with the legacy amount-only entry
  (“תעודות” → the receipt → “התקבל זיכוי מהספק”, amount before VAT). A discount
  that does not close exactly, or a read that also contradicts units, lines or
  VAT, is still a `paper` error with a retake.

### v364: automatic read and one clear action per state

The read starts automatically in exactly one place: confirming, in the photo
check window, the photo that leaves no unchecked photo in that credit
(`aiConfirmOrientationReview` → `deliveryCreditAutoRead`). Rendering, saving,
draft restore, cloud sync, deleting or cancelling a photo, confirming an
invoice page and a review-only look at a photo never start a read. Tapping the
photo of a credit that was already confirmed (for example after a failed read)
and confirming it unchanged only closes the window; a rotated, restored or
cropped photo is read again (in crop mode the button promises a read only after
the frame really moved). A read in
progress cannot be started again: its card has no action buttons, its photos
cannot be reopened, and `deliveryCreditRead` refuses a busy credit.

- A credit photographed while the invoice is read in the background opens for
  checking at once. Invoice pages stay locked during their read, as before. The
  confirmed credit waits in the one-paid-upload queue; its card says “ממתין
  לסיום קריאת החשבונית — הזיכוי ייקרא מיד אחריה. אפשר להמשיך לסרוק מוצרים.”
  (behind another credit: “ממתין לסיום קריאת זיכוי אחר…”; behind both kinds:
  “ממתין לסיום קריאה קודמת…”). A removed credit or a cancelled receipt stops its
  upload, so nothing waits for a read whose result would be thrown away.
- The card offers one main action per state: “צלם את תעודת הזיכוי” (no photo),
  “בדוק ואשר את הצילום” (a photo not yet checked), “קרא את הזיכוי” (all photos
  checked but no read started, for example when sign-in was not ready or an
  extra photo was deleted), “נסה שוב” after a network or service failure (same
  photos, same key: on service v148 this collects the read that is already
  running instead of paying again), and “צלם את הזיכוי מחדש” after a paper
  problem (unreadable, sums do not match, not a credit). The alternative is a
  small secondary button. Photos that exist also get “הזיכוי ארוך? הוסף עוד
  צילום”.
- “צלם את הזיכוי מחדש” opens a separate camera input (`creditRetake_<id>`,
  `data-replace="1"`). Its photo replaces the credit's photos only after it was
  prepared successfully; a failed preparation keeps the old photos. When an
  extra part of a long slip cannot be prepared (`errorKind: 'part'`), the
  confirmed parts stay and the main action is “צלם שוב את החלק הבא”.
- “הפתק ארוך? צלם עוד חלק” after moving the crop frame first saves the crop and
  keeps the window open; the next tap opens the camera (iOS opens it only
  within a tap, and the crop decodes the photo after the tap is over). The
  window's hint says so and the button reads “פתח מצלמה לחלק הבא” (a toast would
  be hidden under the full-screen window).
- After a reload or a cloud restore the photos are not in memory, so a credit
  that was being read or had failed never offers a retry with photos. When the
  read went out to a service that can collect (`scanResume`), the local draft
  (never the cloud draft) keeps its key (`resume: { scanKey, at }`): for 25
  minutes a credit whose read was cut by the reload or by the network offers
  “אסוף את הקריאה”, which sends only the key (no photos, nothing paid) and
  continues to the normal review. A collection that finds no job
  (`resume_unknown`) may have reached another instance of the service than the
  one holding the paid read: the free automatic collections are tried, and then
  the key is kept, so “אסוף את הקריאה” stays (with “צלם את הזיכוי מחדש” as the
  second action) until the key expires. An expired key, a cloud restore or a
  v147 service leave only “צלם את הזיכוי מחדש”.
- Messages are simple Hebrew. The browser's own text (for example “Load
  failed”) or an HTTP status appears only as a small grey left-to-right line.
- Details, field report and verification: `tools/CREDIT-AUTO-READ-V364.md`.

## Correcting an OCR row

“הפענוח שגוי — תקן לפי הנייר” now opens a form for the identified product's
quantity, printed unit price, and net row total. Catalog editing remains under
a separate collapsed action for cases where the printed reading is correct.
The row can also be identified again using its printed barcode.

The approved correction updates the working invoice row and the price review.
`__pricePaper` keeps the original OCR unchanged. `paperValuesCorrection` stores
the approved values, original evidence, product/barcode, time and previous
correction. Editing invalidates any checkout summary or stale analysis.

The original invoice summary amount and printed unit count remain the anchors.
If corrected rows no longer add up, a visible explanation blocks finishing
until the paper is consistent. Balanced matching rows leave the pending queue;
approved corrections remain editable in a collapsed history. Corrections do
not copy catalog prices onto the paper or modify the product catalog.

## Verification

### v346: compact credits and live remaining discrepancies

Confirmed credits now use native, closed-by-default details controls. Photos,
line details and edit/remove actions open from a short amount summary. The
additional-credit action also takes less space once a credit has been added.

Receiving progress, reconciliation, actionable findings and checkout now apply
the same product/quantity/money coverage matcher as final saving. A matching
credit immediately labels the shortage as covered. Partial credits show only
the uncovered units and money; a credit covering all units but insufficient
money still leaves a monetary issue visible. Editing counts, credit approval,
removal and draft restoration all recompute coverage without another OCR call.

The invoice amount and units remain original, physical received counts remain
physical, and payable amounts are not reduced twice. Unverified invoice data,
wrong products, duplicate/overlapping credits and excessive quantities or money
cannot produce an all-clear state. Separate shortages, surplus and price issues
remain actionable. Original findings stay in the audit; old analyst claims
are not displayed as outstanding claims for a credited shortage.

The current suite passes 226 tests, including 41 credit scenarios. Twelve
financial scenarios are identical to v345. Verification uses the complete
application module with simulated browser/model/Firestore boundaries; native
phone interaction was not tested.

```sh
node --test --test-reporter=tap tools/*.test.mjs tools/photo-first-test.mjs
PRICE_FINANCE_BASE=03c0b147e42303f26711b195cfed0e9f16472220 node tools/price-finance-regression.mjs
```

### v345 baseline

```sh
node --test --test-reporter=tap tools/*.test.mjs tools/photo-first-test.mjs
PRICE_FINANCE_BASE=b1185ef62328897b967451a1c3afb052eb49ab9a node tools/price-finance-regression.mjs
```

The suite covers 214 scenarios, including 29 credit scenarios and 16 paper-row
correction scenarios. The financial comparison also checks 12 combinations of
price, counted quantity and promotion against v344 for receipts without these
new actions. Tests run the actual application module with simulated browser,
model and Firestore boundaries. Camera pixels are separately exercised by the
existing image-capture tests. Native phone interaction was not tested.

Synthetic test documents are used throughout. No customer receipt, backup,
image, authentication credential or live data was changed or committed.
