# Receipt review regression — v359

The v358/service-v146 rollout exposed three gaps in an actual saved receipt:
EAN-8 identities were excluded from consensus, identity disputes were displayed
as numeric disputes, and correct but unresolved numbers only offered correction.
A missing discount column also disagreed with the same discount derived by a
peer from the printed gross and net totals.

## Changes

- Accept checksum-valid, unique EAN-8 catalog identities alongside EAN-13 in
  consensus, paper confirmation and manual barcode entry.
- Keep unresolved identity out of receiving reconciliation. Offer confirmation
  or choices from all model candidates, including a correct peer candidate that
  was absent from the selected model's name hints.
- Offer “כן, הכמות והמחיר נכונים לפי הנייר” for complete, consistent numeric
  values that still need review. Record the approval without changing any OCR
  field, including null discounts. Missing or contradictory values still need
  correction.
- Bind approvals to the exact source, product, values and verification evidence;
  preserve them across draft reload and invalidate them after relevant edits.
- Keep actual catalog price gaps in the financial audit. A confirmed identity
  with already agreed amounts does not need a second numeric confirmation.

## Verification

`node --test tools/*.test.mjs tools/*-test.mjs`: 275 passing tests. New regression
cases cover verified and legacy EAN-8, missing peer candidates, approve-as-is,
null preservation, stale actions, reload with reordered evidence keys, missing
or contradictory amounts, and manual EAN-8 entry.

A local replay of the supplied real v146 draft completed the review flow,
including the missing promotion carton size, with zero new scan requests,
unchanged extracted paper data and the correct 1,343.87 pre-VAT receipt total.
The private backup and receipt photo are excluded from this repository.

Release this app before service v147. The backend adds EAN-8 consensus and
equivalent-discount comparison while preserving the rule that the stronger
read agreeing with either initial read is sufficient verification.

## v365: a false summary review, and a review that says why

### Field report (the shop's backup of 2026-09-25, app v364 / service v148)

Invoice 407300217607 (1 page, 6 rows). Both cheap reads returned an internally
balanced paper — subtotal 311.77, 61 units, rows summing to 311.77,
`documentDiscountExVat: null`. They disagreed on the identity of two rows, so
the verifier (the strong model) ran and was selected. It read the same
311.77 / 61 / 311.77, but it also copied the "סה״כ הנחות" line that
Strauss/Yotvata prints into `documentDiscountExVat: 41.9`. That line is the
total of the row discounts already inside the net rows
(11.93 + 15.97 + 7 + 7 = 41.9; every paper check said
`discountSeparate: false`). Consensus flagged `documentDiscountExVat`, and
`priceAuditDocumentReviewNeeded` turned any doc-level issue into "צריך לאשר את
סיכום התעודה — הסריקות לא הסכימו על הסיכום. בדוק מול הנייר: 311.77 …": a manual
confirmation of a summary all three reads agreed on. Invoice 9073807997
(3 pages, 22 rows) also escalated (a unit price 3.72 against 3.16) and ended
`paper_verified` with no review — correct.

### What changed

- `priceAuditDocumentDisputes(doc)` is the list of summary fields that really
  need the worker. A `documentDiscountExVat` issue is dropped when the selected
  paper is balanced without a separate discount — `yotvataPaperCheck(source,
  pages).ok && !discountSeparate`, where `discountSeparate` is the server's
  rule (Σ rows − discount === subtotal, in agorot). The other issues
  (`subtotalExVat`, `printedUnits`, `pageCount`, `rowCount`) still require the
  review. `priceAuditDocumentReviewNeeded` uses this list; the token
  (`priceAuditDocumentReviewToken`) is unchanged and still invalidates on any
  value change. No OCR value is filled or altered.
- The panel names the disputed field(s) in Hebrew ("הקריאות לא הסכימו על הסכום
  לפני מע״מ ועל סך היחידות.") and, when the service sent
  `doc.modelVerification.readings` (v149), lists what each read saw:
  "הסכום לפני מע״מ: קריאה 1: 311.77 · קריאה 2: 317.77 · קריאה 3 (המודל החזק):
  311.77". `scan.verification.verifier` (v149) adds "הקריאה השלישית (המודל
  החזק) נכשלה, לכן נשארו שתי קריאות שלא הסכימו." (with the technical reason as a
  small ltr line) or "גם הקריאה השלישית (המודל החזק) קראה את הנייר, ועדיין אין
  שתי קריאות שמסכימות." Without readings (v148) the sentence is generic but
  field-specific. The finish error names the field too.
