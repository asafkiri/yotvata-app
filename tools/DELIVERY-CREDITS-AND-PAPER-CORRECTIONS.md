# Receiving credits and correcting paper readings — v346

Drivers can supply a credit note with the delivery. Previously the receiver had
to finish first, then find the saved receipt and enter a credit amount. Also,
confirming a product fixed its identity but offered only catalog-price editing
when its OCR price was wrong.

## Receiving flow

- “הנהג הביא זיכוי על חוסר? צלם כאן” is available during ordinary receiving,
  including the invoice capture screen and manual entry.
- Camera and gallery use the existing full-image, rotation and explicit-crop
  controls. Prepare all pages, then press “פענח את הזיכוי”. Each explicit read
  makes one request; it does not reread the invoices.
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
