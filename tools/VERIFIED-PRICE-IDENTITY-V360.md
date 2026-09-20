# Product matching from independently verified prices — v360

The user requested that a name disagreement stop requiring confirmation once
two independent reads agree on the printed unit price. The supplied v147 draft
demonstrates the problem: all three reads agree on the numbers, but differing
product hints keep the row in the identity queue.

The client now validates agreement between the two initial reads or between the
strong read and either initial read, bound to the current saved row. It filters
catalog products by the exact price and chooses the closest name across those
readings. A name tie prefers the strong read's product. An eligible promotion
price can also match; unit prices are never rounded to cents for this selection.

The extracted row and model votes remain unchanged. Missing or disputed numeric
fields still require review, and actual price/promotion gaps remain in the saved
audit. Automatic matches appear in a collapsed optional section where the user
can change the product. Manual selections override automation.

The rule works when restoring a draft with the saved v147 field support and
readings. No extra model request or backend change is needed. Older drafts that
lack independent price evidence retain their existing review controls.

Validation: 13 full-module regression cases cover both read combinations, exact
pricing, closest-name ordering, strong-read ties, stale evidence, promotion
precision, true numeric disagreements, optional overrides, reload and final
saving. The private real-draft replay also selects the expected product without
user confirmation and preserves the entire paper source and payable amount.
Private invoices, customer details and backups are excluded from the repository.

Full suite: `node --test --test-concurrency=4 tools/*.test.mjs tools/*-test.mjs`
passes all 288 tests.
