---
id: task-enable-guarded-parallel-builder-dispatch-with-conf
title: Enable guarded parallel builder dispatch with conflict fixtures
status: done
priority: p1
area: autonomy
task_class: Platform
depends_on: [task-add-atomic-task-claim-leases-for-parallel-autonomy, task-run-builder-work-and-repair-inside-task-worktrees, task-add-merge-gate-and-automated-conflict-resolver-for, task-surface-worktree-run-status-and-cleanup-controls]
summary: Allow multiple builders only behind worktree mode and prove it with disjoint, overlapping, conflict, merge, and cleanup harness fixtures.
created_at: 2026-06-25T14:54:02.826Z
updated_at: 2026-06-28T16:58:02.000Z
---

## Problem

KOTA already has scheduler concurrency settings, but raising builder
concurrency without worktree, claim, merge, and cleanup evidence would only
move the failure from "single checkout bottleneck" to "parallel conflict and
state bottleneck." External reports consistently warn that parallel agents help
most when tasks are independent and can lose time to merge conflict,
duplicated implementations, and runtime collisions.

## Desired Outcome

Parallel builder dispatch is available only when worktree mode and the merge
gate are enabled. KOTA proves the behavior with harness fixtures that cover
independent changes, overlapping files, textual conflicts, blocked conflicts,
stale claims, and cleanup.

## Constraints

- Keep the default conservative until fixtures and status surfaces are green.
- Do not use the same branch in more than one worktree.
- Do not let concurrent builders select the same task.
- Merge into the canonical checkout serially through the merge gate even when
  implementation runs concurrently.
- Record metrics: wait time, run duration, merge duration, conflict count,
  resolver attempts, validation failures, cleanup outcome, and net throughput.

## Done When

- Scheduler dispatch can run at least two builder workflows concurrently in
  worktree mode.
- Merge/integration remains serialized or otherwise protected by a lock.
- Harness fixtures include disjoint success, same-file conflict, blocked
  conflict, stale claim recovery, and cleanup refusal.
- Metrics are recorded in run artifacts for comparing parallel vs sequential
  builder runs.

## Source / Intent

The owner wants worktrees to "enable parallel work." Research suggests
parallelism is useful only with task independence, coordination, and a merge
gate. Measurements to keep in view: "Where Do AI Coding Agents Fail?" reports
71.48% merged across 33,596 agentic PRs, while AgenticFlict reports 27.67%
conflict rate in its processed PR set.

Sources:
https://arxiv.org/html/2601.15195v1
https://arxiv.org/html/2604.03551v2

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/autonomy src/core/workflow` passed on
  2026-06-28 with 192 test files and 1467 tests.
- `src/core/workflow/runtime-dispatch-parallel-runs.test.ts` proves two
  same-workflow builder-like runs can be active only when the workflow opts
  into a two-run cap, and remains serial by default.
- `src/modules/git/worktree-merge-gate-lock.test.ts` proves disjoint
  worktree merges serialize through the merge-gate lock while preserving both
  canonical changes.
- Existing merge-gate, worktree lifecycle, task-claim race, and recovery tests
  cover same-file conflict, blocked conflict, stale claim recovery, and cleanup
  refusal.
- `src/modules/autonomy/workflows/builder/parallel-metrics-step.ts` records
  wait time, run duration, merge duration, conflict count, resolver attempts,
  validation failures, cleanup outcome, and net throughput into
  `parallel-builder-metrics.json`; the builder worktree-mode test validates the
  artifact shape and merge/cleanup paths.
