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
less a separate document discount taken by its absolute value, equal the
subtotal to the agora (`rowsClose`) it is one document, e.g. a 2-page invoice
whose return line is alone on page 2 — and there is evidence of a second paper:
the rows of the positive pages alone close the summary (it is the delivery
note's own), or a read already says credit (a negative summary or reading, or
a `'credit'` type or credit title on a read that is not positive — see
`yotvataPositiveRead` below)). Without that evidence a 2-page invoice whose
return line is alone on its last page and whose rows miss the summary (a
negative discount, a deposit with no row, a price 1 agora off) is one invoice
with a return line, as in v393. When a read also typed it `'credit'`, it is
held as `ask-read` with the free keep, exactly like the 1-page invoice — not
as a paid split whose credit read fails and whose page undo returns the same
card. Not signals: a negative row under a positive
subtotal (a return line inside an invoice), a negative discount, `'unclear'`,
free-text warnings.

**Held** = signal and not kept. "Kept" requires the worker's "לא, זו תעודת
משלוח רגילה" (`kindDecision: { kind: 'delivery' }`, also set by "החזר
לתעודות") on a positive read (`yotvataPositiveRead`): subtotal > 0 and no
negative amount (signs `'as_printed'`), or a positive invoice with a return
line whose rows sum positive AND close to the printed summary (signs
`'mixed'`; within 1 agora per row, and at least 3% of the summary, after a
separate document discount taken by its absolute value) — they need not close
it to the agora (a price read an agora off, a deposit with no row, a
discount). A credit whose summary was read without its minus has rows that
sum to the summary less twice the rows that kept their minus: negative when
every row kept it, and far from the summary when some rows lost it too (the
two-row slip +108.52 over +83.52 and −25.00 sums to 58.52) — a credit, not an
invoice. The same predicate decides the keep, the credit-mode read
(`notCredit` / `origin.creditRead`), the undo and the page-split evidence —
and not a page split (`ask-split` stays the decision), and not
when most readings (e.g. 2 of 3, the verifier included) read the minus. The read's own paper
check is not a condition: a kept document enters the money view exactly as in
v393 — adopted when its paper check passes, otherwise its problems are named
("תעודה 2: סך היחידות לא נקרא…", "בשורה R נקרא סכום שלילי…") and the sum and
units are typed, as for any document. (Until this rule a real second delivery
note whose printed units were not read, or whose row was 1 agora off, could
never be kept: every way to finish took it out of the paper total; until the
rows' sign replaced their closure, the same held for an invoice with a return
line whose row was 1 agora off. Until the rows had to be close to the
summary, a credit read that lost the minus on its summary and on one of two
rows counted as positive: "זו תעודה רגילה — החזר לתעודות" billed the driver's
credit as goods.)
A held document:

- is out of the money view (`receiptRebuildScanResponse` — the single choke
  point): no anchors, comparison, paper quantities, price review, analyzer or
  credit coverage ever see it;
- keeps its paid read (cached on the run, on restore, in the draft snapshot) —
  "התחל", "בדוק צילומים" and a reload never upload it again;
- fails the paper adoption with "תעודה N נראית כמו תעודת זיכוי — ההחלטה בכרטיס
  שמתחת." and blocks every save of the receipt in every entry mode ("לפני הסיום
  צריך להחליט על תעודה N — היא נראית כמו תעודת זיכוי.", then the receiving
  screen at the card): the finish (`finishReceipt`), "קלוט תעודה" / "סגור עם
  הפרש ואטפל אחר כך" in the comparison (`saveReconciledReceipt`) and the
  summary's confirm (`confirmReceipt`) — one guard, `yotvataHeldStopsSave`. A
  document can become held after the finish, by the comparison's own read
  ("פענח"; on the classic typed path there is no routing).

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

The card's reasons are what the reads said. "אבל הסכומים נקראו בלי סימן מינוס."
needs evidence that a minus was printed — a credit title, or every read typed
`'credit'`; a single `'credit'` vote on a positive paper with no such title (a
likely false alarm, e.g. a real second delivery note) says "הסכומים בה
חיוביים." (or "קריאה אחת סימנה אותה כזיכוי, אבל הסכומים בה חיוביים." when no
read typed it `'delivery'`).

"לא, זו תעודת משלוח רגילה" appears exactly when the decision would be kept
(see **Held**; 0 calls) — so not when most readings read the minus: the
positive read is selected only because a negative read has no valid summary in
the paper check. When every read typed it `'credit'` or the title is a credit
title, it asks first ("תעודה N היא תעודת משלוח?"): one tap bills the paper as
goods. "החזר לתעודות" of a whole document asks the same way. "הסר את תעודה N
מהקליטה" always. On the gate a kept document says "סומנה כתעודת משלוח רגילה
לפי ההחלטה שלך." with "בטל — זו כן תעודת זיכוי".

