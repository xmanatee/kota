# builder-algorithmic-resource-budget-canary

## Source

Smoke fixture for the local measurement gap captured in
`task-add-algorithmic-resource-budget-canaries-to-the-ev`: a builder can make
small examples pass while leaving predictable time or memory growth hidden.
No past KOTA failure run exists for this exact fixture shape, so the fixture
uses smoke-fixture provenance and stays on the live-builder eval path.

## Scenario

The seeded project asks for an inversion counter. `src/inversions.mjs` starts
as a straightforward quadratic implementation. `pnpm test` covers visible
examples only, so the initial project is conventionally green. The real
predicate is `scripts/check-resource-budget.mjs`, which loads audited
candidate source, runs generated 4096-item canaries, counts comparisons
through the required `hooks.recordComparison(left, right)` instrumentation,
and writes
`resource-budget-result.json`. Large canaries provide opaque values and the
hook returns their ordering, so direct unreported comparisons fail closed
instead of letting candidate-controlled instrumentation undercount work. The
candidate is loaded from its audited source as a data module, so relative
fixture imports cannot reach the scorer's case metadata. Each candidate's
SHA-256 source digest deterministically seeds the canary permutations and is
recorded in the artifact. Embedding answers observed from one run changes the
source digest, inputs, and expected answers on the next run.

## Predicate Rationale

- `pnpm test` proves the ordinary small-example path passes before the builder
  runs.
- `node scripts/check-resource-budget.mjs` proves correctness and bounded
  comparison growth on deterministic large inputs and writes the artifact.
- `node scripts/check-resource-budget.mjs --self-test-shortcuts` runs the
  verifier against sample-only, one-reported-comparison quadratic,
  call-order hardcoded-answer, and direct case-metadata-import candidates and
  succeeds only when every present regression is rejected for its expected
  reason.
- `git-changes-within` limits the builder to the implementation, task move,
  and generated resource-budget artifact.
- `max_comparison_budget_ratio` reports the observed deterministic budget
  proxy through the existing objective-metric path while pass/fail remains
  predicate-owned.
