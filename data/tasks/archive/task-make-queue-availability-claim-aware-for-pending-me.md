---
status: done
---

# Make queue availability claim-aware for pending-merge tasks

## Problem

`getRepoTaskQueueSnapshot` currently treats every dependency-clear `ready/` or
`doing/` task as actionable. That misses the task-claim state: a ready task can
still have an active `pending-merge` claim, and `claimTask` will deliberately
skip it with `skipped-pending-merge` until the merge is resolved or the claim is
released.

This run hit that shape. The only ready task,
`task-run-shadow-semantic-reviewers-for-non-builder-auto`, says it cannot be
claimed again until builder run
`2026-07-07T06-33-49-256Z-builder-79nvwh` is released or superseded, but
`inspect-queue` still reported `actionableCount: 1` and the dispatcher emitted
normal queue availability. That can keep builder spinning on non-claimable work
and can hide the fact that the queue has no ordinary dispatchable task until an
operator-capture cleanup lands.

## Desired Outcome

Queue availability distinguishes ordinary claimable work from recovery-only or
pending-merge work. Dispatcher/explorer queue counts should not count a ready
task with an active non-retryable task claim as normal `actionableCount`, and
the emitted queue payload should expose enough claim/recovery summary for the
operator and follow-up workflows to see why the task is visible but not
claimable.

## Constraints

- Preserve the existing pending-merge safety rule: builder must not start a
  second run for a task while a merge-gated claim is unresolved.
- Do not solve this by editing the task body or deleting claim files. The
  blocked operator-capture cleanup tasks own the current canonical claim and
  dead-letter cleanup.
- Keep the distinction local to queue/claim ownership. Dependency-blocked
  backlog handling, strategic anchors, and Meta Product/Safety-link validation
  should keep their current meanings.
- Avoid adding a parallel queue catalog. Reuse the existing repo-task snapshot,
  task-claim inspection, dispatcher event payloads, and builder claim step.

## Done When

- `getRepoTaskQueueSnapshot` or its caller can identify ready/doing tasks whose
  active claim is not safe to retry, including `pending-merge`.
- `autonomy.queue.available` is not emitted solely because of a
  pending-merge-claimed ready task, and `autonomy.queue.thin` / empty-queue
  assessment reflects ordinary dispatchability instead of raw ready-file count.
- Builder claim tests cover the no-ordinary-work case where a ready task exists
  but `claimTask` would return `skipped-pending-merge`.
- Operator-visible queue payloads or run artifacts name the blocked task id,
  claim status, and recovery path so the existing blocked cleanup tasks remain
  discoverable.
- Existing dependency-blocked backlog and ready/doing count tests still pass
  with the new claim-aware accounting.

## Source / Intent

Explorer run `2026-07-07T17-39-20-099Z-explorer-9e8s6o` was triggered by
`autonomy.queue.thin` with `actionableCount: 1`, `dispatchableCount: 1`, and no
promotable backlog. The sole ready task was
`task-run-shadow-semantic-reviewers-for-non-builder-auto`, whose recovery note
states it cannot be claimed again until the canonical pending-merge claim from
builder run `2026-07-07T06-33-49-256Z-builder-79nvwh` is released or
superseded.

Related blocked tasks already cover the manual cleanup:
`task-recover-shadow-review-branch-blocked-by-merge-gate` and
`task-recover-shadow-reviewer-builder-dead-letter-and-cl`. This task is the
nonduplicative runtime-accounting fix so future queue-shape events do not treat
that same blocked recovery state as ordinary builder capacity.

## Initiative

Reliable autonomy queue dispatch.

## Product / Safety Link

Safety: prevents duplicate builder work against a task with an unresolved
merge-gated claim while also making the lack of ordinary dispatchable work
visible, so Product and Safety tasks are not starved behind a misleading ready
count.

## Acceptance Evidence

- `pnpm test src/modules/autonomy/queue-availability.test.ts src/modules/autonomy/task-claim-recovery.test.ts src/modules/autonomy/workflows/builder/workflow-claim-aware.test.ts src/modules/autonomy/workflows/builder/workflow-workspace.test.ts src/modules/autonomy/workflows/dispatcher/workflow-claim-aware.test.ts src/modules/autonomy/workflows/dispatcher/workflow.test.ts src/modules/autonomy/workflows/explorer/workflow.test.ts` passes, covering claim-aware queue accounting, dispatcher event emission, builder claim behavior, and the repaired workspaceDir regression for a ready task with a `pending-merge` active claim.
- `.kota/runs/2026-07-07T17-54-23-767Z-builder-qn3x2g/claim-aware-queue-snapshot.json` shows a queue snapshot with ordinary `actionableCount` at zero plus an explicit pending-merge/recovery summary for the visible task.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run validate-tasks`, `autonomy-change-decision`, and `source-file-size-severe` pass or report advisory-only findings.
