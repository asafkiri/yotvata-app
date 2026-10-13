# A driver credit photographed as a regular document — v394

Companion service: yotvata-ai-scan v151 (opt-in `detectDocumentType`). Either
release order is safe; recommended: service first, then app v394 on every device.

## Field report

A driver's credit slip ("ביטול מכירה חלקי ת.משלוח", 24 yogurt, −83.52 before
VAT) was photographed with the regular document buttons ("צלם את התעודה",
"+ תעודה נוספת מהנהג / הספק", "בחר תמונות מהגלריה"), not with the green
"הנהג הביא זיכוי על חוסר? צלם כאן". The app read it as an invoice:

- Signs kept (the usual case): the paper check failed with misleading texts
  ("הסכום ללא מע״מ לא נקרא…"), the whole paper was not adopted (the real
  delivery note's anchors were lost too), the read was not cached (every
  "בדוק צילומים" + "התחל" paid again), and the only way out was to delete it
  and photograph it again with the green button.
- Signs dropped by the read: the slip passed as a second delivery note — +24
  yogurt billed and a phantom 48-unit shortage claim.
- Typing it by hand ("-83.52") silently became +83.52.

## The rule

Detection is per invoice document and only after its paid read returned ok.

**Signals** (any one holds the document): a negative selected subtotal; a
negative subtotal in any read (`modelVerification.readings`, service ≥ 149 —
works on v150); a read typed `'credit'` (v151); a printed title matching
`/זיכוי|ביטול\s*מכירה|credit/i` (v151); a gallery pick whose pages split cleanly
by sign (`pageSplit`: every row on a page, one sign per page, both signs, 1–4
negative pages, and the rows do NOT close the printed summary — when all rows,
less a separate document discount, equal the subtotal to the agora
(`rowsClose`) it is one document, e.g. a 2-page invoice whose return line is
alone on page 2). Not signals: a negative row under a positive subtotal (a
return line inside an invoice), a negative discount, `'unclear'`, free-text
warnings.

**Held** = signal and not kept. "Kept" requires the worker's "לא, זו תעודת
משלוח רגילה" (`kindDecision: { kind: 'delivery' }`) on a read that is a valid
positive invoice (subtotal > 0, signs not negative, `yotvataPaperCheck` ok) —
or a positive invoice with a return line whose rows close the printed summary
(signs `'mixed'`, `rowsClose`): it then enters the money view exactly as in
v393, and its paper check says "בשורה R נקרא סכום שלילי…".
A held document:

- is out of the money view (`receiptRebuildScanResponse` — the single choke
  point): no anchors, comparison, paper quantities, price review, analyzer or
  credit coverage ever see it;
- keeps its paid read (cached on the run, on restore, in the draft snapshot) —
  "התחל", "בדוק צילומים" and a reload never upload it again;
- fails the paper adoption with "תעודה N נראית כמו תעודת זיכוי — ההחלטה בכרטיס
  שמתחת." and blocks the finish in every entry mode ("לפני הסיום צריך להחליט על
  תעודה N — היא נראית כמו תעודת זיכוי.").

**Verdict** (first match): `blocked-attach` (attach mode has no credits) →
`blocked-full` (4 credits) → `ask-split` → `blocked-pages` (> 4 pages) → `move`
(selected read fully negative, every read negative, no read typed
`'delivery'`, no worker decision) → `ask-move` (fully negative, but a
`'delivery'` vote, a sign split between the reads, or the worker's
"delivery") → `ask-read` (everything else: positive or mixed selected read).

