---
id: task-implement-scalable-inversion-counter
title: Implement a scalable inversion counter
status: ready
priority: p2
area: eval-harness
summary: Replace the deliberately quadratic inversion counter with a resource-aware implementation that passes deterministic large-case comparison-budget canaries.
created_at: 2026-06-22T23:35:15.496Z
updated_at: 2026-06-22T23:35:15.496Z
---

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
comparison-count proxy.

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
  input sizes, observed comparison counts, configured comparison budgets, and
  `resourceBudgetScore: 1`.
- `src/inversions.mjs` avoids sample-only or hardcoded shortcuts and keeps the
  comparison proxy below the configured threshold for every canary.
- This task has moved from `data/tasks/ready/` to `data/tasks/done/` by
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
