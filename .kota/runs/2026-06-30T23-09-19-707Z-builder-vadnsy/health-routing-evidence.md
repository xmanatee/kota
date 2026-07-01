# Autonomy Health Routing Evidence

## Cited Pattern

- dedupe key: `dead-letter:execution:workflow-runtime:progress-reviewer`
- DLQ item: `dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7`
- source evidence: `.kota/dead-letter-queue/items.json#dlq-c3d9197c-110e-495d-ab5d-12e1de7925a7`

## Root Cause

The cited DLQ item is still open, but the underlying progress-reviewer
write-scope failure was already diagnosed as shared-workspace false
attribution and repaired by `task-resolve-current-progress-reviewer-write-scope-dead`.
The remaining operator work is DLQ cleanup, tracked by
`task-clear-stale-progress-reviewer-write-scope-dlq-item`.

The health reviewer only deduped against its own generated health task id and
exact evidence refs. It did not notice an active task that recorded the same
DLQ item by scoped evidence id, so the stale open DLQ item could route into a
second Meta root-cause repair task.

## Repair

`applyAutonomyHealthReviewActions` now checks open task states
(`backlog`, `ready`, `doing`, `blocked`) for tasks that already record every
group evidence ref before creating a new local-code health repair task.
Dead-letter evidence matching accepts both the raw evidence ref and the DLQ
item id, so progress-reviewer scoped evidence ids suppress duplicate health
repair tasks for the same stale DLQ item.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts` passed: 2 files, 13 tests.
- `pnpm run typecheck` passed.

The new regression seeds the same stale progress-reviewer DLQ shape plus an
active `task-clear-stale-progress-reviewer-write-scope-dlq-item` task. The
review action is `skipped-task` with that existing task id and `createdTaskIds`
is empty.