**Automatic move** happens once per completed read run — after `await run` in
`yotvataStartPaperScan` (and the split re-read), and in the non-background
`aiRunInvoiceScan` before adoption and the comparison — never on render,
restore, cloud sync or a tap elsewhere. Routing is synchronous, makes no call
and never bumps `aiScanRunId` (the non-background run releases `aiScanBusy`
only while the run id is still its own). The paid invoice read becomes the
credit paper (`paperMode: 'invoice'`), 0 further calls. It attaches by itself
only when every v365 rule passes **and** at least two reads typed it
`'credit'` and another read saw the same number
(`modelVerification.documentType.invoiceNumberSupport`); otherwise it waits
for one tap with "הזיכוי צולם כתעודה רגילה — בדוק את מספר הזיכוי, המוצרים
והכמויות מול הנייר" (always on service v150).

**One tap** in the decision card (`yotvataCreditDocumentCardHtml`, in
`#rcPaperStatus`, the manual-quantities status and the gate's document card):

| Verdict | Main action | Cost |
| --- | --- | --- |
| move / ask-move | "כן, זו תעודת זיכוי — העבר לזיכויים" | 0 calls |
| ask-read, photos in memory | "כן, זו תעודת זיכוי — העבר וקרא כזיכוי" — one credit-mode read of the same photos, re-encoded at the credit pixel budget | one read (2–3 calls) |
| ask-read, after a reload | "הסר את תעודה N וצלם אותה כזיכוי" — removes it and opens the green camera inside the tap | the new photo's read |
| ask-split | "העבר את עמוד K לזיכויים וקרא מחדש" — the page(s) become a credit (read as a credit), the rest is read again | two reads, both named |
| blocked-* | the reason, and what to do | — |

"לא, זו תעודת משלוח רגילה" appears only when the decision would be kept (see
**Held**; 0 calls) and not when most readings (e.g. 2 of 3, the verifier
included) read the minus — the positive read is selected only because a
negative read has no valid summary in the paper check. When every read typed
it `'credit'` or the title is a credit title, it asks first ("תעודה N היא
תעודת משלוח?"): one tap bills the paper as goods. "הסר את תעודה N מהקליטה"
always. On the gate a kept document says "סומנה כתעודת משלוח רגילה לפי ההחלטה
שלך." with "בטל — זו כן תעודת זיכוי".

**Numbers.** A document keeps the number it was photographed as (`shotAs`, in
the draft) when a document before it moves to the credits in the same moment:
its card reads "תעודה 2 (צולמה כ"תעודה 3") נראית כמו תעודת זיכוי", the routing
toast adds "תעודה 3 (עכשיו תעודה 2) נראית כמו…", and a later move gives the
credit `origin.docNumber` 3 — two credits never both say "צולם כ"תעודה 2"".

**Typed anchors** ("או הקלד סכום ויחידות", or the classic typed receipt with
"סרוק את התעודות"): moving, splitting, recapturing or removing a held document
also removes the line typed for that paper — line i in the classic flow (AI
document i was built from it), otherwise the one line with the same amount
(and units, when known) — and the toast says so ("השורה שהוקלדה לה (₪83.52 ·
24 יח׳) הוסרה מסכום התעודות."). Several lines with that amount: the worker
deletes the right one first. The re-read after a split sets the paper state
"running" only on a photo receipt, so a typed receipt is never left
unsaveable. On the classic path (no routing) a held document is announced,
and the comparison shows "תעודה N נראית כמו תעודת זיכוי — היא אינה נכללת
בהשוואה עד שתחליט עליה." with "להחלטה על תעודה N", which opens the receiving
screen at the card. While a document is held, the price check covers the
documents that were read (their rows are not "partial").

**A moved credit** says where it came from ("צולם כ"תעודה N" וזוהה כתעודת
זיכוי («title»)." / "עמוד K של "תעודה N" הועבר לכאן כזיכוי.") and offers "זו
לא תעודת זיכוי? החזר לתעודות" in every state except a whole-document discount
and while it is read. The undo restores the document with its original read
(photos from memory, or paper-only after a reload), marks it `kindDecision:
'delivery'` (source `'unmove'`) and adopts — no call. A page undo puts the
page(s) back in their document at their places; when that document is as the
split left it, its original read comes back too (no call), otherwise it is
read again on "התחל". A credit-mode read with a positive summary (as printed,
or with a return line) sets `notCredit`, and the card's main action becomes
"זו תעודה רגילה — החזר לתעודות". After a card decision or an undo, a document
never read says "תעודה N עוד לא נקראה…" / "תעודה N עוד לא צולמה…" instead of
the paper checks of a paper that was not read; a v393 draft that failed on the
slip shows the hold line instead of its stale "צלם שוב" lines.

Money is unchanged: a credit closes only a counted shortage of the same
product, quantity and money (`deliveryCreditCoverage`); the payable stays the
paper minus the original shortage (`receiptPayableBaseEx`); a credit is never
an anchor, a billed quantity or a price row. A positive invoice is never
silently converted into a credit.

Also: a return line inside an invoice now says "בשורה R נקרא סכום שלילי
(‎-12.00) — אם זו שורת החזרה בתוך התעודה, הקלד את הסכום והיחידות ידנית."
instead of "חסרים כמות, סכום נטו או שיוך לעמוד באחת השורות" (the paper check
itself is the service's, unchanged); typed anchors refuse a minus ("-83.52",
"83.52-", "(83.52)", or a negative unit count) with "סכום עם מינוס הוא זיכוי…";
the evaluator says "תעודה N נראית כמו תעודת זיכוי — היא אינה נכללת בהשוואה עד
שתחליט עליה." instead of "צלם שוב"; a slip read as −24 no longer triggers up to
two rotated paid re-reads on the non-background path; the scanner shows
"תעודה N נראית כמו זיכוי — לחץ להחלטה".

## The contract (service v151 ⇄ app v394)

- The app adds `detectDocumentType: true` to every invoice full body
  (`aiRequestSingleDocScan`, no `documentKind`). Credit bodies and resume
  bodies never carry it. `aiScanPagesFingerprint` is unchanged. No `/health`
  gating.
- Service v151 types a request only when `detectDocumentType === true` and it
  is not a credit request; untyped bodies are byte-identical to v150.
- Typed responses add `documentTypeDetection: true`,
  `scan.documents[i].documentType` (`'delivery' | 'credit' | 'unclear'`),
  `printedTitle` (≤ 120 chars or null) and
  `modelVerification.documentType = { version, value, printedTitle, support,
  invoiceNumberSupport, readings: [{ read, documentType, printedTitle,
  creditSigns, subtotalExVat }] }` (selected read first). The block never
  enters `issues`, never escalates and costs no call.
- The app reads typed evidence only when `typeof doc.documentType ===
  'string'`; per-read subtotals come from `modelVerification.readings` (v149+).
- Drafts gain only additive fields: `kindDecision` and `shotAs` on photo
  inputs and `docInputs` (only when set); `origin`, `paperMode`, `readAs`, `notCredit` on
  credits; `paperMode` and `origin` on saved `shortCreditNotes` of moved
  credits (green-button notes are byte-identical). `originPages` /
  `originCache` (photos) never reach a draft.
- Mixed versions: a v393 device does not know about held documents — every
  device must show **v394** before use.

## Paid calls

| Case | Calls |
| --- | --- |
| Ordinary invoice | unchanged: 2 (3 when the reads disagree); about 200–400 input and 15–40 output tokens more per typed read |
| Credit as a document, signs kept | 2 (or 3) — its invoice read is the credit paper; attach by itself or one tap, 0 calls |
| Signs dropped / reads split on the sign | 2–3, then one credit read (2–3) after "העבר וקרא כזיכוי" |
| False alarm | 0 extra; "לא, זו תעודת משלוח רגילה" adopts the read |
| Gallery pages split | one credit read + one re-read of the rest |
| Held read, "בדוק צילומים" + "התחל", reload, undo, keep | 0 |
| A slip read as −24 on "ai-run" (the comparison) | 2 (v393: 4 more — two rotated re-reads of 2 calls each) |
| App v394 + service v150 | same; a moved credit always waits for one tap; dropped signs are not detected |
| App v393 + service v151 | exactly v150's bodies and counts |

## Edge cases (the ones the tests pin)

- Slip as "תעודה 1": the toast names "תעודה 1"; the delivery note is
  renumbered; a reload restores one document and one credit.
- Credit only: it moves, an empty "תעודה 1" is seeded and the adoption fails
  with "צולמה רק תעודת זיכוי. צלם גם את תעודת המשלוח (בדוק צילומים) או הקלד את
  הסכום והיחידות שלה." — a receipt with no delivery note never saves as read.
- 4 credits / more than 4 pages / attach mode: held, never adopted, the card
  says which limit applies; removing a credit frees the move (by tap — routing
  never runs outside a read run).
- A whole-document discount on the slip: moved, `errorKind: 'discount'`, only
  "הסר את הזיכוי" (no undo, no re-read), as with the green button.
- The same slip as a document and with the green button: both carry the
  number, `deliveryCreditDuplicate` flags both, the finish waits.
- A draft v393 already adopted with a held document (e.g. a sign split adopted
  on the positive read): restore un-adopts it (state `failed`, the hold line,
  anchors dropped) and shows the card; nothing is read or moved on restore.
- Cancelling the receipt while a moved credit is read aborts its upload.
- A v150 slip whose minus signs were dropped is not detected — the residual
  risk; ship the service first.

## Verification

```sh
node --test tools/*.test.mjs tools/photo-first-test.mjs tests/*.test.mjs
YOTVATA_AI_SCAN=<yotvata-ai-scan v151 checkout> node --test tools/credit-service-contract.test.mjs
```

- `tools/credit-as-document.test.mjs` (35 tests): the complete app module
  driven through its own UI events (photo, orientation confirm, "+ תעודה
  נוספת", "התחל", the card buttons, "סיים"), against a fetch-level service fake
  that answers exactly as the contract says (typed for v151, untyped for v150).
  Each scenario ends with the invariants: no paper is both a document and a
  credit, no negative note amount, a held document is never in the money
  view, nothing is left busy. All 25 of the feature tests fail against the
  v393 `index.html` (`RECEIPT_TEST_APP=…`); the 10 review tests (w1–w11) fail
  against the first v394 commit.
- `tools/credit-service-contract.test.mjs`: the app's own typed invoice body
  of the slip through the REAL service code — v151 moves and attaches it with
  its own read; the v150 checkout moves it on its signs and waits for one tap.
- Updated: `scan-transport.test.mjs` (invoice bodies carry the flag, credit
  and resume bodies do not), `credit-on-gate.test.mjs` (the gate hint text),
  `delivery-credit-auto-read.test.mjs` (a moved credit read by a tap waits
  behind an invoice read), `photo-first-test.mjs` (the new helpers in its
  function list; its 4 stale ReferenceErrors fixed).
- Mutation checks: reverting each of these alone fails at least one test —
  money-view exclusion, snapshot of held reads, caching of held reads, the
  `move` sign-split guard, the `'delivery'`-vote guard, routing only at run
  end, routing never bumping the run, the `'document'` reason,
  `invoiceNumberSupport`, the finish guard, the minus refusal, the rotation
  score, the restore un-adoption, the transport flag, the pixel upgrade.
- The v393 app's own contract, transport and gate tests pass unchanged against
  both the v150 and the v151 service.
- Not verified: no phone, no deployed service, no paid model call.

## Follow-ups

- Attach mode still has no credits: a credit photographed there must be
  removed and recorded on the saved receipt ("התקבל זיכוי מהספק").
- After about a week, read `invoice_scan_audit → documentTypes` in the Cloud
  Run logs to measure false alarms on the suppliers' ordinary papers.
- A store-to-supplier return note ("תעודת החזרה") moves like a credit; if it
  matches no counted shortage the finish blocks until it is removed or
  returned to the documents.
