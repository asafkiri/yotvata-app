# Receiving credits and correcting paper readings — v345

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
