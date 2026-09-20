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
