---
id: task-add-atomic-task-claim-leases-for-parallel-autonomy
title: Add atomic task claim leases for parallel autonomy
status: ready
priority: p1
area: autonomy
task_class: Platform
depends_on: [task-record-architecture-decision-for-worktree-backed-a]
summary: Prevent duplicate parallel builders by claiming queue tasks before launching isolated worktree runs and releasing or expiring claims safely.
created_at: 2026-06-25T14:53:34.597Z
updated_at: 2026-06-27T04:08:02.031Z
---

## Problem

Worktrees isolate files, but they do not stop two scheduler ticks or two
parallel builders from selecting the same `ready` task. Without an atomic claim
or lease, parallel autonomy can duplicate work, race task-state edits, and
produce two branches that both claim to complete the same task.

## Desired Outcome

Autonomy has a queue-claim protocol that marks a task as owned before launching
its worktree run. The claim records run id, workflow id, worktree path, branch,
base commit, lease time, and owner. Claims are released on successful merge,
marked pending on conflict, and can be expired or recovered after daemon
restart.

## Constraints

- Preserve normalized task files as the human-readable source of work.
- Do not rely on prompt cooperation for exclusivity.
- The claim operation must be atomic enough for concurrent local processes.
- Recovery must distinguish "agent still running", "worktree pending merge",
  "stale claim", and "safe to retry".
- Claims should be visible in run artifacts or a small KOTA-owned state file,
  not hidden in process memory.

## Done When

- Builder candidate selection claims a task before creating or starting an
  agent worktree.
- A second concurrent selection skips claimed tasks.
- Stale claims can be listed and either resumed, expired, or marked pending
  with evidence.
- Tests cover two concurrent claim attempts for the same task and different
  tasks.

## Source / Intent

The owner specifically wants parallel work. External multi-agent systems pair
isolated workspaces with a coordinator or manager; KOTA needs a local task
claim mechanism before raising `scheduler.agentConcurrency`.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/autonomy` passes for the claim/lease tests.
- A concurrency fixture shows two workers claim two different tasks, while two
  workers racing on one task produce one winner and one skip.
- Status output or run artifacts show the active claim owner and recovery path.
