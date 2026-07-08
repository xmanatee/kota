---
id: task-make-strategic-ready-coverage-claim-aware-for-pend
title: Make strategic ready coverage claim-aware for pending-merge tasks
status: ready
priority: p2
area: autonomy
task_class: Meta
summary: Exclude active pending-merge claimed tasks from explorer and task-validation strategic ready coverage so p3-only dispatchable queues cannot be masked by unclaimable p1/p2 work.
created_at: 2026-07-08T08:26:37.422Z
updated_at: 2026-07-08T08:26:37.422Z
---

## Problem

KOTA has claim-aware queue counts, but explorer's strategic-ready coverage
signal still uses raw task files. In this run `inspect-queue` reported:

- `actionableCount: 1` and `dispatchableCount: 1`;
- one claim-blocked ready p1 Meta task,
  `task-run-shadow-semantic-reviewers-for-non-builder-auto`, with
  `claimStatus: pending-merge` and `recoveryPath: skipped-pending-merge`; and
- one ordinary dispatchable ready task, the p3 Safety follow-up
  `task-security-review-the-doctor-provider-connectivity-c`.

That is effectively a p3-only dispatchable queue, but
`strategicReadyCoverageGap` was `false` because
`hasStrategicReadyCoverageGap(projectDir)` reads raw `ready/` entries and sees
the unclaimable p1 task. The same raw ready-coverage path can let explorer
commit a `noop` or `watchlist-only` rationale without treating the p3-only
dispatchable queue as actionable strategic queue work.

This is narrower than general claim-aware queue availability. The ordinary
counts were already repaired by
`task-make-queue-availability-claim-aware-for-pending-me`; the remaining gap is
the strategic coverage predicate and validation evidence that decide whether
explorer must seed or promote p0/p1/p2 work.

## Desired Outcome

Strategic-ready coverage uses the same ordinary-dispatchability semantics that
queue availability uses. A ready or doing task with an active non-retryable
claim, especially `pending-merge`, remains visible in queue payloads and
recovery output but does not satisfy strategic-ready coverage until the claim
is released, superseded, or otherwise safe to retry.

For the current shape, explorer should surface
`strategicReadyCoverageGap: true` when the only ordinary dispatchable ready work
is p3, even if a p1/p2 task is present in `ready/` behind a pending-merge
claim. The repair-loop rationale check should then reject `noop` and
`watchlist-only`, forcing explorer to promote, decompose, create, or honestly
fail before commit.

## Constraints

- Preserve pending-merge safety. Do not make builder claim or retry a task whose
  active claim is still blocked by merge evidence.
- Do not solve this by editing the current shadow-review task body, deleting
  claim files, or changing the blocked recovery tasks. Those surfaces own the
  current canonical claim cleanup.
- Do not treat every claimed task as absent. Only active claims that are not
  safe to retry should stop a task from satisfying strategic-ready coverage.
- Do not let dependency-blocked backlog or strategic anchors satisfy ready
  coverage. Keep the existing dependency and anchor meanings.
- Respect module boundaries: `repo-tasks` owns task-file validation and queue
  coverage, while autonomy owns task-claim inspection. Avoid a repo-tasks to
  autonomy runtime dependency; pass filtered coverage data through the
  autonomy-owned caller or add a narrow neutral input shape if needed.
- Keep claim-blocked task ids, recovery status, and recovery commands visible
  to operators.

## Done When

- Explorer's `inspect-queue` reports `strategicReadyCoverageGap: true` for a
  queue with one p3 ordinary ready task and one p1/p2 ready task blocked by a
  non-retryable pending-merge claim.
- The same coverage stays `false` when a p1/p2 ready task is ordinary
  claimable work or when a claim inspection says the task is safe to retry.
- The `strategic-ready-coverage` repair check uses the same claim-aware
  semantics as the `inspect-queue` value, so the agent sees the condition before
  the repair loop trips.
- Focused tests cover the current pending-merge shape, a safe-to-retry claim,
  dependency-blocked ready/backlog tasks, and an ordinary p2 ready task.
- Existing claim-aware queue availability, dispatcher, and builder claim tests
  continue to pass.

## Source / Intent

Created by explorer run `2026-07-08T07-45-38-894Z-explorer-ib6snv`.
The run was triggered by `autonomy.queue.thin`. The exposed queue assessment
had `strategicReadyCoverageGap: false`, `actionableCount: 1`,
`dispatchableCount: 1`, one claim-blocked p1 ready task, and one ordinary p3
ready Safety task.

Local code inspection found:

- `src/modules/autonomy/workflows/explorer/workflow.ts` builds queue counts
  through `getClaimAwareRepoTaskQueueSnapshot(projectDir)` but sets
  `strategicReadyCoverageGap` through
  `hasStrategicReadyCoverageGap(projectDir)`.
- `src/modules/repo-tasks/task-queue-validation.ts` implements
  `hasStrategicReadyCoverageGap` and ready-coverage evidence from raw
  `listTaskEntries(projectDir)` state entries.
- `src/modules/autonomy/queue-availability.ts` already knows which ready/doing
  tasks are claim-blocked and not safe to retry.

Overlap check:

- `task-make-queue-availability-claim-aware-for-pending-me` already fixed
  ordinary queue counts and dispatcher availability for pending-merge tasks.
- `task-add-canonical-recovery-actions-for-stale-workflow-` already added the
  workflow state-recovery operation for stale pending-merge claims.
- `task-make-generated-workflow-recovery-commands-use-a-ru` already fixed the
  operator command hints for that recovery path.
- `task-recover-shadow-review-branch-blocked-by-merge-gate` owns the specific
  unresolved shadow-review pending-merge cleanup.

The strategic blocked alternatives surfaced in this run were all
operator-capture gated and not movable:

- `task-extend-harness-parity-and-eval-harness-with-model-`
- `task-add-a-cross-hierarchy-signal-flow-debugging-fixtur`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

## Initiative

Reliable autonomy queue dispatch and strategic queue coverage.

## Product / Safety Link

Safety: prevents a p3-only ordinary dispatchable queue from being masked by an
unclaimable p1/p2 Meta task. Product and Safety work stays visible because
explorer must create or promote strategic work when the real dispatchable queue
has drifted to low-priority cleanup.

## Acceptance Evidence

- Focused test transcript covering explorer strategic-ready coverage with a
  pending-merge p1 ready task plus ordinary p3 ready work, a safe-to-retry claim
  case, and ordinary p2 ready work.
- Focused validation or coverage tests showing `assertStrategicReadyCoverage`
  and the explorer repair-loop check use matching claim-aware semantics.
- `pnpm run validate-tasks`.
