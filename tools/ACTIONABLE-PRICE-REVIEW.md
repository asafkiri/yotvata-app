# Actionable price review — v344

The price panel previously rendered all audit rows, including successful prices,
and repeated product choices above the full list. Some unresolved identities had
no approval action even though a specific catalog product could be proposed.

The receiving screen now contains one queue of unfinished rows. Its count is the
number of rows still requiring attention. Matched rows remain in the full saved
audit but have no cards or approval controls. With no remaining work, the panel
says there is nothing to approve and the scanner notice disappears.

Each unidentified row offers a validated product choice, a single explicit
confirmation beside the original document/row details, or manual barcode entry.
A name hint with weak OCR evidence stays unresolved until the person confirms it
from the paper. Price-assisted automatic matches also require this independent
identity confirmation before the price audit can use them.

The new confirmation records `paper_identity_review`, the selected product and
barcode, and the original row evidence. It validates the displayed document,
row, and candidate again on click. Saved approvals are checked again on reload;
changing their source evidence or product/barcode binding invalidates them.
Confirmation changes neither paper prices nor quantities. A genuine price gap
remains in the queue, including when the catalog or promotion changes later.

The checkout summary links back to this queue instead of duplicating its
controls. Returning to edit discards the pending payment snapshot so the final
summary must be recalculated through the existing receipt flow.

## Verification

123 tests passed across the actionable-review, invoice-row-review, early-price-
audit, scan-persistence, document-split, manual-quantity, and image-capture suites.
They exercise actual event handlers, draft restoration, stale/forged approvals,
price gaps after identity approval, and receipt saving without duplicate amounts.

An isolated replay of the supplied backup and the previous manual barcode
correction produced 35 audit rows: 21 matching rows and 14 pending rows. The new
HTML contained exactly 14 cards and 14 identity confirmation buttons, zero
matching-price cards, and triggered zero additional AI requests. The backup and
images are not included in the repository.

Browser visual verification was unavailable: the provided browser blocked the
local preview. Verification here covers HTML output, event behavior, and the
application logic in the existing browser-boundary harness.

```sh
node --test tools/actionable-price-review.test.mjs tools/invoice-row-review.test.mjs tools/early-price-audit.test.mjs tools/receipt-scan-persistence.test.mjs tools/receipt-doc-split.test.mjs tools/manual-quantities.test.mjs tools/image-capture.test.mjs
```
