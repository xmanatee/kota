# Builder Feature-Slice Development Fixture

This fixture measures a compact product-engineering shape: implement one
checkout feature that crosses existing catalog, pricing, and receipt layers
while preserving nearby behavior.

The initial project already passes adjacent regression checks for bulk
discounts, free shipping, and plain receipt formatting. The missing feature is
gift wrap: the builder must add the catalog-backed service, price it, surface
it in fulfillment metadata, and render it in the receipt.

The verifier owns the scoring surface:

- `node scripts/check-feature-slice.mjs --baseline-only` proves the seeded
  project starts from passing existing behavior.
- `node scripts/check-feature-slice.mjs` runs targeted feature checks,
  adjacent regression checks, validates changed source-module coverage,
  verifies the gift-wrap output is catalog-backed, and writes
  `feature-slice-result.json`.
- `node scripts/check-feature-slice.mjs --self-test-shortcuts` proves fake
  artifacts, skipped regressions, single-module shortcuts, and hardcoded
  output/catalog-bypass shortcuts fail the verifier.

The fixture is replay-backed so normal eval runs exercise the builder workflow
without requiring provider network access.