- When only one read parsed (`readings` holds a single read: the other cheap
  read and the verifier dropped, so the service lists every summary field as
  an issue with no support — `priceAuditDocumentLoneRead`), nothing disagreed.
  The panel then says "רק קריאה אחת של הנייר הצליחה (גם הקריאה השלישית, המודל
  החזק, נכשלה), ולכן אין קריאה נוספת שמאשרת את הסיכום." with no per-read list,
  the finish error says "תעודה 1: רק קריאה אחת של הנייר הצליחה — צריך לאשר את
  הסיכום מול הנייר", and the credit card says "רק קריאה אחת של הנייר הצליחה —
  בדוק את מספר הזיכוי, המוצרים והכמויות מול הנייר" — instead of claiming that the
  reads disagreed or that two reads remained. The review itself is unchanged
  (still required, same button, same token). `verification.readCount` is not
  the signal: it counts failed reads too.
- On the discount line each read's value carries its effect, taken from
  `readings[].discountSeparate`: "הנחת המסמך: קריאה 1: 5.00 (יורדת מהסכום) ·
  קריאה 2: 5.00 (לא יורדת מהסכום)". v149 disputes the discount by its effect,
  not its digits, so two reads can print the same amount and still disagree
  (rows 50, discount 5: subtotal 45 against 50); without the note the worker
  saw "5.00 · 5.00" under "לא הסכימו". Without the flag (v148) or without a
  value the line reads as before. Display only; the OCR value is untouched.
- `scan.verification` of each document is now kept with its metadata
  (`aiScanSingleDocPipeline` → `verification`, `yotvataScanMetadata` →
  `perDocument[i].verification`), so it survives the draft and a reload.

### Verification

`tools/document-summary-review.test.mjs` (10 tests, the complete app module):
the informational discount case (no review, audit complete, OCR value kept,
no approval record invented), the field evidence replayed with its real
numbers (311.77 / 61 / six rows / 41.90), a discount the arithmetic needs and
an unbalanced paper (review still required), a subtotal dispute with the
per-read list and the confirm button, two fields named together and a missing
reading value, the verifier failed / disagreed / agreed / v148 wordings with
the record surviving a reload, `scan.verification` carried into `perDocument`
and the draft, the token still invalidating on value and issue changes, and
an effect-based discount dispute with identical digits (5.00 against 5.00)
explained by its effect, with the v148 line unchanged, and the lone-read case
(one reading, verifier failed: the one-read sentence in the panel and the
finish error, surviving a reload, no per-read list; a lone reading without a
verifier record; two disagreeing readings keeping the two-reads sentence; no
readings at all unchanged). The last two tests fail against the panel without
the effect note and without the lone-read sentence respectively.
`tools/credit-service-contract.test.mjs` replays the lone-read case through the
real service code (cheap read B and the verifier dropped) into the credit card.

## v367: a quantity the arithmetic proves needs no confirmation

### Field report (the shop's backup of 2026-09-25 12:03, app v366 / service v149)

Invoice 9073807997 (3 pages, 22 rows) was read three times. The selected
cheap read had every quantity right and its paper balanced (rows Σ 1,717.49 =
the printed subtotal, units Σ 285 = the printed total). The other cheap read
halved rows 6 and 18 (3 instead of 6, 10 instead of 20; units Σ 272, paper
check failed). The verifier (`gpt-5.6-terra`) read the PACKAGES column for
every row (1 on most rows, 2 on rows 6/18/21; units Σ 25, failed, not
selected — correct). Rows 6 ("מארז 8 מילקי בטעם שוקולד": 6 × 16.03 = 96.18)
and 18 ("מארז 6 שקיות מוקה": 20 × 12.53 = 250.60) ended with
`modelVerification.issues: ['quantity']`, `fieldSupport.quantity: []` and
every other field supported by reads 0 and 2, so the scan was `needs_review`
and the receiving screen showed "נשארו 2 שורות לטיפול / צריך להשלים את
הבדיקה", asking the worker to confirm a quantity the paper had already proved:
the row arithmetic is exact, and only these quantities bring the document's
units to the printed 285.

