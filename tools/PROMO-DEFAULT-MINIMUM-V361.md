# Promotion default minimum — v361

The user clarified that an unspecified minimum means the discount starts at one
unit. Legacy promotions with `minQty: 1`, `minUnit: carton` and no carton size
therefore must not ask the receiving user to supply a carton size.

The shared minimum calculation, early price review, automatic price/name matching
and promotion editor now use this rule. An empty quantity remains one unit even
if stale carton metadata exists. Saving an empty minimum normalizes it to one
unit without requiring extra input. The editor explains the default explicitly.

Explicit unit thresholds and complete carton thresholds remain effective. An
explicit multi-carton quantity with missing conversion still needs completion.
Editing a complete one-carton threshold displays the 1 and preserves that rule.

All 295 application tests pass. Seven new full-module cases cover the default
at one received unit, legacy draft reload, exact thresholds, editor saving and
final receiving amounts. Existing carton-review cases now use an explicit
multi-carton minimum. The supplied private draft was replayed without changing
the source or promotion record: the relevant row matches its discount with a
one-unit minimum and no carton question. Its separate reopened price review
remains intact. No model calls or production data writes were needed.
