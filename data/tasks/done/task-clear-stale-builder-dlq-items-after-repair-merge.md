---
id: task-clear-stale-builder-dlq-items-after-repair-merge
title: Clear stale builder DLQ items after repair merge
status: done
priority: p3
area: platform
task_class: Platform
summary: The current builder DLQ investigation repaired the commit-stageable index-lock handling and found the idle-timeout item superseded, but the canonical dead-letter queue could not be mutated from the builder worktree sandbox. Dismiss, redrive, or explicitly suppress the two stale builder DLQ items with before/after evidence once daemon control or canonical write access is available.
created_at: 2026-06-30T23:34:03.517Z
updated_at: 2026-07-01T18:58:34.620Z
---

## Problem

The canonical dead-letter queue still has two open builder workflow-dispatch
items even though the underlying investigation has a known outcome:

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6` came from builder run
  `2026-06-29T18-19-41-973Z-builder-qonf80`, which idled while attempting
  `task-resolve-current-progress-reviewer-write-scope-dead`. Later builder
  run `2026-06-30T19-53-51-915Z-builder-ggdpuf` replaced the stale claim and
  completed that task with merge commit `8cef38bb177119e4ca81e219190324e0d052207e`.
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28` came from builder run
  `2026-06-30T15-16-48-125Z-builder-3usmop`, whose repair loop kept failing
  `commit-stageable`. The failed task worktree had a stale Git index lock at
  `.git/worktrees/task-security-review-the-task-move-path-accepts-unvalid-2026-06-30t15-16-48-125z-builder-3usmop/index.lock`,
  and the runtime repair check misreported that persistent lock as a generic
  staging/gitignore conflict.

The builder run `2026-06-30T22-39-06-955Z-builder-ez3sip` repaired the
commit-stageable index-lock handling and recorded the evidence, but could not
mutate the canonical DLQ from its worktree sandbox.

## Desired Outcome

The two cited builder DLQ records are no longer treated as unresolved progress
review findings.

## Resolution

Canonical daemon-control DLQ cleanup dismissed both cited items on
2026-07-01:

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6` was dismissed as stale because
  builder run `2026-06-30T19-53-51-915Z-builder-ggdpuf` completed the same
  task and merged `8cef38bb177119e4ca81e219190324e0d052207e`.
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28` was dismissed as superseded by
  the commit-stageable index-lock repair validated in
  `.kota/runs/2026-06-30T22-39-06-955Z-builder-ez3sip/dead-letter-resolution.md`.

Run artifacts under
`.kota/runs/2026-07-01T04-28-10-634Z-builder-hw7ysm/` preserve before and
after evidence. The after artifact records both items as `dismissed` and the
canonical open-builder DLQ query with `counts.open: 0`.

## Constraints

- Preserve the cited ids and the repair evidence until cleanup is complete.
- Prefer dismissal with rationale if the items are superseded by the completed
  task and merged runtime repair. Redrive only if the current runtime still
  needs to replay the original failed work.
- Do not create duplicate implementation scope for
  `task-resolve-current-progress-reviewer-write-scope-dead` or
  `task-security-review-the-task-move-path-accepts-unvalid`.

## Done When

- The canonical dead-letter queue no longer reports either cited id as open,
  or progress review has an explicit durable suppression/rationale for why
  they should remain open.
- Before/after evidence is recorded in the resolving run artifact or task note.
- The resolution cites the repair evidence from
  `.kota/runs/2026-06-30T22-39-06-955Z-builder-ez3sip/dead-letter-resolution.md`.

## Source / Intent

Follow-up from `task-resolve-current-builder-workflow-dead-letters`. That run
could read the canonical DLQ and repair the code-side failure, but direct DLQ
dismissal failed because canonical writes are outside the builder worktree
sandbox and daemon-control HTTP access from the active build step failed with
`connect EPERM`.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-07-01T04-28-10-634Z-builder-hw7ysm/builder-dlq-before-dismissal.json`
  records both ids with their canonical open state.
- `.kota/runs/2026-07-01T04-28-10-634Z-builder-hw7ysm/builder-dlq-after-dismissal.json`
  records both ids dismissed and the open builder DLQ query with
  `counts.open: 0` and `citedIdsStillOpen: []`.
- `.kota/runs/2026-07-01T04-28-10-634Z-builder-hw7ysm/dead-letter-resolution.md`
  links the completed replacement run, merge commit, and
  `.kota/runs/2026-06-30T22-39-06-955Z-builder-ez3sip/dead-letter-resolution.md`.