### The rule (identical in the app and in service v150)

A row's quantity counts as **verified by arithmetic** when all hold:

1. the quantity is a positive integer and `unitPriceExVat > 0` (credit mode:
   by magnitude);
2. `unitPriceExVat` and `lineTotalExVat` of the selected read are each
   supported by at least one other read (`fieldSupport` names a read index — a
   string marker is not a read), and `grossLineTotalExVat` is supported too
   when it is not `null`;
3. in integer agorot: `round(qty × unit) === gross` when gross is not null and
   `gross − |lineDiscountExVat| === net` (an unread discount is 0, so gross
   must equal net); when gross is null: `round(qty × unit) === net + |discount|`;
4. the selected paper passes `yotvataPaperCheck` (rows Σ = subtotal, units Σ =
   the printed units total, which must have been read), so the quantity is
   corroborated by the printed units total.

A quantity that fails any of these keeps its issue. No OCR value is filled or
altered, and the service's own record (`issues`, `fieldSupport`) is kept as
received: the app only changes its verdict on it.

### What changed in app v367

- `priceAuditRowArithmeticHolds(values, credit)` is rule (3);
  `priceAuditQuantityArithmetic(row, balanced, credit)` is the whole rule and
  returns `{ proven, server, reasons }` (`reasons`: `support` — no
  `fieldSupport`, a v146 answer; `values`, `unit`, `net`, `gross`,
  `arithmetic`, `paper`) plus `{ unit, gross, net, printedUnitsBalanced }` on a
  proof, the same shape as the service's `arithmetic.quantity`. The service
  v150 marker (`fieldSupport.quantity` containing `'arithmetic'`) is accepted
  as it is (`server: true`, the saved `modelVerification.arithmetic.quantity`
  merged in). `priceAuditQuantityProvenByArithmetic(doc, row)` applies it to
  an invoice row with `yotvataPaperCheck(priceAuditSource(doc) || doc,
  priceAuditDocumentPageCount(doc))` — the source paper with the corrections
  the worker approved, as the v365 discount rule does.
- `aiModelReviewIssues(row)` drops a `'quantity'` issue that is proven. So the
  row is no longer `partial` in `receiptPriceAudit`, `priceAuditPendingRows`
  no longer lists it, `aiEvaluateInvoiceScan` no longer blocks the finish with
  "הכמות או המחיר עדיין לא אומתו בין הסריקות", and `aiAutoResolvePendingRow`
  may resolve it. The evidence check (row values against
  `modelVerification.evidence`) is unchanged: an altered value still reopens
  the row.
- `priceAuditConsensusConfirmed(row)` treats a `needs_review` row whose only
  issue was a proven quantity as consensus-confirmed (`arithmeticSettled`),
  and a user-confirmed identity may sit next to a proven quantity
  (`identityReviewed`). A service v150 row (`status: 'verified'`, the marker)
  passes as any verified row. So a catalog price gap on such a row is
  acknowledged by `paperReview.source: 'model_consensus'` and never asks "כן,
  כך כתוב בתעודה" again; a row the arithmetic does not prove keeps the manual
  "כן, הכמות והמחיר נכונים לפי הנייר" (`price-confirm-values`) and "הפענוח
  שגוי — תקן לפי הנייר" exactly as before.
- The row card ("צריך להשלים את הבדיקה") now explains itself
  (`priceAuditRowDisputeHtml`, before the source-row box): the disputed
  field(s) by their `PAPER_ROW_FIELD_NAMES`, what each read saw from
  `modelVerification.readings` sorted by read ("הקריאות לא הסכימו על הכמות:
  קריאה 1 – 3 · קריאה 2 – 6 · קריאה 3 (המודל החזק) – 2."; two fields get a
  summary sentence and one line per field with
  `data-row-dispute-field`), why the arithmetic does not settle it ("החשבון לא
  מכריע: מחיר היחידה × הכמות לא יוצא סכום השורה באף אחת מהקריאות" — or
  "בקריאה שנבחרה" when another read's arithmetic holds — "מחיר היחידה לא
  מוסכם בין הקריאות", "סכום השורה לא מוסכם בין הקריאות", "הסכום לפני הנחה לא
  מוסכם בין הקריאות", "התעודה לא מתאזנת מול הסיכום המודפס"; several reasons
  joined with " · "), and the verifier's outcome in the v365 words
  (`scan.verification.verifier` from `perDocument`: "הקריאה השלישית (המודל
  החזק) נכשלה, לכן נשארו שתי קריאות שלא הסכימו." with the technical reason as
  a small ltr line, or "גם הקריאה השלישית (המודל החזק) קראה את הנייר, ועדיין
  אין שתי קריאות שמסכימות."). A single reading says "רק קריאה אחת קראה את
  השורה הזאת…" and claims no dispute; without readings (v148) the sentence is
  generic but names the field. Display only, no raw English.
