# Return Label Decision Spec

The executable contract must decide whether a candidate return-label decision
faithfully represents this policy. It should validate the decision, not compute
customer support text.

## Requirement IDs

- `FSF-1` Input assumptions: a request must name `purchaseChannel`,
  `daysSinceDelivery`, `itemCategory`, `condition`, `memberTier`, and
  `proofOfPurchase`. `daysSinceDelivery` must be a non-negative integer.
  Malformed requests are valid only when the candidate decision is an
  `invalid-request` outcome.
- `FSF-2` Standard online purchases with proof of purchase may receive a
  prepaid label through day 30 when the item is new or like-new and is not in
  an excluded category.
- `FSF-3` Gold online purchases with proof of purchase use the same rules but
  may receive a prepaid label through day 45.
- `FSF-4` Store purchases are not eligible for a prepaid label. A faithful
  decision routes them to in-store return handling instead of approving a
  label.
- `FSF-5` Gift cards, perishables, final-sale items, damaged items, and
  requests without proof of purchase are not eligible for prepaid labels.
- `FSF-6` Equivalent output shapes are valid when they encode the same
  decision. The contract must not require one reference JSON shape if another
  local shape clearly means the same approved, denied, invalid, or in-store
  outcome.
