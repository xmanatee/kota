# Superseded dirty-checkout builder dead letter

Dead letter: `dlq-a5b25dd4-77c7-4bf4-929b-15dd3deadaf0`

## Before

`dead-letter-before-dismissal.json` records the canonical item as `open`. Its
failed run is `2026-07-25T14-45-12-341Z-builder-y0bn4a`; that run completed
its build and committed `484d399ffccf`, then failed at the merge gate because
the canonical checkout changed concurrently.

The failed run's branch and clean worktree remain preserved. Its unique commit
contains the same blocked recovery-task outcome later produced by the
successful run, while its run evidence remains available in the canonical run
directory.

## Superseding outcome

Commit `ee01b83cc67f7726d0eb06aa6a645424ba600e76` is on canonical `main` and
changes dirty merge-checkout handling so a completed builder branch becomes a
typed pending merge instead of a terminal failure.

Run `2026-07-25T15-52-06-334Z-builder-e7it1w` then claimed the same task
`task-reconcile-stale-recovery-state-blocking-existing-p` from base
`ee01b83cc67f`. Its metadata records overall status `success`; its merge-gate
artifact records `status: merged` and merge commit
`72b9364e1116e6d2f5b2adc16d054063cd56ca33`, which is on canonical `main`.

## Security-review attribution

The failed merge gate named these dirty security-review paths:

- `src/modules/autonomy/workflows/security-review/AGENTS.md`
- `src/modules/autonomy/workflows/security-review/prompt.md`
- `src/modules/autonomy/workflows/security-review/workflow-run.test-cases.ts`
- `src/modules/autonomy/workflows/security-review/workflow.ts`

Those are exactly the four paths changed by landed commit
`18a12e397024aa0b74639ebde859f9b639de81b5`
(`Reduce security-review provider refusals`). The target failure therefore did
not strand that concurrent security-review change set.

An older worktree for
`task-restore-defensive-security-review-after-classifier` has additional local
changes, including `workflow.test.ts`. It has no unique commits, but its dirty
tree, active task claim, task file, and dedicated security-review dead letter
remain preserved. That separately attributed recovery item is outside this
builder dead letter and was not discarded or represented as merged here.

## Disposition

Redrive would replay the stale trigger after the same task had already reached
a successful merged terminal run. The item was therefore dismissed through
KOTA's authenticated daemon control route with this stored rationale:

> Superseded by dirty-checkout branch-preservation fix ee01b83cc67f and
> successful builder run 2026-07-25T15-52-06-334Z-builder-e7it1w, whose merge
> gate merged the same task. The concurrent security-review dirt cited by the
> failure landed as 18a12e397024; separate defensive-review work remains
> preserved under task-restore-defensive-security-review-after-classifier.
> Evidence: builder run
> 2026-07-25T16-18-47-137Z-builder-mp7c4x.

`dead-letter-after-dismissal.json` records status `dismissed`, the stored
rationale, and no redrive attempts. `open-builder-dead-letters.json` records an
empty filtered open-builder item list after dismissal.