- The driver-credit consensus (`deliveryCreditConsensus`) applies the same
  rule by magnitude, with `deliveryCreditPaperCheck` and a read printed units
  total as condition (4), so a v149 credit answer whose only row dispute is a
  proven quantity attaches by itself (v365 rule); a slip without a printed
  units total, or a quantity the arithmetic does not prove, stays for review.
- Version: v367 "כמות שמוכחת בחשבון לא דורשת אישור"; `sw.js` cache
  `yotvata-v367`.

### Verification

- `tools/quantity-arithmetic-fixture.mjs`: the field case — rows 6 and 18
  with the backup's real values and their three readings; the other 20 rows
  are synthetic and only fill the printed totals (the backup's rows are not in
  this repository); `readRows('selected' | 'halved' | 'packages')` are the
  three model reads, `fieldInvoice()` the v149 answer shape (and the v150
  shape with `server: 150`).
- `tools/quantity-arithmetic.test.mjs` (12 tests, the complete app module):
  the field case in the v149 shape (no pending rows, audit complete, rows
  `match`, values and the service record untouched, no approval record
  invented, the same after a reload); a proven quantity counting as consensus
  for a catalog price gap (`paperReview.source: 'model_consensus'`); a
  quantity the arithmetic does not prove (unit 16.04) pending with the exact
  explanation, the three readings and the buttons; the "selected read" wording
  when another read's arithmetic holds, on an unbalanced paper; an unsupported
  unit price (both fields named, one readings line each, the unit reason); an
  unbalanced paper (284 units); the verifier-failed, lone-read and v148
  wordings, surviving a reload; the v150 marker accepted as it is (and still
  needing a sound identity); the manual confirm flow and the paper-correction
  flow unchanged for an unproven row; the rule's cases (gross null, a row
  discount, credit magnitudes, a marker is not a read, every refusal reason);
  a driver credit proven and one without a printed units total.
- `tools/quantity-arithmetic-contract.test.mjs` (2 tests): the three reads
  through the REAL service code in-process (`../yotvata-ai-scan`, mocked
  model, no paid call), asserting the service's answer for rows 6 and 18 by
  its version (v149: `needs_review`, `issues: ['quantity']`, empty support;
  v150: `verified`, `fieldSupport.quantity: ['arithmetic']`,
  `arithmetic.quantity`) and, through the real invoice scan path
  (`yotvataStartPaperScan`), no pending row, audit complete, the finish not
  blocked, values as returned; and an unproven quantity (16.04) reaching the
  worker with the readings. It passes against the committed v149 service
  (`YOTVATA_AI_SCAN=<v149 checkout>`) and against v150; against the v366 app
  with the v149 service both tests fail — the field bug.
- `tools/credit-auto-attach.test.mjs` ("a row the reads did not agree on")
  and `tools/verified-price-identity.test.mjs` ("a real quantity
  disagreement") had fixtures whose quantity the arithmetic now proves
  (6 × 7.30 = 43.80 on a balanced slip; 6 × 5.24 = 31.44 with 6 units
  printed): their money now reads 7.31 and 31.40 respectively, so they keep
  testing a dispute the arithmetic does not settle. Every other assertion is
  unchanged.
- Against the v366 app (`RECEIPT_TEST_APP=<v366 index.html>`) 13 of the 14
  new tests fail (the v150-marker contract test passes, as v366 already
  accepts a `verified` row).
- Full suite: 424 tests, 422 pass; the only failures are the two pre-existing
  ones ("an actual price gap has a working yes action…", "unresolved paper
  values can be confirmed as-is…").
- Not verified: no phone, no deployed service, no paid model call.
