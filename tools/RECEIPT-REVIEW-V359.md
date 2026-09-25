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
