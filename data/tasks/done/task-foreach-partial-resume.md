---
id: task-foreach-partial-resume
title: Allow foreach steps to resume from failed items on workflow retry
status: done
priority: p3
area: runtime
summary: When a foreach step fails partway through (even with continueOnFailure), retrying the workflow re-runs all items from scratch. For expensive agent steps in a foreach loop, recording which items failed and re-running only those on retry would save significant cost and time.
created_at: 2026-04-09T05:00:00Z
updated_at: 2026-04-09T05:00:00Z
---

## Problem

`step-executor-foreach.ts` runs each item sequentially (or in batches when
`maxConcurrency > 1`). Item results are stored in the step's final output as
`{ items: N, results: [...] }` but this granular data is not preserved in a
form that allows the retry/resume path to skip already-successful items.

When a foreach step with 50 items fails on item 30 (due to a transient error
or resource limit), a `kota workflow retry` or `kota workflow replay` re-runs
all 50 items. For workflows that use agent steps inside the foreach loop this
wastes both time and API cost.

The workflow already supports `continueOnFailure` at the item level, which
lets the step complete with a partial result. But even with that flag, retrying
restarts from item 0.

## Desired Outcome

When `continueOnFailure: true` is set on a foreach step and the step completes
with some failed items, a subsequent retry of the workflow (or replay) can
identify the failed item indices from the prior run's output and skip items
that already succeeded.

A new optional field `retryFailedItems: true` on the foreach step opts into
this behavior. Without it, the current all-items-from-scratch behavior is
unchanged.

The retry path would:
1. Read the prior run's foreach step output (already stored in metadata).
2. Filter `items` to only those with `status: "failed"`.
3. Run only the failed items, preserving successful results from the prior run.
4. Merge partial results into a combined output.

## Constraints

- Opt-in only: `retryFailedItems` defaults to false. Existing foreach steps
  are unaffected.
- Applies only to `continueOnFailure: true` foreach steps — the feature is
  not useful without partial results to preserve.
- The merged output format matches the current `{ items, results }` shape so
  downstream `when` predicates work unchanged.
- Resumption only works when the prior run used the same item list (same
  `items` source resolves to the same count). A count mismatch falls back to
  a full re-run with a warning.
- No changes to the `WorkflowForeachStep` type are required beyond adding the
  optional `retryFailedItems` field.

## Done When

- Foreach steps with `retryFailedItems: true` and `continueOnFailure: true`
  skip already-successful items on retry.
- The merged output includes results from both the prior successful items and
  the re-run failed items.
- A unit test covers the partial-resume path, the count-mismatch fallback,
  and the unchanged behavior when `retryFailedItems` is absent.
- `docs/WORKFLOWS.md` documents the new field.
