---
status: open
priority: p2
---

# Implement a scalable inversion counter

## Problem

`src/inversions.mjs` currently counts inversions by checking every pair. That
is correct for the visible examples, but it grows quadratically and fails the
fixture's larger deterministic resource-budget canaries.

## Desired Outcome

Implement `countInversions(values, hooks)` with a scalable algorithm. The
function should return the number of index pairs `i < j` where
`values[i] > values[j]`, including duplicate-heavy inputs. Preserve the
optional `hooks.recordComparison(left, right)` callback and call it for each
logical value comparison so the verifier can record a deterministic
comparison-count proxy. When the callback returns `-1`, `0`, or `1`, use that
ordering directly. Fall back to an ordinary numeric comparison only when the
optional callback or its return value is absent. The final canaries provide
opaque values whose ordering is available only through the callback, so an
implementation cannot perform unreported comparisons and undercount its work.

The visible examples remain covered by:

```sh
pnpm test
```

The final resource-budget verifier is:

```sh
node scripts/check-resource-budget.mjs
```

## Constraints

- Only change `src/inversions.mjs` and this task's state.
- Keep `src/inversions.mjs` self-contained. Do not import modules, read fixture
  files, or use runtime-global access to recover the verifier's case metadata.
- Do not edit `scripts/check-resource-budget.mjs`,
  `scripts/sample-only-inversions.mjs`, package scripts, or fixture metadata.
- Do not hardcode visible examples, generated canary ids, generated input
  sizes, expected inversion totals, or verifier artifact contents.
- Do not skip large cases, relax thresholds, or write
  `resource-budget-result.json` directly.
- Do not commit from the agent step; the workflow commit step handles that.

## Done When

- `pnpm test` exits successfully.
- `node scripts/check-resource-budget.mjs` exits successfully and writes
  `resource-budget-result.json`.
- `resource-budget-result.json` lists the generated large canary ids,
  candidate-source challenge digest, input sizes, observed comparison counts,
  configured comparison budgets, and `resourceBudgetScore: 1`.
- `src/inversions.mjs` avoids sample-only or hardcoded shortcuts and keeps the
  comparison proxy below the configured threshold for every canary.
- This task has moved from `data/tasks/` to `data/tasks/archive/` by
  running exactly `pnpm run finish-task`.

## Acceptance Evidence

- Command output from `pnpm test`.
- Command output from `node scripts/check-resource-budget.mjs`.
- The generated `resource-budget-result.json` artifact inspected by the
  eval-harness predicates and objective metric.

## Source / Intent

Eval-harness fixture seed for measuring algorithmic resource-budget work.
The fixture exists because small-example correctness can hide predictable
time-complexity failures, and the harness should grade scalable design through
deterministic artifacts instead of builder prose.

## Initiative

Outcome-grade autonomy evaluation: builder quality on coding tasks should be
judged by correctness and bounded resource behavior on deterministic holdout
cases, using the existing eval-harness path.
