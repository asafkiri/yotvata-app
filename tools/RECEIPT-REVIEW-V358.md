# Receipt review fixes — v358

Reported symptoms: excessive ambiguous products, rows that offer only an OCR
correction instead of approval, and a promotion carton-size warning with no way
to supply the missing information.

## Findings and changes

- The price-review panel and receiving reconciliation used different rules for
  ambiguous names at equal prices. They now share a strict decision including
  full-precision prices, active promotion groups/thresholds, deposits and packs.
  An optional product-change control remains available outside the pending list.
- A genuine price difference lacked a working paper-confirmation action. Legacy
  scans now offer “כן, כך כתוב בתעודה — שמור את הפער”. Confirmed differences leave
  the pending queue but remain in the saved financial audit. They cannot turn a
  price discrepancy into a fully covered supplier credit.
- New service-v146 consensus is sufficient verification: two agreeing initial
  reads, or the strong read agreeing with either initial read, require no extra
  paper approval. Catalog price differences are displayed and retained separately.
- Unresolved numeric fields cannot enter reconciliation until corrected from
  paper. Unresolved summary fields appear once per document; verified product
  rows are not reopened merely because the footer needs review.
- Missing carton size can be completed from the receiving card and saved into
  the promotion without another OCR call. Promotion editing now requires a
  carton size even when the threshold is one carton. Conflicting promotions link
  to their editors.
- Edits invalidate pending checkout calculations. Acknowledgements are tied to
  the current source, product, date and price rules, and survive draft restoration.
  Stale acknowledgements cannot authorize changed data. Optional reopening works
  for both manual and model-verified price discrepancies.

## Validation

Run `node --test tools/*.test.mjs tools/*-test.mjs`. The complete-module harness
exercises scan adaptation, choices, paper edits, promotion completion, persistence,
draft restoration and final saving with actual payable and audit amounts.
External Firebase/model calls are mocked. The existing photo-first extraction
test now includes its `aiScanPageAudit` dependency so those tests execute fully.

A mobile-width Chromium replay checks actual controls with synthetic receipt
data and no production connection. Screenshots supplied by the user show the
review UI rather than the invoice itself; real-paper OCR quality still needs a
post-release invoice check.

## Deployment dependency

Publish app v358 before backend v146. The app remains compatible with v145;
v146 requires `reviewProtocolVersion:1` before making model calls. The backend
repository documents the 420-second request timeout and expected health fields.
Changing GitHub alone does not deploy the Cloud Run backend.