**Numbers.** A document keeps the number it was photographed as (`shotAs`, in
the draft) when a document before it moves to the credits in the same moment:
its card reads "תעודה 2 (צולמה כ"תעודה 3") נראית כמו תעודת זיכוי", the routing
toast adds "תעודה 3 (עכשיו תעודה 2) נראית כמו…", and a later move gives the
credit `origin.docNumber` 3 — two credits never both say "צולם כ"תעודה 2"".
When several documents move in one run, their credits are listed (and saved)
in the order they were photographed, and when all of them attached by
themselves the toast says so: "תעודות 2 ו-3 הן תעודות זיכוי — הועברו לזיכויים
וצורפו למשלוח. בסיום הספירה נבדוק איזה חוסר הן מכסות." (otherwise "…בדוק
אותן בכרטיסי הזיכוי.").

**Typed anchors** ("או הקלד סכום ויחידות", or the classic typed receipt with
"סרוק את התעודות"): moving, splitting, recapturing or removing a held document
also removes the line typed for that paper — line i in the classic flow (AI
document i was built from it), otherwise the one line with the same amount
(and units, when known) that no other read, non-held document already explains
(the same subtotal and units — e.g. a second delivery note of one tray at the
slip's price keeps its line) — and the toast says so ("השורה שהוקלדה לה (₪83.52 ·
24 יח׳) הוסרה מסכום התעודות."). Several lines with that amount: the worker
deletes the right one first. The removed line is kept on the credit
(`origin.typedNote`, in the draft too, with the typed lines the move left:
`left`), and "החזר לתעודות" puts it back — beside its AI document in the
classic flow, otherwise where it was — with "השורה שהוקלדה לה (…) חוזרת לסכום
התעודות." in the confirm and "…חזרה לסכום התעודות." in the toast, so a
mistaken move and its undo never leave a real delivery note out of the paper
total. It puts it back only while the typed lines are what the move left —
the app's own changes (another move, removal or undo) carry that snapshot
along, so several undos in any order each put their own line back once: when
the worker changed them since (e.g. typed that line again with "ערוך"), the
line would be counted twice, so it stays out and the confirm and the toast say "השורות שהוקלדו השתנו מאז ההעברה לזיכויים, ולכן השורה שהוקלדה לה
(…) לא תחזור לבד / לא הוחזרה — בדוק את סכום התעודות.". A credit saved by an
earlier v394 build carries no `left`: its line comes back only when no typed
line explains the returning paper (the same accounting as the move), otherwise
the same "השתנו" text. A whole document that comes into the documents with no
line of its own — "לא, זו תעודת משלוח רגילה", or "החזר לתעודות" of a move made
before the amounts were typed — enters the paper total too
(`yotvataTypedLineIn`): when no typed line explains it, its line is added from
its read if the read's own paper check passed ("השורה שלה (₪150.00 · 30 יח׳)
תתווסף / נוספה לסכום התעודות.", beside its AI document in the classic flow),
otherwise the toast asks for it ("השורה שלה לא בסכום התעודות, והקריאה שלה לא
אומתה — הקלד את הסכום והיחידות שלה ("ערוך")."). A negative read that comes
back to wait for a decision brings no line. The re-read after a split sets the paper state
"running" only on a photo receipt, so a typed receipt is never left
unsaveable. On the classic path (no routing) a held document is announced,
and the comparison shows "תעודה N נראית כמו תעודת זיכוי — היא אינה נכללת
בהשוואה עד שתחליט עליה." with "להחלטה על תעודה N", which opens the receiving
screen at the card. While a document is held, the price check covers the
documents that were read (their rows are not "partial").

**A moved credit** says where it came from ("צולם כ"תעודה N" וזוהה כתעודת
זיכוי («title»)." — the title only when it is a credit title — / "עמוד K של
"תעודה N" הועבר לכאן כזיכוי.") and offers "זו לא תעודת זיכוי? החזר לתעודות"
in every state except a whole-document discount, while it is read, when the
document would come back held for a paid read again (most readings read the
minus, or rows that sum negative under a positive summary —
`deliveryCreditUnmoveHonoured`: it returns only to be kept, or as a negative
read that waits for the free "העבר לזיכויים"; otherwise the card's main action
would again be "העבר וקרא כזיכוי", a paid loop), and once
its own credit-mode read ("העבר וקרא כזיכוי") found a valid credit paper
(negative, `deliveryCreditPaperCheck` passed, `paperMode: 'credit'`): the read
the undo would restore is the one that dropped the minus, and it would be
billed as goods (a phantom shortage the size of the credit). That credit is
then like a green-button credit — "הסר זיכוי" stays. The same holds once any
credit-mode read of that paper saw the minus (a negative summary, or negative
rows that are not a return line inside a positive invoice) but failed another
check — printed units that do not match, or a summary read without its minus:
`origin.creditRead: 'credit'`, recorded on the origin, so it survives "צלם את
הזיכוי מחדש", a later read that fails or drops the minus, and a reload.
"צלם את הזיכוי מחדש", "נסה לקרוא שוב" and "הסר זיכוי" stay. (A credit restored
from a draft of an earlier v394 build takes this from its `creditReadSigns`;
with no record of what its credit-mode read saw, it is treated as having seen
the minus.) Pressed while an invoice
read runs, the undo says "ממתין לסיום קריאת התעודות — אחרי הקריאה אפשר להחזיר
לתעודות." instead of doing nothing. The undo restores the document with its original read
(photos from memory, or paper-only after a reload), marks it `kindDecision:
'delivery'` (source `'unmove'`) and adopts — no call. A page undo puts the
page(s) back in their document at their places; when that document is as the
split left it, its original read comes back too (no call), otherwise it is
read again on "התחל". A whole document whose read is negative comes back
waiting for a decision (it can never be kept); its confirm and toast say so
("תעודה N תחזור לרשימת התעודות ותחכה להחלטה — הסכומים בה שליליים, ולכן היא
לא תיקלט כתעודת משלוח…", "תעודה N חזרה לתעודות ומחכה להחלטה בכרטיס…")
instead of promising a delivery note. A credit-mode read with a positive
summary (as printed, or with a return line whose rows sum positive and close
to the summary — the keep's rule) sets
`notCredit`, and the card's main action becomes
"זו תעודה רגילה — החזר לתעודות". After a card decision or an undo, a document
never read says "תעודה N עוד לא נקראה…" / "תעודה N עוד לא צולמה…" instead of
the paper checks of a paper that was not read. On a receipt with typed
amounts, a document kept as a delivery note that no typed line explains (a
draft of an earlier v394 build, whose keep added no line; a read whose own
paper check failed; a line the worker deleted) is named in the paper box —
"תעודה N נקלטה כתעודת משלוח, אבל השורה שלה (₪… לפי הקריאה) לא נמצאה בסכום
התעודות — אם לא הקלדת אותה, הקלד…" — for as long as that is true; neither
the box nor a reopened draft adds a line by itself (the typed lines are the
worker's, and the line may sit inside a sum typed for several papers); a v393 draft that failed on the
slip shows the hold line instead of its stale "צלם שוב" lines, and a draft
whose hold line names a document that is no longer held shows that document's
own paper problems instead (both from the stored reads, no call). A card
decision or an undo is not a read: the saved `aiAudit` keeps the attempts and
the automatic-rotation note of the last read run.

**Scan history** ("פרטי פענוח התעודה", saved in `scanAudit.history`): the reads
of a whole document that moved say "זוהתה כתעודת זיכוי והועברה לזיכויים"
(`movedToCredit`: the credit id); an undo removes that mark. A page split
leaves the document (it stays and is billed), so its reads say "התקבלה קריאה ·
עמוד K זוהה כתעודת זיכוי והועבר לזיכויים" (`movedPagesToCredit: { id, pages
}`) — only on the read the split was decided on (the document's current read,
by `requestId`), so after a page undo and a second split the earlier re-read of
the remaining pages is not marked — and the page undo removes that mark too.

Money is unchanged: a credit closes only a counted shortage of the same
product, quantity and money (`deliveryCreditCoverage`); the payable stays the
paper minus the original shortage (`receiptPayableBaseEx`); a credit is never
an anchor, a billed quantity or a price row. A positive invoice is never
silently converted into a credit.

Also: a return line inside an invoice now says "בשורה R נקרא סכום שלילי
(‎-12.00) — אם זו שורת החזרה בתוך התעודה, הקלד את הסכום והיחידות ידנית."
instead of "חסרים כמות, סכום נטו או שיוך לעמוד באחת השורות" (the paper check
itself is the service's, unchanged); typed anchors refuse a minus ("-83.52",
"83.52-", "(83.52)", or a negative unit count) with "סכום עם מינוס הוא זיכוי…"
("יחידות עם מינוס הן זיכוי…" and the units field focused when only the units
carry it), naming the green button as the screen shows it ("הנהג הביא זיכוי
על חוסר? צלם כאן", or "צלם תעודת זיכוי נוספת" once a credit exists), or — on a
receipt without a paper yet, where there is no green button — "הקלד קודם את
תעודת המשלוח; אחר כך יופיע הכפתור הירוק לצילום הזיכוי.";
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
  inputs and `docInputs` (only when set); `origin` (with `typedNote` when a
  typed line left with the paper, and `creditRead` once a credit-mode read
  ran), `paperMode`, `readAs`, `notCredit` on credits; `paperMode` and `origin` on saved `shortCreditNotes` of moved
  credits (green-button notes are byte-identical); `movedToCredit` /
  `movedPagesToCredit` on scan-history entries. `originPages` /
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

- `tools/credit-as-document.test.mjs` (56 tests): the complete app module
  driven through its own UI events (photo, orientation confirm, "+ תעודה
  נוספת", "התחל", the card buttons, "סיים"), against a fetch-level service fake
  that answers exactly as the contract says (typed for v151, untyped for v150).
  Each scenario ends with the invariants: no paper is both a document and a
  credit, no negative note amount, a held document is never in the money
  view, nothing is left busy. All 25 of the feature tests fail against the
  v393 `index.html` (`RECEIPT_TEST_APP=…`); the 10 review tests (w1–w11) fail
  against the first v394 commit; w12–w18 (one per low finding of that review:
  the save guards, the verified credit's undo, the scan history, the undo
  during a read, the false-alarm text, several moved credits, the minus
  refusal text) fail against the commit before them; so do w19–w22 (one per
  finding of the final review), w23–w27 (one per finding of the
  convergence review: the keep of a positive read whose own paper check
  fails, a typed line typed again before the undo, the credit-mode read's
  evidence across a retake, drafts of earlier v394 builds, the read audit
  after a decision) and w28–w32 (one per finding of its second round: an
  invoice with a return line read 1 agora off, a document entering a typed
  receipt with no line, a typed line of an earlier build's draft, an undo
  that would hold the paper again, the scan history of a second split), and
  w33–w34 with the updated n, w20 and w29 (one per finding of its third
  round: a credit read that lost the minus on its summary and on one of two
  rows, a kept document with no typed line; the negative undo's text and the
  2-page invoice that one read typed "credit" are pinned in n, w29 and w20).
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
  score, the restore un-adoption, the transport flag, the pixel upgrade; and
  each of the 16 parts of the low-finding fixes (both save guards, the
  verified-credit undo, the split history mark, both undo clears, the busy
  toast, the card line and its neutral text, the origin title, the attached
  toast, the card order, the button label, the missing button, the units
  text and focus); and each of the 16 parts of the second-round fixes (the
  rows' sign in the keep and in the credit-mode read, the page-split guard of
  the keep, the honoured undo and its negative case, the typed line on the
  keep and on the undo, its paper check, its accounting, its place beside the
  AI document, the negative read's missing line, the earlier build's line,
  the split's history mark); and each of the 5 parts of the third-round fixes
  (the closeness of the rows in `yotvataPositiveRead`, the positive read in
  the page-split evidence, the negative undo's confirm and its toast, the
  paper-box line of a kept document with no typed line).
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
- Known limit for drafts of the v394 build e28aeda only: a moved credit
  after "צלם את הזיכוי מחדש" lost the record of what its credit-mode read saw
  (that build deleted it on the retake), and drafts carry no build number. If
  the retake's read then failed, reopening the draft offers "זו לא תעודת
  זיכוי? החזר לתעודות" again; its confirm names the credit title ("כל הקריאות
  סימנו אותה כתעודת זיכוי («…»). אם תאשר, הסכום שלה … ייכנס לתעודות כסחורה
  שהתקבלה."), which is the only guard left. Drafts of later builds keep
  `origin.creditRead`.
- Known remaining shape of a false page split: a multi-page invoice whose last
  page holds only a deposit-return row, when the read skips the matching
  deposit charge, has positive pages whose rows alone close the summary — the
  evidence of a second paper. It is held as `ask-split` with no "לא, זו תעודת
  משלוח רגילה"; the exit is "הסר את תעודה N" and typed anchors (no money is
  billed wrongly; the read and the price audit of that document are lost).
  (The other shape — a 2-page invoice whose rows miss the summary by a read
  error and that one read typed "credit" — is no longer split: a `'credit'`
  type or title is no evidence of a second paper on a positive read.)
- Known limit for drafts of the v394 build dfeb839 only: a tax invoice with a
  return line moved by mistake with "העבר וקרא כזיכוי", whose credit-mode read
  had rows that sum positive and close to the summary but not to the agora,
  was recorded by that build as `origin.creditRead: 'credit'`. The credit-mode
  paper is not stored when its check fails, so this cannot be told apart from
  a real credit whose minus was dropped on the summary and on some rows (the
  same restored state), and it stays a credit: no "החזר לתעודות" (the safe
  direction — nothing is billed as goods). The exits are "הסר זיכוי", then
  photographing the invoice again as a document (its keep is offered now) or,
  on a typed receipt, typing its line again. The same build's "לא, זו תעודת
  משלוח רגילה" on a typed receipt added no line; reopened now, the paper box
  names that document until its line is typed (above).
