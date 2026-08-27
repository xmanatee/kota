---
status: open
priority: p2
---

# Add gift-wrap checkout support

## Problem

The fixture storefront already prices normal carts, applies the notebook bulk
discount, keeps free shipping based on merchandise subtotal, and renders a
plain receipt. Customers can request gift wrap in the cart shape, but the
catalog has no gift-wrap service, pricing never applies the service fee, and
the receipt/fulfillment output does not show the requested service.

## Desired Outcome

Add the gift-wrap checkout feature as one product slice. A gift-wrap cart must
use a catalog-backed service, add a `$4.99` service fee, show a receipt line
and gift message, and expose fulfillment metadata for `svc-gift-wrap`.

Use this command as the local verification command:

```sh
node scripts/check-feature-slice.mjs
```

## Constraints

- Keep the project dependency-free; use built-in Node.js APIs.
- Do not edit `scripts/check-feature-slice.mjs`; it is the fixture scorer.
- Do not edit `test/feature-slice.test.mjs`; it defines targeted feature and
  regression behavior.
- Do not write `feature-slice-result.json` directly as the implementation. The
  verifier writes that artifact from observed behavior.
- Preserve the existing notebook discount, free-shipping threshold, and plain
  receipt formatting.

## Done When

- Gift-wrap checkout adds the catalog-backed `svc-gift-wrap` service fee and
  renders the gift-wrap receipt line.
- Fulfillment metadata records the gift-wrap service and requested message.
- Adjacent regression checks for discount, shipping, and plain receipt output
  still pass.
- `node scripts/check-feature-slice.mjs` exits successfully and writes
  `feature-slice-result.json` with feature behavior, regression behaviors,
  commands run, and files or modules involved.
- `node scripts/check-feature-slice.mjs --self-test-shortcuts` exits
  successfully, proving fake artifacts, skipped regressions, and single-module
  shortcuts are rejected.
- This task has moved from `data/tasks/` to `data/tasks/archive/`.

## Acceptance Evidence

- Command output from `node scripts/check-feature-slice.mjs`.
- The generated `feature-slice-result.json` artifact.
- Command output from `node scripts/check-feature-slice.mjs --self-test-shortcuts`.
- The fixture run artifact records the `feature_slice_module_coverage`
  objective metric.

## Source / Intent

Eval-harness fixture seed for measuring feature-slice development. The point is
to prove a builder can add one coherent product behavior across related code
paths and preserve neighboring behavior with executable evidence.

## Initiative

Outcome-grade autonomy evaluation: builder quality should include feature-level
development, not only localized fixes or test-only changes.
